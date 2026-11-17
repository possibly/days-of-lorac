/**
 * Room snapshots, for the host tab's localStorage.
 *
 * The host tab is the server, so a refresh would end the table. This module
 * turns a live `Room` into plain JSON and back. Sockets, timers and the maps the
 * manager keeps in memory are rebuilt by the manager, never serialized.
 *
 * The input is treated as hostile even though we wrote it: localStorage is
 * editable with devtools, a saved blob can outlive a deploy, and a half-written
 * value should start a fresh table instead of crashing the tab.
 */
import { GAME_VERSION } from '@shared/version';
import {
  DEFAULT_MAP_SETTINGS,
  isValidMapSettings,
  normalizeMapSettings,
  seatsFit,
} from '@shared/map-settings';
import { DEFAULT_CARD_SETTINGS, isValidCardSettings, normalizeCardSettings } from '@shared/card-settings';
import type { BotDifficulty, GameState, Seat } from '@shared/types';
import type { ChatMessage, RoomConfig, RoomStatus } from '@shared/protocol';
import type { Room, SeatSlot } from './rooms.js';
import {
  difficultyOr,
  isBotDifficulty,
  isSeatCount,
  normalizeCode,
  sanitizeChat,
  sanitizeName,
} from './rooms.js';

/** Bump when the shape changes; older blobs are ignored. */
export const SAVE_VERSION = 1;
/** A 4-player game is around 80 KB of JSON. Anything near this is not ours. */
export const SAVE_MAX_CHARS = 2_000_000;
/** The UI only shows the last 120 log lines, so 400 is plenty of history. */
export const SAVE_LOG_LIMIT = 400;
export const SAVE_CHAT_LIMIT = 60;

const STATUSES: RoomStatus[] = ['lobby', 'playing', 'finished'];
const PHASES = ['setup', 'roll', 'discard', 'robber', 'action', 'gameOver'] as const;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface SavedSeat {
  seat: Seat;
  name: string;
  isBot: boolean;
  difficulty: BotDifficulty | null;
  ready: boolean;
  /** Null for bots. The owner's reconnect secret. */
  token: string | null;
}

export interface RoomSave {
  v: number;
  gameVersion: string;
  savedAt: number;
  code: string;
  createdAt: number;
  hostSeat: Seat;
  status: RoomStatus;
  config: RoomConfig;
  /** Always four entries; slots past `config.maxPlayers` are null. */
  seats: (SavedSeat | null)[];
  state: GameState | null;
  chat: ChatMessage[];
  nextChatId: number;
  botFailures: number;
}

/** Everything worth keeping, with the sockets and timers dropped. */
export function roomToSave(room: Room, now = Date.now()): RoomSave {
  const trimmedState = room.state ? trimStateLog(room.state) : null;

  return {
    v: SAVE_VERSION,
    gameVersion: GAME_VERSION,
    savedAt: now,
    code: room.code,
    createdAt: room.createdAt,
    hostSeat: room.hostSeat,
    status: room.status,
    config: {
      maxPlayers: room.config.maxPlayers,
      difficulty: room.config.difficulty,
      map: { ...room.config.map },
      cards: { ...room.config.cards },
    },
    seats: room.seats.map((slot) =>
      slot
        ? {
            seat: slot.seat,
            name: slot.name,
            isBot: slot.isBot,
            difficulty: slot.difficulty,
            ready: slot.ready,
            token: slot.isBot ? null : slot.token,
          }
        : null,
    ),
    state: trimmedState,
    chat: room.chat.slice(-SAVE_CHAT_LIMIT).map((message) => ({ ...message })),
    nextChatId: room.nextChatId,
    botFailures: room.botFailures,
  };
}

export function serializeRoom(room: Room, now = Date.now()): string {
  return JSON.stringify(roomToSave(room, now));
}

/**
 * Drops all but the newest log lines. The UI shows 120, so 400 keeps history
 * without letting a long game turn every save into a megabyte of JSON.
 */
export function trimStateLog(state: GameState): GameState {
  if (state.log.length <= SAVE_LOG_LIMIT) return state;
  return { ...state, log: state.log.slice(-SAVE_LOG_LIMIT) };
}

/**
 * Structural check for a saved game state. Null means "not usable", which for a
 * solo save is a fresh start rather than an empty lobby.
 */
export function parseGameState(value: unknown, playerCount: number): GameState | null {
  const state = readState(value, playerCount);
  return state === null || state === false ? null : state;
}

/**
 * Parses and validates a blob. Returns null for anything that is not a room
 * this build can safely run: wrong version, a different game build, bad shape.
 */
export function deserializeRoom(raw: string, now = Date.now()): Room | null {
  const save = parseRoomSave(raw);
  if (!save) return null;
  const room = saveToRoom(save, now);
  return room;
}

export function parseRoomSave(raw: string): RoomSave | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > SAVE_MAX_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return readSave(value);
}

/** Rebuilds a live room. All seats start disconnected; the manager arms timers. */
export function saveToRoom(save: RoomSave, now = Date.now()): Room | null {
  const seats: (SeatSlot | null)[] = [null, null, null, null];
  for (let index = 0; index < save.seats.length; index += 1) {
    const saved = save.seats[index];
    if (!saved) continue;
    seats[saved.seat] = slotFromSave(saved, now);
  }
  if (seats.every((slot) => slot === null)) return null;

  return {
    code: save.code,
    createdAt: save.createdAt,
    hostSeat: save.hostSeat,
    config: save.config,
    status: save.status,
    seats,
    state: save.state,
    chat: save.chat,
    nextChatId: save.nextChatId,
    botTimer: null,
    botToken: 0,
    botFailures: save.botFailures,
    cleanupTimer: null,
    cleanupToken: 0,
    closed: false,
  };
}

function slotFromSave(saved: SavedSeat, now: number): SeatSlot {
  return {
    seat: saved.seat,
    name: saved.name,
    isBot: saved.isBot,
    difficulty: saved.isBot ? saved.difficulty : null,
    // Bots are always "there". Humans have to come back through `resume`.
    connected: saved.isBot,
    ready: saved.isBot ? true : saved.ready,
    token: saved.isBot ? null : saved.token,
    connection: null,
    takeover: false,
    disconnectedAt: now,
    takeoverTimer: null,
    takeoverToken: 0,
    expiryTimer: null,
    expiryToken: 0,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function readSave(value: unknown): RoomSave | null {
  if (!isRecord(value)) return null;
  if (value.v !== SAVE_VERSION) return null;
  if (value.gameVersion !== GAME_VERSION) return null;

  const code = normalizeCode(value.code);
  if (!code) return null;

  const status = STATUSES.find((candidate) => candidate === value.status);
  if (!status) return null;

  const config = readConfig(value.config);
  if (!config) return null;

  const createdAt = numberOr(value.createdAt, null);
  if (createdAt === null || createdAt < 0) return null;

  const hostSeat = seatOrNull(value.hostSeat);
  if (hostSeat === null) return null;

  const seats = readSeats(value.seats, config.maxPlayers);
  if (!seats) return null;

  const host = seats[hostSeat];
  if (!host) return null;

  const state = readState(value.state, config.maxPlayers);
  if (state === false) return null;
  if (status === 'lobby' && state !== null) return null;
  if (status !== 'lobby' && state === null) return null;

  const chat = readChat(value.chat);
  if (!chat) return null;

  const nextChatId = numberOr(value.nextChatId, null);
  if (nextChatId === null || nextChatId < 1) return null;

  const botFailures = numberOr(value.botFailures, 0) ?? 0;

  return {
    v: SAVE_VERSION,
    gameVersion: GAME_VERSION,
    savedAt: numberOr(value.savedAt, Date.now()) ?? Date.now(),
    code,
    createdAt,
    hostSeat,
    status,
    config,
    seats,
    state,
    chat,
    nextChatId,
    botFailures: Math.max(0, Math.min(99, Math.floor(botFailures))),
  };
}

function readConfig(value: unknown): RoomConfig | null {
  if (!isRecord(value)) return null;
  if (!isSeatCount(value.maxPlayers)) return null;
  if (!isValidMapSettings(value.map) || !isValidCardSettings(value.cards)) return null;
  const map = normalizeMapSettings(value.map, DEFAULT_MAP_SETTINGS);
  const cards = normalizeCardSettings(value.cards, DEFAULT_CARD_SETTINGS);
  if (!seatsFit(map, value.maxPlayers)) return null;
  const difficulty = difficultyOr(value.difficulty, 'normal');
  return { maxPlayers: value.maxPlayers, difficulty, map, cards };
}

function readSeats(value: unknown, maxPlayers: number): (SavedSeat | null)[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const seats: (SavedSeat | null)[] = [null, null, null, null];
  for (let index = 0; index < 4; index += 1) {
    const raw = value[index];
    if (raw === null) continue;
    if (!isRecord(raw)) return null;
    const seat = seatOrNull(raw.seat);
    if (seat === null || seat >= maxPlayers) return null;
    if (seats[seat]) return null;
    const name = sanitizeName(raw.name);
    if (!name) return null;
    const isBot = raw.isBot === true;
    const difficulty = isBot
      ? isBotDifficulty(raw.difficulty)
        ? raw.difficulty
        : 'normal'
      : null;
    const token = isBot ? null : readToken(raw.token);
    if (!isBot && !token) return null;
    seats[seat] = {
      seat,
      name,
      isBot,
      difficulty,
      ready: raw.ready === true,
      token,
    };
  }
  return seats;
}

function readToken(value: unknown): string | null {
  return typeof value === 'string' && TOKEN_PATTERN.test(value) ? value : null;
}

/**
 * Returns null for a lobby, a game state for a started game, and false when
 * the value is present but unusable. The check is structural: enough that a
 * view can be built from it, not a full engine audit.
 */
function readState(value: unknown, maxPlayers: number): GameState | null | false {
  if (value === null) return null;
  if (!isRecord(value)) return false;
  if (typeof value.gameId !== 'string' || !value.gameId) return false;
  if (!isFiniteNumber(value.version) || !isFiniteNumber(value.rng)) return false;
  if (!PHASES.some((phase) => phase === value.phase)) return false;
  if (!isFiniteNumber(value.turn)) return false;
  if (seatOrNull(value.firstSeat) === null) return false;
  if (seatOrNull(value.currentSeat) === null) return false;
  if (!(value.setup === null || isRecord(value.setup))) return false;
  if (!isRecord(value.board)) return false;
  if (!Array.isArray(value.board.hexes) || value.board.hexes.length === 0) return false;
  if (!Array.isArray(value.board.vertices) || !Array.isArray(value.board.edges)) return false;
  if (!isRecord(value.buildings) || !isRecord(value.roads)) return false;
  if (typeof value.robberHex !== 'string') return false;
  if (!Array.isArray(value.players) || value.players.length !== maxPlayers) return false;
  for (const player of value.players) {
    if (!isRecord(player)) return false;
    if (seatOrNull(player.seat) === null) return false;
    if (typeof player.name !== 'string' || !player.name) return false;
    if (!isRecord(player.resources)) return false;
    if (!Array.isArray(player.hand) || !Array.isArray(player.deck) || !Array.isArray(player.discard)) {
      return false;
    }
    if (!Array.isArray(player.played)) return false;
    if (!isRecord(player.charters) || !isRecord(player.bought)) return false;
    if (!isFiniteNumber(player.vp) || !isFiniteNumber(player.renown)) return false;
  }
  if (!isRecord(value.market) || !isRecord(value.cardCosts)) return false;
  if (!(value.dice === null || isRecord(value.dice))) return false;
  if (!Array.isArray(value.discardQueue) || !isRecord(value.discardRequired)) return false;
  if (!(value.tradeOffer === null || isRecord(value.tradeOffer))) return false;
  if (!isRecord(value.awards) || !Array.isArray(value.log)) return false;
  if (!isFiniteNumber(value.nextLogId) || !isFiniteNumber(value.nextCardIid)) return false;
  if (!isRecord(value.turnFlags)) return false;
  if (!(value.winner === null || seatOrNull(value.winner) !== null)) return false;

  return value as unknown as GameState;
}

function readChat(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const chat: ChatMessage[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const name = sanitizeName(raw.name);
    const text = sanitizeChat(raw.text);
    if (!name || !text) continue;
    if (!isFiniteNumber(raw.id)) continue;
    chat.push({
      id: raw.id,
      seat: seatOrNull(raw.seat),
      name,
      text,
      at: numberOr(raw.at, 0) ?? 0,
    });
  }
  return chat.slice(-SAVE_CHAT_LIMIT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value: unknown, fallback: number | null): number | null {
  return isFiniteNumber(value) ? value : fallback;
}

function seatOrNull(value: unknown): Seat | null {
  if (!Number.isInteger(value)) return null;
  const seat = value as number;
  return seat >= 0 && seat < 4 ? (seat as Seat) : null;
}
