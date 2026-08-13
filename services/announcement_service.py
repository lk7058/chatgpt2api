from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

ANNOUNCEMENT_FILE = DATA_DIR / "announcements.json"


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class AnnouncementService:
    """公告与广告配置：弹窗公告（popup）+ 广告栏（banner），存 data/announcements.json。"""

    def __init__(self, path: Path = ANNOUNCEMENT_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._data = self._load()

    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}
        defaults: dict[str, dict[str, Any]] = {
            "popup": {"title": "", "content": "", "enabled": False, "updated_at": ""},
            "banner": {"title": "", "content": "", "link": "", "enabled": False, "updated_at": ""},
        }
        for key, default in defaults.items():
            item = data.get(key)
            data[key] = {**default, **(item if isinstance(item, dict) else {})}
        return data

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(self._data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self.path)

    def get_public(self) -> dict[str, Any]:
        """公开接口：只返回已启用的公告/广告。"""
        with self._lock:
            popup = self._data.get("popup") or {}
            banner = self._data.get("banner") or {}
        return {
            "popup": {
                "title": str(popup.get("title") or ""),
                "content": str(popup.get("content") or ""),
            }
            if popup.get("enabled") else None,
            "banner": {
                "title": str(banner.get("title") or ""),
                "content": str(banner.get("content") or ""),
                "link": str(banner.get("link") or ""),
            }
            if banner.get("enabled") else None,
        }

    def get_admin(self) -> dict[str, Any]:
        with self._lock:
            return {
                "popup": dict(self._data.get("popup") or {}),
                "banner": dict(self._data.get("banner") or {}),
            }

    def save(self, popup: dict[str, Any], banner: dict[str, Any]) -> dict[str, Any]:
        now = _now_iso()
        with self._lock:
            self._data["popup"] = {
                "title": str(popup.get("title") or "")[:200],
                "content": str(popup.get("content") or "")[:5000],
                "enabled": bool(popup.get("enabled")),
                "updated_at": now,
            }
            self._data["banner"] = {
                "title": str(banner.get("title") or "")[:200],
                "content": str(banner.get("content") or "")[:2000],
                "link": str(banner.get("link") or "")[:500],
                "enabled": bool(banner.get("enabled")),
                "updated_at": now,
            }
            self._save()
        return self.get_admin()


announcement_service = AnnouncementService()
