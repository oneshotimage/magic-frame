const STYLE_PRESETS = [
  {
    id: "pixar",
    name: "3D皮克斯卡通",
    tagline: "立体柔和，头像友好",
    prompt:
      "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为高质量3D动画电影角色。风格为柔和立体、干净皮肤、明亮眼睛、精致布光、温暖色彩，适合微信头像和亲子写真。不要改变人物性别、年龄、发型主体和服装主体，不要增加多余人物，不要出现文字、水印、畸形五官。"
  },
  {
    id: "realistic",
    name: "高级写实插画",
    tagline: "电影光影，接近真人",
    prompt:
      "保留上传照片中人物的身份特征、脸型、五官比例、发型、表情和姿态，将人物重绘为高级写实插画写真。画面需要自然肤色、电影级光影、精致细节、干净背景、轻微艺术化但接近真人，适合朋友圈精美配图。不要过度磨皮，不要改变人物身份，不要出现文字、水印、畸形手指或五官。"
  },
  {
    id: "handdrawn",
    name: "文艺手绘质感",
    tagline: "柔和线条，治愈质感",
    prompt:
      "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为温柔文艺手绘写真。风格为柔和线条、纸张纹理、淡雅配色、治愈氛围、轻插画质感，适合头像和日常分享。不要改变人物身份、年龄、性别，不要增加文字、水印或多余人物。"
  },
  {
    id: "comic",
    name: "潮流涂鸦漫画",
    tagline: "街头漫画，社交感强",
    prompt:
      "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为潮流街头漫画风格。风格为清晰轮廓、漫画分镜质感、适度涂鸦元素、强对比但不脏乱，适合年轻用户头像和社交分享。不要改变人物身份，不要生成品牌 logo、文字、水印、畸形五官或多余人物。"
  }
];

const els = {
  quota: document.querySelector("#quotaCount"),
  watchAd: document.querySelector("#watchAd"),
  token: document.querySelector("#miniToken"),
  proxy: document.querySelector("#miniProxy"),
  size: document.querySelector("#miniSize"),
  mode: document.querySelector("#miniRunMode"),
  state: document.querySelector("#configState"),
  input: document.querySelector("#portraitInput"),
  preview: document.querySelector("#portraitPreview"),
  empty: document.querySelector("#uploadEmpty"),
  reset: document.querySelector("#resetPhoto"),
  start: document.querySelector("#startCreate"),
  styleGrid: document.querySelector("#miniStyleGrid"),
  selectedStyleName: document.querySelector("#selectedStyleName"),
  progressTitle: document.querySelector("#progressTitle"),
  progressDetail: document.querySelector("#progressDetail"),
  progressFill: document.querySelector("#progressFill"),
  resultSummary: document.querySelector("#resultSummary"),
  resultGrid: document.querySelector("#resultGrid"),
  debug: document.querySelector("#miniDebug"),
  copyDebug: document.querySelector("#copyMiniDebug"),
  dialog: document.querySelector("#previewDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  dialogDownload: document.querySelector("#dialogDownload"),
  closePreview: document.querySelector("#closePreview")
};

let selectedStyle = STYLE_PRESETS[0];
let selectedImage = null;
let quota = Number(localStorage.getItem("miniapp.quota") || 3);
let debugRows = [];
let progressTimer = null;

function saveSettings() {
  localStorage.setItem("miniapp.proxy", els.proxy.value.trim());
  localStorage.setItem("miniapp.size", els.size.value);
  localStorage.setItem("miniapp.quota", String(quota));
}

function loadSettings() {
  els.proxy.value = localStorage.getItem("miniapp.proxy") || "http://127.0.0.1:7890";
  els.size.value = localStorage.getItem("miniapp.size") || "1024x1024";
  els.quota.textContent = String(quota);
}

function setDebug(row) {
  debugRows.unshift({
    time: new Date().toLocaleTimeString(),
    ...row
  });
  debugRows = debugRows.slice(0, 20);
  els.debug.textContent = JSON.stringify(debugRows, null, 2);
}

function renderStyles() {
  els.styleGrid.innerHTML = STYLE_PRESETS.map((style) => `
    <button class="miniapp-style ${style.id === selectedStyle.id ? "active" : ""}" data-style="${style.id}" type="button">
      <strong>${style.name}</strong>
      <span>${style.tagline}</span>
    </button>
  `).join("");

  els.styleGrid.querySelectorAll(".miniapp-style").forEach((button) => {
    button.addEventListener("click", () => {
      selectedStyle = STYLE_PRESETS.find((style) => style.id === button.dataset.style) || STYLE_PRESETS[0];
      els.selectedStyleName.textContent = selectedStyle.name;
      renderStyles();
    });
  });
}

function renderEmptyResults() {
  els.resultGrid.innerHTML = STYLE_PRESETS.map((style) => `
    <article class="miniapp-result-card" data-result="${style.id}">
      <div class="miniapp-result-image waiting">等待生成</div>
      <div class="miniapp-result-meta">
        <strong>${style.name}</strong>
        <span>未开始</span>
      </div>
    </article>
  `).join("");
}

function setCardState(styleId, state, detail, imageUrl = "") {
  const card = els.resultGrid.querySelector(`[data-result="${styleId}"]`);
  if (!card) return;
  const image = card.querySelector(".miniapp-result-image");
  const meta = card.querySelector(".miniapp-result-meta span");
  meta.textContent = detail;
  if (imageUrl) {
    image.className = "miniapp-result-image done";
    image.innerHTML = `<img src="${imageUrl}" alt="${state}" />`;
    card.dataset.output = imageUrl;
  } else {
    image.className = `miniapp-result-image ${state}`;
    image.textContent = detail;
  }
}

function setProgress(title, detail, percent) {
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function startSoftProgress(basePercent) {
  stopSoftProgress();
  const start = Date.now();
  progressTimer = setInterval(() => {
    const delta = Math.floor((Date.now() - start) / 1000);
    const percent = Math.min(94, basePercent + delta * 2);
    els.progressFill.style.width = `${percent}%`;
  }, 1000);
}

function stopSoftProgress() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = dataUrl;
  });
}

function canvasToDataUrl(canvas, quality) {
  return canvas.toDataURL("image/jpeg", quality);
}

async function compressImage(file) {
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let dataUrl = canvasToDataUrl(canvas, quality);
  while (dataUrl.length > 2.7 * 1024 * 1024 && quality > 0.55) {
    quality -= 0.08;
    dataUrl = canvasToDataUrl(canvas, quality);
  }

  return {
    name: file.name.replace(/\.[^.]+$/, "") || "portrait",
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    approxBytes: Math.round((dataUrl.length * 3) / 4),
    originalBytes: file.size
  };
}

function validateImage(image) {
  if (!image) return "请先选择一张照片";
  if (image.approxBytes > 3 * 1024 * 1024) return "图片压缩后仍偏大，请换一张更小的照片";
  if (Math.min(image.width, image.height) < 360) return "图片分辨率过低，请上传更清晰的人像照片";
  return "";
}

async function callImage2(style) {
  const startedAt = Date.now();
  const response = await fetch("/api/run-model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      adapter: "openai-edit",
      baseUrl: "https://api.kl-api.info",
      endpoint: "/v1/images/edits",
      token: els.token.value.trim(),
      proxyUrl: els.proxy.value.trim(),
      modelId: "gpt-image-2",
      prompt: style.prompt,
      image: selectedImage.dataUrl,
      imageUrl: "",
      sampleName: selectedImage.name,
      styleName: style.name,
      size: els.size.value,
      maxWaitMs: 10 * 60 * 1000
    })
  });
  const data = await response.json();
  return {
    httpStatus: response.status,
    httpOk: response.ok,
    elapsedMs: Date.now() - startedAt,
    output: data.outputUrl || data.dataUrl || "",
    data
  };
}

async function runGeneration() {
  const imageError = validateImage(selectedImage);
  if (imageError) {
    setProgress("无法开始", imageError, 0);
    setDebug({ ok: false, error: imageError });
    return;
  }
  if (quota <= 0) {
    setProgress("次数不足", "请先观看广告或接入微信支付购买次数包。", 0);
    setDebug({ ok: false, error: "quota_empty" });
    return;
  }

  saveSettings();
  els.start.disabled = true;
  renderEmptyResults();
  const styles = els.mode.value === "selected" ? [selectedStyle] : STYLE_PRESETS;
  let successCount = 0;
  setProgress("AI 绘制中", `准备生成 ${styles.length} 张写真`, 6);

  for (let index = 0; index < styles.length; index += 1) {
    const style = styles[index];
    const basePercent = Math.round((index / styles.length) * 86) + 8;
    setCardState(style.id, "running", "生成中");
    setProgress("AI 绘制中", `${style.name} 正在生成`, basePercent);
    startSoftProgress(basePercent);

    try {
      const result = await callImage2(style);
      stopSoftProgress();
      setDebug({
        ok: Boolean(result.output),
        style: style.name,
        httpStatus: result.httpStatus,
        elapsedMs: result.elapsedMs,
        hasOutput: Boolean(result.output),
        response: result.data
      });

      if (!result.httpOk || !result.data.ok || !result.output) {
        const message = result.data?.data?.error?.message || result.data?.error || "生成失败";
        setCardState(style.id, "failed", message);
        continue;
      }

      successCount += 1;
      setCardState(style.id, "done", `${Math.round(result.elapsedMs / 1000)} 秒`, result.output);
    } catch (error) {
      stopSoftProgress();
      setCardState(style.id, "failed", error.message || "本地请求异常");
      setDebug({ ok: false, style: style.name, error: error.message || String(error) });
    }
  }

  if (successCount > 0) {
    quota -= 1;
    els.quota.textContent = String(quota);
    saveSettings();
  }

  const doneText = successCount ? `成功 ${successCount}/${styles.length}，已扣 1 次` : "没有成功作品，未扣次数";
  els.resultSummary.textContent = doneText;
  setProgress(successCount ? "制作完成" : "制作失败", doneText, 100);
  els.start.disabled = false;
}

els.input.addEventListener("change", async () => {
  const file = els.input.files?.[0];
  if (!file) return;
  setProgress("正在处理图片", "压缩图片并生成本地预览", 8);
  try {
    selectedImage = await compressImage(file);
    els.preview.src = selectedImage.dataUrl;
    els.preview.style.display = "block";
    els.empty.style.display = "none";
    els.state.textContent = "照片已就绪";
    setProgress("照片已就绪", `${selectedImage.width}x${selectedImage.height}，约 ${Math.round(selectedImage.approxBytes / 1024)}KB`, 18);
    setDebug({ ok: true, action: "image_selected", image: { ...selectedImage, dataUrl: "<local-data-url>" } });
  } catch (error) {
    setProgress("图片处理失败", error.message || String(error), 0);
    setDebug({ ok: false, error: error.message || String(error) });
  }
});

els.reset.addEventListener("click", () => {
  selectedImage = null;
  els.input.value = "";
  els.preview.removeAttribute("src");
  els.preview.style.display = "none";
  els.empty.style.display = "grid";
  els.state.textContent = "待上传";
  renderEmptyResults();
  setProgress("等待制作", "上传照片后即可生成。", 0);
});

els.start.addEventListener("click", runGeneration);
els.watchAd.addEventListener("click", () => {
  quota += 1;
  els.quota.textContent = String(quota);
  saveSettings();
  setDebug({ ok: true, action: "reward_ad_mock", quota });
});

els.resultGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".miniapp-result-card");
  const output = card?.dataset.output;
  if (!output) return;
  els.dialogImage.src = output;
  els.dialogDownload.href = output;
  els.dialog.showModal();
});

els.closePreview.addEventListener("click", () => els.dialog.close());
els.copyDebug.addEventListener("click", () => navigator.clipboard?.writeText(els.debug.textContent));
[els.token, els.proxy, els.size].forEach((input) => input.addEventListener("change", saveSettings));

loadSettings();
renderStyles();
renderEmptyResults();
setProgress("等待制作", "上传照片后即可生成。", 0);
setDebug({ ready: true, page: "miniapp", model: "gpt-image-2", endpoint: "/v1/images/edits" });
