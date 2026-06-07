# 开发历史

## 2026-06-07 - 使用 imagegen 重设计首页视觉稿

任务：基于 Figma 首页节点 `64:37`，使用 `$imagegen` 重新设计「AI影像写真馆」首页视觉效果。

改动项：

- 读取 Figma 首页节点，保留原有信息架构：
  - 顶部标题「AI影像写真馆」
  - Hero 区「AI艺术写真 / 一键生成」
  - 剩余次数卡片
  - 三步生成流程
  - 四个风格卡片
  - 底部主按钮「立即制作」
  - 底部导航「首页 / 作品集 / 我的」
- 使用 `$imagegen` 生成高保真移动端首页视觉稿。
- 新增设计稿文件：`docs/design/home-redesign-imagegen-20260607.png`。

验证：

- 已通过本地图片预览确认设计稿为竖版移动端 UI，非空图，整体方向正确。

## 2026-06-07 - 移除 SQLite 持久化逻辑

任务：生产和本地开发统一使用 MySQL，去掉 SQLite 数据库持久化分支。

改动项：

- `SnapshotStore` 改为 MySQL-only。
- 未配置 `DATABASE_URL` 或微信云托管 MySQL 环境变量时，数据库状态明确返回不可用，不再创建 `.data/backend.db`。
- 移除 SQLite schema、SQLite 连接、SQLite 表统计和 SQLite 保存逻辑。
- API 回归测试改为进程内状态运行，不再依赖 SQLite 文件。
- 同步更新 `backend/README.md`、`docs/SPEC.md`、`docs/wechat-cloud-run-deploy.md`、`docs/DATABASE_SCHEMA.md` 和 `docs/BACKEND_MODULES.md`。

验证：

- `python3 -m py_compile backend/cloud_runtime.py backend/core.py backend/test_api.py scripts/migrate_legacy_snapshot.py` 通过。
- `python3 -m pytest backend/test_api.py` 通过。

## 2026-06-07 - 优化登录和登出接口耗时

任务：排查登录、登出接口耗时约 4 秒的问题，并降低认证链路的数据库写入成本。

原因：

- 登录和登出都会触发 `persist_state()`。
- 业务表拆分后，旧的 `persist_state()` 仍采用全量保存策略：删除并重写所有业务表。
- 当 `generation_tasks`、`generation_images`、`uploads`、`generated_assets`、`debug_logs` 等历史数据变多时，认证接口也会被迫重写大量无关数据。
- 登录还额外包含小程序 `wx.login()`、后端微信 `code2session` 和云网络链路耗时。

改动项：

- 新增 `SnapshotStore.save_auth_state()`，只同步认证相关数据：
  - `users`
  - `auth_tokens`
  - `refresh_tokens`
  - `credits`
  - `credit_logs`
- 新增 `persist_auth_state()`。
- 登录创建用户、绑定 openid、更新用户信息、签发 token 改为轻量持久化。
- 登出删除 access token 后改为轻量持久化，不再重写生成任务和图片表。
- 新增测试，确保 auth 持久化不会清空 `generation_tasks` 和 `generation_images`。

验证：

- 本地模拟 200 个历史任务、800 张生成图记录后，登录约 14ms，登出约 6ms。
- `python3 -m py_compile backend/cloud_runtime.py backend/core.py backend/services.py backend/routes/public.py backend/test_api.py` 通过。
- `python3 -m pytest backend/test_api.py` 通过，20 个测试全部成功。

## 2026-06-07 - 支持生成中任务回访并拆分数据库业务表

任务：生成任务耗时较长时，用户可退出生成中页，从作品集重新进入正在生成的任务；同时将后端持久化从单表快照升级为真实业务表，便于后续维护、查询和运营。

改动项：

- 小程序生成中页底部新增“返回作品集”，返回时不取消后端任务。
- 作品集新增“正在生成”任务卡片，展示任务状态、进度、预计剩余时间和风格信息。
- 点击作品集里的未完成任务，可携带 `taskId` 重新进入生成中页继续轮询进度。
- 后端数据库持久化从 `app_snapshots` 快照表升级为业务表：
  - `users`
  - `auth_tokens`
  - `refresh_tokens`
  - `credits`
  - `credit_logs`
  - `uploads`
  - `generation_tasks`
  - `generation_images`
  - `orders`
  - `feedback`
  - `ad_rewards`
  - `generated_assets`
  - `admin_tokens`
  - `debug_logs`
- 保留 `app_snapshots` 作为旧数据迁移兼容：业务表为空时会尝试读取旧快照，后续保存写入新业务表。
- MySQL 写入使用事务并加锁，降低并发 `persist_state()` 时的数据覆盖风险。
- 新增 `docs/DATABASE_SCHEMA.md`，补充数据库名来源、表结构用途、关键关系和常用运营查询。
- 同步更新 `backend/README.md`、`docs/wechat-cloud-run-deploy.md` 和 `docs/SPEC.md`。

验证：

- `node --check frontend/weapp/pages/works/index.js` 通过。
- `node --check frontend/weapp/pages/generating/index.js` 通过。
- 小程序 `app.json`、作品集页和生成中页 JSON 解析通过。
- `python3 -m py_compile backend/cloud_runtime.py backend/core.py backend/test_api.py` 通过。
- `python3 -m pytest backend/test_api.py` 通过，18 个测试全部成功。

## 2026-06-07 - 增加旧快照到业务表的显式迁移脚本

任务：说明并实现如何把旧 `app_snapshots` 里的历史数据同步到新的业务表。

改动项：

- `SnapshotStore` 新增 `load_legacy_snapshot()`、`table_counts()` 和 `migrate_legacy_snapshot()`。
- 新增 `scripts/migrate_legacy_snapshot.py`：
  - `--dry-run` 只检查旧快照和业务表行数。
  - 默认仅在业务表为空时迁移。
  - `--force` 可明确覆盖已有业务表数据。
  - `--json` 支持机器可读输出。
- `docs/DATABASE_SCHEMA.md` 补充旧数据迁移命令和迁移后 SQL 检查方式。
- 新增测试覆盖旧快照迁移到业务表。

验证：

- `python3 -m py_compile backend/cloud_runtime.py backend/test_api.py scripts/migrate_legacy_snapshot.py` 通过。
- `python3 -m pytest backend/test_api.py` 通过，19 个测试全部成功。

## 2026-06-07 - 支持迁移后删除旧快照表

任务：旧数据迁移到业务表并验证后，支持安全删除 `app_snapshots`。

改动项：

- `SnapshotStore` 新增 `drop_legacy_snapshot_table()`。
- `scripts/migrate_legacy_snapshot.py` 新增：
  - `--drop-legacy`：迁移成功后删除旧 `app_snapshots`。
  - `--drop-without-migration`：业务表已有数据且确认不需要旧快照时，允许直接删除旧表。
- `docs/DATABASE_SCHEMA.md` 补充删除旧表命令和删除前检查建议。
- 测试覆盖迁移后删除旧表，确认新业务表数据仍保留。

验证：

- `python3 -m py_compile backend/cloud_runtime.py backend/test_api.py scripts/migrate_legacy_snapshot.py` 通过。
- `python3 -m pytest backend/test_api.py` 通过，19 个测试全部成功。

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
  - 支持 `KL_PROXY_URL=http://127.0.0.1:7890` 本地代理。
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

## 2026-05-31 - 实现管理后台与 FastAPI 管理接口

任务：新增 `frontend/admin/` 管理后台，并在 `backend_fastapi/` 实现管理后台接口。

改动项：

- 新增 `frontend/admin/` 静态管理后台，无需打包，由 FastAPI 直接通过 `/admin` 提供。
- 新增管理登录，支持 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 环境变量。
- 新增 `/admin/api/*` 管理接口：
  - `POST /admin/api/login`
  - `POST /admin/api/logout`
  - `GET /admin/api/me`
  - `GET /admin/api/runtime`
  - `GET /admin/api/stats`
  - `GET /admin/api/users`
  - `GET /admin/api/users/{userId}`
  - `POST /admin/api/users/{userId}/credits`
  - `GET /admin/api/tasks`
  - `GET /admin/api/tasks/{taskId}`
  - `POST /admin/api/tasks/{taskId}/retry`
  - `POST /admin/api/tasks/{taskId}/cancel`
  - `GET /admin/api/orders`
  - `POST /admin/api/orders/{orderId}/close`
  - `GET /admin/api/feedback`
  - `GET /admin/api/assets`
- 管理后台页面支持：
  - 概览统计。
  - 用户列表、用户详情、额度调整。
  - 生成任务列表、输出预览、任务详情、重试、取消。
  - 订单列表与关闭待支付订单。
  - 反馈列表。
  - 图片资产列表。
  - KL 运行配置查看。
- 更新 `.env.example`、`README.md`、`backend_fastapi/README.md`，补充管理后台访问地址和账号配置。

验证：

- `python3 -m pytest backend_fastapi/test_api.py` 覆盖管理登录、统计、用户、额度、任务、图片资产、反馈、后台页面访问，测试通过。
- `python3 -m py_compile backend_fastapi/main.py backend_fastapi/test_api.py` 通过。
- `node --check frontend/admin/app.js` 通过。

## 2026-05-31 - 补齐小程序登录与注销流程

任务：参考 Figma 登录/个人中心相关视觉稿，为小程序补齐用户登录和注销能力。

说明：

- Figma MCP 当前返回 `token_expired`，无法获取节点 `3306:1707`、`3306:1669`、`3306:1931`、`3306:1287` 的设计上下文和截图。
- 本次先按项目已有 Warm Minimalism 视觉体系实现功能闭环，后续 Figma 重新登录后可继续做像素级对齐。

改动项：

- 新增 `pages/login/index` 微信原生登录页，支持头像选择、昵称填写、协议勾选、微信登录。
- 开屏页不再自动登录，未登录时点击进入登录页，已登录时进入首页。
- `App.ensureLogin()` 改为只校验登录态，不再静默登录。
- 新增 `App.login()`、`App.clearSession()`，统一处理登录态写入和清理。
- `utils/api.js` 新增 `logout()`，调用 `/auth/logout` 后清空本地登录态。
- 首页、作品集、个人中心在未登录时跳转登录页。
- 个人中心支持未登录态展示、登录入口、退出登录、注销账号。
- FastAPI 和 Node 后端登录接口支持保存 `userInfo.nickname`、`userInfo.avatarUrl`。

验证：

- `python3 -m pytest backend_fastapi/test_api.py` 覆盖登录保存昵称头像，测试通过。
- `find frontend/weapp -name '*.js' -print0 | xargs -0 -n1 node --check` 通过。
- `npm test` 通过。

## 2026-05-31 - 按 Figma 方向升级小程序我的页面

任务：参考 Figma 节点 `3306:1287` 实现小程序“我的”页面。

说明：

- Figma MCP 当前仍返回 `token_expired`，无法获取该节点设计上下文和截图。
- 本次按项目已有 Figma Warm Minimalism 视觉体系实现页面结构和交互，待 Figma MCP 重新登录后可继续做 1:1 视觉对齐。

改动项：

- 将“我的”页从基础列表升级为顶部暖色资料 Hero。
- 增加头像、昵称、用户 ID 简写和编辑资料入口。
- 增加生成次数卡，展示“无限”展示额度和后台可管理的实际额度。
- 增加四宫格快捷入口：我的作品、订单记录、购买次数、领取奖励。
- 服务支持区改为分组列表：常见问题、意见反馈、隐私与协议。
- 未登录态改为同一视觉体系下的登录引导卡。
- 保留退出登录与删除账号操作区。

验证：

- `find frontend/weapp -name '*.js' -print0 | xargs -0 -n1 node --check` 通过。
- `python3 -m pytest backend_fastapi/test_api.py` 通过。
- `npm test` 通过。
- `npm test` 通过。

## 2026-05-31 - 修复管理后台静态资源 404

任务：修复访问 `/admin` 时管理后台没有样式，`/styles.css` 和 `/app.js` 404 的问题。

改动项：

- 将管理后台 HTML 中的资源引用从相对路径改为绝对路径 `/admin/styles.css` 和 `/admin/app.js`。
- 将 `GET /admin` 改为 307 跳转到 `/admin/`，避免浏览器把相对资源解析到站点根路径。

验证：

- `GET /admin` 返回 307。
- `GET /admin/` 返回 200。
- `GET /admin/styles.css` 返回 200。
- `GET /admin/app.js` 返回 200。
- `python3 -m pytest backend_fastapi/test_api.py` 通过。
- `node --check frontend/admin/app.js` 通过。

## 2026-05-31 - 管理后台支持管理用户剩余次数

任务：管理后台支持管理用户的剩余生成次数。

改动项：

- 管理后台用户列表增加“实际额度”列，在无限测试模式下也能看到真实可配置的剩余次数。
- 用户操作从固定“加10次”升级为“管理次数”：
  - 输入 `20` 可直接设置目标剩余次数为 20。
  - 输入 `+10` 可增加 10 次。
  - 输入 `-3` 可减少 3 次。
- `/admin/api/users/{userId}/credits` 支持两种管理方式：
  - `{ "amount": 10 }` 增减额度。
  - `{ "balance": 20 }` 设置目标剩余次数。
- `/credits` 返回中新增 `actualBalance`、`actualTotalCredits`，用于区分无限测试显示值和实际额度。

验证：

- `python3 -m pytest backend_fastapi/test_api.py` 覆盖额度增加和设置目标余额，测试通过。
- `python3 -m py_compile backend_fastapi/main.py backend_fastapi/test_api.py` 通过。
- `node --check frontend/admin/app.js` 通过。
