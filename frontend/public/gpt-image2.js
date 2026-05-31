const els = {
  token: document.querySelector("#gptToken"),
  imageUrl: document.querySelector("#gptImageUrl"),
  prompt: document.querySelector("#gptPrompt"),
  size: document.querySelector("#gptSize"),
  proxy: document.querySelector("#gptProxy"),
  run: document.querySelector("#gptRun"),
  diagnose: document.querySelector("#gptDiagnose"),
  inputPreview: document.querySelector("#gptInputPreview"),
  progressTitle: document.querySelector("#gptProgressTitle"),
  progressDetail: document.querySelector("#gptProgressDetail"),
  progressFill: document.querySelector("#gptProgressFill"),
  elapsed: document.querySelector("#gptElapsed"),
  status: document.querySelector("#gptStatus"),
  outputHint: document.querySelector("#gptOutputHint"),
  outputEmpty: document.querySelector("#gptOutputEmpty"),
  outputImage: document.querySelector("#gptOutputImage"),
  debug: document.querySelector("#gptDebug"),
  copyDebug: document.querySelector("#gptCopyDebug")
};

let timer = null;
let startedAt = 0;
let lastDebug = {};

function syncPreview() {
  els.inputPreview.src = els.imageUrl.value.trim();
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
  els.progressTitle.textContent = "正在生成";
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

async function run() {
  const imageUrl = els.imageUrl.value.trim();
  if (!imageUrl) {
    setDebug({ ok: false, error: "请填写图片 URL" });
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
        imageUrl,
        proxyUrl: els.proxy.value.trim(),
        sampleName: "url_input",
        styleName: "GPT Image 2 编辑",
        size: els.size.value,
        maxWaitMs: 10 * 60 * 1000
      })
    });
    const result = await response.json();
    const output = extractOutput(result);
    setDebug({
      httpStatus: response.status,
      httpOk: response.ok,
      hasOutput: Boolean(output),
      elapsedMs: Date.now() - startedAt,
      result
    });

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
    els.progressDetail.textContent = `耗时 ${formatDuration(Date.now() - startedAt)}`;
    els.progressFill.style.width = "100%";
    stopProgress("success");
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

async function diagnose() {
  const qs = els.proxy.value.trim() ? `?proxyUrl=${encodeURIComponent(els.proxy.value.trim())}` : "";
  const response = await fetch(`/api/diagnostics${qs}`);
  setDebug(await response.json());
}

els.imageUrl.addEventListener("input", syncPreview);
els.run.addEventListener("click", run);
els.diagnose.addEventListener("click", diagnose);
els.copyDebug.addEventListener("click", () => navigator.clipboard?.writeText(JSON.stringify(lastDebug, null, 2)));

syncPreview();
setDebug({ ready: true, page: "gpt-image2-edit", endpoint: "/v1/images/edits", adapter: "openai-edit" });
