# 开发历史

## 2026-05-31 - 初始化 AI影像写真馆全栈 MVP

任务：基于后端架构文档、Swagger 文档、前端架构文档和 Figma 视觉，实现可运行的前后端 MVP。

改动项：

- 新增全栈 MVP 页面 `public/mvp.html`、`public/mvp.css`、`public/mvp.js`。
- 实现 17 个小程序页面对应的 SPA 流程：启动页、首页、风格选择、上传、确认、协议、生成中、结果、预览、保存成功、分享海报、购买、广告奖励、我的、订单、FAQ、隐私协议。
- 基于 Figma 暖琥珀视觉落地移动端样式：暖琥珀主按钮、奶油背景、24px 卡片圆角、999px 胶囊按钮、玻璃拟态浮层。
- 扩展 `server.js`，补齐核心业务 API：登录、用户、次数、上传、生成任务、订单、支付回调、分享、反馈。
- 后端生成链路支持 KL API `gpt-image-2` 的 `/v1/images/edits`；未配置 `KL_API_TOKEN` 或 `KL_API_KEY` 时返回本地模拟作品，方便完整流程验证。
- 实现生成任务异步处理、任务轮询、四风格结果展示、成功后扣减 1 次、失败不扣次数。
- 更新 `public/index.html`，增加“全栈MVP”入口。
- 生成并补充研发文档：后端架构、接口 Swagger、前端架构、DOCX 转 Markdown。

验证：

- `node --check server.js` 通过。
- `node --check public/mvp.js` 通过。
- `http://localhost:4174/mvp.html` 返回 200。
- 登录、套餐查询、上传、创建生成任务、轮询成功路径 smoke test 通过。

## 2026-05-31 - 拆分前后端代码目录

任务：按要求将前端和后端代码放到不同目录下。

改动项：

- 新增 `backend/` 目录，并将后端入口从 `server.js` 移动为 `backend/server.js`。
- 新增 `frontend/` 目录，并将原 `public/` 静态前端资源移动为 `frontend/public/`。
- 更新 `backend/server.js` 的静态资源目录，从后端目录指向 `../frontend/public`。
- 更新根目录 `package.json`，`npm start` 改为执行 `node backend/server.js`。
- 更新 `README.md`，补充前后端目录结构说明，并修正后端扩展路径说明。

验证：

- `node --check backend/server.js` 通过。
- `node --check frontend/public/mvp.js` 通过。
- `PORT=4175 npm start` 可启动拆分后的服务。
- `http://localhost:4175/mvp.html` 返回 200。
- `http://localhost:4175/packages` 返回套餐列表。

## 2026-05-31 - 实现后端 API 测试与 Docker Compose 部署

任务：参考后端架构文档和 Swagger 文档实现后端代码，完成对应单元测试，每个 API 都需要测试，并支持 Docker Compose 部署。

改动项：

- 补齐后端 `/credits/consume` 接口，支持按次数扣减并返回最新余额。
- 修复 `/generation/history` 路由优先级，避免被 `/generation/{taskId}` 动态路由误匹配。
- 新增 `backend/tests/api.test.js`，使用 Node.js 内置 `node:test` 启动测试服务并覆盖所有 Swagger API 分组：
  - Auth：登录、刷新 token、退出。
  - User：查询资料、更新资料、注销账号。
  - Credit：余额、流水、扣减、广告奖励。
  - Upload：图片上传、图片校验。
  - Generation：创建任务、查询任务、重试、取消、历史。
  - Order：套餐、创建订单、订单详情、订单列表、关闭订单。
  - Payment：微信回调、对账。
  - Share：创建海报、分享奖励。
  - Feedback：提交反馈。
- 更新 `package.json`，增加 `npm test` 和 `npm run backend:test`。
- 新增 `backend/Dockerfile`，用于构建后端镜像。
- 新增根目录 `docker-compose.yml`，支持 `docker compose up -d --build` 部署后端服务。
- 新增 `.dockerignore`，避免把 `.git`、环境文件、构建产物打入镜像。
- 更新 `README.md`，补充后端测试、Docker Compose 部署和 KL API 环境变量说明。

验证：

- `npm test` 通过，7 组测试全部成功。
- `docker compose config` 通过。
- 当前环境 Docker daemon 未运行，`docker compose up -d --build` 返回：`Cannot connect to the Docker daemon`。
- 使用本地 Node 方式部署后端：`PORT=4180 npm start`。
- `http://localhost:4180/packages` 返回 200 和套餐列表。
- `POST http://localhost:4180/auth/wechat-login` 返回 200 和登录 token。

## 2026-05-31 - 完善小程序 17 页面功能并集成后端 API

任务：基于 `figma-implement-design` 和 17 个 Figma 节点，继续完成小程序所有功能并集成后端 API。

改动项：

- 读取 Figma 首页节点 `3306:927`，将首页升级为图片 Hero、玻璃信息层、剩余次数卡、2 列风格图片卡和固定主操作按钮的 Warm Amber Minimalism 视觉。
- 读取 Figma 个人中心节点 `3306:1287`，将我的页面升级为头像资料卡、渐变点数卡、列表式常用功能与关于入口。
- 接入 Figma 图片资产：开屏插画、首页 Hero、四个风格卡图片、用户头像。
- 新增作品集底部 Tab，并接入 `/generation/history` 展示历史作品。
- 完善上传页，增加演示照片入口，便于无本地图片时跑通全流程。
- 完善生成中页，增加取消任务能力，接入 `/generation/{taskId}/cancel`。
- 完善结果页，针对失败、部分成功、超时任务增加重试入口，接入 `/generation/{taskId}/retry`。
- 完善分享海报页，接入 `/share/create-poster` 和 `/share/reward`。
- 完善购买页，改为先创建订单再由用户模拟支付、关闭订单或发起对账，分别接入 `/orders`、`/payment/wechat/notify`、`/orders/{orderId}/close`、`/payment/reconcile`。
- 完善广告奖励页，支持完整播放发放次数和中断播放不发放次数，接入 `/credits/reward-ad`。
- 完善个人中心资料编辑，接入 `PATCH /user/profile`。
- 新增反馈页面，接入 `POST /feedback`。
- 增加 toast、列表卡、渐变点数卡、Figma 风格图片卡、反馈输入框等前端样式。

验证：

- `node --check frontend/public/mvp.js` 通过。
- `node --check backend/server.js` 通过。
- `npm test` 通过，7 组后端 API 测试全部成功。
- `PORT=4181 npm start` 可启动服务。
- `http://localhost:4181/mvp.html` 返回 200。
- `mvp.js` 中确认包含 `openWorks`、`payOrder`、`submitFeedback`、`useDemoPhoto` 等关键功能入口。
- `mvp.css` 中确认包含 `home-hero`、`profile-card`、`credits-card`、`list-card`、`feedback-input` 等 Figma 视觉样式。

## 2026-05-31 - 改造为微信原生 WXML 小程序

任务：将微信小程序前端改造成原生 `wxml/js/wxss`，参考之前的 `xinge` 小程序结构，并支持在微信开发者工具里直接导入调试。

改动项：

- 新增 `frontend/weapp/project.config.json`、`app.json`、`app.js`、`app.wxss` 和 `sitemap.json`，形成独立微信开发者工具项目。
- 新增 `frontend/weapp/utils/api.js`，封装登录、鉴权请求、额度刷新、本地图片压缩和 dataUrl 上传。
- 新增 `frontend/weapp/utils/constants.js`，沉淀 4 种写真风格、Figma 图片资产和默认视觉素材。
- 新增 19 个原生小程序页面：
  - 开屏、首页、风格选择、上传、确认、授权协议、生成中、生成结果、图片预览、保存成功、分享海报。
  - 购买、激励广告、我的、作品集、订单、常见问题、隐私协议、意见反馈。
- 首页、作品集、我的接入原生 tabBar；其它流程页使用微信原生导航。
- 小程序默认请求本地后端 `http://localhost:4180`，并在 `project.config.json` 中关闭本地调试域名校验。
- 更新 `README.md`，补充微信开发者工具导入目录、本地后端启动命令和 API 地址配置说明。

验证：

- `find frontend/weapp -name '*.js' -print0 | xargs -0 -n1 node --check` 通过。
- `npm test` 通过，7 组后端 API 测试全部成功。
- `http://localhost:4180/packages` 本地后端健康检查返回 200。

## 2026-05-31 - 新增参考 xinge/backend 的 FastAPI 后端

任务：参考 `xinge/backend` 再写一个后端，方便小程序用 Python FastAPI 服务进行本地联调。

改动项：

- 新增 `backend_fastapi/`，采用与 `xinge/backend` 类似的 `main.py`、`pyproject.toml`、`test_api.py`、`README.md` 组织方式。
- 新增 FastAPI 内存态业务后端，接口路径保持与当前微信小程序一致，无需改页面调用协议即可切换服务地址。
- 实现 Auth、User、Credit、Upload、Generation、Order、Payment、Share、Feedback 等接口。
- 生成接口支持两种模式：
  - 未配置 KL Token 时返回本地 SVG mock 作品，用于微信开发者工具快速联调。
  - 配置 `KL_API_TOKEN` 后尝试调用 KL `gpt-image-2` `/v1/images/edits`。
- 新增 `backend_fastapi/test_api.py`，使用 FastAPI `TestClient` 覆盖健康检查、登录、资料、上传、生成、历史、订单、支付、分享、反馈、广告奖励。
- 更新根目录 `README.md`，补充 FastAPI 后端启动、测试和小程序切换说明。

验证：

- `python3 -m py_compile backend_fastapi/main.py backend_fastapi/test_api.py` 通过。
- `python3 -m pytest backend_fastapi/test_api.py` 通过，4 个测试全部成功。
- `python3 backend_fastapi/test_api.py` 通过，冒烟测试全部成功。
- `python3 -m uvicorn backend_fastapi.main:app --port 8000` 可启动服务。
- `http://127.0.0.1:8000/health` 返回 `status: ok`，`/openapi.json` 返回 200。
- `npm test` 通过，7 组现有 Node 后端测试全部成功。

## 2026-05-31 - 完善 FastAPI 后端真实调用 image2 与调试信息

任务：分析“目前没有真正调用 image2 生成图片”的原因，并继续完善生成链路和小程序调试能力。

改动项：

- 将 FastAPI 后端的生成行为改为默认真实调用 KL API：
  - 未配置 `KL_API_TOKEN` 或 `KL_API_KEY` 时，任务明确失败并返回错误信息。
  - 只有显式设置 `AI_MOCK_GENERATION=1` 时才使用本地 SVG mock 图片。
- FastAPI 启动时自动读取仓库根目录 `.env`，并新增 `.env.example` 模板。
- 完善 KL `gpt-image-2` 调用：
  - 使用 multipart/form-data 调用 `/v1/images/edits`。
  - 支持 `KL_API_BASE_URL`、`KL_API_TOKEN`、`KL_IMAGE_MODEL`、`KL_IMAGE_ENDPOINT`、`KL_TIMEOUT_SECONDS`。
  - 支持 `KL_PROXY_URL=http://127.0.0.1:51004` 本地代理。
  - 记录请求目标、模型、endpoint、HTTP 状态、耗时、响应 key 和响应摘要。
- 新增 `GET /config/runtime`，用于检查当前生成模式、KL token、代理、模型和 endpoint 配置。
- 小程序生成中页新增 provider 摘要展示，能看到 real/mock、模型、endpoint、token 和代理状态。
- 小程序结果页新增调试信息面板，能看到每张图的状态、耗时、错误和 KL provider 信息。
- 更新 `backend_fastapi/README.md` 和根 `README.md`，补充真实调用、代理、mock 开关和运行状态检查说明。
- 将 KL 返回的 `b64_json` 转存为 FastAPI 内存图片资产，并在任务结果中返回 `http://127.0.0.1:8000/assets/generated/{assetId}.png`，解决小程序 `<image>` 不稳定展示 base64 data URL 的问题。
- 新增 `PUBLIC_BASE_URL` 配置，用于控制返回给小程序的图片资产 URL 前缀。

验证：

- `python3 -m pytest backend_fastapi/test_api.py` 覆盖本地 mock 流程和 KL multipart 真实请求构造，测试通过。
- `python3 backend_fastapi/test_api.py` 冒烟测试通过。
- `find frontend/weapp -name '*.js' -print0 | xargs -0 -n1 node --check` 通过。
- `npm test` 通过，现有 Node 后端测试全部成功。
- 使用 `.env` 中的真实 KL 配置完成一次 `gpt-image-2` 单风格生成：
  - `POST /generation/create` 创建任务成功。
  - KL `/v1/images/edits` 返回 HTTP 200。
  - 任务终态为 `SUCCESS`。
  - 输出 URL 为 `http://127.0.0.1:8000/assets/generated/gen_7302d68d-9cf5-4f31-9cf3-e373ac42eba0.png`。
  - 访问输出 URL 返回 HTTP 200，`content-type: image/png`。

## 2026-05-31 - 测试期生成次数改为无限

任务：测试期间把生成改成无限次，避免真实 image2 联调被额度限制阻塞。

改动项：

- FastAPI 后端新增 `AI_UNLIMITED_CREDITS` 配置，默认 `1`。
- 开启无限次数时：
  - `/credits` 返回 `unlimited: true`、`displayText: "无限"`。
  - `/generation/create` 不再校验余额。
  - 任务成功后不扣减额度。
  - `/credits/consume` 返回无限额度视图，不减少余额。
- 小程序首页、生成结果、我的、购买、激励广告页改为使用后端 `displayText`，显示“无限”。
- 更新 `.env.example`、`README.md`、`backend_fastapi/README.md` 说明无限额度开关。

验证：

- `python3 -m pytest backend_fastapi/test_api.py` 通过。
- `find frontend/weapp -name '*.js' -print0 | xargs -0 -n1 node --check` 通过。
- `npm test` 通过。
