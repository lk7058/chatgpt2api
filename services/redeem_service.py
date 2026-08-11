from __future__ import annotations

import json
import secrets
import string
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

REDEEM_FILE = DATA_DIR / "redeem_codes.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _generate_code(length: int = 16) -> str:
    """生成充值卡兑换码（大写字母+数字，去除易混淆字符）。"""
    alphabet = string.ascii_uppercase + string.digits
    alphabet = alphabet.replace("O", "").replace("I", "").replace("0", "").replace("1", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


class RedeemService:
    """额度充值卡：管理员生成，用户兑换后增加额度。"""

    def __init__(self, path: Path = REDEEM_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._codes: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = []
        self._codes = [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    def _save(self) -> None:
        self.path.write_text(
            json.dumps(self._codes, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def generate_codes(self, *, count: int, amount: int, creator: str = "") -> list[dict[str, Any]]:
        """批量生成充值卡。返回生成的卡片（含明文 code）。"""
        try:
            count = max(1, min(int(count), 100))
            amount = max(1, int(amount))
        except (TypeError, ValueError):
            raise ValueError("数量或面额无效")
        created = []
        with self._lock:
            existing = {str(item.get("code")) for item in self._codes}
            attempts = 0
            while len(created) < count and attempts < count * 20:
                attempts += 1
                code = _generate_code()
                if code in existing:
                    continue
                existing.add(code)
                item = {
                    "id": uuid.uuid4().hex[:12],
                    "code": code,
                    "amount": amount,
                    "status": "unused",
                    "created_by": str(creator or ""),
                    "created_at": _now_iso(),
                    "used_by": "",
                    "used_at": "",
                }
                self._codes.append(item)
                created.append(dict(item))
            self._save()
        return created

    def list_codes(self, limit: int = 200, status: str = "") -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._codes)
        items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        if status:
            items = [item for item in items if str(item.get("status")) == status]
        return items[:limit]

    def redeem(self, code: str, user_id: str, username: str) -> dict[str, Any]:
        """用户兑换充值卡：验证并增加额度。"""
        code = str(code or "").strip().upper()
        if not code:
            raise ValueError("兑换码不能为空")
        with self._lock:
            target = next((item for item in self._codes if str(item.get("code")) == code), None)
            if target is None:
                raise ValueError("兑换码不存在")
            if str(target.get("status")) == "used":
                raise ValueError("兑换码已被使用")
            target["status"] = "used"
            target["used_by"] = str(user_id)
            target["used_username"] = str(username)
            target["used_at"] = _now_iso()
            self._save()
            amount = int(target.get("amount", 0))
        return {"code": code, "amount": amount}

    def list_my_redeems(self, user_id: str, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            items = [
                dict(item)
                for item in self._codes
                if str(item.get("used_by")) == str(user_id)
            ]
        items.sort(key=lambda item: str(item.get("used_at") or ""), reverse=True)
        return items[:limit]

    def delete_code(self, code_id: str) -> bool:
        """删除充值卡（管理员）。"""
        code_id = str(code_id or "").strip()
        with self._lock:
            before = len(self._codes)
            self._codes = [item for item in self._codes if str(item.get("id")) != code_id]
            removed = len(self._codes) != before
            if removed:
                self._save()
            return removed


redeem_service = RedeemService()
