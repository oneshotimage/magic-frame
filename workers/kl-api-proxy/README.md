# KL API Proxy Worker

这个 Worker 默认把请求转发到：

```text
https://api.kl-api.info
```

同时支持把 `/cloudrun/*` 转发到微信云托管：

```text
https://images-3-264959-8-1439090877.sh.run.tcloudbase.com
```

用于云托管无法直连 KL API、或小程序需要通过 Cloudflare 域名访问后端的场景。

## 部署

先登录 Cloudflare：

```bash
unset CLOUDFLARE_API_TOKEN
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache npx wrangler login
```

如果你使用的是 `CLOUDFLARE_API_TOKEN`，需要确认 token 属于 `wrangler.toml`
里的账号，并至少具备：

```text
Account resources: Include -> ade026028635934e3bcf9af5fee7af23
Account: Workers Scripts:Edit
Account: Account Settings:Read
User: User Details:Read
```

最省事的方式是在 Cloudflare 控制台创建 **Edit Cloudflare Workers** 模板 token。
如果当前 shell 里有错误或过期的 `CLOUDFLARE_API_TOKEN`，Wrangler 会优先使用它，
这时即使执行了 `wrangler login` 也可能继续报 `Authentication error [code: 10000]`，
所以本地交互部署建议先 `unset CLOUDFLARE_API_TOKEN`。

部署：

```bash
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache \
npx wrangler deploy --config workers/kl-api-proxy/wrangler.toml --keep-vars
```

也可以使用仓库脚本完成语法检查、认证检查、部署和健康检查：

```bash
export CLOUDFLARE_API_TOKEN="你的 Cloudflare API Token"
./scripts/deploy_cloudflare_worker.sh
```

默认会测试：

```text
https://kl-api.bytestrans.info/health
https://kl-api.bytestrans.info/cloudrun/health
```

如果使用其他 Worker 域名，可临时覆盖：

```bash
WORKER_HEALTH_URL=https://你的域名/health \
CLOUDRUN_HEALTH_URL=https://你的域名/cloudrun/health \
./scripts/deploy_cloudflare_worker.sh
```

部署成功后会得到类似：

```text
https://kl-api-proxy.<your-subdomain>.workers.dev
```

## 同步远程配置

如果部署时出现：

```text
The local configuration being used differs from the remote configuration of your Worker set via the Cloudflare Dashboard
```

先查看远程版本：

```bash
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache \
npx wrangler versions list --config workers/kl-api-proxy/wrangler.toml --name kl-api-proxy
```

查看某个版本详情：

```bash
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache \
npx wrangler versions view <version-id> --config workers/kl-api-proxy/wrangler.toml --name kl-api-proxy --json
```

把远程配置里 Dashboard 新增的 `vars`、`routes`、`domains`、bindings 合并回 `wrangler.toml` 后再部署。

如果只是不想覆盖 Dashboard 里配置的环境变量，部署时必须带 `--keep-vars`：

```bash
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache \
npx wrangler deploy --config workers/kl-api-proxy/wrangler.toml --keep-vars
```

本项目的 `wrangler.toml` 已显式保留自定义域名路由：

```toml
routes = [
  { pattern = "kl-api.bytestrans.info", zone_name = "bytestrans.info", custom_domain = true }
]
```

`KL_PROXY_ACCESS_TOKEN` 属于敏感变量，不写入 `wrangler.toml`。如果它已在 Dashboard 里配置，使用 `--keep-vars` 部署会保留它。

## 后端配置

把云托管里的 KL base URL 改成 Worker 地址：

```bash
KL_API_BASE_URL=https://kl-api-proxy.<your-subdomain>.workers.dev
KL_IMAGE_ENDPOINT=/v1/images/edits
KL_PROXY_URL=
KL_FORCE_IPV4=1
KL_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36
```

后端仍然会把 `Authorization: Bearer <KL_API_TOKEN>` 转发给 KL API。

如果后端请求 Worker 返回 Cloudflare `Error 1010: browser_signature_banned`，请求是在 Worker 运行前被 Cloudflare 安全规则拦截。请在 Cloudflare 控制台关闭 Browser Integrity Check/Bot Fight Mode，或给 Worker 域名添加 WAF Skip 规则。

## 小程序后端代理

如果要让小程序通过 Worker 访问微信云托管后端，把小程序 `apiBaseUrl` 配成：

```text
https://kl-api-proxy.<your-subdomain>.workers.dev/cloudrun
```

或者自定义域名：

```text
https://kl-api.bytestrans.info/cloudrun
```

请求示例：

```text
GET /cloudrun/health -> https://images-3-264959-8-1439090877.sh.run.tcloudbase.com/health
POST /cloudrun/auth/wechat-login -> https://images-3-264959-8-1439090877.sh.run.tcloudbase.com/auth/wechat-login
```

`PROXY_ACCESS_TOKEN` 只保护 KL API 代理，不保护 `/cloudrun/*`。小程序请求默认不会带 `x-kl-proxy-token`，所以后端代理路径必须公开给小程序访问。

如果要换云托管服务域名，修改 `wrangler.toml`：

```toml
CLOUDRUN_UPSTREAM = "https://新的云托管域名"
```

## 可选访问保护

如果不想让 Worker 成为公开代理，可设置 Worker secret：

```bash
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache \
npx wrangler secret put PROXY_ACCESS_TOKEN --config workers/kl-api-proxy/wrangler.toml
```

启用后，请求必须带：

```text
x-kl-proxy-token: 你的PROXY_ACCESS_TOKEN
```

FastAPI 后端配置同一个值即可自动带上这个 header：

```bash
KL_PROXY_ACCESS_TOKEN=你的PROXY_ACCESS_TOKEN
```
