const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = __dirname;
const url = 'http://localhost:8080';
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.png': 'image/png'};
const server = http.createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, {Allow: 'GET, HEAD'}).end(); return;
  }
  let filename;
  try {
    const pathname = decodeURIComponent(new URL(request.url, url).pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    // Only serve the viewer and its model assets, never repository metadata.
    if (!['index.html', 'annotations.js', 'annotations.css'].includes(relative) &&
        !/^models\/[a-zA-Z0-9_./-]+$/.test(relative)) throw Error('Not public');
    filename = fs.realpathSync(path.resolve(root, relative));
    const resolved = path.relative(root, filename);
    if (resolved.startsWith('..') || path.isAbsolute(resolved) || !fs.statSync(filename).isFile()) throw Error('Not a file');
  } catch { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = fs.createReadStream(filename);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? 'Port 8080 is already in use. Close the previous server and try again.'
    : `Could not start the local server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(8080, '127.0.0.1', () => {
  console.log(`Object Notes: ${url}\nKeep this window open. Press Ctrl+C to stop.`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const browser = spawn('explorer.exe', [url], {stdio: 'ignore', windowsHide: true});
    browser.on('error', () => console.log(`Open ${url} in your browser.`));
  }
});
