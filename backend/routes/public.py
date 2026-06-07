from __future__ import annotations

from typing import Any
import os
import re
import threading
import time
import uuid

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from ..catalog import PACKAGES, STYLE_PROMPTS
from ..cloud_runtime import parse_data_url
from ..core import AppError, OBJECT_STORAGE, STATE, add_debug_check, clone, gen_id, generation_image_size, now_iso, persist_auth_state, persist_state, runtime_config, truthy_env
from ..generation import process_generation, simple_poster_png
from ..schemas import (
    ConsumeReq,
    FeedbackReq,
    GenerationCreateReq,
    LoginReq,
    OrderCreateReq,
    PaymentNotifyReq,
    PosterReq,
    ProfilePatchReq,
    RefreshReq,
    RewardAdReq,
    UploadReq,
    ValidateReq,
)
from ..services import (
    add_credits,
    consume_credit,
    create_upload_record,
    credits_response,
    current_refresh_user_id,
    current_user_id,
    get_credits,
    get_or_create_user,
    issue_tokens,
    public_upload,
    public_task,
)

router = APIRouter()

@router.post("/auth/wechat-login")
def wechat_login(body: LoginReq) -> dict[str, Any]:
    user = get_or_create_user(body.code, body.bindAccessToken)
    if body.userInfo:
        nickname = body.userInfo.get("nickname") or body.userInfo.get("nickName")
        avatar_url = body.userInfo.get("avatarUrl") or body.userInfo.get("avatar_url")
        if nickname:
            user["nickname"] = nickname
        if avatar_url:
            user["avatarUrl"] = avatar_url
        user["updatedAt"] = now_iso()
        persist_auth_state()
    return {**issue_tokens(user["userId"]), "user": clone(user), "credits": credits_response(user["userId"])}

@router.post("/auth/refresh")
def refresh_token(body: RefreshReq) -> dict[str, Any]:
    return issue_tokens(current_refresh_user_id(body.refreshToken))

@router.post("/auth/logout")
def logout(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    for token, owner in list(STATE.tokens.items()):
        if owner == user_id:
            STATE.tokens.pop(token, None)
    persist_auth_state()
    return {"ok": True}

@router.get("/user/profile")
def get_profile(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    return clone(STATE.users[user_id])

@router.patch("/user/profile")
def patch_profile(body: ProfilePatchReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    user = STATE.users[user_id]
    if body.nickname is not None:
        user["nickname"] = body.nickname
    if body.avatarUrl is not None:
        user["avatarUrl"] = body.avatarUrl
    user["updatedAt"] = now_iso()
    persist_state()
    return clone(user)

@router.post("/user/delete")
def delete_user(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    STATE.users.pop(user_id, None)
    STATE.credits.pop(user_id, None)
    persist_state()
    return {"ok": True}

@router.get("/credits")
def credits(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    return credits_response(user_id)

@router.get("/credits/logs")
def credit_logs(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    items = [clone(item) for item in STATE.credit_logs if item["userId"] == user_id]
    return {"items": list(reversed(items)), "total": len(items)}

@router.post("/credits/consume")
def consume(body: ConsumeReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    amount = max(1, body.amount)
    result: dict[str, Any] = {}
    for index in range(amount):
        result = consume_credit(user_id, body.bizId or body.idempotencyKey or f"manual_{index}_{time.time()}")
    return result

@router.post("/credits/reward-ad")
def reward_ad(body: RewardAdReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    if not body.completed:
        return {"rewarded": False, "credits": credits_response(user_id)}
    event_id = body.adEventId or gen_id("ad")
    reward_key = f"{user_id}:{event_id}"
    if reward_key in STATE.ad_rewards:
        return {"rewarded": False, "credits": credits_response(user_id)}
    credits = get_credits(user_id)
    if credits["todayAdCount"] >= credits["dailyAdLimit"]:
        raise AppError(429, "AD_DAILY_LIMIT", "今日广告奖励次数已达上限")
    STATE.ad_rewards.add(reward_key)
    credits["todayAdCount"] += 1
    persist_state()
    return {"rewarded": True, "credits": add_credits(user_id, "ad", 1, "reward_ad")}

@router.post("/upload/image")
def upload_image(body: UploadReq, req: Request, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    add_debug_check(req, "UPLOAD_RECEIVED", "收到上传图片请求", details={
        "userId": user_id,
        "width": body.width,
        "height": body.height,
        "sizeBytes": body.sizeBytes,
        "dataUrlChars": len(body.dataUrl or ""),
    })
    if not body.dataUrl.startswith("data:image/"):
        add_debug_check(req, "UPLOAD_DATA_URL_INVALID", "dataUrl 不是 image data URL", level="error")
        raise AppError(400, "UPLOAD_INVALID_IMAGE", "请上传图片 dataUrl")
    try:
        mime_type, image_bytes = parse_data_url(body.dataUrl)
    except ValueError:
        add_debug_check(req, "UPLOAD_BASE64_INVALID", "dataUrl 缺少 base64 图片内容", level="error")
        raise AppError(400, "UPLOAD_INVALID_IMAGE", "请上传 base64 图片 dataUrl")
    estimated_bytes = len(image_bytes)
    if body.width <= 0 or body.height <= 0:
        add_debug_check(req, "UPLOAD_DIMENSION_INVALID", "图片宽高异常", level="warn", details={"width": body.width, "height": body.height})
    if estimated_bytes > 4 * 1024 * 1024:
        add_debug_check(req, "UPLOAD_SIZE_LARGE", "上传图片较大，真实生成可能较慢", level="warn", details={"estimatedBytes": estimated_bytes})
    try:
        upload = create_upload_record(
            user_id=user_id,
            image_bytes=image_bytes,
            mime_type=mime_type,
            width=body.width,
            height=body.height,
            size_bytes=body.sizeBytes or estimated_bytes,
            data_url=body.dataUrl,
        )
    except Exception as exc:  # noqa: BLE001 - expose COS diagnostics to admin logs and client.
        add_debug_check(req, "UPLOAD_OBJECT_STORAGE_FAILED", "上传图片写入对象存储失败", level="error", details={"error": str(exc), "objectStorage": runtime_config().get("objectStorage")})
        raise AppError(500, "UPLOAD_OBJECT_STORAGE_FAILED", f"上传图片写入对象存储失败：{exc}") from exc
    add_debug_check(req, "UPLOAD_STORED", "上传图片已保存", details={
        "imageId": upload["imageId"],
        "estimatedBytes": estimated_bytes,
        "mimeType": mime_type,
        "storage": upload.get("storage"),
        "objectKey": upload.get("objectKey"),
        "objectUrl": upload.get("objectUrl"),
        "objectStorage": runtime_config().get("objectStorage"),
    }, level="info" if upload.get("storage") == "cos" else "warn")
    return public_upload(upload)

@router.post("/upload/file")
async def upload_file(
    req: Request,
    file: UploadFile = File(...),
    width: int = Form(0),
    height: int = Form(0),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    content = await file.read()
    mime_type = file.content_type or "image/jpeg"
    if not mime_type.startswith("image/"):
        add_debug_check(req, "UPLOAD_FILE_TYPE_INVALID", "上传文件不是图片", level="error", details={"contentType": mime_type})
        raise AppError(400, "UPLOAD_INVALID_IMAGE", "请上传图片文件")
    if not content:
        add_debug_check(req, "UPLOAD_FILE_EMPTY", "上传文件为空", level="error")
        raise AppError(400, "UPLOAD_INVALID_IMAGE", "图片文件为空")
    try:
        upload = create_upload_record(
            user_id=user_id,
            image_bytes=content,
            mime_type=mime_type,
            width=width,
            height=height,
            size_bytes=len(content),
        )
    except Exception as exc:  # noqa: BLE001
        add_debug_check(req, "UPLOAD_OBJECT_STORAGE_FAILED", "上传文件写入对象存储失败", level="error", details={"error": str(exc), "objectStorage": runtime_config().get("objectStorage")})
        raise AppError(500, "UPLOAD_OBJECT_STORAGE_FAILED", f"上传文件写入对象存储失败：{exc}") from exc
    add_debug_check(req, "UPLOAD_FILE_STORED", "上传文件已保存", details={
        "imageId": upload["imageId"],
        "sizeBytes": len(content),
        "storage": upload.get("storage"),
        "objectKey": upload.get("objectKey"),
        "objectUrl": upload.get("objectUrl"),
        "objectStorage": runtime_config().get("objectStorage"),
    }, level="info" if upload.get("storage") == "cos" else "warn")
    return public_upload(upload)

@router.post("/upload/validate")
def validate_upload(body: ValidateReq, req: Request, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    upload = STATE.uploads.get(body.imageId)
    valid = bool(upload and upload["userId"] == user_id)
    add_debug_check(req, "UPLOAD_VALIDATE", "校验上传图片归属", details={
        "imageId": body.imageId,
        "exists": bool(upload),
        "requestUserId": user_id,
        "uploadUserId": upload.get("userId") if upload else "",
        "valid": valid,
    }, level="info" if valid else "warn")
    return {"valid": valid, "reason": "" if valid else "图片不存在或已过期"}

@router.post("/generation/create")
def create_generation(body: GenerationCreateReq, req: Request, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    config = runtime_config()
    generation_size, generation_size_source = generation_image_size(body.size)
    add_debug_check(req, "GENERATION_CREATE_RECEIVED", "收到生成任务请求", details={
        "userId": user_id,
        "inputImageId": body.inputImageId,
        "styles": body.styles,
        "requestSize": body.size,
        "size": generation_size,
        "sizeSource": generation_size_source,
        "runtime": config,
    })
    if not truthy_env("AI_UNLIMITED_CREDITS", "1") and get_credits(user_id)["balance"] <= 0:
        add_debug_check(req, "CREDIT_NOT_ENOUGH", "生成次数不足", level="error", details={"credits": get_credits(user_id)})
        raise AppError(402, "CREDIT_NOT_ENOUGH", "生成次数不足")
    upload = STATE.uploads.get(body.inputImageId)
    if not upload or upload["userId"] != user_id:
        add_debug_check(req, "GENERATION_UPLOAD_INVALID", "生成任务引用的上传图无效", level="error", details={
            "inputImageId": body.inputImageId,
            "uploadExists": bool(upload),
            "uploadUserId": upload.get("userId") if upload else "",
            "requestUserId": user_id,
        })
        raise AppError(400, "UPLOAD_INVALID_IMAGE", "请先上传照片")
    requested_styles = body.styles or ["pixar", "realistic", "handdrawn", "comic"]
    styles = [style for style in requested_styles if style in STYLE_PROMPTS]
    invalid_styles = [style for style in requested_styles if style not in STYLE_PROMPTS]
    if invalid_styles:
        add_debug_check(req, "GENERATION_STYLE_FILTERED", "部分风格参数不存在，已过滤", level="warn", details={"invalidStyles": invalid_styles, "allowedStyles": list(STYLE_PROMPTS)})
    if not styles:
        add_debug_check(req, "GENERATION_STYLE_EMPTY", "没有可用生成风格", level="error", details={"requestedStyles": requested_styles})
        raise AppError(400, "STYLE_INVALID", "请选择有效写真风格")
    if not re.fullmatch(r"\d+x\d+", generation_size):
        add_debug_check(req, "GENERATION_SIZE_SUSPICIOUS", "size 参数格式异常", level="warn", details={"requestSize": body.size, "size": generation_size, "sizeSource": generation_size_source})
    input_image_data_url = upload.get("inputImageDataUrl") or ""
    if not input_image_data_url and str(upload.get("url") or "").startswith("data:image/"):
        input_image_data_url = upload["url"]
    if not input_image_data_url:
        add_debug_check(req, "GENERATION_INPUT_DATA_MISSING", "上传图缺少内部生成输入数据", level="error", details={
            "inputImageId": upload.get("imageId"),
            "objectUrl": upload.get("objectUrl"),
            "objectKey": upload.get("objectKey"),
            "storage": upload.get("storage"),
        })
        raise AppError(500, "GENERATION_INPUT_DATA_MISSING", "上传图缺少内部生成输入数据，请重新上传照片")
    task_id = gen_id("task")
    task = {
        "taskId": task_id,
        "userId": user_id,
        "inputImageId": upload["imageId"],
        "inputImageDataUrl": input_image_data_url,
        "status": "QUEUED",
        "progress": 8,
        "size": generation_size,
        "sizeSource": generation_size_source,
        "generationSecondsPerImage": int(os.getenv("GENERATION_SECONDS_PER_IMAGE", "60")),
        "charged": False,
        "startedAt": "",
        "completedAt": "",
        "elapsedMs": 0,
        "provider": config,
        "images": [
            {"imageId": gen_id("out"), "style": style, "status": "PENDING", "url": "", "errorMessage": "", "elapsedMs": 0, "provider": {}}
            for style in styles
        ],
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    STATE.tasks[task_id] = task
    persist_state()
    add_debug_check(req, "GENERATION_TASK_CREATED", "生成任务已创建", details={
        "taskId": task_id,
        "styleCount": len(styles),
        "uploadSizeBytes": upload.get("sizeBytes"),
        "inputImageId": upload.get("imageId"),
        "inputObjectKey": upload.get("objectKey"),
        "inputObjectUrl": upload.get("objectUrl"),
        "inputStorage": upload.get("storage"),
    })
    threading.Thread(target=process_generation, args=(task_id,), daemon=True).start()
    return public_task(task)

@router.get("/generation/history")
def generation_history(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    items = [public_task(task) for task in STATE.tasks.values() if task["userId"] == user_id]
    items.reverse()
    return {"items": items, "total": len(items)}

@router.get("/generation/{task_id}")
def get_generation(task_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task or task["userId"] != user_id:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    return public_task(task)

@router.post("/generation/{task_id}/retry")
def retry_generation(task_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task or task["userId"] != user_id:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    task["status"] = "QUEUED"
    task["progress"] = 8
    for image in task["images"]:
        if image["status"] != "SUCCESS":
            image["status"] = "PENDING"
            image["errorMessage"] = ""
    persist_state()
    threading.Thread(target=process_generation, args=(task_id,), daemon=True).start()
    return public_task(task)

@router.post("/generation/{task_id}/cancel")
def cancel_generation(task_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task or task["userId"] != user_id:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    task["status"] = "CANCELLED"
    task["updatedAt"] = now_iso()
    persist_state()
    return public_task(task)

@router.get("/packages")
def packages() -> list[dict[str, Any]]:
    return clone(PACKAGES)

@router.post("/orders")
def create_order(body: OrderCreateReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    pkg = next((item for item in PACKAGES if item["packageId"] == body.packageId), PACKAGES[0])
    order = {
        "orderId": gen_id("ord"),
        "orderNo": f"NO{int(time.time() * 1000)}",
        "userId": user_id,
        "packageId": pkg["packageId"],
        "packageName": pkg["name"],
        "amountFen": pkg["priceFen"],
        "credits": pkg["credits"],
        "status": "PENDING",
        "createdAt": now_iso(),
    }
    payment_params = {
        "timeStamp": str(int(time.time())),
        "nonceStr": uuid.uuid4().hex,
        "package": f"prepay_id=mock_{int(time.time())}",
        "signType": "RSA",
        "paySign": "mock-signature",
    }
    order["paymentParams"] = payment_params
    STATE.orders[order["orderId"]] = order
    persist_state()
    return {"order": clone(order), "paymentParams": payment_params}

@router.get("/orders")
def list_orders(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    items = [clone(order) for order in STATE.orders.values() if order["userId"] == user_id]
    items.reverse()
    return {"items": items, "total": len(items)}

@router.get("/orders/{order_id}")
def order_detail(order_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    order = STATE.orders.get(order_id)
    if not order or order["userId"] != user_id:
        raise AppError(404, "ORDER_NOT_FOUND", "订单不存在")
    return clone(order)

@router.post("/orders/{order_id}/close")
def close_order(order_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    order = STATE.orders.get(order_id)
    if not order or order["userId"] != user_id:
        raise AppError(404, "ORDER_NOT_FOUND", "订单不存在")
    order["status"] = "CLOSED"
    persist_state()
    return {"ok": True}

@router.post("/payment/wechat/notify")
def payment_notify(body: PaymentNotifyReq) -> dict[str, str]:
    order = STATE.orders.get(body.orderId or "")
    if not order:
        order = next((item for item in STATE.orders.values() if item["status"] == "PENDING"), None)
    if order and order["status"] != "PAID" and body.paid:
        order["status"] = "PAID"
        order["transactionId"] = body.transactionId
        order["paidAt"] = now_iso()
        add_credits(order["userId"], "paid", order["credits"], order["orderId"])
    persist_state()
    return {"code": "SUCCESS", "message": "OK"}

@router.post("/payment/reconcile")
def payment_reconcile() -> dict[str, bool]:
    return {"ok": True}

@router.post("/share/create-poster")
def create_poster(body: PosterReq, user_id: str = Depends(current_user_id)) -> dict[str, str]:
    poster_id = gen_id("poster")
    stored = OBJECT_STORAGE.put_bytes(simple_poster_png(), mime_type="image/png", folder="generated", name=f"{poster_id}.png")
    STATE.generated_assets[poster_id] = {
        "assetId": poster_id,
        "style": "poster",
        "mimeType": "image/png",
        "ext": "png",
        "url": stored["url"],
        "key": stored["key"],
        "storage": stored["storage"],
        "sizeBytes": stored["sizeBytes"],
        "sourceImageUrl": body.imageUrl or "",
        "taskId": body.taskId or "",
        "userId": user_id,
        "createdAt": now_iso(),
    }
    persist_state()
    return {"posterUrl": stored["url"]}

@router.post("/share/reward")
def share_reward(user_id: str = Depends(current_user_id)) -> dict[str, bool]:
    return {"rewarded": False}

@router.post("/feedback")
def create_feedback(body: FeedbackReq, user_id: str = Depends(current_user_id)) -> dict[str, bool]:
    STATE.feedback.append({"id": gen_id("fb"), "userId": user_id, **body.model_dump(), "createdAt": now_iso()})
    persist_state()
    return {"ok": True}
