#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="${CONFIG_PATH:-workers/kl-api-proxy/wrangler.toml}"
WORKER_NAME="${WORKER_NAME:-kl-api-proxy}"
WORKER_HEALTH_URL="${WORKER_HEALTH_URL:-https://kl-api.bytestrans.info/health}"
CLOUDRUN_HEALTH_URL="${CLOUDRUN_HEALTH_URL:-https://kl-api.bytestrans.info/cloudrun/health}"
WRANGLER_HOME="${WRANGLER_HOME:-/private/tmp/wrangler-home}"
NPM_CACHE="${NPM_CACHE:-/private/tmp/npm-cache}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  cat >&2 <<'EOF'
Missing CLOUDFLARE_API_TOKEN.

Run:
  export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"

The token needs at least:
  Account resources: Include -> ade026028635934e3bcf9af5fee7af23
  Account: Workers Scripts:Edit
EOF
  exit 1
fi

cd "$ROOT_DIR"

echo "[1/6] Checking Worker syntax"
node --check workers/kl-api-proxy/index.js

echo "[2/6] Checking Wrangler authentication"
if ! HOME="$WRANGLER_HOME" npm_config_cache="$NPM_CACHE" npx wrangler whoami; then
  cat >&2 <<'EOF'
[warn] wrangler whoami failed. This often happens when an Account API Token
cannot call /memberships. Continuing because wrangler.toml already contains
account_id, and deploy may still work if the token has Workers Scripts:Edit.
EOF
fi

echo "[3/6] Listing remote Worker versions"
if ! HOME="$WRANGLER_HOME" npm_config_cache="$NPM_CACHE" \
  npx wrangler versions list --config "$CONFIG_PATH" --name "$WORKER_NAME"; then
  cat >&2 <<'EOF'
[warn] Could not list remote Worker versions.
This usually means the API token lacks Workers Scripts read/edit permissions.
The deploy step will still run, but it also requires Workers Scripts:Edit.
EOF
fi

echo "[4/6] Deploying Worker with --keep-vars"
if ! HOME="$WRANGLER_HOME" npm_config_cache="$NPM_CACHE" \
  npx wrangler deploy --config "$CONFIG_PATH" --keep-vars; then
  cat >&2 <<EOF
Deploy failed.

Create or update the Cloudflare API token with:
  Account resources: Include -> Linjinzhu@hotmail.com's Account / ade026028635934e3bcf9af5fee7af23
  Permissions:
    Account: Workers Scripts:Edit

The easiest option is Cloudflare's "Edit Cloudflare Workers" API token template,
scoped to account ade026028635934e3bcf9af5fee7af23.
EOF
  exit 1
fi

echo "[5/6] Testing Worker health endpoint"
curl -fsS "$WORKER_HEALTH_URL" | sed 's/^/[health] /'
echo

echo "[6/6] Testing CloudBase Run proxy endpoint"
headers_file="$(mktemp)"
body_file="$(mktemp)"
trap 'rm -f "$headers_file" "$body_file"' EXIT

http_status="$(
  curl -sS -D "$headers_file" -o "$body_file" -w '%{http_code}' "$CLOUDRUN_HEALTH_URL"
)"

echo "[cloudrun] HTTP $http_status"
grep -i '^x-kl-proxy-' "$headers_file" || true
sed 's/^/[cloudrun] /' "$body_file"
echo

if ! grep -qi '^x-kl-proxy-route: cloudrun' "$headers_file"; then
  cat >&2 <<'EOF'
CloudBase Run proxy did not return x-kl-proxy-route: cloudrun.
This usually means the custom domain is still bound to an old Worker version or another Worker.

Check:
  Workers & Pages -> kl-api-proxy -> Settings -> Domains & Routes
EOF
  exit 2
fi

echo "Deploy finished."
