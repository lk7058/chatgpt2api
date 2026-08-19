from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from api.support import require_admin, require_identity
from services.config import config
from services.mcp_service import generate_mcp_key, mcp_log_service
from services.user_service import user_service


class McpUserEnabledRequest(BaseModel):
    enabled: bool = True


class McpSettingsRequest(BaseModel):
    enabled: bool = True


def create_router() -> APIRouter:
    router = APIRouter()

    # ── 用户端：专属 MCP Key 管理 ────────────────────────────

    @router.get("/api/mcp/info")
    async def get_mcp_info(authorization: str | None = Header(default=None)):
        """当前用户 MCP 状态：全局开关、个人开关、Key 信息与调用统计。"""
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        user = user_service.get_public_user(user_id) if user_id else None
        if user is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {
            "global_enabled": config.mcp_enabled,
            "mcp_enabled": bool(user.get("mcp_enabled", True)),
            "has_key": bool(user.get("mcp_key_hint")),
            "key_hint": user.get("mcp_key_hint") or "",
            "key_created_at": user.get("mcp_key_created_at") or "",
            "call_count": int(user.get("mcp_call_count", 0) or 0),
            "last_used_at": user.get("mcp_last_used_at") or "",
            "endpoint": "/mcp",
        }

    @router.post("/api/mcp/key")
    async def create_mcp_key(authorization: str | None = Header(default=None)):
        """生成/重置当前用户的专属 MCP Key（旧 Key 立即失效）。"""
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "当前账号不支持 MCP 服务"})
        if user_service.get_user(user_id) is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        raw_key = generate_mcp_key()
        item = user_service.set_mcp_key(user_id, raw_key)
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"key": raw_key, "item": item}

    # ── 管理端：全局开关 ─────────────────────────────────────

    @router.get("/api/admin/mcp/settings")
    async def get_mcp_settings(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"mcp": config.get_mcp_settings()}

    @router.post("/api/admin/mcp/settings")
    async def save_mcp_settings(body: McpSettingsRequest, authorization: str | None = Header(default=None)):
        """全局开关：关闭后所有用户的 MCP 调用立即失效。"""
        require_admin(authorization)
        config.update({"mcp": {"enabled": bool(body.enabled)}})
        return {"mcp": config.get_mcp_settings()}

    # ── 管理端：逐用户管理 ───────────────────────────────────

    @router.get("/api/admin/mcp/users")
    async def admin_list_mcp_users(authorization: str | None = Header(default=None)):
        """每个用户的 MCP 启用状态、Key 信息与调用情况。"""
        require_admin(authorization)
        items = []
        for user in user_service.list_users():
            items.append({
                "user_id": user.get("id"),
                "username": user.get("username"),
                "email": user.get("email") or "",
                "role": user.get("role"),
                "mcp_enabled": bool(user.get("mcp_enabled", True)),
                "has_key": bool(user.get("mcp_key_hint")),
                "key_hint": user.get("mcp_key_hint") or "",
                "key_created_at": user.get("mcp_key_created_at") or "",
                "call_count": int(user.get("mcp_call_count", 0) or 0),
                "last_used_at": user.get("mcp_last_used_at") or "",
            })
        items.sort(key=lambda item: str(item.get("username") or "").lower())
        return {"items": items, "global_enabled": config.mcp_enabled}

    @router.post("/api/admin/mcp/users/{user_id}/reset-key")
    async def admin_reset_mcp_key(user_id: str, authorization: str | None = Header(default=None)):
        """重置指定用户 MCP Key：旧 Key 立即失效，返回新 Key（仅展示一次）。"""
        require_admin(authorization)
        raw_key = generate_mcp_key()
        item = user_service.set_mcp_key(user_id, raw_key)
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"key": raw_key, "item": item}

    @router.post("/api/admin/mcp/users/{user_id}/enabled")
    async def admin_set_mcp_user_enabled(
        user_id: str,
        body: McpUserEnabledRequest,
        authorization: str | None = Header(default=None),
    ):
        """关闭/开启单个用户的 MCP 功能。"""
        require_admin(authorization)
        item = user_service.set_mcp_enabled(user_id, bool(body.enabled))
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "用户不存在"})
        return {"item": item}

    # ── 管理端：调用日志 ─────────────────────────────────────

    @router.get("/api/admin/mcp/logs")
    async def admin_list_mcp_logs(
        user_id: str = Query(default=""),
        tool: str = Query(default=""),
        limit: int = Query(default=200),
        authorization: str | None = Header(default=None),
    ):
        """MCP 调用日志：调用时间、用户、工具类型、状态与额度消耗。"""
        require_admin(authorization)
        return {
            "items": await run_in_threadpool(
                mcp_log_service.list_logs,
                user_id=user_id.strip(),
                tool=tool.strip(),
                limit=limit,
            )
        }

    return router
