from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse
import base64
import importlib.util
import json
import mimetypes
import os
import sqlite3
import time
import uuid


ROOT_DIR = Path(__file__).resolve().parents[1]


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def data_dir() -> Path:
    path = Path(os.getenv("DATA_DIR", str(ROOT_DIR / ".data")))
    path.mkdir(parents=True, exist_ok=True)
    return path


def public_base_url() -> str:
    return os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def database_url() -> str:
    explicit = os.getenv("DATABASE_URL", "").strip()
    if explicit:
        return explicit

    mysql_host = os.getenv("MYSQL_ADDRESS") or os.getenv("MYSQL_HOST")
    mysql_user = os.getenv("MYSQL_USERNAME") or os.getenv("MYSQL_USER")
    mysql_password = os.getenv("MYSQL_PASSWORD")
    mysql_database = os.getenv("MYSQL_DATABASE") or os.getenv("MYSQL_DB")
    if mysql_host and mysql_user and mysql_database:
        port = os.getenv("MYSQL_PORT", "3306")
        return f"mysql://{quote(mysql_user)}:{quote(mysql_password or '')}@{mysql_host}:{port}/{mysql_database}"

    return f"sqlite:///{data_dir() / 'backend.db'}"


class SnapshotStore:
    def __init__(self) -> None:
        self.url = database_url()
        self.kind = "mysql" if self.url.startswith(("mysql://", "mysql+pymysql://")) else "sqlite"
        self.available = True
        self.error = ""
        try:
            self._ensure_table()
        except Exception as exc:  # noqa: BLE001 - surface in /health instead of crashing local dev.
            self.available = False
            self.error = str(exc)

    def status(self) -> dict[str, Any]:
        return {"kind": self.kind, "available": self.available, "error": self.error}

    def _mysql_conn(self):
        try:
            import pymysql  # type: ignore
        except ImportError as exc:  # pragma: no cover - only used with MySQL env.
            raise RuntimeError("MySQL storage requires pymysql. Install backend dependencies.") from exc
        parsed = urlparse(self.url)
        return pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=parsed.username or "",
            password=parsed.password or "",
            database=(parsed.path or "/").lstrip("/"),
            charset="utf8mb4",
            autocommit=True,
        )

    def _sqlite_conn(self) -> sqlite3.Connection:
        parsed = urlparse(self.url)
        path = parsed.path if parsed.scheme == "sqlite" else str(data_dir() / "backend.db")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        return sqlite3.connect(path)

    def _ensure_table(self) -> None:
        if self.kind == "mysql":
            with self._mysql_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS app_snapshots (
                          snapshot_key VARCHAR(64) PRIMARY KEY,
                          payload LONGTEXT NOT NULL,
                          updated_at BIGINT NOT NULL
                        ) CHARACTER SET utf8mb4
                        """
                    )
            return
        with self._sqlite_conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_snapshots (
                  snapshot_key TEXT PRIMARY KEY,
                  payload TEXT NOT NULL,
                  updated_at INTEGER NOT NULL
                )
                """
            )
            conn.commit()

    def load(self, key: str = "default") -> dict[str, Any] | None:
        if not self.available:
            return None
        if self.kind == "mysql":
            with self._mysql_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT payload FROM app_snapshots WHERE snapshot_key=%s", (key,))
                    row = cur.fetchone()
                    return json.loads(row[0]) if row else None
        with self._sqlite_conn() as conn:
            row = conn.execute("SELECT payload FROM app_snapshots WHERE snapshot_key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def save(self, payload: dict[str, Any], key: str = "default") -> None:
        if not self.available:
            return
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        updated_at = int(time.time())
        if self.kind == "mysql":
            with self._mysql_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO app_snapshots (snapshot_key, payload, updated_at)
                        VALUES (%s, %s, %s)
                        ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=VALUES(updated_at)
                        """,
                        (key, text, updated_at),
                    )
            return
        with self._sqlite_conn() as conn:
            conn.execute(
                """
                INSERT INTO app_snapshots (snapshot_key, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
                """,
                (key, text, updated_at),
            )
            conn.commit()


class ObjectStorage:
    def __init__(self) -> None:
        self.bucket = os.getenv("COS_BUCKET") or os.getenv("TENCENT_COS_BUCKET") or ""
        self.region = os.getenv("COS_REGION") or os.getenv("TENCENT_COS_REGION") or ""
        self.secret_id = os.getenv("COS_SECRET_ID") or os.getenv("TENCENTCLOUD_SECRET_ID") or ""
        self.secret_key = os.getenv("COS_SECRET_KEY") or os.getenv("TENCENTCLOUD_SECRET_KEY") or ""
        self.prefix = (os.getenv("COS_PREFIX") or "ai-image").strip("/")
        self.public_base = (os.getenv("COS_PUBLIC_BASE_URL") or os.getenv("OBJECT_STORAGE_PUBLIC_BASE_URL") or "").rstrip("/")
        self.enabled = bool(self.bucket and self.region and self.secret_id and self.secret_key)
        self.mode = "cos" if self.enabled else "local"
        self.sdk_available = importlib.util.find_spec("qcloud_cos") is not None
        self.local_root = data_dir() / "objects"
        self.local_root.mkdir(parents=True, exist_ok=True)
        self.error = ""

    def status(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "enabled": self.enabled,
            "bucket": self.bucket,
            "region": self.region,
            "prefix": self.prefix,
            "publicBaseConfigured": bool(self.public_base),
            "strict": truthy(os.getenv("OBJECT_STORAGE_STRICT")),
            "sdkAvailable": self.sdk_available,
            "error": self.error,
        }

    def _ext(self, mime_type: str) -> str:
        return {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp"}.get(mime_type) or (mimetypes.guess_extension(mime_type) or ".bin").lstrip(".")

    def put_bytes(self, data: bytes, *, mime_type: str, folder: str, name: str | None = None) -> dict[str, Any]:
        ext = self._ext(mime_type)
        object_id = name or f"{uuid.uuid4()}.{ext}"
        key = "/".join(part.strip("/") for part in (self.prefix, folder, object_id) if part.strip("/"))
        if self.enabled:
            try:
                from qcloud_cos import CosConfig, CosS3Client  # type: ignore

                config = CosConfig(Region=self.region, SecretId=self.secret_id, SecretKey=self.secret_key)
                client = CosS3Client(config)
                client.put_object(Bucket=self.bucket, Body=data, Key=key, ContentType=mime_type)
                if self.public_base:
                    url = f"{self.public_base}/{key}"
                else:
                    url = f"https://{self.bucket}.cos.{self.region}.myqcloud.com/{key}"
                return {"url": url, "key": key, "objectId": object_id, "mimeType": mime_type, "sizeBytes": len(data), "storage": "cos"}
            except Exception as exc:  # noqa: BLE001
                self.error = str(exc)
                if not truthy(os.getenv("OBJECT_STORAGE_STRICT")):
                    stored = self._put_local(data, mime_type=mime_type, folder=folder, object_id=object_id)
                    stored["fallbackFrom"] = "cos"
                    stored["fallbackError"] = self.error
                    return stored
                raise RuntimeError(
                    f"COS_UPLOAD_FAILED bucket={self.bucket or '<empty>'} region={self.region or '<empty>'} "
                    f"key={key} error={self.error}"
                ) from exc
        return self._put_local(data, mime_type=mime_type, folder=folder, object_id=object_id)

    def _put_local(self, data: bytes, *, mime_type: str, folder: str, object_id: str) -> dict[str, Any]:
        folder_path = self.local_root / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        target = folder_path / object_id
        target.write_bytes(data)
        if folder == "generated":
            url = f"{public_base_url()}/assets/generated/{object_id}"
        else:
            url = f"{public_base_url()}/assets/object/{folder}/{object_id}"
        return {"url": url, "key": f"{folder}/{object_id}", "objectId": object_id, "mimeType": mime_type, "sizeBytes": len(data), "storage": "local"}

    def get_local(self, folder: str, name: str) -> tuple[bytes, str] | None:
        target = (self.local_root / folder / name).resolve()
        if not str(target).startswith(str(self.local_root.resolve())) or not target.is_file():
            return None
        mime_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return target.read_bytes(), mime_type


def parse_data_url(data_url: str) -> tuple[str, bytes]:
    match = data_url and __import__("re").match(r"^data:([^;]+);base64,(.*)$", data_url)
    if not match:
        raise ValueError("invalid image data url")
    mime_type, encoded = match.groups()
    return mime_type, base64.b64decode(encoded)
