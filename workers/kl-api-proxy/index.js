const UPSTREAM = 'https://api.kl-api.info';

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-kl-proxy-token',
    'access-control-max-age': '86400'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders()
    }
  });
}

function filteredRequestHeaders(headers) {
  const next = new Headers(headers);
  next.delete('host');
  next.delete('cf-connecting-ip');
  next.delete('cf-ipcountry');
  next.delete('cf-ray');
  next.delete('cf-visitor');
  next.delete('x-forwarded-proto');
  next.delete('x-real-ip');
  next.delete('x-kl-proxy-token');
  return next;
}

function filteredResponseHeaders(headers) {
  const next = new Headers(headers);
  next.delete('content-security-policy');
  next.delete('content-security-policy-report-only');
  next.delete('set-cookie');
  for (const [key, value] of Object.entries(corsHeaders())) {
    next.set(key, value);
  }
  next.set('x-kl-proxy-upstream', UPSTREAM);
  return next;
}

function authorized(request, env) {
  const expected = env.PROXY_ACCESS_TOKEN || '';
  if (!expected) return true;
  const provided = request.headers.get('x-kl-proxy-token') || '';
  return provided === expected;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (!authorized(request, env)) {
      return json({ code: 'PROXY_UNAUTHORIZED', message: 'missing or invalid x-kl-proxy-token' }, 401);
    }

    const incoming = new URL(request.url);
    if (incoming.pathname === '/' || incoming.pathname === '/health') {
      return json({
        status: 'ok',
        service: 'kl-api-proxy',
        upstream: UPSTREAM,
        protected: Boolean(env.PROXY_ACCESS_TOKEN)
      });
    }

    const upstream = new URL(incoming.pathname + incoming.search, UPSTREAM);
    const init = {
      method: request.method,
      headers: filteredRequestHeaders(request.headers),
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual'
    };

    try {
      const response = await fetch(upstream, init);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: filteredResponseHeaders(response.headers)
      });
    } catch (error) {
      return json({
        code: 'UPSTREAM_FETCH_FAILED',
        message: 'failed to reach KL API upstream',
        upstream: upstream.toString(),
        error: error instanceof Error ? error.message : String(error)
      }, 502);
    }
  }
};
