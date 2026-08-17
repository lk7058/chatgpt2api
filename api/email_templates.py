from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from api.support import require_admin
from services.email_template_service import (
    AVAILABLE_VARIABLES,
    SCENES,
    email_template_service,
)


class EmailTemplatePayload(BaseModel):
    id: str = ""
    name: str = ""
    scene: str = ""
    subject: str = ""
    body_html: str = ""


class EmailTemplatePreviewRequest(BaseModel):
    name: str = Field(default="")
    scene: str = Field(default="register_code")
    subject: str = ""
    body_html: str = ""


def _preview_variables() -> dict[str, str]:
    from datetime import datetime

    return {
        "username": "用户昵称",
        "email": "user@example.com",
        "code": "123456",
        "date": datetime.now().strftime("%Y-%m-%d"),
        "time": datetime.now().strftime("%H:%M"),
        "site_title": "站点名称",
    }


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/admin/email-templates")
    async def list_email_templates(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {
            "items": email_template_service.list_templates(),
            "scenes": SCENES,
            "variables": AVAILABLE_VARIABLES,
        }

    @router.post("/api/admin/email-templates")
    async def save_email_template(body: EmailTemplatePayload, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = email_template_service.save_template(body.model_dump(mode="python"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item, "items": email_template_service.list_templates()}

    @router.delete("/api/admin/email-templates/{template_id}")
    async def delete_email_template(template_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        removed = email_template_service.delete_template(template_id)
        if not removed:
            raise HTTPException(status_code=404, detail={"error": "模板不存在"})
        return {"ok": True, "items": email_template_service.list_templates()}

    @router.post("/api/admin/email-templates/preview")
    async def preview_email_template(body: EmailTemplatePreviewRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        subject = body.subject.strip()
        body_html = str(body.body_html or "").strip()
        if not subject:
            raise HTTPException(status_code=400, detail={"error": "请填写邮件主题"})
        if not body_html:
            raise HTTPException(status_code=400, detail={"error": "请填写邮件正文内容"})
        variables = _preview_variables()
        rendered_subject = email_template_service.render_text(subject, variables)
        rendered_body = email_template_service.render_text(body_html, variables)
        return {"subject": rendered_subject, "body_html": rendered_body}

    return router
