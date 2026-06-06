from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib import error, request
import base64
import json
import logging
import os
import random
import re
import string
import struct
import threading
import time
import uuid
import zlib

from fastapi import Depends, FastAPI, File, Form, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict

from .cloud_runtime import ObjectStorage, SnapshotStore, parse_data_url


TZ = timezone(timedelta(hours=8))
ROOT_DIR = Path(__file__).resolve().parents[1]


def load_dotenv() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


load_dotenv()


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


def truthy_env(name: str, default: str = "") -> bool:
    value = os.getenv(name, default).strip().lower()
    return value in {"1", "true", "yes", "on"}


def safe_url(url: str) -> str:
    if not url:
        return ""
    return re.sub(r"//([^/@]+)@", "//<auth>@", url)


def runtime_config() -> dict[str, Any]:
    token = os.getenv("KL_API_TOKEN") or os.getenv("KL_API_KEY") or ""
    proxy = os.getenv("KL_PROXY_URL") or ""
    return {
        "generationMode": "mock" if truthy_env("AI_MOCK_GENERATION") else "real",
        "mockEnabled": truthy_env("AI_MOCK_GENERATION"),
        "klTokenConfigured": bool(token),
        "klBaseUrl": os.getenv("KL_API_BASE_URL", "https://api.kl-api.info"),
        "klImageEndpoint": os.getenv("KL_IMAGE_ENDPOINT", "/v1/images/edits"),
        "klImageModel": os.getenv("KL_IMAGE_MODEL", "gpt-image-2"),
        "klProxyConfigured": bool(proxy),
        "klProxyUrl": safe_url(proxy),
        "klTimeoutSeconds": int(os.getenv("KL_TIMEOUT_SECONDS", "600")),
        "publicBaseUrl": os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/"),
        "unlimitedCredits": truthy_env("AI_UNLIMITED_CREDITS", "1"),
        "logLevel": configured_log_level(),
        "database": STORE.status(),
        "objectStorage": OBJECT_STORAGE.status(),
    }


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
        self.generated_assets: dict[str, dict[str, Any]] = {}
        self.admin_tokens: set[str] = set()
        self.debug_logs: list[dict[str, Any]] = []


STATE = State()
STORE = SnapshotStore()
OBJECT_STORAGE = ObjectStorage()

DEBUG_LOG_LIMIT = 300
DEBUG_BODY_LIMIT = 4000
LOG_LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40}


def normalize_log_level(level: str | None) -> str:
    normalized = (level or "info").strip().lower()
    if normalized == "warning":
        return "warn"
    return normalized if normalized in LOG_LEVELS else "info"


def configured_log_level() -> str:
    return normalize_log_level(os.getenv("LOG_LEVEL", "info"))


def highest_log_level(checks: list[dict[str, Any]]) -> str:
    level = "info"
    for check in checks:
        candidate = normalize_log_level(str(check.get("level") or "info"))
        if LOG_LEVELS[candidate] > LOG_LEVELS[level]:
            level = candidate
    return level


LOGGER = logging.getLogger("ai_portrait")
LOGGER.setLevel(logging.DEBUG)
if not LOGGER.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    LOGGER.addHandler(handler)
LOGGER.propagate = False


def console_log(level: str, code: str, message: str, details: dict[str, Any] | None = None) -> None:
    normalized = normalize_log_level(level)
    if LOG_LEVELS[normalized] < LOG_LEVELS[configured_log_level()]:
        return
    logger_method = LOGGER.warning if normalized == "warn" else getattr(LOGGER, normalized)
    safe_details = scrub_debug_value(details or {})
    logger_method("%s %s %s", code, message, json.dumps(safe_details, ensure_ascii=False, default=str))


def state_snapshot() -> dict[str, Any]:
    return {
        "users": clone(STATE.users),
        "tokens": clone(STATE.tokens),
        "refresh_tokens": clone(STATE.refresh_tokens),
        "credits": clone(STATE.credits),
        "credit_logs": clone(STATE.credit_logs),
        "uploads": clone(STATE.uploads),
        "tasks": clone(STATE.tasks),
        "orders": clone(STATE.orders),
        "feedback": clone(STATE.feedback),
        "ad_rewards": list(STATE.ad_rewards),
        "generated_assets": clone(STATE.generated_assets),
        "admin_tokens": list(STATE.admin_tokens),
        "debug_logs": clone(STATE.debug_logs),
    }


def restore_state(snapshot: dict[str, Any] | None) -> None:
    if not snapshot:
        return
    STATE.users = snapshot.get("users", {})
    STATE.tokens = snapshot.get("tokens", {})
    STATE.refresh_tokens = snapshot.get("refresh_tokens", {})
    STATE.credits = snapshot.get("credits", {})
    STATE.credit_logs = snapshot.get("credit_logs", [])
    STATE.uploads = snapshot.get("uploads", {})
    STATE.tasks = snapshot.get("tasks", {})
    STATE.orders = snapshot.get("orders", {})
    STATE.feedback = snapshot.get("feedback", [])
    STATE.ad_rewards = set(snapshot.get("ad_rewards", []))
    STATE.generated_assets = snapshot.get("generated_assets", {})
    STATE.admin_tokens = set(snapshot.get("admin_tokens", []))
    STATE.debug_logs = snapshot.get("debug_logs", [])


def persist_state() -> None:
    STORE.save(state_snapshot())


restore_state(STORE.load())


def scrub_debug_value(value: Any) -> Any:
    if isinstance(value, str):
        if value.startswith("data:image/"):
            return f"{value[:32]}...<data-url:{len(value)} chars>"
        if re.fullmatch(r"(atk|rtk|adm|sk)-[A-Za-z0-9_\-]+", value) or value.startswith(("atk_", "rtk_", "adm_", "Bearer ")):
            return "<redacted-token>"
        if len(value) > 240 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", value):
            return f"{value[:40]}...<base64:{len(value)} chars>"
        if len(value) > 800:
            return f"{value[:800]}...<truncated:{len(value)} chars>"
        return value
    if isinstance(value, list):
        return [scrub_debug_value(item) for item in value[:20]]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            lowered = key.lower()
            if lowered in {"authorization", "token", "accesstoken", "refreshtoken", "kl_api_token", "kl_api_key"}:
                result[key] = "<redacted>"
            else:
                result[key] = scrub_debug_value(item)
        return result
    return value


def compact_headers(headers: Any) -> dict[str, Any]:
    keep = {"content-type", "content-length", "authorization", "user-agent", "referer"}
    return scrub_debug_value({key: value for key, value in dict(headers).items() if key.lower() in keep})


async def request_debug_body(req: Request) -> dict[str, Any]:
    content_type = req.headers.get("content-type", "")
    content_length = int(req.headers.get("content-length") or 0)
    if "application/json" not in content_type:
        return {"contentType": content_type, "contentLength": content_length, "skipped": "non-json body"}
    raw = await req.body()
    if len(raw) > DEBUG_BODY_LIMIT:
        return {"contentType": content_type, "contentLength": len(raw), "skipped": "json body too large"}
    if not raw:
        return {"contentType": content_type, "contentLength": 0, "json": None}
    try:
        return {"contentType": content_type, "contentLength": len(raw), "json": scrub_debug_value(json.loads(raw))}
    except json.JSONDecodeError:
        return {"contentType": content_type, "contentLength": len(raw), "raw": raw.decode("utf-8", errors="replace")[:DEBUG_BODY_LIMIT]}


def response_debug_body(raw: bytes, content_type: str) -> dict[str, Any]:
    if "application/json" not in content_type:
        return {"contentType": content_type, "contentLength": len(raw), "skipped": "non-json response"}
    if len(raw) > DEBUG_BODY_LIMIT:
        return {"contentType": content_type, "contentLength": len(raw), "skipped": "json response too large"}
    try:
        return {"contentType": content_type, "contentLength": len(raw), "json": scrub_debug_value(json.loads(raw or b"{}"))}
    except json.JSONDecodeError:
        return {"contentType": content_type, "contentLength": len(raw), "raw": raw.decode("utf-8", errors="replace")[:DEBUG_BODY_LIMIT]}


def append_debug_log(entry: dict[str, Any]) -> None:
    checks = entry.get("checks") if isinstance(entry.get("checks"), list) else []
    normalized_checks = []
    for check in checks:
        normalized_check = dict(check)
        normalized_check["level"] = normalize_log_level(str(normalized_check.get("level") or "info"))
        normalized_checks.append(normalized_check)
    entry["checks"] = normalized_checks
    entry["level"] = normalize_log_level(str(entry.get("level") or highest_log_level(normalized_checks)))
    STATE.debug_logs.append(entry)
    if len(STATE.debug_logs) > DEBUG_LOG_LIMIT:
        del STATE.debug_logs[:-DEBUG_LOG_LIMIT]
    console_log(entry["level"], str(entry.get("path") or "LOG"), "debug log appended", {
        "id": entry.get("id"),
        "method": entry.get("method"),
        "statusCode": entry.get("statusCode"),
        "durationMs": entry.get("durationMs"),
        "checks": normalized_checks,
    })


def add_debug_check(req: Request, code: str, message: str, *, level: str = "info", details: dict[str, Any] | None = None) -> None:
    normalized_level = normalize_log_level(level)
    checks = getattr(req.state, "debugChecks", None)
    if checks is None:
        return
    safe_details = scrub_debug_value(details or {})
    checks.append({"level": normalized_level, "code": code, "message": message, "details": safe_details})
    console_log(normalized_level, code, message, safe_details)


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
async def handle_app_error(req: Request, exc: AppError) -> JSONResponse:
    add_debug_check(req, exc.code, exc.message, level="error", details={"statusCode": exc.status_code})
    return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})


@app.exception_handler(RequestValidationError)
async def handle_validation_error(req: Request, exc: RequestValidationError) -> JSONResponse:
    add_debug_check(req, "REQUEST_VALIDATION_ERROR", "请求参数校验失败", level="error", details={"errors": exc.errors()})
    return JSONResponse(status_code=422, content={"code": "REQUEST_VALIDATION_ERROR", "message": "请求参数校验失败", "details": exc.errors()})


@app.middleware("http")
async def debug_and_cors_middleware(req: Request, call_next):
    if req.method == "OPTIONS":
        return JSONResponse({}, headers=cors_headers())
    request_id = gen_id("dbg")
    started = time.time()
    req.state.debugRequestId = request_id
    req.state.debugChecks = []
    request_info = {
        "id": request_id,
        "startedAt": now_iso(),
        "method": req.method,
        "path": req.url.path,
        "query": dict(req.query_params),
        "client": req.client.host if req.client else "",
        "headers": compact_headers(req.headers),
        "body": await request_debug_body(req),
    }
    console_log("debug", "REQUEST_RECEIVED", "收到 HTTP 请求", {
        "id": request_id,
        "method": req.method,
        "path": req.url.path,
        "query": dict(req.query_params),
        "client": req.client.host if req.client else "",
    })
    try:
        resp = await call_next(req)
    except Exception as exc:  # noqa: BLE001 - keep local debug trail visible.
        append_debug_log({
            **request_info,
            "durationMs": int((time.time() - started) * 1000),
            "statusCode": 500,
            "checks": getattr(req.state, "debugChecks", []),
            "exception": {"type": type(exc).__name__, "message": str(exc)},
        })
        console_log("error", "REQUEST_EXCEPTION", "HTTP 请求处理异常", {
            "id": request_id,
            "method": req.method,
            "path": req.url.path,
            "durationMs": int((time.time() - started) * 1000),
            "exceptionType": type(exc).__name__,
            "message": str(exc),
        })
        raise

    for key, value in cors_headers().items():
        resp.headers[key] = value
    resp.headers["x-debug-request-id"] = request_id

    content_type = resp.headers.get("content-type", "")
    if "application/json" not in content_type:
        append_debug_log({
            **request_info,
            "durationMs": int((time.time() - started) * 1000),
            "statusCode": resp.status_code,
            "checks": getattr(req.state, "debugChecks", []),
            "response": {"contentType": content_type, "skipped": "non-json response"},
        })
        return resp

    raw = b""
    async for chunk in resp.body_iterator:
        raw += chunk
    append_debug_log({
        **request_info,
        "durationMs": int((time.time() - started) * 1000),
        "statusCode": resp.status_code,
        "checks": getattr(req.state, "debugChecks", []),
        "response": response_debug_body(raw, content_type),
    })
    headers = dict(resp.headers)
    headers["content-length"] = str(len(raw))
    return Response(content=raw, status_code=resp.status_code, headers=headers, media_type=resp.media_type)


def cors_headers() -> dict[str, str]:
    return {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
    }


class LoginReq(BaseModel):
    code: str | None = None
    device: dict[str, Any] | None = None
    userInfo: dict[str, Any] | None = None


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
    taskId: str | None = None


class FeedbackReq(BaseModel):
    model_config = ConfigDict(extra="allow")
    content: str
    contact: str | None = None
    source: str | None = None


class AdminLoginReq(BaseModel):
    username: str
    password: str


class AdminCreditAdjustReq(BaseModel):
    amount: int | None = None
    balance: int | None = None
    reason: str | None = None


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
    upload = {
        "imageId": image_id,
        "userId": user_id,
        "url": data_url or f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}",
        "objectUrl": stored["url"],
        "objectKey": stored["key"],
        "storage": stored["storage"],
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


def current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise AppError(401, "UNAUTHORIZED", "缺少登录 token")
    token = authorization.removeprefix("Bearer").strip()
    user_id = STATE.tokens.get(token)
    if not user_id:
        raise AppError(401, "UNAUTHORIZED", "登录已过期")
    return user_id


def current_admin(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise AppError(401, "ADMIN_UNAUTHORIZED", "缺少管理员 token")
    token = authorization.removeprefix("Bearer").strip()
    if token not in STATE.admin_tokens:
        raise AppError(401, "ADMIN_UNAUTHORIZED", "管理员登录已过期")
    return token


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
    return normalize_generated_image_urls(data)


def admin_asset_url(asset: dict[str, Any]) -> str:
    if asset.get("storage") in {"local", "memory"}:
        return f"/assets/generated/{asset['assetId']}.{asset['ext']}"
    if asset.get("url"):
        return asset["url"]
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


def summarize_payload(payload: Any) -> str:
    def scrub(value: Any) -> Any:
        if isinstance(value, str):
            if value.startswith("data:image/"):
                return f"{value[:32]}...<data-url:{len(value)} chars>"
            if len(value) > 180 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", value):
                return f"{value[:40]}...<base64:{len(value)} chars>"
            if len(value) > 500:
                return f"{value[:500]}...<truncated:{len(value)} chars>"
            return value
        if isinstance(value, list):
            return [scrub(item) for item in value[:3]]
        if isinstance(value, dict):
            return {key: scrub(item) for key, item in value.items()}
        return value

    return json.dumps(scrub(payload), ensure_ascii=False, indent=2)[:1200]


def store_generated_asset(data_url: str, *, style: str) -> str:
    if not data_url.startswith("data:image/"):
        return data_url
    mime_type, image_bytes = parse_data_url(data_url)
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp"}.get(mime_type, "png")
    asset_id = gen_id("gen")
    stored = OBJECT_STORAGE.put_bytes(image_bytes, mime_type=mime_type, folder="generated", name=f"{asset_id}.{ext}")
    STATE.generated_assets[asset_id] = {
        "assetId": asset_id,
        "style": style,
        "mimeType": mime_type,
        "ext": ext,
        "url": stored["url"],
        "key": stored["key"],
        "storage": stored["storage"],
        "sizeBytes": stored["sizeBytes"],
        "createdAt": now_iso(),
    }
    persist_state()
    return stored["url"]


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)


def simple_poster_png() -> bytes:
    width, height = 600, 800
    rows: list[bytes] = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            top_mix = y / max(1, height - 1)
            r = int(255 - 22 * top_mix)
            g = int(245 - 46 * top_mix)
            b = int(224 - 76 * top_mix)
            cx, cy = width // 2, 275
            dx = (x - cx) / 175
            dy = (y - cy) / 175
            if dx * dx + dy * dy < 1:
                r, g, b = 255, 184, 0
            face_dx = (x - cx) / 90
            face_dy = (y - 240) / 100
            if face_dx * face_dx + face_dy * face_dy < 1:
                r, g, b = 255, 224, 188
            body_dx = (x - cx) / 145
            body_dy = (y - 415) / 120
            if body_dx * body_dx + body_dy * body_dy < 1:
                r, g, b = 34, 34, 34
            if 70 <= y <= 78 and 105 <= x <= 495:
                r, g, b = 255, 184, 0
            if 605 <= y <= 613 and 120 <= x <= 480:
                r, g, b = 255, 184, 0
            row.extend((r, g, b))
        rows.append(b"\x00" + bytes(row))
    raw = b"".join(rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(raw, 6))
        + png_chunk(b"IEND", b"")
    )


def call_kl_image2(image_data_url: str, prompt: str, size: str) -> dict[str, Any]:
    token = os.getenv("KL_API_TOKEN") or os.getenv("KL_API_KEY")
    if not token:
        raise RuntimeError("KL_API_TOKEN 未配置，无法真实调用 gpt-image-2。调试 mock 请设置 AI_MOCK_GENERATION=1。")

    model = os.getenv("KL_IMAGE_MODEL", "gpt-image-2")
    base_url = os.getenv("KL_API_BASE_URL", "https://api.kl-api.info").rstrip("/")
    endpoint = os.getenv("KL_IMAGE_ENDPOINT", "/v1/images/edits")
    target = f"{base_url}{endpoint}"
    proxy_url = os.getenv("KL_PROXY_URL") or ""
    timeout_seconds = int(os.getenv("KL_TIMEOUT_SECONDS", "600"))

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
    add_field("n", "1")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="image"; filename="portrait.jpg"\r\n')
    parts.append(f"Content-Type: {mime_type}\r\n\r\n".encode())
    parts.append(image_bytes)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())

    body = b"".join(parts)
    req = request.Request(
        target,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
    )
    opener = request.build_opener()
    if proxy_url:
        opener = request.build_opener(request.ProxyHandler({"http": proxy_url, "https": proxy_url}))
    started = time.time()
    console_log("info", "KL_IMAGE_REQUEST", "开始调用 KL 图片接口", {
        "target": safe_url(target),
        "model": model,
        "endpoint": endpoint,
        "size": size,
        "mimeType": mime_type,
        "imageBytes": len(image_bytes),
        "requestBytes": len(body),
        "proxyConfigured": bool(proxy_url),
        "proxyUrl": safe_url(proxy_url),
        "timeoutSeconds": timeout_seconds,
    })
    try:
        with opener.open(req, timeout=timeout_seconds) as resp:
            raw_text = resp.read().decode("utf-8", errors="replace")
            payload = json.loads(raw_text)
            output_url = extract_output_url(payload)
            if not output_url:
                console_log("error", "KL_IMAGE_RESPONSE_INVALID", "KL API 未返回图片字段", {
                    "target": safe_url(target),
                    "httpStatus": resp.status,
                    "elapsedMs": int((time.time() - started) * 1000),
                    "responseSummary": summarize_payload(payload),
                })
                raise RuntimeError(f"KL API 未返回图片字段: {summarize_payload(payload)}")
            console_log("info", "KL_IMAGE_RESPONSE_OK", "KL 图片接口调用成功", {
                "target": safe_url(target),
                "httpStatus": resp.status,
                "elapsedMs": int((time.time() - started) * 1000),
                "responseKeys": list(payload.keys()) if isinstance(payload, dict) else [],
            })
            return {
                "url": output_url,
                "httpStatus": resp.status,
                "elapsedMs": int((time.time() - started) * 1000),
                "target": target,
                "model": model,
                "endpoint": endpoint,
                "requestBytes": len(body),
                "responseKeys": list(payload.keys()) if isinstance(payload, dict) else [],
                "rawSummary": summarize_payload(payload),
            }
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        console_log("error", "KL_IMAGE_HTTP_ERROR", "KL 图片接口返回 HTTP 错误", {
            "target": safe_url(target),
            "httpStatus": exc.code,
            "elapsedMs": int((time.time() - started) * 1000),
            "detail": detail,
        })
        raise RuntimeError(f"KL API HTTP {exc.code}: {detail}") from exc
    except Exception as exc:
        console_log("error", "KL_IMAGE_REQUEST_ERROR", "KL 图片接口调用异常", {
            "target": safe_url(target),
            "elapsedMs": int((time.time() - started) * 1000),
            "exceptionType": type(exc).__name__,
            "message": str(exc),
        })
        raise


def process_generation(task_id: str) -> None:
    task = STATE.tasks.get(task_id)
    if not task or task["status"] == "CANCELLED":
        console_log("warn", "GENERATION_TASK_SKIPPED", "生成任务不存在或已取消", {"taskId": task_id})
        return

    console_log("info", "GENERATION_TASK_RUNNING", "生成任务开始执行", {
        "taskId": task_id,
        "styleCount": len(task.get("images", [])),
        "size": task.get("size"),
        "mode": runtime_config().get("generationMode"),
    })
    task["status"] = "RUNNING"
    task["progress"] = 18
    task["provider"] = runtime_config()
    task["provider"]["startedAt"] = now_iso()
    task["updatedAt"] = now_iso()
    persist_state()
    success_count = 0

    for index, image in enumerate(task["images"]):
        if task["status"] == "CANCELLED":
            return
        started = time.time()
        image["status"] = "RUNNING"
        task["progress"] = min(92, 25 + index * 18)
        style = STYLE_PROMPTS.get(image["style"], STYLE_PROMPTS["pixar"])
        try:
            append_debug_log({
                "id": gen_id("dbg"),
                "startedAt": now_iso(),
                "method": "INTERNAL",
                "path": "internal:process_generation",
                "query": {},
                "client": "thread",
                "headers": {},
                "body": {"taskId": task_id, "imageId": image["imageId"], "style": image["style"], "size": task["size"], "provider": runtime_config()},
                "checks": [{"level": "info", "code": "KL_IMAGE_START", "message": "开始处理单张生成", "details": {"taskId": task_id, "style": image["style"]}}],
            })
            if truthy_env("AI_MOCK_GENERATION"):
                output = {
                    "url": svg_data_url(style["name"], "FastAPI mock output", style["color"]),
                    "httpStatus": "mock",
                    "elapsedMs": int((time.time() - started) * 1000),
                    "target": "mock",
                    "model": "mock",
                    "endpoint": "mock",
                    "responseKeys": ["mock"],
                    "rawSummary": "AI_MOCK_GENERATION=1",
                }
            else:
                output = call_kl_image2(task["inputImageDataUrl"], style["prompt"], task["size"])
            image["url"] = store_generated_asset(output["url"], style=image["style"])
            image["status"] = "SUCCESS"
            image["elapsedMs"] = output["elapsedMs"]
            image["provider"] = {
                "mode": task["provider"]["generationMode"],
                "httpStatus": output["httpStatus"],
                "target": safe_url(output["target"]),
                "model": output["model"],
                "endpoint": output["endpoint"],
                "responseKeys": output["responseKeys"],
                "rawSummary": output["rawSummary"],
            }
            persist_state()
            append_debug_log({
                "id": gen_id("dbg"),
                "startedAt": now_iso(),
                "method": "INTERNAL",
                "path": "internal:kl_image2",
                "query": {},
                "client": "thread",
                "headers": {},
                "durationMs": output["elapsedMs"],
                "statusCode": output["httpStatus"] if isinstance(output["httpStatus"], int) else 200,
                "body": {"taskId": task_id, "imageId": image["imageId"], "style": image["style"], "requestBytes": output.get("requestBytes")},
                "response": {"json": scrub_debug_value({"url": image["url"], "responseKeys": output.get("responseKeys"), "rawSummary": output.get("rawSummary")})},
                "checks": [{"level": "info", "code": "KL_IMAGE_SUCCESS", "message": "KL image2 调用成功", "details": image["provider"]}],
            })
            success_count += 1
        except Exception as exc:  # noqa: BLE001 - keep provider error visible to mini-program.
            image["status"] = "FAILED"
            image["errorMessage"] = str(exc)
            image["elapsedMs"] = int((time.time() - started) * 1000)
            image["provider"] = {
                "mode": task["provider"]["generationMode"],
                "target": safe_url(f"{task['provider']['klBaseUrl'].rstrip('/')}{task['provider']['klImageEndpoint']}"),
                "model": task["provider"]["klImageModel"],
                "endpoint": task["provider"]["klImageEndpoint"],
                "error": str(exc),
            }
            persist_state()
            append_debug_log({
                "id": gen_id("dbg"),
                "startedAt": now_iso(),
                "method": "INTERNAL",
                "path": "internal:kl_image2",
                "query": {},
                "client": "thread",
                "headers": {},
                "durationMs": image["elapsedMs"],
                "statusCode": 500,
                "body": {"taskId": task_id, "imageId": image["imageId"], "style": image["style"], "size": task["size"]},
                "response": {"json": scrub_debug_value({"error": str(exc)})},
                "checks": [{"level": "error", "code": "KL_IMAGE_FAILED", "message": "KL image2 调用失败", "details": image["provider"]}],
            })

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
    task["provider"]["completedAt"] = now_iso()
    task["provider"]["successCount"] = success_count
    console_log("info" if success_count else "error", "GENERATION_TASK_COMPLETED", "生成任务执行完成", {
        "taskId": task_id,
        "status": task["status"],
        "successCount": success_count,
        "totalCount": len(task["images"]),
    })
    task["provider"]["totalCount"] = len(task["images"])
    task["updatedAt"] = now_iso()
    persist_state()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "ai-portrait-fastapi", "time": now_iso(), "runtime": runtime_config()}


@app.get("/config/runtime")
def config_runtime() -> dict[str, Any]:
    return runtime_config()


@app.get("/assets/generated/{filename}")
def generated_asset(filename: str) -> Response:
    asset_id = filename.rsplit(".", 1)[0]
    asset = STATE.generated_assets.get(asset_id)
    if not asset:
        raise AppError(404, "ASSET_NOT_FOUND", "图片不存在或已过期")
    if asset.get("bytes"):
        return Response(content=asset["bytes"], media_type=asset["mimeType"])
    if asset.get("storage") == "local":
        found = OBJECT_STORAGE.get_local("generated", filename)
        if found:
            content, mime_type = found
            return Response(content=content, media_type=mime_type)
    raise AppError(404, "ASSET_NOT_FOUND", "图片不存在或已过期")


@app.get("/assets/object/{folder}/{filename}")
def object_asset(folder: str, filename: str) -> Response:
    found = OBJECT_STORAGE.get_local(folder, filename)
    if not found:
        raise AppError(404, "ASSET_NOT_FOUND", "图片不存在或已过期")
    content, mime_type = found
    return Response(content=content, media_type=mime_type)


@app.post("/admin/api/login")
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


@app.post("/admin/api/logout")
def admin_logout(admin_token: str = Depends(current_admin)) -> dict[str, bool]:
    STATE.admin_tokens.discard(admin_token)
    persist_state()
    return {"ok": True}


@app.get("/admin/api/me")
def admin_me(_: str = Depends(current_admin)) -> dict[str, Any]:
    return {"username": os.getenv("ADMIN_USERNAME", "admin"), "runtime": runtime_config()}


@app.get("/admin/api/runtime")
def admin_runtime(_: str = Depends(current_admin)) -> dict[str, Any]:
    return runtime_config()


@app.get("/admin/api/stats")
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


@app.get("/admin/api/users")
def admin_users(keyword: str | None = None, _: str = Depends(current_admin)) -> dict[str, Any]:
    items = [admin_user(user_id) for user_id in STATE.users]
    if keyword:
        text = keyword.lower()
        items = [item for item in items if text in item.get("userId", "").lower() or text in item.get("nickname", "").lower() or text in item.get("openId", "").lower()]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"items": items, "total": len(items)}


@app.get("/admin/api/users/{user_id}")
def admin_user_detail(user_id: str, _: str = Depends(current_admin)) -> dict[str, Any]:
    if user_id not in STATE.users:
        raise AppError(404, "USER_NOT_FOUND", "用户不存在")
    return {
        "user": admin_user(user_id),
        "tasks": [admin_task(task) for task in STATE.tasks.values() if task.get("userId") == user_id],
        "orders": [clone(order) for order in STATE.orders.values() if order.get("userId") == user_id],
        "creditLogs": [clone(item) for item in STATE.credit_logs if item.get("userId") == user_id],
    }


@app.post("/admin/api/users/{user_id}/credits")
def admin_update_credits(user_id: str, body: AdminCreditAdjustReq, _: str = Depends(current_admin)) -> dict[str, Any]:
    if user_id not in STATE.users:
        raise AppError(404, "USER_NOT_FOUND", "用户不存在")
    if body.amount is None and body.balance is None:
        raise AppError(400, "CREDIT_UPDATE_INVALID", "请填写调整次数或目标剩余次数")
    return admin_adjust_credits(user_id, amount=body.amount, balance=body.balance, reason=body.reason)


@app.get("/admin/api/tasks")
def admin_tasks(status: str | None = None, keyword: str | None = None, _: str = Depends(current_admin)) -> dict[str, Any]:
    items = [admin_task(task) for task in STATE.tasks.values()]
    if status:
        items = [item for item in items if item.get("status") == status]
    if keyword:
        text = keyword.lower()
        items = [item for item in items if text in item.get("taskId", "").lower() or text in item.get("userId", "").lower()]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"items": items, "total": len(items)}


@app.get("/admin/api/tasks/{task_id}")
def admin_task_detail(task_id: str, _: str = Depends(current_admin)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    return admin_task(task)


@app.post("/admin/api/tasks/{task_id}/retry")
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


@app.post("/admin/api/tasks/{task_id}/cancel")
def admin_cancel_task(task_id: str, _: str = Depends(current_admin)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    task["status"] = "CANCELLED"
    task["updatedAt"] = now_iso()
    persist_state()
    return admin_task(task)


@app.get("/admin/api/orders")
def admin_orders(status: str | None = None, _: str = Depends(current_admin)) -> dict[str, Any]:
    items = [clone(order) for order in STATE.orders.values()]
    if status:
        items = [item for item in items if item.get("status") == status]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"items": items, "total": len(items)}


@app.post("/admin/api/orders/{order_id}/close")
def admin_close_order(order_id: str, _: str = Depends(current_admin)) -> dict[str, bool]:
    order = STATE.orders.get(order_id)
    if not order:
        raise AppError(404, "ORDER_NOT_FOUND", "订单不存在")
    order["status"] = "CLOSED"
    persist_state()
    return {"ok": True}


@app.get("/admin/api/feedback")
def admin_feedback(_: str = Depends(current_admin)) -> dict[str, Any]:
    items = [clone(item) for item in STATE.feedback]
    items.reverse()
    return {"items": items, "total": len(items)}


@app.get("/admin/api/assets")
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


@app.get("/admin/api/debug/logs")
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


@app.delete("/admin/api/debug/logs")
def admin_clear_debug_logs(_: str = Depends(current_admin)) -> dict[str, bool]:
    STATE.debug_logs.clear()
    persist_state()
    return {"ok": True}


@app.post("/auth/wechat-login")
def wechat_login(body: LoginReq) -> dict[str, Any]:
    user = get_or_create_user(body.code)
    if body.userInfo:
        nickname = body.userInfo.get("nickname") or body.userInfo.get("nickName")
        avatar_url = body.userInfo.get("avatarUrl") or body.userInfo.get("avatar_url")
        if nickname:
            user["nickname"] = nickname
        if avatar_url:
            user["avatarUrl"] = avatar_url
        user["updatedAt"] = now_iso()
        persist_state()
    return {**issue_tokens(user["userId"]), "user": clone(user), "credits": credits_response(user["userId"])}


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
    persist_state()
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
    persist_state()
    return clone(user)


@app.post("/user/delete")
def delete_user(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    STATE.users.pop(user_id, None)
    STATE.credits.pop(user_id, None)
    persist_state()
    return {"ok": True}


@app.get("/credits")
def credits(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    return credits_response(user_id)


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


@app.post("/upload/image")
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
    upload = create_upload_record(
        user_id=user_id,
        image_bytes=image_bytes,
        mime_type=mime_type,
        width=body.width,
        height=body.height,
        size_bytes=body.sizeBytes or estimated_bytes,
        data_url=body.dataUrl,
    )
    add_debug_check(req, "UPLOAD_STORED", "上传图片已保存", details={"imageId": upload["imageId"], "estimatedBytes": estimated_bytes, "mimeType": mime_type, "storage": upload.get("storage")})
    return clone(upload)


@app.post("/upload/file")
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
    upload = create_upload_record(
        user_id=user_id,
        image_bytes=content,
        mime_type=mime_type,
        width=width,
        height=height,
        size_bytes=len(content),
    )
    add_debug_check(req, "UPLOAD_FILE_STORED", "上传文件已保存", details={"imageId": upload["imageId"], "sizeBytes": len(content), "storage": upload.get("storage")})
    return clone(upload)


@app.post("/upload/validate")
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


@app.post("/generation/create")
def create_generation(body: GenerationCreateReq, req: Request, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    config = runtime_config()
    add_debug_check(req, "GENERATION_CREATE_RECEIVED", "收到生成任务请求", details={
        "userId": user_id,
        "inputImageId": body.inputImageId,
        "styles": body.styles,
        "size": body.size,
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
    if not re.fullmatch(r"\d+x\d+", body.size):
        add_debug_check(req, "GENERATION_SIZE_SUSPICIOUS", "size 参数格式异常", level="warn", details={"size": body.size})
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
    add_debug_check(req, "GENERATION_TASK_CREATED", "生成任务已创建", details={"taskId": task_id, "styleCount": len(styles), "uploadSizeBytes": upload.get("sizeBytes")})
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
    persist_state()
    threading.Thread(target=process_generation, args=(task_id,), daemon=True).start()
    return public_task(task)


@app.post("/generation/{task_id}/cancel")
def cancel_generation(task_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    task = STATE.tasks.get(task_id)
    if not task or task["userId"] != user_id:
        raise AppError(404, "TASK_NOT_FOUND", "任务不存在")
    task["status"] = "CANCELLED"
    task["updatedAt"] = now_iso()
    persist_state()
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
    persist_state()
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
    persist_state()
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
    persist_state()
    return {"code": "SUCCESS", "message": "OK"}


@app.post("/payment/reconcile")
def payment_reconcile() -> dict[str, bool]:
    return {"ok": True}


@app.post("/share/create-poster")
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


@app.post("/share/reward")
def share_reward(user_id: str = Depends(current_user_id)) -> dict[str, bool]:
    return {"rewarded": False}


@app.post("/feedback")
def create_feedback(body: FeedbackReq, user_id: str = Depends(current_user_id)) -> dict[str, bool]:
    STATE.feedback.append({"id": gen_id("fb"), "userId": user_id, **body.model_dump(), "createdAt": now_iso()})
    persist_state()
    return {"ok": True}


@app.get("/admin")
def admin_index() -> RedirectResponse:
    return RedirectResponse(url="/admin/", status_code=307)


@app.get("/admin/{path:path}")
def admin_static(path: str) -> FileResponse:
    admin_dir = ROOT_DIR / "frontend" / "admin"
    target = (admin_dir / path).resolve()
    if not str(target).startswith(str(admin_dir.resolve())) or not target.is_file():
        target = admin_dir / "index.html"
    return FileResponse(target)
