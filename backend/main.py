from __future__ import annotations

from contextlib import asynccontextmanager
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from .core import (
    AppError,
    add_debug_check,
    append_debug_log,
    compact_headers,
    console_log,
    gen_id,
    normalize_log_level,
    now_iso,
    request_debug_body,
    response_debug_body,
    startup_environment_report,
)
from .generation import (
    call_kl_image2,
    svg_data_url,
)
from .routes import admin, public, system


def log_startup_environment() -> None:
    report = startup_environment_report()
    level = "info"
    if any(item.get("level") == "error" for item in report["checks"]):
        level = "error"
    elif any(item.get("level") == "warn" for item in report["checks"]):
        level = "warn"
    console_log(level, "APP_ENVIRONMENT_CHECK_START", "服务启动环境检查开始", {
        "time": report["time"],
        "checkCount": len(report["checks"]),
    }, force=True)
    console_log(level, "APP_ENVIRONMENT_RUNTIME", "服务运行配置摘要", report["runtime"], force=True)
    for name, item in report["env"].items():
        console_log("info", "APP_ENVIRONMENT_VAR", f"环境变量 {name}", {
            "name": name,
            **item,
        }, force=True)
    if not report["checks"]:
        console_log("info", "APP_ENVIRONMENT_CHECK_OK", "服务启动环境检查通过", {}, force=True)
    for item in report["checks"]:
        console_log(item.get("level", "info"), "APP_ENVIRONMENT_CHECK_ITEM", item.get("message", "环境检查项"), item, force=True)
    console_log(level, "APP_ENVIRONMENT_CHECK_END", "服务启动环境检查结束", {
        "database": report["runtime"].get("database"),
        "objectStorage": report["runtime"].get("objectStorage"),
    }, force=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log_startup_environment()
    yield


app = FastAPI(
    title="AI影像写真馆 FastAPI",
    version="0.1.0",
    description="Reference xinge/backend style FastAPI service for WeChat mini-program integration.",
    lifespan=lifespan,
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


app.include_router(public.router)
app.include_router(admin.router)
app.include_router(system.router)
