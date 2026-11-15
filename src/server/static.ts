/**
 * Static file serving for the built client plus the small JSON API.
 *
 * Rules:
 * - `dist/client` may not exist (you are running `npm run dev` and Vite serves
 *   the client instead). That is not an error: we answer with a friendly page.
 * - Unknown paths without a file extension fall back to index.html so the
 *   client can own routing (`?room=CODE` links, history paths later).
 * - Anything under /api that we do not recognise is a JSON 404, never HTML,
 *   so `fetch('/api/...')` in the client fails loudly instead of parsing HTML.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { GAME_VERSION } from '@shared/version';
import { CLIENT_DIST_DIR } from './config.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const INDEX_HTML = path.join(CLIENT_DIST_DIR, 'index.html');

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  // Hashed assets get long caching, everything else stays fresh.
  const immutable = filePath.includes(`${path.sep}assets${path.sep}`) && /\.[0-9a-f]{8,}\./.test(filePath);
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) sendText(res, 500, 'Could not read file');
      else res.end();
    })
    .pipe(res);
}

function missingBuildPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Days of Lorac: no build yet</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #14231d; color: #e8dcc0;
    font: 16px/1.6 ui-serif, Georgia, "Times New Roman", serif; }
  main { max-width: 34rem; padding: 2.5rem; border: 1px solid #6f7d5c;
    border-radius: 10px; background: #1b2f26; }
  h1 { margin: 0 0 .75rem; font-size: 1.4rem; letter-spacing: .02em; }
  code { background: #0e1a15; padding: .1rem .35rem; border-radius: 4px; }
  a { color: #9ec9a8; }
</style>
</head>
<body>
<main>
  <h1>Days of Lorac: client build not found</h1>
  <p>The game server is up (v${GAME_VERSION}), but <code>dist/client</code> is missing.</p>
  <p>For development run <code>npm run dev</code> and open
     <a href="http://localhost:5173">http://localhost:5173</a>.</p>
  <p>For the production build run <code>npm run build</code> then reload this page.</p>
  <p>Health check: <a href="/api/health">/api/health</a></p>
</main>
</body>
</html>`;
}

/** Request handler for static client files. Mounted after the /api routes. */
export function handleStaticRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, 400, 'Bad request path');
    return;
  }

  // Resolve inside the dist dir and refuse anything that escapes it.
  const relative = pathname.replace(/^\/+/, '');
  const target = path.resolve(CLIENT_DIST_DIR, relative);
  const insideDist = target === CLIENT_DIST_DIR || target.startsWith(CLIENT_DIST_DIR + path.sep);

  if (insideDist && relative !== '' && isFile(target)) {
    serveFile(req, res, target);
    return;
  }

  if (existsSync(INDEX_HTML)) {
    serveFile(req, res, INDEX_HTML);
    return;
  }

  sendText(res, 503, missingBuildPage(), 'text/html; charset=utf-8');
}
