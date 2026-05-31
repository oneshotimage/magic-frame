import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test, { after, before } from "node:test";

const port = 5180 + Math.floor(Math.random() * 800);
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let token;
let imageId;
let taskId;
let orderId;

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 8000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes(`http://localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      reject(new Error(chunk.toString()));
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`server exited with ${code}`));
    });
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

async function expectOk(path, options = {}) {
  const result = await request(path, options);
  assert.equal(result.response.ok, true, `${options.method || "GET"} ${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function pollTask(id) {
  for (let index = 0; index < 12; index += 1) {
    const task = await expectOk(`/generation/${id}`);
    if (["SUCCESS", "FAILED", "PARTIAL_SUCCESS", "TIMEOUT", "CANCELLED"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`task ${id} did not finish`);
}

before(async () => {
  server = spawn(process.execPath, ["backend/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      KL_API_TOKEN: "",
      KL_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(server);
});

after(() => {
  server?.kill("SIGTERM");
});

test("Auth APIs: login, refresh token, logout", async () => {
  const login = await expectOk("/auth/wechat-login", {
    method: "POST",
    body: { code: "api_test_login", device: { platform: "test" } }
  });
  assert.match(login.accessToken, /^dev-token-/);
  assert.equal(login.credits.totalCredits, 3);
  token = login.accessToken;

  const refreshed = await expectOk("/auth/refresh-token", {
    method: "POST",
    body: { refreshToken: login.refreshToken }
  });
  assert.match(refreshed.accessToken, /^dev-token-/);

  const logout = await expectOk("/auth/logout", { method: "POST" });
  assert.equal(logout.ok, true);
});

test("User APIs: get profile, patch profile, delete isolated user", async () => {
  const profile = await expectOk("/user/profile");
  assert.equal(profile.nickname, "写真体验官");

  const patched = await expectOk("/user/profile", {
    method: "PATCH",
    body: { nickname: "测试用户" }
  });
  assert.equal(patched.nickname, "测试用户");

  const tempLogin = await request("/auth/wechat-login", {
    method: "POST",
    body: { code: "delete_user" }
  });
  const deleteToken = tempLogin.data.accessToken;
  const deleted = await request("/user/delete", {
    method: "POST",
    headers: { authorization: `Bearer ${deleteToken}` },
    body: { confirm: true }
  });
  assert.equal(deleted.response.ok, true);
  assert.equal(deleted.data.ok, true);
});

test("Credit APIs: balance, logs, manual consume, ad reward", async () => {
  const credits = await expectOk("/credits");
  assert.ok(credits.totalCredits >= 3);

  const consumed = await expectOk("/credits/consume", {
    method: "POST",
    body: { amount: 1, bizType: "test", bizId: "manual_consume", idempotencyKey: "manual_consume" }
  });
  assert.equal(consumed.totalCredits, credits.totalCredits - 1);

  const reward = await expectOk("/credits/reward-ad", {
    method: "POST",
    body: { adUnitId: "ad_unit", adEventId: `ad_${Date.now()}`, completed: true }
  });
  assert.equal(reward.rewarded, true);
  assert.equal(reward.credits.totalCredits, consumed.totalCredits + 1);

  const logs = await expectOk("/credits/logs");
  assert.ok(Array.isArray(logs.items));
  assert.ok(logs.items.length >= 2);
});

test("Upload APIs: image upload and validate", async () => {
  const uploaded = await expectOk("/upload/image", {
    method: "POST",
    body: {
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      width: 1024,
      height: 1024,
      sizeBytes: 68
    }
  });
  assert.match(uploaded.imageId, /^img_/);
  imageId = uploaded.imageId;

  const validation = await expectOk("/upload/validate", {
    method: "POST",
    body: { imageId }
  });
  assert.equal(validation.valid, true);
});

test("Generation APIs: create, query, retry, cancel, history", async () => {
  const created = await expectOk("/generation/create", {
    method: "POST",
    body: { inputImageId: imageId, styles: ["pixar"], size: "1024x1024" }
  });
  assert.match(created.taskId, /^task_/);
  taskId = created.taskId;

  const done = await pollTask(taskId);
  assert.equal(done.status, "SUCCESS");
  assert.equal(done.charged, true);
  assert.equal(done.images[0].status, "SUCCESS");

  const retried = await expectOk(`/generation/${taskId}/retry`, { method: "POST" });
  assert.equal(retried.status, "QUEUED");
  await pollTask(taskId);

  const cancelCreated = await expectOk("/generation/create", {
    method: "POST",
    body: { inputImageId: imageId, styles: ["comic"], size: "1024x1024" }
  });
  const cancelled = await expectOk(`/generation/${cancelCreated.taskId}/cancel`, { method: "POST" });
  assert.equal(cancelled.status, "CANCELLED");

  const history = await expectOk("/generation/history");
  assert.ok(history.total >= 2);
});

test("Order and Payment APIs: packages, create, get, list, close, notify, reconcile", async () => {
  const packages = await expectOk("/packages");
  assert.equal(packages[0].packageId, "pkg_6_20");

  const created = await expectOk("/orders", {
    method: "POST",
    body: { packageId: "pkg_6_20" }
  });
  assert.match(created.order.orderId, /^ord_/);
  orderId = created.order.orderId;
  assert.ok(created.paymentParams);

  const order = await expectOk(`/orders/${orderId}`);
  assert.equal(order.status, "PENDING");

  const list = await expectOk("/orders");
  assert.ok(list.total >= 1);

  const closed = await expectOk(`/orders/${orderId}/close`, { method: "POST" });
  assert.equal(closed.ok, true);

  const notify = await expectOk("/payment/wechat/notify", {
    method: "POST",
    body: { orderId }
  });
  assert.equal(notify.code, "SUCCESS");

  const reconcile = await expectOk("/payment/reconcile", {
    method: "POST",
    body: { orderId }
  });
  assert.equal(reconcile.ok, true);
});

test("Share and Feedback APIs: poster, reward, feedback", async () => {
  const poster = await expectOk("/share/create-poster", {
    method: "POST",
    body: { taskId, imageId: "poster_image" }
  });
  assert.match(poster.posterUrl, /^data:image\/svg\+xml/);

  const reward = await expectOk("/share/reward", {
    method: "POST",
    body: { shareCode: "share_code" }
  });
  assert.equal(typeof reward.rewarded, "boolean");

  const feedback = await expectOk("/feedback", {
    method: "POST",
    body: { content: "接口测试反馈", taskId }
  });
  assert.equal(feedback.ok, true);
});
