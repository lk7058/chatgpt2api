from __future__ import annotations

import json
import secrets
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

MCP_LOG_FILE = DATA_DIR / "mcp_logs.json"
# 日志容量上限：超出后丢弃最旧记录
MCP_LOG_MAX = 5000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: object) -> str:
    return str(value or "").strip()


def generate_mcp_key() -> str:
    """生成专属 MCP Key（与站内 sk- 会话/专用密钥相互独立，不可混用）。"""
    return f"sk-mcp-{secrets.token_urlsafe(24)}"


def key_hint(raw_key: str) -> str:
    """Key 展示脱敏：仅保留末尾 4 位。"""
    raw_key = _clean(raw_key)
    if not raw_key:
        return ""
    return f"****{raw_key[-4:]}"


class MCPLogService:
    """MCP 调用日志：JSON 数组文件，容量上限 MCP_LOG_MAX 条（先进先出）。"""

    def __init__(self, path: Path = MCP_LOG_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._items = self._load()

    def _load(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return []
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def _save_locked(self) -> None:
        self.path.write_text(
            json.dumps(self._items, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def add(
        self,
        *,
        user_id: str,
        username: str,
        tool: str,
        status: str,
        message: str = "",
        quota_delta: int = 0,
    ) -> dict[str, Any]:
        """记录一次 MCP 调用（含工具类型、时间、状态与额度消耗）。"""
        item = {
            "id": uuid.uuid4().hex[:12],
            "time": _now_iso(),
            "user_id": _clean(user_id),
            "username": _clean(username),
            "tool": _clean(tool),
            "status": _clean(status) or "ok",
            "message": _clean(message),
            "quota_delta": max(0, int(quota_delta or 0)),
        }
        with self._lock:
            self._items.append(item)
            if len(self._items) > MCP_LOG_MAX:
                self._items = self._items[-MCP_LOG_MAX:]
            self._save_locked()
        return dict(item)

    def list_logs(self, *, user_id: str = "", tool: str = "", limit: int = 200) -> list[dict[str, Any]]:
        """按时间倒序返回调用日志，支持按用户/工具过滤。"""
        try:
            limit = max(1, min(int(limit or 200), 1000))
        except (TypeError, ValueError):
            limit = 200
        with self._lock:
            items = list(self._items)
        filtered: list[dict[str, Any]] = []
        for item in reversed(items):
            if user_id and _clean(item.get("user_id")) != user_id:
                continue
            if tool and _clean(item.get("tool")) != tool:
                continue
            filtered.append(dict(item))
            if len(filtered) >= limit:
                break
        return filtered


mcp_log_service = MCPLogService()
