from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from api.support import require_identity
from services.generation_record_service import generation_record_service


class RecordUpsertRequest(BaseModel):
    id: str = ""
    kind: str = "image"
    title: str = ""
    payload: object = Field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""


def create_router() -> APIRouter:
    router = APIRouter()

    def _user_id(authorization: str | None) -> str:
        identity = require_identity(authorization)
        user_id = identity.get("user_id")
        if not user_id:
            raise HTTPException(status_code=403, detail={"error": "请使用账号登录后使用云同步功能"})
        return str(user_id)

    @router.get("/api/records")
    async def list_records(
        limit: int = Query(default=200, ge=1, le=1000),
        authorization: str | None = Header(default=None),
    ):
        user_id = _user_id(authorization)
        return {"items": generation_record_service.list_records(user_id, limit=limit)}

    @router.post("/api/records")
    async def upsert_record(body: RecordUpsertRequest, authorization: str | None = Header(default=None)):
        user_id = _user_id(authorization)
        record = body.model_dump(mode="python")
        record["payload"] = body.payload
        item = generation_record_service.upsert_record(user_id, record)
        return {"item": item}

    @router.delete("/api/records/{record_id}")
    async def delete_record(record_id: str, authorization: str | None = Header(default=None)):
        user_id = _user_id(authorization)
        if not generation_record_service.delete_record(user_id, record_id):
            raise HTTPException(status_code=404, detail={"error": "记录不存在"})
        return {"ok": True}

    @router.delete("/api/records")
    async def clear_records(authorization: str | None = Header(default=None)):
        user_id = _user_id(authorization)
        count = generation_record_service.clear_records(user_id)
        return {"ok": True, "removed": count}

    return router
