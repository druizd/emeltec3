const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = 8080;
const host = '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
    const target = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(root, target);

    if (!file.startsWith(root)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      response.writeHead(200, {
        'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      });
      response.end(data);
    });
  })
  .listen(port, host, () => {
    console.log(`landing-emeltec http://localhost:${port}`);
  });
