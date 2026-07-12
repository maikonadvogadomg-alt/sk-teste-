/**
 * SK Editor — Proxy Node.js (GRATUITO — Railway / Render / Fly.io)
 *
 * Deploy gratuito no Railway:
 *   1. Crie conta em railway.app
 *   2. New Project → Deploy from GitHub (ou cole este arquivo)
 *   3. O Railway detecta automaticamente que é Node.js
 *   4. Copie a URL pública gerada (ex: meu-proxy.up.railway.app)
 *
 * Deploy gratuito no Render:
 *   1. Crie conta em render.com
 *   2. New → Web Service → cole este arquivo como index.js
 *   3. Runtime: Node → Build: npm install → Start: node index.js
 *
 * Instalar dependência: npm install @neondatabase/serverless
 */

'use strict';

const http  = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
};

function setCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url || '/';

  // Saúde
  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, proxy: 'node-proxy', port: PORT }));
    return;
  }

  // Proxy IA: POST /ai
  if (url === '/ai' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { target, headers: extraHeaders = {}, ...payload } = JSON.parse(body);
        if (!target) { res.writeHead(400); res.end(JSON.stringify({ error: 'target obrigatório' })); return; }

        const u = new URL(target);
        const lib = u.protocol === 'https:' ? https : http;
        const bodyStr = JSON.stringify(payload);

        const pReq = lib.request({
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...extraHeaders },
        }, (pRes) => {
          res.writeHead(pRes.statusCode, { 'Content-Type': pRes.headers['content-type'] || 'application/json', ...CORS });
          pRes.pipe(res);
        });
        pReq.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
        pReq.write(bodyStr);
        pReq.end();
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  // Proxy banco de dados PostgreSQL: POST /db
  if (url === '/db' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { connectionString, sql: sqlText } = JSON.parse(body);
        if (!connectionString || !sqlText) { res.writeHead(400); res.end(JSON.stringify({ error: 'connectionString e sql obrigatórios' })); return; }

        const { neon } = require('@neondatabase/serverless');
        const sql = neon(connectionString.trim());
        const t0 = Date.now();
        const result = await sql.query(sqlText);
        const rows = Array.isArray(result) ? result : (result.rows || []);
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rows, columns, rowCount: rows.length, timeMs: Date.now() - t0 }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: String(e.message || e).slice(0, 500) }));
      }
    });
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Rota inválida' }));
});

server.listen(PORT, () => {
  console.log(`SK Proxy rodando em http://0.0.0.0:${PORT}`);
  console.log('Rotas: GET /health | POST /ai | POST /db');
});
