/**
 * Server untuk Dashboard Keuangan di VPS.
 * Serve static files + route /api/* ke Vercel-style handlers.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3001;
const STATIC_DIR = path.join(ROOT, 'static');

// Load API handlers
const handlers = {};
const apiFiles = [
  'config', 'summary', 'upload', 'ad-spend',
  'telegram-daily', 'telegram-test', 'import-samples',
  'folder-monitor', 'folder-run',
];

for (const name of apiFiles) {
  try {
    handlers[name] = require(path.join(ROOT, 'api', name));
  } catch (e) {
    console.error(`[server] Failed to load api/${name}.js:`, e.message);
  }
}

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(url, res) {
  // Strip /static/ prefix — files are directly in STATIC_DIR
  const cleanUrl = url.startsWith('/static/') ? url.slice(7).replace(/^\//, '') : (url === '/' ? 'index.html' : url.slice(1));
  let filePath = path.join(STATIC_DIR, cleanUrl);
  
  // Fallback untuk SPA: semua route selain /api/ serve index.html
  if (!url.startsWith('/api/') && !url.startsWith('/static/')) {
    if (!fs.existsSync(filePath)) {
      filePath = path.join(STATIC_DIR, 'index.html');
    }
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Owner-Pin, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routing
  const apiMatch = pathname.match(/^\/api\/([^/]+)/);
  if (apiMatch) {
    const handlerName = apiMatch[1];
    const handler = handlers[handlerName];
    if (handler) {
      // Clone headers untuk Vercel API compatibility
      const vercelReq = Object.assign(req, {
        query: Object.fromEntries(url.searchParams),
        body: null,
      });
      
      // Parse body untuk POST
      if (req.method === 'POST') {
        const buffers = [];
        for await (const chunk of req) buffers.push(chunk);
        const rawBody = Buffer.concat(buffers).toString('utf-8');
        if (rawBody) {
          try {
            vercelReq.body = JSON.parse(rawBody);
          } catch {
            vercelReq.body = rawBody;
          }
        }
      }

      try {
        await handler(vercelReq, res);
      } catch (e) {
        console.error(`[server] Error in /api/${handlerName}:`, e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message || 'Internal server error' }));
      }
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'API endpoint tidak ditemukan' }));
    return;
  }

  // Static files
  if (serveStatic(pathname, res)) return;

  // Fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[server] Dashboard Keuangan running on http://0.0.0.0:${PORT}`);
  console.log(`[server] Static: ${STATIC_DIR}`);
  console.log(`[server] API handlers loaded: ${Object.keys(handlers).length}`);
});
