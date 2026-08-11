from __future__ import annotations

from typing import Any

from curl_cffi import requests

from services.config import config

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def verify_turnstile_token(token: str, remote_ip: str = "") -> dict[str, Any]:
    """调用 Cloudflare Turnstile siteverify 接口校验 token。

    返回 {ok, error}。
    """
    secret_key = str(config.turnstile_settings.get("secret_key") or "").strip()
    token = str(token or "").strip()
    if not config.turnstile_settings.get("enabled"):
        # 未启用 Turnstile 时跳过校验
        return {"ok": True, "skipped": True}
    if not secret_key:
        return {"ok": False, "error": "Turnstile Secret Key 未配置"}
    if not token:
        return {"ok": False, "error": "请完成人机验证"}
    payload: dict[str, Any] = {
        "secret": secret_key,
        "response": token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip
    try:
        resp = requests.post(SITEVERIFY_URL, data=payload, timeout=15)
        data = resp.json()
    except Exception as exc:
        return {"ok": False, "error": f"验证服务异常：{exc}"}
    if data.get("success"):
        return {"ok": True}
    error_codes = data.get("error-codes") or []
    return {"ok": False, "error": f"人机验证失败（{', '.join(str(c) for c in error_codes)}）"}
