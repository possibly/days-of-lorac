/**
 * WebSocket transport for Days of Lorac.
 *
 * This file owns the socket lifecycle and the wire boundary: accept, welcome,
 * heartbeat, rate limiting, JSON parsing, and shape validation for every
 * `ClientMessage`. It never touches rooms or rules; those go to the
 * `RoomManager`.
 *
 * Codes, seats, names and tokens arriving from a client are only ever treated
 * as hints. The manager resolves the sender's seat from its session.
 */
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { GAME_VERSION } from '@shared/version';
import { isMapSize, isTerrainMode, isTokenMode } from '@shared/map-settings';
import type { ClientMessage, ServerMessage, WireErrorCode } from '@shared/protocol';
import type { BotDifficulty, GameAction, MapSettings, Seat } from '@shared/types';
import { WS_PATH } from './config.js';
import type { RoomManager } from './room-manager.js';
import type { ClientConnection } from './rooms.js';

const HEARTBEAT_MS = 30_000;
/** About 20 client messages per second per socket. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 1_000;

export interface GameSocketServer {
  wss: WebSocketServer;
  /** Number of open sockets, used by /api/health. */
  connectionCount: () => number;
  close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Shape validation. Types are checked here; meaning is checked by the manager.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readSeatCount(value: unknown): 2 | 3 | 4 | null {
  return value === 2 || value === 3 || value === 4 ? value : null;
}

function readDifficulty(value: unknown, fallback: BotDifficulty): BotDifficulty | null {
  if (value === undefined) return fallback;
  return value === 'easy' || value === 'normal' || value === 'hard' ? value : null;
}

function readSeat(value: unknown): Seat | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 4
    ? value
    : null;
}

/**
 * Undefined stays undefined (use the room default). A present but malformed
 * setting is rejected instead of silently half-applied.
 */
function readMapSettings(value: unknown): MapSettings | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (!isMapSize(value.size) || !isTerrainMode(value.terrain) || !isTokenMode(value.tokens)) {
    return null;
  }
  return { size: value.size, terrain: value.terrain, tokens: value.tokens };
}

function sendError(
  conn: ClientConnection,
  code: WireErrorCode,
  message: string,
  seq?: number,
): void {
  const payload: ServerMessage =
    seq === undefined ? { type: 'error', code, message } : { type: 'error', code, message, seq };
  try {
    conn.send(payload);
  } catch {
    /* the socket is already gone */
  }
}

/**
 * Routes one decoded client message. Exported so the routing table can be
 * tested without a socket.
 */
export function routeClientMessage(
  manager: RoomManager,
  conn: ClientConnection,
  message: unknown,
): void {
  if (!isRecord(message) || typeof message.type !== 'string') {
    sendError(conn, 'BAD_MESSAGE', 'Messages need a type field.');
    return;
  }

  switch (message.type as ClientMessage['type']) {
    case 'ping': {
      const t = typeof message.t === 'number' && Number.isFinite(message.t) ? message.t : null;
      conn.send({ type: 'pong', t, serverTime: Date.now() });
      return;
    }

    case 'quickPlay': {
      const name = readString(message.name);
      const seats = readSeatCount(message.seats);
      const difficulty = readDifficulty(message.difficulty, 'normal');
      const map = readMapSettings(message.map);
      if (name === null) return sendError(conn, 'BAD_MESSAGE', 'Quick play needs a name.');
      if (seats === null) return sendError(conn, 'BAD_MESSAGE', 'Choose 2, 3, or 4 seats.');
      if (difficulty === null) {
        return sendError(conn, 'BAD_MESSAGE', 'Difficulty is easy, normal, or hard.');
      }
      if (map === null) {
        return sendError(conn, 'BAD_MESSAGE', 'That island is not one of the offered maps.');
      }
      manager.quickPlay(conn, { name, seats, difficulty, ...(map ? { map } : {}) });
      return;
    }

    case 'createRoom': {
      const name = readString(message.name);
      const maxPlayers = readSeatCount(message.maxPlayers);
      const difficulty = readDifficulty(message.difficulty, 'normal');
      const map = readMapSettings(message.map);
      if (name === null) return sendError(conn, 'BAD_MESSAGE', 'A room needs a host name.');
      if (maxPlayers === null) return sendError(conn, 'BAD_MESSAGE', 'Rooms hold 2, 3, or 4 players.');
      if (difficulty === null) {
        return sendError(conn, 'BAD_MESSAGE', 'Difficulty is easy, normal, or hard.');
      }
      if (map === null) {
        return sendError(conn, 'BAD_MESSAGE', 'That island is not one of the offered maps.');
      }
      manager.createRoom(conn, { name, maxPlayers, difficulty, ...(map ? { map } : {}) });
      return;
    }

    case 'joinRoom': {
      const code = readString(message.code);
      const name = readString(message.name);
      if (code === null) return sendError(conn, 'BAD_MESSAGE', 'Join needs a room code.');
      if (name === null) return sendError(conn, 'BAD_MESSAGE', 'Join needs a name.');
      manager.joinRoom(conn, { code, name });
      return;
    }

    case 'resume': {
      const code = readString(message.code);
      const token = readString(message.token);
      if (code === null || token === null) {
        return sendError(conn, 'BAD_MESSAGE', 'Resume needs a room code and a token.');
      }
      manager.resume(conn, { code, token });
      return;
    }

    case 'leaveRoom':
      manager.leaveRoom(conn);
      return;

    case 'setReady': {
      if (typeof message.ready !== 'boolean') {
        return sendError(conn, 'BAD_MESSAGE', 'Ready is true or false.');
      }
      manager.setReady(conn, message.ready);
      return;
    }

    case 'setMapSettings': {
      const map = readMapSettings(message.map);
      if (!map) return sendError(conn, 'BAD_MESSAGE', 'That island is not one of the offered maps.');
      manager.setMapSettings(conn, map);
      return;
    }

    case 'addBot': {
      const difficulty = readDifficulty(message.difficulty, 'normal');
      if (difficulty === null) {
        return sendError(conn, 'BAD_MESSAGE', 'Difficulty is easy, normal, or hard.');
      }
      manager.addBotToRoom(conn, message.difficulty === undefined ? undefined : difficulty);
      return;
    }

    case 'removePlayer': {
      const seat = readSeat(message.seat);
      if (seat === null) return sendError(conn, 'BAD_MESSAGE', 'Pick a seat from 0 to 3.');
      manager.removePlayer(conn, seat);
      return;
    }

    case 'startGame':
      manager.startGame(conn);
      return;

    case 'rematch':
      manager.rematch(conn);
      return;

    case 'action': {
      const action = message.action;
      const seq =
        typeof message.seq === 'number' && Number.isFinite(message.seq) ? message.seq : undefined;
      if (!isRecord(action) || typeof action.type !== 'string') {
        return sendError(conn, 'BAD_MESSAGE', 'An action needs a type field.', seq);
      }
      manager.action(conn, action as unknown as GameAction, seq);
      return;
    }

    case 'chat': {
      const text = readString(message.text);
      if (text === null) return sendError(conn, 'BAD_MESSAGE', 'Chat needs text.');
      manager.chat(conn, text);
      return;
    }

    default: {
      sendError(conn, 'BAD_MESSAGE', `Unknown message type: ${String(message.type)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

class SocketRateLimiter {
  private hits: number[] = [];
  private warnedAt = Number.NEGATIVE_INFINITY;

  /** `ok`, `warn` (one error goes out), or `drop` (silent). */
  check(now: number): 'ok' | 'warn' | 'drop' {
    while (this.hits.length > 0) {
      const oldest = this.hits[0];
      if (oldest === undefined || now - oldest < RATE_WINDOW_MS) break;
      this.hits.shift();
    }
    if (this.hits.length >= RATE_LIMIT) {
      if (now - this.warnedAt >= RATE_WINDOW_MS) {
        this.warnedAt = now;
        return 'warn';
      }
      return 'drop';
    }
    this.hits.push(now);
    return 'ok';
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

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
