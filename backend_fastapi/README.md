# AI 影像写真馆 FastAPI Backend

这个目录参考 `xinge/backend` 的组织方式，实现一个可用于微信小程序联调的 FastAPI 后端。它与现有 `backend/server.js` 并存，接口路径保持与当前小程序一致，因此小程序只需要把 `frontend/weapp/app.js` 里的 `apiBaseUrl` 改成 FastAPI 服务地址即可切换。

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
python3 -m uvicorn backend_fastapi.main:app --reload --port 8000
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
backend_fastapi/Dockerfile
```

在微信云托管中创建服务时，构建上下文选择仓库根目录，Dockerfile 路径填写：

```text
backend_fastapi/Dockerfile
```

容器会读取云托管注入的 `PORT` 环境变量，并通过以下命令启动：

```bash
uvicorn backend_fastapi.main:app --host 0.0.0.0 --port ${PORT:-8000}
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
```

如果没有配置 COS，后端会降级到本地文件存储：

```text
DATA_DIR/objects
```

本地文件模式用于开发调试；云托管正式环境建议配置 COS，否则服务实例重建后本地文件可能丢失。

### 云托管推荐环境变量

```bash
PUBLIC_BASE_URL=https://你的云托管服务域名
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_TIMEOUT_SECONDS=600
AI_MOCK_GENERATION=0
AI_UNLIMITED_CREDITS=0
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请改成强密码
```

`/health` 会返回数据库和对象存储状态，部署后可先检查 `runtime.database` 与 `runtime.objectStorage`。

## KL API

默认是真实调用模式。必须配置 KL Token，否则生成任务会失败并在任务详情里返回明确错误，不再伪装成本地生成成功。

配置以下环境变量后会调用 KL `gpt-image-2` 图片编辑接口：

```bash
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_TIMEOUT_SECONDS=600
PUBLIC_BASE_URL=http://127.0.0.1:8000
python3 -m uvicorn backend_fastapi.main:app --reload --port 8000
```

如果本地网络需要代理：

```bash
KL_PROXY_URL=http://127.0.0.1:51004
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

KL `gpt-image-2` 经常返回 `b64_json`。后端会把 base64 图片转成内存图片资产，并在任务结果中返回可给小程序 `<image>` 直接使用的 HTTP 地址：

```text
http://127.0.0.1:8000/assets/generated/{assetId}.png
```

## 测试

```bash
python3 -m pytest backend_fastapi/test_api.py
```

如果本地没有 pytest，也可以直接用 Python 导入 FastAPI TestClient 的方式执行：

```bash
python3 backend_fastapi/test_api.py
```
