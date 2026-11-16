/**
 * The wire boundary: shape validation, routing, and rate limiting.
 *
 * Kept free of Node imports so the same router can run in the game server
 * (src/server/ws.ts) and inside a browser tab that hosts a peer game
 * (src/client/net/peer/host.ts). Meaning is still the RoomManager's job; this
 * file only checks that a message is well formed and hands it over.
 */
import { isMapSize, isTerrainMode, isTokenMode } from '@shared/map-settings';
import { isValidCardSettings, normalizeCardSettings } from '@shared/card-settings';
import type { ClientMessage, ServerMessage, WireErrorCode } from '@shared/protocol';
import type { BotDifficulty, CardSettings, GameAction, MapSettings, Seat } from '@shared/types';
import type { RoomManager } from './room-manager.js';
import type { ClientConnection } from './rooms.js';

/** About 20 client messages per second per socket. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 1_000;

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

/** Same rule as the map: absent means the room default, malformed is rejected. */
function readCardSettings(value: unknown): CardSettings | null | undefined {
  if (value === undefined) return undefined;
  if (!isValidCardSettings(value)) return null;
  return normalizeCardSettings(value);
}

export function sendError(
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
      const cards = readCardSettings(message.cards);
      if (name === null) return sendError(conn, 'BAD_MESSAGE', 'Quick play needs a name.');
      if (seats === null) return sendError(conn, 'BAD_MESSAGE', 'Choose 2, 3, or 4 seats.');
      if (difficulty === null) {
        return sendError(conn, 'BAD_MESSAGE', 'Difficulty is easy, normal, or hard.');
      }
      if (map === null) {
        return sendError(conn, 'BAD_MESSAGE', 'That island is not one of the offered maps.');
      }
      if (cards === null) {
        return sendError(conn, 'BAD_MESSAGE', 'That card market is not one of the offered ones.');
      }
      manager.quickPlay(conn, {
        name,
        seats,
        difficulty,
        ...(map ? { map } : {}),
        ...(cards ? { cards } : {}),
      });
      return;
    }

    case 'createRoom': {
      const name = readString(message.name);
      const maxPlayers = readSeatCount(message.maxPlayers);
      const difficulty = readDifficulty(message.difficulty, 'normal');
      const map = readMapSettings(message.map);
      const cards = readCardSettings(message.cards);
      if (name === null) return sendError(conn, 'BAD_MESSAGE', 'A room needs a host name.');
      if (maxPlayers === null) return sendError(conn, 'BAD_MESSAGE', 'Rooms hold 2, 3, or 4 players.');
      if (difficulty === null) {
        return sendError(conn, 'BAD_MESSAGE', 'Difficulty is easy, normal, or hard.');
      }
      if (map === null) {
        return sendError(conn, 'BAD_MESSAGE', 'That island is not one of the offered maps.');
      }
      if (cards === null) {
        return sendError(conn, 'BAD_MESSAGE', 'That card market is not one of the offered ones.');
      }
      manager.createRoom(conn, {
        name,
        maxPlayers,
        difficulty,
        ...(map ? { map } : {}),
        ...(cards ? { cards } : {}),
      });
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

    case 'setCardSettings': {
      const cards = readCardSettings(message.cards);
      if (!cards) return sendError(conn, 'BAD_MESSAGE', 'That card market is not one of the offered ones.');
      manager.setCardSettings(conn, cards);
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

export class SocketRateLimiter {
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
