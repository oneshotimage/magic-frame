# KL API Proxy Worker

这个 Worker 只把请求转发到：

```text
https://api.kl-api.info
```

用于云托管无法直连 KL API、但可以访问 Cloudflare Worker HTTPS 域名的场景。

## 部署

先登录 Cloudflare：

```bash
unset CLOUDFLARE_API_TOKEN
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache npx wrangler login
```

如果你使用的是 `CLOUDFLARE_API_TOKEN`，需要确认 token 属于 `wrangler.toml`
里的账号，并至少具备：

```text
Account:Read
Workers Scripts:Edit
```

最省事的方式是在 Cloudflare 控制台创建 **Edit Cloudflare Workers** 模板 token。
如果当前 shell 里有错误或过期的 `CLOUDFLARE_API_TOKEN`，Wrangler 会优先使用它，
这时即使执行了 `wrangler login` 也可能继续报 `Authentication error [code: 10000]`，
所以本地交互部署建议先 `unset CLOUDFLARE_API_TOKEN`。

部署：

```bash
HOME=/private/tmp/wrangler-home npm_config_cache=/private/tmp/npm-cache \
npx wrangler deploy --config workers/kl-api-proxy/wrangler.toml
```

部署成功后会得到类似：

```text
https://kl-api-proxy.<your-subdomain>.workers.dev
```

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
