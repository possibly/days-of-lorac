/**
 * The peer table this browser can walk back into.
 *
 * Two keys: a tiny metadata blob, and for the host the room snapshot as its own
 * string so a save does not re-serialize a whole game to update a timestamp.
 *
 * Guests only need the seat token and the relay code. Hosts also need the room
 * itself, because their tab is the server. Anything unreadable is treated as no
 * saved table: a corrupt blob must never keep someone out of the game.
 */
import { isRelayCode } from '@shared/relay';
import type { Seat } from '@shared/types';
import { readRaw, removeRaw, writeRaw } from '../storage';
import { SAVE_MAX_CHARS } from '../../../server/room-save.js';

export const SESSION_KEY = 'lorac.peer.session';
export const ROOM_KEY = 'lorac.peer.room';

export const SESSION_VERSION = 1;
/** A table is worth coming back to for two hours, then the code is cold. */
export const SESSION_TTL_MS = 2 * 60 * 60_000;
/** A reload lands inside this window, so boot resumes without asking. */
export const AUTO_RESUME_MS = 45_000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ROOM_PATTERN = /^[A-Z]{4}$/;

export interface SavedPeerSession {
  v: number;
  role: 'host' | 'guest';
  /** Four letters guests type. The relay meeting point. */
  relayCode: string;
  /** Room code inside the host tab. */
  room: string;
  name: string;
  seat: Seat;
  /** Seat reconnect secret. */
  token: string;
  savedAt: number;
  /** Host only. The serialized room, ready for `RoomManager.restoreRoom`. */
  roomSave: string | null;
}

interface Meta {
  v: number;
  role: 'host' | 'guest';
  relayCode: string;
  room: string;
  name: string;
  seat: Seat;
  token: string;
  savedAt: number;
  hasRoom: boolean;
}

export function loadSavedSession(now = Date.now()): SavedPeerSession | null {
  const meta = readMeta();
  if (!meta) return null;
  if (now - meta.savedAt > SESSION_TTL_MS) {
    clearSavedSession();
    return null;
  }
  let roomSave: string | null = null;
  if (meta.role === 'host') {
    roomSave = readRaw(ROOM_KEY);
    if (!roomSave || roomSave.length > SAVE_MAX_CHARS) {
      clearSavedSession();
      return null;
    }
  }
  return {
    v: SESSION_VERSION,
    role: meta.role,
    relayCode: meta.relayCode,
    room: meta.room,
    name: meta.name,
    seat: meta.seat,
    token: meta.token,
    savedAt: meta.savedAt,
    roomSave,
  };
}

export function saveSavedSession(session: SavedPeerSession): void {
  const meta: Meta = {
    v: SESSION_VERSION,
    role: session.role,
    relayCode: session.relayCode,
    room: session.room,
    name: session.name,
    seat: session.seat,
    token: session.token,
    savedAt: session.savedAt,
    hasRoom: session.roomSave !== null,
  };
  writeRaw(SESSION_KEY, JSON.stringify(meta));
  if (session.roomSave !== null) writeRaw(ROOM_KEY, session.roomSave);
  else removeRaw(ROOM_KEY);
}

export function clearSavedSession(): void {
  removeRaw(SESSION_KEY);
  removeRaw(ROOM_KEY);
}

/** True when the save is recent enough to resume without asking. */
export function isFresh(session: SavedPeerSession, now = Date.now()): boolean {
  return now - session.savedAt <= AUTO_RESUME_MS;
}

function readMeta(): Meta | null {
  const raw = readRaw(SESSION_KEY);
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const meta = value as Record<string, unknown>;
  if (meta.v !== SESSION_VERSION) return null;
  if (meta.role !== 'host' && meta.role !== 'guest') return null;
  if (typeof meta.relayCode !== 'string' || !isRelayCode(meta.relayCode)) return null;
  if (typeof meta.room !== 'string' || !ROOM_PATTERN.test(meta.room)) return null;
  if (typeof meta.token !== 'string' || !TOKEN_PATTERN.test(meta.token)) return null;
  if (!Number.isInteger(meta.seat)) return null;
  const seat = meta.seat as number;
  if (seat < 0 || seat > 3) return null;
  if (typeof meta.savedAt !== 'number' || !Number.isFinite(meta.savedAt)) return null;
  if (typeof meta.name !== 'string') return null;
  return {
    v: SESSION_VERSION,
    role: meta.role,
    relayCode: meta.relayCode,
    room: meta.room,
    name: meta.name.slice(0, 24),
    seat: seat as Seat,
    token: meta.token,
    savedAt: meta.savedAt,
    hasRoom: meta.hasRoom === true,
  };
}
