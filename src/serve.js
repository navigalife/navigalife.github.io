const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  const safePath = candidate.startsWith(root) ? candidate : path.join(root, '404.html');

  fs.stat(safePath, (statError, stat) => {
    const filePath = !statError && stat.isFile() ? safePath : path.join(root, '404.html');
    fs.readFile(filePath, (readError, content) => {
      if (readError) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Unable to read the built site.');
        return;
      }
      response.writeHead(filePath.endsWith('404.html') ? 404 : 200, {
        'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Naviga Life preview: http://127.0.0.1:${port}`);
});
