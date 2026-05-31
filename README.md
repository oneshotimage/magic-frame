# AI 影像写真馆模型可行性测试台

一个零依赖本地网页版测试平台，用于验证 KL API 聚合的 Liblib、即梦、GPT Image 2、Nano Banana 是否满足 MVP 的图生图写真生成要求。

## 启动

```bash
npm start
```

打开：

```text
http://localhost:4173
```

## 目录结构

```text
backend/
└── server.js              # 本地 API 服务、KL API 代理、MVP 业务接口

frontend/
├── public/                # 静态前端页面与样式脚本
└── weapp/                 # 微信原生小程序，可直接导入微信开发者工具

docs/                      # PRD、架构文档、Swagger、开发历史
```

## 微信小程序调试

原生小程序代码位于 `frontend/weapp`，目录结构参考了 `xinge` 小程序的可导入项目方式，包含 `project.config.json`、`app.json`、页面级 `wxml/js/wxss`。

1. 启动本地后端：

```bash
PORT=4180 npm start
```

2. 在微信开发者工具中导入目录：

```text
frontend/weapp
```

3. 使用测试号或游客 AppID 打开项目。`project.config.json` 已设置 `urlCheck: false`，本地调试会请求：

```text
http://localhost:4180
```

如需改后端地址，修改 `frontend/weapp/app.js` 中的 `globalData.apiBaseUrl`。上传照片、风格选择、生成任务、作品集、购买、广告奖励、分享海报、反馈、个人中心等页面均已接入后端 API。

也可以用环境变量启动，避免每次在页面输入 Token：

```bash
KL_API_TOKEN="你的 KL API Token" npm start
```

## 后端测试

后端接口测试使用 Node.js 内置 `node:test`，覆盖 Swagger 文档中的 Auth、User、Credit、Upload、Generation、Order、Payment、Share、Feedback API。

```bash
npm test
```

## FastAPI 后端

除默认 Node 后端外，项目还提供了一个参考 `xinge/backend` 结构实现的 FastAPI 后端：

```text
backend_fastapi/
├── main.py          # FastAPI 服务，接口路径与小程序保持一致
├── test_api.py      # FastAPI TestClient 冒烟测试
├── pyproject.toml
└── README.md
```

启动：

```bash
python3 -m uvicorn backend_fastapi.main:app --reload --port 8000
```

测试：

```bash
python3 -m pytest backend_fastapi/test_api.py
```

微信小程序切换到 FastAPI 后端时，将 `frontend/weapp/app.js` 的 `apiBaseUrl` 改为 `http://127.0.0.1:8000`。

FastAPI 后端默认要求真实调用 KL API。可复制 `.env.example` 为 `.env` 并填入：

```bash
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_TIMEOUT_SECONDS=600
KL_PROXY_URL=http://127.0.0.1:51004
```

如果只想本地跑通流程，显式设置 `AI_MOCK_GENERATION=1` 才会启用 mock 图片。运行状态可看 `GET /config/runtime`，小程序生成中和结果页也会展示 KL 调用模式、模型、接口、HTTP 状态和错误摘要。

## Docker Compose 部署

后端支持 Docker Compose 部署，容器内仍由 `backend/server.js` 同时提供 API 与静态前端资源。

```bash
docker compose up -d --build
```

如需指定宿主机端口：

```bash
PORT=4180 docker compose up -d --build
```

常用环境变量：

```bash
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_PROXY_URL=http://127.0.0.1:51004
```

如果未配置 `KL_API_TOKEN` 或 `KL_API_KEY`，生成接口会返回本地模拟作品，用于完整业务流程测试；配置后会调用 KL API `gpt-image-2` 的 `/v1/images/edits`。

## 使用流程

1. 默认处于「模拟模式」，可直接点击「运行测试」体验队列、指标和 CSV 导出。
2. 上传授权人像样本，建议首轮 5 张有效人像 + 3 张异常输入。
3. `Base URL` 默认是 KL 文档中的 `https://api.kl-api.info`。
4. 在「模型路由」里确认每个模型的 `model id`、`endpoint path` 和适配器。
5. 在「KL API 配置」里填写 Token/Key。认证方式固定为 `Authorization: Bearer <token>`。
6. 如接口要求公网图片 URL，在「公开图片 URL」里填写图床地址；否则上传本地图片即可。
7. 打开「真实请求」，点击「运行测试」。
8. 测试完成后点击「导出 CSV」，得到 `model_results_YYYY-MM-DD.csv`。

## KL 预设

当前内置的 KL 预设：

| 模型 | 默认 endpoint | 适配器 | 说明 |
| --- | --- | --- | --- |
| 即梦 Seedream | `/v1/images/generations` | `openai-json` | OpenAI 兼容 JSON 图片生成/图生图 |
| GPT Image 2 | `/v1/images/edits` | `openai-edit` | OpenAI 图片编辑 multipart |
| Nano Banana | `/fal-ai/nano-banana/edit` | `fal-queue` | fal 队列提交 + 轮询结果 |
| Liblib | `/v1/images/generations` | `template-json` | 先走可配置 JSON 模板，按 KL 文档微调 |

说明：Apifox 文档入口为 `https://kl-api.apifox.cn/doc-7164777`。不同模型字段如果变更，优先在页面里改 endpoint、model id、适配器和模板，无需改代码。

## 请求模板变量

请求 JSON 模板支持以下变量：

- `{{model}}`
- `{{prompt}}`
- `{{image}}`
- `{{style}}`
- `{{sample}}`
- `{{size}}`

默认模板：

```json
{
  "model": "{{model}}",
  "image": "{{image}}",
  "prompt": "{{prompt}}",
  "size": "1024x1024",
  "response_format": "url",
  "n": 1
}
```

Nano Banana 已支持「提交任务 + 轮询任务」。如果其它 KL 模型也返回异步任务 ID，可以把该模型的适配器改成 `fal-queue` 或按响应结构扩展 `backend/server.js`。

## 已实现能力

- 4 模型 × 4 风格测试矩阵
- 样本图片本地上传和标签标注
- Prompt 可编辑和重置
- 模拟模式与真实 KL 请求模式
- 本地 Node 代理，避免浏览器 CORS，并避免 Key 直接打到第三方页面
- OpenAI JSON、OpenAI multipart edit、fal queue、可配置 JSON 模板四种适配器
- 测试队列、成功率、15 秒完成率、P95、成本统计
- 输出对比区和 CSV 导出
