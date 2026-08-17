from __future__ import annotations

import json
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from services.config import DATA_DIR

EMAIL_TEMPLATE_FILE = DATA_DIR / "email_templates.json"

# 邮件场景定义：scene -> 中文名
SCENES: dict[str, str] = {
    "register_code": "注册验证码",
    "forgot_code": "找回密码",
    "bind_code": "绑定邮箱",
    "smtp_test": "测试邮件",
}

# 模板可用变量（插入编辑器时展示）
AVAILABLE_VARIABLES: list[str] = ["username", "email", "code", "date", "time", "site_title"]

# 无模板时的默认文案（保持与旧版一致）
DEFAULT_TEMPLATES: dict[str, dict[str, str]] = {
    "register_code": {
        "subject": "注册验证码",
        "body": "您的注册验证码是：{code}\n\n验证码 10 分钟内有效，请勿泄露给他人。\n\n（chatgpt2api 自动发送，请勿回复）",
    },
    "forgot_code": {
        "subject": "找回密码验证码",
        "body": "您的找回密码验证码是：{code}\n\n验证码 10 分钟内有效，请勿泄露给他人。\n\n（chatgpt2api 自动发送，请勿回复）",
    },
    "bind_code": {
        "subject": "绑定邮箱验证码",
        "body": "您的绑定邮箱验证码是：{code}\n\n验证码 10 分钟内有效，请勿泄露给他人。\n\n（chatgpt2api 自动发送，请勿回复）",
    },
    "smtp_test": {
        "subject": "SMTP 测试邮件",
        "body": "这是一封测试邮件，说明 SMTP 配置正常。",
    },
}

_VAR_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _clean(value: object, default: str = "") -> str:
    return str(value or default).strip()


class EmailTemplateService:
    """邮件模板服务：按场景管理自定义邮件模板，渲染变量占位符。"""

    def __init__(self, path: Path = EMAIL_TEMPLATE_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._templates: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        raw_items = data.get("templates") if isinstance(data, dict) else None
        items = raw_items if isinstance(raw_items, list) else []
        templates: dict[str, dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            template_id = _clean(item.get("id"))
            if not template_id:
                continue
            templates[template_id] = {
                "id": template_id,
                "name": _clean(item.get("name")),
                "scene": _clean(item.get("scene")),
                "subject": _clean(item.get("subject")),
                "body_html": str(item.get("body_html") or ""),
                "created_at": _clean(item.get("created_at"), _now_iso()),
                "updated_at": _clean(item.get("updated_at"), _now_iso()),
            }
        self._templates = templates

    def _save(self) -> None:
        items = sorted(self._templates.values(), key=lambda t: str(t.get("updated_at") or ""), reverse=True)
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp_path.write_text(json.dumps({"templates": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self.path)

    # ── 查询 ──────────────────────────────────────────────

    def list_templates(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(item) for item in sorted(self._templates.values(), key=lambda t: str(t.get("created_at") or ""))]

    def get_template(self, template_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._templates.get(_clean(template_id))
            return dict(item) if item else None

    # ── 管理操作 ──────────────────────────────────────────

    def save_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        """创建或更新模板。payload 含 id 时更新。返回模板；必填缺失抛 ValueError。"""
        name = _clean(payload.get("name"))
        scene = _clean(payload.get("scene"))
        subject = _clean(payload.get("subject"))
        body_html = str(payload.get("body_html") or "").strip()
        if not name:
            raise ValueError("请填写模板名称")
        if scene not in SCENES:
            raise ValueError(f"请选择有效的邮件场景（{ '、'.join(SCENES.values()) }）")
        if not subject:
            raise ValueError("请填写邮件主题")
        if not body_html:
            raise ValueError("请填写邮件正文内容")
        now = _now_iso()
        template_id = _clean(payload.get("id"))
        with self._lock:
            if template_id and template_id in self._templates:
                item = self._templates[template_id]
                item.update({
                    "name": name,
                    "scene": scene,
                    "subject": subject,
                    "body_html": body_html,
                    "updated_at": now,
                })
            else:
                template_id = uuid4().hex[:12]
                self._templates[template_id] = {
                    "id": template_id,
                    "name": name,
                    "scene": scene,
                    "subject": subject,
                    "body_html": body_html,
                    "created_at": now,
                    "updated_at": now,
                }
            self._save()
            return dict(self._templates[template_id])

    def delete_template(self, template_id: str) -> bool:
        template_id = _clean(template_id)
        with self._lock:
            if template_id not in self._templates:
                return False
            self._templates.pop(template_id, None)
            self._save()
            return True

    # ── 渲染 ──────────────────────────────────────────────

    @staticmethod
    def render_text(text: str, variables: dict[str, Any]) -> str:
        """替换 {{变量}} 占位符：已知变量替换为值，未知变量保留原文。"""

        def _replace(match: re.Match[str]) -> str:
            key = match.group(1)
            value = variables.get(key)
            if value is None:
                return match.group(0)
            return str(value)

        return _VAR_RE.sub(_replace, text)

    def render_scene(self, scene: str, variables: dict[str, Any]) -> tuple[str, str, bool]:
        """渲染某场景的邮件。返回 (主题, 正文, 是否为 HTML)。

        有该场景的模板时用模板渲染（HTML），否则返回内置默认纯文本文案。
        """
        scene = _clean(scene)
        with self._lock:
            template = next(
                (item for item in self._templates.values() if item.get("scene") == scene),
                None,
            )
        if template is not None:
            subject = self.render_text(_clean(template.get("subject")), variables)
            body = self.render_text(str(template.get("body_html") or ""), variables)
            return subject, body, True
        default = DEFAULT_TEMPLATES.get(scene, {"subject": scene, "body": ""})
        subject = str(default.get("subject") or scene)
        body = str(default.get("body") or "")
        # 默认纯文本同样支持 {code} 这类旧占位符与 {{code}} 新占位符
        for key, value in variables.items():
            if value is None:
                continue
            subject = subject.replace("{" + key + "}", str(value))
            body = body.replace("{" + key + "}", str(value))
        return subject, body, False


email_template_service = EmailTemplateService()
