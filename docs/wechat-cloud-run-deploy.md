# 微信云托管部署 FastAPI 后端

本文档用于把当前 `backend/` FastAPI 服务部署到微信云托管。

## 部署入口

- 构建上下文：仓库根目录
- Dockerfile：`Dockerfile`
- 启动服务：`uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}`
- 健康检查：`GET /health`

云托管会注入 `PORT`，不要在控制台固定写死端口。

## 必填环境变量

```bash
PUBLIC_BASE_URL=https://你的云托管服务域名
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_TIMEOUT_SECONDS=600
AI_MOCK_GENERATION=0
AI_UNLIMITED_CREDITS=0
LOG_LEVEL=info
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请改成强密码
```

如果云托管环境需要代理访问 KL API，再配置：

```bash
KL_PROXY_URL=http://代理地址:端口
```

本地代理 `http://127.0.0.1:7890` 只适用于本机开发，不适用于云托管容器。

## 数据库

推荐使用云托管 MySQL。可以二选一配置。

方式一：

```bash
DATABASE_URL=mysql://user:password@host:3306/database
```

方式二：

```bash
MYSQL_ADDRESS=数据库地址
MYSQL_PORT=3306
MYSQL_USERNAME=用户名
MYSQL_PASSWORD=密码
MYSQL_DATABASE=数据库名
```

未配置数据库时后端会降级到容器内 SQLite，只适合临时调试。

## 图片存储

正式环境必须配置 COS，确保小程序真机可加载生成图片且实例重建后图片不丢。

```bash
COS_SECRET_ID=腾讯云 SecretId
COS_SECRET_KEY=腾讯云 SecretKey
COS_BUCKET=your-bucket-1250000000
COS_REGION=ap-shanghai
COS_PREFIX=ai-image
COS_PUBLIC_BASE_URL=https://你的 COS 公网域名
OBJECT_STORAGE_STRICT=1
```

## 控制台部署

1. 进入微信云托管控制台，创建服务。
2. 选择代码部署或上传代码包。
3. 构建上下文选择仓库根目录。
4. Dockerfile 路径填写 `Dockerfile`。
5. 健康检查路径填写 `/health`。
6. 配置上面的环境变量。
7. 部署完成后访问：

```text
https://你的服务域名/health
https://你的服务域名/config/runtime
https://你的服务域名/admin
```

## CLI 部署

已登录 CloudBase CLI 后，可以在仓库根目录执行交互式部署：

```bash
tcb cloudrun deploy
```

如果使用新版 CloudBase CLI，也可以按 CLI 提示选择云托管服务、环境、构建目录和 Dockerfile。

## 小程序配置

部署成功后，把 `frontend/weapp/app.js` 中的：

```js
apiBaseUrl: 'http://127.0.0.1:8000'
```

改成云托管服务域名：

```js
apiBaseUrl: 'https://你的服务域名'
```

同时在微信公众平台配置服务器域名：

- request 合法域名：云托管服务域名
- downloadFile / image 相关域名：云托管服务域名和 COS 公网域名

## 验证清单

```bash
python3 -m pytest backend/test_api.py
docker build -t ai-photo-backend:cloud .
docker run --rm -p 8000:8000 --env-file .env ai-photo-backend:cloud
curl http://127.0.0.1:8000/health
```

云端部署后检查：

- `/health` 返回 `status: ok`
- `/config/runtime` 中 `generationMode=real`
- `/config/runtime` 中数据库为 MySQL 且可用
- `/config/runtime` 中对象存储为 COS 且可用
- `/admin` 可登录并查看调试日志
