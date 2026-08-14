from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from api.support import require_admin, require_identity, resolve_image_base_url
from services.announcement_service import announcement_service
from services.backup_service import BackupError, backup_service
from services.config import config
from services.image_service import (
    compress_images,
    delete_images,
    delete_to_target,
    download_images_zip,
    get_image_download_response,
    get_image_response,
    get_thumbnail_response,
    list_images,
    storage_stats,
)
from services.image_storage_service import ImageStorageError, image_storage_service
from services.image_tags_service import delete_tag, get_all_tags, set_tags
from services.log_service import log_service
from services.proxy_service import proxy_settings, test_clearance, test_proxy
from services.third_party_api import list_models as list_third_party_models_endpoint
from services.third_party_api import test_connection as test_third_party_connection


class SettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ProxyTestRequest(BaseModel):
    url: str = ""


class ClearanceTestRequest(BaseModel):
    target_url: str = "https://chatgpt.com"


class ImageDeleteRequest(BaseModel):
    paths: list[str] = []
    start_date: str = ""
    end_date: str = ""
    all_matching: bool = False


class AnnouncementItemRequest(BaseModel):
    title: str = ""
    content: str = ""
    link: str = ""
    enabled: bool = False


class AnnouncementSaveRequest(BaseModel):
    popup: AnnouncementItemRequest = Field(default_factory=AnnouncementItemRequest)
    banner: AnnouncementItemRequest = Field(default_factory=AnnouncementItemRequest)

class ImageDownloadRequest(BaseModel):
    paths: list[str]

class ImageTagsRequest(BaseModel):
    path: str
    tags: list[str]

class LogDeleteRequest(BaseModel):
    ids: list[str] = []
class BackupDeleteRequest(BaseModel):
    key: str = ""


class ThirdPartyApiUpsertRequest(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    api_key: str = ""
    models: list[str] = []
    enabled: bool = True
    default: bool = False


def create_router(app_version: str) -> APIRouter:
    router = APIRouter()

    @router.get("/version")
    async def get_version():
        return {"version": app_version}

    @router.get("/api/settings")
    async def get_settings(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"config": config.get()}

    @router.get("/api/third-party-apps")
    async def get_third_party_apps(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        return {"third_party_apps": config.get_third_party_apps_settings()}

    @router.post("/api/settings")
    async def save_settings(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"config": config.update(body.model_dump(mode="python"))}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/images")
    async def get_images(request: Request, start_date: str = "", end_date: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(
            list_images,
            resolve_image_base_url(request),
            start_date=start_date.strip(),
            end_date=end_date.strip(),
        )

    @router.get("/images/{image_path:path}", include_in_schema=False)
    async def get_image(image_path: str):
        return await run_in_threadpool(get_image_response, image_path)

    @router.get("/image-thumbnails/{image_path:path}", include_in_schema=False)
    async def get_image_thumbnail(image_path: str):
        return await run_in_threadpool(get_thumbnail_response, image_path)

    @router.post("/api/images/delete")
    async def delete_images_endpoint(body: ImageDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return delete_images(body.paths, start_date=body.start_date.strip(), end_date=body.end_date.strip(), all_matching=body.all_matching)

    @router.post("/api/images/download")
    async def download_images_endpoint(body: ImageDownloadRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        buf = download_images_zip(body.paths)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="images.zip"'},
        )

    @router.get("/api/images/download/{image_path:path}")
    async def download_single_image_endpoint(image_path: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return get_image_download_response(image_path)

    @router.get("/api/logs")
    async def get_logs(
        type: str = "",
        start_date: str = "",
        end_date: str = "",
        user_id: str = "",
        email: str = "",
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        items = log_service.list(
            type=type.strip(),
            start_date=start_date.strip(),
            end_date=end_date.strip(),
            user_id=user_id.strip(),
            email=email.strip(),
        )
        # 调用日志注入用户邮箱：按 detail.key_id（用户 id）查用户
        from services.user_service import user_service

        email_cache: dict[str, str] = {}
        for item in items:
            detail = item.get("detail")
            if not isinstance(detail, dict):
                continue
            key_id = str(detail.get("key_id") or "")
            if not key_id or detail.get("email"):
                continue
            if key_id not in email_cache:
                user = user_service.get_user(key_id)
                email_cache[key_id] = str(user.get("email") or "") if user else ""
            if email_cache[key_id]:
                detail["email"] = email_cache[key_id]
        return {"items": items}

    @router.post("/api/logs/delete")
    async def delete_logs(body: LogDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return log_service.delete(body.ids)

    @router.post("/api/proxy/test")
    async def test_proxy_endpoint(body: ProxyTestRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"result": await run_in_threadpool(test_proxy, (body.url or "").strip())}

    @router.get("/api/proxy/runtime")
    async def get_proxy_runtime_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {
            "runtime": config.get_public_proxy_runtime_settings(),
            "status": proxy_settings.get_runtime_status(),
        }

    @router.post("/api/proxy/runtime")
    async def save_proxy_runtime_endpoint(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            config.update({"proxy_runtime": body.model_dump(mode="python")})
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {
            "runtime": config.get_public_proxy_runtime_settings(),
            "status": proxy_settings.get_runtime_status(),
        }

    @router.post("/api/proxy/clearance/test")
    async def test_proxy_clearance_endpoint(body: ClearanceTestRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"result": await run_in_threadpool(test_clearance, body.target_url)}

    @router.get("/api/storage/info")
    async def get_storage_info(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        storage = config.get_storage_backend()
        return {
            "backend": storage.get_backend_info(),
            "health": storage.health_check(),
        }

    @router.post("/api/backup/test")
    async def test_backup_connection(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(backup_service.test_connection)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-storage/test")
    async def test_image_storage_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"result": await run_in_threadpool(image_storage_service.test_webdav)}

    @router.post("/api/image-storage/sync")
    async def sync_image_storage_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(image_storage_service.sync_all)}
        except ImageStorageError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups")
    async def get_backups(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {
                "items": await run_in_threadpool(backup_service.list_backups),
                "state": backup_service.get_status(),
                "settings": backup_service.get_settings(),
            }
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/backups/run")
    async def run_backup_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(backup_service.run_backup)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/backups/delete")
    async def delete_backup_endpoint(body: BackupDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            await run_in_threadpool(backup_service.delete_backup, body.key)
            return {"ok": True}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups/detail")
    async def get_backup_detail(key: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"item": await run_in_threadpool(backup_service.get_backup_detail, key)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups/download")
    async def download_backup_endpoint(key: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = await run_in_threadpool(backup_service.download_backup, key)
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        filename = str(item.get("name") or "backup.bin")
        quoted = quote(filename)
        headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            "Content-Length": str(int(item.get("size") or 0)),
        }
        return Response(
            content=bytes(item.get("payload") or b""),
            media_type=str(item.get("content_type") or "application/octet-stream"),
            headers=headers,
        )


    @router.get("/api/images/tags")
    async def list_image_tags(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"tags": get_all_tags()}

    @router.post("/api/images/tags")
    async def update_image_tags(body: ImageTagsRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        rel = body.path.strip().lstrip("/")
        if not rel:
            raise HTTPException(status_code=400, detail={"error": "path is required"})
        tags = set_tags(rel, body.tags)
        return {"ok": True, "tags": tags}

    @router.delete("/api/images/tags/{tag}")
    async def delete_image_tag(tag: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        count = delete_tag(tag)
        return {"ok": True, "removed_from": count}

    @router.get("/api/images/storage")
    async def get_image_storage(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return storage_stats()

    @router.post("/api/images/storage/compress")
    async def compress_all_images(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(compress_images)

    @router.post("/api/images/storage/cleanup-to-target")
    async def cleanup_to_target(
        target_free_mb: int = 500,
        dry_run: bool = False,
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        return await run_in_threadpool(delete_to_target, target_free_mb, dry_run)

    @router.get("/api/public-announcements")
    async def get_public_announcements():
        """公开接口：返回已启用的弹窗公告与广告栏（无需登录）。"""
        return announcement_service.get_public()

    @router.get("/api/admin/announcements")
    async def get_announcements(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return announcement_service.get_admin()

    @router.post("/api/admin/announcements")
    async def save_announcements(body: AnnouncementSaveRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(
            announcement_service.save,
            body.popup.model_dump(),
            body.banner.model_dump(),
        )

    @router.get("/health", response_model=None)
    async def health_dashboard(format: str = Query(default="html"), authorization: str | None = Header(default=None)):
        # 号池/存储情报仅管理员可访问：移除公开监控页（HTML 与 JSON 模式均需登录）
        require_admin(authorization)
        from services.account_service import account_service as acct_svc
        stats = acct_svc.get_stats()
        storage = config.get_storage_backend()
        storage_health = storage.health_check()
        healthy = stats["active"] > 0

        stats_json = {
            "status": "ok" if healthy else "degraded",
            "healthy": healthy,
            "version": app_version,
            "storage": {"backend": storage.get_backend_info(), "health": storage_health},
            "proxy_runtime": proxy_settings.get_runtime_status(),
            "accounts": stats,
        }
        if format == "json":
            return stats_json
        return HTMLResponse(f"""<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>号池健康监控 - chatgpt2api</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}}
.header{{background:#1a1d27;border-bottom:1px solid #2a2d3a;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}}
.header h1{{font-size:20px}}
.status-dot{{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}}
.status-ok{{background:#22c55e;box-shadow:0 0 8px #22c55e88}}
.status-degraded{{background:#f59e0b;box-shadow:0 0 8px #f59e0b88}}
.container{{max-width:960px;margin:0 auto;padding:24px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}}
.card{{background:#1a1d27;border:1px solid #2a2d3a;border-radius:10px;padding:16px}}
.card .value{{font-size:28px;font-weight:700;margin:4px 0}}
.card .label{{font-size:13px;color:#94a3b8}}
.green{{color:#22c55e}}.yellow{{color:#f59e0b}}.red{{color:#ef4444}}.blue{{color:#6c63ff}}
table{{width:100%;border-collapse:collapse;background:#1a1d27;border:1px solid #2a2d3a;border-radius:10px;overflow:hidden}}
th{{background:#242836;font-weight:600;text-align:left;padding:10px 12px;font-size:12px;color:#94a3b8;text-transform:uppercase}}
td{{padding:8px 12px;border-top:1px solid #2a2d3a;font-size:14px}}tr:hover td{{background:rgba(108,99,255,.05)}}
.api-url{{font-family:monospace;font-size:12px;color:#6c63ff}}
.refresh{{font-size:12px;color:#64748b;text-align:center;margin-top:24px}}
</style>
<meta http-equiv="refresh" content="30">
</head>
<body>
<div class="header">
<h1><span class="status-dot {'status-ok' if healthy else 'status-degraded'}"></span>号池健康监控</h1>
<div style="font-size:13px;color:#94a3b8">v{app_version} · 30s 自动刷新</div>
</div>
<div class="container">
<div class="cards">
<div class="card"><div class="label">号池状态</div><div class="value {'green' if healthy else 'yellow'}">{'正常' if healthy else '异常'}</div></div>
<div class="card"><div class="label">当前账号</div><div class="value blue">{stats['total']}</div></div>
<div class="card"><div class="label">累计入库</div><div class="value">{stats['cumulative_total']}</div></div>
<div class="card"><div class="label">可用账号</div><div class="value green">{stats['active']}</div></div>
<div class="card"><div class="label">剩余额度</div><div class="value">{stats['total_quota']}</div></div>
<div class="card"><div class="label">限流</div><div class="value yellow">{stats['limited']}</div></div>
<div class="card"><div class="label">异常</div><div class="value red">{stats['abnormal']}</div></div>
<div class="card"><div class="label">禁用</div><div class="value">{stats['disabled']}</div></div>
<div class="card"><div class="label">成功/失败</div><div class="value">{stats['total_success']}<span style="font-size:18px;color:#94a3b8">/</span><span class="red">{stats['total_fail']}</span></div></div>
</div>
<h2 style="margin-bottom:12px;font-size:16px">账号类型分布</h2>
<table>
<tr><th>类型</th><th>数量</th></tr>
{''.join(f'<tr><td>{t}</td><td>{c}</td></tr>' for t,c in sorted(stats['by_type'].items()))}
</table>
<div class="refresh">JSON: <span class="api-url">/health?format=json</span></div>
</div></body></html>""")

    @router.get("/api/third-party-apis")
    async def list_third_party_apis(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"items": config.get_third_party_apis_settings()}

    @router.post("/api/third-party-apis")
    async def upsert_third_party_api(body: ThirdPartyApiUpsertRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        name = body.name.strip()
        base_url = body.base_url.strip()
        if not name:
            raise HTTPException(status_code=400, detail={"error": "名称不能为空"})
        if not base_url:
            raise HTTPException(status_code=400, detail={"error": "API 地址不能为空"})
        from services.config import _normalize_third_party_api_item
        import uuid as _uuid

        items = config.third_party_apis
        incoming = {
            "id": body.id.strip(),
            "name": name,
            "base_url": base_url,
            "api_key": body.api_key.strip(),
            "models": [str(item).strip() for item in body.models if str(item).strip()],
            "enabled": body.enabled,
            "default": body.default,
        }
        if incoming["id"]:
            target = next((item for item in items if str(item.get("id")) == incoming["id"]), None)
            if target is None:
                raise HTTPException(status_code=404, detail={"error": "第三方 API 不存在"})
            if not incoming["api_key"]:
                incoming["api_key"] = str(target.get("api_key") or "")
            incoming["created_at"] = str(target.get("created_at") or "")
            items = [incoming if str(item.get("id")) == incoming["id"] else item for item in items]
        else:
            incoming["id"] = _uuid.uuid4().hex[:8]
            incoming["created_at"] = ""
            items = [*items, incoming]
        # Key 单独保存到 data/third_party_keys.json，config.json 不落盘明文 Key
        from services.config import set_third_party_api_key

        set_third_party_api_key(str(incoming["id"]), str(incoming.get("api_key") or ""))
        incoming["api_key"] = ""
        items = [
            {**item, "api_key": ""} if str(item.get("id")) == str(incoming["id"]) else item
            for item in items
        ]
        normalized = _normalize_third_party_api_item(incoming)
        if normalized is None:
            raise HTTPException(status_code=400, detail={"error": "配置无效"})
        try:
            config.update({"third_party_apis": items})
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        items_public = config.get_third_party_apis_settings()
        item_public = next((item for item in items_public if str(item.get("id")) == str(incoming["id"])), None) or items_public[-1]
        return {"item": item_public, "items": items_public}

    @router.post("/api/third-party-apis/test")
    async def test_third_party_api_endpoint(body: ThirdPartyApiUpsertRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        item = {
            "name": body.name.strip(),
            "base_url": body.base_url.strip(),
            "api_key": body.api_key.strip(),
        }
        return {"result": await run_in_threadpool(test_third_party_connection, item)}

    @router.post("/api/third-party-apis/models")
    async def fetch_third_party_models_endpoint(body: ThirdPartyApiUpsertRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        item = {
            "name": body.name.strip(),
            "base_url": body.base_url.strip(),
            "api_key": body.api_key.strip(),
        }
        return {"result": await run_in_threadpool(list_third_party_models_endpoint, item)}

    @router.delete("/api/third-party-apis/{api_id}")
    async def delete_third_party_api(api_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        items = config.third_party_apis
        remaining = [item for item in items if str(item.get("id")) != str(api_id).strip()]
        if len(remaining) == len(items):
            raise HTTPException(status_code=404, detail={"error": "第三方 API 不存在"})
        config.update({"third_party_apis": remaining})
        from services.config import set_third_party_api_key

        set_third_party_api_key(str(api_id).strip(), "")
        return {"ok": True, "items": config.get_third_party_apis_settings()}

    return router
