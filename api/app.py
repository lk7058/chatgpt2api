from __future__ import annotations

import json
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from threading import Event, Lock, Thread

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

from api import accounts, ai, api_keys, email_templates, image_tasks, mcp, records, system, users
from api.errors import install_exception_handlers
from api.support import resolve_web_asset, start_limited_account_watcher
from services.backup_service import backup_service
from services.config import config
from services.image_service import start_image_cleanup_scheduler
from services.user_service import user_service


def create_app() -> FastAPI:
    app_version = config.app_version

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        stop_event = Event()
        thread = start_limited_account_watcher(stop_event)
        cleanup_thread = start_image_cleanup_scheduler(stop_event)
        backup_service.start()
        config.cleanup_old_images()
        # 后台预热 tiktoken 编码表（避免首个请求在受限网络下卡在 BPE 下载）
        def _warmup_tiktoken() -> None:
            try:
                from services.protocol.conversation import encoding_for_model

                encoding_for_model("gpt-4o")
            except Exception:
                pass

        warmup_thread = Thread(target=_warmup_tiktoken, daemon=True)
        warmup_thread.start()
        # 首次启动时根据 config.json 的 admin_account 自动创建管理员
        try:
            admin_account = config.admin_account
            if admin_account.get("username") and admin_account.get("password"):
                user_service.ensure_admin(admin_account["username"], admin_account["password"])
                print(f"[users] admin account '{admin_account['username']}' ready")
        except Exception as exc:
            print(f"[users] ensure admin failed: {exc}")
        # MCP Streamable HTTP 会话管理器：必须先 run() 才能处理请求（SDK 缺失不影响启动）
        mcp_mgr_ctx = None
        try:
            from api.mcp_server import get_mcp_session_manager

            mcp_mgr_ctx = get_mcp_session_manager().run()
            await mcp_mgr_ctx.__aenter__()
            print("[mcp] MCP session manager started")
        except Exception as exc:
            mcp_mgr_ctx = None
            print(f"[mcp] MCP session manager start skipped: {exc}")
        try:
            yield
        finally:
            stop_event.set()
            thread.join(timeout=1)
            cleanup_thread.join(timeout=1)
            backup_service.stop()
            if mcp_mgr_ctx is not None:
                try:
                    await mcp_mgr_ctx.__aexit__(None, None, None)
                    print("[mcp] MCP session manager stopped")
                except Exception as exc:
                    print(f"[mcp] MCP session manager stop failed: {exc}")

    app = FastAPI(title="chatgpt2api", version=app_version, lifespan=lifespan)
    install_exception_handlers(app)

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        return response

    @app.middleware("http")
    async def mcp_auth_middleware(request: Request, call_next):
        """MCP 端点鉴权：每次调用校验 ①全站开关 ②Key 有效性 ③用户 MCP 是否启用。"""
        path = request.url.path
        if path == "/mcp" or path.startswith("/mcp/"):
            if not config.mcp_enabled:
                return JSONResponse(status_code=403, content={"detail": {"error": "MCP 服务已关闭"}})
            authorization = str(request.headers.get("authorization") or "")
            scheme, _, value = authorization.partition(" ")
            raw_key = value.strip() if scheme.lower() == "bearer" else ""
            if not raw_key:
                return JSONResponse(status_code=401, content={"detail": {"error": "缺少 MCP Key"}})
            user = user_service.find_user_by_mcp_key(raw_key)
            if user is None:
                return JSONResponse(status_code=401, content={"detail": {"error": "MCP Key 无效"}})
            if not bool(user.get("mcp_enabled", True)):
                return JSONResponse(status_code=403, content={"detail": {"error": "MCP 功能已被禁用"}})
            base_url = f"{request.url.scheme}://{request.headers.get('host', request.url.netloc)}"
            identity = {
                "id": user.get("id"),
                "name": user.get("username"),
                "username": user.get("username"),
                "role": "user",
                "user_id": user.get("id"),
                "session": True,
                "mcp": True,
                "base_url": base_url,
            }
            try:
                from api.mcp_server import mcp_identity_var
            except Exception:
                return JSONResponse(status_code=503, content={"detail": {"error": "MCP 服务不可用"}})
            token = mcp_identity_var.set(identity)
            try:
                return await call_next(request)
            finally:
                mcp_identity_var.reset(token)
        return await call_next(request)

    # ── 对外 API（/v1/*，API Key 调用）限制 ─────────────────────
    # 只作用于 auth_service 的 API Key（sk-...）；站内 session / 管理员不受影响。
    _api_active: dict[str, set[str]] = {}
    _api_daily: dict[str, tuple[str, int]] = {}
    _api_lock = Lock()

    def _api_marker(request: Request) -> str:
        return f"{id(request)}"

    def _api_acquire_concurrency(user_id: str, limit: int, marker: str) -> bool:
        with _api_lock:
            active = _api_active.setdefault(user_id, set())
            if len(active) >= limit and marker not in active:
                return False
            active.add(marker)
            return True

    def _api_release_concurrency(user_id: str, marker: str) -> None:
        with _api_lock:
            active = _api_active.get(user_id)
            if active:
                active.discard(marker)
                if not active:
                    _api_active.pop(user_id, None)

    def _api_bump_daily(user_id: str, limit: int) -> bool:
        today = datetime.now().strftime("%Y-%m-%d")
        with _api_lock:
            date, count = _api_daily.get(user_id, ("", 0))
            if date != today:
                date, count = today, 0
            if count >= limit:
                return False
            _api_daily[user_id] = (date, count + 1)
            return True

    async def _api_key_model_allowed(request: Request, bound_model: str) -> bool:
        """Key 绑定模型的校验：仅对 JSON 请求体读取 model 字段（multipart 等跳过）。"""
        content_type = str(request.headers.get("content-type") or "").lower()
        if "application/json" not in content_type:
            return True
        try:
            raw = await request.body()
            data = json.loads(raw or b"{}")
        except Exception:
            return True
        requested = str((data.get("model") if isinstance(data, dict) else "") or "").strip()
        if not requested:
            return True
        return requested == bound_model

    @app.middleware("http")
    async def api_guard_middleware(request: Request, call_next):
        path = request.url.path
        if not path.startswith("/v1/"):
            return await call_next(request)
        authorization = str(request.headers.get("authorization") or "")
        scheme, _, value = authorization.partition(" ")
        raw_key = value.strip() if scheme.lower() == "bearer" else ""
        if not raw_key:
            return await call_next(request)
        from services.auth_service import auth_service

        key_item = auth_service.authenticate(raw_key)
        if key_item is None:
            return await call_next(request)
        # 以下为有效 API Key 调用
        if not config.api_enabled:
            return JSONResponse(status_code=403, content={"detail": {"error": "API 服务已关闭，请联系管理员开启"}})
        user_id = str(key_item.get("user_id") or "")
        role = str(key_item.get("role") or "")
        marker = _api_marker(request)
        if role != "admin" and user_id:
            user = user_service.get_user(user_id)
            if user is None or not bool(user.get("enabled", True)):
                return JSONResponse(status_code=403, content={"detail": {"error": "账号已被禁用"}})
            if not bool(user.get("api_enabled", True)):
                return JSONResponse(status_code=403, content={"detail": {"error": "你的 API 功能已被管理员关闭"}})
            daily_limit = int(user.get("api_daily_limit", 0) or 0)
            if daily_limit > 0 and not _api_bump_daily(user_id, daily_limit):
                return JSONResponse(status_code=429, content={"detail": {"error": f"已达今日 API 调用次数上限（{daily_limit} 次）"}})
            concurrency = int(user.get("api_concurrency", 0) or 0)
            if concurrency > 0 and not _api_acquire_concurrency(user_id, concurrency, marker):
                return JSONResponse(status_code=429, content={"detail": {"error": f"API 并发调用超限（最多 {concurrency} 个并发）"}})
        bound_model = str(key_item.get("model") or "").strip()
        if bound_model and not await _api_key_model_allowed(request, bound_model):
            return JSONResponse(status_code=403, content={"detail": {"error": f"该 API Key 仅限调用模型 {bound_model}"}})
        try:
            return await call_next(request)
        finally:
            if role != "admin" and user_id:
                _api_release_concurrency(user_id, marker)

    # 静态导出与 API 同源部署，禁止跨域（收紧默认 allow_origins=["*"]）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # 静态资源 gzip 压缩（JS/CSS 传输体积可减 60%+）
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.include_router(ai.create_router())
    app.include_router(accounts.create_router())
    app.include_router(api_keys.create_router())
    app.include_router(email_templates.create_router())
    app.include_router(image_tasks.create_router())
    app.include_router(system.create_router(app_version))
    app.include_router(users.create_router())
    app.include_router(records.create_router())
    app.include_router(mcp.create_router())

    # MCP Streamable HTTP 端点（/mcp）：mcp SDK 未安装时不影响主服务启动。
    # 注意：Starlette 1.0 的 Mount 不匹配裸路径 /mcp，须用显式 Route + 类式 ASGI app。
    try:
        from api.mcp_server import MCPHTTPApp
        from starlette.routing import Route

        app.router.routes.append(Route("/mcp", endpoint=MCPHTTPApp(), methods=["GET", "POST", "DELETE"], name="mcp"))
        print("[mcp] MCP server mounted at /mcp")
    except Exception as exc:  # pragma: no cover
        print(f"[mcp] MCP server mount skipped: {exc}")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_web(full_path: str):
        asset = resolve_web_asset(full_path)
        if asset is not None:
            # Next 静态产物带 contenthash，可长期缓存；HTML 不缓存
            if full_path.startswith("_next/static/") or full_path == "favicon.ico":
                return FileResponse(asset, headers={"Cache-Control": "public, max-age=31536000, immutable"})
            return FileResponse(asset, headers={"Cache-Control": "no-cache"})
        if full_path.strip("/").startswith("_next/"):
            raise HTTPException(status_code=404, detail="Not Found")
        fallback = resolve_web_asset("")
        if fallback is None:
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(fallback, headers={"Cache-Control": "no-cache"})

    return app
