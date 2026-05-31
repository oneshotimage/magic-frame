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
