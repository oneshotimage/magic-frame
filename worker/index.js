const STYLE_PROMPTS = {
  pixar: {
    name: "3D皮克斯卡通",
    color: "#FFB800",
    prompt: "保留上传照片中人物身份特征，将人物重绘为高质量3D动画电影角色，柔和立体、明亮眼睛、精致布光，不要文字水印。"
  },
  realistic: {
    name: "高级写实插画",
    color: "#FF7D45",
    prompt: "保留人物五官比例、发型和姿态，生成高级写实插画写真，电影级光影、自然肤色、干净背景，不改变人物身份。"
  },
  handdrawn: {
    name: "文艺手绘质感",
    color: "#A87532",
    prompt: "保留人物身份特征，生成温柔文艺手绘写真，柔和线条、纸张纹理、淡雅配色、治愈氛围。"
  },
  comic: {
    name: "潮流涂鸦漫画",
    color: "#222222",
    prompt: "保留人物身份特征，生成潮流街头漫画风格，清晰轮廓、漫画分镜质感、适度涂鸦元素，不要品牌logo和文字。"
  }
};

const PACKAGES = [
  { packageId: "pkg_6_20", name: "20次包", priceFen: 600, credits: 20 },
  { packageId: "pkg_12_50", name: "50次包", priceFen: 1200, credits: 50 },
  { packageId: "pkg_19_100", name: "100次包", priceFen: 1900, credits: 100 }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function token(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function dataUrlToFile(dataUrl, filename = "portrait.jpg") {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) throw appError("UPLOAD_INVALID_IMAGE", "input image must be dataUrl", 400);
  const [, mimeType, base64] = match;
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], filename, { type: mimeType });
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return String(payload || "");
  return JSON.stringify(payload, (key, value) => {
    if (typeof value === "string" && value.length > 240) return `${value.slice(0, 240)}...`;
    return value;
  }).slice(0, 1000);
}

function extractOutputImage(payload) {
  const candidates = [];
  if (payload?.data && Array.isArray(payload.data)) candidates.push(...payload.data);
  if (payload?.output && Array.isArray(payload.output)) candidates.push(...payload.output);
  if (payload?.images && Array.isArray(payload.images)) candidates.push(...payload.images);
  candidates.push(payload);

  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const b64 = item.b64_json || item.b64 || item.base64 || item.image_base64;
    if (b64) return { dataUrl: `data:image/png;base64,${b64}` };
    const url = item.url || item.image_url || item.output_url;
    if (url) return { url };
  }
  return {};
}

function readUserId(request) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/Bearer\s+(.+)/i);
  const raw = match?.[1] || "demo-user";
  return raw.replace(/^dev-token-/, "").replace(/^atk_/, "usr_");
}

function svgDataUrl(title, subtitle, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#FFF5E8"/><stop offset=".55" stop-color="#FFFFFF"/><stop offset="1" stop-color="${color}33"/></linearGradient></defs>
<rect width="1024" height="1024" fill="url(#bg)"/><rect x="162" y="138" width="700" height="748" rx="56" fill="rgba(255,255,255,.78)" stroke="#F3D9AA" stroke-width="3"/>
<circle cx="512" cy="404" r="150" fill="${color}"/><circle cx="462" cy="370" r="22" fill="#222"/><circle cx="562" cy="370" r="22" fill="#222"/>
<path d="M440 478c48 42 104 42 144 0" fill="none" stroke="#222" stroke-width="20" stroke-linecap="round"/>
<text x="512" y="665" text-anchor="middle" font-size="54" font-family="Arial" fill="#222" font-weight="700">${title}</text>
<text x="512" y="725" text-anchor="middle" font-size="30" font-family="Arial" fill="#666">${subtitle}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function defaultState() {
  return {
    users: {},
    tokens: {},
    refreshTokens: {},
    credits: {},
    creditLogs: [],
    uploads: {},
    tasks: {},
    orders: {},
    feedback: [],
    adRewards: {},
    generatedAssets: {},
    adminTokens: {}
  };
}

function normalizeState(state) {
  return { ...defaultState(), ...(state || {}) };
}

function runtimeConfig(env, request) {
  const baseUrl = env.KL_API_BASE_URL || "https://api.kl-api.info";
  const endpoint = env.KL_IMAGE_ENDPOINT || "/v1/images/edits";
  const publicBaseUrl = (env.PUBLIC_BASE_URL || "https://ai-image-backend.linjinzhu6287.workers.dev").replace(/\/$/, "");
  const mockEnabled = String(env.AI_MOCK_GENERATION ?? "0") === "1";
  const forwardedToken = request?.headers?.get("x-internal-kl-api-token") || "";
  const forwardedKey = request?.headers?.get("x-internal-kl-api-key") || "";
  return {
    generationMode: mockEnabled ? "mock" : "real",
    mockEnabled,
    klTokenConfigured: Boolean(env.KL_API_TOKEN || env.KL_API_KEY || forwardedToken || forwardedKey),
    klBaseUrl: baseUrl,
    klImageEndpoint: endpoint,
    klImageModel: env.KL_IMAGE_MODEL || "gpt-image-2",
    klProxyConfigured: false,
    klProxyUrl: "",
    klTimeoutSeconds: Number(env.KL_TIMEOUT_SECONDS || 600),
    publicBaseUrl,
    unlimitedCredits: String(env.AI_UNLIMITED_CREDITS ?? "1") === "1"
  };
}

function appError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export class ApiState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async load() {
    return normalizeState(await this.state.storage.get("state"));
  }

  async save(state) {
    const compact = clone(state);
    compact.uploads = Object.fromEntries(Object.entries(compact.uploads || {}).map(([key, upload]) => {
      const { url, ...meta } = upload || {};
      return [key, meta];
    }));
    compact.tasks = Object.fromEntries(Object.entries(compact.tasks || {}).map(([key, task]) => {
      const { inputImageDataUrl, ...meta } = task || {};
      return [key, meta];
    }));
    compact.generatedAssets = Object.fromEntries(Object.entries(compact.generatedAssets || {}).map(([key, asset]) => {
      const { base64, ...meta } = asset || {};
      return [key, meta];
    }));
    await this.state.storage.put("state", compact);
  }

  ensureUser(state, userId = "demo-user") {
    if (!state.users[userId]) {
      state.users[userId] = {
        userId,
        openId: `mock_openid_${userId}`,
        nickname: "写真体验官",
        avatarUrl: "",
        isNewUser: true,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
    }
    if (!state.credits[userId]) {
      state.credits[userId] = {
        userId,
        balance: 3,
        totalCredits: 3,
        freeCredits: 3,
        paidCredits: 0,
        adCredits: 0,
        giftCredits: 0,
        usedCredits: 0,
        todayAdCount: 0,
        dailyAdLimit: 5,
        updatedAt: nowIso()
      };
      state.creditLogs.push({
        id: id("clog"),
        userId,
        type: "free",
        direction: "in",
        amount: 3,
        balanceAfter: 3,
        bizType: "register",
        bizId: userId,
        createdAt: nowIso()
      });
    }
    return state.users[userId];
  }

  currentUserId(state, request) {
    const auth = request.headers.get("authorization") || "";
    const bearer = auth.match(/Bearer\s+(.+)/i)?.[1] || "";
    if (!bearer) throw appError("UNAUTHORIZED", "缺少登录 token", 401);
    if (state.tokens[bearer]) return state.tokens[bearer];
    if (bearer.startsWith("dev-token-")) return bearer.replace(/^dev-token-/, "");
    throw appError("UNAUTHORIZED", "登录已过期", 401);
  }

  currentAdmin(state, request) {
    const auth = request.headers.get("authorization") || "";
    const bearer = auth.match(/Bearer\s+(.+)/i)?.[1] || "";
    if (!bearer || !state.adminTokens[bearer]) throw appError("ADMIN_UNAUTHORIZED", "管理员登录已过期", 401);
    return bearer;
  }

  issueTokens(state, userId) {
    const accessToken = token("atk");
    const refreshToken = token("rtk");
    state.tokens[accessToken] = userId;
    state.refreshTokens[refreshToken] = userId;
    return { accessToken, refreshToken, expiresIn: 7200 };
  }

  creditsResponse(state, userId) {
    this.ensureUser(state, userId);
    const credits = state.credits[userId];
    credits.totalCredits = Number(credits.freeCredits || 0) + Number(credits.paidCredits || 0) + Number(credits.adCredits || 0) + Number(credits.giftCredits || 0);
    credits.balance = credits.totalCredits;
    if (String(this.env.AI_UNLIMITED_CREDITS ?? "1") === "1") {
      return { ...credits, actualBalance: credits.balance, actualTotalCredits: credits.totalCredits, unlimited: true, balance: 999999, totalCredits: 999999, displayText: "无限" };
    }
    return { ...credits, actualBalance: credits.balance, actualTotalCredits: credits.totalCredits, unlimited: false, displayText: String(credits.balance) };
  }

  addCredits(state, userId, type, amount, bizType, bizId) {
    this.ensureUser(state, userId);
    const credits = state.credits[userId];
    const key = `${type}Credits`;
    credits[key] = Number(credits[key] || 0) + amount;
    credits.updatedAt = nowIso();
    const next = this.creditsResponse(state, userId);
    state.creditLogs.push({ id: id("clog"), userId, type, direction: "in", amount, balanceAfter: next.actualBalance, bizType, bizId, createdAt: nowIso() });
    return next;
  }

  consumeOneCredit(state, userId, taskId) {
    if (String(this.env.AI_UNLIMITED_CREDITS ?? "1") === "1") return true;
    const credits = state.credits[userId];
    for (const key of ["freeCredits", "adCredits", "paidCredits", "giftCredits"]) {
      if (Number(credits[key] || 0) > 0) {
        credits[key] -= 1;
        credits.usedCredits = Number(credits.usedCredits || 0) + 1;
        const next = this.creditsResponse(state, userId);
        state.creditLogs.push({ id: id("clog"), userId, type: key.replace("Credits", ""), direction: "out", amount: 1, balanceAfter: next.actualBalance, bizType: "generation", bizId: taskId, createdAt: nowIso() });
        return true;
      }
    }
    return false;
  }

  publicTask(task) {
    const data = clone(task);
    delete data.userId;
    delete data.inputImageDataUrl;
    return data;
  }

  adminTask(task) {
    return { ...this.publicTask(task), userId: task.userId };
  }

  adminUser(state, userId) {
    const user = clone(state.users[userId]);
    user.credits = this.creditsResponse(state, userId);
    user.taskCount = Object.values(state.tasks).filter((task) => task.userId === userId).length;
    user.orderCount = Object.values(state.orders).filter((order) => order.userId === userId).length;
    return user;
  }

  async storeGeneratedAsset(state, dataUrl, style, request) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
    if (!match) return dataUrl;
    const [, mimeType, base64] = match;
    if (base64.length > 700000) {
      throw appError("ASSET_TOO_LARGE", "生成图片过大，当前 Cloudflare 存储未接 R2，无法保存。", 413);
    }
    const ext = { "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" }[mimeType] || "png";
    const assetId = id("gen");
    state.generatedAssets[assetId] = { assetId, style, mimeType, ext, createdAt: nowIso() };
    await this.state.storage.put(`asset:${assetId}`, base64);
    const configuredBase = runtimeConfig(this.env, request).publicBaseUrl;
    const origin = configuredBase || new URL(request.url).origin;
    return `${origin}/assets/generated/${assetId}.${ext}`;
  }

  async storeGeneratedOutput(state, output, style, request) {
    if (output.dataUrl) return this.storeGeneratedAsset(state, output.dataUrl, style, request);
    if (!output.url) return "";
    if (output.url.startsWith("data:image/")) return this.storeGeneratedAsset(state, output.url, style, request);
    const response = await fetch(output.url);
    if (!response.ok) return output.url;
    const mimeType = response.headers.get("content-type") || "image/png";
    const buffer = await response.arrayBuffer();
    const dataUrl = `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
    return this.storeGeneratedAsset(state, dataUrl, style, request);
  }

  async callKlImage2(imageDataUrl, prompt, size, request) {
    const config = runtimeConfig(this.env, request);
    const apiToken = this.env.KL_API_TOKEN || this.env.KL_API_KEY || request.headers.get("x-internal-kl-api-token") || request.headers.get("x-internal-kl-api-key");
    if (!apiToken) {
      throw appError("KL_TOKEN_MISSING", "KL_API_TOKEN 未配置，无法真实调用 gpt-image-2。", 500);
    }

    const target = `${config.klBaseUrl.replace(/\/$/, "")}${config.klImageEndpoint}`;
    const form = new FormData();
    form.append("model", config.klImageModel);
    form.append("prompt", prompt);
    form.append("size", size || "1024x1024");
    form.append("n", "1");
    form.append("response_format", "url");
    form.append("image", dataUrlToFile(imageDataUrl));

    const started = Date.now();
    const response = await fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        accept: "application/json"
      },
      body: form
    });
    const rawText = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(rawText || "{}");
    } catch {
      payload = { raw: rawText };
    }
    if (!response.ok) {
      throw appError("KL_API_ERROR", `KL API HTTP ${response.status}: ${summarizePayload(payload)}`, response.status);
    }
    const output = extractOutputImage(payload);
    if (!output.url && !output.dataUrl) {
      throw appError("KL_EMPTY_OUTPUT", `KL API 未返回图片字段: ${summarizePayload(payload)}`, 502);
    }
    return {
      ...output,
      httpStatus: response.status,
      elapsedMs: Date.now() - started,
      target,
      model: config.klImageModel,
      endpoint: config.klImageEndpoint,
      responseKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      rawSummary: summarizePayload(payload)
    };
  }

  async completeGeneration(state, task, request, inputImageDataUrl) {
    if (task.status === "CANCELLED") return task;
    task.status = "RUNNING";
    task.progress = 18;
    task.provider = { ...runtimeConfig(this.env, request), startedAt: nowIso() };
    task.updatedAt = nowIso();
    let successCount = 0;

    for (let index = 0; index < task.images.length; index += 1) {
      const image = task.images[index];
      const style = STYLE_PROMPTS[image.style] || STYLE_PROMPTS.pixar;
      const started = Date.now();
      image.status = "RUNNING";
      task.progress = Math.min(92, 25 + index * 18);
      try {
        const output = task.provider.mockEnabled
          ? {
              dataUrl: svgDataUrl(style.name, "Cloudflare Worker mock output", style.color),
              httpStatus: "mock",
              elapsedMs: 120,
              target: "mock",
              model: "mock",
              endpoint: "mock",
              responseKeys: ["mock"],
              rawSummary: "AI_MOCK_GENERATION=1"
            }
          : await this.callKlImage2(inputImageDataUrl, style.prompt, task.size, request);
        image.url = await this.storeGeneratedOutput(state, output, image.style, request);
        image.status = "SUCCESS";
        image.elapsedMs = output.elapsedMs;
        image.errorMessage = "";
        image.provider = {
          mode: task.provider.generationMode,
          httpStatus: output.httpStatus,
          target: output.target,
          model: output.model,
          endpoint: output.endpoint,
          responseKeys: output.responseKeys,
          rawSummary: output.rawSummary
        };
        successCount += 1;
      } catch (error) {
        image.status = "FAILED";
        image.errorMessage = error.message || "生成失败";
        image.elapsedMs = Date.now() - started;
        image.provider = {
          mode: task.provider.generationMode,
          target: `${task.provider.klBaseUrl.replace(/\/$/, "")}${task.provider.klImageEndpoint}`,
          model: task.provider.klImageModel,
          endpoint: task.provider.klImageEndpoint,
          error: error.message || String(error)
        };
      }
    }

    task.status = successCount === task.images.length ? "SUCCESS" : successCount > 0 ? "PARTIAL_SUCCESS" : "FAILED";
    task.progress = 100;
    if (successCount > 0 && !task.charged) {
      task.charged = this.consumeOneCredit(state, task.userId, task.taskId);
    }
    task.provider.completedAt = nowIso();
    task.provider.successCount = successCount;
    task.provider.totalCount = task.images.length;
    task.updatedAt = nowIso();
    return task;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") return json({});
    const state = await this.load();
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/^\/api(?=\/)/, "");
    const method = request.method;
    const fallbackUserId = readUserId(request);
    this.ensureUser(state, fallbackUserId);

    try {
      if (method === "GET" && pathname === "/health") {
        return json({ status: "ok", service: "ai-portrait-worker", time: nowIso(), runtime: runtimeConfig(this.env, request) });
      }

      if (method === "GET" && pathname === "/config/runtime") {
        return json(runtimeConfig(this.env, request));
      }

      const assetMatch = pathname.match(/^\/assets\/generated\/([^/.]+)\.([a-z0-9]+)$/i);
      if (method === "GET" && assetMatch) {
        const asset = state.generatedAssets[assetMatch[1]];
        if (!asset) return json({ code: "ASSET_NOT_FOUND", message: "图片不存在或已过期" }, 404);
        const base64 = asset.base64 || await this.state.storage.get(`asset:${assetMatch[1]}`);
        if (!base64) return json({ code: "ASSET_NOT_FOUND", message: "图片不存在或已过期" }, 404);
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "content-type": asset.mimeType,
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=86400"
          }
        });
      }

      if (method === "POST" && pathname === "/upload/file") {
        const uploadUserId = this.currentUserId(state, request);
        this.ensureUser(state, uploadUserId);
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          return json({ code: "UPLOAD_INVALID_IMAGE", message: "请上传图片文件" }, 400);
        }
        const mimeType = file.type || "image/jpeg";
        if (!/^image\//.test(mimeType)) {
          return json({ code: "UPLOAD_INVALID_IMAGE", message: "请上传图片文件" }, 400);
        }
        const buffer = await file.arrayBuffer();
        if (buffer.byteLength > 250 * 1024) {
          return json({ code: "UPLOAD_TOO_LARGE", message: "图片过大，请换一张更小的照片" }, 413);
        }
        const imageId = id("img");
        const dataUrl = `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
        const upload = {
          imageId,
          userId: uploadUserId,
          width: Number(form.get("width") || 1024),
          height: Number(form.get("height") || 1024),
          sizeBytes: buffer.byteLength,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          createdAt: nowIso()
        };
        state.uploads[imageId] = upload;
        await this.state.storage.put(`upload:${imageId}`, dataUrl);
        await this.save(state);
        return json({ ...upload, url: "" });
      }

      const body = ["POST", "PATCH", "PUT"].includes(method) ? await request.json().catch(() => ({})) : {};

      if (method === "POST" && pathname === "/admin/api/login") {
        const username = this.env.ADMIN_USERNAME || "admin";
        const password = this.env.ADMIN_PASSWORD || "admin123";
        if (body.username !== username || body.password !== password) return json({ code: "ADMIN_LOGIN_FAILED", message: "管理员账号或密码错误" }, 401);
        const accessToken = token("adm");
        state.adminTokens[accessToken] = { username, createdAt: nowIso() };
        await this.save(state);
        return json({ accessToken, admin: { username }, runtime: runtimeConfig(this.env, request) });
      }

      if (pathname.startsWith("/admin/api/")) {
        const adminToken = this.currentAdmin(state, request);

        if (method === "POST" && pathname === "/admin/api/logout") {
          delete state.adminTokens[adminToken];
          await this.save(state);
          return json({ ok: true });
        }

        if (method === "GET" && pathname === "/admin/api/me") return json({ username: this.env.ADMIN_USERNAME || "admin", runtime: runtimeConfig(this.env, request) });

        if (method === "GET" && pathname === "/admin/api/runtime") return json(runtimeConfig(this.env, request));

        if (method === "GET" && pathname === "/admin/api/stats") {
          const tasks = Object.values(state.tasks);
          const orders = Object.values(state.orders);
          const statuses = [...new Set(tasks.map((task) => task.status))].sort();
          return json({
            users: Object.keys(state.users).length,
            tasks: tasks.length,
            taskStatus: Object.fromEntries(statuses.map((status) => [status, tasks.filter((task) => task.status === status).length])),
            successImages: tasks.flatMap((task) => task.images || []).filter((image) => image.status === "SUCCESS").length,
            failedImages: tasks.flatMap((task) => task.images || []).filter((image) => image.status === "FAILED").length,
            orders: orders.length,
            paidOrders: orders.filter((order) => order.status === "PAID").length,
            paidAmountFen: orders.filter((order) => order.status === "PAID").reduce((sum, order) => sum + Number(order.amountFen || 0), 0),
            feedback: state.feedback.length,
            assets: Object.keys(state.generatedAssets).length,
            runtime: runtimeConfig(this.env, request)
          });
        }

        if (method === "GET" && pathname === "/admin/api/users") {
          const keyword = (url.searchParams.get("keyword") || "").toLowerCase();
          let items = Object.keys(state.users).map((userId) => this.adminUser(state, userId));
          if (keyword) items = items.filter((item) => [item.userId, item.nickname, item.openId].some((value) => String(value || "").toLowerCase().includes(keyword)));
          items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
          return json({ items, total: items.length });
        }

        const adminUserMatch = pathname.match(/^\/admin\/api\/users\/([^/]+)(?:\/credits)?$/);
        if (adminUserMatch) {
          const targetUserId = decodeURIComponent(adminUserMatch[1]);
          if (!state.users[targetUserId]) return json({ code: "USER_NOT_FOUND", message: "用户不存在" }, 404);
          if (method === "GET" && !pathname.endsWith("/credits")) {
            return json({
              user: this.adminUser(state, targetUserId),
              tasks: Object.values(state.tasks).filter((task) => task.userId === targetUserId).map((task) => this.adminTask(task)),
              orders: Object.values(state.orders).filter((order) => order.userId === targetUserId).map(clone),
              creditLogs: state.creditLogs.filter((item) => item.userId === targetUserId).map(clone)
            });
          }
          if (method === "POST" && pathname.endsWith("/credits")) {
            const credits = state.credits[targetUserId];
            const before = Number(credits.balance || credits.totalCredits || 0);
            let delta;
            if (body.balance != null) {
              const nextBalance = Math.max(0, Number(body.balance));
              delta = nextBalance - before;
              credits.freeCredits = nextBalance;
              credits.paidCredits = 0;
              credits.adCredits = 0;
              credits.giftCredits = 0;
            } else if (body.amount != null) {
              delta = Number(body.amount || 0);
              credits.freeCredits = Math.max(0, Number(credits.freeCredits || 0) + delta);
            } else {
              return json({ code: "CREDIT_UPDATE_INVALID", message: "请填写调整次数或目标剩余次数" }, 400);
            }
            credits.updatedAt = nowIso();
            const next = this.creditsResponse(state, targetUserId);
            state.creditLogs.push({ id: id("clog"), userId: targetUserId, type: "admin_adjust", amount: delta, bizId: body.reason || "admin", createdAt: nowIso() });
            await this.save(state);
            return json(next);
          }
        }

        if (method === "GET" && pathname === "/admin/api/tasks") {
          const status = url.searchParams.get("status");
          const keyword = (url.searchParams.get("keyword") || "").toLowerCase();
          let items = Object.values(state.tasks).map((task) => this.adminTask(task));
          if (status) items = items.filter((item) => item.status === status);
          if (keyword) items = items.filter((item) => [item.taskId, item.userId].some((value) => String(value || "").toLowerCase().includes(keyword)));
          items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
          return json({ items, total: items.length });
        }

        const adminTaskMatch = pathname.match(/^\/admin\/api\/tasks\/([^/]+)(?:\/(retry|cancel))?$/);
        if (adminTaskMatch) {
          const task = state.tasks[adminTaskMatch[1]];
          if (!task) return json({ code: "TASK_NOT_FOUND", message: "任务不存在" }, 404);
          if (method === "GET" && !adminTaskMatch[2]) return json(this.adminTask(task));
          if (method === "POST" && adminTaskMatch[2] === "retry") {
            const inputImageDataUrl = task.inputImageDataUrl || await this.state.storage.get(`upload:${task.inputImageId}`);
            if (!inputImageDataUrl) return json({ code: "UPLOAD_INVALID_IMAGE", message: "图片不存在或已过期" }, 400);
            state.tasks[task.taskId] = await this.completeGeneration(state, { ...task, status: "QUEUED", progress: 8, errorMessage: "" }, request, inputImageDataUrl);
            await this.save(state);
            return json(this.adminTask(state.tasks[task.taskId]));
          }
          if (method === "POST" && adminTaskMatch[2] === "cancel") {
            task.status = "CANCELLED";
            task.updatedAt = nowIso();
            await this.save(state);
            return json(this.adminTask(task));
          }
        }

        if (method === "GET" && pathname === "/admin/api/orders") {
          const status = url.searchParams.get("status");
          let items = Object.values(state.orders).map(clone);
          if (status) items = items.filter((item) => item.status === status);
          items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
          return json({ items, total: items.length });
        }

        const adminOrderMatch = pathname.match(/^\/admin\/api\/orders\/([^/]+)\/close$/);
        if (method === "POST" && adminOrderMatch) {
          const order = state.orders[adminOrderMatch[1]];
          if (!order) return json({ code: "ORDER_NOT_FOUND", message: "订单不存在" }, 404);
          order.status = "CLOSED";
          await this.save(state);
          return json({ ok: true });
        }

        if (method === "GET" && pathname === "/admin/api/feedback") {
          const items = state.feedback.map(clone).reverse();
          return json({ items, total: items.length });
        }

        if (method === "GET" && pathname === "/admin/api/assets") {
          const publicBase = runtimeConfig(this.env, request).publicBaseUrl;
          const items = Object.values(state.generatedAssets).map((asset) => ({
            assetId: asset.assetId,
            style: asset.style,
            mimeType: asset.mimeType,
            sizeBytes: asset.base64 ? Math.round((asset.base64.length * 3) / 4) : asset.sizeBytes || 0,
            createdAt: asset.createdAt,
            url: `${publicBase}/assets/generated/${asset.assetId}.${asset.ext}`
          })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
          return json({ items, total: items.length });
        }
      }

      if (method === "POST" && pathname === "/auth/wechat-login") {
        const idValue = body.code ? `wx_${String(body.code).slice(-8)}` : fallbackUserId;
        const user = this.ensureUser(state, idValue);
        if (body.userInfo) {
          user.nickname = body.userInfo.nickname || body.userInfo.nickName || user.nickname;
          user.avatarUrl = body.userInfo.avatarUrl || body.userInfo.avatar_url || user.avatarUrl;
          user.updatedAt = nowIso();
        }
        const issued = this.issueTokens(state, idValue);
        await this.save(state);
        return json({ ...issued, user: clone(user), credits: this.creditsResponse(state, idValue) });
      }

      if (method === "POST" && (pathname === "/auth/refresh-token" || pathname === "/auth/refresh")) {
        const owner = state.refreshTokens[body.refreshToken] || (String(body.refreshToken || "").startsWith("dev-refresh-") ? String(body.refreshToken).replace(/^dev-refresh-/, "") : "");
        if (!owner) return json({ code: "UNAUTHORIZED", message: "refresh token 无效" }, 401);
        const issued = this.issueTokens(state, owner);
        await this.save(state);
        return json(issued);
      }

      if (method === "GET" && pathname === "/packages") return json(clone(PACKAGES));

      if (method === "POST" && pathname === "/payment/wechat/notify") {
        const order = body.orderId ? state.orders[body.orderId] : Object.values(state.orders).find((item) => item.status === "PENDING");
        if (order && order.status !== "PAID" && body.paid !== false) {
          order.status = "PAID";
          order.transactionId = body.transactionId || "";
          order.paidAt = nowIso();
          this.addCredits(state, order.userId, "paid", order.credits, "payment", order.orderId);
        }
        await this.save(state);
        return json({ code: "SUCCESS", message: "OK" });
      }

      if (method === "POST" && pathname === "/payment/reconcile") return json({ ok: true });

      const userId = this.currentUserId(state, request);
      this.ensureUser(state, userId);

      if (method === "POST" && pathname === "/auth/logout") {
        for (const [accessToken, owner] of Object.entries(state.tokens)) {
          if (owner === userId) delete state.tokens[accessToken];
        }
        await this.save(state);
        return json({ ok: true });
      }

      if (method === "GET" && pathname === "/user/profile") return json(state.users[userId]);

      if (method === "PATCH" && pathname === "/user/profile") {
        state.users[userId] = { ...state.users[userId], ...body, updatedAt: nowIso() };
        await this.save(state);
        return json(state.users[userId]);
      }

      if (method === "POST" && pathname === "/user/delete") {
        delete state.users[userId];
        delete state.credits[userId];
        await this.save(state);
        return json({ ok: true });
      }

      if (method === "GET" && pathname === "/credits") return json(this.creditsResponse(state, userId));

      if (method === "GET" && pathname === "/credits/logs") {
        const items = state.creditLogs.filter((log) => log.userId === userId).reverse();
        return json({ items, total: items.length });
      }

      if (method === "POST" && pathname === "/credits/consume") {
        const amount = Math.max(1, Number(body.amount || 1));
        const credits = this.creditsResponse(state, userId);
        if (!credits.unlimited && credits.actualBalance < amount) return json({ code: "CREDIT_NOT_ENOUGH", message: "生成次数不足" }, 402);
        for (let index = 0; index < amount; index += 1) this.consumeOneCredit(state, userId, body.bizId || body.idempotencyKey || id("manual"));
        await this.save(state);
        return json(this.creditsResponse(state, userId));
      }

      if (method === "POST" && pathname === "/credits/reward-ad") {
        if (!body.completed) return json({ rewarded: false, credits: this.creditsResponse(state, userId) });
        if (body.adEventId && state.adRewards[body.adEventId]) return json({ rewarded: false, credits: this.creditsResponse(state, userId) });
        const credits = state.credits[userId];
        if (credits.todayAdCount >= credits.dailyAdLimit) return json({ code: "AD_DAILY_LIMIT", message: "今日广告奖励次数已达上限" }, 429);
        if (body.adEventId) state.adRewards[body.adEventId] = true;
        credits.todayAdCount += 1;
        const next = this.addCredits(state, userId, "ad", 1, "reward_ad", body.adEventId || id("ad"));
        await this.save(state);
        return json({ rewarded: true, credits: next });
      }

      if (method === "POST" && pathname === "/upload/image") {
        if (!body.dataUrl || !/^data:image\//.test(body.dataUrl)) return json({ code: "UPLOAD_INVALID_IMAGE", message: "请上传图片 dataUrl" }, 400);
        if (String(body.dataUrl).length > 360000) return json({ code: "UPLOAD_TOO_LARGE", message: "图片过大，请换一张更小的照片" }, 413);
        const imageId = id("img");
        const upload = { imageId, userId, width: body.width || 1024, height: body.height || 1024, sizeBytes: body.sizeBytes || Math.round(body.dataUrl.length * 0.75), expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: nowIso() };
        state.uploads[imageId] = upload;
        await this.state.storage.put(`upload:${imageId}`, body.dataUrl);
        await this.save(state);
        return json({ ...upload, url: "" });
      }

      if (method === "POST" && pathname === "/upload/validate") {
        const upload = state.uploads[body.imageId];
        const valid = Boolean(upload && upload.userId === userId);
        return json({ valid, reason: valid ? "" : "图片不存在或已过期" });
      }

      if (method === "POST" && pathname === "/generation/create") {
        const credits = this.creditsResponse(state, userId);
        if (!credits.unlimited && credits.actualBalance <= 0) return json({ code: "CREDIT_NOT_ENOUGH", message: "生成次数不足" }, 402);
        const upload = state.uploads[body.inputImageId];
        if (!upload) return json({ code: "UPLOAD_INVALID_IMAGE", message: "请先上传照片" }, 400);
        const inputImageDataUrl = upload.url || await this.state.storage.get(`upload:${upload.imageId}`);
        if (!inputImageDataUrl) return json({ code: "UPLOAD_INVALID_IMAGE", message: "图片不存在或已过期" }, 400);
        const styles = (body.styles || ["pixar", "realistic", "handdrawn", "comic"]).filter((style) => STYLE_PROMPTS[style]);
        const taskId = id("task");
        const task = {
          taskId,
          userId,
          inputImageId: upload.imageId,
          status: "QUEUED",
          progress: 8,
          size: body.size || "1024x1024",
          charged: false,
          images: styles.map((style) => ({ imageId: id("out"), style, status: "PENDING", url: "", errorMessage: "", elapsedMs: 0 })),
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        state.tasks[taskId] = await this.completeGeneration(state, task, request, inputImageDataUrl);
        await this.save(state);
        return json(this.publicTask(state.tasks[taskId]));
      }

      if (method === "GET" && pathname === "/generation/history") {
        const items = Object.values(state.tasks).filter((task) => task.userId === userId).map((task) => this.publicTask(task)).reverse();
        return json({ items, total: items.length });
      }

      const taskMatch = pathname.match(/^\/generation\/([^/]+)(?:\/(retry|cancel))?$/);
      if (taskMatch) {
        const task = state.tasks[taskMatch[1]];
        if (!task || task.userId !== userId) return json({ code: "TASK_NOT_FOUND", message: "任务不存在" }, 404);
        if (method === "GET" && !taskMatch[2]) return json(this.publicTask(task));
        if (method === "POST" && taskMatch[2] === "retry") {
          const inputImageDataUrl = task.inputImageDataUrl || await this.state.storage.get(`upload:${task.inputImageId}`);
          if (!inputImageDataUrl) return json({ code: "UPLOAD_INVALID_IMAGE", message: "图片不存在或已过期" }, 400);
          state.tasks[task.taskId] = await this.completeGeneration(state, { ...task, status: "QUEUED", progress: 8, errorMessage: "" }, request, inputImageDataUrl);
          await this.save(state);
          return json(this.publicTask(state.tasks[task.taskId]));
        }
        if (method === "POST" && taskMatch[2] === "cancel") {
          task.status = "CANCELLED";
          task.updatedAt = nowIso();
          await this.save(state);
          return json(this.publicTask(task));
        }
      }

      if (method === "GET" && pathname === "/packages") return json(PACKAGES);

      if (method === "POST" && pathname === "/orders") {
        const pkg = PACKAGES.find((item) => item.packageId === body.packageId) || PACKAGES[0];
        const order = {
          orderId: id("ord"),
          orderNo: `NO${Date.now()}`,
          userId,
          packageId: pkg.packageId,
          packageName: pkg.name,
          amountFen: pkg.priceFen,
          credits: pkg.credits,
          status: "PENDING",
          createdAt: nowIso(),
          paymentParams: { timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: crypto.randomUUID().replaceAll("-", ""), package: `prepay_id=mock_${Date.now()}`, signType: "RSA", paySign: "mock-signature" }
        };
        state.orders[order.orderId] = order;
        await this.save(state);
        return json({ order, paymentParams: order.paymentParams });
      }

      if (method === "GET" && pathname === "/orders") {
        const items = Object.values(state.orders).filter((order) => order.userId === userId).reverse();
        return json({ items, total: items.length });
      }

      const orderMatch = pathname.match(/^\/orders\/([^/]+)(?:\/close)?$/);
      if (orderMatch) {
        const order = state.orders[orderMatch[1]];
        if (!order || order.userId !== userId) return json({ code: "ORDER_NOT_FOUND", message: "订单不存在" }, 404);
        if (method === "GET") return json(order);
        if (method === "POST" && pathname.endsWith("/close")) {
          order.status = "CLOSED";
          await this.save(state);
          return json({ ok: true });
        }
      }

      if (method === "POST" && pathname === "/payment/wechat/notify") {
        const order = body.orderId ? state.orders[body.orderId] : Object.values(state.orders).find((item) => item.status === "PENDING");
        if (order && order.status !== "PAID") {
          order.status = "PAID";
          order.paidAt = nowIso();
          this.addCredits(state, order.userId, "paid", order.credits, "payment", order.orderId);
        }
        await this.save(state);
        return json({ code: "SUCCESS", message: "OK" });
      }

      if (method === "POST" && pathname === "/payment/reconcile") return json({ ok: true });

      if (method === "POST" && pathname === "/share/create-poster") return json({ posterUrl: svgDataUrl("AI影像写真馆", "扫码生成你的艺术写真", "#FFB800") });

      if (method === "POST" && pathname === "/share/reward") return json({ rewarded: false });

      if (method === "POST" && pathname === "/feedback") {
        state.feedback.push({ id: id("fb"), userId, ...body, createdAt: nowIso() });
        await this.save(state);
        return json({ ok: true });
      }

      return json({ code: "NOT_FOUND", message: "接口不存在" }, 404);
    } catch (error) {
      return json({ code: "INTERNAL_ERROR", message: error?.message || String(error) }, 500);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({});
    const url = new URL(request.url);
    if (url.pathname === "/admin" || (url.pathname.startsWith("/admin/") && !url.pathname.startsWith("/admin/api/"))) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetUrl.pathname === "/admin" || assetUrl.pathname === "/admin/" ? "/index.html" : assetUrl.pathname.replace(/^\/admin/, "");
      const assetRequest = new Request(assetUrl, {
        method: "GET",
        headers: request.headers
      });
      return env.ADMIN_ASSETS.fetch(assetRequest);
    }
    const idValue = env.API_STATE.idFromName("global");
    const stub = env.API_STATE.get(idValue);
    const headers = new Headers(request.headers);
    if (env.KL_API_TOKEN) headers.set("x-internal-kl-api-token", env.KL_API_TOKEN);
    if (env.KL_API_KEY) headers.set("x-internal-kl-api-key", env.KL_API_KEY);
    return stub.fetch(new Request(request, { headers }));
  }
};
