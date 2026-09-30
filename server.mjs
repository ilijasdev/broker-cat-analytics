import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  let file;
  if (url === '/data/analytics.json' || url === '/data/rewards.json') file = path.join(ROOT, url);
  else {
    const rel = url === '/' ? 'index.html' : url.slice(1);
    file = path.join(ROOT, 'web', rel);
    if (!file.startsWith(path.join(ROOT, 'web'))) { res.writeHead(403).end(); return; }
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}`));
