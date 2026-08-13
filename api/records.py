from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from api.support import require_identity
from services.generation_record_service import generation_record_service

# 超过该长度的 dataUrl（base64 图片）在列表接口中剥离，避免每次打开画图页传输数十 MB
HEAVY_BASE64_LEN = 50_000


def _strip_heavy_payload(obj: Any) -> Any:
    """递归剥离超大 base64 图片数据（结果图等），保留 url 与小图（参考图）。

    - 结果图的 b64_json（无 data: 前缀的裸 base64，单张可达数 MB）直接丢弃，展示用 url；
    - 超大 dataUrl（data:image/...）同样剥离，参考图/小图原样保留。
    """
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for key, value in obj.items():
            if key == "b64_json" and isinstance(value, str) and value:
                # 列表接口只用于展示，url 已足够；跨设备编辑时可回源 url 重建参考图
                continue
            if (
                isinstance(value, str)
                and value.startswith("data:image/")
                and len(value) > HEAVY_BASE64_LEN
            ):
                # 超大 base64 直接跳过（保留 url 字段用于展示/编辑）
                continue
            out[key] = _strip_heavy_payload(value)
        return out
    if isinstance(obj, list):
        return [_strip_heavy_payload(item) for item in obj]
    return obj


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
        items = generation_record_service.list_records(user_id, limit=limit)
        # 剥离超大 base64，避免每次加载传输数十 MB（图片用本地 URL 展示）
        return {"items": [_strip_heavy_payload(item) for item in items]}

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
