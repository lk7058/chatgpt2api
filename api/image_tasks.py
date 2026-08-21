from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api.image_inputs import parse_image_edit_request, read_image_sources
from api.support import client_ip, require_admin, require_identity, resolve_image_base_url
from services.config import config
from services.content_filter import check_request
from services.image_task_service import image_task_service
from services.log_service import LoggedCall


class ImageGenerationTaskRequest(BaseModel):
    client_task_id: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    model: str = "gpt-image-2"
    size: str | None = None
    quality: str = "auto"
    tier: str | None = None


class ResumePollRequest(BaseModel):
    extra_timeout_secs: float = Field(default=30.0, ge=5.0, le=120.0)


class CancelTasksRequest(BaseModel):
    task_ids: list[str] = []


class AdminCancelTasksRequest(BaseModel):
    task_ids: list[str] = []
    all_tasks: bool = False


def _parse_task_ids(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


async def filter_or_log(call: LoggedCall, text: str) -> None:
    try:
        await run_in_threadpool(check_request, text)
    except HTTPException as exc:
        call.log("调用失败", status="failed", error=str(exc.detail))
        raise


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/image-tasks")
    async def list_image_tasks(
        ids: str = Query(default=""),
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        return await run_in_threadpool(image_task_service.list_tasks, identity, _parse_task_ids(ids))

    @router.post("/api/image-tasks/generations")
    async def create_generation_task(
        body: ImageGenerationTaskRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        await filter_or_log(LoggedCall(identity, "/api/image-tasks/generations", body.model, "文生图任务", request_text=body.prompt, client_ip=client_ip(request)), body.prompt)
        # 额度检查（不足直接拒绝提交）
        from api.ai import require_image_quota

        require_image_quota(identity, body.model, 1, size=body.size, tier=body.tier)
        try:
            return await run_in_threadpool(
                image_task_service.submit_generation,
                identity,
                client_task_id=body.client_task_id,
                prompt=body.prompt,
                model=body.model,
                size=body.size,
                quality=body.quality,
                tier=body.tier,
                client_ip=client_ip(request),
                base_url=resolve_image_base_url(request),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/edits")
    async def create_edit_task(
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        payload, image_sources, mask_sources = await parse_image_edit_request(request)
        client_task_id = str(payload.get("client_task_id") or "").strip()
        if not client_task_id:
            raise HTTPException(status_code=400, detail={"error": "client_task_id is required"})
        prompt = str(payload["prompt"])
        model = str(payload["model"])
        await filter_or_log(LoggedCall(identity, "/api/image-tasks/edits", model, "图生图任务", request_text=prompt, client_ip=client_ip(request)), prompt)
        images = await read_image_sources(image_sources)
        masks = await read_image_sources(mask_sources) if mask_sources else None
        # 额度检查（不足直接拒绝提交）
        from api.ai import require_image_quota

        require_image_quota(identity, model, 1, size=payload.get("size"), tier=payload.get("tier"))
        try:
            return await run_in_threadpool(
                image_task_service.submit_edit,
                identity,
                client_task_id=client_task_id,
                prompt=prompt,
                model=model,
                size=payload["size"],
                quality=payload["quality"],
                tier=payload.get("tier"),
                client_ip=client_ip(request),
                base_url=resolve_image_base_url(request),
                images=images,
                masks=masks,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/cancel")
    async def cancel_image_tasks(body: CancelTasksRequest, authorization: str | None = Header(default=None)):
        """用户取消自己的排队/进行中任务。"""
        identity = require_identity(authorization)
        return await run_in_threadpool(image_task_service.cancel_tasks, identity, body.task_ids)

    @router.get("/api/admin/image-tasks")
    async def admin_list_image_tasks(authorization: str | None = Header(default=None)):
        """管理员查看全部任务。"""
        identity = require_admin(authorization)
        return await run_in_threadpool(image_task_service.list_admin_tasks, identity)

    @router.post("/api/admin/image-tasks/cancel")
    async def admin_cancel_image_tasks(body: AdminCancelTasksRequest, authorization: str | None = Header(default=None)):
        """管理员批量/一键取消未完成任务。"""
        identity = require_admin(authorization)
        return await run_in_threadpool(
            image_task_service.cancel_tasks_admin,
            identity,
            body.task_ids,
            body.all_tasks,
        )

    @router.post("/api/admin/image-tasks/{task_id}/refund")
    async def admin_refund_image_task(task_id: str, authorization: str | None = Header(default=None)):
        """管理员退还指定任务消耗的积分（仅已扣费的完成任务，不可重复退还）。"""
        require_admin(authorization)
        try:
            return await run_in_threadpool(image_task_service.refund_task, task_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/{task_id}/resume-poll")
    async def resume_image_poll(
        task_id: str,
        body: ResumePollRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            return await run_in_threadpool(
                image_task_service.resume_poll,
                identity,
                task_id,
                body.extra_timeout_secs,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    return router
