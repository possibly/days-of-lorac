/**
 * The bot game this browser can walk back into.
 *
 * Solo play runs entirely in the tab, so there is no relay, no seat token and
 * nobody waiting: one save, one key, and the same structural check the peer
 * host uses for its room. The game state goes to storage with the settings that
 * created it, because the board size and card market are not recoverable from
 * the state alone.
 *
 * A corrupt or foreign blob is treated as no save. A solo game is never worth
 * crashing over.
 */
import { DEFAULT_CARD_SETTINGS, isValidCardSettings, normalizeCardSettings } from '@shared/card-settings';
import { DEFAULT_MAP_SETTINGS, isValidMapSettings, normalizeMapSettings } from '@shared/map-settings';
import { GAME_VERSION } from '@shared/version';
import type { BotDifficulty, CardSettings, GameState, MapSettings } from '@shared/types';
import { parseGameState, SAVE_MAX_CHARS, trimStateLog } from '../../server/room-save.js';
import { difficultyOr, isBotDifficulty, isSeatCount, sanitizeName } from '../../server/rooms.js';
import { readRaw, removeRaw, writeRaw } from './storage';

export const SOLO_KEY = 'lorac.solo.game';
export const SOLO_VERSION = 1;
/** A reload lands inside this window, so boot resumes without asking. */
export const SOLO_AUTO_RESUME_MS = 45_000;

export interface SavedSoloGame {
  v: number;
  gameVersion: string;
  savedAt: number;
  humanName: string;
  seats: 2 | 3 | 4;
  difficulty: BotDifficulty;
  map: MapSettings;
  cards: CardSettings;
  state: GameState;
}

/** What the title screen needs to describe a saved game. */
export interface SoloResumeInfo {
  seats: 2 | 3 | 4;
  /** 0 during setup, then 1-based. */
  turn: number;
  savedAt: number;
}

export function loadSoloGame(now = Date.now()): SavedSoloGame | null {
  const raw = readRaw(SOLO_KEY);
  if (!raw || raw.length > SAVE_MAX_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const save = readSoloGame(value, now);
  if (!save) removeRaw(SOLO_KEY);
  return save;
}

export function saveSoloGame(save: SavedSoloGame, now = Date.now()): void {
  const trimmed: SavedSoloGame = {
    ...save,
    savedAt: now,
    state: trimStateLog(save.state),
  };
  writeRaw(SOLO_KEY, JSON.stringify(trimmed));
}

export function clearSoloGame(): void {
  removeRaw(SOLO_KEY);
}

export function isSoloFresh(save: SavedSoloGame, now = Date.now()): boolean {
  return now - save.savedAt <= SOLO_AUTO_RESUME_MS;
}

export function soloResumeInfo(save: SavedSoloGame): SoloResumeInfo {
  return { seats: save.seats, turn: save.state.turn, savedAt: save.savedAt };
}

function readSoloGame(value: unknown, now: number): SavedSoloGame | null {
  if (!isRecord(value)) return null;
  if (value.v !== SOLO_VERSION) return null;
  if (value.gameVersion !== GAME_VERSION) return null;
  if (!isFiniteNumber(value.savedAt)) return null;
  const savedAt = Math.min(value.savedAt, now);
  if (!isSeatCount(value.seats)) return null;
  if (!isValidMapSettings(value.map) || !isValidCardSettings(value.cards)) return null;

  const humanName = sanitizeName(value.humanName) ?? 'You';
  const difficulty = isBotDifficulty(value.difficulty)
    ? value.difficulty
    : difficultyOr(value.difficulty, 'normal');
  const map = normalizeMapSettings(value.map, DEFAULT_MAP_SETTINGS);
  const cards = normalizeCardSettings(value.cards, DEFAULT_CARD_SETTINGS);
  const state = parseGameState(value.state, value.seats);
  if (!state) return null;

  return {
    v: SOLO_VERSION,
    gameVersion: GAME_VERSION,
    savedAt,
    humanName,
    seats: value.seats,
    difficulty,
    map,
    cards,
    state,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
