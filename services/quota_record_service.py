from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

QUOTA_RECORD_FILE = DATA_DIR / "quota_records.json"

# 流水类型
RECORD_TYPE_INCOME = "income"      # 收入：注册赠送/签到赠送/管理员充值
RECORD_TYPE_EXPENSE = "expense"    # 支出：生成消耗


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class QuotaRecordService:
    """额度流水：按用户记录额度收入与支出。"""

    def __init__(self, path: Path = QUOTA_RECORD_FILE):
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

    def add_record(
        self,
        user_id: str,
        *,
        record_type: str,
        amount: int,
        balance_after: int,
        source: str,
        note: str = "",
    ) -> dict[str, Any]:
        user_id = str(user_id or "")
        if not user_id:
            return {}
        try:
            amount = int(amount)
        except (TypeError, ValueError):
            amount = 0
        if amount == 0:
            return {}
        record = {
            "id": uuid.uuid4().hex[:12],
            "type": "income" if record_type == RECORD_TYPE_INCOME else "expense",
            "amount": abs(amount),
            "balance_after": int(balance_after),
            "source": str(source or ""),
            "note": str(note or ""),
            "created_at": _now_iso(),
        }
        with self._lock:
            items = self._records.setdefault(user_id, [])
            items.append(record)
            self._save()
        return dict(record)

    def list_records(self, user_id: str, limit: int = 100) -> list[dict[str, Any]]:
        user_id = str(user_id or "")
        with self._lock:
            items = list(self._records.get(user_id, []))
        items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return items[:limit]

    def summary(self, user_id: str) -> dict[str, Any]:
        """汇总收入与支出。"""
        user_id = str(user_id or "")
        with self._lock:
            items = list(self._records.get(user_id, []))
        total_income = sum(int(item.get("amount", 0)) for item in items if item.get("type") == "income")
        total_expense = sum(int(item.get("amount", 0)) for item in items if item.get("type") == "expense")
        return {
            "total_income": total_income,
            "total_expense": total_expense,
            "count": len(items),
        }

    def checkin_dates(self, user_id: str, limit_days: int = 60) -> list[str]:
        """返回用户最近 limit_days 天的签到日期（YYYY-MM-DD）。"""
        user_id = str(user_id or "")
        with self._lock:
            items = list(self._records.get(user_id, []))
        dates: list[str] = []
        seen: set[str] = set()
        for item in sorted(items, key=lambda i: str(i.get("created_at") or ""), reverse=True):
            if item.get("source") != "checkin":
                continue
            day = str(item.get("created_at") or "")[:10]
            if day and day not in seen:
                seen.add(day)
                dates.append(day)
            if len(dates) >= limit_days:
                break
        return dates

    def delete_user_records(self, user_id: str) -> None:
        user_id = str(user_id or "")
        with self._lock:
            self._records.pop(user_id, None)
            self._save()


quota_record_service = QuotaRecordService()
