from __future__ import annotations

import json
import secrets
import smtplib
import threading
import time
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

EMAIL_CODE_FILE = DATA_DIR / "email_codes.json"

# 验证码有效期（秒）
CODE_TTL_SECS = 600
# 同一邮箱重复发码的最小间隔（秒）
CODE_RESEND_MIN_INTERVAL_SECS = 60


class EmailService:
    """邮箱验证码服务：发送验证码、校验验证码。"""

    def __init__(self, path: Path = EMAIL_CODE_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._codes: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        self._codes = data if isinstance(data, dict) else {}

    def _save(self) -> None:
        self.path.write_text(
            json.dumps(self._codes, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _cleanup_expired(self) -> None:
        now = time.time()
        expired = [key for key, item in self._codes.items() if now - float(item.get("ts", 0)) > CODE_TTL_SECS]
        for key in expired:
            self._codes.pop(key, None)

    def create_code(self, email: str) -> str:
        """为邮箱生成 6 位验证码并保存；冷却期内重复请求会抛 ValueError。"""
        email = str(email or "").strip().lower()
        with self._lock:
            self._cleanup_expired()
            existing = self._codes.get(email)
            if existing is not None and time.time() - float(existing.get("ts", 0)) < CODE_RESEND_MIN_INTERVAL_SECS:
                raise ValueError("验证码发送过于频繁，请稍后再试")
            code = f"{secrets.randbelow(1000000):06d}"
            self._codes[email] = {"code": code, "ts": time.time(), "attempts": 0}
            self._save()
        return code

    def verify_code(self, email: str, code: str) -> bool:
        """校验验证码（一次性使用）。"""
        email = str(email or "").strip().lower()
        code = str(code or "").strip()
        with self._lock:
            self._cleanup_expired()
            item = self._codes.get(email)
            if item is None:
                return False
            if time.time() - float(item.get("ts", 0)) > CODE_TTL_SECS:
                self._codes.pop(email, None)
                self._save()
                return False
            if str(item.get("code")) != code:
                item["attempts"] = int(item.get("attempts", 0)) + 1
                if int(item["attempts"]) >= 5:
                    self._codes.pop(email, None)
                self._save()
                return False
            self._codes.pop(email, None)
            self._save()
            return True

    def has_pending_code(self, email: str) -> bool:
        email = str(email or "").strip().lower()
        with self._lock:
            self._cleanup_expired()
            return email in self._codes

    def send_email(self, *, to_email: str, subject: str, body: str, smtp: dict[str, Any]) -> None:
        """通过 SMTP 发送邮件。smtp 为 config 中的 smtp 配置。"""
        host = str(smtp.get("host") or "").strip()
        port = int(smtp.get("port") or 465)
        username = str(smtp.get("username") or "").strip()
        password = str(smtp.get("password") or "").strip()
        from_addr = str(smtp.get("from") or username or "").strip()
        from_name = str(smtp.get("from_name") or "chatgpt2api").strip()
        use_ssl = bool(smtp.get("use_ssl", True))

        if not host or not username or not password:
            raise ValueError("SMTP 未配置完整（host/username/password）")

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = Header(subject, "utf-8")
        msg["From"] = formataddr((str(Header(from_name, "utf-8")), from_addr))
        msg["To"] = to_email

        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=30)
        else:
            server = smtplib.SMTP(host, port, timeout=30)
            server.ehlo()
            server.starttls()
            server.ehlo()
        try:
            server.login(username, password)
            server.sendmail(from_addr, [to_email], msg.as_string())
        finally:
            try:
                server.quit()
            except Exception:
                pass


email_service = EmailService()
