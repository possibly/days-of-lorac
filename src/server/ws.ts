/**
 * WebSocket transport for Days of Lorac.
 *
 * This file owns the socket lifecycle: accept, welcome, heartbeat, JSON
 * parsing, and disconnect. Message validation and routing live in
 * `message-router.ts`, which has no Node imports so a browser tab can reuse it
 * for peer hosting.
 *
 * Codes, seats, names and tokens arriving from a client are only ever treated
 * as hints. The manager resolves the sender's seat from its session.
 */
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { GAME_VERSION } from '@shared/version';
import type { ServerMessage } from '@shared/protocol';
import { WS_PATH } from './config.js';
import { routeClientMessage, sendError, SocketRateLimiter } from './message-router.js';
import type { RoomManager } from './room-manager.js';
import type { ClientConnection } from './rooms.js';

const HEARTBEAT_MS = 30_000;

export interface GameSocketServer {
  wss: WebSocketServer;
  /** Number of open sockets, used by /api/health. */
  connectionCount: () => number;
  close: () => Promise<void>;
}
export function attachWebSocketServer(
  server: HttpServer,
  manager: RoomManager,
): GameSocketServer {
  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: 64 * 1024 });
  const quiet = process.env.NODE_ENV === 'test';
  let nextConnectionId = 1;

  const log = (line: string): void => {
    if (!quiet) console.log(line);
  };

  wss.on('connection', (socket, req) => {
    const connectionId = `c${nextConnectionId++}`;
    const remote = req.socket.remoteAddress ?? 'unknown';
    const tracked = socket as WebSocket & { isAlive?: boolean };
    tracked.isAlive = true;
    const limiter = new SocketRateLimiter();

    const conn: ClientConnection = {
      id: connectionId,
      send: (message: ServerMessage) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(JSON.stringify(message));
        } catch {
          /* a closed socket is not an error worth crashing over */
        }
      },
      close: (reason?: string) => {
        try {
          socket.close(4000, (reason ?? 'closed').slice(0, 100));
        } catch {
          socket.terminate();
        }
      },
    };

    log(`[ws] ${connectionId} connected from ${remote}`);
    conn.send({
      type: 'welcome',
      version: GAME_VERSION,
      connectionId,
      serverTime: Date.now(),
    });

    socket.on('pong', () => {
      tracked.isAlive = true;
    });

    socket.on('message', (raw) => {
      const verdict = limiter.check(Date.now());
      if (verdict === 'warn') {
        sendError(conn, 'RATE_LIMITED', 'Slow down a little, then try again.');
        return;
      }
      if (verdict === 'drop') return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sendError(conn, 'BAD_MESSAGE', 'Send JSON objects.');
        return;
      }

      try {
        routeClientMessage(manager, conn, parsed);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[ws] ${connectionId} handler failed: ${detail}`);
        sendError(conn, 'SERVER_ERROR', 'That message could not be handled.');
      }
    });

    socket.on('close', (code) => {
      log(`[ws] ${connectionId} closed (${code})`);
      try {
        manager.handleDisconnect(conn);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[ws] ${connectionId} disconnect handler failed: ${detail}`);
      }
    });

    socket.on('error', (error: Error) => {
      console.warn(`[ws] ${connectionId} error: ${error.message}`);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const tracked = socket as WebSocket & { isAlive?: boolean };
      if (tracked.isAlive === false) {
        socket.terminate();
        continue;
      }
      tracked.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    wss,
    connectionCount: () => wss.clients.size,
    close: async () => {
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.close(1001, 'server shutting down');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
