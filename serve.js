// BALLOP local server (not named server.js on purpose: Vercel would deploy that as the whole app): static files from public/ + the API in lib/api.js.
// On Vercel the same API runs as api/[...path].js and Vercel serves public/ itself.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle, send, store, DEFAULT_PASSWORD } = require('./lib/api');

const PORT = Number(process.env.PORT) || 4321;
const PUB = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  else if (p === '/admin' || p === '/admin/') p = '/admin.html';
  else if (p === '/blog' || p.startsWith('/blog/')) p = '/blog.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    const longCache = p.startsWith('/uploads/') || p.startsWith('/img/');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(f).pipe(res);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handle(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  serveStatic(req, res, url);
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${PORT} sudah dipakai (server BALLOP mungkin sudah jalan): buka http://localhost:${PORT}`);
  console.error('Atau pakai port lain: $env:PORT=4322; npm start');
  process.exit(1);
}).listen(PORT, () => {
  console.log(`BALLOP site     http://localhost:${PORT}   (data: ${store.name})`);
  console.log(`Admin dashboard http://localhost:${PORT}/admin  (password awal: ${DEFAULT_PASSWORD === 'ballop123' ? 'ballop123, ganti di Admin > Pengaturan' : 'dari env'})`);
});
