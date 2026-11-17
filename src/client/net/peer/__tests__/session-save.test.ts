/**
 * The saved peer table. Node has no localStorage, so the helpers in storage.ts
 * fall back to a per-process map: these tests exercise the real read and write
 * path without a DOM.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_KEY,
  SESSION_TTL_MS,
  clearSavedSession,
  isFresh,
  loadSavedSession,
  saveSavedSession,
} from '../session-save';
import { readRaw, writeRaw } from '../../storage';
import type { SavedPeerSession } from '../session-save';

function guest(overrides: Partial<SavedPeerSession> = {}): SavedPeerSession {
  return {
    v: 1,
    role: 'guest',
    relayCode: 'ABCD',
    room: 'WXYZ',
    name: 'Guest',
    seat: 1,
    token: 'a'.repeat(32),
    savedAt: 1_700_000_000_000,
    roomSave: null,
    ...overrides,
  };
}

describe('saved peer session', () => {
  beforeEach(() => {
    clearSavedSession();
  });

  it('round-trips a guest seat', () => {
    const session = guest();
    saveSavedSession(session);
    const back = loadSavedSession(session.savedAt);
    expect(back).toEqual(session);
  });

  it('round-trips a host room', () => {
    const session = guest({ role: 'host', roomSave: '{"code":"WXYZ"}', seat: 0 });
    saveSavedSession(session);
    const back = loadSavedSession(session.savedAt);
    expect(back?.role).toBe('host');
    expect(back?.roomSave).toBe('{"code":"WXYZ"}');
  });

  it('drops a host session with no room snapshot', () => {
    saveSavedSession(guest({ role: 'host', roomSave: null }));
    expect(loadSavedSession(1_700_000_000_000)).toBeNull();
    expect(readRaw(SESSION_KEY)).toBeNull();
  });

  it('forgets a table older than the window', () => {
    const session = guest();
    saveSavedSession(session);
    expect(loadSavedSession(session.savedAt + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(loadSavedSession(session.savedAt + SESSION_TTL_MS + 1)).toBeNull();
  });

  it('refuses metadata that is not ours', () => {
    const base = {
      v: 1,
      role: 'guest',
      relayCode: 'ABCD',
      room: 'WXYZ',
      name: 'Guest',
      seat: 1,
      token: 'a'.repeat(32),
      savedAt: 1_700_000_000_000,
      hasRoom: false,
    };
    writeRaw(SESSION_KEY, JSON.stringify(base));
    expect(loadSavedSession(base.savedAt)).not.toBeNull();

    for (const patch of [
      { v: 9 },
      { role: 'referee' },
      { relayCode: 'ZZZZZ' },
      { room: 'nope' },
      { token: '<script>' },
      { seat: 11 },
      { savedAt: 'yesterday' },
    ]) {
      writeRaw(SESSION_KEY, JSON.stringify({ ...base, ...patch }));
      expect(loadSavedSession(base.savedAt)).toBeNull();
    }
    writeRaw(SESSION_KEY, 'not json');
    expect(loadSavedSession(base.savedAt)).toBeNull();
  });

  it('treats a reload as fresh and a later visit as not', () => {
    const session = guest();
    expect(isFresh(session, session.savedAt + 5_000)).toBe(true);
    expect(isFresh(session, session.savedAt + 10 * 60_000)).toBe(false);
  });
});
