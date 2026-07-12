/**
 * SK Editor — Proxy Vercel Edge Function (GRATUITO)
 * Deploy: https://vercel.com
 * 1. Crie conta gratuita em vercel.com
 * 2. Crie projeto → New Project → Deploy from template "Edge Function"
 * 3. Cole este arquivo em /api/proxy.js no projeto
 * 4. Faça deploy → copie a URL gerada
 *
 * Limite gratuito: 500.000 req/mês
 *
 * Estrutura mínima do projeto para Vercel:
 *   /api/proxy.js  ← este arquivo
 *   package.json   ← { "name": "sk-proxy", "version": "1.0.0" }
 */

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, proxy: 'vercel-edge' }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Método não suportado', { status: 405, headers: CORS });
  }

  const body = await request.json();
  const { target, headers: extraHeaders = {}, ...payload } = body;

  if (!target) {
    return new Response(JSON.stringify({ error: 'target obrigatório' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const upRes = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
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
