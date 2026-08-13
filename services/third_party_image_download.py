from __future__ import annotations

import base64
import logging
import time
from typing import Any

from curl_cffi import requests

from services.config import config
from services.image_storage_service import image_storage_service

logger = logging.getLogger("third_party_image_download")


def _download_proxies() -> dict[str, str] | None:
    """海外 CDN 下载慢时，可配置代理（config.image_download_proxy）。"""
    proxy = config.image_download_proxy
    if not proxy:
        return None
    return {"http": proxy, "https": proxy}


def _download_image_bytes(url: str, api_key: str = "", timeout: int = 120, retries: int = 1) -> bytes:
    headers = {"Accept": "image/*,*/*;q=0.8", "User-Agent": "chatgpt2api image mirror"}
    # 部分中转站图片 URL 需要携带鉴权头才能访问
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    proxies = _download_proxies()
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True, proxies=proxies)
            if not 200 <= resp.status_code < 300:
                raise RuntimeError(f"download failed: HTTP {resp.status_code}")
            if not resp.content:
                raise RuntimeError("download failed: empty body")
            return resp.content
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < retries:
                time.sleep(1)
    assert last_exc is not None
    raise last_exc


# 单连接下载限速时启用：最多分片数与最小分片大小
MAX_PARALLEL_CHUNKS = 12
MIN_CHUNK_BYTES = 256 * 1024


def _download_image_bytes_parallel(url: str, api_key: str = "", timeout: int = 120, retries: int = 1) -> bytes:
    """多连接 Range 分片并发下载，应对中转 CDN 对单连接限速导致的下载缓慢。

    先用 HEAD 获取总大小，按片并发拉取后合并；任何不支持 Range / HEAD 失败 /
    分片失败的情况都会自动回退到单连接下载，保证兼容性。
    """
    headers = {"Accept": "image/*,*/*;q=0.8", "User-Agent": "chatgpt2api image mirror"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    proxies = _download_proxies()

    try:
        head_resp = requests.head(url, headers=headers, timeout=20, allow_redirects=True, proxies=proxies)
        total = int(head_resp.headers.get("content-length") or 0)
    except Exception:
        total = 0
    if total <= MIN_CHUNK_BYTES:
        # 图片过小或拿不到大小：单连接足够
        return _download_image_bytes(url, api_key, timeout, retries)

    chunk_size = max(MIN_CHUNK_BYTES, total // MAX_PARALLEL_CHUNKS)
    ranges: list[tuple[int, int]] = []
    start = 0
    while start < total:
        end = min(total - 1, start + chunk_size - 1)
        ranges.append((start, end))
        start = end + 1
    if len(ranges) < 2:
        return _download_image_bytes(url, api_key, timeout, retries)

    from concurrent.futures import ThreadPoolExecutor

    def fetch_one(chunk_range: tuple[int, int]) -> tuple[str, bytes | None]:
        chunk_headers = {**headers, "Range": f"bytes={chunk_range[0]}-{chunk_range[1]}"}
        for attempt in range(retries + 1):
            try:
                resp = requests.get(url, headers=chunk_headers, timeout=timeout, allow_redirects=True, proxies=proxies)
                if resp.status_code == 200:
                    # 服务器忽略 Range 返回全量：放弃分片
                    return "full", resp.content
                if resp.status_code == 206:
                    return "partial", resp.content
                raise RuntimeError(f"chunk download failed: HTTP {resp.status_code}")
            except Exception:  # noqa: BLE001
                if attempt < retries:
                    time.sleep(0.5)
        return "error", None

    with ThreadPoolExecutor(max_workers=min(len(ranges), MAX_PARALLEL_CHUNKS)) as pool:
        futures = {pool.submit(fetch_one, chunk_range): chunk_range for chunk_range in ranges}
        parts: dict[int, bytes] = {}
        for future, chunk_range in futures.items():
            kind, content = future.result()
            if kind == "full" and content is not None:
                return content
            if kind != "partial" or content is None:
                # 分片失败：回退单连接
                return _download_image_bytes(url, api_key, timeout, retries)
            parts[chunk_range[0]] = content

    data = b"".join(parts[chunk_range[0]] for chunk_range in ranges)
    if len(data) != total:
        # 合并后长度不符：回退单连接
        return _download_image_bytes(url, api_key, timeout, retries)
    return data


def _mirror_image_item(item: dict[str, Any], base_url: str, api_key: str) -> dict[str, Any]:
    """把单个图片结果项下载到本地，返回替换 url 后的项。

    优先使用 b64_json（无需下载），否则下载 url。
    **本地化失败时抛错**（不返回第三方 URL，保证所有图片 URL 都走本地）。
    """
    next_item = dict(item)
    b64 = str(item.get("b64_json") or "").strip()
    url = str(item.get("url") or "").strip()

    if b64:
        try:
            data = base64.b64decode(b64)
            if data:
                stored = image_storage_service.save(data, base_url=base_url or None)
                next_item["url"] = stored.url
                next_item.pop("b64_json", None)
                next_item["local"] = True
                return next_item
        except Exception as exc:
            logger.warning("mirror b64 failed: %s", exc)

    if url:
        try:
            data = _download_image_bytes_parallel(url, api_key=api_key)
            stored = image_storage_service.save(data, base_url=base_url or None)
            next_item["url"] = stored.url
            next_item["local"] = True
            return next_item
        except Exception as exc:
            raise RuntimeError(f"图片保存到本地失败（{url[:80]}）：{exc}") from exc
    return next_item


def mirror_result_images(result: dict[str, Any], base_url: str, api_key: str = "") -> dict[str, Any]:
    """处理图片生成/编辑结果：把 data 中的 url 替换为本地地址。

    多张图片并发下载；任一图片本地化失败即抛错（调用方应使本次生成失败），
    确保对外只暴露本地图片 URL。
    """
    if not config.image_local_download_enabled:
        return result
    data = result.get("data")
    if not isinstance(data, list):
        return result
    from concurrent.futures import ThreadPoolExecutor

    plain: list[Any] = []
    items: list[dict[str, Any]] = []
    for item in data:
        if isinstance(item, dict):
            items.append(item)
        else:
            plain.append(item)
    next_items: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(items)))) as pool:
        futures = [pool.submit(_mirror_image_item, item, base_url or "", api_key) for item in items]
        for future in futures:
            next_items.append(future.result())  # 任一失败会在此处抛出
    next_result = dict(result)
    next_result["data"] = [*plain, *next_items]
    return next_result
