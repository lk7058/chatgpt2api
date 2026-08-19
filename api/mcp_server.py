from __future__ import annotations

import json
import uuid
from contextvars import ContextVar
from typing import Any

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from mcp import types
from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

from api.ai import require_quota
from services.config import config
from services.content_filter import check_request
from services.image_task_service import image_task_service
from services.mcp_service import mcp_log_service
from services.user_service import user_service

# 中间件在通过 MCP Key 鉴权后写入的请求身份信息（含 base_url）
mcp_identity_var: ContextVar[dict[str, Any] | None] = ContextVar("mcp_identity", default=None)


def _identity() -> dict[str, Any] | None:
    return mcp_identity_var.get()


def _text(content: str) -> list[types.ContentBlock]:
    return [types.TextContent(type="text", text=content)]


def _result(payload: dict[str, Any]) -> list[types.ContentBlock]:
    return _text(json.dumps(payload, ensure_ascii=False))


async def _handle_generate_image(arguments: dict[str, Any]) -> list[types.ContentBlock]:
    identity = _identity()
    if identity is None:
        return _result({"ok": False, "error": "未授权：MCP Key 无效或已被禁用"})
    user_id = str(identity.get("user_id") or "")
    username = str(identity.get("username") or "")
    prompt = str(arguments.get("prompt") or "").strip()
    if not prompt:
        return _result({"ok": False, "error": "缺少 prompt 参数"})
    model = str(arguments.get("model") or "gpt-image-2").strip() or "gpt-image-2"
    size = str(arguments.get("size") or "").strip() or None
    quality = str(arguments.get("quality") or "auto").strip() or "auto"

    # 敏感词检查（与站内一致）
    try:
        await run_in_threadpool(check_request, prompt)
    except HTTPException as exc:
        mcp_log_service.add(user_id=user_id, username=username, tool="generate_image", status="error", message="内容不合规")
        return _result({"ok": False, "error": str(exc.detail)})

    # 额度检查（与站内一致，不足直接拒绝）
    try:
        require_quota(identity, model, 1)
    except HTTPException as exc:
        mcp_log_service.add(user_id=user_id, username=username, tool="generate_image", status="error", message="额度不足")
        return _result({"ok": False, "error": str(exc.detail)})

    client_task_id = uuid.uuid4().hex[:24]
    try:
        task = image_task_service.submit_generation(
            identity,
            client_task_id=client_task_id,
            prompt=prompt,
            model=model,
            size=size,
            quality=quality,
            base_url=str(identity.get("base_url") or ""),
        )
    except ValueError as exc:
        mcp_log_service.add(user_id=user_id, username=username, tool="generate_image", status="error", message=str(exc))
        return _result({"ok": False, "error": str(exc)})

    # 同步等待结果（后台线程继续执行；最多等待约 4 分钟）
    task = image_task_service.wait_for_task(identity, client_task_id, timeout_secs=240.0, poll_interval=2.0)

    status = str(task.get("status") or "")
    if status == "success":
        data = task.get("data") or []
        urls = [item.get("url") for item in data if isinstance(item, dict) and item.get("url")]
        b64_items = [item.get("b64_json") for item in data if isinstance(item, dict) and item.get("b64_json")]
        images = urls or [f"data:image/png;base64,{value}" for value in b64_items]
        weight = config.get_model_quota_weight(model)
        mcp_log_service.add(user_id=user_id, username=username, tool="generate_image", status="ok", message="生图成功", quota_delta=weight)
        user_service.bump_mcp_usage(user_id)
        return _result({"ok": True, "task_id": client_task_id, "model": model, "images": images, "count": len(images)})
    if status == "error":
        error_msg = str(task.get("error") or "生图失败")
        mcp_log_service.add(user_id=user_id, username=username, tool="generate_image", status="error", message=error_msg)
        return _result({"ok": False, "error": error_msg, "task_id": client_task_id})
    # 仍在排队/生成中（超时返回，任务在后台继续）
    mcp_log_service.add(
        user_id=user_id,
        username=username,
        tool="generate_image",
        status="pending",
        message=f"任务仍在处理中（{status}）",
    )
    return _result({
        "ok": True,
        "pending": True,
        "task_id": client_task_id,
        "status": status,
        "message": "图片任务仍在后台处理，可稍后重试查询或等待图片完成",
    })


async def _handle_get_quota(arguments: dict[str, Any]) -> list[types.ContentBlock]:
    identity = _identity()
    if identity is None:
        return _result({"ok": False, "error": "未授权：MCP Key 无效或已被禁用"})
    user_id = str(identity.get("user_id") or "")
    username = str(identity.get("username") or "")
    user = user_service.get_public_user(user_id) if user_id else None
    if user is None:
        mcp_log_service.add(user_id=user_id, username=username, tool="get_quota", status="error", message="用户不存在")
        return _result({"ok": False, "error": "用户不存在"})
    quota_total = int(user.get("quota_total", 0) or 0)
    quota_used = int(user.get("quota_used", 0) or 0)
    quota_left = quota_total - quota_used if quota_total >= 0 else -1
    mcp_log_service.add(user_id=user_id, username=username, tool="get_quota", status="ok", message="额度查询")
    user_service.bump_mcp_usage(user_id)
    return _result({
        "ok": True,
        "quota_total": quota_total,
        "quota_used": quota_used,
        "quota_left": quota_left,
    })


TOOL_GENERATE_IMAGE = types.Tool(
    name="generate_image",
    description="生成图片：根据提示词调用站内生图服务，费用从当前账号额度中扣除（与站内直接调用一致）。返回图片地址列表。",
    inputSchema={
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "图片提示词（支持中文）"},
            "model": {"type": "string", "description": "模型，默认 gpt-image-2"},
            "size": {"type": "string", "description": "图片尺寸，如 1024x1024，可选"},
            "quality": {"type": "string", "description": "质量：auto / low / medium / high，默认 auto"},
        },
        "required": ["prompt"],
        "additionalProperties": False,
    },
)

TOOL_GET_QUOTA = types.Tool(
    name="get_quota",
    description="查询当前账号剩余额度。返回剩余、已用与总额度（-1 表示不限量）。",
    inputSchema={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
)


def build_mcp_server() -> Server:
    """构建 MCP Server：仅开放 generate_image / get_quota 两项工具。"""
    server = Server("chatgpt2api")

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [TOOL_GENERATE_IMAGE, TOOL_GET_QUOTA]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[types.ContentBlock]:
        args = arguments if isinstance(arguments, dict) else {}
        if name == "generate_image":
            return await _handle_generate_image(args)
        if name == "get_quota":
            return await _handle_get_quota(args)
        raise ValueError(f"未知工具: {name}")

    return server


# ── Streamable HTTP 装配 ──────────────────────────────────────
# 关键点（issue #1367）：StreamableHTTPSessionManager 必须先 run()（在
# 主应用 lifespan 中执行）才能处理请求，否则 /mcp 会因任务组未初始化而
# 500。因此这里只暴露单例 manager 与纯 ASGI handler，由 app.py 的
# lifespan 负责启停 manager。
_mcp_manager: StreamableHTTPSessionManager | None = None


def get_mcp_session_manager() -> StreamableHTTPSessionManager:
    """进程级单例：整个应用共用一个会话管理器（只能 run() 一次）。"""
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = StreamableHTTPSessionManager(app=build_mcp_server())
    return _mcp_manager


async def handle_mcp_http(scope: Any, receive: Any, send: Any) -> None:
    """/mcp 挂载点 ASGI 处理器：Key 鉴权通过后由会话管理器分发 JSON-RPC。"""
    await get_mcp_session_manager().handle_request(scope, receive, send)


class MCPHTTPApp:
    """Starlette Route 端点包装：Starlette 1.0 的 Mount 不匹配裸路径 /mcp
    （只匹配 /mcp/xxx），MCP 客户端恰好只请求裸路径，故用显式 Route + 类式
    ASGI app 挂载（与 FastMCP/2.x 的 StreamableHTTPASGIApp 同思路）。"""

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        await handle_mcp_http(scope, receive, send)
