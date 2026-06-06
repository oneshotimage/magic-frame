# 微信云托管部署 FastAPI 后端

本文档用于把当前 `backend/` FastAPI 服务部署到微信云托管。

## 部署入口

- 构建上下文：仓库根目录
- Dockerfile：`Dockerfile`
- 启动服务：`uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-80}`
- 健康检查：`GET /health`

镜像默认监听 80，云托管如果注入 `PORT` 则优先使用注入值。服务配置里的容器端口、探针端口和应用监听端口必须一致；如果探针访问 80，就不要让应用只监听 8000。

## 必填环境变量

```bash
PUBLIC_BASE_URL=https://你的云托管服务域名
KL_API_BASE_URL=https://api.kl-api.info
KL_API_TOKEN=你的 KL API Token
KL_IMAGE_MODEL=gpt-image-2
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_IMAGE_SIZE=1024x1024
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

如果使用 Cloudflare Worker 中转 KL API，云托管里推荐配置：

```bash
KL_API_BASE_URL=https://你的-worker.workers.dev
KL_PROXY_URL=
KL_FORCE_IPV4=1
KL_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36
```

`KL_FORCE_IPV4=1` 会让后端访问 KL/Worker 时只使用 IPv4 解析结果，避免容器没有 IPv6 出口时报 `Network is unreachable`。
`KL_USER_AGENT` 会覆盖 Python 默认请求标识，避免 Cloudflare Browser Integrity Check 把云托管后端识别成异常客户端。

如果仍然返回 Cloudflare `Error 1010: browser_signature_banned`，说明请求在 Worker 执行前被 Cloudflare 安全规则拦截。需要到 Cloudflare 控制台关闭或跳过对应规则：

- Security / Settings：关闭 Browser Integrity Check。
- Security / Bots：关闭 Bot Fight Mode 或 Super Bot Fight Mode。
- WAF Custom Rules：为 Worker 域名添加 Skip 规则，跳过 Browser Integrity Check / Bot Fight Mode / WAF Managed Rules。

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
OBJECT_STORAGE_REMOTE_TIMEOUT_SECONDS=60
OBJECT_STORAGE_REMOTE_MAX_BYTES=12582912
```

`OBJECT_STORAGE_STRICT=1` 表示云上不允许降级到容器本地文件。用户上传图片、KL 返回的 base64 图片、KL 返回的远程图片 URL 和分享海报都会写入 COS；如果 COS 写入失败，接口或生成任务会保留明确错误，后台「调试日志」可查看 bucket、region、object key、HTTP 状态和异常摘要。

## 控制台部署

1. 进入微信云托管控制台，创建服务。
2. 选择代码部署或上传代码包。
3. 构建上下文选择仓库根目录。
4. Dockerfile 路径填写 `Dockerfile`。
5. 容器端口填写 `80`，健康检查路径填写 `/health`。
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

## 同步 `.env` 到云托管

云托管不会自动读取本地 `.env`，环境变量需要通过控制台或 CLI 单独配置。仓库提供了同步辅助脚本：

```bash
python3 scripts/sync_cloudrun_env.py --env-file .env
```

默认只做 dry-run，会脱敏显示即将同步的变量，并提示有风险的云上配置。确认无误后执行：

```bash
python3 scripts/sync_cloudrun_env.py \
  --env-id 你的云开发环境ID \
  --service-name 你的云托管服务名 \
  --apply
```

脚本底层使用当前 CLI 支持的：

```bash
tcb run service:config --envParams
```

注意：

- 不要把 `KL_PROXY_URL=http://127.0.0.1:7890` 同步到云托管，容器访问不到你本机代理。
- 正式环境建议 `AI_UNLIMITED_CREDITS=0`。
- `ADMIN_PASSWORD` 必须改成强密码。
- 脚本不会把 Secret 写入仓库文件；只有加 `--print-envparams` 才会输出明文参数，慎用。

## Dockerfile 内置环境变量临时方案

如果云托管控制台环境变量没有生效，可以临时把 `.env` 渲染成带 `ENV` 指令的 Dockerfile：

```bash
python3 scripts/render_dockerfile_env.py \
  --env-file .env \
  --base-dockerfile Dockerfile \
  --output Dockerfile.env
```

如果脚本提示风险配置但你确认要继续：

```bash
python3 scripts/render_dockerfile_env.py \
  --env-file .env \
  --base-dockerfile Dockerfile \
  --output Dockerfile.env \
  --allow-risk
```

然后云托管部署时 Dockerfile 路径填写：

```text
Dockerfile.env
```

注意：

- 这是临时排障方案，Secret 会进入 Dockerfile、镜像层和镜像历史；生产长期方案仍建议使用云托管环境变量或密钥管理。
- 修改 `.env` 后必须重新运行脚本生成 `Dockerfile.env`，再重新部署镜像。
- `Dockerfile.env` 已加入 `.gitignore`，不要提交。
- 云托管里如果同时配置了同名环境变量，运行时系统环境变量通常会覆盖镜像内 `ENV`。

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
docker run --rm -p 8000:80 --env-file .env ai-photo-backend:cloud
curl http://127.0.0.1:8000/health
```

云端部署后检查：

- `/health` 返回 `status: ok`
- `/config/runtime` 中 `generationMode=real`
- `/config/runtime` 中数据库为 MySQL 且可用
- `/config/runtime` 中对象存储为 COS 且可用
- `/config/runtime` 中 `objectStorage.strict=true`
- `/admin` 可登录并查看调试日志
