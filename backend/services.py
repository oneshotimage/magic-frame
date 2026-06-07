from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from urllib import parse, request
import base64
import json
import os
import re

from fastapi import Header

from .core import (
    AppError,
    OBJECT_STORAGE,
    STATE,
    STORE,
    clone,
    gen_id,
    now_dt,
    now_iso,
    persist_state,
    random_token,
    restore_state,
    truthy_env,
)


def configured_wechat_appid() -> str:
    return os.getenv("WECHAT_APPID") or os.getenv("WECHAT_APP_ID") or ""


def configured_wechat_secret() -> str:
    return os.getenv("WECHAT_SECRET") or os.getenv("WECHAT_APP_SECRET") or ""


def wechat_code2session(code: str) -> dict[str, Any]:
    appid = configured_wechat_appid()
    secret = configured_wechat_secret()
    if not appid or not secret:
        return {"openId": f"mock_openid_{code or 'dev'}", "mock": True}
    if not code:
        raise AppError(400, "WECHAT_CODE_MISSING", "缺少微信登录 code")
    params = parse.urlencode({
        "appid": appid,
        "secret": secret,
        "js_code": code,
        "grant_type": "authorization_code",
    })
    url = f"https://api.weixin.qq.com/sns/jscode2session?{params}"
    timeout_seconds = int(os.getenv("WECHAT_CODE2SESSION_TIMEOUT_SECONDS", "10"))
    try:
        with request.urlopen(url, timeout=timeout_seconds) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception as exc:  # noqa: BLE001
        raise AppError(502, "WECHAT_CODE2SESSION_NETWORK_ERROR", f"微信登录网络异常：{type(exc).__name__}") from exc
    if payload.get("errcode"):
        errmsg = payload.get("errmsg") or "微信登录失败"
        raise AppError(401, "WECHAT_CODE2SESSION_FAILED", f"微信登录失败：{errmsg}")
    open_id = payload.get("openid")
    if not open_id:
        raise AppError(502, "WECHAT_OPENID_MISSING", "微信登录未返回 openid")
    return {
        "openId": open_id,
        "unionId": payload.get("unionid") or "",
        "sessionKeyConfigured": bool(payload.get("session_key")),
        "mock": False,
    }

def create_upload_record(
    *,
    user_id: str,
    image_bytes: bytes,
    mime_type: str,
    width: int,
    height: int,
    size_bytes: int | None = None,
    data_url: str | None = None,
) -> dict[str, Any]:
    image_id = gen_id("img")
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp"}.get(mime_type, "jpg")
    stored = OBJECT_STORAGE.put_bytes(image_bytes, mime_type=mime_type, folder="uploads", name=f"{image_id}.{ext}")
    input_data_url = data_url or f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    upload = {
        "imageId": image_id,
        "userId": user_id,
        "url": stored["url"],
        "objectUrl": stored["url"],
        "objectKey": stored["key"],
        "storage": stored["storage"],
        "inputImageDataUrl": input_data_url,
        "width": width,
        "height": height,
        "sizeBytes": size_bytes or len(image_bytes),
        "mimeType": mime_type,
        "expiresAt": (now_dt() + timedelta(days=7)).isoformat(),
        "createdAt": now_iso(),
    }
    STATE.uploads[image_id] = upload
    persist_state()
    return upload


def public_upload(upload: dict[str, Any]) -> dict[str, Any]:
    data = clone(upload)
    data.pop("inputImageDataUrl", None)
    data.pop("userId", None)
    return data


def current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise AppError(401, "UNAUTHORIZED", "缺少登录 token")
    token = authorization.removeprefix("Bearer").strip()
    user_id = STATE.tokens.get(token)
    if not user_id and STORE.available:
        restore_state(STORE.load())
        user_id = STATE.tokens.get(token)
    if not user_id:
        raise AppError(401, "UNAUTHORIZED", "登录已过期")
    return user_id


def current_refresh_user_id(refresh_token: str) -> str:
    user_id = STATE.refresh_tokens.get(refresh_token)
    if not user_id and STORE.available:
        restore_state(STORE.load())
        user_id = STATE.refresh_tokens.get(refresh_token)
    if not user_id:
        raise AppError(401, "UNAUTHORIZED", "refresh token 无效")
    return user_id


def current_admin(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise AppError(401, "ADMIN_UNAUTHORIZED", "缺少管理员 token")
    token = authorization.removeprefix("Bearer").strip()
    if token not in STATE.admin_tokens:
        raise AppError(401, "ADMIN_UNAUTHORIZED", "管理员登录已过期")
    return token


def user_id_from_token(token: str | None) -> str:
    if not token:
        return ""
    clean = token.removeprefix("Bearer").strip()
    user_id = STATE.tokens.get(clean)
    if not user_id and STORE.available:
        restore_state(STORE.load())
        user_id = STATE.tokens.get(clean)
    return user_id or ""


def get_or_create_user(code: str | None = None, bind_access_token: str | None = None) -> dict[str, Any]:
    session = wechat_code2session(code or "dev")
    open_id = session["openId"]
    union_id = session.get("unionId") or ""
    for user in STATE.users.values():
        if user["openId"] == open_id:
            if union_id and user.get("unionId") != union_id:
                user["unionId"] = union_id
                user["updatedAt"] = now_iso()
                persist_state()
            return user
    bind_user_id = user_id_from_token(bind_access_token)
    if bind_user_id and bind_user_id in STATE.users:
        user = STATE.users[bind_user_id]
        user["openId"] = open_id
        if union_id:
            user["unionId"] = union_id
        user["wechatBoundAt"] = now_iso()
        user["updatedAt"] = now_iso()
        persist_state()
        return user
    user_id = gen_id("usr")
    user = {
        "userId": user_id,
        "openId": open_id,
        "unionId": union_id,
        "nickname": "微信用户",
        "avatarUrl": "",
        "wechatBoundAt": "" if session.get("mock") else now_iso(),
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    STATE.users[user_id] = user
    STATE.credits[user_id] = {
        "userId": user_id,
        "balance": 6,
        "totalCredits": 6,
        "usedCredits": 0,
        "todayAdCount": 0,
        "dailyAdLimit": 3,
        "updatedAt": now_iso(),
    }
    STATE.credit_logs.append({"id": gen_id("log"), "userId": user_id, "type": "grant", "amount": 6, "bizId": "new_user", "createdAt": now_iso()})
    persist_state()
    return user


def issue_tokens(user_id: str) -> dict[str, str]:
    access_token = random_token("atk")
    refresh_token = random_token("rtk")
    STATE.tokens[access_token] = user_id
    STATE.refresh_tokens[refresh_token] = user_id
    persist_state()
    return {"accessToken": access_token, "refreshToken": refresh_token, "expiresIn": 7200}


def get_credits(user_id: str) -> dict[str, Any]:
    return STATE.credits.setdefault(
        user_id,
        {"userId": user_id, "balance": 0, "totalCredits": 0, "usedCredits": 0, "todayAdCount": 0, "dailyAdLimit": 3, "updatedAt": now_iso()},
    )


def credits_response(user_id: str) -> dict[str, Any]:
    credits = clone(get_credits(user_id))
    actual_balance = credits.get("balance", credits.get("totalCredits", 0))
    actual_total = credits.get("totalCredits", actual_balance)
    credits["actualBalance"] = actual_balance
    credits["actualTotalCredits"] = actual_total
    if truthy_env("AI_UNLIMITED_CREDITS", "1"):
        credits["unlimited"] = True
        credits["balance"] = 999999
        credits["totalCredits"] = 999999
        credits["displayText"] = "无限"
    else:
        credits["unlimited"] = False
        credits["displayText"] = str(credits.get("balance", credits.get("totalCredits", 0)))
    return credits


def add_credits(user_id: str, source: str, amount: int, biz_id: str) -> dict[str, Any]:
    credits = get_credits(user_id)
    credits["balance"] += amount
    credits["totalCredits"] += amount
    credits["updatedAt"] = now_iso()
    STATE.credit_logs.append({"id": gen_id("log"), "userId": user_id, "type": source, "amount": amount, "bizId": biz_id, "createdAt": now_iso()})
    persist_state()
    return credits_response(user_id)


def admin_adjust_credits(user_id: str, *, amount: int | None = None, balance: int | None = None, reason: str | None = None) -> dict[str, Any]:
    credits = get_credits(user_id)
    before = int(credits.get("balance", 0))
    if balance is not None:
        next_balance = max(0, int(balance))
        delta = next_balance - before
        credits["balance"] = next_balance
        credits["totalCredits"] = max(0, int(credits.get("totalCredits", 0)) + delta)
    else:
        delta = int(amount or 0)
        credits["balance"] = max(0, before + delta)
        credits["totalCredits"] = max(0, int(credits.get("totalCredits", 0)) + delta)
    credits["updatedAt"] = now_iso()
    STATE.credit_logs.append({
        "id": gen_id("log"),
        "userId": user_id,
        "type": "admin_adjust",
        "amount": delta,
        "bizId": reason or "admin",
        "createdAt": now_iso(),
    })
    persist_state()
    return credits_response(user_id)


def consume_credit(user_id: str, biz_id: str) -> dict[str, Any]:
    if truthy_env("AI_UNLIMITED_CREDITS", "1"):
        return credits_response(user_id)
    credits = get_credits(user_id)
    if credits["balance"] <= 0:
        raise AppError(402, "CREDIT_NOT_ENOUGH", "生成次数不足")
    credits["balance"] -= 1
    credits["usedCredits"] += 1
    credits["updatedAt"] = now_iso()
    STATE.credit_logs.append({"id": gen_id("log"), "userId": user_id, "type": "consume", "amount": -1, "bizId": biz_id, "createdAt": now_iso()})
    persist_state()
    return credits_response(user_id)


def public_task(task: dict[str, Any]) -> dict[str, Any]:
    data = clone(task)
    data.pop("inputImageDataUrl", None)
    data.pop("userId", None)
    enrich_task_elapsed(data)
    enrich_task_generation_estimate(data)
    return normalize_generated_image_urls(data)


def generation_seconds_per_image() -> int:
    try:
        return max(1, int(os.getenv("GENERATION_SECONDS_PER_IMAGE", "60")))
    except ValueError:
        return 60


def enrich_task_generation_estimate(task: dict[str, Any]) -> None:
    images = task.get("images") or []
    total_count = max(1, len(images))
    seconds_per_image = generation_seconds_per_image()
    estimated_total_ms = total_count * seconds_per_image * 1000
    terminal = task.get("status") in {"SUCCESS", "FAILED", "PARTIAL_SUCCESS", "TIMEOUT", "CANCELLED"}
    elapsed_ms = int(task.get("elapsedMs") or 0)
    success_or_failed_count = sum(1 for image in images if image.get("status") in {"SUCCESS", "FAILED"})
    base_progress = int(task.get("progress") or 0)
    if terminal:
        estimated_progress = 100
        estimated_remaining_ms = 0
    else:
        elapsed_progress = int(min(95, max(0, elapsed_ms / estimated_total_ms * 95)))
        completed_progress = int(min(95, success_or_failed_count / total_count * 95))
        estimated_progress = max(base_progress, elapsed_progress, completed_progress)
        estimated_remaining_ms = max(0, estimated_total_ms - elapsed_ms)
    task["generationSecondsPerImage"] = seconds_per_image
    task["estimatedTotalMs"] = estimated_total_ms
    task["estimatedRemainingMs"] = estimated_remaining_ms
    task["estimatedProgress"] = estimated_progress
    if not terminal:
        task["progress"] = estimated_progress


def parse_iso(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def enrich_task_elapsed(task: dict[str, Any]) -> None:
    status = task.get("status")
    started_at = task.get("startedAt") or task.get("provider", {}).get("startedAt") or task.get("createdAt")
    completed_at = task.get("completedAt") or task.get("provider", {}).get("completedAt")
    started_dt = parse_iso(started_at)
    completed_dt = parse_iso(completed_at)
    if not started_dt:
        task["elapsedMs"] = int(task.get("elapsedMs") or 0)
        return
    if completed_dt:
        elapsed_ms = int((completed_dt - started_dt).total_seconds() * 1000)
    elif status in {"QUEUED", "RUNNING", "PENDING", "PROCESSING"}:
        elapsed_ms = int((now_dt() - started_dt).total_seconds() * 1000)
    else:
        elapsed_ms = int(task.get("elapsedMs") or 0)
    task["elapsedMs"] = max(0, elapsed_ms)


def admin_asset_url(asset: dict[str, Any]) -> str:
    if asset.get("url"):
        return asset["url"]
    if asset.get("storage") in {"local", "memory"}:
        return f"/assets/generated/{asset['assetId']}.{asset['ext']}"
    public_base = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    return f"{public_base}/assets/generated/{asset['assetId']}.{asset['ext']}"


def normalize_generated_image_urls(data: dict[str, Any]) -> dict[str, Any]:
    for image in data.get("images", []):
        url = image.get("url") or ""
        match = re.search(r"/assets/generated/([^/.]+)\.([a-z0-9]+)", url, re.I)
        if not match:
            continue
        asset = STATE.generated_assets.get(match.group(1))
        if asset:
            image["url"] = admin_asset_url(asset)
    return data


def admin_task(task: dict[str, Any]) -> dict[str, Any]:
    data = public_task(task)
    data["userId"] = task.get("userId")
    return data



def admin_user(user_id: str) -> dict[str, Any]:
    user = clone(STATE.users[user_id])
    user["credits"] = credits_response(user_id)
    user["taskCount"] = sum(1 for task in STATE.tasks.values() if task.get("userId") == user_id)
    user["orderCount"] = sum(1 for order in STATE.orders.values() if order.get("userId") == user_id)
    return user
