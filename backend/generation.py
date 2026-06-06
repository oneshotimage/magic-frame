from __future__ import annotations

from typing import Any
from urllib import error, request
from contextlib import contextmanager
import base64
import json
import os
import re
import socket
import struct
import time
import uuid
import zlib

from .catalog import STYLE_PROMPTS
from .cloud_runtime import parse_data_url
from .core import (
    OBJECT_STORAGE,
    STATE,
    append_debug_log,
    console_log,
    gen_id,
    now_iso,
    persist_state,
    runtime_config,
    safe_url,
    scrub_debug_value,
    truthy_env,
)
from .services import consume_credit


@contextmanager
def force_ipv4_getaddrinfo(enabled: bool):
    if not enabled:
        yield
        return

    original_getaddrinfo = socket.getaddrinfo

    def ipv4_getaddrinfo(*args, **kwargs):
        results = original_getaddrinfo(*args, **kwargs)
        ipv4_results = [item for item in results if item[0] == socket.AF_INET]
        return ipv4_results or results

    socket.getaddrinfo = ipv4_getaddrinfo
    try:
        yield
    finally:
        socket.getaddrinfo = original_getaddrinfo

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


def download_remote_image(url: str) -> tuple[str, bytes, dict[str, Any]]:
    timeout_seconds = int(os.getenv("OBJECT_STORAGE_REMOTE_TIMEOUT_SECONDS", "60"))
    max_bytes = int(os.getenv("OBJECT_STORAGE_REMOTE_MAX_BYTES", str(12 * 1024 * 1024)))
    req = request.Request(url, headers={"User-Agent": "ai-portrait-cos-fetch/1.0"})
    started = time.time()
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            status = getattr(resp, "status", 200)
            content_type = resp.headers.get("content-type") or "image/png"
            content_length = int(resp.headers.get("content-length") or 0)
            if status < 200 or status >= 300:
                raise RuntimeError(f"remote image HTTP {status}")
            if not content_type.startswith("image/"):
                raise RuntimeError(f"remote image content-type is not image: {content_type}")
            if content_length > max_bytes:
                raise RuntimeError(f"remote image too large: {content_length} > {max_bytes}")
            data = resp.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise RuntimeError(f"remote image too large: > {max_bytes}")
            if not data:
                raise RuntimeError("remote image body is empty")
            return content_type.split(";", 1)[0], data, {
                "sourceUrl": safe_url(url),
                "httpStatus": status,
                "contentType": content_type,
                "contentLength": content_length or len(data),
                "downloadedBytes": len(data),
                "elapsedMs": int((time.time() - started) * 1000),
            }
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"REMOTE_IMAGE_DOWNLOAD_FAILED url={safe_url(url)} error={exc}") from exc


def store_generated_asset(output_url: str, *, style: str) -> dict[str, Any]:
    if output_url.startswith("data:image/"):
        mime_type, image_bytes = parse_data_url(output_url)
        source = {"kind": "data-url", "bytes": len(image_bytes)}
    elif output_url.startswith(("http://", "https://")):
        mime_type, image_bytes, source = download_remote_image(output_url)
        source["kind"] = "remote-url"
    else:
        raise RuntimeError(f"GENERATED_IMAGE_UNSUPPORTED_URL url={safe_url(output_url)}")
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
        "source": source,
        "fallbackFrom": stored.get("fallbackFrom", ""),
        "fallbackError": stored.get("fallbackError", ""),
        "createdAt": now_iso(),
    }
    persist_state()
    return {**stored, "assetId": asset_id, "source": source}


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
    proxy_access_token = os.getenv("KL_PROXY_ACCESS_TOKEN") or ""
    timeout_seconds = int(os.getenv("KL_TIMEOUT_SECONDS", "600"))
    force_ipv4 = truthy_env("KL_FORCE_IPV4")

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
            **({"x-kl-proxy-token": proxy_access_token} if proxy_access_token else {}),
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
        "forceIpv4": force_ipv4,
        "timeoutSeconds": timeout_seconds,
    })
    try:
        with force_ipv4_getaddrinfo(force_ipv4):
            resp_ctx = opener.open(req, timeout=timeout_seconds)
        with resp_ctx as resp:
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
        network_hint = ""
        message = str(exc)
        if "Network is unreachable" in message or "Errno 101" in message:
            network_hint = "云托管容器无法访问 KL/Cloudflare Worker 地址，请检查云托管出网能力、域名解析、IPv6 出口；可设置 KL_FORCE_IPV4=1 强制使用 IPv4。"
        console_log("error", "KL_IMAGE_REQUEST_ERROR", "KL 图片接口调用异常", {
            "target": safe_url(target),
            "elapsedMs": int((time.time() - started) * 1000),
            "exceptionType": type(exc).__name__,
            "message": message,
            "networkHint": network_hint,
            "forceIpv4": force_ipv4,
        })
        if network_hint:
            raise RuntimeError(f"{message}; {network_hint}") from exc
        raise


def process_generation(task_id: str) -> None:
    task_started = time.time()
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
    started_at = now_iso()
    task["startedAt"] = started_at
    task["provider"]["startedAt"] = started_at
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
            stored_output = store_generated_asset(output["url"], style=image["style"])
            image["url"] = stored_output["url"]
            image["storage"] = stored_output.get("storage", "")
            image["objectKey"] = stored_output.get("key", "")
            image["assetId"] = stored_output.get("assetId", "")
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
                "outputSource": stored_output.get("source"),
                "objectStorage": runtime_config().get("objectStorage"),
                "objectKey": stored_output.get("key", ""),
                "storage": stored_output.get("storage", ""),
                "fallbackFrom": stored_output.get("fallbackFrom", ""),
                "fallbackError": stored_output.get("fallbackError", ""),
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
                "response": {"json": scrub_debug_value({"url": image["url"], "storage": image.get("storage"), "objectKey": image.get("objectKey"), "responseKeys": output.get("responseKeys"), "rawSummary": output.get("rawSummary")})},
                "checks": [{"level": "info" if image.get("storage") == "cos" else "warn", "code": "KL_IMAGE_SUCCESS", "message": "KL image2 调用成功，生成图已写入对象存储", "details": image["provider"]}],
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
                "objectStorage": runtime_config().get("objectStorage"),
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
    completed_at = now_iso()
    total_elapsed_ms = int((time.time() - task_started) * 1000)
    task["completedAt"] = completed_at
    task["elapsedMs"] = total_elapsed_ms
    task["provider"]["completedAt"] = completed_at
    task["provider"]["elapsedMs"] = total_elapsed_ms
    task["provider"]["successCount"] = success_count
    console_log("info" if success_count else "error", "GENERATION_TASK_COMPLETED", "生成任务执行完成", {
        "taskId": task_id,
        "status": task["status"],
        "successCount": success_count,
        "totalCount": len(task["images"]),
        "elapsedMs": total_elapsed_ms,
    })
    task["provider"]["totalCount"] = len(task["images"])
    task["updatedAt"] = now_iso()
    persist_state()
