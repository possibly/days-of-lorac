/**
 * WebSocket transport for Days of Lorac.
 *
 * This file owns the socket lifecycle only: accept, heartbeat, hello, ack,
 * and clean shutdown. It deliberately knows nothing about rooms or game rules.
 *
 * The client connects to `/ws` (proxied by Vite in dev, served directly by this
 * process in production).
 *
 * ---------------------------------------------------------------------------
 * TODO(next agent: server rooms)
 * ---------------------------------------------------------------------------
 * 1. Move protocol types into `src/shared/protocol.ts` and share them with the
 *    client. Replace the loose `ClientMessage`/`ServerMessage` shapes below.
 * 2. Add `connectionId -> roomCode, seat, playerId, reconnectToken` mapping.
 *    Keep it in one module (`src/server/rooms.ts`), not in this file.
 * 3. Route client messages into the room layer. Every message should be
 *    validated (rooms are joined by 4-letter code, so treat input as hostile)
 *    and every mutating message should carry a room-scoped sequence number.
 * 4. Reconnect: keep a per-player token, allow a socket to re-attach to an
 *    existing seat, and drop the socket after a grace period.
 * 5. On `close`, notify the room so it can start its bot-takeover timer.
 * 6. Add a max message size and a per-socket rate limit before shipping to the
 *    tailnet.
 * ---------------------------------------------------------------------------
 */
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { GAME_VERSION } from '@shared/version';
import { WS_PATH } from './config.js';

/** Wire shape used until `src/shared/protocol.ts` exists. */
export type ClientMessage =
  | { type: 'ping'; t?: number }
  | { type: 'hello'; name?: string };

export type ServerMessage =
  | {
      type: 'hello';
      version: string;
      connectionId: string;
      serverTime: number;
      /** Placeholder: no rooms exist yet. */
      rooms: number;
    }
  | { type: 'ack'; of: string; connectionId: string; serverTime: number }
  | { type: 'pong'; t: number | null; serverTime: number }
  | { type: 'error'; message: string };

const HEARTBEAT_MS = 30_000;

export interface GameSocketServer {
  wss: WebSocketServer;
  /** Number of open sockets, used by /api/health. */
  connectionCount: () => number;
  close: () => Promise<void>;
}

export function attachWebSocketServer(server: HttpServer): GameSocketServer {
  // `path` makes the server ignore /ws-ish upgrades on other routes instead of
  // accepting them.
  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: 64 * 1024 });
  let nextConnectionId = 1;

  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  wss.on('connection', (socket, req) => {
    const connectionId = `c${nextConnectionId++}`;
    const remote = req.socket.remoteAddress ?? 'unknown';
    (socket as WebSocket & { isAlive?: boolean }).isAlive = true;

    console.log(`[ws] ${connectionId} connected from ${remote}`);
    send(socket, {
      type: 'hello',
      version: GAME_VERSION,
      connectionId,
      serverTime: Date.now(),
      rooms: 0,
    });

    socket.on('pong', () => {
      (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    socket.on('message', (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', message: 'expected JSON' });
        return;
      }

      const type =
        typeof message === 'object' && message !== null && 'type' in message
          ? String((message as { type: unknown }).type)
          : '';

      // TODO(rooms): replace this switch with the room router.
      switch (type) {
        case 'ping': {
          const t = (message as { t?: unknown }).t;
          send(socket, {
            type: 'pong',
            t: typeof t === 'number' ? t : null,
            serverTime: Date.now(),
          });
          return;
        }
        case 'hello': {
          send(socket, {
            type: 'ack',
            of: 'hello',
            connectionId,
            serverTime: Date.now(),
          });
          return;
        }
        default: {
          send(socket, {
            type: 'error',
            message: `unknown message type: ${type || '(missing)'}`,
          });
        }
      }
    });

    socket.on('close', (code) => {
      console.log(`[ws] ${connectionId} closed (${code})`);
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
