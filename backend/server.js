import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../frontend/public");
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const appState = {
  users: new Map(),
  credits: new Map(),
  creditLogs: [],
  uploads: new Map(),
  tasks: new Map(),
  orders: new Map(),
  feedback: [],
  adRewards: new Set()
};

const stylePrompts = {
  pixar: {
    name: "3D皮克斯卡通",
    color: "#FFB800",
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为高质量3D动画电影角色。风格为柔和立体、干净皮肤、明亮眼睛、精致布光、温暖色彩，适合微信头像和亲子写真。不要改变人物性别、年龄、发型主体和服装主体，不要增加多余人物，不要出现文字、水印、畸形五官。"
  },
  realistic: {
    name: "高级写实插画",
    color: "#FF7D45",
    prompt: "保留上传照片中人物的身份特征、脸型、五官比例、发型、表情和姿态，将人物重绘为高级写实插画写真。画面需要自然肤色、电影级光影、精致细节、干净背景、轻微艺术化但接近真人，适合朋友圈精美配图。不要过度磨皮，不要改变人物身份，不要出现文字、水印、畸形手指或五官。"
  },
  handdrawn: {
    name: "文艺手绘质感",
    color: "#A87532",
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为温柔文艺手绘写真。风格为柔和线条、纸张纹理、淡雅配色、治愈氛围、轻插画质感，适合头像和日常分享。不要改变人物身份、年龄、性别，不要增加文字、水印或多余人物。"
  },
  comic: {
    name: "潮流涂鸦漫画",
    color: "#222222",
    prompt: "保留上传照片中人物的身份特征、脸型、发型、表情和姿态，将人物重绘为潮流街头漫画风格。风格为清晰轮廓、漫画分镜质感、适度涂鸦元素、强对比但不脏乱，适合年轻用户头像和社交分享。不要改变人物身份，不要生成品牌 logo、文字、水印、畸形五官或多余人物。"
  }
};

const packages = [
  { packageId: "pkg_6_20", name: "20次包", priceFen: 600, credits: 20 },
  { packageId: "pkg_12_50", name: "50次包", priceFen: 1200, credits: 50 },
  { packageId: "pkg_19_100", name: "100次包", priceFen: 1900, credits: 100 }
];

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(data));
}

function serializeError(error) {
  return {
    name: error?.name,
    message: error?.message || String(error),
    code: error?.code || error?.cause?.code,
    cause: error?.cause
      ? {
          name: error.cause.name,
          message: error.cause.message,
          code: error.cause.code,
          host: error.cause.host,
          port: error.cause.port
        }
      : undefined
  };
}

function sanitizeTarget(baseUrl, endpoint) {
  const target = new URL(endpoint || "/", baseUrl);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only http/https KL targets are allowed");
  }
  return target;
}

async function proxyKl(req, res) {
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const target = sanitizeTarget(body.baseUrl, body.endpoint);
    const headers = {
      "content-type": "application/json",
      ...(body.headers || {})
    };

    const startedAt = Date.now();
    const upstream = await fetch(target, {
      method: body.method || "POST",
      headers,
      body: body.method === "GET" ? undefined : JSON.stringify(body.payload || {})
    });
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    sendJson(res, upstream.status, {
      ok: upstream.ok,
      status: upstream.status,
      elapsedMs: Date.now() - startedAt,
      data
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) return null;
  const [, mimeType, base64] = match;
  return new Blob([Buffer.from(base64, "base64")], { type: mimeType });
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) return null;
  const [, mimeType, base64] = match;
  return {
    mimeType,
    buffer: Buffer.from(base64, "base64")
  };
}

function buildMultipartBody(fields, files = []) {
  const boundary = `----kl-lab-${crypto.randomUUID()}`;
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
    chunks.push(Buffer.from(String(value)));
    chunks.push(Buffer.from("\r\n"));
  }

  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${file.mimeType || "application/octet-stream"}\r\n\r\n`));
    chunks.push(file.buffer);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    boundary,
    body: Buffer.concat(chunks)
  };
}

function fillTemplate(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => {
    return text.replaceAll(`{{${key}}}`, String(value));
  }, template);
}

function extractImageOutput(data) {
  const seen = new Set();
  const keyHints = /^(url|image|image_url|output|response_url|b64_json|base64|content)$/i;

  function visit(value, key = "") {
    if (value == null) return null;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^https?:\/\/.+/i.test(trimmed)) return { url: trimmed };
      if (/^data:image\/[^;]+;base64,/i.test(trimmed)) return { dataUrl: trimmed };
      const embeddedUrl = trimmed.match(/https?:\/\/[^\s"'<>\\]+/i);
      if (embeddedUrl) return { url: embeddedUrl[0] };
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          const parsed = JSON.parse(trimmed);
          const found = visit(parsed, key);
          if (found) return found;
        } catch {
          // Some providers return plain text that only looks JSON-like.
        }
      }
      if (keyHints.test(key) && /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 500) {
        return { dataUrl: `data:image/png;base64,${trimmed.replace(/\s/g, "")}` };
      }
      return null;
    }

    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, key);
        if (found) return found;
      }
      return null;
    }

    const priorityKeys = [
      "url",
      "image_url",
      "image",
      "output",
      "response_url",
      "b64_json",
      "base64",
      "images",
      "data",
      "result",
      "results",
      "output_url"
    ];

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

function extractImageUrl(data) {
  return extractImageOutput(data).url || "";
}

function summarizeResponse(data) {
  return JSON.stringify(data, (key, value) => {
    if (typeof value === "string" && value.length > 240) {
      return `${value.slice(0, 240)}...<truncated:${value.length}>`;
    }
    return value;
  });
}

function debugShape(data) {
  if (data == null || typeof data !== "object") return { type: typeof data, keys: [] };
  return {
    type: Array.isArray(data) ? "array" : "object",
    keys: Object.keys(data).slice(0, 30),
    dataKeys: data?.data && typeof data.data === "object" ? Object.keys(data.data).slice(0, 30) : [],
    resultKeys: data?.result && typeof data.result === "object" ? Object.keys(data.result).slice(0, 30) : []
  };
}

async function fetchJson(target, options) {
  const startedAt = Date.now();
  const { proxyUrl: requestProxyUrl, ...fetchOptions } = options;
  const proxyUrl = requestProxyUrl || process.env.KL_PROXY_URL || "";
  if (proxyUrl && target.protocol === "https:" && (typeof options.body === "string" || Buffer.isBuffer(options.body) || options.body == null)) {
    return fetchJsonViaHttpProxy(target, fetchOptions, proxyUrl, startedAt);
  }

  const response = await fetch(target, fetchOptions);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
    data
  };
}

function parseHttpResponse(raw) {
  const splitAt = raw.indexOf("\r\n\r\n");
  const head = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
  const body = splitAt >= 0 ? raw.slice(splitAt + 4) : "";
  const lines = head.split("\r\n");
  const status = Number(lines[0]?.split(" ")[1] || 0);
  const headers = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return {
    status,
    headers,
    body: headers["transfer-encoding"]?.toLowerCase().includes("chunked") ? decodeChunkedBody(body) : body
  };
}

function decodeChunkedBody(body) {
  let offset = 0;
  const chunks = [];
  while (offset < body.length) {
    const lineEnd = body.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const sizeText = body.slice(offset, lineEnd).split(";")[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(body.slice(offset, offset + size));
    offset += size + 2;
  }
  return chunks.join("");
}

function parseHttpBuffer(buffer) {
  const separator = Buffer.from("\r\n\r\n");
  const splitAt = buffer.indexOf(separator);
  const headBuffer = splitAt >= 0 ? buffer.subarray(0, splitAt) : buffer;
  const bodyBuffer = splitAt >= 0 ? buffer.subarray(splitAt + separator.length) : Buffer.alloc(0);
  const lines = headBuffer.toString("utf8").split("\r\n");
  const status = Number(lines[0]?.split(" ")[1] || 0);
  const headers = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return {
    status,
    headers,
    body: headers["transfer-encoding"]?.toLowerCase().includes("chunked") ? decodeChunkedBuffer(bodyBuffer) : bodyBuffer
  };
}

function decodeChunkedBuffer(buffer) {
  let offset = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const sizeText = buffer.subarray(offset, lineEnd).toString("utf8").split(";")[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}

async function fetchBufferViaHttpProxy(target, proxyUrl) {
  const proxy = new URL(proxyUrl);
  const socket = await new Promise((resolve, reject) => {
    const conn = net.connect(Number(proxy.port || 80), proxy.hostname);
    conn.once("connect", () => {
      conn.write(`CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n\r\n`);
    });
    conn.once("error", reject);
    conn.once("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (!text.startsWith("HTTP/1.1 200") && !text.startsWith("HTTP/1.0 200")) {
        reject(new Error(`Proxy CONNECT failed: ${text.split("\r\n")[0]}`));
        conn.destroy();
        return;
      }
      resolve(conn);
    });
  });

  const secure = tls.connect({ socket, servername: target.hostname });
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    secure.once("secureConnect", () => {
      secure.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`);
    });
    secure.on("data", (chunk) => chunks.push(chunk));
    secure.once("end", () => resolve(Buffer.concat(chunks)));
    secure.once("error", reject);
  });

  const parsed = parseHttpBuffer(raw);
  if (parsed.status < 200 || parsed.status >= 300) {
    throw new Error(`下载输入图片失败：HTTP ${parsed.status}`);
  }
  return {
    buffer: parsed.body,
    mimeType: parsed.headers["content-type"]?.split(";")[0] || "image/jpeg",
    status: parsed.status
  };
}

async function fetchImageBuffer(imageUrl, proxyUrl) {
  const target = new URL(imageUrl);
  if (proxyUrl && target.protocol === "https:") return fetchBufferViaHttpProxy(target, proxyUrl);
  const response = await fetch(target);
  if (!response.ok) throw new Error(`下载输入图片失败：HTTP ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type")?.split(";")[0] || "image/jpeg",
    status: response.status
  };
}

async function fetchJsonViaHttpProxy(target, options, proxyUrl, startedAt) {
  const proxy = new URL(proxyUrl);
  const body = options.body || "";
  const method = options.method || "GET";
  const headers = {
    host: target.host,
    connection: "close",
    ...(options.headers || {})
  };
  if (body && !headers["content-length"]) {
    headers["content-length"] = Buffer.byteLength(body);
  }

  const socket = await new Promise((resolve, reject) => {
    const conn = net.connect(Number(proxy.port || 80), proxy.hostname);
    conn.once("connect", () => {
      conn.write(`CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n\r\n`);
    });
    conn.once("error", reject);
    conn.once("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (!text.startsWith("HTTP/1.1 200") && !text.startsWith("HTTP/1.0 200")) {
        reject(new Error(`Proxy CONNECT failed: ${text.split("\r\n")[0]}`));
        conn.destroy();
        return;
      }
      resolve(conn);
    });
  });

  const secure = tls.connect({ socket, servername: target.hostname });
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    secure.once("secureConnect", () => {
      const headerText = Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n");
      secure.write(`${method} ${target.pathname}${target.search} HTTP/1.1\r\n${headerText}\r\n\r\n`);
      if (body) secure.write(body);
    });
    secure.on("data", (chunk) => {
      chunks.push(chunk);
    });
    secure.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    secure.once("error", reject);
  });

  const parsed = parseHttpResponse(raw);
  let data;
  try {
    data = JSON.parse(parsed.body);
  } catch {
    data = { raw: parsed.body };
  }
  return {
    ok: parsed.status >= 200 && parsed.status < 300,
    status: parsed.status,
    elapsedMs: Date.now() - startedAt,
    data
  };
}

function buildAuthHeaders(token) {
  const effectiveToken = token || process.env.KL_API_TOKEN || process.env.KL_API_KEY || "";
  return effectiveToken
    ? { authorization: effectiveToken.startsWith("Bearer ") ? effectiveToken : `Bearer ${effectiveToken}` }
    : {};
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function volcSignHeaders({ accessKeyId, secretAccessKey, service, region, host, query, body, now = new Date() }) {
  const xDate = formatAmzDate(now);
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(body || "");
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`
  ].join("\n") + "\n";
  const canonicalRequest = [
    "POST",
    "/",
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(Buffer.from(secretAccessKey, "utf8"), shortDate), region), service), "request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    "content-type": "application/json",
    host,
    "x-content-sha256": payloadHash,
    "x-date": xDate,
    authorization: `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

async function runOpenAiEdit(body) {
  const target = sanitizeTarget(body.baseUrl, body.endpoint);
  const imageBlob = dataUrlToBlob(body.image);
  const imageBuffer = dataUrlToBuffer(body.image);
  if (!imageBlob && !body.imageUrl) {
    throw new Error("OpenAI 图片编辑适配器需要上传图片文件或填写公开图片 URL");
  }

  if (body.imageUrl) {
    const downloaded = await fetchImageBuffer(body.imageUrl, body.proxyUrl);
    const multipart = buildMultipartBody(
      {
        model: body.modelId,
        prompt: body.prompt,
        size: body.size || "1024x1024",
        n: String(body.numImages || 1)
      },
      [
        {
          name: "image",
          filename: `${body.sampleName || "input"}.jpg`,
          mimeType: downloaded.mimeType,
          buffer: downloaded.buffer
        }
      ]
    );

    const result = await fetchJson(target, {
      method: "POST",
      headers: {
        ...buildAuthHeaders(body.token),
        "content-type": `multipart/form-data; boundary=${multipart.boundary}`
      },
      body: multipart.body,
      proxyUrl: body.proxyUrl
    });

    return {
      ...result,
      ...extractImageOutput(result.data),
      responseSummary: summarizeResponse(result.data),
      debug: {
        adapter: "openai-edit",
        endpoint: String(target),
        proxiedMultipart: Boolean(body.proxyUrl),
        sourceImageUrl: body.imageUrl,
        sourceImageBytes: downloaded.buffer.length,
        sourceImageMime: downloaded.mimeType,
        requestBytes: multipart.body.length,
        responseShape: debugShape(result.data)
      }
    };
  }

  if (body.proxyUrl && imageBuffer) {
    const multipart = buildMultipartBody(
      {
        model: body.modelId,
        prompt: body.prompt,
        size: body.size || "1024x1024",
        n: String(body.numImages || 1)
      },
      [
        {
          name: "image",
          filename: `${body.sampleName || "sample"}.png`,
          mimeType: imageBuffer.mimeType,
          buffer: imageBuffer.buffer
        }
      ]
    );

    const result = await fetchJson(target, {
      method: "POST",
      headers: {
        ...buildAuthHeaders(body.token),
        "content-type": `multipart/form-data; boundary=${multipart.boundary}`
      },
      body: multipart.body,
      proxyUrl: body.proxyUrl
    });

    return {
      ...result,
      ...extractImageOutput(result.data),
      responseSummary: summarizeResponse(result.data),
      debug: {
        adapter: "openai-edit",
        endpoint: String(target),
        proxiedMultipart: true,
        requestBytes: multipart.body.length,
        responseShape: debugShape(result.data)
      }
    };
  }

  const form = new FormData();
  form.set("model", body.modelId);
  form.set("prompt", body.prompt);
  form.set("size", body.size || "1024x1024");
  form.set("n", String(body.numImages || 1));

  if (imageBlob) {
    form.set("image", imageBlob, `${body.sampleName || "sample"}.png`);
  } else {
    form.set("image_url", body.imageUrl);
  }

  const result = await fetchJson(target, {
    method: "POST",
    headers: buildAuthHeaders(body.token),
    body: form,
    proxyUrl: body.proxyUrl
  });

  return {
    ...result,
    ...extractImageOutput(result.data),
    responseSummary: summarizeResponse(result.data),
    debug: {
      adapter: "openai-edit",
      endpoint: String(target),
      responseShape: debugShape(result.data)
    }
  };
}

async function runOpenAiEditJson(body) {
  const target = sanitizeTarget(body.baseUrl, body.endpoint);
  const payload = {
    model: body.modelId,
    prompt: body.prompt,
    size: body.size || "1024x1024",
    n: body.numImages || 1
  };

  if (body.imageUrl) {
    payload.image = body.imageUrl;
    payload.image_url = body.imageUrl;
  } else if (body.image) {
    payload.image = body.image;
  }

  const result = await fetchJson(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders(body.token)
    },
    body: JSON.stringify(payload),
    proxyUrl: body.proxyUrl
  });

  return {
    ...result,
    ...extractImageOutput(result.data),
    responseSummary: summarizeResponse(result.data),
    debug: {
      adapter: "openai-edit-json",
      endpoint: String(target),
      payloadKeys: Object.keys(payload),
      responseShape: debugShape(result.data)
    }
  };
}

async function runOpenAiJson(body) {
  const target = sanitizeTarget(body.baseUrl, body.endpoint);
  const payload = {
    model: body.modelId,
    prompt: body.prompt,
    size: body.size || "1024x1024",
    n: body.numImages || 1
  };

  if (body.imageUrl) payload.image = body.imageUrl;
  if (body.image) payload.image = body.image;

  const result = await fetchJson(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders(body.token)
    },
    body: JSON.stringify(payload),
    proxyUrl: body.proxyUrl
  });

  return {
    ...result,
    ...extractImageOutput(result.data),
    responseSummary: summarizeResponse(result.data),
    debug: {
      adapter: "openai-json",
      endpoint: String(target),
      payloadKeys: Object.keys(payload),
      responseShape: debugShape(result.data)
    }
  };
}

async function runOpenAiImageJson(body) {
  const target = sanitizeTarget(body.baseUrl, body.endpoint);
  const imageInstruction = body.imageUrl
    ? `\n\nReference image URL: ${body.imageUrl}\nUse the person in the reference image as the identity reference.`
    : "";
  const payload = {
    model: body.modelId,
    prompt: `${body.prompt}${imageInstruction}`,
    size: body.size || "1024x1024",
    n: body.numImages || 1
  };

  if (body.imageUrl) {
    payload.image = body.imageUrl;
    payload.image_url = body.imageUrl;
  } else if (body.image) {
    payload.image = body.image;
  }

  const result = await fetchJson(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders(body.token)
    },
    body: JSON.stringify(payload),
    proxyUrl: body.proxyUrl
  });

  return {
    ...result,
    ...extractImageOutput(result.data),
    responseSummary: summarizeResponse(result.data),
    debug: {
      adapter: "openai-image-json",
      endpoint: String(target),
      payloadKeys: Object.keys(payload),
      responseShape: debugShape(result.data)
    }
  };
}

async function runFalQueue(body) {
  const submitTarget = sanitizeTarget(body.baseUrl, body.endpoint);
  const payload = {
    prompt: body.prompt,
    num_images: body.numImages || 1,
    aspect_ratio: body.aspectRatio || "1:1",
    output_format: body.outputFormat || "png",
    safety_tolerance: body.safetyTolerance || "2",
    sync_mode: false,
    image_urls: [body.imageUrl || body.image].filter(Boolean),
    limit_generations: true
  };

  const headers = {
    "content-type": "application/json",
    ...buildAuthHeaders(body.token)
  };

  const submit = await fetchJson(submitTarget, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    proxyUrl: body.proxyUrl
  });

  if (!submit.ok) return { ...submit, ...extractImageOutput(submit.data), responseSummary: summarizeResponse(submit.data), debug: { adapter: "fal-queue", phase: "submit", endpoint: String(submitTarget), responseShape: debugShape(submit.data) } };

  const submitOutput = extractImageOutput(submit.data);
  if (submitOutput.url || submitOutput.dataUrl) {
    return { ...submit, ...submitOutput, responseSummary: summarizeResponse(submit.data), debug: { adapter: "fal-queue", phase: "submit-direct-output", endpoint: String(submitTarget), responseShape: debugShape(submit.data) } };
  }

  const requestId = submit.data?.request_id || submit.data?.requestId || submit.data?.id;
  if (!requestId) {
    return { ...submit, outputUrl: "", requestId: "" };
  }

  const deadline = Date.now() + Number(body.maxWaitMs || 30000);
  const statusPath = `${body.endpoint.replace(/\/$/, "")}/requests/${requestId}/status`;
  const resultPath = `${body.endpoint.replace(/\/$/, "")}/requests/${requestId}`;
  let lastStatus = submit.data;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusTarget = sanitizeTarget(body.baseUrl, statusPath);
    const status = await fetchJson(statusTarget, { method: "GET", headers, proxyUrl: body.proxyUrl });
    lastStatus = status.data;

    const statusText = String(status.data?.status || status.data?.state || "").toUpperCase();
    if (["COMPLETED", "SUCCEEDED", "SUCCESS"].includes(statusText)) break;
    if (["FAILED", "ERROR", "CANCELLED"].includes(statusText)) {
      return {
        ok: false,
        status: status.status,
        elapsedMs: submit.elapsedMs + status.elapsedMs,
        data: status.data,
        outputUrl: "",
        requestId
      };
    }
  }

  const resultTarget = sanitizeTarget(body.baseUrl, resultPath);
  const result = await fetchJson(resultTarget, { method: "GET", headers, proxyUrl: body.proxyUrl });
  return {
    ...result,
    data: result.data,
    ...extractImageOutput(result.data),
    responseSummary: summarizeResponse(result.data),
    debug: {
      adapter: "fal-queue",
      phase: "result",
      submitEndpoint: String(submitTarget),
      resultEndpoint: String(resultTarget),
      responseShape: debugShape(result.data),
      lastStatusShape: debugShape(lastStatus)
    },
    requestId,
    lastStatus
  };
}

function getBase64Payload(dataUrl) {
  const match = /^data:[^;]+;base64,(.*)$/.exec(dataUrl || "");
  return match ? match[1] : "";
}

function volcEndpoint(action, version = "2022-08-31") {
  const query = new URLSearchParams({ Action: action, Version: version }).toString();
  return {
    query,
    url: new URL(`https://visual.volcengineapi.com/?${query}`)
  };
}

async function volcPost({ action, payload, body }) {
  const accessKeyId = body.volcAccessKeyId || process.env.VOLC_ACCESS_KEY_ID || "";
  const secretAccessKey = body.volcSecretAccessKey || process.env.VOLC_SECRET_ACCESS_KEY || "";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("即梦官方 API 需要 AccessKeyID 和 SecretAccessKey");
  }

  const host = "visual.volcengineapi.com";
  const service = "cv";
  const region = body.volcRegion || "cn-north-1";
  const { query, url } = volcEndpoint(action, body.volcVersion || "2022-08-31");
  const requestBody = JSON.stringify(payload);
  const headers = volcSignHeaders({
    accessKeyId,
    secretAccessKey,
    service,
    region,
    host,
    query,
    body: requestBody
  });

  return fetchJson(url, {
    method: "POST",
    headers,
    body: requestBody,
    proxyUrl: body.proxyUrl
  });
}

function extractVolcTaskId(data) {
  return data?.data?.task_id || data?.data?.taskId || data?.task_id || data?.taskId || data?.id || "";
}

function extractVolcStatus(data) {
  return String(data?.data?.status || data?.data?.task_status || data?.status || data?.task_status || "").toLowerCase();
}

async function runVolcJimeng(body) {
  const base64 = getBase64Payload(body.image);
  const size = String(body.size || "1024x1024").split("x").map((value) => Number(value));
  const reqJson = {
    return_url: true,
    use_pre_llm: true
  };

  const submitPayload = {
    req_key: body.modelId || "jimeng_high_aes_general_v40",
    prompt: body.prompt,
    width: size[0] || 1024,
    height: size[1] || 1024,
    req_json: JSON.stringify(reqJson)
  };

  if (body.imageUrl) {
    submitPayload.image_urls = [body.imageUrl];
  } else if (base64) {
    submitPayload.binary_data_base64 = [base64];
  }

  const submit = await volcPost({ action: "CVSync2AsyncSubmitTask", payload: submitPayload, body });
  if (!submit.ok) {
    return {
      ...submit,
      ...extractImageOutput(submit.data),
      responseSummary: summarizeResponse(submit.data),
      debug: {
        adapter: "volc-jimeng",
        phase: "submit",
        responseShape: debugShape(submit.data)
      }
    };
  }

  const taskId = extractVolcTaskId(submit.data);
  if (!taskId) {
    return {
      ...submit,
      ...extractImageOutput(submit.data),
      responseSummary: summarizeResponse(submit.data),
      debug: {
        adapter: "volc-jimeng",
        phase: "submit-no-task",
        responseShape: debugShape(submit.data)
      }
    };
  }

  const deadline = Date.now() + Number(body.maxWaitMs || 10 * 60 * 1000);
  let last = submit;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    last = await volcPost({
      action: "CVSync2AsyncGetResult",
      payload: {
        req_key: body.modelId || "jimeng_high_aes_general_v40",
        task_id: taskId,
        req_json: JSON.stringify({ return_url: true })
      },
      body
    });

    const status = extractVolcStatus(last.data);
    const output = extractImageOutput(last.data);
    if (output.url || output.dataUrl) break;
    if (["done", "success", "succeeded", "finish", "finished", "failed", "fail", "error"].includes(status)) break;
  }

  return {
    ...last,
    ...extractImageOutput(last.data),
    responseSummary: summarizeResponse(last.data),
    requestId: taskId,
    debug: {
      adapter: "volc-jimeng",
      phase: "result",
      taskId,
      status: extractVolcStatus(last.data),
      responseShape: debugShape(last.data)
    }
  };
}

async function runModel(req, res) {
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
    const adapter = body.adapter || "openai-json";
    const startedAt = Date.now();

    let result;
    if (adapter === "openai-image-json") result = await runOpenAiImageJson(body);
    else if (adapter === "openai-edit") result = await runOpenAiEdit(body);
    else if (adapter === "openai-edit-json") result = await runOpenAiEditJson(body);
    else if (adapter === "fal-queue") result = await runFalQueue(body);
    else if (adapter === "volc-jimeng") result = await runVolcJimeng(body);
    else if (adapter === "template-json") {
      const rendered = fillTemplate(body.payloadTemplate || "{}", {
        model: body.modelId,
        prompt: body.prompt,
        image: body.imageUrl || body.image || "",
        style: body.styleName || "",
        sample: body.sampleName || "",
        size: body.size || "1024x1024"
      });
      const payload = JSON.parse(rendered);
      const target = sanitizeTarget(body.baseUrl, body.endpoint);
      result = await fetchJson(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(body.token)
        },
        body: JSON.stringify(payload),
        proxyUrl: body.proxyUrl
      });
      Object.assign(result, extractImageOutput(result.data), {
        responseSummary: summarizeResponse(result.data),
        debug: {
          adapter: "template-json",
          endpoint: String(target),
          responseShape: debugShape(result.data)
        }
      });
    } else result = await runOpenAiJson(body);

    sendJson(res, result.ok ? 200 : result.status || 502, {
      ...result,
      elapsedMs: Date.now() - startedAt
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      errorDetail: serializeError(error),
      debug: {
        proxyConfigured: Boolean(process.env.KL_PROXY_URL),
        requestProxyConfigured: Boolean(body?.proxyUrl),
        proxyHint: "如果 DNS 解析到 198.18.x.x 或 ECONNRESET，请在页面填写本地代理 URL，例如 http://127.0.0.1:7890"
      }
    });
  }
}

async function diagnostics(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const proxyUrl = url.searchParams.get("proxyUrl") || "";
  const targetHost = "api.kl-api.info";
  const result = {
    targetHost,
    proxyConfigured: Boolean(proxyUrl || process.env.KL_PROXY_URL),
    proxyUrl: proxyUrl || (process.env.KL_PROXY_URL ? process.env.KL_PROXY_URL.replace(/\/\/.*@/, "//<auth>@") : ""),
    dns: [],
    tls: null
  };

  try {
    result.dns = await dns.resolve4(targetHost);
  } catch (error) {
    result.dnsError = serializeError(error);
  }

  try {
    const startedAt = Date.now();
    await fetchJson(new URL("https://api.kl-api.info/v1/images/generations"), {
      method: "OPTIONS",
      headers: {},
      proxyUrl
    });
    result.tls = { ok: true, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    result.tls = { ok: false, errorDetail: serializeError(error) };
  }

  sendJson(res, 200, result);
}

function getUserId(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/Bearer\s+(.+)/i);
  return match?.[1]?.replace(/^dev-token-/, "") || "demo-user";
}

function ensureUser(userId = "demo-user") {
  if (!appState.users.has(userId)) {
    appState.users.set(userId, {
      userId,
      nickname: "写真体验官",
      avatar: "",
      isNewUser: true,
      createdAt: new Date().toISOString()
    });
  }
  if (!appState.credits.has(userId)) {
    appState.credits.set(userId, {
      totalCredits: 3,
      freeCredits: 3,
      paidCredits: 0,
      adCredits: 0,
      giftCredits: 0,
      todayAdCount: 0,
      dailyAdLimit: 5
    });
    appState.creditLogs.push({
      id: `clog_${crypto.randomUUID()}`,
      userId,
      type: "free",
      direction: "in",
      amount: 3,
      balanceAfter: 3,
      bizType: "register",
      bizId: userId,
      createdAt: new Date().toISOString()
    });
  }
  return appState.users.get(userId);
}

function getCredits(userId) {
  ensureUser(userId);
  const credits = appState.credits.get(userId);
  credits.totalCredits = credits.freeCredits + credits.paidCredits + credits.adCredits + credits.giftCredits;
  return credits;
}

function addCredits(userId, type, amount, bizType, bizId) {
  const credits = getCredits(userId);
  const key = `${type}Credits`;
  credits[key] = Number(credits[key] || 0) + amount;
  credits.totalCredits += amount;
  appState.creditLogs.push({
    id: `clog_${crypto.randomUUID()}`,
    userId,
    type,
    direction: "in",
    amount,
    balanceAfter: credits.totalCredits,
    bizType,
    bizId,
    createdAt: new Date().toISOString()
  });
  return credits;
}

function consumeOneCredit(userId, taskId) {
  const credits = getCredits(userId);
  const order = ["freeCredits", "adCredits", "paidCredits", "giftCredits"];
  for (const key of order) {
    if (credits[key] > 0) {
      credits[key] -= 1;
      credits.totalCredits -= 1;
      appState.creditLogs.push({
        id: `clog_${crypto.randomUUID()}`,
        userId,
        type: key.replace("Credits", ""),
        direction: "out",
        amount: 1,
        balanceAfter: credits.totalCredits,
        bizType: "generation",
        bizId: taskId,
        createdAt: new Date().toISOString()
      });
      return true;
    }
  }
  return false;
}

function svgDataUrl(title, subtitle, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#FFF5E8"/>
        <stop offset="0.55" stop-color="#FFFFFF"/>
        <stop offset="1" stop-color="${color}33"/>
      </linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="30"/></filter>
    </defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <circle cx="250" cy="220" r="150" fill="${color}44" filter="url(#blur)"/>
    <circle cx="760" cy="790" r="190" fill="#FF7D4544" filter="url(#blur)"/>
    <rect x="162" y="138" width="700" height="748" rx="56" fill="rgba(255,255,255,0.78)" stroke="#F3D9AA" stroke-width="3"/>
    <circle cx="512" cy="404" r="150" fill="${color}"/>
    <circle cx="462" cy="370" r="22" fill="#222"/>
    <circle cx="562" cy="370" r="22" fill="#222"/>
    <path d="M440 478c48 42 104 42 144 0" fill="none" stroke="#222" stroke-width="20" stroke-linecap="round"/>
    <text x="512" y="665" text-anchor="middle" font-size="54" font-family="PingFang SC, Arial" fill="#222" font-weight="700">${title}</text>
    <text x="512" y="725" text-anchor="middle" font-size="30" font-family="PingFang SC, Arial" fill="#666">${subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    charged: task.charged,
    errorMessage: task.errorMessage || "",
    images: task.images,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

async function processGeneration(taskId) {
  const task = appState.tasks.get(taskId);
  if (!task || ["CANCELLED", "SUCCESS"].includes(task.status)) return;
  task.status = "PROCESSING";
  task.updatedAt = new Date().toISOString();
  const klTokenConfigured = Boolean(process.env.KL_API_TOKEN || process.env.KL_API_KEY);

  for (let index = 0; index < task.images.length; index += 1) {
    const image = task.images[index];
    image.status = "PROCESSING";
    task.progress = Math.max(task.progress, 18 + index * 18);
    task.updatedAt = new Date().toISOString();

    try {
      let output = "";
      if (klTokenConfigured) {
        const result = await runOpenAiEdit({
          adapter: "openai-edit",
          baseUrl: process.env.KL_API_BASE_URL || "https://api.kl-api.info",
          endpoint: "/v1/images/edits",
          modelId: process.env.KL_IMAGE_MODEL || "gpt-image-2",
          token: process.env.KL_API_TOKEN || process.env.KL_API_KEY,
          prompt: stylePrompts[image.style].prompt,
          image: task.inputImageDataUrl,
          imageUrl: "",
          proxyUrl: process.env.KL_PROXY_URL || "",
          sampleName: task.inputImageId,
          styleName: stylePrompts[image.style].name,
          size: task.size,
          maxWaitMs: 10 * 60 * 1000
        });
        output = result.url || result.dataUrl || result.outputUrl || "";
        if (!result.ok || !output) throw new Error(result?.data?.error?.message || result.error || "KL API 未返回图片");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 900));
        output = svgDataUrl(stylePrompts[image.style].name, "KL API 未配置时的本地模拟作品", stylePrompts[image.style].color);
      }

      image.status = "SUCCESS";
      image.url = output;
      image.elapsedMs = Date.now() - task.startedAt;
    } catch (error) {
      image.status = "FAILED";
      image.errorMessage = error.message || String(error);
      task.errorMessage = image.errorMessage;
    }
    task.progress = Math.round(((index + 1) / task.images.length) * 88) + 8;
    task.updatedAt = new Date().toISOString();
  }

  const successCount = task.images.filter((item) => item.status === "SUCCESS").length;
  if (successCount === task.images.length) {
    task.status = "SUCCESS";
    task.progress = 100;
    if (!task.charged) {
      task.charged = consumeOneCredit(task.userId, task.taskId);
    }
  } else if (successCount > 0) {
    task.status = "PARTIAL_SUCCESS";
    task.progress = 100;
  } else {
    task.status = "FAILED";
    task.progress = 100;
  }
  task.updatedAt = new Date().toISOString();
}

async function readJson(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

async function handleBusinessApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/^\/api(?=\/)/, "");
  const method = req.method || "GET";
  const userId = getUserId(req);
  ensureUser(userId);

  try {
    if (method === "POST" && pathname === "/auth/wechat-login") {
      const body = await readJson(req);
      const id = body.code ? `wx_${String(body.code).slice(-8)}` : userId;
      const user = ensureUser(id);
      if (body.userInfo) {
        user.nickname = body.userInfo.nickname || body.userInfo.nickName || user.nickname;
        user.avatarUrl = body.userInfo.avatarUrl || body.userInfo.avatar_url || user.avatarUrl;
        user.updatedAt = new Date().toISOString();
      }
      sendJson(res, 200, {
        accessToken: `dev-token-${id}`,
        refreshToken: `dev-refresh-${id}`,
        expiresIn: 7200,
        user,
        credits: getCredits(id)
      });
      return true;
    }

    if (method === "POST" && pathname === "/auth/refresh-token") {
      sendJson(res, 200, { accessToken: `dev-token-${userId}`, refreshToken: `dev-refresh-${userId}`, expiresIn: 7200 });
      return true;
    }

    if (method === "POST" && pathname === "/auth/logout") {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === "GET" && pathname === "/user/profile") {
      sendJson(res, 200, appState.users.get(userId));
      return true;
    }

    if (method === "PATCH" && pathname === "/user/profile") {
      const body = await readJson(req);
      const user = { ...appState.users.get(userId), ...body };
      appState.users.set(userId, user);
      sendJson(res, 200, user);
      return true;
    }

    if (method === "POST" && pathname === "/user/delete") {
      appState.users.delete(userId);
      appState.credits.delete(userId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === "GET" && pathname === "/credits") {
      sendJson(res, 200, getCredits(userId));
      return true;
    }

    if (method === "GET" && pathname === "/credits/logs") {
      sendJson(res, 200, { items: appState.creditLogs.filter((log) => log.userId === userId), total: appState.creditLogs.length });
      return true;
    }

    if (method === "POST" && pathname === "/credits/consume") {
      const body = await readJson(req);
      const amount = Math.max(1, Number(body.amount || 1));
      const credits = getCredits(userId);
      if (credits.totalCredits < amount) {
        sendJson(res, 402, { code: "CREDIT_NOT_ENOUGH", message: "生成次数不足" });
        return true;
      }
      for (let index = 0; index < amount; index += 1) {
        consumeOneCredit(userId, body.bizId || body.idempotencyKey || `manual_${Date.now()}_${index}`);
      }
      sendJson(res, 200, getCredits(userId));
      return true;
    }

    if (method === "POST" && pathname === "/credits/reward-ad") {
      const body = await readJson(req);
      if (!body.completed) {
        sendJson(res, 200, { rewarded: false, credits: getCredits(userId) });
        return true;
      }
      if (appState.adRewards.has(body.adEventId)) {
        sendJson(res, 200, { rewarded: false, credits: getCredits(userId) });
        return true;
      }
      const credits = getCredits(userId);
      if (credits.todayAdCount >= credits.dailyAdLimit) {
        sendJson(res, 429, { code: "AD_DAILY_LIMIT", message: "今日广告奖励次数已达上限" });
        return true;
      }
      appState.adRewards.add(body.adEventId);
      credits.todayAdCount += 1;
      sendJson(res, 200, { rewarded: true, credits: addCredits(userId, "ad", 1, "reward_ad", body.adEventId) });
      return true;
    }

    if (method === "POST" && pathname === "/upload/image") {
      const body = await readJson(req);
      if (!body.dataUrl || !/^data:image\//.test(body.dataUrl)) {
        sendJson(res, 400, { code: "UPLOAD_INVALID_IMAGE", message: "请上传图片 dataUrl" });
        return true;
      }
      const imageId = `img_${crypto.randomUUID()}`;
      const upload = {
        imageId,
        userId,
        url: body.dataUrl,
        width: body.width || 1024,
        height: body.height || 1024,
        sizeBytes: body.sizeBytes || Math.round(body.dataUrl.length * 0.75),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      };
      appState.uploads.set(imageId, upload);
      sendJson(res, 200, upload);
      return true;
    }

    if (method === "POST" && pathname === "/upload/validate") {
      const body = await readJson(req);
      const upload = appState.uploads.get(body.imageId);
      sendJson(res, 200, { valid: Boolean(upload), reason: upload ? "" : "图片不存在或已过期" });
      return true;
    }

    if (method === "POST" && pathname === "/generation/create") {
      const body = await readJson(req);
      const credits = getCredits(userId);
      if (credits.totalCredits <= 0) {
        sendJson(res, 402, { code: "CREDIT_NOT_ENOUGH", message: "生成次数不足" });
        return true;
      }
      const upload = appState.uploads.get(body.inputImageId);
      if (!upload) {
        sendJson(res, 400, { code: "UPLOAD_INVALID_IMAGE", message: "请先上传照片" });
        return true;
      }
      const styles = (body.styles || ["pixar", "realistic", "handdrawn", "comic"]).filter((style) => stylePrompts[style]);
      const taskId = `task_${crypto.randomUUID()}`;
      const task = {
        taskId,
        userId,
        inputImageId: upload.imageId,
        inputImageDataUrl: upload.url,
        status: "QUEUED",
        progress: 8,
        size: body.size || "1024x1024",
        charged: false,
        images: styles.map((style) => ({
          imageId: `out_${crypto.randomUUID()}`,
          style,
          status: "PENDING",
          url: "",
          errorMessage: "",
          elapsedMs: 0
        })),
        startedAt: Date.now(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      appState.tasks.set(taskId, task);
      setTimeout(() => processGeneration(taskId), 50);
      sendJson(res, 200, publicTask(task));
      return true;
    }

    if (method === "GET" && pathname === "/generation/history") {
      const items = [...appState.tasks.values()].filter((task) => task.userId === userId).map(publicTask).reverse();
      sendJson(res, 200, { items, total: items.length });
      return true;
    }

    const taskMatch = pathname.match(/^\/generation\/([^/]+)(?:\/(retry|cancel))?$/);
    if (taskMatch) {
      const task = appState.tasks.get(taskMatch[1]);
      if (!task || task.userId !== userId) {
        sendJson(res, 404, { code: "TASK_NOT_FOUND", message: "任务不存在" });
        return true;
      }
      if (method === "GET" && !taskMatch[2]) {
        sendJson(res, 200, publicTask(task));
        return true;
      }
      if (method === "POST" && taskMatch[2] === "retry") {
        task.status = "QUEUED";
        task.progress = 8;
        task.errorMessage = "";
        task.images.forEach((image) => {
          if (image.status !== "SUCCESS") image.status = "PENDING";
        });
        setTimeout(() => processGeneration(task.taskId), 50);
        sendJson(res, 200, publicTask(task));
        return true;
      }
      if (method === "POST" && taskMatch[2] === "cancel") {
        task.status = "CANCELLED";
        task.updatedAt = new Date().toISOString();
        sendJson(res, 200, publicTask(task));
        return true;
      }
    }

    if (method === "GET" && pathname === "/packages") {
      sendJson(res, 200, packages);
      return true;
    }

    if (method === "POST" && pathname === "/orders") {
      const body = await readJson(req);
      const pkg = packages.find((item) => item.packageId === body.packageId) || packages[0];
      const order = {
        orderId: `ord_${crypto.randomUUID()}`,
        orderNo: `NO${Date.now()}`,
        userId,
        packageId: pkg.packageId,
        amountFen: pkg.priceFen,
        credits: pkg.credits,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        paymentParams: {
          timeStamp: String(Math.floor(Date.now() / 1000)),
          nonceStr: crypto.randomUUID().replaceAll("-", ""),
          package: `prepay_id=mock_${Date.now()}`,
          signType: "RSA",
          paySign: "mock-signature"
        }
      };
      appState.orders.set(order.orderId, order);
      sendJson(res, 200, { order, paymentParams: order.paymentParams });
      return true;
    }

    if (method === "GET" && pathname === "/orders") {
      const items = [...appState.orders.values()].filter((order) => order.userId === userId).reverse();
      sendJson(res, 200, { items, total: items.length });
      return true;
    }

    const orderMatch = pathname.match(/^\/orders\/([^/]+)(?:\/close)?$/);
    if (orderMatch) {
      const order = appState.orders.get(orderMatch[1]);
      if (!order || order.userId !== userId) {
        sendJson(res, 404, { code: "ORDER_NOT_FOUND", message: "订单不存在" });
        return true;
      }
      if (method === "GET") {
        sendJson(res, 200, order);
        return true;
      }
      if (method === "POST" && pathname.endsWith("/close")) {
        order.status = "CLOSED";
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    if (method === "POST" && pathname === "/payment/wechat/notify") {
      const body = await readJson(req);
      const order = body.orderId ? appState.orders.get(body.orderId) : [...appState.orders.values()].find((item) => item.status === "PENDING");
      if (order && order.status !== "PAID") {
        order.status = "PAID";
        order.paidAt = new Date().toISOString();
        addCredits(order.userId, "paid", order.credits, "payment", order.orderId);
      }
      sendJson(res, 200, { code: "SUCCESS", message: "OK" });
      return true;
    }

    if (method === "POST" && pathname === "/payment/reconcile") {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === "POST" && pathname === "/share/create-poster") {
      sendJson(res, 200, { posterUrl: svgDataUrl("AI影像写真馆", "扫码生成你的艺术写真", "#FFB800") });
      return true;
    }

    if (method === "POST" && pathname === "/share/reward") {
      sendJson(res, 200, { rewarded: false });
      return true;
    }

    if (method === "POST" && pathname === "/feedback") {
      const body = await readJson(req);
      appState.feedback.push({ id: `fb_${crypto.randomUUID()}`, userId, ...body, createdAt: new Date().toISOString() });
      sendJson(res, 200, { ok: true });
      return true;
    }
  } catch (error) {
    sendJson(res, 500, { code: "INTERNAL_ERROR", message: error.message || String(error), detail: serializeError(error) });
    return true;
  }

  return false;
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const cleanPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store, max-age=0"
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    });
    res.end();
    return;
  }

  if (req.url?.startsWith("/api/kl")) {
    await proxyKl(req, res);
    return;
  }

  if (req.url?.startsWith("/api/run-model")) {
    await runModel(req, res);
    return;
  }

  if (req.url?.startsWith("/api/diagnostics")) {
    await diagnostics(req, res);
    return;
  }

  if (await handleBusinessApi(req, res)) {
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`AI image feasibility lab: http://localhost:${port}`);
});
