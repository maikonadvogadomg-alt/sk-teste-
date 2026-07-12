'use strict';

const http  = require('http');
const https = require('https');
const url   = require('url');
const fs    = require('fs');
const path  = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const STATIC_DIR = path.join(__dirname, 'dist', 'public');

// ── Crash handlers para logging no deploy ────────────────────────────────────
process.on('uncaughtException',  (e) => { console.error('[SK-Server] CRASH:', e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[SK-Server] REJECT:', e); process.exit(1); });

// ── Servidor sobe IMEDIATAMENTE para healthcheck passar ──────────────────────
// Todos os handlers são definidos depois, mas o server já aceita conexões.
const server = http.createServer(router);

server.on('error', (err) => {
  console.error('[SK-Server] Erro ao iniciar:', err.code, err.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const hasStatic = fs.existsSync(path.join(STATIC_DIR, 'index.html'));
  console.log(`[SK-Server] http://0.0.0.0:${PORT}`);
  console.log(`[SK-Server] Proxy IA: /api/ai/forward`);
  console.log(`[SK-Server] Arquivos estáticos: ${hasStatic ? STATIC_DIR : 'não (modo dev)'}`);
});

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.wasm': 'application/wasm',
  '.gz':   'application/gzip',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain',
  '.webmanifest': 'application/manifest+json',
};

// ── CORS ──────────────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access');
}

// ── Lê body ───────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ── Serve arquivo estático ────────────────────────────────────────────────────
function serveStatic(reqPath, res) {
  let safePath = reqPath.replace(/\.\./g, '').replace(/\/+/g, '/') || '/';
  let filePath = path.resolve(STATIC_DIR, '.' + safePath);
  if (!filePath.startsWith(STATIC_DIR + path.sep) && filePath !== STATIC_DIR) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const isDoc = ext === '.html' || ext === '' || !ext;
  const headers = { 'Content-Type': mime };
  if (isDoc) {
    headers['Cross-Origin-Opener-Policy']   = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'credentialless';
  } else {
    headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
  }
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

// ── /api/health ───────────────────────────────────────────────────────────────
function handleHealth(req, res) {
  setCors(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ts: Date.now() }));
}

// ── /api/ai/forward ───────────────────────────────────────────────────────────
async function handleAIForward(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  try {
    const raw  = await readBody(req);
    const { apiKey, apiUrl, model, messages, stream = true, maxTokens = 8192, system } = JSON.parse(raw);
    if (!apiKey || !apiUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'apiKey e apiUrl são obrigatórios' }));
      return;
    }
    const isAnthropic = apiKey.startsWith('sk-ant');
    const endpoint = isAnthropic
      ? 'https://api.anthropic.com/v1/messages'
      : apiUrl.replace(/\/$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (isAnthropic) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const body = isAnthropic
      ? { model, messages: messages.filter(m => m.role !== 'system'), max_tokens: maxTokens, stream, system: system || messages.find(m => m.role === 'system')?.content || '' }
      : { model, messages, max_tokens: maxTokens, stream };
    const upstreamUrl = new URL(endpoint);
    const isHttps = upstreamUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    const proxyReq = lib.request({
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (isHttps ? 443 : 80),
      path: upstreamUrl.pathname + upstreamUrl.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(JSON.stringify(body)) },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.on('data', (chunk) => res.write(chunk));
      proxyRes.on('end', () => res.end());
    });
    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Upstream error: ${err.message}` }));
      }
    });
    proxyReq.write(JSON.stringify(body));
    proxyReq.end();
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
}

// ── /api/db/query ─────────────────────────────────────────────────────────────
async function handleDbQuery(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', async () => {
    try {
      const { connectionString, sql: sqlText } = JSON.parse(body);
      if (!connectionString || !sqlText) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'connectionString e sql são obrigatórios' }));
        return;
      }
      const { neon } = require('@neondatabase/serverless');
      const sql = neon(connectionString.trim());
      const t0 = Date.now();
      const result = await sql.query(sqlText);
      const rows = Array.isArray(result) ? result : (result.rows || []);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows, columns, rowCount: rows.length, command: sqlText.trim().split(' ')[0].toUpperCase(), timeMs: Date.now() - t0 }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err).slice(0, 500) }));
    }
  });
}

// ── /api/search ───────────────────────────────────────────────────────────────
async function handleSearch(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const parsed = new url.URL(req.url, `http://localhost:${PORT}`);
  const q = parsed.searchParams.get('q') || '';
  if (!q.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Parâmetro q obrigatório' }));
    return;
  }
  try {
    const jinaUrl = `https://s.jina.ai/${encodeURIComponent(q)}`;
    const upRes = await new Promise((resolve, reject) => {
      const r = https.get(jinaUrl, { headers: { 'Accept': 'application/json', 'X-Respond-With': 'no-content' } }, resolve);
      r.on('error', reject);
    });
    let bodyStr = '';
    upRes.on('data', c => { bodyStr += c; });
    upRes.on('end', () => {
      try {
        const data = JSON.parse(bodyStr);
        const results = (data.data || []).slice(0, 6).map(r => ({ title: r.title || '', url: r.url || '', snippet: (r.description || r.content || '').slice(0, 300) }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: [], raw: bodyStr.slice(0, 500) }));
      }
    });
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

// ── /api/fetch-url ────────────────────────────────────────────────────────────
async function handleFetchUrl(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const parsed = new url.URL(req.url, `http://localhost:${PORT}`);
  const target = parsed.searchParams.get('url') || '';
  if (!target.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Parâmetro url obrigatório' }));
    return;
  }
  try {
    const jinaUrl = `https://r.jina.ai/${target}`;
    const upRes = await new Promise((resolve, reject) => {
      const r = https.get(jinaUrl, { headers: { 'Accept': 'text/plain' } }, resolve);
      r.on('error', reject);
    });
    let bodyStr = '';
    upRes.on('data', c => { bodyStr += c; });
    upRes.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: bodyStr.slice(0, 8000) }));
    });
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
async function router(req, res) {
  try {
    const parsed = new url.URL(req.url || '/', `http://localhost:${PORT}`);
    const p = parsed.pathname;

    if (p === '/api/health' || p === '/api/healthz' || p === '/healthz') return handleHealth(req, res);
    if (p === '/api/ai/forward')  return handleAIForward(req, res);
    if (p === '/api/db/query')    return handleDbQuery(req, res);
    if (p === '/api/search')      return handleSearch(req, res);
    if (p === '/api/fetch-url')   return handleFetchUrl(req, res);

    if (p.startsWith('/api/')) {
      setCors(res);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rota não encontrada' }));
      return;
    }

    if (fs.existsSync(path.join(STATIC_DIR, 'index.html'))) {
      return serveStatic(p, res);
    }

    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error('[SK-Server] Router error:', err);
    if (!res.headersSent) { res.writeHead(500); res.end('Server error'); }
  }
}
