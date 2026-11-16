/**
 * Room state and the small pure helpers shared by the room manager and the
 * transport.
 *
 * A room is in-memory only: 4 seat slots, a host, a lobby or a game, chat, and
 * the timers that make disconnects and bot turns work. Codes are 4 uppercase
 * letters from an alphabet without I and O, so nobody has to guess whether a
 * character is a letter or a digit.
 *
 * Nothing here knows about sockets beyond `ClientConnection`, which lets the
 * tests drive the manager with fake connections and a fake clock.
 */
import { targetVpFor } from '@shared/constants';
import { DEFAULT_CARD_SETTINGS } from '@shared/card-settings';
import type { BotDifficulty, GameState, Seat } from '@shared/types';
import type {
  ChatMessage,
  LobbyPlayer,
  LobbyView,
  RoomConfig,
  RoomStatus,
  ServerMessage,
} from '@shared/protocol';

/** Letter-only alphabet with the ambiguous I and O removed. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;
export const MAX_SEATS = 4;
export const MAX_NAME_LENGTH = 20;
export const MAX_CHAT_LENGTH = 200;
export const MAX_CHAT_HISTORY = 200;
/** Lines the server writes itself (joins, leaves, takeover, rematch). */
export const SYSTEM_NAME = 'Table';
export const BOT_NAMES = ['Vale', 'Kestrel', 'Marrow', 'Pike'] as const;

/** Handle returned by a Clock; opaque to the manager. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Injected so tests can run the clock by hand. The default is the real one.
 */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * The transport end of one socket. `ws.ts` wraps a WebSocket; the unit tests
 * use a recorder. The manager never sees a WebSocket.
 */
export interface ClientConnection {
  /** Stable id for logs, assigned by the transport. */
  readonly id: string;
  send(message: ServerMessage): void;
  /** Optional hard close, used when a seat is resumed elsewhere. */
  close?(reason?: string): void;
}

export interface SeatSlot {
  seat: Seat;
  name: string;
  isBot: boolean;
  difficulty: BotDifficulty | null;
  /** False for a human whose socket dropped; always true for a bot. */
  connected: boolean;
  ready: boolean;
  /** Reconnect secret. Null for bots; never sent to anyone but the owner. */
  token: string | null;
  connection: ClientConnection | null;
  /** A bot is currently piloting this (human) seat. */
  takeover: boolean;
  disconnectedAt: number | null;
  takeoverTimer: TimerHandle | null;
  takeoverToken: number;
  expiryTimer: TimerHandle | null;
  expiryToken: number;
}

export interface Room {
  code: string;
  createdAt: number;
  hostSeat: Seat;
  config: RoomConfig;
  status: RoomStatus;
  /** Fixed length 4; slots at or beyond `config.maxPlayers` stay empty. */
  seats: (SeatSlot | null)[];
  state: GameState | null;
  chat: ChatMessage[];
  nextChatId: number;
  botTimer: TimerHandle | null;
  botToken: number;
  /** Consecutive bot actions the engine rejected; stops a stuck table. */
  botFailures: number;
  cleanupTimer: TimerHandle | null;
  cleanupToken: number;
  closed: boolean;
}

// ---------------------------------------------------------------------------
// Input sanitising. Everything from a client is hostile until it passes here.
// ---------------------------------------------------------------------------

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{4}$/.test(code) ? code : null;
}

/** Trim, drop angle brackets and control characters, cap the length. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Chat is plain text: no tags, no control characters, 200 characters max. */
export function sanitizeChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHAT_LENGTH)
    .trim();
  return text.length > 0 ? text : null;
}

export function isSeatCount(value: unknown): value is 2 | 3 | 4 {
  return value === 2 || value === 3 || value === 4;
}

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

export function difficultyOr(value: unknown, fallback: BotDifficulty): BotDifficulty {
  return isBotDifficulty(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

export function randomCode(random: () => number = Math.random): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const pick = Math.min(
      ROOM_CODE_ALPHABET.length - 1,
      Math.floor(random() * ROOM_CODE_ALPHABET.length),
    );
    code += ROOM_CODE_ALPHABET.charAt(pick);
  }
  return code;
}

/**
 * Random hex id. `crypto.randomUUID` is secure-context only, so a page served
 * over plain HTTP on a LAN falls back to `getRandomValues`, which works
 * everywhere.
 */
export function randomId(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function newReconnectToken(): string {
  return randomId().replace(/-/g, '');
}

export function botName(seat: Seat): string {
  return BOT_NAMES[seat] ?? `Bot ${seat + 1}`;
}

/** Occupied slots, in seat order. Empty slots are null. */
export function occupiedSlots(room: Room): SeatSlot[] {
  const out: SeatSlot[] = [];
  for (let seat = 0; seat < room.seats.length; seat += 1) {
    const slot = room.seats[seat];
    if (slot) out.push(slot);
  }
  return out;
}

export function findSlot(room: Room, seat: Seat): SeatSlot | null {
  if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) return null;
  return room.seats[seat] ?? null;
}

/** First empty seat inside the room's player limit, or null when full. */
export function firstEmptySeat(room: Room): Seat | null {
  for (let seat = 0; seat < room.config.maxPlayers; seat += 1) {
    if (!room.seats[seat]) return seat;
  }
  return null;
}

export function findSlotByToken(room: Room, token: string): SeatSlot | null {
  for (const slot of occupiedSlots(room)) {
    if (slot.token !== null && slot.token === token) return slot;
  }
  return null;
}

/** Connected map for `viewFor`: bots always read as connected. */
export function connectedMap(room: Room): Partial<Record<Seat, boolean>> {
  const map: Partial<Record<Seat, boolean>> = {};
  for (const slot of occupiedSlots(room)) {
    map[slot.seat] = slot.isBot ? true : slot.connected;
  }
  return map;
}

/**
 * Human seats a bot is flying right now. Seat order, never bots: a bot seat is
 * a bot all the time, which the client already knows from `players[].isBot`.
 */
export function pilotSeats(room: Room): Seat[] {
  const seats: Seat[] = [];
  for (const slot of occupiedSlots(room)) {
    if (!slot.isBot && slot.takeover) seats.push(slot.seat);
  }
  return seats;
}

export function buildLobbyView(room: Room): LobbyView {
  const players: LobbyPlayer[] = occupiedSlots(room).map((slot) => ({
    seat: slot.seat,
    name: slot.name,
    isBot: slot.isBot,
    connected: slot.isBot ? true : slot.connected,
    ready: slot.isBot ? true : slot.ready,
    host: slot.seat === room.hostSeat,
  }));

  return {
    code: room.code,
    status: room.status,
    hostSeat: room.hostSeat,
    config: {
      ...room.config,
      map: { ...room.config.map },
      cards: { ...DEFAULT_CARD_SETTINGS, ...room.config.cards },
    },
    targetVp: targetVpFor(room.config.maxPlayers, room.config.map.size),
    players,
  };
}

/** Human and bot counts, used by the health endpoint. */
export interface RoomStats {
  rooms: number;
  games: number;
  lobby: number;
  playing: number;
  finished: number;
  humans: number;
  bots: number;
}
