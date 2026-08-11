from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

RECORD_FILE = DATA_DIR / "generation_records.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class GenerationRecordService:
    """云同步生成记录：按登录用户（user_id）隔离存储生成记录。

    前端画图/对话历史不再仅存浏览器本地，而是同步到服务端，
    用户在任何设备登录同一账号都能看到历史记录。
    """

    def __init__(self, path: Path = RECORD_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._records: dict[str, list[dict[str, Any]]] = {}
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        records: dict[str, list[dict[str, Any]]] = {}
        if isinstance(data, dict):
            for user_id, items in data.items():
                if isinstance(items, list):
                    records[str(user_id)] = [item for item in items if isinstance(item, dict)]
        self._records = records

    def _save(self) -> None:
        self.path.write_text(
            json.dumps(self._records, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    @staticmethod
    def _normalize_record(raw: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(raw.get("id") or uuid.uuid4().hex[:12]),
            "kind": str(raw.get("kind") or "image"),
            "title": str(raw.get("title") or ""),
            "payload": raw.get("payload") if isinstance(raw.get("payload"), (dict, list)) else {},
            "created_at": str(raw.get("created_at") or _now_iso()),
            "updated_at": str(raw.get("updated_at") or _now_iso()),
        }

    def list_records(self, user_id: str, limit: int = 200) -> list[dict[str, Any]]:
        user_id = str(user_id or "")
        with self._lock:
            items = list(self._records.get(user_id, []))
        items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        return items[:limit]

    def get_record(self, user_id: str, record_id: str) -> dict[str, Any] | None:
        user_id = str(user_id or "")
        record_id = str(record_id or "")
        with self._lock:
            for item in self._records.get(user_id, []):
                if str(item.get("id")) == record_id:
                    return dict(item)
        return None

    def upsert_record(self, user_id: str, record: dict[str, Any]) -> dict[str, Any]:
        user_id = str(user_id or "")
        if not user_id:
            raise ValueError("user_id 不能为空")
        normalized = self._normalize_record(record)
        with self._lock:
            items = self._records.setdefault(user_id, [])
            replaced = False
            for index, item in enumerate(items):
                if str(item.get("id")) == normalized["id"]:
                    items[index] = normalized
                    replaced = True
                    break
            if not replaced:
                items.append(normalized)
            self._save()
        return dict(normalized)

    def delete_record(self, user_id: str, record_id: str) -> bool:
        user_id = str(user_id or "")
        record_id = str(record_id or "")
        with self._lock:
            items = self._records.get(user_id, [])
            remaining = [item for item in items if str(item.get("id")) != record_id]
            if len(remaining) == len(items):
                return False
            self._records[user_id] = remaining
            self._save()
            return True

    def clear_records(self, user_id: str) -> int:
        user_id = str(user_id or "")
        with self._lock:
            items = self._records.pop(user_id, [])
            count = len(items)
            self._save()
            return count

    def delete_user_records(self, user_id: str) -> None:
        self.clear_records(user_id)


generation_record_service = GenerationRecordService()
