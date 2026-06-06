from __future__ import annotations

from typing import Any
import os
import threading

from fastapi import APIRouter, Depends

from ..core import AppError, STATE, clone, persist_state, random_token, runtime_config, now_iso
from ..schemas import AdminCreditAdjustReq, AdminLoginReq
from ..services import admin_adjust_credits, admin_asset_url, admin_task, admin_user, current_admin
from ..generation import process_generation

router = APIRouter()

@router.post("/admin/api/login")
def admin_login(body: AdminLoginReq) -> dict[str, Any]:
    username = os.getenv("ADMIN_USERNAME", "admin")
    password = os.getenv("ADMIN_PASSWORD", "admin123")
    if body.username != username or body.password != password:
        raise AppError(401, "ADMIN_LOGIN_FAILED", "管理员账号或密码错误")
    token = random_token("adm")
    STATE.admin_tokens.add(token)
    persist_state()
    return {
        "accessToken": token,
        "admin": {"username": body.username},
        "runtime": runtime_config(),
    }

@router.post("/admin/api/logout")
def admin_logout(admin_token: str = Depends(current_admin)) -> dict[str, bool]:
    STATE.admin_tokens.discard(admin_token)
    persist_state()
    return {"ok": True}

@router.get("/admin/api/me")
def admin_me(_: str = Depends(current_admin)) -> dict[str, Any]:
    return {"username": os.getenv("ADMIN_USERNAME", "admin"), "runtime": runtime_config()}

@router.get("/admin/api/runtime")
def admin_runtime(_: str = Depends(current_admin)) -> dict[str, Any]:
    return runtime_config()

@router.get("/admin/api/stats")
def admin_stats(_: str = Depends(current_admin)) -> dict[str, Any]:
    tasks = list(STATE.tasks.values())
    orders = list(STATE.orders.values())
    success_images = sum(1 for task in tasks for image in task.get("images", []) if image.get("status") == "SUCCESS")
    failed_images = sum(1 for task in tasks for image in task.get("images", []) if image.get("status") == "FAILED")
    paid_amount = sum(order.get("amountFen", 0) for order in orders if order.get("status") == "PAID")
    return {
        "users": len(STATE.users),
        "tasks": len(tasks),
        "taskStatus": {status: sum(1 for task in tasks if task.get("status") == status) for status in sorted({task.get("status") for task in tasks})},
        "successImages": success_images,
        "failedImages": failed_images,
        "orders": len(orders),
        "paidOrders": sum(1 for order in orders if order.get("status") == "PAID"),
        "paidAmountFen": paid_amount,
        "feedback": len(STATE.feedback),
        "assets": len(STATE.generated_assets),
        "runtime": runtime_config(),
    }

@router.get("/admin/api/users")
def admin_users(keyword: str | None = None, _: str = Depends(current_admin)) -> dict[str, Any]:
    items = [admin_user(user_id) for user_id in STATE.users]
    if keyword:
        text = keyword.lower()
        items = [item for item in items if text in item.get("userId", "").lower() or text in item.get("nickname", "").lower() or text in item.get("openId", "").lower()]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"items": items, "total": len(items)}

@router.get("/admin/api/users/{user_id}")
def admin_user_detail(user_id: str, _: str = Depends(current_admin)) -> dict[str, Any]:
    if user_id not in STATE.users:
        raise AppError(404, "USER_NOT_FOUND", "用户不存在")
    return {
        "user": admin_user(user_id),
        "tasks": [admin_task(task) for task in STATE.tasks.values() if task.get("userId") == user_id],
        "orders": [clone(order) for order in STATE.orders.values() if order.get("userId") == user_id],
        "creditLogs": [clone(item) for item in STATE.credit_logs if item.get("userId") == user_id],
    }

@router.post("/admin/api/users/{user_id}/credits")
def admin_update_credits(user_id: str, body: AdminCreditAdjustReq, _: str = Depends(current_admin)) -> dict[str, Any]:
    if user_id not in STATE.users:
        raise AppError(404, "USER_NOT_FOUND", "用户不存在")
    if body.amount is None and body.balance is None:
        raise AppError(400, "CREDIT_UPDATE_INVALID", "请填写调整次数或目标剩余次数")
    return admin_adjust_credits(user_id, amount=body.amount, balance=body.balance, reason=body.reason)

@router.get("/admin/api/tasks")
def admin_tasks(status: str | None = None, keyword: str | None = None, _: str = Depends(current_admin)) -> dict[str, Any]:
    items = [admin_task(task) for task in STATE.tasks.values()]
    if status:
        items = [item for item in items if item.get("status") == status]
    if keyword:
        text = keyword.lower()
        items = [item for item in items if text in item.get("taskId", "").lower() or text in item.get("userId", "").lower()]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"items": items, "total": len(items)}

@router.get("/admin/api/tasks/{task_id}")
def admin_task_detail(task_id: str, _: str = Depends(current_admin)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    return admin_task(task)

@router.post("/admin/api/tasks/{task_id}/retry")
def admin_retry_task(task_id: str, _: str = Depends(current_admin)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    task["status"] = "QUEUED"
    task["progress"] = 8
    task["errorMessage"] = ""
    for image in task["images"]:
        if image.get("status") != "SUCCESS":
            image["status"] = "PENDING"
            image["errorMessage"] = ""
            image["provider"] = {}
    persist_state()
    threading.Thread(target=process_generation, args=(task_id,), daemon=True).start()
    return admin_task(task)

@router.post("/admin/api/tasks/{task_id}/cancel")
def admin_cancel_task(task_id: str, _: str = Depends(current_admin)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    task["status"] = "CANCELLED"
    task["updatedAt"] = now_iso()
    persist_state()
    return admin_task(task)

@router.get("/admin/api/orders")
def admin_orders(status: str | None = None, _: str = Depends(current_admin)) -> dict[str, Any]:
    items = [clone(order) for order in STATE.orders.values()]
    if status:
        items = [item for item in items if item.get("status") == status]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"items": items, "total": len(items)}

@router.post("/admin/api/orders/{order_id}/close")
def admin_close_order(order_id: str, _: str = Depends(current_admin)) -> dict[str, bool]:
    order = STATE.orders.get(order_id)
    if not order:
        raise AppError(404, "ORDER_NOT_FOUND", "订单不存在")
    order["status"] = "CLOSED"
    persist_state()
    return {"ok": True}

@router.get("/admin/api/feedback")
def admin_feedback(_: str = Depends(current_admin)) -> dict[str, Any]:
    items = [clone(item) for item in STATE.feedback]
    items.reverse()
    return {"items": items, "total": len(items)}

@router.get("/admin/api/assets")
def admin_assets(_: str = Depends(current_admin)) -> dict[str, Any]:
    items = []
    for asset in STATE.generated_assets.values():
        items.append({
            "assetId": asset["assetId"],
            "style": asset["style"],
            "mimeType": asset["mimeType"],
            "sizeBytes": asset.get("sizeBytes") or len(asset.get("bytes", b"")),
            "createdAt": asset["createdAt"],
            "url": admin_asset_url(asset),
            "storage": asset.get("storage", "memory"),
            "key": asset.get("key", ""),
        })
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"items": items, "total": len(items)}

@router.get("/admin/api/debug/logs")
def admin_debug_logs(
    path: str | None = None,
    status: int | None = None,
    level: str | None = None,
    limit: int = 80,
    _: str = Depends(current_admin),
) -> dict[str, Any]:
    items = list(reversed(STATE.debug_logs))
    if path:
        items = [item for item in items if path in item.get("path", "")]
    if status is not None:
        items = [item for item in items if int(item.get("statusCode", 0)) == status]
    if level:
        items = [item for item in items if any(check.get("level") == level for check in item.get("checks", []))]
    limit = max(1, min(int(limit or 80), 300))
    return {"items": items[:limit], "total": len(items), "limit": limit}

@router.delete("/admin/api/debug/logs")
def admin_clear_debug_logs(_: str = Depends(current_admin)) -> dict[str, bool]:
    STATE.debug_logs.clear()
    persist_state()
    return {"ok": True}
