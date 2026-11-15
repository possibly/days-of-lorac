/**
 * Small localStorage helpers. Only the seat token, display name, last room and
 * two display settings are persisted; nothing about the game itself.
 */

const NAME_KEY = 'lorac.name';
const SOUND_KEY = 'lorac.sound';
const LETTERS_KEY = 'lorac.letters';
const LAST_KEY = 'lorac.last';
const TOKEN_PREFIX = 'lorac.token.';

export interface StoredSession {
  code: string;
  token: string;
  seat: number;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota: the game still works, it just forgets.
  }
}

export function loadName(): string {
  return safeGet(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  safeSet(NAME_KEY, name.trim().slice(0, 24));
}

export function loadSound(): boolean {
  return safeGet(SOUND_KEY) !== 'off';
}

export function saveSound(on: boolean): void {
  safeSet(SOUND_KEY, on ? 'on' : 'off');
}

export function loadLetters(): boolean {
  return safeGet(LETTERS_KEY) === 'on';
}

export function saveLetters(on: boolean): void {
  safeSet(LETTERS_KEY, on ? 'on' : 'off');
}

export function tokenKey(code: string): string {
  return `${TOKEN_PREFIX}${code.toUpperCase()}`;
}

export function loadToken(code: string): string | null {
  return safeGet(tokenKey(code));
}

export function saveToken(code: string, token: string, seat: number): void {
  const upper = code.toUpperCase();
  safeSet(tokenKey(upper), token);
  safeSet(LAST_KEY, JSON.stringify({ code: upper, seat }));
}

export function clearToken(code: string): void {
  const upper = code.toUpperCase();
  safeSet(tokenKey(upper), null);
  const last = loadLastSession();
  if (!last || last.code === upper) safeSet(LAST_KEY, null);
}

/** Last room we were seated in. The token itself lives under its own key. */
export function loadLastSession(): { code: string; seat: number } | null {
  const raw = safeGet(LAST_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; seat?: unknown };
    if (typeof parsed.code !== 'string' || !/^[A-Z]{4}$/.test(parsed.code)) return null;
    if (typeof parsed.seat !== 'number') return null;
    return { code: parsed.code, seat: parsed.seat };
  } catch {
    return null;
  }
}

/** A resumable session means both the last-room record and its token exist. */
export function loadResumable(): StoredSession | null {
  const last = loadLastSession();
  if (!last) return null;
  const token = loadToken(last.code);
  if (!token) return null;
  return { code: last.code, token, seat: last.seat };
}

export function forgetSession(): void {
  const last = loadLastSession();
  if (last) safeSet(tokenKey(last.code), null);
  safeSet(LAST_KEY, null);
}
