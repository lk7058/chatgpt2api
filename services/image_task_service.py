from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from services.config import DATA_DIR, config
from services.content_filter import request_text
from services.log_service import LOG_TYPE_CALL, log_service
from services.protocol import openai_v1_image_edit, openai_v1_image_generations

TASK_STATUS_QUEUED = "queued"
TASK_STATUS_RUNNING = "running"
TASK_STATUS_SUCCESS = "success"
TASK_STATUS_ERROR = "error"
TASK_STATUS_CANCELLED = "cancelled"
TERMINAL_STATUSES = {TASK_STATUS_SUCCESS, TASK_STATUS_ERROR, TASK_STATUS_CANCELLED}
UNFINISHED_STATUSES = {TASK_STATUS_QUEUED, TASK_STATUS_RUNNING}


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _timestamp(value: object) -> float:
    if not isinstance(value, str) or not value.strip():
        return 0.0
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:26], fmt).timestamp()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _clean(value: object, default: str = "") -> str:
    return str(value or default).strip()


def _estimate_quota_used(task: dict[str, Any]) -> int:
    """按模型+分辨率档位估算任务消耗积分（历史任务无 quota_used 时展示/退还用）。"""
    try:
        from services.config import config, image_price_weight, tier_for_size
        from services.third_party_api import route_for_model as _route

        model = _clean(task.get("model"))
        tier = tier_for_size(_clean(task.get("size")))
        third_party = _route(model)
        base = image_price_weight(third_party, model, tier)
        if base is None:
            base = config.get_model_quota_weight(model)
        return max(1, base) * max(1, len(task.get("data") or []))
    except Exception:
        return 0


def _owner_id(identity: dict[str, object]) -> str:
    return _clean(identity.get("id")) or "anonymous"


def _task_key(owner_id: str, task_id: str) -> str:
    return f"{owner_id}:{task_id}"


def _collect_image_urls(data: list[Any]) -> list[str]:
    urls: list[str] = []
    for item in data:
        if isinstance(item, dict):
            url = item.get("url")
            if isinstance(url, str) and url:
                urls.append(url)
    return urls


def _public_task(task: dict[str, Any]) -> dict[str, Any]:
    item = {
        "id": task.get("id"),
        "status": task.get("status"),
        "mode": task.get("mode"),
        "model": task.get("model"),
        "size": task.get("size"),
        "quality": task.get("quality"),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
    }
    if task.get("conversation_id"):
        item["conversation_id"] = task.get("conversation_id")
    if task.get("data") is not None:
        item["data"] = task.get("data")
    if task.get("usage") is not None:
        item["usage"] = task.get("usage")
    if task.get("error"):
        item["error"] = task.get("error")
    if task.get("cancel_reason"):
        item["cancel_reason"] = task.get("cancel_reason")
    if task.get("progress"):
        item["progress"] = task.get("progress")
    if task.get("progress_step"):
        item["progress_step"] = task.get("progress_step")
    if task.get("phases"):
        item["phases"] = task.get("phases")
    if task.get("duration_ms") is not None:
        item["duration_ms"] = task.get("duration_ms")
    if task.get("status") in (TASK_STATUS_RUNNING, TASK_STATUS_QUEUED):
        if task.get("status") == TASK_STATUS_RUNNING:
            # RUNNING 状态从任务开始执行（started_ts）计时
            base_ts = task.get("started_ts")
        else:
            # QUEUED 状态从 created_ts 开始计时（排队等待中）
            base_ts = task.get("created_ts") or task.get("updated_ts")
        if base_ts:
            item["elapsed_secs"] = round(time.time() - base_ts, 1)
    return item


# ── 生图四阶段 ─────────────────────────────────────────────
PHASE_QUEUED = "queued"          # 排队中
PHASE_STARTING = "starting"      # 启动中
PHASE_GENERATING = "generating"  # 生成中
PHASE_DOWNLOADING = "downloading"  # 正在取回图片
PHASE_DONE = "done"              # 完成

# 细粒度进度步骤 → 四阶段映射
STEP_TO_PHASE: dict[str, str] = {
    "getting_account": PHASE_STARTING,
    "uploading": PHASE_STARTING,
    "bootstrapping": PHASE_STARTING,
    "getting_token": PHASE_STARTING,
    "preparing_conversation": PHASE_STARTING,
    "image_stream_resolve_start": PHASE_STARTING,
    "starting_generation": PHASE_GENERATING,
    "generating": PHASE_GENERATING,
    "receiving_image": PHASE_DOWNLOADING,
}


class ImageTaskService:
    def __init__(
        self,
        path: Path,
        *,
        generation_handler: Callable[[dict[str, Any]], dict[str, Any]] = openai_v1_image_generations.handle,
        edit_handler: Callable[[dict[str, Any]], dict[str, Any]] = openai_v1_image_edit.handle,
        retention_days_getter: Callable[[], int] | None = None,
    ):
        self.path = path
        self.generation_handler = generation_handler
        self.edit_handler = edit_handler
        self.retention_days_getter = retention_days_getter or (lambda: config.image_retention_days)
        self._lock = threading.RLock()
        self._tasks: dict[str, dict[str, Any]] = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._tasks = self._load_locked()
            changed = self._recover_unfinished_locked()
            changed = self._cleanup_locked() or changed
            if changed:
                self._save_locked()

    def submit_generation(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        prompt: str,
        model: str,
        size: str | None,
        quality: str = "auto",
        tier: str | None = None,
        base_url: str = "",
    ) -> dict[str, Any]:
        payload = {
            "prompt": prompt,
            "model": model,
            "n": 1,
            "size": size,
            "tier": tier,
            "quality": quality,
            "response_format": "b64_json" if config.image_prefer_b64_json else "url",
            "base_url": base_url,
        }
        return self._submit(identity, client_task_id=client_task_id, mode="generate", payload=payload)

    def submit_edit(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        prompt: str,
        model: str,
        size: str | None,
        quality: str = "auto",
        tier: str | None = None,
        base_url: str = "",
        images: list[tuple[bytes, str, str]] | None = None,
        masks: list[tuple[bytes, str, str]] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "prompt": prompt,
            "images": images or [],
            "mask": masks or [],
            "model": model,
            "n": 1,
            "size": size,
            "tier": tier,
            "quality": quality,
            "response_format": "b64_json" if config.image_prefer_b64_json else "url",
            "base_url": base_url,
        }
        return self._submit(identity, client_task_id=client_task_id, mode="edit", payload=payload)

    def list_tasks(self, identity: dict[str, object], task_ids: list[str]) -> dict[str, Any]:
        owner = _owner_id(identity)
        requested_ids = [_clean(task_id) for task_id in task_ids if _clean(task_id)]
        with self._lock:
            if self._cleanup_locked():
                self._save_locked()
            items = []
            missing_ids = []
            for task_id in requested_ids:
                task = self._tasks.get(_task_key(owner, task_id))
                if task is None:
                    missing_ids.append(task_id)
                else:
                    items.append(_public_task(task))
            if not requested_ids:
                items = [
                    _public_task(task)
                    for task in self._tasks.values()
                    if task.get("owner_id") == owner
                ]
                items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
                missing_ids = []
            return {"items": items, "missing_ids": missing_ids}

    def _mark_cancelled_locked(self, key: str, cancel_reason: str) -> bool:
        """在持锁状态下把未完成任务标记为取消。"""
        task = self._tasks.get(key)
        if task is None or task.get("status") in TERMINAL_STATUSES:
            return False
        task["status"] = TASK_STATUS_CANCELLED
        task["cancel_reason"] = cancel_reason
        task["updated_at"] = _now_iso()
        task["updated_ts"] = time.time()
        return True

    def cancel_tasks(self, identity: dict[str, object], task_ids: list[str]) -> dict[str, int]:
        """用户取消自己的排队/进行中任务（只能取消自己的任务）。"""
        owner = _owner_id(identity)
        cancelled = 0
        with self._lock:
            changed = False
            for task_id in task_ids:
                task_id = _clean(task_id)
                if not task_id:
                    continue
                key = _task_key(owner, task_id)
                if self._mark_cancelled_locked(key, "user"):
                    cancelled += 1
                    changed = True
            if changed:
                self._save_locked()
        return {"cancelled": cancelled}

    def list_admin_tasks(self, identity: dict[str, object]) -> dict[str, object]:
        """管理员查看全部任务（含 owner 邮箱与积分信息，用于任务管理）。"""
        with self._lock:
            if self._cleanup_locked():
                self._save_locked()
            items = []
            for task in self._tasks.values():
                item = {**_public_task(task), "owner_id": task.get("owner_id")}
                # 本次消耗积分：优先取扣费时记录的 quota_used，历史任务按模型权重估算
                quota_used = task.get("quota_used")
                if quota_used is None:
                    if task.get("status") == TASK_STATUS_SUCCESS:
                        quota_used = _estimate_quota_used(task)
                    else:
                        quota_used = 0
                item["quota_used"] = int(quota_used or 0)
                if task.get("refunded"):
                    item["refunded"] = True
                items.append(item)
        # 注入用户邮箱（缓存查询）
        from services.user_service import user_service

        email_cache: dict[str, str] = {}
        for item in items:
            owner = str(item.get("owner_id") or "")
            if owner not in email_cache:
                user = user_service.get_user(owner) if owner else None
                email_cache[owner] = str(user.get("email") or "") if user else ""
            item["owner_email"] = email_cache[owner]
        items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return {"items": items}

    def refund_task(self, task_id: str) -> dict[str, object]:
        """管理员退还指定任务消耗的积分（仅已扣费的完成任务，不可重复退还）。"""
        task_id = _clean(task_id)
        with self._lock:
            target = None
            for task in self._tasks.values():
                if str(task.get("id") or "") == task_id:
                    target = task
                    break
            if target is None:
                raise ValueError("任务不存在")
            if target.get("status") != TASK_STATUS_SUCCESS:
                raise ValueError("仅已完成的任务可退还积分")
            if target.get("refunded"):
                raise ValueError("该任务积分已退还，请勿重复操作")
            quota_used = int(target.get("quota_used") or 0)
            if quota_used <= 0:
                # 历史任务无扣费记录时按模型权重估算
                quota_used = _estimate_quota_used(target)
            if quota_used <= 0:
                raise ValueError("该任务未消耗积分，无需退还")
            owner_id = _clean(target.get("owner_id"))
            # 持锁内先标记退还，防止并发重复退还
            target["refunded"] = True
            target["refund_amount"] = quota_used
            target["refunded_at"] = _now_iso()
            target["updated_at"] = _now_iso()
            self._save_locked()
        # 退还额度（锁外执行，避免持锁调用 user_service）
        from services.user_service import user_service

        if owner_id:
            user_service.add_quota(owner_id, quota_used, note=f"任务退还：{task_id[:12]}", source="refund")
        return {"refunded": True, "amount": quota_used, "owner_id": owner_id}

    def cancel_tasks_admin(
        self,
        identity: dict[str, object],
        task_ids: list[str] | None = None,
        all_tasks: bool = False,
    ) -> dict[str, int]:
        """管理员批量/一键取消未完成任务（全部用户）。"""
        requested = {_clean(task_id) for task_id in (task_ids or []) if _clean(task_id)}
        cancelled = 0
        with self._lock:
            changed = False
            for key, task in list(self._tasks.items()):
                if task.get("status") in TERMINAL_STATUSES:
                    continue
                if all_tasks or (requested and str(task.get("id")) in requested):
                    if self._mark_cancelled_locked(key, "admin"):
                        cancelled += 1
                        changed = True
            if changed:
                self._save_locked()
        return {"cancelled": cancelled}

    def _submit(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        mode: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        task_id = _clean(client_task_id)
        if not task_id:
            raise ValueError("client_task_id is required")
        owner = _owner_id(identity)
        key = _task_key(owner, task_id)
        now = _now_iso()
        should_start = False
        with self._lock:
            cleaned = self._cleanup_locked()
            task = self._tasks.get(key)
            if task is not None:
                if cleaned:
                    self._save_locked()
                return _public_task(task)
            task = {
                "id": task_id,
                "owner_id": owner,
                "status": TASK_STATUS_QUEUED,
                "progress": PHASE_QUEUED,
                "progress_step": "",
                "mode": mode,
                "model": _clean(payload.get("model"), "gpt-image-2"),
                "size": _clean(payload.get("size")),
                "quality": _clean(payload.get("quality"), "auto"),
                "created_at": now,
                "updated_at": now,
                "created_ts": time.time(),
            }
            self._tasks[key] = task
            self._save_locked()
            should_start = True

        if should_start:
            thread = threading.Thread(
                target=self._run_task,
                args=(key, mode, payload, dict(identity), _clean(payload.get("model"), "gpt-image-2")),
                name=f"image-task-{task_id[:16]}",
                daemon=True,
            )
            thread.start()
        return _public_task(task)

    def _run_task(
        self,
        key: str,
        mode: str,
        payload: dict[str, Any],
        identity: dict[str, object],
        model: str,
    ) -> None:
        # 任务可能在被启动前已被用户/管理员取消（排队任务取消）
        with self._lock:
            if self._tasks.get(key, {}).get("status") == TASK_STATUS_CANCELLED:
                return
        started = time.time()
        # 阶段耗时记录：每个阶段开始时间戳
        phase_marks: list[dict[str, Any]] = [{"phase": PHASE_STARTING, "ts": started}]
        # 排队中保持 QUEUED 状态，直到真正开始执行（首次进度回调）才转 RUNNING，
        # 这样「排队中」的任务在管理员任务管理/用户侧均可读取与取消
        task_marked_running = False

        # 创建进度回调，每个步骤完成后更新任务状态
        def progress_callback(step: str) -> None:
            nonlocal task_marked_running
            phase = STEP_TO_PHASE.get(step, PHASE_GENERATING)
            now = time.time()
            if step == "image_stream_resolve_start":
                self._update_task(key, started_ts=now, persist=False)
            if not task_marked_running:
                # 已被取消的排队任务：不再转 RUNNING，保持已取消状态
                with self._lock:
                    if self._tasks.get(key, {}).get("status") == TASK_STATUS_CANCELLED:
                        task_marked_running = True
                        return
                task_marked_running = True
                self._update_task(
                    key,
                    status=TASK_STATUS_RUNNING,
                    error="",
                    progress=phase,
                    progress_step=step,
                    started_ts=now,
                )
            if phase_marks[-1]["phase"] != phase:
                phase_marks.append({"phase": phase, "ts": now})
            # 进度细节只更新内存，不落盘（避免频繁全量写文件）
            self._update_task(key, progress=phase, progress_step=step, persist=False)

        def build_phases(end_ts: float) -> list[dict[str, Any]]:
            result: list[dict[str, Any]] = []
            for index, mark in enumerate(phase_marks):
                end = phase_marks[index + 1]["ts"] if index + 1 < len(phase_marks) else end_ts
                result.append({
                    "phase": mark["phase"],
                    "duration_ms": max(0, int((end - mark["ts"]) * 1000)),
                })
            return result
        # 将进度回调添加到 payload 中（handler 会提取并传递给 ConversationRequest）
        payload_with_progress = {**payload, "progress_callback": progress_callback}
        try:
            # 第三方 API 路由：模型匹配则转发到自定义 OpenAI 兼容图片端点
            from services.third_party_api import (
                image_edit as third_party_image_edit,
                image_generation as third_party_image_generation,
                route_for_model as third_party_route_for_model,
            )

            third_party = third_party_route_for_model(model)
            if third_party is not None:
                try:
                    # 第三方生成中
                    progress_callback("starting_generation")
                    if mode == "edit":
                        result = third_party_image_edit(third_party, payload_with_progress)
                    else:
                        result = third_party_image_generation(third_party, payload_with_progress)
                except Exception as exc:
                    error = RuntimeError("抱歉，出现了错误，这不是你的问题，也不是我的问题，请稍后再试！")
                    # 原始错误附加到异常对象，供日志记录排查
                    setattr(error, "original_error", f"第三方 API 图片生成失败：{exc}")
                    raise error from exc
            else:
                handler = self.edit_handler if mode == "edit" else self.generation_handler
                result = handler(payload_with_progress)
            if not isinstance(result, dict):
                raise RuntimeError("image task returned streaming result unexpectedly")
            # 第三方图片镜像到本地：先进入"正在取回图片"阶段，下载完成或失败均结束
            if third_party is not None:
                progress_callback("receiving_image")
                try:
                    from services.third_party_image_download import mirror_result_images

                    mirror_base_url = str(payload_with_progress.get("base_url") or "").rstrip("/")
                    mirror_api_key = str(third_party.get("api_key") or "")
                    result = mirror_result_images(result, mirror_base_url, mirror_api_key)
                except Exception as exc:
                    error = RuntimeError("抱歉，出现了错误，这不是你的问题，也不是我的问题，请稍后再试！")
                    setattr(error, "original_error", f"镜像下载失败：{exc}")
                    raise error from exc
            data = result.get("data")
            account_email = _clean(result.get("_account_email") or result.get("account_email"))
            if not isinstance(data, list) or not data:
                upstream = _clean(result.get("message"))
                if upstream:
                    message = upstream
                else:
                    message = "号池中没有可用账号或所有账号均被限流，请检查号池状态（账号额度、是否被封禁、是否到达生图上限）"
                error = RuntimeError(message)
                if account_email:
                    setattr(error, "account_email", account_email)
                raise error
            usage = result.get("usage")
            # 任务执行期间被用户/管理员取消：丢弃结果，不扣额度
            with self._lock:
                if self._tasks.get(key, {}).get("status") == TASK_STATUS_CANCELLED:
                    self._update_task(
                        key,
                        status=TASK_STATUS_CANCELLED,
                        data=[],
                        error="",
                        duration_ms=int((time.time() - started) * 1000),
                    )
                    return
            duration_ms = int((time.time() - started) * 1000)
            phases = build_phases(time.time())
            self._update_task(
                key,
                status=TASK_STATUS_SUCCESS,
                data=data,
                usage=usage,
                error="",
                duration_ms=duration_ms,
                progress=PHASE_DONE,
                progress_step="done",
                phases=phases,
            )
            # 任务成功：扣减用户额度（管理员/无绑定用户跳过）
            try:
                user_id = identity.get("user_id")
                if user_id and identity.get("role") != "admin":
                    from services.config import config, image_price_weight, tier_for_size
                    from services.third_party_api import route_for_model as _third_party_route
                    from services.user_service import user_service

                    # 第三方 API 模型按分辨率档位定价；未配置档位价时回退模型基础权重
                    explicit_tier = _clean(payload.get("tier"))
                    tier = explicit_tier if explicit_tier in ("1k", "2k", "4k") else tier_for_size(_clean(payload.get("size")))
                    third_party = _third_party_route(model)
                    base = image_price_weight(third_party, model, tier)
                    if base is None:
                        base = config.get_model_quota_weight(model)
                    weight = max(1, base) * max(1, len(data))
                    user_service.deduct_quota(str(user_id), weight, source="image", note=model)
                    # 记录本次任务消耗的积分（供任务管理展示与退还）
                    self._update_task(key, quota_used=weight)
            except Exception:
                pass
            self._log_call(
                identity,
                mode,
                model,
                started,
                "调用完成",
                request_preview=request_text(payload.get("prompt")),
                urls=_collect_image_urls(data),
                account_email=account_email,
                phases=phases,
            )
        except Exception as exc:
            # 排队/执行期间任务已被取消：保持已取消状态，不覆盖为 error
            with self._lock:
                if self._tasks.get(key, {}).get("status") == TASK_STATUS_CANCELLED:
                    return
            error_message = str(exc) or "image task failed"
            account_email = _clean(getattr(exc, "account_email", ""))
            conversation_id = _clean(getattr(exc, "conversation_id", ""))
            duration_ms = int((time.time() - started) * 1000)
            # 任务对外 error 使用通用消息；日志记录原始错误（如有）
            task_error = error_message
            log_error = _clean(getattr(exc, "original_error", "")) or error_message
            self._update_task(key, status=TASK_STATUS_ERROR, error=task_error, data=[],
                              duration_ms=duration_ms,
                              phases=build_phases(time.time()),
                              **({"conversation_id": conversation_id} if conversation_id else {}))
            self._log_call(
                identity,
                mode,
                model,
                started,
                "调用失败",
                request_preview=request_text(payload.get("prompt")),
                status="failed",
                error=log_error,
                account_email=account_email,
                phases=build_phases(time.time()),
            )

    def _log_call(
        self,
        identity: dict[str, object],
        mode: str,
        model: str,
        started: float,
        suffix: str,
        *,
        request_preview: str = "",
        status: str = "success",
        error: str = "",
        urls: list[str] | None = None,
        account_email: str = "",
        phases: list[dict[str, Any]] | None = None,
    ) -> None:
        endpoint = "/v1/images/edits" if mode == "edit" else "/v1/images/generations"
        summary_prefix = "图生图" if mode == "edit" else "文生图"
        detail = {
            "key_id": identity.get("id"),
            "key_name": identity.get("name"),
            "role": identity.get("role"),
            "endpoint": endpoint,
            "model": model,
            "started_at": datetime.fromtimestamp(started).strftime("%Y-%m-%d %H:%M:%S"),
            "ended_at": _now_iso(),
            "duration_ms": int((time.time() - started) * 1000),
            "status": status,
        }
        if phases:
            detail["phases"] = phases
        if request_preview:
            detail["request_text"] = request_preview
        if error:
            detail["error"] = error
        if account_email:
            detail["account_email"] = account_email
        if urls:
            detail["urls"] = list(dict.fromkeys(urls))
        try:
            log_service.add(LOG_TYPE_CALL, f"{summary_prefix}{suffix}", detail)
        except Exception:
            pass

    def _update_task(self, key: str, persist: bool = True, **updates: Any) -> None:
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                return
            task.update(updates)
            task["updated_at"] = _now_iso()
            task["updated_ts"] = time.time()
            # 进度细节（progress/progress_step）只更新内存，不落盘，避免频繁全量写文件
            if persist:
                self._save_locked()

    def _load_locked(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        raw_items = raw.get("tasks") if isinstance(raw, dict) else raw
        if not isinstance(raw_items, list):
            return {}
        tasks: dict[str, dict[str, Any]] = {}
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            task_id = _clean(item.get("id"))
            owner = _clean(item.get("owner_id"))
            if not task_id or not owner:
                continue
            status = _clean(item.get("status"))
            if status not in {TASK_STATUS_QUEUED, TASK_STATUS_RUNNING, TASK_STATUS_SUCCESS, TASK_STATUS_ERROR}:
                status = TASK_STATUS_ERROR
            task = {
                "id": task_id,
                "owner_id": owner,
                "status": status,
                "mode": "edit" if item.get("mode") == "edit" else "generate",
                "model": _clean(item.get("model"), "gpt-image-2"),
                "size": _clean(item.get("size")),
                "quality": _clean(item.get("quality"), "auto"),
                "created_at": _clean(item.get("created_at"), _now_iso()),
                "updated_at": _clean(item.get("updated_at"), _clean(item.get("created_at"), _now_iso())),
                "created_ts": item.get("created_ts"),
                "updated_ts": item.get("updated_ts"),
                "started_ts": item.get("started_ts"),
                "duration_ms": item.get("duration_ms"),
                "progress": _clean(item.get("progress")) or PHASE_QUEUED,
                "progress_step": _clean(item.get("progress_step")),
            }
            data = item.get("data")
            if isinstance(data, list):
                task["data"] = data
            usage = item.get("usage")
            if isinstance(usage, dict):
                task["usage"] = usage
            error = _clean(item.get("error"))
            if error:
                task["error"] = error
            tasks[_task_key(owner, task_id)] = task
        return tasks

    def _save_locked(self) -> None:
        # base64 图片数据（data 字段）不落盘：内存保留供前端轮询，文件只存元数据，
        # 避免 image_tasks.json 持续膨胀导致每次全量写越来越慢（任务队列被 IO 阻塞）
        items = []
        for task in self._tasks.values():
            item = dict(task)
            item.pop("data", None)
            items.append(item)
        items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp_path.write_text(json.dumps({"tasks": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self.path)

    def _recover_unfinished_locked(self) -> bool:
        changed = False
        for task in self._tasks.values():
            if task.get("status") in UNFINISHED_STATUSES:
                task["status"] = TASK_STATUS_ERROR
                task["error"] = "服务已重启，未完成的图片任务已中断"
                task["updated_at"] = _now_iso()
                changed = True
        return changed

    def _cleanup_locked(self) -> bool:
        try:
            retention_days = max(1, int(self.retention_days_getter()))
        except Exception:
            retention_days = 30
        cutoff = time.time() - retention_days * 86400
        removed_keys = [
            key
            for key, task in self._tasks.items()
            if task.get("status") in TERMINAL_STATUSES and _timestamp(task.get("updated_at")) < cutoff
        ]
        for key in removed_keys:
            self._tasks.pop(key, None)
        return bool(removed_keys)

    def resume_poll(
        self,
        identity: dict[str, object],
        task_id: str,
        extra_timeout_secs: float = 30.0,
    ) -> dict[str, Any]:
        """恢复对已超时任务的轮询，额外等待 extra_timeout_secs 秒。"""
        owner = _owner_id(identity)
        key = _task_key(owner, _clean(task_id))
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                raise ValueError("task not found")
            if task.get("status") != TASK_STATUS_ERROR:
                raise ValueError("task is not in error state")
            error_msg = _clean(task.get("error"))
            if "超时" not in error_msg:
                raise ValueError("task error is not a timeout error")
            conversation_id = _clean(task.get("conversation_id"))
            if not conversation_id:
                raise ValueError("task has no conversation_id")
            mode = task.get("mode", "generate")
            model = task.get("model", "gpt-image-2")
            # 将任务状态重置为 running
            self._update_task(key, status=TASK_STATUS_RUNNING, error="")

        # 启动新线程继续轮询
        thread = threading.Thread(
            target=self._run_resume_poll,
            args=(key, conversation_id, extra_timeout_secs, dict(identity), mode, model),
            name=f"image-resume-{_clean(task_id)[:16]}",
            daemon=True,
        )
        thread.start()
        return _public_task(task)

    def wait_for_task(
        self,
        identity: dict[str, object],
        task_id: str,
        *,
        timeout_secs: float = 240.0,
        poll_interval: float = 2.0,
    ) -> dict[str, Any]:
        """阻塞等待任务到达终态（供 MCP 生图工具同步返回结果使用）。超时返回当前任务状态。"""
        owner = _owner_id(identity)
        key = _task_key(owner, _clean(task_id))
        deadline = time.time() + max(1.0, float(timeout_secs))
        interval = max(0.5, min(float(poll_interval), 5.0))
        while time.time() < deadline:
            with self._lock:
                task = self._tasks.get(key)
                if task is None:
                    raise ValueError("task not found")
                if task.get("status") in TERMINAL_STATUSES:
                    return _public_task(task)
            time.sleep(interval)
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                return {"id": _clean(task_id), "status": TASK_STATUS_ERROR, "error": "task not found"}
            return _public_task(task)

    def _run_resume_poll(
        self,
        key: str,
        conversation_id: str,
        extra_timeout_secs: float,
        identity: dict[str, object],
        mode: str,
        model: str,
    ) -> None:
        """后台线程：继续轮询已有 conversation_id 的图片结果。"""
        started = time.time()
        backend = None
        try:
            from services.openai_backend_api import OpenAIBackendAPI
            from services.protocol.conversation import format_image_result

            backend = OpenAIBackendAPI(proxy_url=config.proxy_url or None)
            file_ids, sediment_ids = backend._poll_image_results(
                conversation_id,
                extra_timeout_secs,
            )
            if not file_ids and not sediment_ids:
                raise RuntimeError(
                    f"继续等待 {extra_timeout_secs} 秒后仍未找到图片结果。"
                )

            image_urls = backend.resolve_conversation_image_urls(
                conversation_id, file_ids, sediment_ids, poll=False,
            )
            if not image_urls:
                raise RuntimeError("图片 URL 解析失败")

            image_items = [
                {"b64_json": __import__("base64").b64encode(image_data).decode("ascii")}
                for image_data in backend.download_image_bytes(image_urls)
            ]
            # 获取 task 的原始 prompt（从 _public_task 的 mode 判断）
            with self._lock:
                task = self._tasks.get(key)
                quality = _clean(task.get("quality"), "auto") if task else "auto"
                size = _clean(task.get("size")) if task else None
            data = format_image_result(
                image_items,
                "",  # prompt 已不重要，结果已经拿到了
                "b64_json",
                "",
                int(time.time()),
            )["data"]
            self._update_task(key, status=TASK_STATUS_SUCCESS, data=data, error="", duration_ms=int((time.time() - started) * 1000))
            self._log_call(
                identity,
                mode,
                model,
                started,
                "调用完成（续轮询）",
                status="success",
                urls=_collect_image_urls(data),
            )
        except Exception as exc:
            error_message = str(exc) or "resume poll failed"
            duration_ms = int((time.time() - started) * 1000)
            self._update_task(key, status=TASK_STATUS_ERROR, error=error_message, data=[], duration_ms=duration_ms)
            self._log_call(
                identity,
                mode,
                model,
                started,
                "调用失败（续轮询）",
                status="failed",
                error=error_message,
            )
        finally:
            if backend is not None:
                backend.close()


image_task_service = ImageTaskService(DATA_DIR / "image_tasks.json")
