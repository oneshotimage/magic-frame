# Cloudflare Backend Deploy

This project includes a Cloudflare Workers backend in `worker/index.js`.

## What It Deploys

- Worker name: `ai-image-backend`
- Entry: `worker/index.js`
- Persistent state: Durable Object binding `API_STATE`
- Config: `wrangler.toml`

The Worker implements the mini-program API surface used by the current frontend:

- auth: `/auth/wechat-login`, `/auth/refresh-token`, `/auth/logout`
- user: `/user/profile`, `/user/delete`
- credits: `/credits`, `/credits/logs`, `/credits/consume`, `/credits/reward-ad`
- upload: `/upload/file`, `/upload/image`, `/upload/validate`
- generation: `/generation/create`, `/generation/history`, `/generation/:id`, retry/cancel
- packages, orders, payment mock, share, feedback

Image generation calls KL API `gpt-image-2` through the OpenAI-compatible multipart image edit endpoint when `AI_MOCK_GENERATION=0`.
The Worker stores returned images under `/assets/generated/...` so the mini-program only needs the Worker domain configured.

Required secret:

```bash
npx wrangler secret put KL_API_TOKEN
```

Set `AI_MOCK_GENERATION=1` only when you intentionally want local mock SVG output for debugging.

## Deploy

Authenticate once:

```bash
npx wrangler login
npx wrangler whoami
```

Deploy:

```bash
npm run worker:deploy
```

When the local network requires the proxy at `http://127.0.0.1:51004`, run Wrangler with proxy variables and a writable temporary npm cache:

```bash
HTTPS_PROXY=http://127.0.0.1:51004 \
HTTP_PROXY=http://127.0.0.1:51004 \
ALL_PROXY=http://127.0.0.1:51004 \
npm_config_proxy=http://127.0.0.1:51004 \
npm_config_https_proxy=http://127.0.0.1:51004 \
npm_config_cache=/private/tmp/npm-cache \
XDG_CONFIG_HOME=/private/tmp/xdg-config \
npx wrangler deploy
```

After deploy, set the mini-program backend URL in `frontend/weapp/app.js`:

```js
apiBaseUrl: 'https://ai-image-backend.<your-subdomain>.workers.dev'
```

## CI Token Alternative

For non-interactive deploys, create a Cloudflare API token from the "Edit Cloudflare Workers" template and run:

Required token scope:

- Account Resources: include `Linjinzhu@hotmail.com's Account` / `ade026028635934e3bcf9af5fee7af23`
- Account permissions: `Workers Scripts:Edit` and `Account Settings:Read`
- If using custom routes later: `Workers Routes:Edit` and `Zone:Read`

```bash
export CLOUDFLARE_API_TOKEN="..."
HTTPS_PROXY=http://127.0.0.1:51004 \
HTTP_PROXY=http://127.0.0.1:51004 \
ALL_PROXY=http://127.0.0.1:51004 \
npm_config_cache=/private/tmp/npm-cache \
XDG_CONFIG_HOME=/private/tmp/xdg-config \
npx wrangler deploy
```
