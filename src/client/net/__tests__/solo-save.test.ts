/**
 * Solo saves. Node has no localStorage, so storage.ts falls back to a
 * per-process map and these tests run the real read and write path.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '@shared/engine';
import { DEFAULT_MAP_SETTINGS } from '@shared/map-settings';
import { DEFAULT_CARD_SETTINGS } from '@shared/card-settings';
import { GAME_VERSION } from '@shared/version';
import type { GameState } from '@shared/types';
import { SAVE_LOG_LIMIT } from '../../../server/room-save.js';
import {
  SOLO_AUTO_RESUME_MS,
  SOLO_KEY,
  SOLO_VERSION,
  clearSoloGame,
  isSoloFresh,
  loadSoloGame,
  saveSoloGame,
  soloResumeInfo,
} from '../solo-save';
import type { SavedSoloGame } from '../solo-save';
import { readRaw, writeRaw } from '../storage';

const NOW = 1_700_000_000_000;

function gameState(players: 2 | 3 | 4 = 2): GameState {
  const names = Array.from({ length: players }, (_, seat) => (seat === 0 ? 'You' : `Bot ${seat}`));
  return createGame({
    playerCount: players,
    map: DEFAULT_MAP_SETTINGS,
    cards: DEFAULT_CARD_SETTINGS,
    seed: 42,
    gameId: 'solo-game',
    names,
    bots: names.map((_, seat) => seat > 0),
    difficulties: names.map((_, seat) => (seat > 0 ? 'normal' : null)),
  });
}

function save(overrides: Partial<SavedSoloGame> = {}): SavedSoloGame {
  return {
    v: SOLO_VERSION,
    gameVersion: GAME_VERSION,
    savedAt: NOW,
    humanName: 'Tyler',
    seats: 2,
    difficulty: 'normal',
    map: DEFAULT_MAP_SETTINGS,
    cards: DEFAULT_CARD_SETTINGS,
    state: gameState(2),
    ...overrides,
  };
}

describe('solo saves', () => {
  beforeEach(() => {
    clearSoloGame();
  });

  it('round-trips a game with its settings', () => {
    const original = save();
    saveSoloGame(original, NOW);
    const back = loadSoloGame(NOW);
    expect(back).not.toBeNull();
    expect(back?.humanName).toBe('Tyler');
    expect(back?.seats).toBe(2);
    expect(back?.difficulty).toBe('normal');
    expect(back?.map).toEqual(DEFAULT_MAP_SETTINGS);
    expect(back?.state.gameId).toBe('solo-game');
    expect(back?.state.version).toBe(original.state.version);
    expect(back?.state.rng).toBe(original.state.rng);
    expect(back?.state.players[0]?.name).toBe('You');
  });

  it('trims the log and leaves the live state alone', () => {
    const state = gameState(2);
    state.log.push(
      ...Array.from({ length: SAVE_LOG_LIMIT + 50 }, (_, index) => ({
        id: 1000 + index,
        turn: 1,
        seat: null,
        kind: 'info' as const,
        text: `line ${index}`,
      })),
    );
    const total = state.log.length;
    saveSoloGame(save({ state }), NOW);
    const back = loadSoloGame(NOW);
    expect(back?.state.log.length).toBe(SAVE_LOG_LIMIT);
    expect(back?.state.log.at(-1)?.text).toBe(`line ${SAVE_LOG_LIMIT + 49}`);
    expect(state.log.length).toBe(total);
  });

  it('describes the save for the title screen', () => {
    saveSoloGame(save(), NOW);
    const back = loadSoloGame(NOW);
    expect(back && soloResumeInfo(back)).toEqual({ seats: 2, turn: 0, savedAt: NOW });
  });

  it('refuses a blob from another build or a broken one', () => {
    const original = save();
    for (const patch of [
      { v: 9 },
      { gameVersion: '0.0.1' },
      { seats: 5 },
      { savedAt: 'yesterday' },
      { map: { size: 'huge' } },
      { cards: { pool: 'nope' } },
    ]) {
      writeRaw(SOLO_KEY, JSON.stringify({ ...original, ...patch }));
      expect(loadSoloGame(NOW)).toBeNull();
      expect(readRaw(SOLO_KEY)).toBeNull();
    }
    writeRaw(SOLO_KEY, 'not json');
    expect(loadSoloGame(NOW)).toBeNull();
  });

  it('falls back to normal difficulty rather than losing the game', () => {
    saveSoloGame(save({ difficulty: 'nightmare' as SavedSoloGame['difficulty'] }), NOW);
    expect(loadSoloGame(NOW)?.difficulty).toBe('normal');
  });

  it('refuses a state that does not match the seat count', () => {
    writeRaw(SOLO_KEY, JSON.stringify(save({ seats: 4, state: gameState(2) })));
    expect(loadSoloGame(NOW)).toBeNull();

    const broken = gameState(2) as unknown as Record<string, unknown>;
    broken.phase = 'nonsense';
    writeRaw(SOLO_KEY, JSON.stringify(save({ state: broken as unknown as GameState })));
    expect(loadSoloGame(NOW)).toBeNull();
  });

  it('cleans names and clamps a future timestamp', () => {
    saveSoloGame(save({ humanName: '<b>Tyler</b>', savedAt: NOW + 60_000 }), NOW);
    const back = loadSoloGame(NOW);
    expect(back?.humanName).toBe('bTyler/b');
    expect(back?.savedAt).toBe(NOW);
    expect(back && isSoloFresh(back, NOW)).toBe(true);
    expect(back && isSoloFresh(back, NOW + SOLO_AUTO_RESUME_MS + 1)).toBe(false);
  });

  it('forgets on request', () => {
    saveSoloGame(save(), NOW);
    expect(loadSoloGame(NOW)).not.toBeNull();
    clearSoloGame();
    expect(loadSoloGame(NOW)).toBeNull();
  });
});
