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

未配置 KL Token 时，生成接口会返回本地 SVG mock 图片，便于完整联调。配置以下环境变量后会尝试调用 KL `gpt-image-2` 图片编辑接口：

```bash
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
python3 -m uvicorn backend_fastapi.main:app --reload --port 8000
```

## 测试

```bash
python3 -m pytest backend_fastapi/test_api.py
```

如果本地没有 pytest，也可以直接用 Python 导入 FastAPI TestClient 的方式执行：

```bash
python3 backend_fastapi/test_api.py
```
