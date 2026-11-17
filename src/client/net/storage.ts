/**
 * Small localStorage helpers. Display preferences, and the peer table this tab
 * can return to after a refresh.
 *
 * Writes never throw: private mode and a full quota both leave the game working,
 * it just forgets. When there is no `window.localStorage` at all (unit tests,
 * a server render) the helpers fall back to an in-memory map so callers do not
 * need a second code path.
 */

const NAME_KEY = 'lorac.name';
const SOUND_KEY = 'lorac.sound';
const LETTERS_KEY = 'lorac.letters';

const memory = new Map<string, string>();

function backing(): Storage | null {
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function readRaw(key: string): string | null {
  try {
    const store = backing();
    if (store) return store.getItem(key);
  } catch {
    // Private mode can throw on read as well as write.
  }
  return memory.get(key) ?? null;
}

export function writeRaw(key: string, value: string): void {
  memory.set(key, value);
  try {
    backing()?.setItem(key, value);
  } catch {
    // Quota or private mode. The in-memory copy still serves this tab.
  }
}

export function removeRaw(key: string): void {
  memory.delete(key);
  try {
    backing()?.removeItem(key);
  } catch {
    // Nothing to do; the value is already forgotten in memory.
  }
}

function safeGet(key: string): string | null {
  return readRaw(key);
}

function safeSet(key: string, value: string | null): void {
  if (value === null) removeRaw(key);
  else writeRaw(key, value);
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
