#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json
import os
import sys
import time

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("AI_MOCK_GENERATION", "1")

from backend_fastapi import main
from backend_fastapi.main import app, svg_data_url


client = TestClient(app)


def auth_headers() -> dict[str, str]:
    res = client.post("/auth/wechat-login", json={"code": "test-code"})
    assert res.status_code == 200, res.text
    token = res.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


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
    output_url = last["images"][0]["url"]
    assert output_url.startswith("http://127.0.0.1:8000/assets/generated/")
    asset_path = output_url.replace("http://127.0.0.1:8000", "")
    asset = client.get(asset_path)
    assert asset.status_code == 200
    assert asset.headers["content-type"].startswith("image/")

    history = client.get("/generation/history", headers=headers)
    assert history.json()["total"] >= 1


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
    assert poster.json()["posterUrl"].startswith("data:image/")

    feedback = client.post("/feedback", headers=headers, json={"content": "很好用", "source": "test"})
    assert feedback.json()["ok"] is True


def test_ad_reward() -> None:
    headers = auth_headers()
    reward = client.post("/credits/reward-ad", headers=headers, json={"completed": True, "adEventId": "event-1"})
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
    monkeypatch.setattr(main.request, "build_opener", lambda *args: FakeOpener())

    result = main.call_kl_image2(svg_data_url("Demo", "input"), "prompt", "1024x1024")

    assert result["url"] == "https://example.com/out.png"
    assert captured["url"] == "https://api.kl-api.info/v1/images/edits"
    assert captured["timeout"] == 600
    assert captured["headers"]["Authorization"] == "Bearer test-token"
    assert "multipart/form-data" in captured["headers"]["Content-type"]
    assert b'name="model"' in captured["data"]
    assert b"gpt-image-2" in captured["data"]
    assert b'name="image"; filename="portrait.jpg"' in captured["data"]


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

    tasks = client.get("/admin/api/tasks", headers=admin_headers)
    assert tasks.status_code == 200
    assert tasks.json()["total"] >= 1

    task_detail = client.get(f"/admin/api/tasks/{task_id}", headers=admin_headers)
    assert task_detail.status_code == 200

    assets = client.get("/admin/api/assets", headers=admin_headers)
    assert assets.status_code == 200

    feedback = client.get("/admin/api/feedback", headers=admin_headers)
    assert feedback.status_code == 200

    admin_redirect = client.get("/admin", follow_redirects=False)
    assert admin_redirect.status_code == 307
    assert admin_redirect.headers["location"] == "/admin/"
    admin_page = client.get("/admin/")
    assert admin_page.status_code == 200
    assert "管理后台" in admin_page.text
    assert client.get("/admin/styles.css").status_code == 200
    assert client.get("/admin/app.js").status_code == 200


if __name__ == "__main__":
    test_health()
    test_user_credit_upload_generation_flow()
    test_orders_payment_share_feedback()
    test_ad_reward()
    test_admin_apis()
    print("FastAPI smoke tests passed")
