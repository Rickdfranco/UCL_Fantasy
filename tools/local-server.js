// Runs the app on your machine without Vercel: serves public/ and the api/ functions.
// Shows demo data unless the UEFA_* environment variables are set.
// Usage: npm start  (then open http://localhost:3000, or your Mac's address on your phone)

require('./env');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

// Adds the Vercel-style helpers the api/ functions use
function wrap(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  return res;
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const api = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (api) {
    const file = path.join(root, 'api', `${api[1]}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      req.query = Object.fromEntries(url.searchParams);
      req.body = body;
      try { await require(file)(req, wrap(res)); }
      catch (err) { wrap(res).status(500).json({ error: String(err.message || err) }); }
    });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(root, 'public', rel);
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  });
}).listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
