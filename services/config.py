from __future__ import annotations

import copy
from dataclasses import dataclass
import json
import os
import sys
import uuid
from pathlib import Path
import time

from services.storage.base import StorageBackend

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = BASE_DIR / "config.json"
VERSION_FILE = BASE_DIR / "VERSION"
BACKUP_STATE_FILE = DATA_DIR / "backup_state.json"

DEFAULT_BACKUP_INCLUDE = {
    "config": True,
    "cpa": True,
    "sub2api": True,
    "logs": True,
    "image_tasks": True,
    "accounts_snapshot": True,
    "auth_keys_snapshot": True,
    "images": False,
}

DEFAULT_IMAGE_STORAGE = {
    "enabled": False,
    "mode": "local",
    "webdav_url": "",
    "webdav_username": "",
    "webdav_password": "",
    "webdav_root_path": "chatgpt2api/images",
    "public_base_url": "",
}

DEFAULT_CHAT_COMPLETION_CACHE = {
    "enabled": True,
    "ttl_seconds": 60,
    "max_entries": 256,
    "dedupe_inflight": True,
    "stream_cache": True,
    "normalize_messages": True,
    "drop_adjacent_duplicates": True,
    "drop_assistant_history": False,
}

DEFAULT_PROXY_RUNTIME_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/145.0.0.0 Safari/537.36"
)

DEFAULT_PROXY_RUNTIME = {
    "enabled": False,
    "egress_mode": "direct",
    "proxy_url": "",
    "resource_proxy_url": "",
    "skip_ssl_verify": False,
    "reset_session_status_codes": [403],
    "clearance": {
        "enabled": False,
        "mode": "none",
        "cf_cookies": "",
        "cf_clearance": "",
        "user_agent": DEFAULT_PROXY_RUNTIME_USER_AGENT,
        "browser": "chrome",
        "flaresolverr_url": "",
        "timeout_sec": 60,
        "refresh_interval": 3600,
        "warm_up_on_start": False,
    },
}

DEFAULT_THIRD_PARTY_APPS = {
    "infinite_canvas": {
        "enabled": False,
        "url": "https://canvas.best",
    },
}


def _normalize_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
        return default
    if value is None:
        return default
    return bool(value)


def _normalize_positive_int(value: object, default: int, minimum: int = 0) -> int:
    try:
        normalized = int(value)
    except (OverflowError, TypeError, ValueError):
        normalized = default
    return max(minimum, normalized)


def _normalize_streak_bonuses(value: object) -> list[dict[str, int]]:
    """归一化连续签到奖励档位：[{days, bonus}]，按 days 升序、去重、过滤非法项。"""
    if not isinstance(value, list):
        return []
    items: list[dict[str, int]] = []
    seen: set[int] = set()
    for raw in value:
        if not isinstance(raw, dict):
            continue
        try:
            days = int(raw.get("days"))
            bonus = int(raw.get("bonus"))
        except (OverflowError, TypeError, ValueError):
            continue
        if days < 1 or bonus < 1 or days in seen:
            continue
        seen.add(days)
        items.append({"days": days, "bonus": bonus})
    items.sort(key=lambda item: item["days"])
    return items


def _normalize_backup_include(value: object) -> dict[str, bool]:
    source = value if isinstance(value, dict) else {}
    normalized = dict(DEFAULT_BACKUP_INCLUDE)
    for key in normalized:
        normalized[key] = _normalize_bool(source.get(key), normalized[key])
    return normalized


def _normalize_backup_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), False),
        "provider": "cloudflare_r2",
        "account_id": str(source.get("account_id") or "").strip(),
        "access_key_id": str(source.get("access_key_id") or "").strip(),
        "secret_access_key": str(source.get("secret_access_key") or "").strip(),
        "bucket": str(source.get("bucket") or "").strip(),
        "prefix": str(source.get("prefix") or "backups").strip().strip("/") or "backups",
        "interval_minutes": _normalize_positive_int(source.get("interval_minutes"), 360, 1),
        "rotation_keep": _normalize_positive_int(source.get("rotation_keep"), 10, 0),
        "encrypt": _normalize_bool(source.get("encrypt"), False),
        "passphrase": str(source.get("passphrase") or "").strip(),
        "include": _normalize_backup_include(source.get("include")),
    }


def _normalize_backup_state(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "last_started_at": str(source.get("last_started_at") or "").strip() or None,
        "last_finished_at": str(source.get("last_finished_at") or "").strip() or None,
        "last_status": str(source.get("last_status") or "idle").strip() or "idle",
        "last_error": str(source.get("last_error") or "").strip() or None,
        "last_object_key": str(source.get("last_object_key") or "").strip() or None,
    }


def _normalize_image_storage_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    mode = str(source.get("mode") or "local").strip().lower()
    if mode not in {"local", "webdav", "both"}:
        mode = "local"
    enabled = _normalize_bool(source.get("enabled"), False)
    if not enabled:
        mode = "local"
    root_path = str(source.get("webdav_root_path") or DEFAULT_IMAGE_STORAGE["webdav_root_path"]).strip().strip("/")
    return {
        "enabled": enabled,
        "mode": mode,
        "webdav_url": str(source.get("webdav_url") or "").strip().rstrip("/"),
        "webdav_username": str(source.get("webdav_username") or "").strip(),
        "webdav_password": str(source.get("webdav_password") or "").strip(),
        "webdav_root_path": root_path or str(DEFAULT_IMAGE_STORAGE["webdav_root_path"]),
        "public_base_url": str(source.get("public_base_url") or "").strip().rstrip("/"),
    }


def _normalize_chat_completion_cache_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), DEFAULT_CHAT_COMPLETION_CACHE["enabled"]),
        "ttl_seconds": _normalize_positive_int(
            source.get("ttl_seconds"),
            int(DEFAULT_CHAT_COMPLETION_CACHE["ttl_seconds"]),
            0,
        ),
        "max_entries": _normalize_positive_int(
            source.get("max_entries"),
            int(DEFAULT_CHAT_COMPLETION_CACHE["max_entries"]),
            1,
        ),
        "dedupe_inflight": _normalize_bool(
            source.get("dedupe_inflight"),
            bool(DEFAULT_CHAT_COMPLETION_CACHE["dedupe_inflight"]),
        ),
        "stream_cache": _normalize_bool(
            source.get("stream_cache"),
            bool(DEFAULT_CHAT_COMPLETION_CACHE["stream_cache"]),
        ),
        "normalize_messages": _normalize_bool(
            source.get("normalize_messages"),
            bool(DEFAULT_CHAT_COMPLETION_CACHE["normalize_messages"]),
        ),
        "drop_adjacent_duplicates": _normalize_bool(
            source.get("drop_adjacent_duplicates"),
            bool(DEFAULT_CHAT_COMPLETION_CACHE["drop_adjacent_duplicates"]),
        ),
        "drop_assistant_history": _normalize_bool(
            source.get("drop_assistant_history"),
            bool(DEFAULT_CHAT_COMPLETION_CACHE["drop_assistant_history"]),
        ),
    }


def _normalize_status_codes(value: object) -> list[int]:
    items = value if isinstance(value, list) else DEFAULT_PROXY_RUNTIME["reset_session_status_codes"]
    normalized: list[int] = []
    for item in items:
        if isinstance(item, bool):
            continue
        try:
            status = int(item)
        except (OverflowError, TypeError, ValueError):
            continue
        if 100 <= status <= 599 and status not in normalized:
            normalized.append(status)
    if not normalized:
        return list(DEFAULT_PROXY_RUNTIME["reset_session_status_codes"])
    return normalized


def _normalize_proxy_runtime_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    default_clearance = DEFAULT_PROXY_RUNTIME["clearance"]
    clearance_source = source.get("clearance") if isinstance(source.get("clearance"), dict) else {}

    egress_mode = str(source.get("egress_mode") or DEFAULT_PROXY_RUNTIME["egress_mode"]).strip().lower()
    if egress_mode not in {"direct", "single_proxy"}:
        egress_mode = str(DEFAULT_PROXY_RUNTIME["egress_mode"])

    clearance_mode = str(clearance_source.get("mode") or default_clearance["mode"]).strip().lower()
    if clearance_mode not in {"none", "manual", "flaresolverr"}:
        clearance_mode = str(default_clearance["mode"])

    user_agent = str(clearance_source.get("user_agent") or default_clearance["user_agent"]).strip()
    browser = str(clearance_source.get("browser") or default_clearance["browser"]).strip()

    existing_clearance_cookies = str(source.get("_existing_cf_cookies") or "").strip()
    existing_cf_clearance = str(source.get("_existing_cf_clearance") or "").strip()
    cf_cookies = str(clearance_source.get("cf_cookies") or "").strip()
    cf_clearance = str(clearance_source.get("cf_clearance") or "").strip()
    if not cf_cookies and _normalize_bool(clearance_source.get("has_cf_cookies"), False):
        cf_cookies = existing_clearance_cookies
    if not cf_clearance and _normalize_bool(clearance_source.get("has_cf_clearance"), False):
        cf_clearance = existing_cf_clearance

    return {
        "enabled": _normalize_bool(source.get("enabled"), bool(DEFAULT_PROXY_RUNTIME["enabled"])),
        "egress_mode": egress_mode,
        "proxy_url": str(source.get("proxy_url") or "").strip(),
        "resource_proxy_url": str(source.get("resource_proxy_url") or "").strip(),
        "skip_ssl_verify": _normalize_bool(
            source.get("skip_ssl_verify"),
            bool(DEFAULT_PROXY_RUNTIME["skip_ssl_verify"]),
        ),
        "reset_session_status_codes": _normalize_status_codes(source.get("reset_session_status_codes")),
        "clearance": {
            "enabled": _normalize_bool(clearance_source.get("enabled"), bool(default_clearance["enabled"])),
            "mode": clearance_mode,
            "cf_cookies": cf_cookies,
            "cf_clearance": cf_clearance,
            "user_agent": user_agent or str(default_clearance["user_agent"]),
            "browser": browser or str(default_clearance["browser"]),
            "flaresolverr_url": str(clearance_source.get("flaresolverr_url") or "").strip(),
            "timeout_sec": _normalize_positive_int(
                clearance_source.get("timeout_sec"),
                int(default_clearance["timeout_sec"]),
                1,
            ),
            "refresh_interval": _normalize_positive_int(
                clearance_source.get("refresh_interval"),
                int(default_clearance["refresh_interval"]),
                60,
            ),
            "warm_up_on_start": _normalize_bool(
                clearance_source.get("warm_up_on_start"),
                bool(default_clearance["warm_up_on_start"]),
            ),
        },
    }


def _normalize_third_party_apps_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    canvas_source = source.get("infinite_canvas") if isinstance(source.get("infinite_canvas"), dict) else {}
    return {
        "infinite_canvas": {
            "enabled": _normalize_bool(canvas_source.get("enabled"), False),
            "url": str(canvas_source.get("url") or DEFAULT_THIRD_PARTY_APPS["infinite_canvas"]["url"]).strip(),
        },
    }


DEFAULT_MODEL_QUOTA_WEIGHTS = {
    "default": 1,
    "gpt-5": 2,
    "gpt-5.1": 2,
    "gpt-5-5": 2,
    "gpt-image-2": 2,
    "gpt-4o": 1,
}


def _normalize_model_quota_weights(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    normalized: dict[str, object] = {}
    for key, item in source.items():
        key = str(key or "").strip()
        if not key:
            continue
        try:
            weight = int(item)
        except (TypeError, ValueError):
            weight = 1
        normalized[key] = max(1, weight)
    if "default" not in normalized:
        normalized["default"] = 1
    return normalized


def _normalize_third_party_api_item(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    name = str(value.get("name") or "").strip()
    base_url = str(value.get("base_url") or "").strip()
    if not name or not base_url:
        return None
    api_key = str(value.get("api_key") or "").strip()
    models = value.get("models")
    if isinstance(models, list):
        models = [str(item or "").strip() for item in models if str(item or "").strip()]
    else:
        models = []
    return {
        "id": str(value.get("id") or "").strip() or uuid.uuid4().hex[:8],
        "name": name,
        "base_url": base_url,
        "api_key": api_key,
        "models": models,
        "enabled": _normalize_bool(value.get("enabled"), True),
        "default": _normalize_bool(value.get("default"), False),
        "created_at": str(value.get("created_at") or "").strip(),
    }


# ── 第三方 API 密钥独立存储 ──────────────────────────────────
# Key 单独保存在 data/third_party_keys.json，config.json 只存脱敏配置，
# 避免 config.json 被整体覆盖/替换时丢失密钥。

THIRD_PARTY_KEYS_FILE = DATA_DIR / "third_party_keys.json"


def _load_third_party_keys() -> dict[str, str]:
    try:
        data = json.loads(THIRD_PARTY_KEYS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(key): str(value or "").strip() for key, value in data.items()}


def _save_third_party_keys(keys: dict[str, str]) -> None:
    THIRD_PARTY_KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    THIRD_PARTY_KEYS_FILE.write_text(
        json.dumps(keys, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def get_third_party_api_key(api_id: str) -> str:
    return _load_third_party_keys().get(str(api_id or ""), "")


def set_third_party_api_key(api_id: str, api_key: str) -> None:
    api_id = str(api_id or "").strip()
    if not api_id:
        return
    keys = _load_third_party_keys()
    api_key = str(api_key or "").strip()
    if api_key:
        keys[api_id] = api_key
    else:
        keys.pop(api_id, None)
    _save_third_party_keys(keys)


def _normalize_third_party_apis(value: object) -> list[dict[str, object]]:
    source = value if isinstance(value, list) else []
    return [
        item
        for raw in source
        if (item := _normalize_third_party_api_item(raw)) is not None
    ]


def _normalize_admin_account(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "username": str(source.get("username") or "").strip(),
        "password": str(source.get("password") or "").strip(),
        "email": str(source.get("email") or "").strip().lower(),
    }


def _normalize_registration(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), False),
    }


DEFAULT_SMTP = {
    "enabled": False,
    "host": "",
    "port": 465,
    "username": "",
    "password": "",
    "from": "",
    "from_name": "chatgpt2api",
    "use_ssl": True,
}


DEFAULT_TURNSTILE = {
    "enabled": False,
    "site_key": "",
    "secret_key": "",
}


def _normalize_turnstile(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), False),
        "site_key": str(source.get("site_key") or "").strip(),
        "secret_key": str(source.get("secret_key") or "").strip(),
    }


def _normalize_smtp(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), False),
        "host": str(source.get("host") or "").strip(),
        "port": _normalize_positive_int(source.get("port"), 465, 1),
        "username": str(source.get("username") or "").strip(),
        "password": str(source.get("password") or "").strip(),
        "from": str(source.get("from") or "").strip(),
        "from_name": str(source.get("from_name") or "chatgpt2api").strip(),
        "use_ssl": _normalize_bool(source.get("use_ssl"), True),
    }


def _validate_image_storage_settings(settings: dict[str, object]) -> None:
    if not _normalize_bool(settings.get("enabled"), False):
        return
    if not str(settings.get("webdav_url") or "").strip():
        raise ValueError("启用 WebDAV 图片存储后必须填写 WebDAV URL")
    if not str(settings.get("webdav_password") or "").strip():
        raise ValueError("启用 WebDAV 图片存储后必须填写 WebDAV 密码")


@dataclass(frozen=True)
class LoadedSettings:
    auth_key: str
    refresh_account_interval_minute: int


def _normalize_auth_key(value: object) -> str:
    return str(value or "").strip()


def _is_invalid_auth_key(value: object) -> bool:
    return _normalize_auth_key(value) == ""


def _read_json_object(path: Path, *, name: str) -> dict[str, object]:
    if not path.exists():
        return {}
    if path.is_dir():
        print(
            f"Warning: {name} at '{path}' is a directory, ignoring it and falling back to other configuration sources.",
            file=sys.stderr,
        )
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _load_settings() -> LoadedSettings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    raw_config = _read_json_object(CONFIG_FILE, name="config.json")
    auth_key = _normalize_auth_key(os.getenv("CHATGPT2API_AUTH_KEY") or raw_config.get("auth-key"))
    if _is_invalid_auth_key(auth_key):
        raise ValueError(
            "❌ auth-key 未设置！\n"
            "请在环境变量 CHATGPT2API_AUTH_KEY 中设置，或者在 config.json 中填写 auth-key。"
        )

    try:
        refresh_interval = int(raw_config.get("refresh_account_interval_minute", 5))
    except (TypeError, ValueError):
        refresh_interval = 5

    return LoadedSettings(
        auth_key=auth_key,
        refresh_account_interval_minute=refresh_interval,
    )


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.data = self._load()
        self._storage_backend: StorageBackend | None = None
        if _is_invalid_auth_key(self.auth_key):
            raise ValueError(
                "❌ auth-key 未设置！\n"
                "请按以下任意一种方式解决：\n"
                "1. 在 Render 的 Environment 变量中添加：\n"
                "   CHATGPT2API_AUTH_KEY = your_real_auth_key\n"
                "2. 或者在 config.json 中填写：\n"
                '   "auth-key": "your_real_auth_key"'
            )

    def _load(self) -> dict[str, object]:
        return _read_json_object(self.path, name="config.json")

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @property
    def auth_key(self) -> str:
        return _normalize_auth_key(os.getenv("CHATGPT2API_AUTH_KEY") or self.data.get("auth-key"))

    @property
    def accounts_file(self) -> Path:
        return DATA_DIR / "accounts.json"

    @property
    def refresh_account_interval_minute(self) -> int:
        try:
            return int(self.data.get("refresh_account_interval_minute", 5))
        except (TypeError, ValueError):
            return 5

    @property
    def image_retention_days(self) -> int:
        try:
            return max(1, int(self.data.get("image_retention_days", 30)))
        except (TypeError, ValueError):
            return 30

    @property
    def image_local_download_enabled(self) -> bool:
        """第三方图片生成成功后，是否下载到本地服务器再展示（避免暴露源站地址）。"""
        value = self.data.get("image_local_download_enabled", True)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def image_prefer_b64_json(self) -> bool:
        """生成时优先请求 response_format=b64_json（图片随响应返回，避免海外 CDN 下载慢）。"""
        value = self.data.get("image_prefer_b64_json", True)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def image_download_proxy(self) -> str:
        """图片镜像下载代理（海外 CDN 慢时可配置 http://host:port）。"""
        return str(self.data.get("image_download_proxy") or "").strip()

    @property
    def image_local_retention_days(self) -> int:
        """下载到本地的第三方图片保留天数，到期自动删除。"""
        try:
            return max(1, int(self.data.get("image_local_retention_days", 7)))
        except (TypeError, ValueError):
            return 7

    @property
    def image_poll_timeout_secs(self) -> int:
        try:
            return max(1, int(self.data.get("image_poll_timeout_secs", 120)))
        except (TypeError, ValueError):
            return 120

    @property
    def image_poll_interval_secs(self) -> float:
        try:
            return max(0.5, float(self.data.get("image_poll_interval_secs", 10.0)))
        except (TypeError, ValueError):
            return 10.0

    @property
    def image_poll_initial_wait_secs(self) -> float:
        """Image generation upstream takes ~30s; polling immediately wastes requests
        and trips a transient 429. Default 10s gives the conversation document time
        to commit before the first poll."""
        try:
            return max(0.0, float(self.data.get("image_poll_initial_wait_secs", 10.0)))
        except (TypeError, ValueError):
            return 10.0

    @property
    def image_account_concurrency(self) -> int:
        try:
            return max(1, int(self.data.get("image_account_concurrency", 3)))
        except (TypeError, ValueError):
            return 3

    @property
    def image_parallel_generation(self) -> bool:
        value = self.data.get("image_parallel_generation", True)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def image_settle_enabled(self) -> bool:
        """图片二次确认机制：找到 file_ids 后等待一段时间再次确认。"""
        value = self.data.get("image_settle_enabled", True)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def image_check_before_hit_enabled(self) -> bool:
        """先check再hit：通过轮询确认 file_ids 存在后再返回，而非仅依赖 SSE 事件。"""
        value = self.data.get("image_check_before_hit_enabled", True)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def image_remove_conversation_after_result(self) -> bool:
        """出图成功后异步隐藏 ChatGPT 本地对话记录。"""
        value = self.data.get("image_remove_conversation_after_result", False)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def image_remove_conversation_always(self) -> bool:
        """无论是否出图，画图请求结束后都异步隐藏 ChatGPT 本地对话记录。"""
        return _normalize_bool(self.data.get("image_remove_conversation_always"), False)

    @property
    def image_settle_secs(self) -> float:
        """二次确认等待时间（秒）。"""
        try:
            return max(0.5, float(self.data.get("image_settle_secs", 2.0)))
        except (TypeError, ValueError):
            return 2.0

    @property
    def auto_remove_invalid_accounts(self) -> bool:
        value = self.data.get("auto_remove_invalid_accounts", False)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def auto_remove_rate_limited_accounts(self) -> bool:
        value = self.data.get("auto_remove_rate_limited_accounts", False)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def auto_relogin_after_refresh(self) -> bool:
        value = self.data.get("auto_relogin_after_refresh", False)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def log_levels(self) -> list[str]:
        levels = self.data.get("log_levels")
        if not isinstance(levels, list):
            return []
        allowed = {"debug", "info", "warning", "error"}
        return [level for item in levels if (level := str(item or "").strip().lower()) in allowed]

    @property
    def sensitive_words(self) -> list[str]:
        words = self.data.get("sensitive_words")
        return [word for item in words if (word := str(item or "").strip())] if isinstance(words, list) else []

    @property
    def ai_review(self) -> dict[str, object]:
        value = self.data.get("ai_review")
        return value if isinstance(value, dict) else {}

    @property
    def global_system_prompt(self) -> str:
        return str(self.data.get("global_system_prompt") or "").strip()

    @property
    def default_upstream_model_name(self) -> str:
        return str(self.data.get("default_upstream_model_name") or "gpt-5-5").strip()

    @property
    def default_thinking_effort(self) -> str:
        value = str(self.data.get("default_thinking_effort") or "auto").strip().lower()
        return value if value in {"auto", "standard", "extended", "max"} else "auto"

    @property
    def images_dir(self) -> Path:
        path = DATA_DIR / "images"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def image_thumbnails_dir(self) -> Path:
        path = DATA_DIR / "image_thumbnails"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def cleanup_old_images(self) -> int:
        # 本地图片保留天数：优先使用第三方镜像保留配置（默认 7 天）
        retention_days = self.image_local_retention_days if self.image_local_download_enabled else self.image_retention_days
        cutoff = time.time() - retention_days * 86400
        removed = 0
        for path in self.images_dir.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        for path in sorted((p for p in self.images_dir.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            try:
                path.rmdir()
            except OSError:
                pass
        return removed

    @property
    def base_url(self) -> str:
        return str(
            os.getenv("CHATGPT2API_BASE_URL")
            or self.data.get("base_url")
            or ""
        ).strip().rstrip("/")

    @property
    def app_version(self) -> str:
        try:
            value = VERSION_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return "0.0.0"
        return value or "0.0.0"

    @property
    def admin_account(self) -> dict[str, str]:
        normalized = _normalize_admin_account(self.data.get("admin_account"))
        return {
            "username": str(normalized.get("username") or ""),
            "password": str(normalized.get("password") or ""),
            "email": str(normalized.get("email") or ""),
        }

    @property
    def registration_enabled(self) -> bool:
        return _normalize_bool(self.data.get("registration_enabled"), False)

    @property
    def registration_bonus_quota(self) -> int:
        """新用户注册时赠送的额度（0 表示不赠送）。"""
        return _normalize_positive_int(self.data.get("registration_bonus_quota"), 0)

    @property
    def site_title(self) -> str:
        """网站标题（浏览器标签页显示）。"""
        value = str(self.data.get("site_title") or "").strip()
        return value or "chatgpt2api"

    @property
    def allowed_email_domains(self) -> list[str]:
        """允许注册的邮箱域名白名单（空列表=不限）。例如 ["ice11.cn", "gmail.com"]。"""
        raw = self.data.get("allowed_email_domains")
        if isinstance(raw, str):
            raw = [part.strip() for part in raw.replace("，", ",").split(",") if part.strip()]
        if not isinstance(raw, list):
            return []
        domains: list[str] = []
        for item in raw:
            value = str(item or "").strip().lower().lstrip("@")
            if value:
                domains.append(value)
        return domains

    @property
    def smtp_settings(self) -> dict[str, object]:
        return _normalize_smtp(self.data.get("smtp"))

    @property
    def turnstile_settings(self) -> dict[str, object]:
        return _normalize_turnstile(self.data.get("turnstile"))

    def get_public_turnstile_settings(self) -> dict[str, object]:
        settings = self.turnstile_settings
        secret_key = str(settings.get("secret_key") or "")
        public = dict(settings)
        public["secret_key"] = ""
        public["has_secret_key"] = bool(secret_key)
        return public

    def get_public_smtp_settings(self) -> dict[str, object]:
        settings = self.smtp_settings
        password = str(settings.get("password") or "")
        public = dict(settings)
        public["password"] = ""
        public["has_password"] = bool(password)
        return public

    @property
    def checkin_bonus_quota(self) -> int:
        """用户每日签到赠送的额度（0 表示不赠送）。"""
        return _normalize_positive_int(self.data.get("checkin_bonus_quota"), 0)

    @property
    def checkin_streak_bonuses(self) -> list[dict[str, int]]:
        """连续签到奖励档位：连续签到满 days 天时额外奖励 bonus 额度。"""
        return _normalize_streak_bonuses(self.data.get("checkin_streak_bonuses"))

    @property
    def model_quota_weights(self) -> dict[str, object]:
        return _normalize_model_quota_weights(self.data.get("model_quota_weights"))

    @property
    def third_party_apis(self) -> list[dict[str, object]]:
        items = _normalize_third_party_apis(self.data.get("third_party_apis"))
        keys = _load_third_party_keys()
        result: list[dict[str, object]] = []
        for item in items:
            api_id = str(item.get("id") or "")
            stored_key = keys.get(api_id, "")
            # 兼容迁移：config.json 内旧 key 首次迁移到独立存储
            old_key = str(item.get("api_key") or "").strip()
            if stored_key:
                effective_key = stored_key
            elif old_key:
                effective_key = old_key
                keys[api_id] = old_key
                _save_third_party_keys(keys)
            else:
                effective_key = ""
            next_item = dict(item)
            next_item["api_key"] = effective_key
            result.append(next_item)
        return result

    def get_third_party_apis_settings(self) -> list[dict[str, object]]:
        """对外暴露第三方 API 配置（隐藏 api_key，仅保留 has_api_key）。"""
        items = self.third_party_apis
        result: list[dict[str, object]] = []
        for item in items:
            api_key = str(item.get("api_key") or "")
            result.append({
                "id": item.get("id"),
                "name": item.get("name"),
                "base_url": item.get("base_url"),
                "has_api_key": bool(api_key),
                "models": item.get("models"),
                "enabled": item.get("enabled"),
                "default": item.get("default"),
                "created_at": item.get("created_at"),
            })
        return result

    def get_model_quota_weight(self, model: str) -> int:
        """根据模型名获取额度权重（支持前缀匹配）。"""
        weights = self.model_quota_weights
        requested = str(model or "").strip().lower()
        if not requested:
            return int(weights.get("default", 1))
        if requested in weights:
            return int(weights[requested])
        for key, weight in weights.items():
            if key != "default" and requested.startswith(str(key).lower()):
                return int(weight)
        return int(weights.get("default", 1))

    def get(self) -> dict[str, object]:
        data = dict(self.data)
        data["refresh_account_interval_minute"] = self.refresh_account_interval_minute
        data["image_retention_days"] = self.image_retention_days
        data["image_poll_timeout_secs"] = self.image_poll_timeout_secs
        data["image_poll_interval_secs"] = self.image_poll_interval_secs
        data["image_poll_initial_wait_secs"] = self.image_poll_initial_wait_secs
        data["image_account_concurrency"] = self.image_account_concurrency
        data["image_parallel_generation"] = self.image_parallel_generation
        data["image_remove_conversation_after_result"] = self.image_remove_conversation_after_result
        data["image_remove_conversation_always"] = self.image_remove_conversation_always
        data["auto_remove_invalid_accounts"] = self.auto_remove_invalid_accounts
        data["auto_remove_rate_limited_accounts"] = self.auto_remove_rate_limited_accounts
        data["auto_relogin_after_refresh"] = self.auto_relogin_after_refresh
        data["log_levels"] = self.log_levels
        data["sensitive_words"] = self.sensitive_words
        data["ai_review"] = self.ai_review
        data["global_system_prompt"] = self.global_system_prompt
        data["default_upstream_model_name"] = self.default_upstream_model_name
        data["default_thinking_effort"] = self.default_thinking_effort
        data["backup"] = self.get_public_backup_settings()
        data["image_storage"] = self.get_public_image_storage_settings()
        data["chat_completion_cache"] = self.get_chat_completion_cache_settings()
        data["proxy_runtime"] = self.get_public_proxy_runtime_settings()
        data["third_party_apps"] = self.get_third_party_apps_settings()
        data["registration_enabled"] = self.registration_enabled
        data["registration_bonus_quota"] = self.registration_bonus_quota
        data["checkin_bonus_quota"] = self.checkin_bonus_quota
        data["checkin_streak_bonuses"] = self.checkin_streak_bonuses
        data["site_title"] = self.site_title
        data["allowed_email_domains"] = self.allowed_email_domains
        data["image_local_download_enabled"] = self.image_local_download_enabled
        data["image_local_retention_days"] = self.image_local_retention_days
        data["image_prefer_b64_json"] = self.image_prefer_b64_json
        data["image_download_proxy"] = self.image_download_proxy
        data["smtp"] = self.get_public_smtp_settings()
        data["turnstile"] = self.get_public_turnstile_settings()
        data["model_quota_weights"] = self.model_quota_weights
        data["third_party_apis"] = self.get_third_party_apis_settings()
        admin_account = self.admin_account
        data["admin_account"] = {
            "username": admin_account.get("username", ""),
            "has_password": bool(admin_account.get("password", "")),
        }
        data.pop("auth-key", None)
        return data

    def get_proxy_settings(self) -> str:
        return str(self.data.get("proxy") or "").strip()

    def get_proxy_runtime_settings(self) -> dict[str, object]:
        return _normalize_proxy_runtime_settings(self.data.get("proxy_runtime"))

    def get_public_proxy_runtime_settings(self) -> dict[str, object]:
        runtime = copy.deepcopy(self.get_proxy_runtime_settings())
        clearance = runtime.get("clearance") if isinstance(runtime.get("clearance"), dict) else {}
        if isinstance(clearance, dict):
            cf_cookies = str(clearance.get("cf_cookies") or "").strip()
            cf_clearance = str(clearance.get("cf_clearance") or "").strip()
            clearance["cf_cookies"] = ""
            clearance["cf_clearance"] = ""
            clearance["has_cf_cookies"] = bool(cf_cookies)
            clearance["has_cf_clearance"] = bool(cf_clearance)
        return runtime

    def get_third_party_apps_settings(self) -> dict[str, object]:
        return _normalize_third_party_apps_settings(self.data.get("third_party_apps"))

    def update(self, data: dict[str, object]) -> dict[str, object]:
        next_data = dict(self.data)
        next_data.update(dict(data or {}))
        if "backup" in next_data:
            incoming_backup = next_data.get("backup")
            if isinstance(incoming_backup, dict):
                incoming_backup = dict(incoming_backup)
                previous_backup = self.get_backup_settings()
                if not str(incoming_backup.get("secret_access_key") or "").strip():
                    incoming_backup["secret_access_key"] = str(previous_backup.get("secret_access_key") or "")
                if not str(incoming_backup.get("passphrase") or "").strip():
                    incoming_backup["passphrase"] = str(previous_backup.get("passphrase") or "")
                next_data["backup"] = incoming_backup
            next_data["backup"] = _normalize_backup_settings(next_data.get("backup"))
        if "image_storage" in next_data:
            incoming_storage = next_data.get("image_storage")
            if isinstance(incoming_storage, dict):
                incoming_storage = dict(incoming_storage)
                previous_storage = self.get_image_storage_settings()
                if not str(incoming_storage.get("webdav_password") or "").strip():
                    incoming_storage["webdav_password"] = str(previous_storage.get("webdav_password") or "")
                next_data["image_storage"] = incoming_storage
            next_data["image_storage"] = _normalize_image_storage_settings(next_data.get("image_storage"))
            _validate_image_storage_settings(next_data["image_storage"])
        if "chat_completion_cache" in next_data:
            next_data["chat_completion_cache"] = _normalize_chat_completion_cache_settings(
                next_data.get("chat_completion_cache")
            )
        if "third_party_apps" in next_data:
            next_data["third_party_apps"] = _normalize_third_party_apps_settings(next_data.get("third_party_apps"))
        if "registration_enabled" in next_data:
            next_data["registration_enabled"] = _normalize_bool(next_data.get("registration_enabled"), False)
        if "registration_bonus_quota" in next_data:
            next_data["registration_bonus_quota"] = _normalize_positive_int(next_data.get("registration_bonus_quota"), 0)
        if "checkin_bonus_quota" in next_data:
            next_data["checkin_bonus_quota"] = _normalize_positive_int(next_data.get("checkin_bonus_quota"), 0)
        if "checkin_streak_bonuses" in next_data:
            next_data["checkin_streak_bonuses"] = _normalize_streak_bonuses(next_data.get("checkin_streak_bonuses"))
        if "image_local_download_enabled" in next_data:
            next_data["image_local_download_enabled"] = _normalize_bool(next_data.get("image_local_download_enabled"), True)
        if "image_local_retention_days" in next_data:
            next_data["image_local_retention_days"] = _normalize_positive_int(next_data.get("image_local_retention_days"), 7, 1)
        if "image_prefer_b64_json" in next_data:
            next_data["image_prefer_b64_json"] = _normalize_bool(next_data.get("image_prefer_b64_json"), True)
        if "image_download_proxy" in next_data:
            next_data["image_download_proxy"] = str(next_data.get("image_download_proxy") or "").strip()
        if "model_quota_weights" in next_data:
            next_data["model_quota_weights"] = _normalize_model_quota_weights(next_data.get("model_quota_weights"))
        if "third_party_apis" in next_data:
            next_data["third_party_apis"] = _normalize_third_party_apis(next_data.get("third_party_apis"))
        if "admin_account" in next_data:
            next_data["admin_account"] = _normalize_admin_account(next_data.get("admin_account"))
        if "smtp" in next_data:
            incoming_smtp = next_data.get("smtp")
            if isinstance(incoming_smtp, dict):
                previous = self.smtp_settings
                incoming_smtp = dict(incoming_smtp)
                if not str(incoming_smtp.get("password") or "").strip():
                    incoming_smtp["password"] = str(previous.get("password") or "")
            next_data["smtp"] = _normalize_smtp(incoming_smtp)
        if "turnstile" in next_data:
            incoming_turnstile = next_data.get("turnstile")
            if isinstance(incoming_turnstile, dict):
                previous = self.turnstile_settings
                incoming_turnstile = dict(incoming_turnstile)
                if not str(incoming_turnstile.get("secret_key") or "").strip():
                    incoming_turnstile["secret_key"] = str(previous.get("secret_key") or "")
            next_data["turnstile"] = _normalize_turnstile(incoming_turnstile)
        if "proxy_runtime" in next_data:
            incoming_runtime = next_data.get("proxy_runtime")
            if isinstance(incoming_runtime, dict):
                previous_clearance = self.get_proxy_runtime_settings().get("clearance")
                if isinstance(previous_clearance, dict):
                    incoming_runtime = dict(incoming_runtime)
                    incoming_runtime["_existing_cf_cookies"] = previous_clearance.get("cf_cookies")
                    incoming_runtime["_existing_cf_clearance"] = previous_clearance.get("cf_clearance")
            next_data["proxy_runtime"] = _normalize_proxy_runtime_settings(incoming_runtime)
        next_data.pop("backup_state", None)
        self.data = next_data
        self._save()
        return self.get()

    def get_backup_settings(self) -> dict[str, object]:
        return _normalize_backup_settings(self.data.get("backup"))

    def get_public_backup_settings(self) -> dict[str, object]:
        """对外返回的备份配置：密钥/口令脱敏，用 has_* 标记是否已配置。"""
        settings = dict(self.get_backup_settings())
        settings["secret_access_key"] = ""
        settings["has_secret_access_key"] = bool(str(self.get_backup_settings().get("secret_access_key") or ""))
        settings["passphrase"] = ""
        settings["has_passphrase"] = bool(str(self.get_backup_settings().get("passphrase") or ""))
        return settings

    def get_image_storage_settings(self) -> dict[str, object]:
        return _normalize_image_storage_settings(self.data.get("image_storage"))

    def get_public_image_storage_settings(self) -> dict[str, object]:
        """对外返回的图片存储配置：密码脱敏，用 has_webdav_password 标记。"""
        settings = dict(self.get_image_storage_settings())
        settings["webdav_password"] = ""
        settings["has_webdav_password"] = bool(str(self.get_image_storage_settings().get("webdav_password") or ""))
        return settings

    def get_chat_completion_cache_settings(self) -> dict[str, object]:
        return _normalize_chat_completion_cache_settings(self.data.get("chat_completion_cache"))

    def get_storage_backend(self) -> StorageBackend:
        """获取存储后端实例（单例）"""
        if self._storage_backend is None:
            from services.storage.factory import create_storage_backend
            self._storage_backend = create_storage_backend(DATA_DIR)
        return self._storage_backend


def load_backup_state() -> dict[str, object]:
    return _normalize_backup_state(_read_json_object(BACKUP_STATE_FILE, name="backup_state.json"))


def save_backup_state(state: dict[str, object]) -> dict[str, object]:
    normalized = _normalize_backup_state(state)
    BACKUP_STATE_FILE.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return normalized


config = ConfigStore(CONFIG_FILE)
