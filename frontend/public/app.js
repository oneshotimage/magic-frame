const defaultModels = [
  { id: "liblib", name: "Liblib", modelId: "liblib", endpoint: "/v1/images/generations", adapter: "template-json", enabled: false, cost: 0.1, note: "KL 返回过 liblib 无可用渠道；请按 Apifox 实际 Liblib endpoint/model id 修改后再测。" },
  { id: "jimeng", name: "即梦 Seedream", modelId: "seedream-4-0-250828", endpoint: "/v1/images/generations", adapter: "openai-json", enabled: false, cost: 0.1 },
  { id: "volc-jimeng", name: "即梦官方 Volcengine", modelId: "jimeng_high_aes_general_v40", endpoint: "visual.volcengineapi.com", adapter: "volc-jimeng", enabled: false, cost: 0.1, note: "火山官方异步接口：CVSync2AsyncSubmitTask / CVSync2AsyncGetResult，需要 AccessKeyID/SecretAccessKey。" },
  { id: "gpt-image-2", name: "GPT Image 2", modelId: "gpt-image-2", endpoint: "/v1/images/generations", adapter: "openai-image-json", enabled: true, cost: 0.25, note: "默认使用 /v1/images/generations JSON；/v1/images/edits 已确认 KL 强制要求 multipart/form-data。" },
  { id: "nano-banana", name: "Nano Banana", modelId: "fal-ai/nano-banana/edit", endpoint: "/fal-ai/nano-banana/edit", adapter: "fal-queue", enabled: false, cost: 0.18 }
];

const defaultStyles = [
  {
    id: "pixar",
    name: "3D皮克斯卡通",
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为高质量3D动画电影角色。风格为柔和立体、干净皮肤、明亮眼睛、精致布光、温暖色彩，适合微信头像和亲子写真。不要改变人物性别、年龄、发型主体和服装主体，不要增加多余人物，不要出现文字、水印、畸形五官。"
  },
  {
    id: "realistic",
    name: "高级写实插画",
    enabled: false,
    prompt: "保留上传照片中人物的身份特征、脸型、五官比例、发型、表情和姿态，将人物重绘为高级写实插画写真。画面需要自然肤色、电影级光影、精致细节、干净背景、轻微艺术化但接近真人，适合朋友圈精美配图。不要过度磨皮，不要改变人物身份，不要出现文字、水印、畸形手指或五官。"
  },
  {
    id: "handdrawn",
    name: "文艺手绘质感",
    enabled: false,
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为温柔文艺手绘写真。风格为柔和线条、纸张纹理、淡雅配色、治愈氛围、轻插画质感，适合头像和日常分享。不要改变人物身份、年龄、性别，不要增加文字、水印或多余人物。"
  },
  {
    id: "comic",
    name: "潮流涂鸦漫画",
    enabled: false,
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为潮流街头漫画风格。风格为清晰轮廓、漫画分镜质感、适度涂鸦元素、强对比但不脏乱，适合年轻用户头像和社交分享。不要改变人物身份，不要生成品牌logo、文字、水印、畸形五官或多余人物。"
  }
];

const state = {
  models: structuredClone(defaultModels),
  styles: structuredClone(defaultStyles).map((style, index) => ({ ...style, enabled: style.enabled ?? index === 0 })),
  samples: [],
  rows: [],
  debugLogs: [],
  activeTimer: null,
  running: false
};

const els = {
  realMode: document.querySelector("#realMode"),
  apiStatus: document.querySelector("#apiStatus"),
  baseUrl: document.querySelector("#baseUrl"),
  apiKey: document.querySelector("#apiKey"),
  imageSize: document.querySelector("#imageSize"),
  imageUrl: document.querySelector("#imageUrl"),
  proxyUrl: document.querySelector("#proxyUrl"),
  volcAccessKeyId: document.querySelector("#volcAccessKeyId"),
  volcSecretAccessKey: document.querySelector("#volcSecretAccessKey"),
  payloadTemplate: document.querySelector("#payloadTemplate"),
  modelList: document.querySelector("#modelList"),
  styleList: document.querySelector("#styleList"),
  sampleInput: document.querySelector("#sampleInput"),
  sampleGrid: document.querySelector("#sampleGrid"),
  runTests: document.querySelector("#runTests"),
  exportCsv: document.querySelector("#exportCsv"),
  clearSamples: document.querySelector("#clearSamples"),
  selectAllModels: document.querySelector("#selectAllModels"),
  presetKl: document.querySelector("#presetKl"),
  resetPrompts: document.querySelector("#resetPrompts"),
  queueBody: document.querySelector("#queueBody"),
  gallery: document.querySelector("#gallery"),
  queueHint: document.querySelector("#queueHint"),
  debugList: document.querySelector("#debugList"),
  copyDebug: document.querySelector("#copyDebug"),
  clearDebug: document.querySelector("#clearDebug"),
  runDiagnostics: document.querySelector("#runDiagnostics"),
  metricTotal: document.querySelector("#metricTotal"),
  metricSuccess: document.querySelector("#metricSuccess"),
  metricWithin: document.querySelector("#metricWithin"),
  metricP95: document.querySelector("#metricP95"),
  metricCost: document.querySelector("#metricCost"),
  progressTitle: document.querySelector("#progressTitle"),
  progressDetail: document.querySelector("#progressDetail"),
  progressFill: document.querySelector("#progressFill"),
  progressCount: document.querySelector("#progressCount"),
  progressPercent: document.querySelector("#progressPercent")
};

function renderModels() {
  els.modelList.innerHTML = state.models.map((model) => `
    <div class="model-card" data-model="${model.id}">
      <div class="model-title">
        <label class="switch">
          <input data-field="enabled" type="checkbox" ${model.enabled ? "checked" : ""} />
          <strong>${model.name}</strong>
        </label>
        <span>¥${model.cost.toFixed(2)}/图</span>
      </div>
      ${model.note ? `<div class="model-note">${escapeHtml(model.note)}</div>` : ""}
      <div class="compact-field">
        <label>KL model id</label>
        <input data-field="modelId" value="${escapeHtml(model.modelId)}" />
      </div>
      <div class="compact-field">
        <label>适配器</label>
        <select data-field="adapter">
          ${["openai-image-json", "openai-json", "openai-edit-json", "openai-edit", "fal-queue", "volc-jimeng", "template-json"].map((adapter) => `<option value="${adapter}" ${model.adapter === adapter ? "selected" : ""}>${adapter}</option>`).join("")}
        </select>
      </div>
      <div class="compact-field">
        <label>Endpoint path</label>
        <input data-field="endpoint" value="${escapeHtml(model.endpoint)}" />
      </div>
    </div>
  `).join("");

  els.modelList.querySelectorAll(".model-card").forEach((card) => {
    const model = state.models.find((item) => item.id === card.dataset.model);
    card.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        model[field] = input.type === "checkbox" ? input.checked : input.value;
      });
    });
  });
}

function renderStyles() {
  els.styleList.innerHTML = state.styles.map((style) => `
    <div class="style-card" data-style="${style.id}">
      <div class="style-title">
        <label class="switch">
          <input data-field="enabled" type="checkbox" ${style.enabled ? "checked" : ""} />
          <strong>${style.name}</strong>
        </label>
        <span>${style.prompt.length} 字</span>
      </div>
      <div class="compact-field">
        <label>Prompt</label>
        <textarea data-field="prompt">${escapeHtml(style.prompt)}</textarea>
      </div>
    </div>
  `).join("");

  els.styleList.querySelectorAll(".style-card").forEach((card) => {
    const style = state.styles.find((item) => item.id === card.dataset.style);
    card.querySelectorAll("input, textarea").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        style[field] = input.type === "checkbox" ? input.checked : input.value;
      });
    });
  });
}

function renderSamples() {
  if (!state.samples.length) {
    els.sampleGrid.innerHTML = `
      <div class="sample-card">
        <div class="result-image">暂无样本<br />选择图片后开始测试</div>
      </div>
    `;
    return;
  }

  els.sampleGrid.innerHTML = state.samples.map((sample) => `
    <div class="sample-card" data-sample="${sample.id}">
      <img src="${sample.dataUrl}" alt="${escapeHtml(sample.name)}" />
      <div class="sample-meta">
        <input data-field="name" value="${escapeHtml(sample.name)}" />
        <select class="sample-tag" data-field="tag">
          ${["正面人像", "弱光", "遮挡", "多人脸", "非人像", "模糊"].map((tag) => `<option ${sample.tag === tag ? "selected" : ""}>${tag}</option>`).join("")}
        </select>
      </div>
    </div>
  `).join("");

  els.sampleGrid.querySelectorAll(".sample-card").forEach((card) => {
    const sample = state.samples.find((item) => item.id === card.dataset.sample);
    card.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", () => {
        sample[input.dataset.field] = input.value;
      });
    });
  });
}

function renderQueue() {
  els.queueBody.innerHTML = state.rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.sampleName)}</td>
      <td>${escapeHtml(row.modelName)}</td>
      <td>${escapeHtml(row.styleName)}</td>
      <td><span class="status ${row.status}">${statusText(row.status)}</span></td>
      <td>${row.elapsedMs ? `${row.elapsedMs}ms` : "-"}</td>
      <td>${row.charged ? `¥${row.cost.toFixed(2)}` : "-"}</td>
      <td title="${escapeHtml(row.error || "")}">${row.score ? row.score.toFixed(1) : row.error ? "查看提示" : "-"}</td>
    </tr>
  `).join("");

  const successful = state.rows.filter((row) => row.status === "success");
  els.gallery.innerHTML = successful.slice(-24).reverse().map((row) => `
    <div class="result-card">
      <div class="result-image">
        ${renderOutputImage(row)}
      </div>
      <div class="result-meta">
        <strong>${escapeHtml(row.sampleName)}</strong>
        <span>${escapeHtml(row.modelName)} · ${escapeHtml(row.styleName)} · ${row.elapsedMs}ms</span>
      </div>
    </div>
  `).join("");

  updateMetrics();
}

function updateMetrics() {
  const total = state.rows.length;
  const success = state.rows.filter((row) => row.status === "success");
  const completed = state.rows.filter((row) => ["success", "failed"].includes(row.status));
  const within = success.filter((row) => row.elapsedMs <= 15000);
  const latencies = success.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null;
  const cost = success.reduce((sum, row) => sum + row.cost, 0);

  els.metricTotal.textContent = String(total);
  els.metricSuccess.textContent = completed.length ? `${Math.round((success.length / completed.length) * 100)}%` : "-";
  els.metricWithin.textContent = success.length ? `${Math.round((within.length / success.length) * 100)}%` : "-";
  els.metricP95.textContent = p95 ? `${p95}ms` : "-";
  els.metricCost.textContent = `¥${cost.toFixed(2)}`;
  els.queueHint.textContent = state.running ? "运行中" : completed.length ? `已完成 ${completed.length}/${total}` : "等待运行";
  updateProgress(total, completed.length);
}

function updateProgress(total = state.rows.length, completedCount = state.rows.filter((row) => ["success", "failed"].includes(row.status)).length) {
  const running = state.rows.find((row) => row.status === "running");
  const percent = total ? Math.round((completedCount / total) * 100) : 0;

  els.progressFill.style.width = `${percent}%`;
  els.progressCount.textContent = `${completedCount} / ${total}`;
  els.progressPercent.textContent = `${percent}%`;

  if (running) {
    els.progressTitle.textContent = "正在生成";
    const elapsedText = running.startedAt ? ` · 已等待 ${formatDuration(Date.now() - running.startedAt)}` : "";
    const phaseText = running.progressNote ? ` · ${running.progressNote}` : "";
    els.progressDetail.textContent = `${running.sampleName} · ${running.modelName} · ${running.styleName}${elapsedText}${phaseText}`;
  } else if (state.running) {
    els.progressTitle.textContent = "准备下一个任务";
    els.progressDetail.textContent = "队列正在继续执行。";
  } else if (total && completedCount === total) {
    els.progressTitle.textContent = "测试完成";
    els.progressDetail.textContent = `已完成 ${completedCount} 个任务，可查看结果和导出 CSV。`;
  } else {
    els.progressTitle.textContent = "等待运行";
    els.progressDetail.textContent = "选择样本、模型和风格后点击运行测试。";
  }
}

function startProgressTicker() {
  stopProgressTicker();
  state.activeTimer = setInterval(() => {
    updateProgress();
  }, 1000);
}

function stopProgressTicker() {
  if (state.activeTimer) {
    clearInterval(state.activeTimer);
    state.activeTimer = null;
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderDebugLogs() {
  if (!state.debugLogs.length) {
    els.debugList.innerHTML = `<div class="debug-empty">真实请求后会显示每条响应的字段结构、图片提取状态和响应摘要。</div>`;
    return;
  }

  els.debugList.innerHTML = state.debugLogs.slice().reverse().map((log) => `
    <div class="debug-item" data-debug="${log.id}">
      <button class="debug-summary" type="button">
        <div>
          <strong>${escapeHtml(log.modelName)} · ${escapeHtml(log.styleName)}</strong>
          <span>${escapeHtml(log.sampleName)} · ${escapeHtml(log.mode || "-")} · ${log.elapsedMs || "-"}ms · ${escapeHtml(log.endpoint || "")}</span>
        </div>
        <div class="debug-badges">
          <span class="debug-badge ${log.httpOk ? "ok" : "warn"}">HTTP ${log.httpStatus || "-"}</span>
          <span class="debug-badge ${log.appOk ? "ok" : "warn"}">ok=${String(log.appOk)}</span>
          <span class="debug-badge ${log.hasImage ? "ok" : "warn"}">${log.hasImage ? "已提取图片" : "未提取图片"}</span>
        </div>
      </button>
      <div class="debug-body">
        <div class="debug-kv"><span>适配器</span><code>${escapeHtml(log.adapter || "")}</code></div>
        <div class="debug-kv"><span>图片 URL</span><code>${escapeHtml(log.outputUrl || "-")}</code></div>
        <div class="debug-kv"><span>Base64 输出</span><code>${log.hasBase64 ? "yes" : "no"}</code></div>
        <div class="debug-kv"><span>响应字段</span><code>${escapeHtml(JSON.stringify(log.responseShape || {}))}</code></div>
        <div class="debug-kv"><span>提示</span><code>${escapeHtml(log.error || "-")}</code></div>
        <pre>${escapeHtml(log.responseSummary || "")}</pre>
      </div>
    </div>
  `).join("");

  els.debugList.querySelectorAll(".debug-summary").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".debug-item")?.classList.toggle("open");
    });
  });
}

function addDebugLog(row, result, response) {
  const output = extractImageOutput(result?.data);
  const log = {
    id: crypto.randomUUID(),
    sampleName: row.sampleName,
    modelName: row.modelName,
    styleName: row.styleName,
    mode: result?.mode || (els.realMode.checked ? "real" : "mock"),
    adapter: row.adapter,
    endpoint: row.endpoint,
    elapsedMs: row.elapsedMs,
    httpStatus: response?.status,
    httpOk: Boolean(response?.ok),
    appOk: Boolean(result?.ok),
    outputUrl: result?.outputUrl || output.url || "",
    hasBase64: Boolean(result?.dataUrl || output.dataUrl),
    hasImage: Boolean(result?.outputUrl || result?.dataUrl || output.url || output.dataUrl),
    responseShape: result?.debug?.responseShape || shapeOf(result?.data),
    responseSummary: result?.responseSummary || summarizeResponse(result?.data || result),
    error: result?.errorDetail
      ? `${result?.error || ""} ${JSON.stringify(result.errorDetail)}`
      : result?.error || row.error || ""
  };
  state.debugLogs.push(log);
  renderDebugLogs();
}

function addSystemDebugLog(message, extra = {}) {
  state.debugLogs.push({
    id: crypto.randomUUID(),
    sampleName: "system",
    modelName: "运行状态",
    styleName: message,
    mode: els.realMode.checked ? "real" : "mock",
    adapter: "-",
    endpoint: "-",
    elapsedMs: 0,
    httpStatus: "-",
    httpOk: true,
    appOk: true,
    outputUrl: "",
    hasBase64: false,
    hasImage: false,
    responseShape: {},
    responseSummary: JSON.stringify(extra, null, 2),
    error: message
  });
  renderDebugLogs();
}

function addRequestStartLog(row) {
  state.debugLogs.push({
    id: crypto.randomUUID(),
    sampleName: row.sampleName,
    modelName: row.modelName,
    styleName: `${row.styleName} · 请求已发出`,
    mode: "real",
    adapter: row.adapter,
    endpoint: row.endpoint,
    elapsedMs: 0,
    httpStatus: "pending",
    httpOk: true,
    appOk: true,
    outputUrl: "",
    hasBase64: false,
    hasImage: false,
    responseShape: {},
    responseSummary: JSON.stringify({
      baseUrl: els.baseUrl.value.trim(),
      endpoint: row.endpoint,
      adapter: row.adapter,
      modelId: row.modelId,
      proxyUrl: els.proxyUrl.value.trim(),
      note: row.adapter === "openai-image-json"
        ? "GPT Image 2 使用 /v1/images/generations JSON 请求，不走 form-data。"
        : row.adapter === "openai-edit-json"
        ? "GPT Image 2 的 /v1/images/edits 已确认要求 multipart/form-data；如选择此适配器会失败。"
        : row.adapter === "openai-edit"
        ? "GPT Image 2 使用 multipart 图片编辑，请等待返回；如长时间无完成日志，优先测试即梦/Nano Banana 或改用公开图片 URL。"
        : row.adapter === "volc-jimeng"
        ? "火山即梦官方接口为异步任务，后端会提交任务并轮询结果。"
        : ""
    }, null, 2),
    error: "请求已发出，等待 KL 返回"
  });
  renderDebugLogs();
}

async function readFiles(files) {
  const loaded = await Promise.all(Array.from(files).map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      tag: "正面人像",
      size: file.size,
      dataUrl: reader.result
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })));
  state.samples.push(...loaded);
  renderSamples();
}

function buildRows() {
  const models = state.models.filter((model) => model.enabled);
  const styles = state.styles.filter((style) => style.enabled);
  const samples = state.samples.length ? state.samples : [{
    id: "demo",
    name: "demo_sample",
    tag: "正面人像",
    size: 0,
    dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='512' height='512'%3E%3Crect width='512' height='512' fill='%23e6f0ef'/%3E%3Ccircle cx='256' cy='210' r='76' fill='%230f8f86' opacity='.35'/%3E%3Crect x='140' y='310' width='232' height='92' rx='46' fill='%23e9644f' opacity='.28'/%3E%3C/svg%3E"
  }];

  return samples.flatMap((sample) => models.flatMap((model) => styles.map((style) => ({
    id: crypto.randomUUID(),
    sampleId: sample.id,
    sampleName: sample.name,
    sampleTag: sample.tag,
    inputSizeKb: Math.round((sample.size || 0) / 1024),
    image: sample.dataUrl,
    modelId: model.modelId,
    modelName: model.name,
    endpoint: model.endpoint,
    styleId: style.id,
    styleName: style.name,
    prompt: style.prompt,
    adapter: model.adapter,
    status: "pending",
    elapsedMs: 0,
    charged: false,
    cost: model.cost,
    score: null,
    error: "",
    outputUrl: "",
    outputDataUrl: "",
    responseSummary: ""
  }))));
}

async function runTests() {
  if (state.running) return;
  if (els.realMode.checked && state.samples.length === 0 && !els.imageUrl.value.trim()) {
    state.debugLogs = [];
    addSystemDebugLog("真实请求缺少输入图片", {
      message: "GPT Image 2 / 即梦图生图测试需要上传一张真实人像样本，或填写公开图片 URL。当前 demo_sample 仅用于模拟模式。"
    });
    return;
  }
  state.rows = buildRows();
  state.debugLogs = [];
  state.running = true;
  els.runTests.disabled = true;
  startProgressTicker();
  addSystemDebugLog(els.realMode.checked ? "真实请求模式已启动" : "模拟模式已启动：不会调用 KL API，也不会产生真实图片", {
    realMode: els.realMode.checked,
    selectedModels: state.models.filter((model) => model.enabled).map((model) => ({
      name: model.name,
      adapter: model.adapter,
      endpoint: model.endpoint,
      modelId: model.modelId
    })),
    samples: state.samples.length,
    styles: state.styles.filter((style) => style.enabled).map((style) => style.name)
  });
  renderQueue();

  for (const row of state.rows) {
    row.status = "running";
    row.startedAt = Date.now();
    row.progressNote = ["fal-queue", "volc-jimeng"].includes(row.adapter) ? "轮询任务状态" : "同步请求等待响应";
    renderQueue();
    updateProgress();

    try {
      if (els.realMode.checked) {
        await runRealRequest(row);
      } else {
        await runMockRequest(row);
      }
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
      row.elapsedMs = row.elapsedMs || 0;
      row.charged = false;
    }
    renderQueue();
  }

  state.running = false;
  els.runTests.disabled = false;
  stopProgressTicker();
  renderQueue();
}

async function runMockRequest(row) {
  const started = performance.now();
  const delay = 900 + Math.round(Math.random() * 2300);
  await new Promise((resolve) => setTimeout(resolve, delay));
  row.elapsedMs = Math.round(performance.now() - started);

  const abnormal = ["多人脸", "非人像", "模糊"].includes(row.sampleTag);
  const fail = abnormal ? Math.random() < 0.65 : Math.random() < 0.04;
  if (fail) {
    row.status = "failed";
    row.error = abnormal ? "前置人脸校验未通过" : "模拟接口失败";
    row.charged = false;
    addDebugLog(row, {
      ok: false,
      mode: "mock",
      error: row.error,
      data: { message: row.error, sampleTag: row.sampleTag },
      responseSummary: JSON.stringify({ mode: "mock", message: row.error, sampleTag: row.sampleTag })
    }, { ok: true, status: "mock" });
    return;
  }

  row.status = "success";
  row.charged = true;
  row.score = Number((3.8 + Math.random() * 1.1).toFixed(1));
  row.outputUrl = "";
  row.outputDataUrl = "";
  addDebugLog(row, {
    ok: true,
    mode: "mock",
    data: { message: "模拟成功，不会返回真实图片。请打开“真实请求”后再运行 KL API。", sampleTag: row.sampleTag },
    responseSummary: JSON.stringify({ mode: "mock", message: "模拟成功，不会返回真实图片。请打开真实请求。" })
  }, { ok: true, status: "mock" });
}

async function runRealRequest(row) {
  addRequestStartLog(row);
  const started = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let response;
  let result;
  try {
    response = await fetch("/api/run-model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      adapter: row.adapter,
      baseUrl: els.baseUrl.value.trim(),
      endpoint: row.endpoint,
      token: els.apiKey.value.trim(),
      modelId: row.modelId,
      prompt: row.prompt,
      image: row.image,
      imageUrl: els.imageUrl.value.trim(),
      proxyUrl: els.proxyUrl.value.trim(),
      volcAccessKeyId: els.volcAccessKeyId.value.trim(),
      volcSecretAccessKey: els.volcSecretAccessKey.value.trim(),
      sampleName: row.sampleName,
      styleName: row.styleName,
      size: els.imageSize.value,
      payloadTemplate: els.payloadTemplate.value,
      maxWaitMs: 10 * 60 * 1000
    })
  });
    result = await response.json();
  } catch (error) {
    row.elapsedMs = Math.round(performance.now() - started);
    row.status = "failed";
    row.error = error.name === "AbortError" ? "本地等待超过 10 分钟，请检查 KL 是否仍在处理或适配器是否卡住" : error.message || String(error);
    row.charged = false;
    addDebugLog(row, {
      ok: false,
      mode: "real",
      error: row.error,
      data: { clientError: row.error },
      responseSummary: JSON.stringify({ clientError: row.error })
    }, { ok: false, status: "client" });
    return;
  } finally {
    clearTimeout(timeoutId);
  }
  row.elapsedMs = Math.round(performance.now() - started);

  if (!response.ok || !result.ok) {
    row.status = "failed";
    const providerError = result.data?.error?.message || result.data?.message || result.data?.error;
    row.error = providerError
      ? String(providerError)
      : result.errorDetail
      ? `${result.error || "请求失败"}：${result.errorDetail.code || result.errorDetail.cause?.code || result.errorDetail.message || ""}`
      : result.error || JSON.stringify(result.data || result);
    row.charged = false;
    addDebugLog(row, result, response);
    return;
  }

  row.score = null;
  row.outputUrl = result.outputUrl || extractImageOutput(result.data).url;
  row.outputDataUrl = result.dataUrl || extractImageOutput(result.data).dataUrl;
  row.responseSummary = result.responseSummary || summarizeResponse(result.data || result);

  if (!row.outputUrl && !row.outputDataUrl) {
    row.status = "failed";
    row.charged = false;
    row.error = `接口返回成功，但未找到图片字段。响应摘要：${row.responseSummary}`;
    addDebugLog(row, result, response);
    return;
  }

  row.status = "success";
  row.charged = true;
  row.error = result.requestId ? `request_id=${result.requestId}` : "";
  addDebugLog(row, result, response);
}

function fillTemplate(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => {
    return text.replaceAll(`{{${key}}}`, String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"'));
  }, template);
}

function renderOutputImage(row) {
  const src = row.outputUrl || row.outputDataUrl;
  if (src) {
    return `<img src="${src}" alt="${escapeHtml(row.modelName)} ${escapeHtml(row.styleName)}" />`;
  }
  return `${escapeHtml(row.modelName)}<br />${escapeHtml(row.styleName)}<br />模拟输出`;
}

function extractImageOutput(data) {
  const seen = new Set();
  const keyHints = /^(url|image|image_url|output|response_url|b64_json|base64|content)$/i;

  function visit(value, key = "") {
    if (value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^https?:\/\/.+/i.test(trimmed) && /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(trimmed)) return { url: trimmed, dataUrl: "" };
      if (/^data:image\/[^;]+;base64,/i.test(trimmed)) return { url: "", dataUrl: trimmed };
      const embeddedUrl = trimmed.match(/https?:\/\/[^\s"'<>\\]+/i);
      if (embeddedUrl && /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(embeddedUrl[0])) return { url: embeddedUrl[0], dataUrl: "" };
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          const found = visit(JSON.parse(trimmed), key);
          if (found) return found;
        } catch {
          // Plain text can look JSON-like; ignore parse errors.
        }
      }
      if (keyHints.test(key) && /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 500) {
        return { url: "", dataUrl: `data:image/png;base64,${trimmed.replace(/\s/g, "")}` };
      }
      return null;
    }

    if (typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, key);
        if (found) return found;
      }
      return null;
    }

    const priorityKeys = ["url", "image_url", "image", "output", "response_url", "b64_json", "base64", "images", "data", "result", "results", "output_url"];
    for (const priorityKey of priorityKeys) {
      if (priorityKey in value) {
        const found = visit(value[priorityKey], priorityKey);
        if (found) return found;
      }
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      const found = visit(childValue, childKey);
      if (found) return found;
    }
    return null;
  }

  return visit(data) || { url: "", dataUrl: "" };
}

function summarizeResponse(data) {
  try {
    return JSON.stringify(data, (key, value) => {
      if (typeof value === "string" && value.length > 240) {
        return `${value.slice(0, 240)}...<truncated:${value.length}>`;
      }
      return value;
    });
  } catch {
    return String(data);
  }
}

function shapeOf(data) {
  if (data == null || typeof data !== "object") return { type: typeof data, keys: [] };
  return {
    type: Array.isArray(data) ? "array" : "object",
    keys: Object.keys(data).slice(0, 30),
    dataKeys: data?.data && typeof data.data === "object" ? Object.keys(data.data).slice(0, 30) : [],
    resultKeys: data?.result && typeof data.result === "object" ? Object.keys(data.result).slice(0, 30) : []
  };
}

function exportCsv() {
  const headers = ["request_id", "sample", "sample_tag", "model", "model_id", "style", "status", "elapsed_ms", "within_15s", "charged", "cost", "score", "error", "output_url", "has_base64_output", "response_summary"];
  const lines = [
    headers.join(","),
    ...state.rows.map((row) => [
      row.id,
      row.sampleName,
      row.sampleTag,
      row.modelName,
      row.modelId,
      row.styleName,
      row.status,
      row.elapsedMs || "",
      row.elapsedMs ? row.elapsedMs <= 15000 : "",
      row.charged,
      row.charged ? row.cost : 0,
      row.score || "",
      row.error || "",
      row.outputUrl || "",
      Boolean(row.outputDataUrl),
      row.responseSummary || ""
    ].map(csvCell).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `model_results_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function statusText(status) {
  return {
    pending: "待测",
    running: "运行中",
    success: "成功",
    failed: "失败"
  }[status] || status;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.sampleInput.addEventListener("change", (event) => readFiles(event.target.files));
els.runTests.addEventListener("click", runTests);
els.exportCsv.addEventListener("click", exportCsv);
els.clearSamples.addEventListener("click", () => {
  state.samples = [];
  renderSamples();
});
els.selectAllModels.addEventListener("click", () => {
  const shouldEnable = state.models.some((model) => !model.enabled);
  state.models.forEach((model) => {
    model.enabled = shouldEnable;
  });
  renderModels();
});
els.presetKl.addEventListener("click", () => {
  state.models = structuredClone(defaultModels);
  els.baseUrl.value = "https://api.kl-api.info";
  renderModels();
});
els.resetPrompts.addEventListener("click", () => {
  state.styles = structuredClone(defaultStyles).map((style, index) => ({ ...style, enabled: style.enabled ?? index === 0 }));
  renderStyles();
});
els.clearDebug.addEventListener("click", () => {
  state.debugLogs = [];
  renderDebugLogs();
});
els.runDiagnostics.addEventListener("click", async () => {
  addSystemDebugLog("正在诊断 KL 网络连通性", {});
  try {
    const qs = els.proxyUrl.value.trim() ? `?proxyUrl=${encodeURIComponent(els.proxyUrl.value.trim())}` : "";
    const response = await fetch(`/api/diagnostics${qs}`);
    const result = await response.json();
    addSystemDebugLog("KL 网络诊断结果", result);
  } catch (error) {
    addSystemDebugLog("KL 网络诊断失败", { error: error.message || String(error) });
  }
});
els.copyDebug.addEventListener("click", async () => {
  const text = JSON.stringify(state.debugLogs, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    els.copyDebug.textContent = "已复制";
    setTimeout(() => {
      els.copyDebug.textContent = "复制调试信息";
    }, 1200);
  } catch {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `debug_logs_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
});
els.realMode.addEventListener("change", () => {
  els.apiStatus.textContent = els.realMode.checked ? "真实请求" : "模拟模式";
  els.apiStatus.classList.toggle("live", els.realMode.checked);
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  if (event.dataTransfer?.files?.length) {
    readFiles(event.dataTransfer.files);
  }
});

renderModels();
renderStyles();
renderSamples();
renderQueue();
renderDebugLogs();
els.apiStatus.textContent = els.realMode.checked ? "真实请求" : "模拟模式";
els.apiStatus.classList.toggle("live", els.realMode.checked);
