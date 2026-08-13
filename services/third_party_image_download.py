from __future__ import annotations

import base64
import logging
import time
from typing import Any

from curl_cffi import requests

from services.config import config
from services.image_storage_service import image_storage_service

logger = logging.getLogger("third_party_image_download")


def _download_image_bytes(url: str, api_key: str = "", timeout: int = 120, retries: int = 1) -> bytes:
    headers = {"Accept": "image/*,*/*;q=0.8", "User-Agent": "chatgpt2api image mirror"}
    # 部分中转站图片 URL 需要携带鉴权头才能访问
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
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


def _mirror_image_item(item: dict[str, Any], base_url: str, api_key: str) -> dict[str, Any]:
    """把单个图片结果项下载到本地，返回替换 url 后的项。

    优先使用 b64_json（无需下载），否则下载 url。
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
            data = _download_image_bytes(url, api_key=api_key)
            stored = image_storage_service.save(data, base_url=base_url or None)
            next_item["url"] = stored.url
            next_item["local"] = True
            return next_item
        except Exception as exc:
            # 下载失败保留源地址，不阻断流程（同时记录便于排查）
            logger.warning("mirror url failed (%s): %s", url[:80], exc)
    return next_item


def mirror_result_images(result: dict[str, Any], base_url: str, api_key: str = "") -> dict[str, Any]:
    """处理图片生成/编辑结果：若开启本地下载，把 data 中的 url 替换为本地地址。

    返回处理后的结果。若全部下载失败则保留原 URL（避免阻断生成流程）。
    """
    if not config.image_local_download_enabled:
        return result
    data = result.get("data")
    if not isinstance(data, list):
        return result
    mirrored = False
    next_data: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            next_data.append(item)
            continue
        next_item = _mirror_image_item(item, base_url or "", api_key)
        if next_item.get("local"):
            mirrored = True
        next_data.append(next_item)
    if not mirrored:
        return result
    next_result = dict(result)
    next_result["data"] = next_data
    return next_result
