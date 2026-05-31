#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys
import time

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

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
    assert last["images"][0]["url"].startswith("data:image/")

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


if __name__ == "__main__":
    test_health()
    test_user_credit_upload_generation_flow()
    test_orders_payment_share_feedback()
    test_ad_reward()
    print("FastAPI smoke tests passed")
