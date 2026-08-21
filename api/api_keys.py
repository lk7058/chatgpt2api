from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from api.support import require_admin, require_identity
from services.auth_service import auth_service
from services.config import config
from services.log_service import log_service
from services.user_service import user_service


class CreateApiKeyRequest(BaseModel):
    name: str = ""
    model: str = ""


class UpdateApiKeyRequest(BaseModel):
    name: str | None = None
    model: str | None = None
    enabled: bool | None = None


class AdminApiSettingsRequest(BaseModel):
    enabled: bool | None = None
    common_models: list[str] | None = None


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/my/api-keys")
    async def list_my_api_keys(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        items = auth_service.list_keys_by_user(user_id)
        result: list[dict[str, object]] = []
        for item in items:
            key_id = str(item.get("id") or "")
            result.append({
                **item,
                "call_count": log_service.count_by_key(key_id),
            })
        return {"items": result}

    @router.get("/api/my/api-keys/info")
    async def my_api_keys_info(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        user = user_service.get_user(user_id) if user_id else None
        return {
            "global_enabled": bool(config.api_enabled),
            "user_enabled": bool(user.get("api_enabled", True)) if user else True,
            "api_concurrency": int(user.get("api_concurrency", 0) or 0) if user else 0,
            "api_daily_limit": int(user.get("api_daily_limit", 0) or 0) if user else 0,
        }

    @router.post("/api/my/api-keys")
    async def create_my_api_key(body: CreateApiKeyRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        if not user_id:
            raise HTTPException(status_code=400, detail={"error": "当前会话不支持生成 API Key"})
        item, raw_key = auth_service.create_key(
            role="user",
            name=body.name.strip(),
            user_id=user_id,
            model=body.model.strip(),
        )
        return {"item": item, "key": raw_key}

    @router.patch("/api/my/api-keys/{key_id}")
    async def update_my_api_key(key_id: str, body: UpdateApiKeyRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        updates: dict[str, object] = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.model is not None:
            updates["model"] = body.model
        if body.enabled is not None:
            updates["enabled"] = body.enabled
        try:
            item = auth_service.update_key(key_id, updates, role="user")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None or (user_id and str(item.get("user_id") or "") != user_id):
            raise HTTPException(status_code=404, detail={"error": "API Key 不存在"})
        return {"item": item}

    @router.delete("/api/my/api-keys/{key_id}")
    async def delete_my_api_key(key_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        item = auth_service.get_key(key_id, user_id=user_id)
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "API Key 不存在"})
        removed = auth_service.delete_key(key_id, role="user")
        if not removed:
            raise HTTPException(status_code=404, detail={"error": "API Key 不存在"})
        return {"ok": True}

    @router.get("/api/my/api-keys/{key_id}/calls")
    async def list_my_api_key_calls(
        key_id: str,
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        user_id = str(identity.get("user_id") or "")
        item = auth_service.get_key(key_id, user_id=user_id)
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "API Key 不存在"})
        items = await run_in_threadpool(log_service.list_by_key, key_id, limit, offset)
        calls: list[dict[str, object]] = []
        for log_item in items:
            detail = log_item.get("detail")
            if not isinstance(detail, dict):
                continue
            calls.append({
                "time": str(log_item.get("time") or ""),
                "endpoint": str(detail.get("endpoint") or ""),
                "model": str(detail.get("model") or ""),
                "status": str(detail.get("status") or ""),
                "duration_ms": detail.get("duration_ms"),
                "ip": str(detail.get("ip") or ""),
                "error": str(detail.get("error") or ""),
            })
        return {"items": calls, "total": log_service.count_by_key(key_id)}

    # ── 管理员：对外 API 全局开关 ────────────────────────────

    @router.get("/api/admin/api-settings")
    async def get_admin_api_settings(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {
            "enabled": bool(config.api_enabled),
            "common_models": config.api_common_models,
        }

    @router.put("/api/admin/api-settings")
    async def put_admin_api_settings(body: AdminApiSettingsRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        updates: dict[str, object] = {}
        if body.enabled is not None:
            updates["api_enabled"] = body.enabled
        if body.common_models is not None:
            from services.config import _normalize_string_list

            updates["api_common_models"] = _normalize_string_list(body.common_models)
        if updates:
            config.update(updates)
        return {
            "enabled": bool(config.api_enabled),
            "common_models": config.api_common_models,
        }

    return router
