/**
 * Days of Lorac game server.
 *
 * The process is a thin shell: `startServer()` builds the HTTP server, the
 * room manager, and the WebSocket transport and returns handles so tests can
 * boot and stop it without killing the process. Running this file directly
 * keeps the production behaviour: listen on 0.0.0.0:8096 (or PORT), print the
 * banner, exit on a fatal listen error.
 *
 * HTTP surface:
 *   GET /api/health          ok, version, uptime, socket/room/game counts
 *   GET /api/rooms/:code     lobby metadata for a share link, else JSON 404
 *   everything else          the built client from dist/client, SPA fallback
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAME_VERSION } from '@shared/version';
import { CLIENT_DIST_DIR, HOST, PORT, TAILNET_IP, WS_PATH } from './config.js';
import { sendJson, handleStaticRequest } from './static.js';
import { attachWebSocketServer } from './ws.js';
import type { GameSocketServer } from './ws.js';
import { RoomManager } from './room-manager.js';
import type { RoomManagerOptions } from './room-manager.js';

export interface StartServerOptions {
  /** 0 picks a free port, which is what the integration tests use. */
  port?: number;
  host?: string;
  managerOptions?: RoomManagerOptions;
  /** Suppress the startup banner (tests, embedded use). */
  quiet?: boolean;
}

export interface RunningServer {
  server: ReturnType<typeof createServer>;
  manager: RoomManager;
  gameSocket: GameSocketServer;
  port: number;
  host: string;
  startedAt: number;
  close(): Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const startedAt = Date.now();
  const manager = new RoomManager(options.managerOptions);
  let gameSocket: GameSocketServer | null = null;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' });
        res.end();
        return;
      }
      const stats = manager.stats();
      sendJson(res, 200, {
        ok: true,
        name: 'days-of-lorac',
        version: GAME_VERSION,
        startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        wsPath: WS_PATH,
        wsClients: gameSocket?.connectionCount() ?? 0,
        rooms: stats.rooms,
        games: stats.games,
        lobbyRooms: stats.lobby,
        playingRooms: stats.playing,
        finishedRooms: stats.finished,
        humans: stats.humans,
        bots: stats.bots,
        clientBuildPresent: clientBuildExists(),
      });
      return;
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(pathname);
    if (roomMatch) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' });
        res.end();
        return;
      }
      let requested = '';
      try {
        requested = decodeURIComponent(roomMatch[1] ?? '');
      } catch {
        requested = '';
      }
      const info = requested ? manager.roomInfo(requested) : null;
      if (!info) {
        sendJson(res, 404, {
          ok: false,
          code: 'ROOM_NOT_FOUND',
          error: `no room with that code: ${requested || '(missing)'}`,
        });
        return;
      }
      sendJson(res, 200, { ok: true, canJoin: info.canJoin, room: info.room });
      return;
    }

    // Any other /api path is a JSON 404, never the SPA shell.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: `no such endpoint: ${pathname}` });
      return;
    }

    handleStaticRequest(req, res);
  });

  gameSocket = attachWebSocketServer(server, manager);

  const host = options.host ?? HOST;
  const requestedPort = options.port ?? PORT;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, host);
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : requestedPort;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    manager.closeAll();
    await gameSocket?.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // fetch/undici keeps sockets pooled; without this, close() can hang.
      server.closeAllConnections();
    });
  };

  const running: RunningServer = {
    server,
    manager,
    gameSocket: gameSocket as GameSocketServer,
    port,
    host,
    startedAt,
    close,
  };

  if (!options.quiet) printBanner(running);
  return running;
}

function clientBuildExists(): boolean {
  return existsSync(path.join(CLIENT_DIST_DIR, 'index.html'));
}

function printBanner(running: RunningServer): void {
  const local = `http://localhost:${running.port}`;
  const tailnet = `http://${TAILNET_IP}:${running.port}`;
  console.log('');
  console.log(`  Days of Lorac server v${GAME_VERSION}`);
  console.log(`  local      ${local}`);
  console.log(`  tailnet    ${tailnet}`);
  console.log(`  websocket  ${tailnet.replace('http', 'ws')}${WS_PATH}`);
  console.log(
    `  client     ${
      clientBuildExists()
        ? CLIENT_DIST_DIR
        : 'dist/client missing (run npm run build, or use npm run dev for Vite at :5173)'
    }`,
  );
  console.log('');
}

/** True only when `node`/`tsx` started this file, never under vitest. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  startServer()
    .then((running) => {
      const shutdown = (signal: string): void => {
        console.log(`\n[server] ${signal}, shutting down`);
        void running.close().then(() => process.exit(0));
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(
          `[server] port ${PORT} is already in use. Stop the other process or set PORT.`,
        );
      } else {
        console.error('[server] fatal:', error);
      }
      process.exit(1);
    });
}
