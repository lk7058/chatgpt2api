from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from api.rate_limit import code_limiter, login_limiter
from api.support import client_ip, require_admin, require_identity
from services.config import config
from services.user_service import user_service


def _send_scene_email(scene: str, to_email: str, code: str, smtp: dict) -> None:
    """按邮件场景发送邮件：优先使用自定义模板（HTML），否则使用内置默认文案。"""
    from datetime import datetime

    from services.email_service import email_service
    from services.email_template_service import email_template_service

    subject, body, is_html = email_template_service.render_scene(
        scene,
        {
            "username": to_email.split("@", 1)[0],
            "email": to_email,
            "code": code,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "time": datetime.now().strftime("%H:%M"),
            "site_title": config.site_title,
        },
    )
    email_service.send_email(to_email=to_email, subject=subject, body=body, smtp=smtp, html=is_html)


class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""


class RegisterRequest(BaseModel):
    username: str = ""
    password: str = Field(..., min_length=8, max_length=128)
    email: str = ""
    captcha_id: str = ""
    captcha_code: str = ""


class SendEmailCodeRequest(BaseModel):
    email: str = ""
    captcha_id: str = ""
    captcha_code: str = ""


class RegisterVerifyRequest(BaseModel):
    username: str = ""
    password: str = Field(..., min_length=8, max_length=128)
    email: str = ""
    code: str = ""


class QuotaRequest(BaseModel):
    quota_total: int


class QuotaAmountRequest(BaseModel):
    amount: int = 1


class RedeemRequest(BaseModel):
    code: str = ""


class RedeemGenerateRequest(BaseModel):
    count: int = 1
    amount: int = 1


class PasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    old_password: str = ""
    new_password: str = Field(..., min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str = ""
    captcha_id: str = ""
    captcha_code: str = ""


class ResetPasswordRequest(BaseModel):
    email: str = ""
    code: str = ""
    new_password: str = Field(..., min_length=8, max_length=128)


class BindEmailRequest(BaseModel):
    email: str = ""


class BindEmailVerifyRequest(BaseModel):
    email: str = ""
    code: str = ""


class EnabledRequest(BaseModel):
    enabled: bool = True


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/public-settings")
    async def get_public_settings():
        """公开配置（无需登录，前端标题、Turnstile site key 等）。"""
        turnstile = config.get_public_turnstile_settings()
        return {
            "site_title": config.site_title,
            "allowed_email_domains": config.allowed_email_domains,
            "turnstile_site_key": str(turnstile.get("site_key") or "") if turnstile.get("enabled") else "",
            "turnstile_enabled": bool(turnstile.get("enabled")),
        }

    @router.post("/auth/register")
    async def register(body: RegisterRequest, request: Request):
        """注册第一步：人机验证 + 发送邮箱验证码。"""
        if not config.registration_enabled:
            raise HTTPException(status_code=403, detail={"error": "当前未开放注册，请联系管理员"})
        email = body.email.strip().lower()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail={"error": "请填写有效邮箱"})
        # 邮箱域名白名单限制
        allowed_domains = config.allowed_email_domains
        if allowed_domains:
            domain = email.split("@", 1)[1] if "@" in email else ""
            if domain not in allowed_domains:
                raise HTTPException(
                    status_code=400,
                    detail={"error": f"仅支持 {', '.join(allowed_domains)} 邮箱注册"},
                )
        # 验证码发送冷却（按 IP 限流）
        client_ip = request.client.host if request.client else ""
        if code_limiter.is_blocked(client_ip):
            raise HTTPException(status_code=429, detail={"error": "操作过于频繁，请稍后再试"})
        # Cloudflare Turnstile 人机验证
        from services.turnstile_service import verify_turnstile_token

        turnstile_result = verify_turnstile_token(body.captcha_code)
        if not turnstile_result.get("ok"):
            raise HTTPException(status_code=400, detail={"error": turnstile_result.get("error") or "人机验证失败，请重试"})
        # 检查邮箱是否已被注册
        for user in user_service.list_users():
            if str(user.get("email") or "").lower() == email:
                raise HTTPException(status_code=400, detail={"error": "该邮箱已被注册"})
        smtp = config.smtp_settings
        if not smtp.get("enabled") or not smtp.get("host"):
            raise HTTPException(status_code=400, detail={"error": "系统暂未开启邮箱验证，请联系管理员"})
        from services.email_service import email_service

        try:
            code = email_service.create_code(email)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        code_limiter.record_failure(client_ip)
        try:
            _send_scene_email("register_code", email, code, smtp)
        except Exception:
            raise HTTPException(status_code=500, detail={"error": "邮件发送失败，请稍后再试或联系管理员"}) from None
        return {"ok": True, "message": "验证码已发送到邮箱，请查收"}

    @router.post("/auth/register/verify")
    async def register_verify(body: RegisterVerifyRequest):
        """注册第二步：校验邮箱验证码并创建用户。"""
        if not config.registration_enabled:
            raise HTTPException(status_code=403, detail={"error": "当前未开放注册，请联系管理员"})
        email = body.email.strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail={"error": "请填写邮箱"})
        from services.email_service import email_service

        if not email_service.verify_code(email, body.code.strip()):
            raise HTTPException(status_code=400, detail={"error": "验证码错误或已过期"})
        try:
            user = user_service.create_user(
                email,
                body.password,
                role="user",
                quota_total=0,
                email=email,
                email_verified=True,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        from services.log_service import log_service

        log_service.add("auth", "注册成功", {"email": email, "ip": client_ip(request)})
        token = user_service.create_session(user["id"])
        return {
            "ok": True,
            "token": token,
            "role": user.get("role"),
            "subject_id": user.get("id"),
            "name": user.get("username"),
            "user": user,
        }

    @router.post("/auth/forgot-password")
    async def forgot_password(body: ForgotPasswordRequest, request: Request):
        """找回密码第一步：向绑定邮箱发送重置验证码。"""
        email = body.email.strip().lower()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail={"error": "请填写有效邮箱"})
        # 验证码发送冷却（按 IP 限流）
        client_ip = request.client.host if request.client else ""
        if code_limiter.is_blocked(client_ip):
            raise HTTPException(status_code=429, detail={"error": "操作过于频繁，请稍后再试"})
        # Cloudflare Turnstile 人机验证（未启用时自动跳过）
        from services.turnstile_service import verify_turnstile_token

        turnstile_result = verify_turnstile_token(body.captcha_code)
        if not turnstile_result.get("ok"):
            raise HTTPException(status_code=400, detail={"error": turnstile_result.get("error") or "人机验证失败，请重试"})
        # 邮箱必须已绑定且已验证；未绑定时统一返回成功文案，避免账号枚举
        user = user_service.get_by_email(email)
        if user is None or not bool(user.get("email_verified")):
            return {"ok": True, "message": "如果该邮箱已绑定账号，验证码已发送到邮箱"}
        smtp = config.smtp_settings
        if not smtp.get("enabled") or not smtp.get("host"):
            raise HTTPException(status_code=400, detail={"error": "系统暂未开启邮箱服务，请联系管理员"})
        from services.email_service import email_service

        try:
            code = email_service.create_code(email)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        code_limiter.record_failure(client_ip)
        try:
            _send_scene_email("forgot_code", email, code, smtp)
        except Exception:
            raise HTTPException(status_code=500, detail={"error": "邮件发送失败，请稍后再试或联系管理员"}) from None
        return {"ok": True, "message": "验证码已发送到邮箱，请查收"}

    @router.post("/auth/forgot-password/verify")
    async def forgot_password_verify(body: ResetPasswordRequest):
        """找回密码第二步：校验验证码并重置密码（同时撤销该用户所有会话）。"""
        email = body.email.strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail={"error": "请填写邮箱"})
        from services.email_service import email_service

        if not email_service.verify_code(email, body.code.strip()):
            raise HTTPException(status_code=400, detail={"error": "验证码错误或已过期"})
        user = user_service.get_by_email(email)
        if user is None:
            raise HTTPException(status_code=400, detail={"error": "该邮箱未绑定账号"})
        try:
            user_service.update_password(str(user["id"]), body.new_password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        user_service.revoke_user_sessions(str(user["id"]))
        return {"ok": True, "message": "密码已重置，请使用新密码登录"}

    @router.post("/auth/login")
    async def login(body: LoginRequest, request: Request, authorization: str | None = Header(default=None)):
        # 邮箱密码登录
        email = str(body.username or "").strip().lower()
        password = str(body.password or "").strip()
        if email and password:
            # 登录失败限流：同 IP+邮箱 5 次失败锁定 15 分钟
            client_ip_addr = client_ip(request)
            limiter_key = f"{client_ip_addr}|{email}"
            if login_limiter.is_blocked(limiter_key):
                raise HTTPException(status_code=429, detail={"error": "尝试次数过多，请 15 分钟后再试"})
            user = user_service.authenticate(email, password)
            from services.log_service import log_service

            if user is None:
                login_limiter.record_failure(limiter_key)
                log_service.add("auth", "登录失败", {"email": email, "ip": client_ip_addr, "status": "failed"})
                raise HTTPException(status_code=401, detail={"error": "邮箱或密码错误"})
            login_limiter.clear(limiter_key)
            # 记录登录时间与 IP（用于用户管理展示）
            user_service.record_login(user["id"], client_ip_addr)
            log_service.add("auth", "登录成功", {"email": email, "ip": client_ip_addr, "status": "success"})
            token = user_service.create_session(user["id"])
            return {
                "ok": True,
                "token": token,
                "role": user.get("role"),
                "subject_id": user.get("id"),
                "name": user.get("username"),
                "user": user,
            }
        # 兼容：Bearer 密钥登录（管理员密钥 / 专用密钥）
        identity = require_identity(authorization)
        return {
            "ok": True,
            "version": config.app_version,
            "role": identity.get("role"),
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
        }

    @router.post("/auth/logout")
    async def logout(request: Request, authorization: str | None = Header(default=None)):
        from api.support import extract_bearer_token

        token = extract_bearer_token(authorization)
        email = ""
        if token:
            user = user_service.resolve_session(token)
            if user is not None:
                email = str(user.get("email") or user.get("username") or "")
            user_service.revoke_session(token)
        if email:
            from services.log_service import log_service

            log_service.add("auth", "退出登录", {"email": email, "ip": client_ip(request), "status": "success"})
        return {"ok": True}

    @router.get("/api/me")
    async def get_me(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            return {
                "ok": True,
                "role": identity.get("role"),
                "subject_id": identity.get("id"),
                "name": identity.get("name"),
                "user": None,
                "quota_left": -1,
                "quota_total": -1,
            }
        user = user_service.get_public_user(str(user_id))
        if user is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {
            "ok": True,
            "role": identity.get("role"),
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
            "user": user,
            "quota_left": user.get("quota_left"),
            "quota_total": user.get("quota_total"),
            "quota_used": user.get("quota_used"),
        }

    @router.get("/api/checkin/status")
    async def get_checkin_status(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后签到"})
        return user_service.get_checkin_status(str(user_id))

    @router.post("/api/checkin")
    async def do_checkin(request: Request, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后签到"})
        result = user_service.checkin(str(user_id))
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail={"error": result.get("error") or "签到失败"})
        user = user_service.get_public_user(str(user_id))
        from services.log_service import log_service

        log_service.add(
            "checkin",
            "签到成功",
            {
                "email": str((user or {}).get("email") or ""),
                "ip": client_ip(request),
                "bonus": result.get("bonus_quota", 0),
                "streak": result.get("checkin_streak", 0),
            },
        )
        return result

    # ── 用户中心：额度流水 / 签到日历 / 修改密码 ─────────────

    @router.get("/api/quota/records")
    async def get_quota_records(
        limit: int = Query(default=100, ge=1, le=500),
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后查看"})
        from services.quota_record_service import quota_record_service

        return {
            "items": quota_record_service.list_records(str(user_id), limit=limit),
            "summary": quota_record_service.summary(str(user_id)),
        }

    @router.get("/api/quota/records/all")
    async def get_all_quota_records(authorization: str | None = Header(default=None)):
        """管理员：查看所有用户的额度流水。"""
        require_admin(authorization)
        from services.quota_record_service import QUOTA_RECORD_FILE

        try:
            import json as _json

            data = _json.loads(QUOTA_RECORD_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        items: list[dict] = []
        for user_id, records in (data or {}).items():
            for record in records if isinstance(records, list) else []:
                item = dict(record)
                item["user_id"] = user_id
                items.append(item)
        items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return {"items": items}

    @router.get("/api/checkin/calendar")
    async def get_checkin_calendar(
        days: int = Query(default=60, ge=1, le=365),
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后查看"})
        from services.quota_record_service import quota_record_service

        return {"dates": quota_record_service.checkin_dates(str(user_id), limit_days=days)}

    @router.post("/api/me/password")
    async def change_my_password(body: ChangePasswordRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后修改密码"})
        user = user_service.get_public_user(str(user_id))
        if user is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        # 验证原密码
        if not user_service.verify_password(str(user_id), body.old_password):
            raise HTTPException(status_code=400, detail={"error": "原密码错误"})
        try:
            item = user_service.update_password(str(user_id), body.new_password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"ok": True, "item": item}

    @router.post("/api/me/email/send-code")
    async def send_bind_email_code(body: BindEmailRequest, request: Request, authorization: str | None = Header(default=None)):
        """用户中心：向待绑定邮箱发送验证码。"""
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后绑定邮箱"})
        email = body.email.strip().lower()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail={"error": "请填写有效邮箱"})
        # 邮箱不能已被他人绑定
        existing = user_service.get_by_email(email)
        if existing is not None and str(existing.get("id")) != str(user_id):
            raise HTTPException(status_code=400, detail={"error": "该邮箱已被其他账号绑定"})
        # 验证码发送冷却（按 IP 限流）
        client_ip = request.client.host if request.client else ""
        if code_limiter.is_blocked(client_ip):
            raise HTTPException(status_code=429, detail={"error": "操作过于频繁，请稍后再试"})
        smtp = config.smtp_settings
        if not smtp.get("enabled") or not smtp.get("host"):
            raise HTTPException(status_code=400, detail={"error": "系统暂未开启邮箱服务，请联系管理员"})
        from services.email_service import email_service

        try:
            code = email_service.create_code(email)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        code_limiter.record_failure(client_ip)
        try:
            _send_scene_email("bind_code", email, code, smtp)
        except Exception:
            raise HTTPException(status_code=500, detail={"error": "邮件发送失败，请稍后再试或联系管理员"}) from None
        return {"ok": True, "message": "验证码已发送到邮箱，请查收"}

    @router.post("/api/me/email/bind")
    async def bind_email(body: BindEmailVerifyRequest, authorization: str | None = Header(default=None)):
        """用户中心：校验验证码并绑定邮箱。"""
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后绑定邮箱"})
        email = body.email.strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail={"error": "请填写邮箱"})
        existing = user_service.get_by_email(email)
        if existing is not None and str(existing.get("id")) != str(user_id):
            raise HTTPException(status_code=400, detail={"error": "该邮箱已被其他账号绑定"})
        from services.email_service import email_service

        if not email_service.verify_code(email, body.code.strip()):
            raise HTTPException(status_code=400, detail={"error": "验证码错误或已过期"})
        try:
            item = user_service.update_email(str(user_id), email, verified=True)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"ok": True, "item": item}

    # ── 管理员：用户管理 ─────────────────────────────────────

    @router.get("/api/users")
    async def list_users(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"items": user_service.list_users()}

    @router.post("/api/users")
    async def create_user(body: RegisterRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        email = body.email.strip().lower()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail={"error": "请填写有效邮箱"})
        if user_service.get_by_email(email) is not None:
            raise HTTPException(status_code=400, detail={"error": "该邮箱已被注册"})
        try:
            user = user_service.create_user(email, body.password, role="user", quota_total=0, email=email, email_verified=True)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": user, "items": user_service.list_users()}

    @router.post("/api/users/{user_id}/quota/add")
    async def add_user_quota(user_id: str, body: QuotaAmountRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = user_service.add_quota(user_id, body.amount)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"item": item}

    @router.post("/api/users/{user_id}/quota/subtract")
    async def subtract_user_quota(user_id: str, body: QuotaAmountRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = user_service.subtract_quota(user_id, body.amount)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"item": item}

    @router.post("/api/users/{user_id}/quota/reset")
    async def reset_user_quota(user_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        item = user_service.reset_quota(user_id)
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"item": item}

    # 兼容旧接口（直接设置总额度）
    @router.post("/api/users/{user_id}/quota")
    async def set_user_quota(user_id: str, body: QuotaRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = user_service.set_quota(user_id, body.quota_total)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"item": item}

    @router.post("/api/users/{user_id}/password")
    async def reset_user_password(user_id: str, body: PasswordRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = user_service.update_password(user_id, body.password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        user_service.revoke_user_sessions(user_id)
        return {"item": item}

    @router.post("/api/users/{user_id}/enabled")
    async def set_user_enabled(user_id: str, body: EnabledRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        item = user_service.set_enabled(user_id, body.enabled)
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        if not body.enabled:
            user_service.revoke_user_sessions(user_id)
        return {"item": item}

    @router.delete("/api/users/{user_id}")
    async def delete_user(user_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            removed = user_service.delete_user(user_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if not removed:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        user_service.revoke_user_sessions(user_id)
        from services.generation_record_service import generation_record_service

        generation_record_service.delete_user_records(user_id)
        return {"ok": True, "items": user_service.list_users()}

    # ── 额度充值卡（管理员生成 / 用户兑换） ──────────────────

    @router.post("/api/redeem-codes/generate")
    async def generate_redeem_codes(body: RedeemGenerateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        from services.redeem_service import redeem_service

        try:
            created = redeem_service.generate_codes(
                count=body.count,
                amount=body.amount,
                creator=str(require_identity(authorization).get("id") or ""),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"items": created, "count": len(created)}

    @router.get("/api/redeem-codes")
    async def list_redeem_codes(
        status: str = Query(default=""),
        limit: int = Query(default=200, ge=1, le=1000),
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        from services.redeem_service import redeem_service

        return {"items": redeem_service.list_codes(limit=limit, status=status)}

    @router.delete("/api/redeem-codes/{code_id}")
    async def delete_redeem_code(code_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        from services.redeem_service import redeem_service

        removed = redeem_service.delete_code(code_id)
        if not removed:
            raise HTTPException(status_code=404, detail={"error": "卡密不存在"})
        return {"ok": True}

    @router.post("/api/redeem")
    async def redeem_code(body: RedeemRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后兑换"})
        from services.redeem_service import redeem_service

        try:
            result = redeem_service.redeem(body.code, str(user_id), str(identity.get("name") or ""))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        # 增加用户额度（记录收入流水）
        user_service.add_quota(str(user_id), result["amount"], note="充值卡兑换")
        user = user_service.get_public_user(str(user_id))
        return {
            "ok": True,
            "amount": result["amount"],
            "code": result["code"],
            "user": user,
            "quota_left": user.get("quota_left") if user else None,
        }

    @router.get("/api/redeem/mine")
    async def my_redeems(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后查看"})
        from services.redeem_service import redeem_service

        return {"items": redeem_service.list_my_redeems(str(user_id))}

    # ── SMTP 测试 ────────────────────────────────────────────

    @router.post("/api/smtp/test")
    async def test_smtp(body: SendEmailCodeRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        email = body.email.strip()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail={"error": "请填写有效收件邮箱"})
        smtp = config.smtp_settings
        if not smtp.get("host"):
            raise HTTPException(status_code=400, detail={"error": "SMTP 未配置"})
        from services.email_service import email_service

        try:
            _send_scene_email("smtp_test", email, "——", smtp)
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"error": f"发送失败：{exc}"}) from exc
        return {"ok": True, "message": "测试邮件已发送"}

    return router
