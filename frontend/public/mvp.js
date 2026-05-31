const figmaHero = "https://www.figma.com/api/mcp/asset/fa708f0a-c128-4fe1-92b1-0a0e00e17271";

const styles = [
  { id: "pixar", name: "3D皮克斯卡通", icon: "3D", text: "立体柔和，适合头像" },
  { id: "realistic", name: "高级写实插画", icon: "光", text: "电影光影，精致写真" },
  { id: "handdrawn", name: "文艺手绘质感", icon: "绘", text: "纸张纹理，治愈氛围" },
  { id: "comic", name: "潮流涂鸦漫画", icon: "漫", text: "街头漫画，社交感强" }
];

const routes = {
  splash: "AI影像写真馆",
  home: "AI影像写真馆",
  style: "选择风格",
  upload: "上传照片",
  confirm: "确认照片",
  agreement: "授权确认",
  generating: "AI绘制中",
  result: "生成结果",
  preview: "图片预览",
  saveSuccess: "保存成功",
  sharePoster: "分享海报",
  purchase: "购买次数",
  adReward: "广告奖励",
  profile: "我的",
  orders: "订单记录",
  faq: "常见问题",
  legal: "隐私与协议"
};

const state = {
  route: "splash",
  history: [],
  token: localStorage.getItem("mvp.token") || "",
  user: null,
  credits: null,
  selectedStyles: ["pixar", "realistic", "handdrawn", "comic"],
  upload: null,
  uploadDataUrl: "",
  task: null,
  previewImage: "",
  packages: [],
  orders: [],
  debug: []
};

const els = {
  title: document.querySelector("#pageTitle"),
  screen: document.querySelector("#screen"),
  back: document.querySelector("#backBtn"),
  tabbar: document.querySelector("#tabbar"),
  debugToggle: document.querySelector("#debugToggle"),
  debugPanel: document.querySelector("#debugPanel"),
  closeDebug: document.querySelector("#closeDebug"),
  debugLog: document.querySelector("#debugLog")
};

function log(entry) {
  state.debug.unshift({ at: new Date().toLocaleTimeString(), ...entry });
  state.debug = state.debug.slice(0, 30);
  els.debugLog.textContent = JSON.stringify(state.debug, null, 2);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  log({ api: path, status: response.status, ok: response.ok, data });
  if (!response.ok) throw data;
  return data;
}

function go(route, params = {}) {
  if (state.route !== route) state.history.push(state.route);
  Object.assign(state, params, { route });
  render();
}

function back() {
  const prev = state.history.pop() || "home";
  state.route = prev;
  render();
}

async function bootstrap() {
  const login = await api("/auth/wechat-login", { method: "POST", body: { code: `demo_${Date.now()}` } });
  state.token = login.accessToken;
  localStorage.setItem("mvp.token", state.token);
  state.user = login.user;
  state.credits = login.credits;
  state.packages = await api("/packages");
}

function pageShell(inner) {
  return `<div class="page-stack">${inner}</div>`;
}

function creditBadge() {
  const credits = state.credits || { totalCredits: 0 };
  return `<span class="credit-badge">剩余 ${credits.totalCredits} 次</span>`;
}

function renderSplash() {
  return `<div class="splash">
    <div class="hero-visual">
      <img src="${figmaHero}" alt="AI影像写真馆" onerror="this.style.display='none'" />
      <div class="floating-icon left">♥</div>
      <div class="floating-icon right">▣</div>
      <div class="glass-chip">
        <span class="chip-icon">AI</span>
        <div><strong>AI 智能生成</strong><div class="muted">快速解锁多款风格</div></div>
      </div>
    </div>
    <div>
      <p class="subtitle">一张照片 解锁你的艺术写真</p>
      <button class="primary-btn" data-action="start">开始制作 →</button>
    </div>
  </div>`;
}

function renderHome() {
  return pageShell(`
    <section class="card">
      <div class="row">
        <div><h2>一张照片，解锁四种艺术写真</h2><p class="subtitle">基于 KL API image2 图片编辑链路，保留人物特征并重绘风格。</p></div>
        ${creditBadge()}
      </div>
    </section>
    <section class="style-grid">${styles.map(styleCard).join("")}</section>
    <button class="primary-btn" data-action="goUpload">立即制作</button>
    <button class="secondary-btn" data-route="adReward">看广告得次数</button>
  `);
}

function styleCard(style) {
  const active = state.selectedStyles.includes(style.id) ? "active" : "";
  return `<button class="style-card ${active}" data-style="${style.id}" type="button">
    <div class="style-thumb">${style.icon}</div>
    <strong>${style.name}</strong>
    <div class="muted">${style.text}</div>
  </button>`;
}

function renderStyle() {
  return pageShell(`
    <section class="card"><h2>选择风格</h2><p class="subtitle">默认一键生成四种，也可以只保留部分风格。</p></section>
    <section class="style-grid">${styles.map(styleCard).join("")}</section>
    <button class="primary-btn" data-route="upload">下一步</button>
  `);
}

function renderUpload() {
  return pageShell(`
    <label class="upload-box">
      <input id="fileInput" type="file" accept="image/*" />
      ${state.uploadDataUrl ? `<img src="${state.uploadDataUrl}" alt="上传照片" />` : `<div><h2>选择照片</h2><p class="subtitle">建议清晰正面单人照，前端会压缩后上传。</p></div>`}
    </label>
    <button class="primary-btn" data-action="uploadNext">${state.upload ? "继续" : "上传并继续"}</button>
  `);
}

function renderConfirm() {
  return pageShell(`
    <section class="card"><h2>确认照片</h2><p class="subtitle">请确认人像清晰、无遮挡。失败或超时不会扣次数。</p></section>
    <div class="upload-box">${state.uploadDataUrl ? `<img src="${state.uploadDataUrl}" alt="确认照片" />` : "暂无图片"}</div>
    <button class="primary-btn" data-route="agreement">确认使用这张照片</button>
    <button class="secondary-btn" data-route="upload">重新选择</button>
  `);
}

function renderAgreement() {
  return pageShell(`
    <section class="card">
      <h2>授权与合规确认</h2>
      <p class="subtitle">我确认上传本人或已获得授权的人像照片，并同意图片仅用于本次 AI 生成与必要安全审核。</p>
    </section>
    <section class="card legal">
      <p>禁止上传色情、暴力、政治敏感、侵犯他人肖像权或未经授权的照片。用户可在“我的”页面删除作品或注销账号。</p>
      <p>AI 生成可能存在轻微五官偏差。生成失败、超时或内容拦截不会扣减生成次数。</p>
    </section>
    <button class="primary-btn" data-action="createTask">同意并开始生成</button>
  `);
}

function renderGenerating() {
  const task = state.task || { progress: 0, images: [], status: "QUEUED" };
  return pageShell(`
    <section class="card">
      <h2>AI 正在绘制</h2>
      <p class="subtitle">${task.status} · ${task.progress || 0}%</p>
      <div class="progress-track"><div style="width:${task.progress || 0}%"></div></div>
    </section>
    <section class="step-list">
      ${task.images.map((image) => `<div class="step"><span>${styleName(image.style)}</span><span class="status ${image.status}">${image.status}</span></div>`).join("")}
    </section>
    <button class="secondary-btn" data-route="result">查看当前结果</button>
  `);
}

function renderResult() {
  const images = state.task?.images || [];
  return pageShell(`
    <section class="card row"><div><h2>生成结果</h2><p class="subtitle">${state.task?.status || "暂无任务"}</p></div>${creditBadge()}</section>
    <section class="result-grid">
      ${images.map((image) => `<button class="result-card" data-preview="${image.url || ""}" type="button">
        <div class="result-thumb">${image.url ? `<img src="${image.url}" alt="${styleName(image.style)}" />` : image.status}</div>
        <strong>${styleName(image.style)}</strong>
        <div class="muted">${image.errorMessage || image.status}</div>
      </button>`).join("") || styles.map((style) => `<div class="result-card"><div class="result-thumb">${style.icon}</div><strong>${style.name}</strong><div class="muted">等待生成</div></div>`).join("")}
    </section>
    <button class="primary-btn" data-route="sharePoster">生成分享海报</button>
    <button class="secondary-btn" data-route="upload">再次制作</button>
  `);
}

function renderPreview() {
  return pageShell(`
    <div class="preview-panel">${state.previewImage ? `<img class="preview-image" src="${state.previewImage}" alt="预览" />` : ""}</div>
    <button class="primary-btn" data-route="saveSuccess">保存到相册</button>
    <button class="secondary-btn" data-route="sharePoster">分享给好友</button>
  `);
}

function renderSaveSuccess() {
  return pageShell(`
    <section class="card" style="text-align:center;padding:40px 18px">
      <div class="chip-icon" style="margin:0 auto 16px">✓</div>
      <h2>保存成功</h2>
      <p class="subtitle">作品已准备好用于头像、朋友圈或分享海报。</p>
    </section>
    <button class="primary-btn" data-route="sharePoster">制作分享海报</button>
    <button class="secondary-btn" data-route="home">返回首页</button>
  `);
}

function renderSharePoster() {
  const image = state.previewImage || state.task?.images?.find((item) => item.url)?.url || "";
  return pageShell(`
    <section class="card poster">
      <h2>分享海报</h2>
      <p class="subtitle">邀请好友一起制作，后续可接入分享奖励。</p>
      <div class="result-thumb" style="margin-top:14px">${image ? `<img src="${image}" alt="分享图" />` : "AI影像写真馆"}</div>
    </section>
    <button class="primary-btn" data-action="shareReward">分享给好友</button>
  `);
}

function renderPurchase() {
  return pageShell(`
    <section class="card row"><div><h2>购买次数</h2><p class="subtitle">虚拟商品支付需先确认微信类目和 iOS 合规。</p></div>${creditBadge()}</section>
    <section class="package-grid">
      ${state.packages.map((pkg) => `<button class="package-card" data-package="${pkg.packageId}" type="button"><strong>${pkg.name}</strong><h2>¥${pkg.priceFen / 100}</h2><div class="muted">${pkg.credits} 次生成</div></button>`).join("")}
    </section>
  `);
}

function renderAdReward() {
  return pageShell(`
    <section class="card">
      <h2>看广告得次数</h2>
      <p class="subtitle">完整播放激励视频后增加 1 次，每日最多 5 次。</p>
      ${creditBadge()}
    </section>
    <button class="primary-btn" data-action="rewardAd">模拟完整播放广告</button>
  `);
}

function renderProfile() {
  return pageShell(`
    <section class="card row">
      <div><h2>${state.user?.nickname || "写真体验官"}</h2><p class="subtitle">微信小程序用户</p></div>
      ${creditBadge()}
    </section>
    <section class="menu-grid">
      <button class="menu-card" data-route="purchase">购买次数</button>
      <button class="menu-card" data-route="orders">订单记录</button>
      <button class="menu-card" data-route="faq">常见问题</button>
      <button class="menu-card" data-route="legal">隐私协议</button>
    </section>
    <button class="danger-btn" data-action="deleteUser">注销账号</button>
  `);
}

function renderOrders() {
  return pageShell(`
    <section class="card"><h2>订单记录</h2><p class="subtitle">支付成功后由后端回调发放 paid 次数。</p></section>
    <section class="step-list">
      ${state.orders.map((order) => `<div class="step"><span>${order.orderNo}<br><small>${order.packageId}</small></span><span class="status">${order.status}</span></div>`).join("") || `<div class="card muted">暂无订单</div>`}
    </section>
  `);
}

function renderFaq() {
  return pageShell(`
    <section class="card"><h3>生成失败会扣次数吗？</h3><p class="subtitle">不会。只有四张图全部成功后才扣 1 次。</p></section>
    <section class="card"><h3>照片会被保存吗？</h3><p class="subtitle">MVP 后端仅为生成任务短期保存，正式版需接入 COS 生命周期和用户删除。</p></section>
    <section class="card"><h3>为什么生成较慢？</h3><p class="subtitle">四风格会调用 KL API image2 多次，弱网或模型排队时可能更久。</p></section>
  `);
}

function renderLegal() {
  return pageShell(`
    <section class="card legal">
      <h2>隐私政策与用户协议</h2>
      <p>1. 你需要确保上传图片拥有合法授权，不侵犯他人肖像权、隐私权或知识产权。</p>
      <p>2. 平台禁止生成色情、暴力、政治敏感、歧视、未成年人不当内容。</p>
      <p>3. 图片仅用于 AI 生成、内容安全和必要的问题排查。正式上线需明确留存周期、删除机制和第三方处理方。</p>
      <p>4. 虚拟商品支付能力受微信平台类目、端侧和政策限制，购买前以实际开通能力为准。</p>
    </section>
  `);
}

function styleName(id) {
  return styles.find((style) => style.id === id)?.name || id;
}

const renderers = {
  splash: renderSplash,
  home: renderHome,
  style: renderStyle,
  upload: renderUpload,
  confirm: renderConfirm,
  agreement: renderAgreement,
  generating: renderGenerating,
  result: renderResult,
  preview: renderPreview,
  saveSuccess: renderSaveSuccess,
  sharePoster: renderSharePoster,
  purchase: renderPurchase,
  adReward: renderAdReward,
  profile: renderProfile,
  orders: renderOrders,
  faq: renderFaq,
  legal: renderLegal
};

function render() {
  els.title.textContent = routes[state.route] || "AI影像写真馆";
  els.screen.innerHTML = renderers[state.route]();
  els.tabbar.style.display = ["splash", "generating", "preview"].includes(state.route) ? "none" : "grid";
  els.tabbar.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.route === state.route));
  bindScreen();
}

function bindScreen() {
  els.screen.querySelectorAll("[data-route]").forEach((node) => node.addEventListener("click", () => go(node.dataset.route)));
  els.screen.querySelectorAll("[data-style]").forEach((node) => node.addEventListener("click", () => toggleStyle(node.dataset.style)));
  els.screen.querySelectorAll("[data-preview]").forEach((node) => node.addEventListener("click", () => {
    if (!node.dataset.preview) return;
    go("preview", { previewImage: node.dataset.preview });
  }));
  els.screen.querySelectorAll("[data-package]").forEach((node) => node.addEventListener("click", () => createOrder(node.dataset.package)));
  els.screen.querySelectorAll("[data-action]").forEach((node) => node.addEventListener("click", () => actions[node.dataset.action]?.()));
  const file = els.screen.querySelector("#fileInput");
  if (file) file.addEventListener("change", handleFile);
}

function toggleStyle(styleId) {
  if (state.selectedStyles.includes(styleId)) {
    state.selectedStyles = state.selectedStyles.filter((id) => id !== styleId);
  } else {
    state.selectedStyles.push(styleId);
  }
  if (!state.selectedStyles.length) state.selectedStyles = [styleId];
  render();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function compress(file) {
  const dataUrl = await readFile(file);
  const img = await loadImage(dataUrl);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  let quality = 0.9;
  let output = canvas.toDataURL("image/jpeg", quality);
  while (output.length > 2.7 * 1024 * 1024 && quality > 0.56) {
    quality -= 0.08;
    output = canvas.toDataURL("image/jpeg", quality);
  }
  return { dataUrl: output, width: canvas.width, height: canvas.height, sizeBytes: Math.round(output.length * 0.75) };
}

async function handleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const image = await compress(file);
  state.uploadDataUrl = image.dataUrl;
  state.upload = await api("/upload/image", { method: "POST", body: image });
  render();
}

async function refreshCredits() {
  state.credits = await api("/credits");
}

const actions = {
  start: () => go("home"),
  goUpload: () => go("style"),
  uploadNext: async () => {
    if (!state.upload) return;
    await api("/upload/validate", { method: "POST", body: { imageId: state.upload.imageId } });
    go("confirm");
  },
  createTask: async () => {
    state.task = await api("/generation/create", {
      method: "POST",
      body: {
        inputImageId: state.upload.imageId,
        styles: state.selectedStyles,
        size: "1024x1024"
      }
    });
    go("generating");
    pollTask();
  },
  rewardAd: async () => {
    const result = await api("/credits/reward-ad", {
      method: "POST",
      body: { adUnitId: "mock_ad", adEventId: `ad_${Date.now()}`, completed: true }
    });
    state.credits = result.credits;
    go("home");
  },
  shareReward: async () => {
    await api("/share/reward", { method: "POST", body: { shareCode: `share_${Date.now()}` } });
    go("home");
  },
  deleteUser: async () => {
    await api("/user/delete", { method: "POST", body: { confirm: true } });
    localStorage.removeItem("mvp.token");
    location.reload();
  }
};

async function createOrder(packageId) {
  const data = await api("/orders", { method: "POST", body: { packageId } });
  await api("/payment/wechat/notify", { method: "POST", body: { orderId: data.order.orderId } });
  await refreshCredits();
  state.orders = (await api("/orders")).items;
  go("orders");
}

async function pollTask() {
  if (!state.task?.taskId) return;
  const next = await api(`/generation/${state.task.taskId}`);
  state.task = next;
  render();
  if (!["SUCCESS", "FAILED", "PARTIAL_SUCCESS", "TIMEOUT", "CANCELLED"].includes(next.status)) {
    setTimeout(pollTask, 1200);
  } else {
    await refreshCredits();
    setTimeout(() => go("result"), 600);
  }
}

els.back.addEventListener("click", back);
els.tabbar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-route]");
  if (button) go(button.dataset.route);
});
els.debugToggle.addEventListener("click", () => els.debugPanel.classList.add("open"));
els.closeDebug.addEventListener("click", () => els.debugPanel.classList.remove("open"));

await bootstrap();
render();
log({ ready: true, pages: Object.keys(routes).length, figmaFile: "iKflxgQqoyvdKA1QkmRiEW" });
