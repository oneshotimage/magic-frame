const styles = [
  {
    id: "pixar",
    name: "3D皮克斯卡通",
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为高质量3D动画电影角色。风格为柔和立体、干净皮肤、明亮眼睛、精致布光、温暖色彩，适合微信头像和亲子写真。不要改变人物性别、年龄、发型主体和服装主体，不要增加多余人物，不要出现文字、水印、畸形五官。"
  },
  {
    id: "realistic",
    name: "高级写实插画",
    prompt: "保留上传照片中人物的身份特征、脸型、五官比例、发型、表情和姿态，将人物重绘为高级写实插画写真。画面需要自然肤色、电影级光影、精致细节、干净背景、轻微艺术化但接近真人，适合朋友圈精美配图。不要过度磨皮，不要改变人物身份，不要出现文字、水印、畸形手指或五官。"
  },
  {
    id: "handdrawn",
    name: "文艺手绘质感",
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为温柔文艺手绘写真。风格为柔和线条、纸张纹理、淡雅配色、治愈氛围、轻插画质感，适合头像和日常分享。不要改变人物身份、年龄、性别，不要增加文字、水印或多余人物。"
  },
  {
    id: "comic",
    name: "潮流涂鸦漫画",
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为潮流街头漫画风格。风格为清晰轮廓、漫画分镜质感、适度涂鸦元素、强对比但不脏乱，适合年轻用户头像和社交分享。不要改变人物身份，不要生成品牌 logo、文字、水印、畸形五官或多余人物。"
  }
];

const els = {
  token: document.querySelector("#styleToken"),
  imageUrl: document.querySelector("#styleImageUrl"),
  file: document.querySelector("#styleFile"),
  size: document.querySelector("#styleSize"),
  proxy: document.querySelector("#styleProxy"),
  inputPreview: document.querySelector("#styleInputPreview"),
  inputHint: document.querySelector("#styleInputHint"),
  choices: document.querySelector("#styleChoices"),
  prompt: document.querySelector("#stylePrompt"),
  run: document.querySelector("#styleRun"),
  progressTitle: document.querySelector("#styleProgressTitle"),
  progressDetail: document.querySelector("#styleProgressDetail"),
  progressFill: document.querySelector("#styleProgressFill"),
  elapsed: document.querySelector("#styleElapsed"),
  status: document.querySelector("#styleStatus"),
  outputHint: document.querySelector("#styleOutputHint"),
  outputEmpty: document.querySelector("#styleOutputEmpty"),
  outputImage: document.querySelector("#styleOutputImage"),
  history: document.querySelector("#styleHistory"),
  debug: document.querySelector("#styleDebug"),
  copyDebug: document.querySelector("#styleCopyDebug")
};

let currentStyle = styles[0];
let timer = null;
let startedAt = 0;
let lastDebug = {};
let selectedLocalImage = null;
const history = [];

function renderChoices() {
  els.choices.innerHTML = styles.map((style) => `
    <button class="style-choice ${style.id === currentStyle.id ? "active" : ""}" data-style="${style.id}" type="button">
      <strong>${style.name}</strong>
      <span>${style.prompt.slice(0, 30)}...</span>
    </button>
  `).join("");
  els.choices.querySelectorAll(".style-choice").forEach((button) => {
    button.addEventListener("click", () => {
      currentStyle = styles.find((style) => style.id === button.dataset.style);
      els.prompt.value = currentStyle.prompt;
      renderChoices();
    });
  });
}

function syncPreview() {
  if (selectedLocalImage) return;
  els.inputPreview.src = els.imageUrl.value.trim();
  els.inputHint.textContent = "URL 输入";
}

function setDebug(value) {
  lastDebug = value;
  els.debug.textContent = JSON.stringify(value, null, 2);
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function startProgress() {
  stopProgress();
  startedAt = Date.now();
  els.progressTitle.textContent = `正在生成：${currentStyle.name}`;
  els.progressDetail.textContent = "下载输入图片并提交 GPT Image 2 编辑请求";
  els.status.textContent = "running";
  els.progressFill.style.width = "10%";
  timer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    els.elapsed.textContent = formatDuration(elapsed);
    els.progressFill.style.width = `${Math.min(92, 10 + Math.floor(elapsed / 5000) * 4)}%`;
  }, 1000);
}

function stopProgress(status) {
  if (timer) clearInterval(timer);
  timer = null;
  if (status) els.status.textContent = status;
}

function extractOutput(result) {
  return result.outputUrl || result.dataUrl || "";
}

function renderHistory() {
  els.history.innerHTML = history.map((item) => `
    <div class="history-item">
      <img src="${item.url}" alt="${item.style}" />
      <div>
        <strong>${item.style}</strong>
        <span>${item.elapsed}</span>
      </div>
    </div>
  `).join("");
}

async function run() {
  const imageUrl = els.imageUrl.value.trim();
  if (!selectedLocalImage && !imageUrl) {
    setDebug({ ok: false, error: "请选择本地照片，或填写图片 URL。" });
    return;
  }

  els.run.disabled = true;
  els.outputImage.removeAttribute("src");
  els.outputImage.style.display = "none";
  els.outputEmpty.style.display = "grid";
  els.outputHint.textContent = "生成中";
  startProgress();

  try {
    const response = await fetch("/api/run-model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adapter: "openai-edit",
        baseUrl: "https://api.kl-api.info",
        endpoint: "/v1/images/edits",
        token: els.token.value.trim(),
        modelId: "gpt-image-2",
        prompt: els.prompt.value.trim(),
        image: selectedLocalImage?.dataUrl || "",
        imageUrl: selectedLocalImage ? "" : imageUrl,
        proxyUrl: els.proxy.value.trim(),
        sampleName: selectedLocalImage?.name || "url_input",
        styleName: currentStyle.name,
        size: els.size.value,
        maxWaitMs: 10 * 60 * 1000
      })
    });
    const result = await response.json();
    const output = extractOutput(result);
    const elapsed = Date.now() - startedAt;
    setDebug({ httpStatus: response.status, httpOk: response.ok, hasOutput: Boolean(output), elapsedMs: elapsed, result });

    if (!response.ok || !result.ok) {
      els.progressTitle.textContent = "请求失败";
      els.progressDetail.textContent = result?.data?.error?.message || result.error || "KL API 返回失败";
      els.outputHint.textContent = "失败";
      els.progressFill.style.width = "100%";
      stopProgress("failed");
      return;
    }

    if (!output) {
      els.progressTitle.textContent = "未提取到图片";
      els.progressDetail.textContent = "请查看调试响应字段";
      els.outputHint.textContent = "无图片";
      els.progressFill.style.width = "100%";
      stopProgress("no image");
      return;
    }

    els.outputImage.src = output;
    els.outputImage.style.display = "block";
    els.outputEmpty.style.display = "none";
    els.outputHint.textContent = "成功";
    els.progressTitle.textContent = "生成完成";
    els.progressDetail.textContent = `${currentStyle.name} · 耗时 ${formatDuration(elapsed)}`;
    els.progressFill.style.width = "100%";
    stopProgress("success");
    history.unshift({ style: currentStyle.name, url: output, elapsed: formatDuration(elapsed) });
    renderHistory();
  } catch (error) {
    setDebug({ ok: false, error: error.message || String(error), elapsedMs: Date.now() - startedAt });
    els.progressTitle.textContent = "本地请求异常";
    els.progressDetail.textContent = error.message || String(error);
    els.outputHint.textContent = "异常";
    els.progressFill.style.width = "100%";
    stopProgress("error");
  } finally {
    els.run.disabled = false;
  }
}

els.imageUrl.addEventListener("input", syncPreview);
els.file.addEventListener("change", () => {
  const file = els.file.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    selectedLocalImage = {
      name: file.name.replace(/\.[^.]+$/, ""),
      dataUrl: reader.result
    };
    els.inputPreview.src = selectedLocalImage.dataUrl;
    els.inputHint.textContent = "本地照片优先";
  };
  reader.readAsDataURL(file);
});
els.run.addEventListener("click", run);
els.copyDebug.addEventListener("click", () => navigator.clipboard?.writeText(JSON.stringify(lastDebug, null, 2)));

els.prompt.value = currentStyle.prompt;
renderChoices();
syncPreview();
renderHistory();
setDebug({ ready: true, page: "gpt-image2-styles", endpoint: "/v1/images/edits", adapter: "openai-edit" });
