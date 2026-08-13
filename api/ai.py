from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from api.image_inputs import parse_image_edit_request, read_image_sources
from api.support import require_identity, resolve_image_base_url
from services.config import config
from services.content_filter import check_request, request_shape, request_text
from services.editable_file_task_service import editable_file_task_service
from services.log_service import LoggedCall
from services.protocol import (
    anthropic_v1_messages,
    openai_v1_chat_complete,
    openai_v1_image_edit,
    openai_v1_image_generations,
    openai_v1_models,
    openai_v1_response,
    openai_search,
)
from services.third_party_api import (
    chat_completion as third_party_chat_completion,
    chat_completion_stream as third_party_chat_completion_stream,
    default_route as third_party_default_route,
    image_edit as third_party_image_edit,
    image_generation as third_party_image_generation,
    list_third_party_models,
    route_for_model as third_party_route_for_model,
)
from services.user_service import user_service


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str = "gpt-image-2"
    n: int = Field(default=1, ge=1, le=4)
    size: str | None = None
    quality: str = "auto"
    response_format: str = "b64_json"
    history_disabled: bool = True
    stream: bool | None = None


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    prompt: str | None = None
    n: int | None = None
    stream: bool | None = None
    modalities: list[str] | None = None
    messages: list[dict[str, object]] | None = None


class ResponseCreateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    input: object | None = None
    tools: list[dict[str, object]] | None = None
    tool_choice: object | None = None
    stream: bool | None = None


class AnthropicMessageRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    messages: list[dict[str, object]] | None = None
    system: object | None = None
    stream: bool | None = None


class SearchRequest(BaseModel):
    prompt: str = Field(..., min_length=1)


class EditableFileTaskRequest(BaseModel):
    prompt: str = ""
    base64_images: list[str] = Field(default_factory=list)
    client_task_id: str | None = None


async def filter_or_log(call: LoggedCall, text: str) -> None:
    try:
        await run_in_threadpool(check_request, text)
    except HTTPException as exc:
        call.log("调用失败", status="failed", error=str(exc.detail))
        raise


def quota_weight_for(identity: dict[str, object], model: str, count: int = 1) -> int:
    """计算本次请求的额度权重。管理员/无绑定用户不限额。"""
    user_id = identity.get("user_id")
    role = identity.get("role")
    if not user_id or role == "admin":
        return 0
    weight = config.get_model_quota_weight(model)
    return max(1, weight) * max(1, count)


def require_quota(identity: dict[str, object], model: str, count: int = 1) -> int:
    """检查用户额度是否足够，不足抛 429；返回需要扣减的权重（0 表示不限额）。"""
    weight = quota_weight_for(identity, model, count)
    if weight == 0:
        return 0
    user_id = str(identity.get("user_id") or "")
    result = user_service.check_quota(user_id, weight)
    if not result.get("ok"):
        raise HTTPException(status_code=429, detail={"error": result.get("message") or "额度不足"})
    return weight


def deduct_quota(identity: dict[str, object], weight: int, source: str = "generate", note: str = "") -> None:
    if weight <= 0:
        return
    user_id = str(identity.get("user_id") or "")
    if user_id:
        user_service.deduct_quota(user_id, weight, source=source, note=note)


def _next_or_none(items):
    try:
        return True, next(items)
    except StopIteration:
        return False, None


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/v1/models")
    async def list_models(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        try:
            result = await run_in_threadpool(openai_v1_models.list_models)
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc
        # 合并第三方 API 模型
        data = result.get("data")
        if isinstance(data, list):
            seen = {str(item.get("id") or "").strip() for item in data if isinstance(item, dict)}
            for model in list_third_party_models():
                if model and model not in seen:
                    data.append({
                        "id": model,
                        "object": "model",
                        "created": 0,
                        "owned_by": "third_party",
                        "permission": [],
                        "root": model,
                        "parent": None,
                    })
        return result

    @router.post("/v1/images/generations")
    async def generate_images(
            body: ImageGenerationRequest,
            request: Request,
            authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python")
        payload["base_url"] = resolve_image_base_url(request)
        call = LoggedCall(identity, "/v1/images/generations", body.model, "文生图", request_text=body.prompt)
        await filter_or_log(call, body.prompt)
        weight = require_quota(identity, body.model, max(1, body.n))

        # 第三方 API 路由：模型匹配则转发到自定义 OpenAI 兼容图片端点
        third_party = third_party_route_for_model(body.model) or (
            third_party_default_route() if body.model in {"", "auto"} else None
        )
        if third_party is not None:
            try:
                result = await run_in_threadpool(third_party_image_generation, third_party, payload)
                try:
                    from services.third_party_image_download import mirror_result_images

                    result = mirror_result_images(
                        result,
                        resolve_image_base_url(request),
                        str(third_party.get("api_key") or ""),
                    )
                except HTTPException:
                    raise
                except Exception as exc:
                    print(f"[ai] mirror images failed: {exc}")
                    raise HTTPException(status_code=502, detail={"error": "抱歉，出现了错误，这不是你的问题，也不是我的问题，请稍后再试！"}) from exc
                deduct_quota(identity, weight)
                call.log("第三方 API 图片生成完成", result)
                return result
            except HTTPException:
                raise
            except Exception as exc:
                call.log("第三方 API 图片生成失败", status="failed", error=str(exc))
                raise HTTPException(status_code=502, detail={"error": "抱歉，出现了错误，这不是你的问题，也不是我的问题，请稍后再试！"}) from exc

        response = await call.run(openai_v1_image_generations.handle, payload)
        if isinstance(response, StreamingResponse):
            inner = response.body_iterator

            def image_gen_wrapped():
                try:
                    for item in inner:
                        yield item
                finally:
                    deduct_quota(identity, weight)

            response = StreamingResponse(image_gen_wrapped(), media_type=response.media_type, headers=dict(response.headers))
        else:
            deduct_quota(identity, weight)
        return response

    @router.post("/v1/images/edits")
    async def edit_images(
            request: Request,
            authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        payload, image_sources, mask_sources = await parse_image_edit_request(request)
        prompt = str(payload["prompt"])
        model = str(payload["model"])
        call = LoggedCall(identity, "/v1/images/edits", model, "图生图", request_text=prompt)
        await filter_or_log(call, prompt)
        payload["images"] = await read_image_sources(image_sources)
        if mask_sources:
            payload["mask"] = await read_image_sources(mask_sources)
        payload["base_url"] = resolve_image_base_url(request)
        weight = require_quota(identity, model, max(1, int(payload.get("n") or 1)))

        # 第三方 API 路由：模型匹配则转发到自定义 OpenAI 兼容图片编辑端点
        third_party = third_party_route_for_model(model) or (
            third_party_default_route() if model in {"", "auto"} else None
        )
        if third_party is not None:
            try:
                result = await run_in_threadpool(third_party_image_edit, third_party, payload)
                try:
                    from services.third_party_image_download import mirror_result_images

                    result = mirror_result_images(
                        result,
                        resolve_image_base_url(request),
                        str(third_party.get("api_key") or ""),
                    )
                except HTTPException:
                    raise
                except Exception as exc:
                    print(f"[ai] mirror edit images failed: {exc}")
                    raise HTTPException(status_code=502, detail={"error": "抱歉，出现了错误，这不是你的问题，也不是我的问题，请稍后再试！"}) from exc
                deduct_quota(identity, weight)
                call.log("第三方 API 图生图完成", result)
                return result
            except HTTPException:
                raise
            except Exception as exc:
                call.log("第三方 API 图生图失败", status="failed", error=str(exc))
                raise HTTPException(status_code=502, detail={"error": "抱歉，出现了错误，这不是你的问题，也不是我的问题，请稍后再试！"}) from exc

        response = await call.run(openai_v1_image_edit.handle, payload)
        if isinstance(response, StreamingResponse):
            inner = response.body_iterator

            def image_edit_wrapped():
                try:
                    for item in inner:
                        yield item
                finally:
                    deduct_quota(identity, weight)

            response = StreamingResponse(image_edit_wrapped(), media_type=response.media_type, headers=dict(response.headers))
        else:
            deduct_quota(identity, weight)
        return response

    @router.post("/v1/chat/completions")
    async def create_chat_completion(body: ChatCompletionRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python")
        model = str(payload.get("model") or "auto")
        request_preview = request_text(payload.get("prompt"), payload.get("messages"))
        call = LoggedCall(
            identity,
            "/v1/chat/completions",
            model,
            "文本生成",
            request_text=request_preview,
            request_shape=request_shape(payload.get("messages")),
        )
        await filter_or_log(call, request_preview)

        # 第三方 API 路由：模型匹配则转发到自定义 OpenAI 兼容端点
        third_party = third_party_route_for_model(model) or (
            third_party_default_route() if model in {"", "auto"} else None
        )
        if third_party is not None:
            weight = require_quota(identity, model, 1)
            is_stream = bool(payload.get("stream"))
            try:
                if is_stream:
                    stream_items = third_party_chat_completion_stream(third_party, payload)
                    has_first, first = await run_in_threadpool(_next_or_none, stream_items)

                    def gen():
                        try:
                            if has_first:
                                yield first
                            for line in stream_items:
                                yield line
                        finally:
                            deduct_quota(identity, weight)

                    call.log("第三方 API 流式调用", status="success")
                    return StreamingResponse(gen(), media_type="text/event-stream")
                result = await run_in_threadpool(third_party_chat_completion, third_party, payload)
                deduct_quota(identity, weight)
                call.log("第三方 API 调用完成", result)
                return result
            except HTTPException:
                raise
            except Exception as exc:
                call.log("第三方 API 调用失败", status="failed", error=str(exc))
                raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc

        weight = require_quota(identity, model, 1)
        response = await call.run(openai_v1_chat_complete.handle, payload)
        if not isinstance(response, StreamingResponse):
            deduct_quota(identity, weight)
        else:
            inner = response.body_iterator

            def wrapped_gen():
                try:
                    for item in inner:
                        yield item
                finally:
                    deduct_quota(identity, weight)

            response = StreamingResponse(wrapped_gen(), media_type=response.media_type, headers=dict(response.headers))
        return response

    @router.post("/v1/responses")
    async def create_response(body: ResponseCreateRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python")
        model = str(payload.get("model") or "auto")
        request_preview = request_text(payload.get("input"), payload.get("instructions"))
        call = LoggedCall(
            identity,
            "/v1/responses",
            model,
            "Responses",
            request_text=request_preview,
            request_shape=request_shape(payload.get("input")),
        )
        await filter_or_log(call, request_preview)
        weight = require_quota(identity, model, 1)
        response = await call.run(openai_v1_response.handle, payload)
        if not isinstance(response, StreamingResponse):
            deduct_quota(identity, weight)
        else:
            inner = response.body_iterator

            def resp_wrapped():
                try:
                    for item in inner:
                        yield item
                finally:
                    deduct_quota(identity, weight)

            response = StreamingResponse(resp_wrapped(), media_type=response.media_type, headers=dict(response.headers))
        return response

    @router.post("/v1/messages")
    async def create_message(
            body: AnthropicMessageRequest,
            authorization: str | None = Header(default=None),
            x_api_key: str | None = Header(default=None, alias="x-api-key"),
            anthropic_version: str | None = Header(default=None, alias="anthropic-version"),
    ):
        identity = require_identity(authorization or (f"Bearer {x_api_key}" if x_api_key else None))
        payload = body.model_dump(mode="python")
        model = str(payload.get("model") or "auto")
        request_preview = request_text(payload.get("system"), payload.get("messages"), payload.get("tools"))
        call = LoggedCall(identity, "/v1/messages", model, "Messages", request_text=request_preview)
        await filter_or_log(call, request_preview)
        weight = require_quota(identity, model, 1)
        response = await call.run(anthropic_v1_messages.handle, payload, sse="anthropic")
        if not isinstance(response, StreamingResponse):
            deduct_quota(identity, weight)
        else:
            inner = response.body_iterator

            def msg_wrapped():
                try:
                    for item in inner:
                        yield item
                finally:
                    deduct_quota(identity, weight)

            response = StreamingResponse(msg_wrapped(), media_type=response.media_type, headers=dict(response.headers))
        return response

    @router.post("/v1/search")
    async def search(body: SearchRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        call = LoggedCall(identity, "/v1/search", openai_search.MODEL, "搜索", request_text=body.prompt)
        await filter_or_log(call, body.prompt)
        weight = require_quota(identity, openai_search.MODEL, 1)
        response = await call.run(openai_search.handle, body.model_dump(mode="python"))
        if not isinstance(response, StreamingResponse):
            deduct_quota(identity, weight)
        else:
            inner = response.body_iterator

            def search_wrapped():
                try:
                    for item in inner:
                        yield item
                finally:
                    deduct_quota(identity, weight)

            response = StreamingResponse(search_wrapped(), media_type=response.media_type, headers=dict(response.headers))
        return response

    @router.get("/v1/editable-file-tasks")
    async def list_editable_file_tasks(ids: str = "", authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        task_ids = [item.strip() for item in ids.split(",") if item.strip()]
        return await run_in_threadpool(editable_file_task_service.list_tasks, identity, task_ids)

    @router.get("/files/{file_path:path}")
    async def download_editable_file(file_path: str):
        try:
            path = await run_in_threadpool(editable_file_task_service.public_file_path, file_path)
        except Exception as exc:
            raise HTTPException(status_code=404, detail={"error": "file not found"}) from exc
        return FileResponse(path, filename=path.name)

    @router.post("/v1/ppt/generations")
    async def create_ppt_task(body: EditableFileTaskRequest, request: Request, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        await filter_or_log(LoggedCall(identity, "/v1/ppt/generations", "gpt-5-5-thinking", "PPT生成任务", request_text=body.prompt), body.prompt)
        return await run_in_threadpool(
            editable_file_task_service.submit_ppt,
            identity,
            client_task_id=body.client_task_id or "",
            prompt=body.prompt,
            base64_images=body.base64_images,
            base_url=resolve_image_base_url(request),
        )

    @router.post("/v1/psd/generations")
    async def create_psd_task(body: EditableFileTaskRequest, request: Request, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        await filter_or_log(LoggedCall(identity, "/v1/psd/generations", "gpt-5-5-thinking", "PSD生成任务", request_text=body.prompt), body.prompt)
        return await run_in_threadpool(
            editable_file_task_service.submit_psd,
            identity,
            client_task_id=body.client_task_id or "",
            prompt=body.prompt,
            base64_images=body.base64_images,
            base_url=resolve_image_base_url(request),
        )

    return router
