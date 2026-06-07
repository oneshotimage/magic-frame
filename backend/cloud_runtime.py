from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse
import base64
import importlib.util
import json
import mimetypes
import os
import re
import sqlite3
import threading
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
    BUSINESS_TABLES = [
        "users",
        "auth_tokens",
        "refresh_tokens",
        "credits",
        "credit_logs",
        "uploads",
        "generation_tasks",
        "generation_images",
        "orders",
        "feedback",
        "ad_rewards",
        "generated_assets",
        "admin_tokens",
        "debug_logs",
    ]

    def __init__(self) -> None:
        self.url = database_url()
        self.kind = "mysql" if self.url.startswith(("mysql://", "mysql+pymysql://")) else "sqlite"
        self.available = True
        self.error = ""
        self._save_lock = threading.Lock()
        try:
            self._ensure_table()
        except Exception as exc:  # noqa: BLE001 - surface in /health instead of crashing local dev.
            self.available = False
            self.error = str(exc)

    def status(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "available": self.available,
            "error": self.error,
            "schema": "relational",
            "tables": self.BUSINESS_TABLES,
        }

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
            autocommit=False,
        )

    def _sqlite_conn(self) -> sqlite3.Connection:
        parsed = urlparse(self.url)
        path = parsed.path if parsed.scheme == "sqlite" else str(data_dir() / "backend.db")
        if path.startswith("/."):
            path = str(ROOT_DIR / path.lstrip("/"))
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        return sqlite3.connect(path)

    def _ensure_table(self) -> None:
        if self.kind == "mysql":
            with self._mysql_conn() as conn:
                with conn.cursor() as cur:
                    for statement in self._mysql_schema():
                        cur.execute(statement)
                conn.commit()
            return
        with self._sqlite_conn() as conn:
            for statement in self._sqlite_schema():
                conn.execute(statement)
            conn.commit()

    def load(self, key: str = "default") -> dict[str, Any] | None:
        if not self.available:
            return None
        if self.kind == "mysql":
            with self._mysql_conn() as conn:
                with conn.cursor() as cur:
                    snapshot = self._load_relational(cur)
                    return snapshot or self._load_legacy_snapshot(cur, "%s", key)
        with self._sqlite_conn() as conn:
            snapshot = self._load_relational(conn)
            return snapshot or self._load_legacy_snapshot(conn, "?", key)

    def load_legacy_snapshot(self, key: str = "default") -> dict[str, Any] | None:
        if not self.available:
            return None
        if self.kind == "mysql":
            with self._mysql_conn() as conn:
                with conn.cursor() as cur:
                    return self._load_legacy_snapshot(cur, "%s", key)
        with self._sqlite_conn() as conn:
            return self._load_legacy_snapshot(conn, "?", key)

    def table_counts(self) -> dict[str, int]:
        if not self.available:
            return {}
        counts: dict[str, int] = {}
        if self.kind == "mysql":
            with self._mysql_conn() as conn:
                with conn.cursor() as cur:
                    for table in self.BUSINESS_TABLES:
                        try:
                            cur.execute(f"SELECT COUNT(*) FROM {table}")
                            counts[table] = int(cur.fetchone()[0])
                        except Exception:  # noqa: BLE001 - table status helper should be best effort.
                            counts[table] = -1
            return counts
        with self._sqlite_conn() as conn:
            for table in self.BUSINESS_TABLES:
                try:
                    counts[table] = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
                except Exception:  # noqa: BLE001
                    counts[table] = -1
        return counts

    def migrate_legacy_snapshot(self, *, key: str = "default", overwrite: bool = False) -> dict[str, Any]:
        legacy = self.load_legacy_snapshot(key)
        if not legacy:
            return {"migrated": False, "reason": "legacy snapshot not found", "counts": self.table_counts()}
        counts = self.table_counts()
        existing_rows = sum(value for value in counts.values() if value > 0)
        if existing_rows and not overwrite:
            return {"migrated": False, "reason": "business tables are not empty", "counts": counts}
        self.save(legacy, key=key)
        return {"migrated": True, "reason": "", "counts": self.table_counts()}

    def save(self, payload: dict[str, Any], key: str = "default") -> None:
        if not self.available:
            return
        with self._save_lock:
            if self.kind == "mysql":
                with self._mysql_conn() as conn:
                    try:
                        with conn.cursor() as cur:
                            self._save_relational(cur, payload, "%s")
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        raise
                return
            with self._sqlite_conn() as conn:
                self._save_relational(conn, payload, "?")
                conn.commit()

    def _mysql_schema(self) -> list[str]:
        longtext = "LONGTEXT"
        text = "TEXT"
        return [
            """
            CREATE TABLE IF NOT EXISTS users (
              user_id VARCHAR(64) PRIMARY KEY,
              open_id VARCHAR(128) NOT NULL,
              union_id VARCHAR(128) NOT NULL DEFAULT '',
              nickname VARCHAR(255) NOT NULL DEFAULT '',
              avatar_url TEXT,
              wechat_bound_at VARCHAR(64) NOT NULL DEFAULT '',
              created_at VARCHAR(64) NOT NULL,
              updated_at VARCHAR(64) NOT NULL,
              raw_json LONGTEXT NOT NULL,
              UNIQUE KEY idx_users_open_id (open_id)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS auth_tokens (
              token VARCHAR(128) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL,
              created_at BIGINT NOT NULL,
              KEY idx_auth_tokens_user_id (user_id)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS refresh_tokens (
              token VARCHAR(128) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL,
              created_at BIGINT NOT NULL,
              KEY idx_refresh_tokens_user_id (user_id)
            ) CHARACTER SET utf8mb4
            """,
            f"""
            CREATE TABLE IF NOT EXISTS credits (
              user_id VARCHAR(64) PRIMARY KEY,
              balance INT NOT NULL DEFAULT 0,
              total_credits INT NOT NULL DEFAULT 0,
              used_credits INT NOT NULL DEFAULT 0,
              today_ad_count INT NOT NULL DEFAULT 0,
              daily_ad_limit INT NOT NULL DEFAULT 3,
              updated_at VARCHAR(64) NOT NULL,
              raw_json {longtext} NOT NULL
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS credit_logs (
              log_id VARCHAR(64) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL,
              type VARCHAR(64) NOT NULL,
              amount INT NOT NULL,
              biz_id VARCHAR(128) NOT NULL DEFAULT '',
              created_at VARCHAR(64) NOT NULL,
              raw_json LONGTEXT NOT NULL,
              KEY idx_credit_logs_user_id_created_at (user_id, created_at)
            ) CHARACTER SET utf8mb4
            """,
            f"""
            CREATE TABLE IF NOT EXISTS uploads (
              image_id VARCHAR(64) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL,
              url {text},
              object_url {text},
              object_key VARCHAR(512) NOT NULL DEFAULT '',
              storage VARCHAR(32) NOT NULL DEFAULT '',
              input_image_data_url {longtext},
              width INT NOT NULL DEFAULT 0,
              height INT NOT NULL DEFAULT 0,
              size_bytes BIGINT NOT NULL DEFAULT 0,
              mime_type VARCHAR(128) NOT NULL DEFAULT '',
              expires_at VARCHAR(64) NOT NULL DEFAULT '',
              created_at VARCHAR(64) NOT NULL,
              raw_json {longtext} NOT NULL,
              KEY idx_uploads_user_id_created_at (user_id, created_at)
            ) CHARACTER SET utf8mb4
            """,
            f"""
            CREATE TABLE IF NOT EXISTS generation_tasks (
              task_id VARCHAR(64) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL,
              input_image_id VARCHAR(64) NOT NULL,
              input_image_data_url {longtext},
              status VARCHAR(32) NOT NULL,
              progress INT NOT NULL DEFAULT 0,
              size VARCHAR(32) NOT NULL DEFAULT '',
              size_source VARCHAR(32) NOT NULL DEFAULT '',
              generation_seconds_per_image INT NOT NULL DEFAULT 60,
              charged TINYINT NOT NULL DEFAULT 0,
              started_at VARCHAR(64) NOT NULL DEFAULT '',
              completed_at VARCHAR(64) NOT NULL DEFAULT '',
              elapsed_ms BIGINT NOT NULL DEFAULT 0,
              provider_json {longtext} NOT NULL,
              created_at VARCHAR(64) NOT NULL,
              updated_at VARCHAR(64) NOT NULL,
              raw_json {longtext} NOT NULL,
              KEY idx_generation_tasks_user_created (user_id, created_at),
              KEY idx_generation_tasks_status (status)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS generation_images (
              image_id VARCHAR(64) PRIMARY KEY,
              task_id VARCHAR(64) NOT NULL,
              style VARCHAR(64) NOT NULL,
              status VARCHAR(32) NOT NULL,
              url TEXT,
              error_message TEXT,
              elapsed_ms BIGINT NOT NULL DEFAULT 0,
              provider_json LONGTEXT NOT NULL,
              raw_json LONGTEXT NOT NULL,
              KEY idx_generation_images_task_id (task_id),
              KEY idx_generation_images_status (status)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS orders (
              order_id VARCHAR(64) PRIMARY KEY,
              order_no VARCHAR(128) NOT NULL,
              user_id VARCHAR(64) NOT NULL,
              package_id VARCHAR(64) NOT NULL,
              package_name VARCHAR(255) NOT NULL,
              amount_fen INT NOT NULL DEFAULT 0,
              credits INT NOT NULL DEFAULT 0,
              status VARCHAR(32) NOT NULL,
              transaction_id VARCHAR(128) NOT NULL DEFAULT '',
              created_at VARCHAR(64) NOT NULL,
              paid_at VARCHAR(64) NOT NULL DEFAULT '',
              payment_params_json LONGTEXT NOT NULL,
              raw_json LONGTEXT NOT NULL,
              KEY idx_orders_user_created (user_id, created_at),
              KEY idx_orders_status (status)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS feedback (
              feedback_id VARCHAR(64) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL,
              type VARCHAR(64) NOT NULL DEFAULT '',
              content TEXT,
              contact VARCHAR(255) NOT NULL DEFAULT '',
              created_at VARCHAR(64) NOT NULL,
              raw_json LONGTEXT NOT NULL,
              KEY idx_feedback_user_created (user_id, created_at)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS ad_rewards (
              reward_key VARCHAR(191) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL,
              event_id VARCHAR(128) NOT NULL,
              created_at BIGINT NOT NULL,
              KEY idx_ad_rewards_user_id (user_id)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS generated_assets (
              asset_id VARCHAR(64) PRIMARY KEY,
              user_id VARCHAR(64) NOT NULL DEFAULT '',
              task_id VARCHAR(64) NOT NULL DEFAULT '',
              style VARCHAR(64) NOT NULL DEFAULT '',
              mime_type VARCHAR(128) NOT NULL DEFAULT '',
              ext VARCHAR(16) NOT NULL DEFAULT '',
              url TEXT,
              object_key VARCHAR(512) NOT NULL DEFAULT '',
              storage VARCHAR(32) NOT NULL DEFAULT '',
              size_bytes BIGINT NOT NULL DEFAULT 0,
              source_image_url TEXT,
              created_at VARCHAR(64) NOT NULL,
              raw_json LONGTEXT NOT NULL,
              KEY idx_generated_assets_user_created (user_id, created_at),
              KEY idx_generated_assets_task_id (task_id)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS admin_tokens (
              token VARCHAR(128) PRIMARY KEY,
              created_at BIGINT NOT NULL
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS debug_logs (
              log_id VARCHAR(64) PRIMARY KEY,
              level VARCHAR(16) NOT NULL DEFAULT 'info',
              code VARCHAR(128) NOT NULL DEFAULT '',
              path VARCHAR(255) NOT NULL DEFAULT '',
              method VARCHAR(16) NOT NULL DEFAULT '',
              status_code INT NOT NULL DEFAULT 0,
              elapsed_ms BIGINT NOT NULL DEFAULT 0,
              created_at VARCHAR(64) NOT NULL,
              raw_json LONGTEXT NOT NULL,
              KEY idx_debug_logs_created_at (created_at),
              KEY idx_debug_logs_level (level)
            ) CHARACTER SET utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS app_snapshots (
              snapshot_key VARCHAR(64) PRIMARY KEY,
              payload LONGTEXT NOT NULL,
              updated_at BIGINT NOT NULL
            ) CHARACTER SET utf8mb4
            """,
        ]

    def _sqlite_schema(self) -> list[str]:
        statements = [statement.replace("CHARACTER SET utf8mb4", "") for statement in self._mysql_schema()]
        type_replacements = {
            r"\bLONGTEXT\b": "TEXT",
            r"\bBIGINT\b": "INTEGER",
            r"\bTINYINT\b": "INTEGER",
            r"\bINT\b": "INTEGER",
            r"\bVARCHAR\(\d+\)": "TEXT",
        }
        text_replacements = {
            "UNIQUE KEY idx_users_open_id (open_id)": "UNIQUE (open_id)",
            "KEY idx_auth_tokens_user_id (user_id)": "",
            "KEY idx_refresh_tokens_user_id (user_id)": "",
            "KEY idx_credit_logs_user_id_created_at (user_id, created_at)": "",
            "KEY idx_uploads_user_id_created_at (user_id, created_at)": "",
            "KEY idx_generation_tasks_user_created (user_id, created_at)": "",
            "KEY idx_generation_tasks_status (status)": "",
            "KEY idx_generation_images_task_id (task_id)": "",
            "KEY idx_generation_images_status (status)": "",
            "KEY idx_orders_user_created (user_id, created_at)": "",
            "KEY idx_orders_status (status)": "",
            "KEY idx_feedback_user_created (user_id, created_at)": "",
            "KEY idx_ad_rewards_user_id (user_id)": "",
            "KEY idx_generated_assets_user_created (user_id, created_at)": "",
            "KEY idx_generated_assets_task_id (task_id)": "",
            "KEY idx_debug_logs_created_at (created_at)": "",
            "KEY idx_debug_logs_level (level)": "",
        }
        normalized: list[str] = []
        for statement in statements:
            for old, new in type_replacements.items():
                statement = re.sub(old, new, statement)
            for old, new in text_replacements.items():
                statement = statement.replace(old, new)
            statement = re.sub(r",\s*\)", "\n              )", statement, flags=re.MULTILINE)
            statement = statement.replace("raw_json TEXT NOT NULL,\n              \n              )", "raw_json TEXT NOT NULL\n              )")
            normalized.append(statement)
        normalized.extend([
            "CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_credit_logs_user_id_created_at ON credit_logs(user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_uploads_user_id_created_at ON uploads(user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_created ON generation_tasks(user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status)",
            "CREATE INDEX IF NOT EXISTS idx_generation_images_task_id ON generation_images(task_id)",
            "CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_feedback_user_created ON feedback(user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_generated_assets_user_created ON generated_assets(user_id, created_at)",
        ])
        return normalized

    def _json(self, value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)

    def _loads(self, value: str | None, default: Any) -> Any:
        if not value:
            return default
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default

    def _rows(self, cur: Any, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        result = cur.execute(sql, params)
        cursor = result if getattr(result, "description", None) is not None else cur
        columns = [item[0] for item in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def _execute(self, cur: Any, sql: str, params: tuple[Any, ...] = ()) -> None:
        cur.execute(sql, params)

    def _load_relational(self, cur: Any) -> dict[str, Any] | None:
        users = {row["user_id"]: self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM users")}
        if not users:
            return None
        tasks = {row["task_id"]: self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM generation_tasks")}
        for task in tasks.values():
            task["images"] = []
        for row in self._rows(cur, "SELECT * FROM generation_images"):
            image = self._loads(row.get("raw_json"), {})
            task_id = row.get("task_id")
            if task_id in tasks:
                tasks[task_id].setdefault("images", []).append(image)
        return {
            "users": users,
            "tokens": {row["token"]: row["user_id"] for row in self._rows(cur, "SELECT token,user_id FROM auth_tokens")},
            "refresh_tokens": {row["token"]: row["user_id"] for row in self._rows(cur, "SELECT token,user_id FROM refresh_tokens")},
            "credits": {row["user_id"]: self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM credits")},
            "credit_logs": [self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM credit_logs ORDER BY created_at")],
            "uploads": {row["image_id"]: self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM uploads")},
            "tasks": tasks,
            "orders": {row["order_id"]: self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM orders")},
            "feedback": [self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM feedback ORDER BY created_at")],
            "ad_rewards": [row["reward_key"] for row in self._rows(cur, "SELECT reward_key FROM ad_rewards")],
            "generated_assets": {row["asset_id"]: self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM generated_assets")},
            "admin_tokens": [row["token"] for row in self._rows(cur, "SELECT token FROM admin_tokens")],
            "debug_logs": [self._loads(row.get("raw_json"), {}) for row in self._rows(cur, "SELECT * FROM debug_logs ORDER BY created_at")],
        }

    def _load_legacy_snapshot(self, cur: Any, placeholder: str, key: str) -> dict[str, Any] | None:
        try:
            rows = self._rows(cur, f"SELECT payload FROM app_snapshots WHERE snapshot_key={placeholder}", (key,))
        except Exception:  # noqa: BLE001 - legacy table may not exist.
            return None
        return json.loads(rows[0]["payload"]) if rows else None

    def _save_relational(self, cur: Any, payload: dict[str, Any], placeholder: str) -> None:
        now = int(time.time())
        for table in reversed(self.BUSINESS_TABLES):
            self._execute(cur, f"DELETE FROM {table}")
        many = placeholder
        for user in payload.get("users", {}).values():
            self._execute(cur, f"INSERT INTO users (user_id, open_id, union_id, nickname, avatar_url, wechat_bound_at, created_at, updated_at, raw_json) VALUES ({','.join([many] * 9)})", (
                user.get("userId"), user.get("openId", ""), user.get("unionId", ""), user.get("nickname", ""), user.get("avatarUrl", ""),
                user.get("wechatBoundAt", ""), user.get("createdAt", ""), user.get("updatedAt", ""), self._json(user),
            ))
        for token, user_id in payload.get("tokens", {}).items():
            self._execute(cur, f"INSERT INTO auth_tokens (token, user_id, created_at) VALUES ({','.join([many] * 3)})", (token, user_id, now))
        for token, user_id in payload.get("refresh_tokens", {}).items():
            self._execute(cur, f"INSERT INTO refresh_tokens (token, user_id, created_at) VALUES ({','.join([many] * 3)})", (token, user_id, now))
        for credits in payload.get("credits", {}).values():
            self._execute(cur, f"INSERT INTO credits (user_id, balance, total_credits, used_credits, today_ad_count, daily_ad_limit, updated_at, raw_json) VALUES ({','.join([many] * 8)})", (
                credits.get("userId"), int(credits.get("balance", 0)), int(credits.get("totalCredits", 0)), int(credits.get("usedCredits", 0)),
                int(credits.get("todayAdCount", 0)), int(credits.get("dailyAdLimit", 3)), credits.get("updatedAt", ""), self._json(credits),
            ))
        for item in payload.get("credit_logs", []):
            self._execute(cur, f"INSERT INTO credit_logs (log_id, user_id, type, amount, biz_id, created_at, raw_json) VALUES ({','.join([many] * 7)})", (
                item.get("id"), item.get("userId", ""), item.get("type", ""), int(item.get("amount", 0)), item.get("bizId", ""), item.get("createdAt", ""), self._json(item),
            ))
        for upload in payload.get("uploads", {}).values():
            self._execute(cur, f"INSERT INTO uploads (image_id, user_id, url, object_url, object_key, storage, input_image_data_url, width, height, size_bytes, mime_type, expires_at, created_at, raw_json) VALUES ({','.join([many] * 14)})", (
                upload.get("imageId"), upload.get("userId", ""), upload.get("url", ""), upload.get("objectUrl", ""), upload.get("objectKey", ""),
                upload.get("storage", ""), upload.get("inputImageDataUrl", ""), int(upload.get("width", 0)), int(upload.get("height", 0)),
                int(upload.get("sizeBytes", 0)), upload.get("mimeType", ""), upload.get("expiresAt", ""), upload.get("createdAt", ""), self._json(upload),
            ))
        for task in payload.get("tasks", {}).values():
            self._execute(cur, f"INSERT INTO generation_tasks (task_id, user_id, input_image_id, input_image_data_url, status, progress, size, size_source, generation_seconds_per_image, charged, started_at, completed_at, elapsed_ms, provider_json, created_at, updated_at, raw_json) VALUES ({','.join([many] * 17)})", (
                task.get("taskId"), task.get("userId", ""), task.get("inputImageId", ""), task.get("inputImageDataUrl", ""), task.get("status", ""),
                int(task.get("progress", 0)), task.get("size", ""), task.get("sizeSource", ""), int(task.get("generationSecondsPerImage", 60)),
                1 if task.get("charged") else 0, task.get("startedAt", ""), task.get("completedAt", ""), int(task.get("elapsedMs", 0)),
                self._json(task.get("provider", {})), task.get("createdAt", ""), task.get("updatedAt", ""), self._json({k: v for k, v in task.items() if k != "images"}),
            ))
            for image in task.get("images", []):
                self._execute(cur, f"INSERT INTO generation_images (image_id, task_id, style, status, url, error_message, elapsed_ms, provider_json, raw_json) VALUES ({','.join([many] * 9)})", (
                    image.get("imageId"), task.get("taskId"), image.get("style", ""), image.get("status", ""), image.get("url", ""),
                    image.get("errorMessage", ""), int(image.get("elapsedMs", 0)), self._json(image.get("provider", {})), self._json(image),
                ))
        for order in payload.get("orders", {}).values():
            self._execute(cur, f"INSERT INTO orders (order_id, order_no, user_id, package_id, package_name, amount_fen, credits, status, transaction_id, created_at, paid_at, payment_params_json, raw_json) VALUES ({','.join([many] * 13)})", (
                order.get("orderId"), order.get("orderNo", ""), order.get("userId", ""), order.get("packageId", ""), order.get("packageName", ""),
                int(order.get("amountFen", 0)), int(order.get("credits", 0)), order.get("status", ""), order.get("transactionId", ""),
                order.get("createdAt", ""), order.get("paidAt", ""), self._json(order.get("paymentParams", {})), self._json(order),
            ))
        for item in payload.get("feedback", []):
            self._execute(cur, f"INSERT INTO feedback (feedback_id, user_id, type, content, contact, created_at, raw_json) VALUES ({','.join([many] * 7)})", (
                item.get("id"), item.get("userId", ""), item.get("type", ""), item.get("content", ""), item.get("contact") or "", item.get("createdAt", ""), self._json(item),
            ))
        for reward_key in payload.get("ad_rewards", []):
            user_id, _, event_id = str(reward_key).partition(":")
            self._execute(cur, f"INSERT INTO ad_rewards (reward_key, user_id, event_id, created_at) VALUES ({','.join([many] * 4)})", (reward_key, user_id, event_id, now))
        for asset in payload.get("generated_assets", {}).values():
            self._execute(cur, f"INSERT INTO generated_assets (asset_id, user_id, task_id, style, mime_type, ext, url, object_key, storage, size_bytes, source_image_url, created_at, raw_json) VALUES ({','.join([many] * 13)})", (
                asset.get("assetId"), asset.get("userId", ""), asset.get("taskId", ""), asset.get("style", ""), asset.get("mimeType", ""),
                asset.get("ext", ""), asset.get("url", ""), asset.get("key", ""), asset.get("storage", ""), int(asset.get("sizeBytes", 0)),
                asset.get("sourceImageUrl", ""), asset.get("createdAt", ""), self._json(asset),
            ))
        for token in payload.get("admin_tokens", []):
            self._execute(cur, f"INSERT INTO admin_tokens (token, created_at) VALUES ({','.join([many] * 2)})", (token, now))
        for index, item in enumerate(payload.get("debug_logs", [])):
            log_id = item.get("id") or f"dbg_{index}_{now}"
            self._execute(cur, f"INSERT INTO debug_logs (log_id, level, code, path, method, status_code, elapsed_ms, created_at, raw_json) VALUES ({','.join([many] * 9)})", (
                log_id, item.get("level", "info"), item.get("code", ""), item.get("path", ""), item.get("method", ""),
                int(item.get("statusCode", 0) or 0), int(item.get("elapsedMs", 0) or 0), item.get("createdAt", ""), self._json(item),
            ))


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
