# AI 影像写真馆 FastAPI Backend

这个目录参考 `xinge/backend` 的组织方式，实现一个可用于微信小程序联调和微信云托管部署的 FastAPI 后端。接口路径保持与当前小程序一致，因此小程序只需要把 `frontend/weapp/app.js` 里的 `apiBaseUrl` 改成服务地址即可切换。

## 已实现接口

- `GET /health`
- `POST /auth/wechat-login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /user/profile`
- `PATCH /user/profile`
- `POST /user/delete`
- `GET /credits`
- `GET /credits/logs`
- `POST /credits/consume`
- `POST /credits/reward-ad`
- `POST /upload/image`
- `POST /upload/validate`
- `POST /generation/create`
- `GET /generation/{taskId}`
- `POST /generation/{taskId}/retry`
- `POST /generation/{taskId}/cancel`
- `GET /generation/history`
- `GET /packages`
- `POST /orders`
- `GET /orders`
- `GET /orders/{orderId}`
- `POST /orders/{orderId}/close`
- `POST /payment/wechat/notify`
- `POST /payment/reconcile`
- `POST /share/create-poster`
- `POST /share/reward`
- `POST /feedback`

## 代码结构

后端按功能拆分为以下模块，详细职责和依赖方向见 `docs/BACKEND_MODULES.md`：

```text
backend/
├── main.py              # FastAPI 应用装配、异常处理、中间件、router 注册
├── core.py              # 环境配置、全局状态、运行配置、调试日志
├── catalog.py           # 写真风格和套餐常量
├── schemas.py           # Pydantic 请求模型
├── services.py          # 用户、额度、上传记录、任务展示等业务服务
├── generation.py        # KL image2 调用、生成任务线程、图片资产和海报生成
├── cloud_runtime.py     # SQLite/MySQL 快照存储与 COS/本地对象存储
└── routes/
    ├── public.py        # 小程序公开 API
    ├── admin.py         # 管理后台 API
    └── system.py        # 健康检查、运行配置、图片资产、后台静态页
```

## 管理后台

FastAPI 会直接提供静态管理后台页面：

```text
http://127.0.0.1:8000/admin
```

默认管理员账号来自环境变量：

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

已实现的管理能力：

- 概览统计：用户、任务、成功/失败图片、订单、收入、反馈、图片资产。
- 用户管理：用户列表、用户详情、额度调整。
- 生成任务：任务列表、任务详情、输出预览、失败原因、重试、取消。
- 订单管理：订单列表、关闭待支付订单。
- 反馈列表。
- 图片资产列表。
- 运行配置查看：KL、代理、mock、无限额度等配置。

## 本地启动

从仓库根目录运行：

```bash
python3 -m uvicorn backend.main:app --reload --port 8000
```

启动后可访问：

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/docs
```

微信开发者工具调试时，把 `frontend/weapp/app.js` 中的地址改为：

```js
apiBaseUrl: 'http://127.0.0.1:8000'
```

## 微信云托管部署

FastAPI 版本已提供容器入口：

```text
Dockerfile
```

在微信云托管中创建服务时，构建上下文选择仓库根目录，Dockerfile 路径填写：

```text
Dockerfile
```

容器会读取云托管注入的 `PORT` 环境变量，并通过以下命令启动：

```bash
uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-80}
```

健康检查建议使用：

```text
GET /health
```

### 数据库

后端已支持数据库持久化。为了兼容现有接口和管理后台，当前采用状态快照表 `app_snapshots` 存储用户、订单、任务、额度、调试日志等数据。

优先读取：

```bash
DATABASE_URL=mysql://user:password@host:3306/database
```

如果不配置 `DATABASE_URL`，也支持微信云托管常见 MySQL 环境变量：

```bash
MYSQL_ADDRESS=数据库地址
MYSQL_PORT=3306
MYSQL_USERNAME=用户名
MYSQL_PASSWORD=密码
MYSQL_DATABASE=数据库名
```

本地开发未配置 MySQL 时，会自动使用 SQLite：

```bash
DATA_DIR=.data
```

### 对象存储

上传图片和生成后的图片会写入对象存储。配置腾讯云 COS：

```bash
COS_SECRET_ID=腾讯云 SecretId
COS_SECRET_KEY=腾讯云 SecretKey
COS_BUCKET=your-bucket-1250000000
COS_REGION=ap-guangzhou
COS_PREFIX=ai-image
COS_PUBLIC_BASE_URL=https://你的 COS 自定义域名或 CDN 域名
OBJECT_STORAGE_STRICT=1
```

开启 COS 后，用户上传图、生成图和分享海报都会写入 COS，并向小程序返回 COS 的 HTTP/HTTPS 图片 URL。生成接口即使收到 KL 返回的远程图片 URL，也会先下载图片再转存 COS，避免小程序直接依赖第三方图片域名。

如果没有配置 COS，或 `OBJECT_STORAGE_STRICT` 未开启且 COS 上传失败，后端会降级到本地文件存储：

```text
DATA_DIR/objects
```

本地文件模式只用于开发调试；云托管正式环境建议设置 `OBJECT_STORAGE_STRICT=1`，这样 COS 写入失败会直接返回 `UPLOAD_OBJECT_STORAGE_FAILED` 或让生成任务单图失败，后台「调试日志」会记录 bucket、region、object key 和底层错误。

### 云托管推荐环境变量

```bash
PUBLIC_BASE_URL=https://你的云托管服务域名
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
WECHAT_APPID=你的微信小程序 AppID
WECHAT_SECRET=你的微信小程序 AppSecret
WECHAT_CODE2SESSION_TIMEOUT_SECONDS=10
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_IMAGE_SIZE=1024x1024
KL_TIMEOUT_SECONDS=600
KL_RETRY_5XX_COUNT=1
KL_RETRY_BACKOFF_SECONDS=120
AI_MOCK_GENERATION=0
AI_UNLIMITED_CREDITS=0
GENERATION_SECONDS_PER_IMAGE=60
LOG_LEVEL=info
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请改成强密码
```

`/health` 会返回数据库和对象存储状态，部署后可先检查 `runtime.database` 与 `runtime.objectStorage`。

## 微信登录

配置 `WECHAT_APPID` 和 `WECHAT_SECRET` 后，后端会使用微信 `jscode2session` 将小程序 `wx.login()` 返回的 code 换成稳定 `openid`，并用 `openid` 作为用户唯一标识。

未配置微信环境变量时只使用本地 mock openid，`wx.login()` 的 code 每次都会变化，重新登录会创建不同用户，不适合生产。

小程序登录时会把本地旧 `accessToken` 作为 `bindAccessToken` 传给后端。升级到真实 `openid` 后，如果旧 token 仍有效，后端会把旧用户绑定到真实 `openid`，旧作品历史继续归属同一个用户。

## KL API

默认是真实调用模式。必须配置 KL Token，否则生成任务会失败并在任务详情里返回明确错误，不再伪装成本地生成成功。

配置以下环境变量后会调用 KL `gpt-image-2` 图片编辑接口：

```bash
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
WECHAT_APPID=你的微信小程序 AppID
WECHAT_SECRET=你的微信小程序 AppSecret
WECHAT_CODE2SESSION_TIMEOUT_SECONDS=10
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_IMAGE_SIZE=1024x1024
KL_TIMEOUT_SECONDS=600
KL_RETRY_5XX_COUNT=1
KL_RETRY_BACKOFF_SECONDS=120
PUBLIC_BASE_URL=http://127.0.0.1:8000
python3 -m uvicorn backend.main:app --reload --port 8000
```

`KL_IMAGE_SIZE` 控制真实生成图片尺寸，格式为 `宽x高`，例如 `1024x1024`、`1536x1024`、`1024x1536`。如果配置了 `KL_IMAGE_SIZE`，服务端会优先使用环境变量，覆盖小程序请求里的 `size`。
`KL_RETRY_5XX_COUNT` 和 `KL_RETRY_BACKOFF_SECONDS` 用于 KL/Cloudflare 返回 500/502/503/504/524 时等待后重试。524 表示 KL 上游超过 Cloudflare 120 秒读超时，重试只能缓解临时拥堵；如果持续出现，应降低 `KL_IMAGE_SIZE` 或改用 KL 的异步生成接口。

如果本地网络需要代理：

```bash
KL_PROXY_URL=http://127.0.0.1:7890
```

云托管通过 Cloudflare Worker 中转 KL API 时，建议开启 IPv4 强制解析，避免容器没有 IPv6 出口时报 `Network is unreachable`：

```bash
KL_API_BASE_URL=https://你的-worker.workers.dev
KL_PROXY_URL=
KL_FORCE_IPV4=1
```

后端控制台日志支持分级输出：

```bash
LOG_LEVEL=debug  # 可选 debug、info、warn、error，默认 info
```

也可以把这些配置写入仓库根目录 `.env`，FastAPI 后端启动时会自动读取。仓库提供了 `.env.example` 模板。

只有显式设置以下变量时，生成接口才会返回本地 SVG mock 图片：

```bash
AI_MOCK_GENERATION=1
```

测试期默认开启无限生成次数：

```bash
AI_UNLIMITED_CREDITS=1
```

开启后 `/credits` 会返回 `unlimited: true`、`displayText: "无限"`，创建生成任务不再校验余额，任务成功后也不会扣减次数。需要恢复正式扣费逻辑时设置 `AI_UNLIMITED_CREDITS=0`。

运行状态可通过以下接口检查：

```text
GET /config/runtime
GET /health
```

服务启动时会在控制台打印 `APP_ENVIRONMENT_CHECK_START`、`APP_ENVIRONMENT_VAR`、`APP_ENVIRONMENT_CHECK_ITEM` 等环境检查日志，KL、MySQL、COS、PUBLIC_BASE_URL、端口和调试开关会逐个环境变量单独输出一行。Token、SecretKey、数据库密码和管理员密码只显示是否已配置和脱敏长度，不会输出明文。云托管排障时优先搜索 `APP_ENVIRONMENT_VAR`、`DATABASE_UNAVAILABLE`、`COS_STRICT_NOT_READY` 和后台「调试日志」。

KL `gpt-image-2` 经常返回 `b64_json`。后端会把 base64 图片转成内存图片资产，并在任务结果中返回可给小程序 `<image>` 直接使用的 HTTP 地址：

```text
http://127.0.0.1:8000/assets/generated/{assetId}.png
```

## 测试

```bash
python3 -m pytest backend/test_api.py
```

如果本地没有 pytest，也可以直接用 Python 导入 FastAPI TestClient 的方式执行：

```bash
python3 backend/test_api.py
```
