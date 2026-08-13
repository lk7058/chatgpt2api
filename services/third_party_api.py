from __future__ import annotations

import json
from typing import Any, Iterator

from curl_cffi import requests

from services.config import config


def _match_models(item: dict[str, Any], model: str) -> bool:
    """判断模型是否匹配第三方 API 的 models 列表（支持前缀匹配）。"""
    models = item.get("models")
    if not isinstance(models, list) or not models:
        return False
    requested = str(model or "").strip()
    if not requested:
        return False
    for candidate in models:
        candidate = str(candidate or "").strip()
        if not candidate:
            continue
        if requested == candidate or requested.startswith(candidate):
            return True
    return False


def route_for_model(model: str) -> dict[str, Any] | None:
    """按模型找到启用的第三方 API。未匹配返回 None（走账号模式）。"""
    requested = str(model or "").strip()
    for item in config.third_party_apis:
        if not item.get("enabled"):
            continue
        if _match_models(item, requested):
            return item
    return None


def default_route() -> dict[str, Any] | None:
    """默认第三方 API（模型自动/未匹配时兜底）。"""
    for item in config.third_party_apis:
        if item.get("enabled") and item.get("default"):
            return item
    return None


def list_third_party_models() -> list[str]:
    """收集所有启用的第三方 API 配置的模型列表（用于 /v1/models 合并）。"""
    models: list[str] = []
    seen: set[str] = set()
    for item in config.third_party_apis:
        if not item.get("enabled"):
            continue
        for model in item.get("models") or []:
            model = str(model or "").strip()
            if model and model not in seen:
                seen.add(model)
                models.append(model)
    return models


def _endpoint(base_url: str, path: str = "/v1/chat/completions") -> str:
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("base_url 不能为空")
    # 兼容两种填写习惯：https://api.example.com/v1 或 https://api.example.com
    # 若 base 已含 /v1，则不再重复拼接
    if path.startswith("/v1") and base.endswith("/v1"):
        base = base[:-3].rstrip("/")
    return f"{base}{path}"


def _headers(item: dict[str, Any]) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    api_key = str(item.get("api_key") or "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _third_party_error_message(status_code: int, data: dict[str, Any]) -> str:
    """从第三方错误响应提取简短脱敏消息（不原样回显上游响应体）。"""
    try:
        raw = data.get("error", {})
        message = str(raw.get("message") or "") if isinstance(raw, dict) else ""
    except Exception:
        message = ""
    if not message:
        message = f"HTTP {status_code}"
    return f"第三方 API 错误（HTTP {status_code}）：{message[:200]}"


def chat_completion(item: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """非流式转发 chat/completions 到第三方 API。"""
    url = _endpoint(str(item.get("base_url") or ""), "/v1/chat/completions")
    payload = dict(body)
    payload["stream"] = False
    resp = requests.post(url, headers=_headers(item), json=payload, timeout=300)
    try:
        data = resp.json()
    except Exception:
        data = {"error": {"message": resp.text[:500] or f"HTTP {resp.status_code}"}}
    if resp.status_code >= 400:
        raise RuntimeError(_third_party_error_message(resp.status_code, data))
    return data


def image_generation(item: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """转发 images/generations 到第三方 API（OpenAI 兼容）。"""
    url = _endpoint(str(item.get("base_url") or ""), "/v1/images/generations")
    payload = dict(body)
    payload.pop("base_url", None)
    payload.pop("progress_callback", None)
    payload["n"] = max(1, int(payload.get("n") or 1))

    def _post(current: dict[str, Any]):
        resp = requests.post(url, headers=_headers(item), json=current, timeout=600)
        try:
            data = resp.json()
        except Exception:
            data = {"error": {"message": resp.text[:500] or f"HTTP {resp.status_code}"}}
        return resp.status_code, data

    status, data = _post(payload)
    if status >= 400 and payload.get("response_format") == "b64_json":
        # 上游不支持 b64_json：回退 url 重试一次（避免直接失败）
        payload["response_format"] = "url"
        status, data = _post(payload)
    if status >= 400:
        raise RuntimeError(_third_party_error_message(status, data))
    return data


def image_edit(item: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """转发 images/edits 到第三方 API（OpenAI 兼容，multipart/form-data）。

    图片数据是 (bytes, filename, mime_type) 元组，按 multipart 上传。
    """
    from curl_cffi import CurlMime

    url = _endpoint(str(item.get("base_url") or ""), "/v1/images/edits")
    payload = dict(body)
    payload.pop("base_url", None)
    payload.pop("progress_callback", None)
    images = payload.pop("images", None) or []
    masks = payload.pop("mask", None) or []

    mime = CurlMime()
    for data, filename, mime_type in images:
        mime.addpart(
            "image",
            filename=str(filename or "image.png"),
            content_type=str(mime_type or "image/png"),
            data=data,
        )
    for data, filename, mime_type in masks:
        mime.addpart(
            "mask",
            filename=str(filename or "mask.png"),
            content_type=str(mime_type or "image/png"),
            data=data,
        )

    form_data: dict[str, Any] = {
        "prompt": str(payload.get("prompt") or ""),
        "model": str(payload.get("model") or "gpt-image-2"),
        "n": str(max(1, int(payload.get("n") or 1))),
    }
    if payload.get("size"):
        form_data["size"] = str(payload["size"])
    if payload.get("quality"):
        form_data["quality"] = str(payload["quality"])
    if payload.get("response_format"):
        form_data["response_format"] = str(payload["response_format"])

    headers = _headers(item)
    headers.pop("Content-Type", None)  # multipart 由 requests 自动设置

    def _post(current: dict[str, Any]):
        resp = requests.post(url, headers=headers, data=current, multipart=mime, timeout=600)
        try:
            data = resp.json()
        except Exception:
            data = {"error": {"message": resp.text[:500] or f"HTTP {resp.status_code}"}}
        return resp.status_code, data

    status, data = _post(form_data)
    if status >= 400 and form_data.get("response_format") == "b64_json":
        # 上游不支持 b64_json：回退 url 重试一次
        form_data["response_format"] = "url"
        status, data = _post(form_data)
    if status >= 400:
        raise RuntimeError(_third_party_error_message(status, data))
    return data


def chat_completion_stream(item: dict[str, Any], body: dict[str, Any]) -> Iterator[str]:
    """流式转发 chat/completions 到第三方 API，产出 SSE 行。"""
    url = _endpoint(str(item.get("base_url") or ""), "/v1/chat/completions")
    payload = dict(body)
    payload["stream"] = True
    with requests.post(url, headers=_headers(item), json=payload, stream=True, timeout=300) as resp:
        if resp.status_code >= 400:
            try:
                data = resp.json()
                message = json.dumps(data, ensure_ascii=False)[:500]
            except Exception:
                message = resp.text[:500] or f"HTTP {resp.status_code}"
            raise RuntimeError(f"第三方 API 错误（HTTP {resp.status_code}）：{message}")
        for line in resp.iter_lines():
            if not line:
                continue
            try:
                text = line.decode("utf-8", errors="replace")
            except AttributeError:
                text = str(line)
            yield text


def test_connection(item: dict[str, Any]) -> dict[str, Any]:
    """测试第三方 API 连通性（GET /v1/models）。"""
    base_url = str(item.get("base_url") or "").strip()
    if not base_url:
        return {"ok": False, "error": "base_url 不能为空"}
    url = _endpoint(base_url, "/v1/models")
    try:
        resp = requests.get(url, headers=_headers(item), timeout=15)
    except Exception as exc:
        return {"ok": False, "error": f"连接失败：{exc}"}
    if resp.status_code >= 400:
        return {"ok": False, "status": resp.status_code, "error": f"HTTP {resp.status_code}"}
    return {"ok": True, "status": resp.status_code}


def list_models(item: dict[str, Any]) -> dict[str, Any]:
    """获取第三方 API 的可用模型列表（GET /v1/models），用于前端勾选。

    返回 {ok, models: [id,...], status} 或 {ok: False, error}。
    """
    base_url = str(item.get("base_url") or "").strip()
    if not base_url:
        return {"ok": False, "error": "base_url 不能为空"}
    url = _endpoint(base_url, "/v1/models")
    try:
        resp = requests.get(url, headers=_headers(item), timeout=30)
    except Exception as exc:
        return {"ok": False, "error": f"获取模型失败：{exc}"}
    if resp.status_code >= 400:
        return {"ok": False, "status": resp.status_code, "error": f"HTTP {resp.status_code}"}
    try:
        data = resp.json()
    except Exception:
        return {"ok": False, "error": "响应不是合法 JSON，可能不是 OpenAI 兼容接口"}
    raw_items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(raw_items, list):
        return {"ok": False, "error": "响应缺少 data 模型列表，可能不是 OpenAI 兼容接口"}
    models: list[str] = []
    seen: set[str] = set()
    for model in raw_items:
        if not isinstance(model, dict):
            continue
        model_id = str(model.get("id") or "").strip()
        if model_id and model_id not in seen:
            seen.add(model_id)
            models.append(model_id)
    models.sort()
    return {"ok": True, "models": models, "status": resp.status_code}
