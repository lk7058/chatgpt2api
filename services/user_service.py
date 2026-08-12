from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

USER_FILE = DATA_DIR / "users.json"
SESSION_FILE = DATA_DIR / "sessions.json"

# 会话有效期（秒）：30 天
SESSION_TTL_SECS = 30 * 24 * 3600


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return f"pbkdf2${salt}${digest}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = str(stored or "").split("$", 2)
    except ValueError:
        return False
    if scheme != "pbkdf2" or not salt or not digest:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return hmac.compare_digest(candidate, digest)


# 用于登录恒时比较的虚拟口令哈希（未知邮箱时也执行一次校验，防时序侧信道）
_DUMMY_PASSWORD_HASH = _hash_password("chatgpt2api-constant-time-dummy")


class UserService:
    """用户系统：账号密码、注册开关、额度管理。

    用户数据保存在 data/users.json（不依赖存储后端抽象，避免改动
    json/sqlite/postgres/git 四个后端）。会话 token 直接复用 auth_keys
    的专用密钥机制，用户登录时为其创建/复用一把 sk- 密钥并绑定 user_id。
    """

    def __init__(self, path: Path = USER_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._users: dict[str, dict[str, Any]] = {}
        self._by_username: dict[str, str] = {}
        self._sessions_cache: dict[str, dict[str, Any]] | None = None
        self._load()

    # ── 持久化 ──────────────────────────────────────────────

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        items = data.get("users") if isinstance(data, dict) else None
        if not isinstance(items, list):
            items = []
        users: dict[str, dict[str, Any]] = {}
        by_username: dict[str, str] = {}
        for raw in items:
            if not isinstance(raw, dict):
                continue
            user = self._normalize(raw)
            if user is None:
                continue
            users[user["id"]] = user
            by_username[user["username"]] = user["id"]
        self._users = users
        self._by_username = by_username

    def _save(self) -> None:
        self.path.write_text(
            json.dumps({"users": list(self._users.values())}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    # ── 归一化 ──────────────────────────────────────────────

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    def _normalize(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        username = self._clean(raw.get("username"))
        password_hash = self._clean(raw.get("password_hash"))
        if not username or not password_hash:
            return None
        role = self._clean(raw.get("role")).lower()
        if role not in {"admin", "user"}:
            role = "user"
        try:
            quota_total = int(raw.get("quota_total", 0))
        except (TypeError, ValueError):
            quota_total = 0
        try:
            quota_used = int(raw.get("quota_used", 0))
        except (TypeError, ValueError):
            quota_used = 0
        return {
            "id": self._clean(raw.get("id")) or uuid.uuid4().hex[:12],
            "username": username,
            "password_hash": password_hash,
            "role": role,
            "quota_total": quota_total,
            "quota_used": max(0, quota_used),
            "enabled": bool(raw.get("enabled", True)),
            "created_at": self._clean(raw.get("created_at")) or _now_iso(),
            "updated_at": self._clean(raw.get("updated_at")) or _now_iso(),
            "email": self._clean(raw.get("email")),
            "email_verified": bool(raw.get("email_verified", False)),
            "last_checkin_date": self._clean(raw.get("last_checkin_date")),
            "checkin_streak": int(raw.get("checkin_streak", 0) or 0),
            "total_checkins": int(raw.get("total_checkins", 0) or 0),
        }

    @staticmethod
    def _public(user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": user.get("id"),
            "username": user.get("username"),
            "role": user.get("role"),
            "quota_total": user.get("quota_total"),
            "quota_used": user.get("quota_used"),
            "quota_left": user.get("quota_total") - user.get("quota_used", 0)
            if int(user.get("quota_total", 0) or 0) >= 0 else -1,
            "enabled": bool(user.get("enabled", True)),
            "created_at": user.get("created_at"),
            "updated_at": user.get("updated_at"),
            "email": user.get("email") or "",
            "email_verified": bool(user.get("email_verified", False)),
            "last_checkin_date": user.get("last_checkin_date") or "",
            "checkin_streak": user.get("checkin_streak", 0),
            "total_checkins": user.get("total_checkins", 0),
        }

    # ── 查询 ────────────────────────────────────────────────

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._public(user) for user in sorted(self._users.values(), key=lambda u: u["created_at"])]

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        user_id = self._clean(user_id)
        with self._lock:
            user = self._users.get(user_id)
            return dict(user) if user else None

    def get_public_user(self, user_id: str) -> dict[str, Any] | None:
        user = self.get_user(user_id)
        return self._public(user) if user else None

    def get_by_username(self, username: str) -> dict[str, Any] | None:
        username = self._clean(username).lower()
        with self._lock:
            user_id = self._by_username.get(username)
            user = self._users.get(user_id) if user_id else None
            return dict(user) if user else None

    def get_by_email(self, email: str) -> dict[str, Any] | None:
        """按绑定邮箱查找用户（不区分大小写）。"""
        email = self._clean(email).lower()
        if not email:
            return None
        with self._lock:
            for user in self._users.values():
                if self._clean(user.get("email")).lower() == email:
                    return dict(user)
        return None

    def count_users(self) -> int:
        with self._lock:
            return len(self._users)

    # ── 管理操作 ────────────────────────────────────────────

    def ensure_admin(self, username: str, password: str) -> dict[str, Any]:
        """根据 config 中的管理员账号确保管理员存在（首次启动自动创建）。"""
        from services.config import config

        username = self._clean(username)
        password = self._clean(password)
        if not username or not password:
            raise ValueError("admin_username / admin_password 未配置")
        admin_email = self._clean(config.admin_account.get("email") or "")
        existing = self.get_by_username(username)
        if existing is not None:
            if existing.get("role") != "admin":
                raise ValueError(f"账号 {username} 已存在但不是管理员")
            if not _verify_password(password, str(existing.get("password_hash") or "")):
                self.update_password(existing["id"], password)
            with self._lock:
                user = self._users[existing["id"]]
                user["role"] = "admin"
                user["enabled"] = True
                if admin_email and self._clean(user.get("email")).lower() != admin_email:
                    user["email"] = admin_email
                    user["email_verified"] = True
                self._save()
            return self._public(self._users[existing["id"]])
        return self.create_user(
            username,
            password,
            role="admin",
            quota_total=-1,
            email=admin_email,
            email_verified=bool(admin_email),
        )

    def create_user(self, username: str, password: str, *, role: str = "user", quota_total: int = 0, email: str = "", email_verified: bool = False) -> dict[str, Any]:
        username = self._clean(username)
        password = self._clean(password)
        if not username:
            raise ValueError("用户名不能为空")
        if not password:
            raise ValueError("密码不能为空")
        if len(password) < 8:
            raise ValueError("密码至少 8 位")
        if len(username) > 32:
            raise ValueError("用户名过长（最多 32 个字符）")
        normalized_role = "admin" if str(role or "").strip().lower() == "admin" else "user"
        with self._lock:
            if self._by_username.get(username.lower()):
                raise ValueError("用户名已被注册")
            email = self._clean(email).lower()
            if email:
                for existing in self._users.values():
                    if str(existing.get("email") or "").lower() == email:
                        raise ValueError("该邮箱已被注册")
            # 注册赠送额度（管理员手动创建不赠送）
            from services.config import config

            bonus = config.registration_bonus_quota if normalized_role == "user" else 0
            initial_quota = max(0, int(quota_total or 0)) + max(0, int(bonus))
            user = {
                "id": uuid.uuid4().hex[:12],
                "username": username,
                "password_hash": _hash_password(password),
                "role": normalized_role,
                "quota_total": initial_quota,
                "quota_used": 0,
                "enabled": True,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "email": email,
                "email_verified": bool(email_verified),
                "last_checkin_date": "",
                "checkin_streak": 0,
                "total_checkins": 0,
            }
            self._users[user["id"]] = user
            self._by_username[username.lower()] = user["id"]
            self._save()
            # 注册赠送额度流水（仅实际赠送时记录）
            if bonus > 0:
                try:
                    from services.quota_record_service import quota_record_service

                    quota_record_service.add_record(
                        user["id"],
                        record_type="income",
                        amount=bonus,
                        balance_after=initial_quota,
                        source="register",
                        note="注册赠送",
                        email=str(user.get("email") or ""),
                    )
                except Exception:
                    pass
            return self._public(user)

    def authenticate(self, email: str, password: str) -> dict[str, Any] | None:
        """邮箱密码登录：按绑定邮箱匹配（不区分大小写），未知邮箱也执行一次口令校验保持恒时。"""
        user = self.get_by_email(email)
        if user is None:
            _verify_password(password, _DUMMY_PASSWORD_HASH)
            return None
        if not bool(user.get("enabled", True)):
            return None
        if not _verify_password(password, str(user.get("password_hash") or "")):
            return None
        with self._lock:
            user = self._users[user["id"]]
            user["updated_at"] = _now_iso()
            self._save()
        return self._public(user)

    def verify_password(self, user_id: str, password: str) -> bool:
        """校验指定用户（按 user_id）的密码，用于修改密码等场景。"""
        user = self.get_user(user_id)
        if user is None:
            return False
        return _verify_password(password, str(user.get("password_hash") or ""))

    def update_password(self, user_id: str, password: str) -> dict[str, Any] | None:
        user_id = self._clean(user_id)
        password = self._clean(password)
        if not password:
            raise ValueError("密码不能为空")
        if len(password) < 8:
            raise ValueError("密码至少 8 位")
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return None
            user["password_hash"] = _hash_password(password)
            user["updated_at"] = _now_iso()
            self._save()
            return self._public(user)

    def update_email(self, user_id: str, email: str, *, verified: bool = False, sync_username: bool = True) -> dict[str, Any] | None:
        """绑定/更新用户邮箱。sync_username=True 时同步更新 username 为邮箱（邮箱即账号）。"""
        user_id = self._clean(user_id)
        email = self._clean(email).lower()
        if not email:
            raise ValueError("邮箱不能为空")
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return None
            user["email"] = email
            user["email_verified"] = bool(verified)
            if sync_username:
                old_username = self._clean(user.get("username"))
                if old_username:
                    self._by_username.pop(old_username.lower(), None)
                user["username"] = email
                self._by_username[email] = user_id
            user["updated_at"] = _now_iso()
            self._save()
            return self._public(user)

    def set_enabled(self, user_id: str, enabled: bool) -> dict[str, Any] | None:
        user_id = self._clean(user_id)
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return None
            user["enabled"] = bool(enabled)
            user["updated_at"] = _now_iso()
            self._save()
            return self._public(user)

    def set_quota(self, user_id: str, quota_total: int) -> dict[str, Any] | None:
        """管理员分配额度。quota_total=-1 表示不限量。"""
        user_id = self._clean(user_id)
        try:
            quota_total = int(quota_total)
        except (TypeError, ValueError):
            raise ValueError("额度必须是整数")
        if quota_total < -1:
            raise ValueError("额度不能小于 -1")
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return None
            previous_total = int(user.get("quota_total", 0) or 0)
            user["quota_total"] = quota_total
            user["updated_at"] = _now_iso()
            self._save()
            # 额度增加时记录收入流水（调低/不变不记录）
            if quota_total >= 0 and previous_total >= 0 and quota_total > previous_total:
                diff = quota_total - previous_total
                try:
                    from services.quota_record_service import quota_record_service

                    quota_record_service.add_record(
                        user_id,
                        record_type="income",
                        amount=diff,
                        balance_after=quota_total - int(user.get("quota_used", 0) or 0),
                        source="admin_grant",
                        note="管理员充值",
                        email=str(user.get("email") or ""),
                    )
                except Exception:
                    pass
            return self._public(user)

    def add_quota(self, user_id: str, amount: int, note: str = "管理员增加额度") -> dict[str, Any] | None:
        """增加用户额度（记录收入流水）。"""
        user_id = self._clean(user_id)
        try:
            amount = max(1, int(amount))
        except (TypeError, ValueError):
            raise ValueError("增加额度必须是正整数")
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return None
            quota_total = int(user.get("quota_total", 0) or 0)
            if quota_total < 0:
                # 不限量用户无需增加
                return self._public(user)
            user["quota_total"] = quota_total + amount
            user["updated_at"] = _now_iso()
            self._save()
            balance = int(user["quota_total"]) - int(user.get("quota_used", 0) or 0)
            try:
                from services.quota_record_service import quota_record_service

                quota_record_service.add_record(
                    user_id,
                    record_type="income",
                    amount=amount,
                    balance_after=balance,
                    source="admin_grant",
                    note=note,
                    email=str(user.get("email") or ""),
                )
            except Exception:
                pass
            return self._public(user)

    def subtract_quota(self, user_id: str, amount: int, note: str = "管理员减少额度") -> dict[str, Any] | None:
        """减少用户额度（记录支出流水）。"""
        user_id = self._clean(user_id)
        try:
            amount = max(1, int(amount))
        except (TypeError, ValueError):
            raise ValueError("减少额度必须是正整数")
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return None
            quota_total = int(user.get("quota_total", 0) or 0)
            if quota_total < 0:
                return self._public(user)
            user["quota_total"] = max(0, quota_total - amount)
            user["updated_at"] = _now_iso()
            self._save()
            balance = int(user["quota_total"]) - int(user.get("quota_used", 0) or 0)
            try:
                from services.quota_record_service import quota_record_service

                quota_record_service.add_record(
                    user_id,
                    record_type="expense",
                    amount=min(amount, quota_total),
                    balance_after=balance,
                    source="admin_reduce",
                    note=note,
                    email=str(user.get("email") or ""),
                )
            except Exception:
                pass
            return self._public(user)

    def reset_quota(self, user_id: str, note: str = "管理员清零额度") -> dict[str, Any] | None:
        """清零用户额度（quota_total=0，已用量保留）。"""
        user_id = self._clean(user_id)
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return None
            previous_total = int(user.get("quota_total", 0) or 0)
            user["quota_total"] = 0
            user["updated_at"] = _now_iso()
            self._save()
            if previous_total > 0:
                try:
                    from services.quota_record_service import quota_record_service

                    quota_record_service.add_record(
                        user_id,
                        record_type="expense",
                        amount=previous_total,
                        balance_after=0 - int(user.get("quota_used", 0) or 0),
                        source="admin_reset",
                        note=note,
                        email=str(user.get("email") or ""),
                    )
                except Exception:
                    pass
            return self._public(user)

    def delete_user(self, user_id: str) -> bool:
        user_id = self._clean(user_id)
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return False
            if user.get("role") == "admin" and sum(1 for u in self._users.values() if u.get("role") == "admin") <= 1:
                raise ValueError("不能删除最后一个管理员")
            del self._users[user_id]
            self._by_username = {name: uid for name, uid in self._by_username.items() if uid != user_id}
            self._save()
            try:
                from services.quota_record_service import quota_record_service

                quota_record_service.delete_user_records(user_id)
            except Exception:
                pass
            return True

    # ── 额度 ────────────────────────────────────────────────

    def check_quota(self, user_id: str, weight: int = 1) -> dict[str, Any]:
        """检查用户是否有足够额度。返回 {ok, user, message}。"""
        user = self.get_user(user_id)
        if user is None:
            return {"ok": False, "user": None, "message": "用户不存在"}
        if not bool(user.get("enabled", True)):
            return {"ok": False, "user": user, "message": "账号已被禁用"}
        quota_total = int(user.get("quota_total", 0) or 0)
        quota_used = int(user.get("quota_used", 0) or 0)
        if quota_total < 0:
            return {"ok": True, "user": user, "message": ""}
        if quota_used + weight > quota_total:
            left = quota_total - quota_used
            return {"ok": False, "user": user, "message": f"额度不足（剩余 {left} 次，本次需要 {weight} 次）"}
        return {"ok": True, "user": user, "message": ""}

    def deduct_quota(self, user_id: str, weight: int = 1, source: str = "generate", note: str = "") -> None:
        """请求成功完成后扣减额度，并记录支出流水。"""
        user_id = self._clean(user_id)
        try:
            weight = max(1, int(weight))
        except (TypeError, ValueError):
            weight = 1
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return
            quota_total = int(user.get("quota_total", 0) or 0)
            if quota_total < 0:
                return
            user["quota_used"] = max(0, int(user.get("quota_used", 0) or 0) + weight)
            user["updated_at"] = _now_iso()
            self._save()
            balance = quota_total - int(user["quota_used"])
            try:
                from services.quota_record_service import quota_record_service

                quota_record_service.add_record(
                    user_id,
                    record_type="expense",
                    amount=weight,
                    balance_after=balance,
                    source=str(source or "generate"),
                    note=str(note or ""),
                    email=str(user.get("email") or ""),
                )
            except Exception:
                pass

    # ── 会话 ────────────────────────────────────────────────

    @staticmethod
    def _hash_session_token(raw_token: str) -> str:
        """会话 token 是 256-bit 随机值，用 sha256 存哈希即可（无需 KDF）。"""
        return hashlib.sha256(str(raw_token or "").encode("utf-8")).hexdigest()

    def _load_sessions(self) -> dict[str, dict[str, Any]]:
        """读取会话表；内存缓存避免每个请求读盘（单进程部署安全）。"""
        if self._sessions_cache is not None:
            return self._sessions_cache
        try:
            data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        sessions = data.get("sessions") if isinstance(data, dict) else None
        result: dict[str, dict[str, Any]] = {}
        if isinstance(sessions, list):
            for raw in sessions:
                if not isinstance(raw, dict):
                    continue
                token_hash = self._clean(raw.get("token_hash"))
                user_id = self._clean(raw.get("user_id"))
                if token_hash and user_id:
                    result[token_hash] = {
                        "token_hash": token_hash,
                        "user_id": user_id,
                        "created_at": self._clean(raw.get("created_at")) or _now_iso(),
                    }
        self._sessions_cache = result
        return result

    def _save_sessions(self, sessions: dict[str, dict[str, Any]]) -> None:
        self._sessions_cache = sessions
        SESSION_FILE.write_text(
            json.dumps({"sessions": list(sessions.values())}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def create_session(self, user_id: str) -> str:
        """为用户创建会话 token，返回明文 token（服务端只存哈希）。"""
        user_id = self._clean(user_id)
        raw_token = f"sk-user-{secrets.token_urlsafe(32)}"
        token_hash = self._hash_session_token(raw_token)
        with self._lock:
            sessions = self._load_sessions()
            sessions[token_hash] = {
                "token_hash": token_hash,
                "user_id": user_id,
                "created_at": _now_iso(),
            }
            self._save_sessions(sessions)
        return raw_token

    def resolve_session(self, raw_token: str) -> dict[str, Any] | None:
        """通过会话 token 解析用户身份，返回 public user（超过 30 天自动失效）。"""
        candidate = self._clean(raw_token)
        if not candidate:
            return None
        token_hash = self._hash_session_token(candidate)
        with self._lock:
            sessions = self._load_sessions()
            session = sessions.get(token_hash)
            if session is None:
                return None
            # 会话过期：删除并落盘（惰性清理）
            try:
                created = datetime.fromisoformat(str(session.get("created_at") or ""))
            except ValueError:
                created = datetime.now(timezone.utc)
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - created).total_seconds() > SESSION_TTL_SECS:
                sessions.pop(token_hash, None)
                self._save_sessions(sessions)
                return None
            user = self._users.get(session.get("user_id"))
            if user is None or not bool(user.get("enabled", True)):
                return None
            return self._public(user)

    def revoke_session(self, raw_token: str) -> None:
        candidate = self._clean(raw_token)
        if not candidate:
            return
        token_hash = self._hash_session_token(candidate)
        with self._lock:
            sessions = self._load_sessions()
            sessions.pop(token_hash, None)
            self._save_sessions(sessions)

    def revoke_user_sessions(self, user_id: str) -> None:
        user_id = self._clean(user_id)
        with self._lock:
            sessions = self._load_sessions()
            sessions = {h: s for h, s in sessions.items() if s.get("user_id") != user_id}
            self._save_sessions(sessions)

    # ── 签到 ────────────────────────────────────────────────

    def get_checkin_status(self, user_id: str) -> dict[str, Any]:
        """查询用户签到状态：今天是否已签、连续天数、可领取额度。"""
        from services.config import config

        user = self.get_user(user_id)
        if user is None:
            return {"ok": False, "error": "用户不存在"}
        today = _now_iso()[:10]
        checked_today = str(user.get("last_checkin_date") or "") == today
        bonus = max(0, int(config.checkin_bonus_quota))
        streak_bonuses = config.checkin_streak_bonuses
        streak = int(user.get("checkin_streak", 0) or 0)
        next_streak_bonus = next(
            (item for item in streak_bonuses if int(item.get("days") or 0) > streak),
            None,
        )
        return {
            "ok": True,
            "checked_today": checked_today,
            "checkin_streak": streak,
            "total_checkins": int(user.get("total_checkins", 0) or 0),
            "last_checkin_date": user.get("last_checkin_date") or "",
            "bonus_quota": bonus,
            "streak_bonuses": streak_bonuses,
            "next_streak_bonus": next_streak_bonus,
            "today": today,
        }

    def checkin(self, user_id: str) -> dict[str, Any]:
        """用户每日签到：赠送额度并累计连续签到天数。每天仅一次。"""
        from services.config import config

        user_id = self._clean(user_id)
        with self._lock:
            user = self._users.get(user_id)
            if user is None:
                return {"ok": False, "error": "用户不存在"}
            today = _now_iso()[:10]
            if str(user.get("last_checkin_date") or "") == today:
                return {"ok": False, "error": "今天已经签到过了", "checked_today": True}
            bonus = max(0, int(config.checkin_bonus_quota))
            # 连续签到判断：昨天是否签过
            yesterday = _date_days_ago(1)
            if str(user.get("last_checkin_date") or "") == yesterday:
                streak = int(user.get("checkin_streak", 0) or 0) + 1
            else:
                streak = 1
            # 连续签到奖励：达到档位天数时额外奖励（每轮连续签到发放一次）
            streak_bonus = 0
            for item in config.checkin_streak_bonuses:
                if int(item.get("days") or 0) == streak:
                    streak_bonus = max(0, int(item.get("bonus") or 0))
                    break
            total_bonus = bonus + streak_bonus
            quota_total = int(user.get("quota_total", 0) or 0)
            if quota_total >= 0:
                user["quota_total"] = quota_total + total_bonus
            user["last_checkin_date"] = today
            user["checkin_streak"] = streak
            user["total_checkins"] = int(user.get("total_checkins", 0) or 0) + 1
            user["updated_at"] = _now_iso()
            self._save()
            # 签到赠送额度流水
            if bonus > 0:
                try:
                    from services.quota_record_service import quota_record_service

                    quota_record_service.add_record(
                        user_id,
                        record_type="income",
                        amount=bonus,
                        balance_after=int(user["quota_total"]) - int(user.get("quota_used", 0) or 0),
                        source="checkin",
                        note="每日签到",
                        email=str(user.get("email") or ""),
                    )
                except Exception:
                    pass
            if streak_bonus > 0:
                try:
                    from services.quota_record_service import quota_record_service

                    quota_record_service.add_record(
                        user_id,
                        record_type="income",
                        amount=streak_bonus,
                        balance_after=int(user["quota_total"]) - int(user.get("quota_used", 0) or 0),
                        source="checkin",
                        note=f"连续签到 {streak} 天奖励",
                        email=str(user.get("email") or ""),
                    )
                except Exception:
                    pass
            return {
                "ok": True,
                "bonus_quota": total_bonus,
                "streak_bonus": streak_bonus,
                "quota_left": user["quota_total"] - int(user.get("quota_used", 0) or 0)
                if int(user["quota_total"]) >= 0 else -1,
                "checkin_streak": streak,
                "total_checkins": int(user.get("total_checkins", 0)),
                "checked_today": True,
            }


def _date_days_ago(days: int) -> str:
    from datetime import date, timedelta

    return (date.today() - timedelta(days=days)).isoformat()


user_service = UserService()
