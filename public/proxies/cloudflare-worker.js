/**
 * SK Editor — Proxy Cloudflare Workers (GRATUITO)
 * Deploy: https://workers.cloudflare.com
 * 1. Crie conta gratuita em cloudflare.com
 * 2. Workers & Pages → Create Worker → Cole este código
 * 3. Deploy → copie a URL (ex: meu-proxy.seu-usuario.workers.dev)
 * 4. Use essa URL como base para chamadas de IA/banco
 *
 * Limite gratuito: 100.000 req/dia — suficiente para uso pessoal
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // Rota de saúde: GET /health
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, proxy: 'cloudflare-worker' }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // Proxy IA: POST /ai  — body: { target, ...resto }
    if (url.pathname === '/ai' && request.method === 'POST') {
      const body = await request.json();
      const { target, ...payload } = body;
      if (!target) return new Response(JSON.stringify({ error: 'target obrigatório' }), { status: 400, headers: CORS });

      const upRes = await fetch(target, {
        method: 'POST',
        headers: Object.fromEntries(
          [...request.headers.entries()].filter(([k]) =>
            ['content-type', 'authorization', 'x-api-key', 'anthropic-version',
             'anthropic-dangerous-direct-browser-access'].includes(k.toLowerCase())
          )
        ),
        body: JSON.stringify(payload),
      });

      const text = await upRes.text();
      return new Response(text, {
        status: upRes.status,
        headers: {
          'Content-Type': upRes.headers.get('Content-Type') || 'application/json',
          ...CORS,
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Rota inválida. Use POST /ai' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  },
};
