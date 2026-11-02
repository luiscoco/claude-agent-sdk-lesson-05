import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { createApiHandler, json } from './app.js';
import { PROJECT_ROOT } from './paths.js';

if (existsSync(path.join(PROJECT_ROOT, '.env'))) loadEnvFile(path.join(PROJECT_ROOT, '.env'));
const production = process.argv.includes('--production');
const port = Number(process.env.PORT ?? 4351);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('PORT must be a valid port number.');
const api = createApiHandler();
const vite = production
  ? undefined
  : await (
      await import('vite')
    ).createServer({ root: PROJECT_ROOT, server: { middlewareMode: true }, appType: 'spa' });
const clientRoot = path.join(PROJECT_ROOT, 'dist', 'client');
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = createServer((request, response) => {
  void (async () => {
    if (await api(request, response)) return;
    if (vite) {
      vite.middlewares(request, response, () => {
        response.writeHead(404);
        response.end('Not found');
      });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      json(response, 405, { error: 'Method not allowed.' });
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    let file = path.resolve(clientRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (file !== clientRoot && !file.startsWith(`${clientRoot}${path.sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
    } catch {
      if (path.extname(pathname)) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      file = path.join(clientRoot, 'index.html');
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
  })().catch((error) => {
    console.error('Host error:', error instanceof Error ? error.name : 'Unknown error');
    if (!response.headersSent)
      json(response, 500, {
        error: 'The local host could not handle the request. Check the server terminal.',
      });
    else response.end();
  });
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  console.log(
    `\nLesson 05 Tool Policy Lab: http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}\nLocal mode uses an explicit host policy router with real MCP calls. Live mode exercises SDK permissions and one-time approvals.\n`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await api.dispose();
    server.close();
    server.closeAllConnections();
    await vite?.close();
    process.exit(0);
  });
