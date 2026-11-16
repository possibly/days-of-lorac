/**
 * Small localStorage helpers. Only the display name and two display settings
 * are persisted; nothing about the game itself.
 */

const NAME_KEY = 'lorac.name';
const SOUND_KEY = 'lorac.sound';
const LETTERS_KEY = 'lorac.letters';

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
