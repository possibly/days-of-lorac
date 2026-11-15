/**
 * Days of Lorac game server.
 *
 * Responsibilities today:
 *   - serve the built client from dist/client (SPA fallback),
 *   - answer GET /api/health,
 *   - accept WebSocket connections on /ws and say hello.
 *
 * Not built yet: rooms, seats, authoritative game loop, bot runner.
 *
 * ---------------------------------------------------------------------------
 * TODO(next agent: rooms + game loop)
 * ---------------------------------------------------------------------------
 * - Add `src/server/rooms.ts`: createRoom / joinRoom / leaveRoom keyed by a
 *   4-letter code, seats, ready flags, host-only start, in-memory only.
 * - Add REST or WS messages for room create/join; keep the shapes in
 *   `src/shared/protocol.ts` and import them from both sides.
 * - Drive the engine from a room tick: validate every action against the
 *   engine's legal-move set, then broadcast a per-player view (hidden hands
 *   filtered).
 * - Add `/api/rooms/:code` for the shareable `?room=CODE` link so the client can
 *   tell "no such room" from "loading".
 * - Bot runner + balance simulation go in `src/server/bots/` and
 *   `scripts/`; they import the engine directly, never this file.
 * - Add a smoke script in `scripts/` that boots this server on an ephemeral
 *   port, hits /api/health, opens one socket, and exits non-zero on failure.
 * ---------------------------------------------------------------------------
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { GAME_VERSION } from '@shared/version';
import { CLIENT_DIST_DIR, HOST, PORT, TAILNET_IP, WS_PATH } from './config.js';
import { sendJson, handleStaticRequest } from './static.js';
import { attachWebSocketServer } from './ws.js';

const startedAt = Date.now();

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/api/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    sendJson(res, 200, {
      ok: true,
      name: 'days-of-lorac',
      version: GAME_VERSION,
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      wsPath: WS_PATH,
      wsClients: gameSocket.connectionCount(),
      clientBuildPresent: clientBuildExists(),
    });
    return;
  }

  // Any other /api path is a JSON 404, never the SPA shell.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, error: `no such endpoint: ${pathname}` });
    return;
  }

  handleStaticRequest(req, res);
});

const gameSocket = attachWebSocketServer(server);

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[server] port ${PORT} is already in use. Stop the other process or set PORT.`);
    process.exit(1);
  }
  console.error('[server] fatal:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const local = `http://localhost:${PORT}`;
  const tailnet = `http://${TAILNET_IP}:${PORT}`;
  console.log('');
  console.log(`  Days of Lorac server v${GAME_VERSION}`);
  console.log(`  local      ${local}`);
  console.log(`  tailnet    ${tailnet}`);
  console.log(`  websocket  ${tailnet.replace('http', 'ws')}${WS_PATH}`);
  console.log(`  client     ${clientBuildExists() ? CLIENT_DIST_DIR : 'dist/client missing (run npm run build, or use npm run dev for Vite at :5173)'}`);
  console.log('');
});

function clientBuildExists(): boolean {
  return existsSync(path.join(CLIENT_DIST_DIR, 'index.html'));
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[server] ${signal}, shutting down`);
  server.close();
  await gameSocket.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
