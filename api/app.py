from __future__ import annotations

from contextlib import asynccontextmanager
from threading import Event, Thread

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from api import accounts, ai, image_tasks, records, system, users
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
        try:
            yield
        finally:
            stop_event.set()
            thread.join(timeout=1)
            cleanup_thread.join(timeout=1)
            backup_service.stop()

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
    app.include_router(image_tasks.create_router())
    app.include_router(system.create_router(app_version))
    app.include_router(users.create_router())
    app.include_router(records.create_router())

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
