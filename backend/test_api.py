#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json
import os
import sys
import time
import sqlite3

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("AI_MOCK_GENERATION", "1")
os.environ["PUBLIC_BASE_URL"] = "http://127.0.0.1:8000"
os.environ["DATABASE_URL"] = "sqlite:///.data/test_api.db"
Path(".data/test_api.db").unlink(missing_ok=True)
for key in (
    "WECHAT_APPID",
    "WECHAT_APP_ID",
    "WECHAT_SECRET",
    "WECHAT_APP_SECRET",
    "COS_SECRET_ID",
    "COS_SECRET_KEY",
    "TENCENTCLOUD_SECRET_ID",
    "TENCENTCLOUD_SECRET_KEY",
    "COS_BUCKET",
    "TENCENT_COS_BUCKET",
    "COS_REGION",
    "TENCENT_COS_REGION",
    "COS_PUBLIC_BASE_URL",
    "OBJECT_STORAGE_PUBLIC_BASE_URL",
):
    os.environ[key] = ""
os.environ["OBJECT_STORAGE_STRICT"] = "0"

from backend import main
from backend import generation
from backend import services
from backend import core
from backend.cloud_runtime import SnapshotStore
from backend.main import app, svg_data_url


client = TestClient(app)


def auth_headers() -> dict[str, str]:
    res = client.post("/auth/wechat-login", json={"code": f"test-code-{time.time_ns()}"})
    assert res.status_code == 200, res.text
    token = res.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_auth_login_accepts_user_info() -> None:
    res = client.post("/auth/wechat-login", json={
        "code": "profile-code",
        "userInfo": {
            "nickname": "写真用户",
            "avatarUrl": "https://example.com/avatar.png",
        },
    })
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["nickname"] == "写真用户"
    assert data["user"]["avatarUrl"] == "https://example.com/avatar.png"


def test_auth_refresh_issues_new_access_token() -> None:
    login = client.post("/auth/wechat-login", json={"code": f"refresh-code-{time.time_ns()}"})
    assert login.status_code == 200, login.text
    refreshed = client.post("/auth/refresh", json={"refreshToken": login.json()["refreshToken"]})
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["accessToken"] != login.json()["accessToken"]
    assert refreshed.json()["expiresIn"] == 7200


def test_wechat_code2session_openid_is_stable(monkeypatch) -> None:
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            return json.dumps({"openid": "wx-openid-stable", "unionid": "union-1", "session_key": "session"}).encode("utf-8")

    monkeypatch.setenv("WECHAT_APPID", "appid")
    monkeypatch.setenv("WECHAT_SECRET", "secret")
    monkeypatch.setattr(services.request, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    first = client.post("/auth/wechat-login", json={"code": "code-a"})
    second = client.post("/auth/wechat-login", json={"code": "code-b"})

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["user"]["userId"] == second.json()["user"]["userId"]
    assert first.json()["user"]["openId"] == "wx-openid-stable"
    assert first.json()["user"]["unionId"] == "union-1"


def test_wechat_login_binds_existing_token_to_real_openid(monkeypatch) -> None:
    legacy = client.post("/auth/wechat-login", json={"code": f"legacy-code-{time.time_ns()}"})
    assert legacy.status_code == 200, legacy.text
    legacy_user_id = legacy.json()["user"]["userId"]

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            return json.dumps({"openid": "wx-openid-bind", "session_key": "session"}).encode("utf-8")

    monkeypatch.setenv("WECHAT_APPID", "appid")
    monkeypatch.setenv("WECHAT_SECRET", "secret")
    monkeypatch.setattr(services.request, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    bound = client.post("/auth/wechat-login", json={
        "code": "real-code",
        "bindAccessToken": legacy.json()["accessToken"],
    })

    assert bound.status_code == 200, bound.text
    assert bound.json()["user"]["userId"] == legacy_user_id
    assert bound.json()["user"]["openId"] == "wx-openid-bind"


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_database_uses_business_tables() -> None:
    expected = {
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
    }
    assert core.STORE.status()["schema"] == "relational"
    assert expected.issubset(set(core.STORE.status()["tables"]))
    with core.STORE._sqlite_conn() as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    assert expected.issubset({row[0] for row in rows})


def test_legacy_snapshot_can_migrate_to_business_tables(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "legacy.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    legacy = {
        "users": {
            "usr_legacy": {
                "userId": "usr_legacy",
                "openId": "openid_legacy",
                "unionId": "",
                "nickname": "旧用户",
                "avatarUrl": "",
                "wechatBoundAt": "",
                "createdAt": "2026-06-07T00:00:00+08:00",
                "updatedAt": "2026-06-07T00:00:00+08:00",
            }
        },
        "tokens": {"atk_legacy": "usr_legacy"},
        "refresh_tokens": {"rtk_legacy": "usr_legacy"},
        "credits": {
            "usr_legacy": {
                "userId": "usr_legacy",
                "balance": 6,
                "totalCredits": 6,
                "usedCredits": 0,
                "todayAdCount": 0,
                "dailyAdLimit": 3,
                "updatedAt": "2026-06-07T00:00:00+08:00",
            }
        },
        "credit_logs": [],
        "uploads": {},
        "tasks": {},
        "orders": {},
        "feedback": [],
        "ad_rewards": [],
        "generated_assets": {},
        "admin_tokens": [],
        "debug_logs": [],
    }
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE app_snapshots (snapshot_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)"
        )
        conn.execute(
            "INSERT INTO app_snapshots (snapshot_key, payload, updated_at) VALUES (?, ?, ?)",
            ("default", json.dumps(legacy, ensure_ascii=False), 1),
        )
        conn.commit()

    store = SnapshotStore()
    result = store.migrate_legacy_snapshot()

    assert result["migrated"] is True
    assert store.table_counts()["users"] == 1
    with store._sqlite_conn() as conn:
        row = conn.execute("SELECT user_id, open_id FROM users").fetchone()
    assert row == ("usr_legacy", "openid_legacy")
    store.drop_legacy_snapshot_table()
    with store._sqlite_conn() as conn:
        legacy_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='app_snapshots'"
        ).fetchone()
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    assert legacy_table is None
    assert user_count == 1


def test_auth_persistence_does_not_rewrite_generation_tables(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "auth_perf.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    store = SnapshotStore()
    task = {
        "taskId": "task_keep",
        "userId": "usr_keep",
        "inputImageId": "img_keep",
        "inputImageDataUrl": "data:image/png;base64,AA==",
        "status": "SUCCESS",
        "progress": 100,
        "size": "1024x1024",
        "sizeSource": "default",
        "generationSecondsPerImage": 60,
        "charged": True,
        "startedAt": "2026-06-07T00:00:00+08:00",
        "completedAt": "2026-06-07T00:00:01+08:00",
        "elapsedMs": 1000,
        "provider": {},
        "images": [
            {
                "imageId": "out_keep",
                "style": "pixar",
                "status": "SUCCESS",
                "url": "https://example.com/a.png",
                "errorMessage": "",
                "elapsedMs": 1000,
                "provider": {},
            }
        ],
        "createdAt": "2026-06-07T00:00:00+08:00",
        "updatedAt": "2026-06-07T00:00:01+08:00",
    }
    store.save({
        "users": {},
        "tokens": {},
        "refresh_tokens": {},
        "credits": {},
        "credit_logs": [],
        "uploads": {},
        "tasks": {"task_keep": task},
        "orders": {},
        "feedback": [],
        "ad_rewards": [],
        "generated_assets": {},
        "admin_tokens": [],
        "debug_logs": [],
    })

    auth_payload = {
        "users": {
            "usr_auth": {
                "userId": "usr_auth",
                "openId": "openid_auth",
                "unionId": "",
                "nickname": "auth",
                "avatarUrl": "",
                "wechatBoundAt": "",
                "createdAt": "2026-06-07T00:00:00+08:00",
                "updatedAt": "2026-06-07T00:00:00+08:00",
            }
        },
        "tokens": {"atk_auth": "usr_auth"},
        "refresh_tokens": {"rtk_auth": "usr_auth"},
        "credits": {
            "usr_auth": {
                "userId": "usr_auth",
                "balance": 6,
                "totalCredits": 6,
                "usedCredits": 0,
                "todayAdCount": 0,
                "dailyAdLimit": 3,
                "updatedAt": "2026-06-07T00:00:00+08:00",
            }
        },
        "credit_logs": [],
    }
    store.save_auth_state(auth_payload)

    with store._sqlite_conn() as conn:
        task_count = conn.execute("SELECT COUNT(*) FROM generation_tasks").fetchone()[0]
        image_count = conn.execute("SELECT COUNT(*) FROM generation_images").fetchone()[0]
        token_count = conn.execute("SELECT COUNT(*) FROM auth_tokens").fetchone()[0]
    assert task_count == 1
    assert image_count == 1
    assert token_count == 1


def test_debug_log_levels_are_normalized() -> None:
    assert main.normalize_log_level("debug") == "debug"
    assert main.normalize_log_level("info") == "info"
    assert main.normalize_log_level("warning") == "warn"
    assert main.normalize_log_level("warn") == "warn"
    assert main.normalize_log_level("error") == "error"
    assert main.normalize_log_level("unknown") == "info"


def test_startup_environment_report_redacts_secrets(monkeypatch) -> None:
    monkeypatch.setenv("KL_API_TOKEN", "secret-kl-token")
    monkeypatch.setenv("KL_IMAGE_SIZE", "1536x1024")
    monkeypatch.setenv("KL_FORCE_IPV4", "1")
    monkeypatch.setenv("COS_SECRET_KEY", "secret-cos-key")
    monkeypatch.setenv("ADMIN_PASSWORD", "secret-admin-password")

    report = main.startup_environment_report()
    text = json.dumps(report, ensure_ascii=False)

    assert "secret-kl-token" not in text
    assert "secret-cos-key" not in text
    assert "secret-admin-password" not in text
    assert "KL_API_TOKEN" in text
    assert report["env"]["KL_IMAGE_SIZE"]["value"] == "1536x1024"
    assert report["env"]["KL_FORCE_IPV4"]["value"] == "1"
    assert report["runtime"]["klImageSize"] == "1536x1024"
    assert report["runtime"]["klForceIpv4"] is True
    assert "MYSQL_USER" in report["env"]
    assert "<redacted:" in text


def test_user_credit_upload_generation_flow() -> None:
    headers = auth_headers()

    profile = client.get("/user/profile", headers=headers)
    assert profile.status_code == 200

    patched = client.patch("/user/profile", headers=headers, json={"nickname": "测试用户"})
    assert patched.json()["nickname"] == "测试用户"

    upload = client.post(
        "/upload/image",
        headers=headers,
        json={"dataUrl": svg_data_url("Demo", "input"), "width": 1024, "height": 1024},
    )
    assert upload.status_code == 200, upload.text
    image_id = upload.json()["imageId"]
    assert upload.json()["url"].startswith("http://127.0.0.1:8000/assets/object/uploads/")
    assert "inputImageDataUrl" not in upload.json()

    validate = client.post("/upload/validate", headers=headers, json={"imageId": image_id})
    assert validate.json()["valid"] is True

    task = client.post("/generation/create", headers=headers, json={"inputImageId": image_id, "styles": ["pixar", "comic"]})
    assert task.status_code == 200, task.text
    task_id = task.json()["taskId"]

    last = {}
    for _ in range(10):
        time.sleep(0.1)
        detail = client.get(f"/generation/{task_id}", headers=headers)
        assert detail.status_code == 200
        last = detail.json()
        if last["status"] in {"SUCCESS", "PARTIAL_SUCCESS", "FAILED"}:
            break
    assert last["status"] in {"SUCCESS", "PARTIAL_SUCCESS"}
    assert isinstance(last.get("elapsedMs"), int)
    assert last["elapsedMs"] >= 0
    assert last.get("startedAt")
    assert last.get("completedAt")
    output_url = last["images"][0]["url"]
    assert output_url.startswith(("http://127.0.0.1:8000/assets/generated/", "/assets/generated/"))
    asset_path = output_url.replace("http://127.0.0.1:8000", "")
    asset = client.get(asset_path)
    assert asset.status_code == 200
    assert asset.headers["content-type"].startswith("image/")

    history = client.get("/generation/history", headers=headers)
    assert history.json()["total"] >= 1


def test_generation_size_can_be_configured_by_env(monkeypatch) -> None:
    headers = auth_headers()
    monkeypatch.setenv("KL_IMAGE_SIZE", "1536x1024")

    upload = client.post(
        "/upload/image",
        headers=headers,
        json={"dataUrl": svg_data_url("Size", "input"), "width": 1024, "height": 1024},
    )
    assert upload.status_code == 200, upload.text

    task = client.post(
        "/generation/create",
        headers=headers,
        json={"inputImageId": upload.json()["imageId"], "styles": ["pixar"], "size": "1024x1024"},
    )
    assert task.status_code == 200, task.text
    assert task.json()["size"] == "1536x1024"
    assert task.json()["sizeSource"] == "env"


def test_generation_progress_estimate_uses_seconds_per_image(monkeypatch) -> None:
    headers = auth_headers()
    monkeypatch.setenv("GENERATION_SECONDS_PER_IMAGE", "60")

    upload = client.post(
        "/upload/image",
        headers=headers,
        json={"dataUrl": svg_data_url("Progress", "input"), "width": 1024, "height": 1024},
    )
    assert upload.status_code == 200, upload.text

    task = client.post(
        "/generation/create",
        headers=headers,
        json={"inputImageId": upload.json()["imageId"], "styles": ["pixar", "comic"]},
    )
    assert task.status_code == 200, task.text
    data = task.json()
    assert data["generationSecondsPerImage"] == 60
    assert data["estimatedTotalMs"] == 120000
    assert data["estimatedRemainingMs"] >= 0
    assert data["estimatedProgress"] >= 0


def test_orders_payment_share_feedback() -> None:
    headers = auth_headers()

    packages = client.get("/packages")
    assert packages.status_code == 200
    package_id = packages.json()[0]["packageId"]

    order = client.post("/orders", headers=headers, json={"packageId": package_id})
    assert order.status_code == 200, order.text
    order_id = order.json()["order"]["orderId"]

    detail = client.get(f"/orders/{order_id}", headers=headers)
    assert detail.json()["status"] == "PENDING"

    paid = client.post("/payment/wechat/notify", json={"orderId": order_id, "transactionId": "test-tx", "paid": True})
    assert paid.json()["code"] == "SUCCESS"

    orders = client.get("/orders", headers=headers)
    assert orders.json()["total"] >= 1

    poster = client.post("/share/create-poster", headers=headers, json={"imageUrl": "https://example.com/a.png"})
    poster_url = poster.json()["posterUrl"]
    assert poster_url.startswith(("http://127.0.0.1:8000/assets/generated/", "/assets/generated/"))
    poster_asset = client.get(poster_url.replace("http://127.0.0.1:8000", ""))
    assert poster_asset.status_code == 200
    assert poster_asset.headers["content-type"].startswith("image/png")

    feedback = client.post("/feedback", headers=headers, json={"content": "很好用", "source": "test"})
    assert feedback.json()["ok"] is True


def test_ad_reward() -> None:
    headers = auth_headers()
    reward = client.post("/credits/reward-ad", headers=headers, json={"completed": True, "adEventId": f"event-{time.time_ns()}"})
    assert reward.status_code == 200
    assert reward.json()["rewarded"] is True


def test_call_kl_image2_builds_real_multipart_request(monkeypatch) -> None:
    captured = {}

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            return json.dumps({"data": [{"url": "https://example.com/out.png"}]}).encode("utf-8")

    class FakeOpener:
        def open(self, req, timeout):
            captured["url"] = req.full_url
            captured["headers"] = dict(req.headers)
            captured["data"] = req.data
            captured["timeout"] = timeout
            return FakeResponse()

    monkeypatch.delenv("AI_MOCK_GENERATION", raising=False)
    monkeypatch.setenv("KL_API_TOKEN", "test-token")
    monkeypatch.setenv("KL_API_BASE_URL", "https://api.kl-api.info")
    monkeypatch.setenv("KL_IMAGE_ENDPOINT", "/v1/images/edits")
    monkeypatch.setenv("KL_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("KL_TIMEOUT_SECONDS", "600")
    monkeypatch.setenv("KL_USER_AGENT", "test-user-agent")
    monkeypatch.setattr(generation.request, "build_opener", lambda *args: FakeOpener())

    result = main.call_kl_image2(svg_data_url("Demo", "input"), "prompt", "1024x1024")

    assert result["url"] == "https://example.com/out.png"
    assert captured["url"] == "https://api.kl-api.info/v1/images/edits"
    assert captured["timeout"] == 600
    assert captured["headers"]["Authorization"] == "Bearer test-token"
    assert captured["headers"]["User-agent"] == "test-user-agent"
    assert captured["headers"]["Accept-language"].startswith("zh-CN")
    assert "multipart/form-data" in captured["headers"]["Content-type"]
    assert b'name="model"' in captured["data"]
    assert b"gpt-image-2" in captured["data"]
    assert b'name="response_format"' not in captured["data"]
    assert b'name="image"; filename="portrait.jpg"' in captured["data"]


def test_force_ipv4_getaddrinfo_filters_ipv6(monkeypatch) -> None:
    original_getaddrinfo = generation.socket.getaddrinfo
    fake_results = [
        (generation.socket.AF_INET6, generation.socket.SOCK_STREAM, 6, "", ("2606:4700::1", 443, 0, 0)),
        (generation.socket.AF_INET, generation.socket.SOCK_STREAM, 6, "", ("104.18.1.1", 443)),
    ]

    monkeypatch.setattr(generation.socket, "getaddrinfo", lambda *_args, **_kwargs: fake_results)
    with generation.force_ipv4_getaddrinfo(True):
        filtered = generation.socket.getaddrinfo("example.com", 443)

    assert filtered == [fake_results[1]]
    assert generation.socket.getaddrinfo is not original_getaddrinfo


def test_call_kl_image2_retries_cloudflare_524(monkeypatch) -> None:
    attempts = {"count": 0}
    retry_detail = json.dumps({"error_code": 524, "retry_after": 1})

    class FakeSuccessResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            return json.dumps({"data": [{"url": "https://example.com/out.png"}]}).encode("utf-8")

    class FakeHTTPError(generation.error.HTTPError):
        def read(self) -> bytes:
            return retry_detail.encode("utf-8")

    class FakeOpener:
        def open(self, req, timeout):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise FakeHTTPError(req.full_url, 524, "A timeout occurred", {}, None)
            return FakeSuccessResponse()

    monkeypatch.setenv("KL_API_TOKEN", "test-token")
    monkeypatch.setenv("KL_API_BASE_URL", "https://api.kl-api.info")
    monkeypatch.setenv("KL_IMAGE_ENDPOINT", "/v1/images/edits")
    monkeypatch.setenv("KL_RETRY_5XX_COUNT", "1")
    monkeypatch.setenv("KL_RETRY_BACKOFF_SECONDS", "120")
    monkeypatch.setattr(generation.request, "build_opener", lambda *args: FakeOpener())
    monkeypatch.setattr(generation.time, "sleep", lambda _seconds: None)

    result = main.call_kl_image2(svg_data_url("Demo", "input"), "prompt", "1024x1024")

    assert result["url"] == "https://example.com/out.png"
    assert result["attempts"] == 2


def test_remote_generation_url_is_restored_to_object_storage(monkeypatch) -> None:
    class FakeHeaders:
        def get(self, key, default=None):
            return {
                "content-type": "image/png",
                "content-length": "8",
            }.get(key.lower(), default)

    class FakeResponse:
        status = 200
        headers = FakeHeaders()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _size=-1) -> bytes:
            return b"\x89PNG\r\n\x1a\n"

    monkeypatch.setattr(generation.request, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    stored = generation.store_generated_asset("https://provider.example/out.png", style="pixar")

    assert stored["url"].startswith("http://127.0.0.1:8000/assets/generated/")
    assert stored["source"]["kind"] == "remote-url"
    assert stored["source"]["sourceUrl"] == "https://provider.example/out.png"


def test_admin_apis() -> None:
    headers = auth_headers()
    upload = client.post(
        "/upload/image",
        headers=headers,
        json={"dataUrl": svg_data_url("Admin", "input"), "width": 1024, "height": 1024},
    )
    task = client.post("/generation/create", headers=headers, json={"inputImageId": upload.json()["imageId"], "styles": ["pixar"]})
    task_id = task.json()["taskId"]
    for _ in range(10):
        time.sleep(0.1)
        detail = client.get(f"/generation/{task_id}", headers=headers).json()
        if detail["status"] in {"SUCCESS", "PARTIAL_SUCCESS", "FAILED"}:
            break

    login = client.post("/admin/api/login", json={"username": "admin", "password": "admin123"})
    assert login.status_code == 200, login.text
    admin_headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    stats = client.get("/admin/api/stats", headers=admin_headers)
    assert stats.status_code == 200
    assert stats.json()["tasks"] >= 1

    users = client.get("/admin/api/users", headers=admin_headers)
    assert users.status_code == 200
    user_id = users.json()["items"][0]["userId"]

    adjusted = client.post(f"/admin/api/users/{user_id}/credits", headers=admin_headers, json={"amount": 10, "reason": "test"})
    assert adjusted.status_code == 200
    assert adjusted.json()["actualBalance"] >= 10

    set_balance = client.post(f"/admin/api/users/{user_id}/credits", headers=admin_headers, json={"balance": 2, "reason": "set_test"})
    assert set_balance.status_code == 200
    assert set_balance.json()["actualBalance"] == 2

    tasks = client.get("/admin/api/tasks", headers=admin_headers)
    assert tasks.status_code == 200
    assert tasks.json()["total"] >= 1

    task_detail = client.get(f"/admin/api/tasks/{task_id}", headers=admin_headers)
    assert task_detail.status_code == 200

    assets = client.get("/admin/api/assets", headers=admin_headers)
    assert assets.status_code == 200

    feedback = client.get("/admin/api/feedback", headers=admin_headers)
    assert feedback.status_code == 200

    debug_logs = client.get("/admin/api/debug/logs", headers=admin_headers)
    assert debug_logs.status_code == 200
    debug_data = debug_logs.json()
    assert debug_data["total"] >= 1
    assert any(item["path"] == "/generation/create" for item in debug_data["items"])

    filtered_debug_logs = client.get("/admin/api/debug/logs?path=generation&limit=5", headers=admin_headers)
    assert filtered_debug_logs.status_code == 200
    assert filtered_debug_logs.json()["limit"] == 5

    warn_logs = client.get("/admin/api/debug/logs?level=warn", headers=admin_headers)
    assert warn_logs.status_code == 200
    for item in warn_logs.json()["items"]:
        assert any(check["level"] == "warn" for check in item.get("checks", []))

    admin_redirect = client.get("/admin", follow_redirects=False)
    assert admin_redirect.status_code == 307
    assert admin_redirect.headers["location"] == "/admin/"
    admin_page = client.get("/admin/")
    assert admin_page.status_code == 200
    assert "管理后台" in admin_page.text
    assert "调试日志" in admin_page.text
    assert client.get("/admin/styles.css").status_code == 200
    admin_js = client.get("/admin/app.js")
    assert admin_js.status_code == 200
    assert "debugLevelFilter" in admin_js.text


if __name__ == "__main__":
    test_health()
    test_user_credit_upload_generation_flow()
    test_orders_payment_share_feedback()
    test_ad_reward()
    test_admin_apis()
    print("FastAPI smoke tests passed")
