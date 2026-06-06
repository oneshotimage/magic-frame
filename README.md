# AI 影像写真馆

微信原生小程序 + FastAPI 后端，用于上传照片并通过 KL API 生成 AI 写真，同时提供后台管理页面。

## 启动后端

```bash
python3 -m uvicorn backend.main:app --reload --port 8000
```

打开：

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/admin
```

## 目录结构

```text
backend/
├── main.py                # FastAPI API 服务与管理后台入口
├── cloud_runtime.py       # 数据库和对象存储适配
└── test_api.py            # 后端测试

frontend/
├── admin/                 # FastAPI 托管的管理后台页面
├── public/                # 本地模型测试台
└── weapp/                 # 微信原生小程序，可直接导入微信开发者工具

docs/                      # PRD、架构文档、Swagger、开发历史
```

## 微信小程序调试

原生小程序代码位于 `frontend/weapp`，目录结构参考了 `xinge` 小程序的可导入项目方式，包含 `project.config.json`、`app.json`、页面级 `wxml/js/wxss`。

1. 启动本地后端：

```bash
python3 -m uvicorn backend.main:app --reload --port 8000
```

2. 在微信开发者工具中导入目录：

```text
frontend/weapp
```

3. 使用测试号或游客 AppID 打开项目。`project.config.json` 已设置 `urlCheck: false`，本地调试会请求：

```text
http://127.0.0.1:8000
```

如需改后端地址，修改 `frontend/weapp/app.js` 中的 `globalData.apiBaseUrl`。上传照片、风格选择、生成任务、作品集、购买、广告奖励、分享海报、反馈、个人中心等页面均已接入后端 API。

也可以用环境变量启动：

```bash
KL_API_TOKEN="你的 KL API Token" python3 -m uvicorn backend.main:app --reload --port 8000
```

## 后端测试

后端测试覆盖 Auth、User、Credit、Upload、Generation、Order、Payment、Share、Feedback 和管理后台 API。

```bash
python3 -m pytest backend/test_api.py
```

## FastAPI 后端

项目后端为参考 `xinge/backend` 结构实现的 FastAPI 服务：

```text
backend/
├── main.py          # FastAPI 服务，接口路径与小程序保持一致
├── test_api.py      # FastAPI TestClient 冒烟测试
├── pyproject.toml
└── README.md
```

启动：

```bash
python3 -m uvicorn backend.main:app --reload --port 8000
```

测试：

```bash
python3 -m pytest backend/test_api.py
```

微信小程序切换到 FastAPI 后端时，将 `frontend/weapp/app.js` 的 `apiBaseUrl` 改为 `http://127.0.0.1:8000`。

管理后台由 FastAPI 直接提供：

```text
http://127.0.0.1:8000/admin
```

默认账号配置：

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

后台代码位于 `frontend/admin/`，接口位于 `backend/` 的 `/admin/api/*`。

FastAPI 后端默认要求真实调用 KL API。可复制 `.env.example` 为 `.env` 并填入：

```bash
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_TIMEOUT_SECONDS=600
PUBLIC_BASE_URL=http://127.0.0.1:8000
KL_PROXY_URL=http://127.0.0.1:7890
LOG_LEVEL=info
```

如果只想本地跑通流程，显式设置 `AI_MOCK_GENERATION=1` 才会启用 mock 图片。运行状态可看 `GET /config/runtime`，小程序生成中和结果页也会展示 KL 调用模式、模型、接口、HTTP 状态和错误摘要。后端控制台日志支持 `LOG_LEVEL=debug|info|warn|error`。

当 KL 返回 `b64_json` 时，FastAPI 会转成 `/assets/generated/{assetId}.png` HTTP 图片地址，避免微信小程序 `<image>` 无法稳定展示 base64 data URL。

测试期间 FastAPI 默认开启无限生成次数：

```bash
AI_UNLIMITED_CREDITS=1
```

此时 `/credits` 返回 `displayText: "无限"`，生成任务不会因余额不足失败，也不会扣减次数。正式计费测试时改为 `AI_UNLIMITED_CREDITS=0`。

## Docker Compose 部署

后端支持 Docker Compose 部署，容器内由 `backend.main:app` 提供 API 与管理后台。

```bash
docker compose up -d --build
```

如需指定宿主机端口：

```bash
FASTAPI_PORT=8000 docker compose up -d --build
```

常用环境变量：

```bash
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_PROXY_URL=http://127.0.0.1:7890
```

如果未配置 `KL_API_TOKEN` 或 `KL_API_KEY`，真实生成会失败并在任务详情、后台日志里给出错误。需要本地完整流程测试时显式设置 `AI_MOCK_GENERATION=1`。

## 微信云托管部署

云托管构建上下文使用仓库根目录，Dockerfile 路径使用：

```text
Dockerfile
```

服务启动会读取云托管注入的 `PORT`：

```bash
uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

健康检查路径：

```text
/health
```

详细步骤见 [docs/wechat-cloud-run-deploy.md](docs/wechat-cloud-run-deploy.md)。

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
  "n": 1
}
```

Nano Banana 已支持「提交任务 + 轮询任务」。如果其它 KL 模型也返回异步任务 ID，可以把该模型的适配器改成 `fal-queue` 或按响应结构扩展后端适配逻辑。

## 已实现能力

- 4 模型 × 4 风格测试矩阵
- 样本图片本地上传和标签标注
- Prompt 可编辑和重置
- 模拟模式与真实 KL 请求模式
- 本地 Node 代理，避免浏览器 CORS，并避免 Key 直接打到第三方页面
- OpenAI JSON、OpenAI multipart edit、fal queue、可配置 JSON 模板四种适配器
- 测试队列、成功率、15 秒完成率、P95、成本统计
- 输出对比区和 CSV 导出
