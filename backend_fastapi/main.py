from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error, request
import base64
import json
import os
import random
import re
import string
import threading
import time
import uuid

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict


TZ = timezone(timedelta(hours=8))


def now_dt() -> datetime:
    return datetime.now(TZ)


def now_iso() -> str:
    return now_dt().isoformat()


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4()}"


def random_token(prefix: str) -> str:
    body = "".join(random.choices(string.ascii_letters + string.digits, k=24))
    return f"{prefix}_{body}"


def clone(value: Any) -> Any:
    return deepcopy(value)


def svg_data_url(title: str, subtitle: str, color: str = "#FFB800") -> str:
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
<rect width="1024" height="1024" fill="#FFF5E8"/>
<circle cx="512" cy="372" r="164" fill="{color}"/>
<circle cx="454" cy="340" r="20" fill="#222"/>
<circle cx="570" cy="340" r="20" fill="#222"/>
<path d="M432 454c58 46 126 46 168 0" fill="none" stroke="#222" stroke-width="18" stroke-linecap="round"/>
<text x="512" y="690" text-anchor="middle" font-family="Arial" font-size="54" font-weight="700" fill="#222">{title}</text>
<text x="512" y="760" text-anchor="middle" font-family="Arial" font-size="32" fill="#666">{subtitle}</text>
</svg>"""
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


class State:
    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.tokens: dict[str, str] = {}
        self.refresh_tokens: dict[str, str] = {}
        self.credits: dict[str, dict[str, Any]] = {}
        self.credit_logs: list[dict[str, Any]] = []
        self.uploads: dict[str, dict[str, Any]] = {}
        self.tasks: dict[str, dict[str, Any]] = {}
        self.orders: dict[str, dict[str, Any]] = {}
        self.feedback: list[dict[str, Any]] = []
        self.ad_rewards: set[str] = set()


STATE = State()


STYLE_PROMPTS = {
    "pixar": {
        "name": "3D皮克斯卡通",
        "color": "#FFB800",
        "prompt": "保留上传照片中人物身份特征，将人物重绘为高质量3D动画电影角色，柔和立体、明亮眼睛、精致布光，不要文字水印。",
    },
    "realistic": {
        "name": "高级写实插画",
        "color": "#FF7D45",
        "prompt": "保留人物五官比例、发型和姿态，生成高级写实插画写真，电影级光影、自然肤色、干净背景，不改变人物身份。",
    },
    "handdrawn": {
        "name": "文艺手绘质感",
        "color": "#A87532",
        "prompt": "保留人物身份特征，生成温柔文艺手绘写真，柔和线条、纸张纹理、淡雅配色、治愈氛围。",
    },
    "comic": {
        "name": "潮流涂鸦漫画",
        "color": "#222222",
        "prompt": "保留人物身份特征，生成潮流街头漫画风格，清晰轮廓、漫画分镜质感、适度涂鸦元素，不要品牌logo和文字。",
    },
}

PACKAGES = [
    {"packageId": "pkg_6_20", "name": "20次包", "priceFen": 600, "credits": 20},
    {"packageId": "pkg_12_50", "name": "50次包", "priceFen": 1200, "credits": 50},
    {"packageId": "pkg_19_100", "name": "100次包", "priceFen": 1900, "credits": 100},
]


app = FastAPI(
    title="AI影像写真馆 FastAPI",
    version="0.1.0",
    description="Reference xinge/backend style FastAPI service for WeChat mini-program integration.",
)


@app.exception_handler(AppError)
async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})


@app.middleware("http")
async def cors_middleware(req: Request, call_next):
    if req.method == "OPTIONS":
        return JSONResponse({}, headers=cors_headers())
    resp = await call_next(req)
    for key, value in cors_headers().items():
        resp.headers[key] = value
    return resp


def cors_headers() -> dict[str, str]:
    return {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
    }


class LoginReq(BaseModel):
    code: str | None = None
    device: dict[str, Any] | None = None


class RefreshReq(BaseModel):
    refreshToken: str


class ProfilePatchReq(BaseModel):
    nickname: str | None = None
    avatarUrl: str | None = None


class ConsumeReq(BaseModel):
    amount: int = 1
    bizId: str | None = None
    idempotencyKey: str | None = None


class RewardAdReq(BaseModel):
    adUnitId: str | None = None
    adEventId: str | None = None
    completed: bool = False


class UploadReq(BaseModel):
    dataUrl: str
    width: int = 1024
    height: int = 1024
    sizeBytes: int | None = None


class ValidateReq(BaseModel):
    imageId: str


class GenerationCreateReq(BaseModel):
    inputImageId: str
    styles: list[str] | None = None
    size: str = "1024x1024"


class OrderCreateReq(BaseModel):
    packageId: str


class PaymentNotifyReq(BaseModel):
    orderId: str | None = None
    transactionId: str | None = None
    paid: bool = True


class PosterReq(BaseModel):
    imageUrl: str | None = None
    templateId: str | None = None


class FeedbackReq(BaseModel):
    model_config = ConfigDict(extra="allow")
    content: str
    contact: str | None = None
    source: str | None = None


def current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise AppError(401, "UNAUTHORIZED", "缺少登录 token")
    token = authorization.removeprefix("Bearer").strip()
    user_id = STATE.tokens.get(token)
    if not user_id:
        raise AppError(401, "UNAUTHORIZED", "登录已过期")
    return user_id


def get_or_create_user(code: str | None = None) -> dict[str, Any]:
    open_id = f"mock_openid_{code or 'dev'}"
    for user in STATE.users.values():
        if user["openId"] == open_id:
            return user
    user_id = gen_id("usr")
    user = {
        "userId": user_id,
        "openId": open_id,
        "nickname": "微信用户",
        "avatarUrl": "",
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
    return user


def issue_tokens(user_id: str) -> dict[str, str]:
    access_token = random_token("atk")
    refresh_token = random_token("rtk")
    STATE.tokens[access_token] = user_id
    STATE.refresh_tokens[refresh_token] = user_id
    return {"accessToken": access_token, "refreshToken": refresh_token, "expiresIn": 7200}


def get_credits(user_id: str) -> dict[str, Any]:
    return STATE.credits.setdefault(
        user_id,
        {"userId": user_id, "balance": 0, "totalCredits": 0, "usedCredits": 0, "todayAdCount": 0, "dailyAdLimit": 3, "updatedAt": now_iso()},
    )


def add_credits(user_id: str, source: str, amount: int, biz_id: str) -> dict[str, Any]:
    credits = get_credits(user_id)
    credits["balance"] += amount
    credits["totalCredits"] += amount
    credits["updatedAt"] = now_iso()
    STATE.credit_logs.append({"id": gen_id("log"), "userId": user_id, "type": source, "amount": amount, "bizId": biz_id, "createdAt": now_iso()})
    return clone(credits)


def consume_credit(user_id: str, biz_id: str) -> dict[str, Any]:
    credits = get_credits(user_id)
    if credits["balance"] <= 0:
        raise AppError(402, "CREDIT_NOT_ENOUGH", "生成次数不足")
    credits["balance"] -= 1
    credits["usedCredits"] += 1
    credits["updatedAt"] = now_iso()
    STATE.credit_logs.append({"id": gen_id("log"), "userId": user_id, "type": "consume", "amount": -1, "bizId": biz_id, "createdAt": now_iso()})
    return clone(credits)


def public_task(task: dict[str, Any]) -> dict[str, Any]:
    data = clone(task)
    data.pop("inputImageDataUrl", None)
    data.pop("userId", None)
    return data


def extract_output_url(payload: Any) -> str:
    if payload is None:
        return ""
    if isinstance(payload, str):
        text = payload.strip()
        if text.startswith("http") or text.startswith("data:image/"):
            return text
        match = re.search(r"https?://[^\s\"'<>\\]+", text)
        return match.group(0) if match else ""
    if isinstance(payload, list):
        for item in payload:
            found = extract_output_url(item)
            if found:
                return found
    if isinstance(payload, dict):
        for key in ("url", "image", "image_url", "output", "b64_json", "base64"):
            if key in payload:
                value = payload[key]
                if key in {"b64_json", "base64"} and isinstance(value, str):
                    return f"data:image/png;base64,{value}"
                found = extract_output_url(value)
                if found:
                    return found
        for value in payload.values():
            found = extract_output_url(value)
            if found:
                return found
    return ""


def call_kl_image2(image_data_url: str, prompt: str, size: str) -> str:
    token = os.getenv("KL_API_TOKEN") or os.getenv("KL_API_KEY")
    if not token:
        return ""

    model = os.getenv("KL_IMAGE_MODEL", "gpt-image-2")
    base_url = os.getenv("KL_API_BASE_URL", "https://api.kl-api.info").rstrip("/")
    endpoint = os.getenv("KL_IMAGE_ENDPOINT", "/v1/images/edits")
    target = f"{base_url}{endpoint}"

    match = re.match(r"^data:([^;]+);base64,(.*)$", image_data_url)
    if not match:
        raise RuntimeError("input image must be dataUrl")
    mime_type, encoded = match.groups()
    image_bytes = base64.b64decode(encoded)

    boundary = f"----ai-portrait-{uuid.uuid4().hex}"
    parts: list[bytes] = []

    def add_field(name: str, value: str) -> None:
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        parts.append(value.encode("utf-8"))
        parts.append(b"\r\n")

    add_field("model", model)
    add_field("prompt", prompt)
    add_field("size", size)
    add_field("response_format", "url")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="image"; filename="portrait.jpg"\r\n')
    parts.append(f"Content-Type: {mime_type}\r\n\r\n".encode())
    parts.append(image_bytes)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())

    req = request.Request(
        target,
        data=b"".join(parts),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with request.urlopen(req, timeout=600) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return extract_output_url(payload)
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"KL API HTTP {exc.code}: {detail}") from exc


def process_generation(task_id: str) -> None:
    task = STATE.tasks.get(task_id)
    if not task or task["status"] == "CANCELLED":
        return

    task["status"] = "RUNNING"
    task["progress"] = 18
    task["updatedAt"] = now_iso()
    success_count = 0

    for index, image in enumerate(task["images"]):
        if task["status"] == "CANCELLED":
            return
        started = time.time()
        image["status"] = "RUNNING"
        task["progress"] = min(92, 25 + index * 18)
        style = STYLE_PROMPTS.get(image["style"], STYLE_PROMPTS["pixar"])
        try:
            output_url = call_kl_image2(task["inputImageDataUrl"], style["prompt"], task["size"])
            if not output_url:
                output_url = svg_data_url(style["name"], "FastAPI mock output", style["color"])
            image["url"] = output_url
            image["status"] = "SUCCESS"
            image["elapsedMs"] = int((time.time() - started) * 1000)
            success_count += 1
        except Exception as exc:  # noqa: BLE001 - keep provider error visible to mini-program.
            image["status"] = "FAILED"
            image["errorMessage"] = str(exc)
            image["elapsedMs"] = int((time.time() - started) * 1000)

    if success_count == len(task["images"]):
        task["status"] = "SUCCESS"
        task["progress"] = 100
    elif success_count > 0:
        task["status"] = "PARTIAL_SUCCESS"
        task["progress"] = 100
    else:
        task["status"] = "FAILED"
        task["progress"] = 100

    if success_count > 0 and not task.get("charged"):
        consume_credit(task["userId"], task["taskId"])
        task["charged"] = True
    task["updatedAt"] = now_iso()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "ai-portrait-fastapi", "time": now_iso()}


@app.post("/auth/wechat-login")
def wechat_login(body: LoginReq) -> dict[str, Any]:
    user = get_or_create_user(body.code)
    return {**issue_tokens(user["userId"]), "user": clone(user), "credits": clone(get_credits(user["userId"]))}


@app.post("/auth/refresh")
def refresh_token(body: RefreshReq) -> dict[str, Any]:
    user_id = STATE.refresh_tokens.get(body.refreshToken)
    if not user_id:
        raise AppError(401, "UNAUTHORIZED", "refresh token 无效")
    return issue_tokens(user_id)


@app.post("/auth/logout")
def logout(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    for token, owner in list(STATE.tokens.items()):
        if owner == user_id:
            STATE.tokens.pop(token, None)
    return {"ok": True}


@app.get("/user/profile")
def get_profile(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    return clone(STATE.users[user_id])


@app.patch("/user/profile")
def patch_profile(body: ProfilePatchReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    user = STATE.users[user_id]
    if body.nickname is not None:
        user["nickname"] = body.nickname
    if body.avatarUrl is not None:
        user["avatarUrl"] = body.avatarUrl
    user["updatedAt"] = now_iso()
    return clone(user)


@app.post("/user/delete")
def delete_user(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    STATE.users.pop(user_id, None)
    STATE.credits.pop(user_id, None)
    return {"ok": True}


@app.get("/credits")
def credits(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    return clone(get_credits(user_id))


@app.get("/credits/logs")
def credit_logs(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    items = [clone(item) for item in STATE.credit_logs if item["userId"] == user_id]
    return {"items": list(reversed(items)), "total": len(items)}


@app.post("/credits/consume")
def consume(body: ConsumeReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    amount = max(1, body.amount)
    result: dict[str, Any] = {}
    for index in range(amount):
        result = consume_credit(user_id, body.bizId or body.idempotencyKey or f"manual_{index}_{time.time()}")
    return result


@app.post("/credits/reward-ad")
def reward_ad(body: RewardAdReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    if not body.completed:
        return {"rewarded": False, "credits": clone(get_credits(user_id))}
    event_id = body.adEventId or gen_id("ad")
    if event_id in STATE.ad_rewards:
        return {"rewarded": False, "credits": clone(get_credits(user_id))}
    credits = get_credits(user_id)
    if credits["todayAdCount"] >= credits["dailyAdLimit"]:
        raise AppError(429, "AD_DAILY_LIMIT", "今日广告奖励次数已达上限")
    STATE.ad_rewards.add(event_id)
    credits["todayAdCount"] += 1
    return {"rewarded": True, "credits": add_credits(user_id, "ad", 1, "reward_ad")}


@app.post("/upload/image")
def upload_image(body: UploadReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    if not body.dataUrl.startswith("data:image/"):
        raise AppError(400, "UPLOAD_INVALID_IMAGE", "请上传图片 dataUrl")
    image_id = gen_id("img")
    upload = {
        "imageId": image_id,
        "userId": user_id,
        "url": body.dataUrl,
        "width": body.width,
        "height": body.height,
        "sizeBytes": body.sizeBytes or int(len(body.dataUrl) * 0.75),
        "expiresAt": (now_dt() + timedelta(days=1)).isoformat(),
        "createdAt": now_iso(),
    }
    STATE.uploads[image_id] = upload
    return clone(upload)


@app.post("/upload/validate")
def validate_upload(body: ValidateReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    upload = STATE.uploads.get(body.imageId)
    valid = bool(upload and upload["userId"] == user_id)
    return {"valid": valid, "reason": "" if valid else "图片不存在或已过期"}


@app.post("/generation/create")
def create_generation(body: GenerationCreateReq, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    if get_credits(user_id)["balance"] <= 0:
        raise AppError(402, "CREDIT_NOT_ENOUGH", "生成次数不足")
    upload = STATE.uploads.get(body.inputImageId)
    if not upload or upload["userId"] != user_id:
        raise AppError(400, "UPLOAD_INVALID_IMAGE", "请先上传照片")
    styles = [style for style in (body.styles or ["pixar", "realistic", "handdrawn", "comic"]) if style in STYLE_PROMPTS]
    task_id = gen_id("task")
    task = {
        "taskId": task_id,
        "userId": user_id,
        "inputImageId": upload["imageId"],
        "inputImageDataUrl": upload["url"],
        "status": "QUEUED",
        "progress": 8,
        "size": body.size,
        "charged": False,
        "images": [
            {"imageId": gen_id("out"), "style": style, "status": "PENDING", "url": "", "errorMessage": "", "elapsedMs": 0}
            for style in styles
        ],
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    STATE.tasks[task_id] = task
    threading.Thread(target=process_generation, args=(task_id,), daemon=True).start()
    return public_task(task)


@app.get("/generation/history")
def generation_history(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    items = [public_task(task) for task in STATE.tasks.values() if task["userId"] == user_id]
    items.reverse()
    return {"items": items, "total": len(items)}


@app.get("/generation/{task_id}")
def get_generation(task_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task or task["userId"] != user_id:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    return public_task(task)


@app.post("/generation/{task_id}/retry")
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
    threading.Thread(target=process_generation, args=(task_id,), daemon=True).start()
    return public_task(task)


@app.post("/generation/{task_id}/cancel")
def cancel_generation(task_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task or task["userId"] != user_id:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    task["status"] = "CANCELLED"
    task["updatedAt"] = now_iso()
    return public_task(task)


@app.get("/packages")
def packages() -> list[dict[str, Any]]:
    return clone(PACKAGES)


@app.post("/orders")
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
    return {"order": clone(order), "paymentParams": payment_params}


@app.get("/orders")
def list_orders(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    items = [clone(order) for order in STATE.orders.values() if order["userId"] == user_id]
    items.reverse()
    return {"items": items, "total": len(items)}


@app.get("/orders/{order_id}")
def order_detail(order_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    order = STATE.orders.get(order_id)
    if not order or order["userId"] != user_id:
        raise AppError(404, "ORDER_NOT_FOUND", "订单不存在")
    return clone(order)


@app.post("/orders/{order_id}/close")
def close_order(order_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    order = STATE.orders.get(order_id)
    if not order or order["userId"] != user_id:
        raise AppError(404, "ORDER_NOT_FOUND", "订单不存在")
    order["status"] = "CLOSED"
    return {"ok": True}


@app.post("/payment/wechat/notify")
def payment_notify(body: PaymentNotifyReq) -> dict[str, str]:
    order = STATE.orders.get(body.orderId or "")
    if not order:
        order = next((item for item in STATE.orders.values() if item["status"] == "PENDING"), None)
    if order and order["status"] != "PAID" and body.paid:
        order["status"] = "PAID"
        order["transactionId"] = body.transactionId
        order["paidAt"] = now_iso()
        add_credits(order["userId"], "paid", order["credits"], order["orderId"])
    return {"code": "SUCCESS", "message": "OK"}


@app.post("/payment/reconcile")
def payment_reconcile() -> dict[str, bool]:
    return {"ok": True}


@app.post("/share/create-poster")
def create_poster(_: PosterReq, user_id: str = Depends(current_user_id)) -> dict[str, str]:
    return {"posterUrl": svg_data_url("AI影像写真馆", "扫码生成你的艺术写真", "#FFB800")}


@app.post("/share/reward")
def share_reward(user_id: str = Depends(current_user_id)) -> dict[str, bool]:
    return {"rewarded": False}


@app.post("/feedback")
def create_feedback(body: FeedbackReq, user_id: str = Depends(current_user_id)) -> dict[str, bool]:
    STATE.feedback.append({"id": gen_id("fb"), "userId": user_id, **body.model_dump(), "createdAt": now_iso()})
    return {"ok": True}
