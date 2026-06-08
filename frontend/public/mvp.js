const figmaHero = "https://www.figma.com/api/mcp/asset/fa708f0a-c128-4fe1-92b1-0a0e00e17271";
const figmaHomeHero = "https://www.figma.com/api/mcp/asset/c4fdcd2b-7726-4e53-8591-0fb0fb3f58bd";
const figmaAvatar = "https://www.figma.com/api/mcp/asset/f35120e7-c871-445d-8c92-9cf45319050b";

const styles = [
  { id: "pixar", name: "3D皮克斯卡通", short: "3D动画", icon: "3D", text: "皮克斯质感", asset: "https://www.figma.com/api/mcp/asset/2f1ed755-8d01-427e-a0db-c184cbe60aa0" },
  { id: "realistic", name: "高级写实插画", short: "写实插画", icon: "光", text: "细节拉满", badge: "HOT", asset: "https://www.figma.com/api/mcp/asset/b2db1293-d550-467c-96be-be3332a4ca07" },
  { id: "handdrawn", name: "文艺手绘质感", short: "文艺手绘", icon: "绘", text: "温柔水彩风", asset: "https://www.figma.com/api/mcp/asset/6a745082-a2fa-4885-b515-b0089a24a87a" },
  { id: "comic", name: "潮流涂鸦漫画", short: "涂鸦漫画", icon: "漫", text: "潮酷波普", asset: "https://www.figma.com/api/mcp/asset/3b1715f7-8628-42d9-9e35-80ec23164aac" }
];

const routes = {
  splash: "妙影工坊",
  home: "妙影工坊",
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
  works: "作品集",
  orders: "订单记录",
  faq: "常见问题",
  legal: "隐私与协议",
  feedback: "意见反馈"
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
  posterUrl: "",
  packages: [],
  orders: [],
  works: [],
  currentOrder: null,
  toast: "",
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

function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      render();
    }
  }, 1800);
}

function go(route, params = {}) {
  if (state.route !== route) state.history.push(state.route);
  Object.assign(state, params, { route });
  render();
  afterRouteLoad(route);
}

async function afterRouteLoad(route) {
  try {
    if (route === "orders") {
      state.orders = (await api("/orders")).items;
    }
    if (route === "works") {
      state.works = (await api("/generation/history")).items;
    }
    if (route === "profile" || route === "home") {
      await refreshCredits();
    }
    if (state.route === route) render();
  } catch (error) {
    log({ routeLoadError: route, error });
  }
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
  return `<div class="page-stack">${state.toast ? `<div class="toast">${state.toast}</div>` : ""}${inner}</div>`;
}

function creditBadge() {
  const credits = state.credits || { totalCredits: 0 };
  return `<span class="credit-badge">剩余 ${credits.totalCredits} 次</span>`;
}

function renderSplash() {
  return `<div class="splash">
    <div class="hero-visual">
      <img src="${figmaHero}" alt="妙影工坊" onerror="this.style.display='none'" />
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
    <section class="home-hero">
      <img src="${figmaHomeHero}" alt="AI艺术写真" />
      <div class="home-hero-overlay">
        <div>
          <h1>AI艺术写真<br />一键生成</h1>
          <p>上传一张照片，遇见不同风格的自己</p>
        </div>
        ${creditBadge()}
      </div>
    </section>
    <div class="section-title"><h2>选择风格</h2><button data-route="style" type="button">查看全部</button></div>
    <section class="style-grid figma-style-grid">${styles.map(styleCard).join("")}</section>
    <button class="primary-btn" data-action="goUpload">✨ 立即制作</button>
    <button class="secondary-btn" data-route="adReward">看广告得次数</button>
  `);
}

function styleCard(style) {
  const active = state.selectedStyles.includes(style.id) ? "active" : "";
  return `<button class="style-card ${active}" data-style="${style.id}" type="button">
    <div class="style-thumb">
      <img src="${style.asset}" alt="${style.name}" />
      ${style.badge ? `<span class="hot-badge">${style.badge}</span>` : ""}
      <div class="style-gradient"><strong>${style.short}</strong><span>${style.text}</span></div>
    </div>
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
    <button class="secondary-btn" data-action="useDemoPhoto">使用演示照片</button>
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
    <button class="secondary-btn" data-action="cancelTask">取消任务</button>
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
    ${["FAILED", "PARTIAL_SUCCESS", "TIMEOUT"].includes(state.task?.status) ? `<button class="secondary-btn" data-action="retryTask">重试失败任务</button>` : ""}
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
  const image = state.posterUrl || state.previewImage || state.task?.images?.find((item) => item.url)?.url || "";
  return pageShell(`
    <section class="card poster">
      <h2>分享海报</h2>
      <p class="subtitle">邀请好友一起制作，后续可接入分享奖励。</p>
      <div class="result-thumb" style="margin-top:14px">${image ? `<img src="${image}" alt="分享图" />` : "妙影工坊"}</div>
    </section>
    <button class="secondary-btn" data-action="createPoster">生成海报</button>
    <button class="primary-btn" data-action="shareReward">分享给好友</button>
  `);
}

function renderPurchase() {
  return pageShell(`
    <section class="card row"><div><h2>购买次数</h2><p class="subtitle">虚拟商品支付需先确认微信类目和 iOS 合规。</p></div>${creditBadge()}</section>
    <section class="package-grid">
      ${state.packages.map((pkg) => `<button class="package-card" data-package="${pkg.packageId}" type="button"><strong>${pkg.name}</strong><h2>¥${pkg.priceFen / 100}</h2><div class="muted">${pkg.credits} 次生成</div></button>`).join("")}
    </section>
    ${state.currentOrder ? `<section class="card">
      <h3>待支付订单</h3>
      <p class="subtitle">${state.currentOrder.orderNo} · ${state.currentOrder.packageId} · ${state.currentOrder.status}</p>
      <button class="primary-btn" data-action="payOrder">模拟支付并发放次数</button>
      <button class="secondary-btn" data-action="closeOrder">关闭订单</button>
      <button class="secondary-btn" data-action="reconcileOrder">对账检查</button>
    </section>` : ""}
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
    <button class="secondary-btn" data-action="interruptAd">模拟中断播放</button>
  `);
}

function renderProfile() {
  return pageShell(`
    <section class="profile-card">
      <img src="${state.user?.avatar || figmaAvatar}" alt="用户头像" />
      <div><h2>${state.user?.nickname || "写真体验官"}</h2><p class="subtitle">ID: ${(state.user?.userId || "8839201").replace("wx_", "")}</p></div>
      <button class="round-tool" data-action="editProfile" type="button">✎</button>
    </section>
    <section class="credits-card">
      <div><span>当前剩余点数</span><strong>${state.credits?.totalCredits || 0}<small> 次</small></strong></div>
      <button data-route="purchase" type="button">去充值</button>
    </section>
    <p class="list-label">常用功能</p>
    <section class="list-card">
      <button data-route="orders" type="button"><span>▣</span>购买记录<b>›</b></button>
      <button data-action="openWorks" type="button"><span>↺</span>作品历史<b>›</b></button>
      <button data-route="feedback" type="button"><span>✎</span>意见反馈<b>›</b></button>
    </section>
    <p class="list-label">关于</p>
    <section class="list-card">
      <button data-route="faq" type="button"><span>?</span>常见问题<b>›</b></button>
      <button data-route="legal" type="button"><span>盾</span>隐私政策<b>›</b></button>
      <button data-route="legal" type="button"><span>文</span>用户协议<b>›</b></button>
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

function renderWorks() {
  return pageShell(`
    <section class="card"><h2>作品集</h2><p class="subtitle">展示已生成任务，点击图片可预览保存。</p></section>
    <section class="result-grid">
      ${state.works.flatMap((task) => task.images.map((image) => ({ ...image, taskStatus: task.status }))).map((image) => `<button class="result-card" data-preview="${image.url || ""}" type="button">
        <div class="result-thumb">${image.url ? `<img src="${image.url}" alt="${styleName(image.style)}" />` : image.status}</div>
        <strong>${styleName(image.style)}</strong>
        <div class="muted">${image.taskStatus}</div>
      </button>`).join("") || `<div class="card muted">暂无作品，先去制作一组写真。</div>`}
    </section>
    <button class="primary-btn" data-route="home">去制作</button>
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

function renderFeedback() {
  return pageShell(`
    <section class="card">
      <h2>意见反馈</h2>
      <p class="subtitle">遇到生成失败、支付异常或作品不满意，可以提交反馈。</p>
    </section>
    <section class="card">
      <textarea id="feedbackInput" class="feedback-input" placeholder="请描述问题，例如任务编号、失败提示或希望改进的地方"></textarea>
    </section>
    <button class="primary-btn" data-action="submitFeedback">提交反馈</button>
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
  works: renderWorks,
  orders: renderOrders,
  faq: renderFaq,
  legal: renderLegal,
  feedback: renderFeedback
};

function render() {
  els.title.textContent = routes[state.route] || "妙影工坊";
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
  useDemoPhoto: async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#FFF5E8"/><circle cx="512" cy="380" r="150" fill="#FFB800"/><circle cx="456" cy="350" r="20" fill="#222"/><circle cx="568" cy="350" r="20" fill="#222"/><path d="M440 460c54 42 120 42 160 0" fill="none" stroke="#222" stroke-width="18" stroke-linecap="round"/><text x="512" y="700" text-anchor="middle" font-family="PingFang SC, Arial" font-size="54" font-weight="700" fill="#222">演示人像</text></svg>`;
    const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    state.uploadDataUrl = dataUrl;
    state.upload = await api("/upload/image", { method: "POST", body: { dataUrl, width: 1024, height: 1024, sizeBytes: dataUrl.length } });
    toast("已载入演示照片");
  },
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
  retryTask: async () => {
    if (!state.task?.taskId) return;
    state.task = await api(`/generation/${state.task.taskId}/retry`, { method: "POST" });
    go("generating");
    pollTask();
  },
  cancelTask: async () => {
    if (!state.task?.taskId) return;
    state.task = await api(`/generation/${state.task.taskId}/cancel`, { method: "POST" });
    toast("任务已取消");
    go("result");
  },
  rewardAd: async () => {
    const result = await api("/credits/reward-ad", {
      method: "POST",
      body: { adUnitId: "mock_ad", adEventId: `ad_${Date.now()}`, completed: true }
    });
    state.credits = result.credits;
    toast("已获得 1 次生成次数");
    go("home");
  },
  interruptAd: async () => {
    const result = await api("/credits/reward-ad", {
      method: "POST",
      body: { adUnitId: "mock_ad", adEventId: `ad_${Date.now()}`, completed: false }
    });
    state.credits = result.credits;
    toast("广告未完整播放，不发放次数");
  },
  createPoster: async () => {
    const first = state.task?.images?.find((image) => image.url);
    const poster = await api("/share/create-poster", {
      method: "POST",
      body: { taskId: state.task?.taskId || "manual", imageId: first?.imageId || "preview" }
    });
    state.posterUrl = poster.posterUrl;
    toast("海报已生成");
  },
  shareReward: async () => {
    await api("/share/reward", { method: "POST", body: { shareCode: `share_${Date.now()}` } });
    toast("分享已记录");
    go("home");
  },
  openWorks: async () => {
    const history = await api("/generation/history");
    state.works = history.items;
    go("works");
  },
  editProfile: async () => {
    const nickname = window.prompt("请输入昵称", state.user?.nickname || "写真体验官");
    if (!nickname) return;
    state.user = await api("/user/profile", { method: "PATCH", body: { nickname } });
    toast("资料已更新");
  },
  submitFeedback: async () => {
    const input = document.querySelector("#feedbackInput");
    const content = input?.value?.trim();
    if (!content) {
      toast("请先填写反馈内容");
      return;
    }
    await api("/feedback", { method: "POST", body: { content, taskId: state.task?.taskId || "" } });
    toast("反馈已提交");
    go("profile");
  },
  payOrder: async () => {
    if (!state.currentOrder) return;
    await api("/payment/wechat/notify", { method: "POST", body: { orderId: state.currentOrder.orderId } });
    await refreshCredits();
    state.orders = (await api("/orders")).items;
    state.currentOrder = state.orders.find((order) => order.orderId === state.currentOrder.orderId) || state.currentOrder;
    toast("支付成功，次数已到账");
  },
  closeOrder: async () => {
    if (!state.currentOrder) return;
    await api(`/orders/${state.currentOrder.orderId}/close`, { method: "POST" });
    state.orders = (await api("/orders")).items;
    state.currentOrder = state.orders.find((order) => order.orderId === state.currentOrder.orderId) || null;
    toast("订单已关闭");
  },
  reconcileOrder: async () => {
    if (!state.currentOrder) return;
    await api("/payment/reconcile", { method: "POST", body: { orderId: state.currentOrder.orderId } });
    toast("已发起对账检查");
  },
  deleteUser: async () => {
    await api("/user/delete", { method: "POST", body: { confirm: true } });
    localStorage.removeItem("mvp.token");
    location.reload();
  }
};

async function createOrder(packageId) {
  const data = await api("/orders", { method: "POST", body: { packageId } });
  state.currentOrder = data.order;
  state.orders = (await api("/orders")).items;
  toast("订单已创建，请确认支付");
  render();
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
