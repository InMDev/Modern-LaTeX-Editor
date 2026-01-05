#!/usr/bin/env node
/*
  Minimal local preview to emulate GitHub Pages under a subpath.
  - Serves dist/ under BASE_PATH (default: /Modern-LaTex-Editor/)
  - SPA fallback: non-asset routes return index.html
  - 404.html is served at BASE_PATH + '404.html'
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4174;
const PREFIX = (process.env.BASE_PATH || '/Modern-LaTex-Editor/').replace(/(^[^/])|([^/]$)/g, (m, a, b) => a ? '/' + a : b + '/');
const ROOT = path.resolve(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

function send(res, code, data, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(data);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      if (ext === '.html') return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      // For assets not found, return 404.
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
    send(res, 200, buf, type);
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url);
  // Redirect root to the prefix
  if (url === '/') {
    res.writeHead(302, { Location: PREFIX });
    return res.end();
  }

  if (!url.startsWith(PREFIX)) {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }

  let sub = url.slice(PREFIX.length);
  if (sub === '' || sub === '/') sub = 'index.html';

  // Serve 404.html directly
  if (sub === '404.html') {
    const p = path.join(ROOT, '404.html');
    return serveFile(res, p);
  }

  const requestedPath = path.join(ROOT, sub);
  fs.stat(requestedPath, (err, stat) => {
    if (!err && stat.isFile()) {
      return serveFile(res, requestedPath);
    }
    // SPA fallback: if it's not an asset (no extension), serve index.html
    if (!path.extname(sub)) {
      const indexPath = path.join(ROOT, 'index.html');
      return serveFile(res, indexPath);
    }
    // Otherwise 404
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Local Pages preview on http://localhost:${PORT}${PREFIX}`);
});
