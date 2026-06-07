from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import json
import logging
import os
import random
import re
import string
import time
import uuid

from fastapi import Request

from .cloud_runtime import ObjectStorage, SnapshotStore


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


def truthy_env(name: str, default: str = "") -> bool:
    value = os.getenv(name, default).strip().lower()
    return value in {"1", "true", "yes", "on"}


def generation_image_size(requested_size: str | None = None) -> tuple[str, str]:
    env_size = os.getenv("KL_IMAGE_SIZE", "").strip()
    if env_size:
        return env_size, "env"
    request_size = (requested_size or "").strip()
    if request_size:
        return request_size, "request"
    return "1024x1024", "default"


def safe_url(url: str) -> str:
    if not url:
        return ""
    return re.sub(r"//([^/@]+)@", "//<auth>@", url)


def runtime_config() -> dict[str, Any]:
    token = os.getenv("KL_API_TOKEN") or os.getenv("KL_API_KEY") or ""
    proxy = os.getenv("KL_PROXY_URL") or ""
    image_size, image_size_source = generation_image_size()
    return {
        "generationMode": "mock" if truthy_env("AI_MOCK_GENERATION") else "real",
        "mockEnabled": truthy_env("AI_MOCK_GENERATION"),
        "klTokenConfigured": bool(token),
        "klBaseUrl": os.getenv("KL_API_BASE_URL", "https://api.kl-api.info"),
        "klImageEndpoint": os.getenv("KL_IMAGE_ENDPOINT", "/v1/images/edits"),
        "klImageModel": os.getenv("KL_IMAGE_MODEL", "gpt-image-2"),
        "klImageSize": image_size,
        "klImageSizeSource": image_size_source,
        "klProxyConfigured": bool(proxy),
        "klProxyUrl": safe_url(proxy),
        "klForceIpv4": truthy_env("KL_FORCE_IPV4"),
        "klUserAgentConfigured": bool(os.getenv("KL_USER_AGENT", "").strip()),
        "klTimeoutSeconds": int(os.getenv("KL_TIMEOUT_SECONDS", "600")),
        "klRetry5xxCount": int(os.getenv("KL_RETRY_5XX_COUNT", "1")),
        "klRetryBackoffSeconds": int(os.getenv("KL_RETRY_BACKOFF_SECONDS", "120")),
        "publicBaseUrl": os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/"),
        "unlimitedCredits": truthy_env("AI_UNLIMITED_CREDITS", "1"),
        "logLevel": configured_log_level(),
        "database": STORE.status(),
        "objectStorage": OBJECT_STORAGE.status(),
    }


def masked_env_value(name: str, *, secret: bool = False) -> dict[str, Any]:
    value = os.getenv(name, "")
    data: dict[str, Any] = {"configured": bool(value)}
    if not value:
        data["value"] = ""
    elif secret:
        data["value"] = f"<redacted:{len(value)} chars>"
    else:
        data["value"] = safe_url(value)
    return data


def startup_environment_report() -> dict[str, Any]:
    config = runtime_config()
    public_base = os.getenv("PUBLIC_BASE_URL", "").strip()
    kl_proxy = os.getenv("KL_PROXY_URL", "").strip()
    admin_password = os.getenv("ADMIN_PASSWORD", "admin123")
    cos_public_base = os.getenv("COS_PUBLIC_BASE_URL") or os.getenv("OBJECT_STORAGE_PUBLIC_BASE_URL") or ""
    port = os.getenv("PORT", "").strip()
    tracked = {
        "PORT": masked_env_value("PORT"),
        "DATA_DIR": masked_env_value("DATA_DIR"),
        "PUBLIC_BASE_URL": masked_env_value("PUBLIC_BASE_URL"),
        "LOG_LEVEL": masked_env_value("LOG_LEVEL"),
        "AI_MOCK_GENERATION": masked_env_value("AI_MOCK_GENERATION"),
        "AI_UNLIMITED_CREDITS": masked_env_value("AI_UNLIMITED_CREDITS"),
        "GENERATION_SECONDS_PER_IMAGE": masked_env_value("GENERATION_SECONDS_PER_IMAGE"),
        "KL_API_BASE_URL": masked_env_value("KL_API_BASE_URL"),
        "KL_IMAGE_ENDPOINT": masked_env_value("KL_IMAGE_ENDPOINT"),
        "KL_IMAGE_MODEL": masked_env_value("KL_IMAGE_MODEL"),
        "KL_IMAGE_SIZE": masked_env_value("KL_IMAGE_SIZE"),
        "KL_TIMEOUT_SECONDS": masked_env_value("KL_TIMEOUT_SECONDS"),
        "KL_RETRY_5XX_COUNT": masked_env_value("KL_RETRY_5XX_COUNT"),
        "KL_RETRY_BACKOFF_SECONDS": masked_env_value("KL_RETRY_BACKOFF_SECONDS"),
        "KL_PROXY_URL": masked_env_value("KL_PROXY_URL"),
        "KL_PROXY_ACCESS_TOKEN": masked_env_value("KL_PROXY_ACCESS_TOKEN", secret=True),
        "KL_FORCE_IPV4": masked_env_value("KL_FORCE_IPV4"),
        "KL_USER_AGENT": masked_env_value("KL_USER_AGENT"),
        "KL_API_TOKEN": masked_env_value("KL_API_TOKEN", secret=True),
        "KL_API_KEY": masked_env_value("KL_API_KEY", secret=True),
        "WECHAT_APPID": masked_env_value("WECHAT_APPID"),
        "WECHAT_APP_ID": masked_env_value("WECHAT_APP_ID"),
        "WECHAT_SECRET": masked_env_value("WECHAT_SECRET", secret=True),
        "WECHAT_APP_SECRET": masked_env_value("WECHAT_APP_SECRET", secret=True),
        "WECHAT_CODE2SESSION_TIMEOUT_SECONDS": masked_env_value("WECHAT_CODE2SESSION_TIMEOUT_SECONDS"),
        "DATABASE_URL": masked_env_value("DATABASE_URL", secret=True),
        "MYSQL_ADDRESS": masked_env_value("MYSQL_ADDRESS"),
        "MYSQL_HOST": masked_env_value("MYSQL_HOST"),
        "MYSQL_PORT": masked_env_value("MYSQL_PORT"),
        "MYSQL_USERNAME": masked_env_value("MYSQL_USERNAME"),
        "MYSQL_USER": masked_env_value("MYSQL_USER"),
        "MYSQL_PASSWORD": masked_env_value("MYSQL_PASSWORD", secret=True),
        "MYSQL_DATABASE": masked_env_value("MYSQL_DATABASE"),
        "MYSQL_DB": masked_env_value("MYSQL_DB"),
        "COS_SECRET_ID": masked_env_value("COS_SECRET_ID", secret=True),
        "COS_SECRET_KEY": masked_env_value("COS_SECRET_KEY", secret=True),
        "TENCENTCLOUD_SECRET_ID": masked_env_value("TENCENTCLOUD_SECRET_ID", secret=True),
        "TENCENTCLOUD_SECRET_KEY": masked_env_value("TENCENTCLOUD_SECRET_KEY", secret=True),
        "COS_BUCKET": masked_env_value("COS_BUCKET"),
        "TENCENT_COS_BUCKET": masked_env_value("TENCENT_COS_BUCKET"),
        "COS_REGION": masked_env_value("COS_REGION"),
        "TENCENT_COS_REGION": masked_env_value("TENCENT_COS_REGION"),
        "COS_PREFIX": masked_env_value("COS_PREFIX"),
        "COS_PUBLIC_BASE_URL": masked_env_value("COS_PUBLIC_BASE_URL"),
        "OBJECT_STORAGE_PUBLIC_BASE_URL": masked_env_value("OBJECT_STORAGE_PUBLIC_BASE_URL"),
        "OBJECT_STORAGE_STRICT": masked_env_value("OBJECT_STORAGE_STRICT"),
        "OBJECT_STORAGE_REMOTE_TIMEOUT_SECONDS": masked_env_value("OBJECT_STORAGE_REMOTE_TIMEOUT_SECONDS"),
        "OBJECT_STORAGE_REMOTE_MAX_BYTES": masked_env_value("OBJECT_STORAGE_REMOTE_MAX_BYTES"),
        "ADMIN_USERNAME": masked_env_value("ADMIN_USERNAME"),
        "ADMIN_PASSWORD": masked_env_value("ADMIN_PASSWORD", secret=True),
    }
    checks: list[dict[str, Any]] = []
    if config["generationMode"] == "real" and not config["klTokenConfigured"]:
        checks.append({"level": "error", "code": "KL_TOKEN_MISSING", "message": "真实生成模式缺少 KL_API_TOKEN 或 KL_API_KEY"})
    if not (os.getenv("WECHAT_APPID") or os.getenv("WECHAT_APP_ID")):
        checks.append({"level": "warn", "code": "WECHAT_APPID_MISSING", "message": "缺少 WECHAT_APPID，微信登录将使用 mock openid，重新登录会产生新用户", "env": "WECHAT_APPID"})
    if not (os.getenv("WECHAT_SECRET") or os.getenv("WECHAT_APP_SECRET")):
        checks.append({"level": "warn", "code": "WECHAT_SECRET_MISSING", "message": "缺少 WECHAT_SECRET，微信登录将使用 mock openid，重新登录会产生新用户", "env": "WECHAT_SECRET"})
    if config["klImageSize"] and not re.fullmatch(r"\d+x\d+", config["klImageSize"]):
        checks.append({"level": "warn", "code": "KL_IMAGE_SIZE_INVALID", "message": "KL_IMAGE_SIZE 格式应为 宽x高，例如 1024x1024、1536x1024、1024x1536", "env": "KL_IMAGE_SIZE", "value": config["klImageSize"]})
    if config["objectStorage"].get("strict") and config["objectStorage"].get("mode") != "cos":
        checks.append({"level": "error", "code": "COS_STRICT_NOT_READY", "message": "OBJECT_STORAGE_STRICT=1 但 COS 未启用，请检查 bucket、region 和密钥"})
    if config["objectStorage"].get("mode") == "cos" and not config["objectStorage"].get("sdkAvailable"):
        checks.append({"level": "error", "code": "COS_SDK_MISSING", "message": "COS 已配置，但当前运行环境缺少 qcloud_cos / cos-python-sdk-v5 依赖", "env": "COS_SECRET_ID"})
    if config["objectStorage"].get("mode") == "cos" and not config["objectStorage"].get("publicBaseConfigured"):
        checks.append({"level": "warn", "code": "COS_PUBLIC_BASE_MISSING", "message": "COS 未配置 COS_PUBLIC_BASE_URL，将使用默认 COS 域名"})
    database_error = str(config["database"].get("error") or "")
    if not config["database"].get("available"):
        if "1045" in database_error or "Access denied" in database_error:
            checks.append({
                "level": "error",
                "code": "DATABASE_AUTH_FAILED",
                "message": "MySQL 已连通但认证失败，请检查用户名、密码，以及该账号是否允许当前来源 IP 或云托管网络访问",
                "details": config["database"],
            })
        elif "Unknown database" in database_error or "1049" in database_error:
            checks.append({
                "level": "error",
                "code": "DATABASE_NOT_FOUND",
                "message": "MySQL 数据库不存在，请检查 MYSQL_DATABASE / MYSQL_DB 或先创建数据库",
                "details": config["database"],
            })
        elif "timed out" in database_error.lower() or "refused" in database_error.lower():
            checks.append({
                "level": "error",
                "code": "DATABASE_NETWORK_FAILED",
                "message": "MySQL 网络连接失败，请检查地址、端口、VPC/安全组/白名单和云托管网络连通性",
                "details": config["database"],
            })
        else:
            checks.append({"level": "error", "code": "DATABASE_UNAVAILABLE", "message": "数据库不可用，请检查 MySQL 地址、端口、用户名、密码、库名和网络白名单", "details": config["database"]})
    if config["database"].get("kind") == "sqlite":
        checks.append({"level": "warn", "code": "DATABASE_SQLITE", "message": "当前使用 SQLite，本地调试可用，云托管正式环境建议 MySQL"})
    if config["mockEnabled"]:
        checks.append({"level": "warn", "code": "MOCK_GENERATION_ENABLED", "message": "AI_MOCK_GENERATION=1，当前不会真实调用 KL 生成", "env": "AI_MOCK_GENERATION"})
    if truthy_env("AI_UNLIMITED_CREDITS", "1"):
        checks.append({"level": "warn", "code": "UNLIMITED_CREDITS_ENABLED", "message": "AI_UNLIMITED_CREDITS=1，用户生成额度不会按正式计费扣减", "env": "AI_UNLIMITED_CREDITS"})
    if admin_password == "admin123":
        checks.append({"level": "warn", "code": "ADMIN_PASSWORD_DEFAULT", "message": "ADMIN_PASSWORD 仍是默认值，请在云托管正式环境改成强密码", "env": "ADMIN_PASSWORD"})
    if public_base.startswith(("http://127.", "http://localhost", "http://0.0.0.0", "http://192.168.", "http://10.")):
        checks.append({"level": "warn", "code": "PUBLIC_BASE_URL_LOCAL", "message": "PUBLIC_BASE_URL 指向本地或局域网地址，小程序真机和云环境通常无法访问", "env": "PUBLIC_BASE_URL"})
    elif public_base.startswith("http://"):
        checks.append({"level": "warn", "code": "PUBLIC_BASE_URL_NOT_HTTPS", "message": "PUBLIC_BASE_URL 不是 HTTPS，正式小程序可能无法加载资源", "env": "PUBLIC_BASE_URL"})
    if kl_proxy.startswith(("http://127.", "http://localhost", "http://0.0.0.0")):
        checks.append({"level": "warn", "code": "KL_PROXY_LOCAL", "message": "KL_PROXY_URL 指向本机地址，云托管容器内通常无法访问宿主机代理", "env": "KL_PROXY_URL"})
    if config["klBaseUrl"].endswith(".workers.dev") and not config["klForceIpv4"]:
        checks.append({"level": "warn", "code": "KL_WORKER_IPV4_RECOMMENDED", "message": "KL_API_BASE_URL 使用 Cloudflare Worker，云托管容器如无 IPv6 出口可能报 Network is unreachable，建议设置 KL_FORCE_IPV4=1", "env": "KL_FORCE_IPV4"})
    if config["objectStorage"].get("mode") == "cos" and not config["objectStorage"].get("strict"):
        checks.append({"level": "warn", "code": "COS_STRICT_DISABLED", "message": "OBJECT_STORAGE_STRICT 未开启，COS 上传失败时会降级到本地文件，云托管实例重建后图片可能丢失", "env": "OBJECT_STORAGE_STRICT"})
    if cos_public_base.startswith("http://"):
        checks.append({"level": "warn", "code": "COS_PUBLIC_BASE_NOT_HTTPS", "message": "COS_PUBLIC_BASE_URL 不是 HTTPS，正式小程序可能无法加载图片", "env": "COS_PUBLIC_BASE_URL"})
    if configured_log_level() == "debug":
        checks.append({"level": "warn", "code": "LOG_LEVEL_DEBUG", "message": "LOG_LEVEL=debug 会输出更多请求调试信息，正式环境请确认日志成本和敏感信息策略", "env": "LOG_LEVEL"})
    if port and port != "80":
        checks.append({"level": "warn", "code": "PORT_NOT_80", "message": "PORT 不是 80，请确认云托管容器端口、探针端口和应用监听端口一致", "env": "PORT"})
    return {
        "time": now_iso(),
        "runtime": config,
        "env": tracked,
        "checks": checks,
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


def console_log(level: str, code: str, message: str, details: dict[str, Any] | None = None, *, force: bool = False) -> None:
    normalized = normalize_log_level(level)
    if not force and LOG_LEVELS[normalized] < LOG_LEVELS[configured_log_level()]:
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


def persist_auth_state() -> None:
    STORE.save_auth_state(state_snapshot())


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
                if isinstance(item, dict) and set(item.keys()) <= {"configured", "value"}:
                    result[key] = scrub_debug_value(item)
                else:
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
