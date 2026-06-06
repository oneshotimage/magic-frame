from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse, Response

from ..core import AppError, OBJECT_STORAGE, ROOT_DIR, STATE, now_iso, runtime_config

router = APIRouter()

@router.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "ai-portrait-fastapi", "time": now_iso(), "runtime": runtime_config()}

@router.get("/config/runtime")
def config_runtime() -> dict[str, Any]:
    return runtime_config()

@router.get("/assets/generated/{filename}")
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

@router.get("/assets/object/{folder}/{filename}")
def object_asset(folder: str, filename: str) -> Response:
    found = OBJECT_STORAGE.get_local(folder, filename)
    if not found:
        raise AppError(404, "ASSET_NOT_FOUND", "图片不存在或已过期")
    content, mime_type = found
    return Response(content=content, media_type=mime_type)

@router.get("/admin")
def admin_index() -> RedirectResponse:
    return RedirectResponse(url="/admin/", status_code=307)

@router.get("/admin/{path:path}")
def admin_static(path: str) -> FileResponse:
    admin_dir = ROOT_DIR / "frontend" / "admin"
    target = (admin_dir / path).resolve()
    if not str(target).startswith(str(admin_dir.resolve())) or not target.is_file():
        target = admin_dir / "index.html"
    return FileResponse(target)
