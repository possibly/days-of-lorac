import { describe, expect, it } from 'vitest';
import type { GameState, VertexId } from '../../types.js';
import { applyAction, scorePlayer } from '../index.js';
import { act, actionGame, extendToSettlement, newGame, patch, setHand, setResources } from './helpers.js';

/** Gives a seat a concrete VP pile: settlements, cities and charters. */
function craftVp(
  state: GameState,
  seat: number,
  options: { settlements?: number; cities?: number; charters?: Record<string, number>; renown?: number },
): GameState {
  return patch(state, (draft) => {
    // Start from a clean board so the setup settlements do not add to the pile.
    draft.buildings = {};
    const settlements = options.settlements ?? 0;
    const cities = options.cities ?? 0;
    const vertices = draft.board.vertices.map((vertex) => vertex.id);
    let index = 0;
    for (let i = 0; i < settlements; i += 1) {
      draft.buildings[vertices[index] as VertexId] = { owner: seat, type: 'settlement' };
      index += 1;
    }
    for (let i = 0; i < cities; i += 1) {
      draft.buildings[vertices[index] as VertexId] = { owner: seat, type: 'city' };
      index += 1;
    }
    draft.players[seat]!.charters = { ...(options.charters ?? {}) };
    draft.players[seat]!.renown = options.renown ?? 0;
  });
}

describe('victory', () => {
  it('uses 18 / 16 / 14 for 2 / 3 / 4 players', () => {
    expect(newGame(2).config.targetVp).toBe(18);
    expect(newGame(3).config.targetVp).toBe(16);
    expect(newGame(4).config.targetVp).toBe(14);
  });

  it('wins instantly on a charter purchase, then refuses further actions', () => {
    let state = actionGame(4, 300);
    state = craftVp(state, 0, { settlements: 4, cities: 4 }); // 4 + 8 = 12
    expect(scorePlayer(state, 0).total).toBe(12);
    state = setResources(state, 0, { ore: 3, wheat: 3, brick: 3, wood: 5 });

    const won = act(state, 0, { type: 'buyCard', defId: 'fleet-charter' });
    expect(scorePlayer(won, 0).total).toBe(14);
    expect(won.phase).toBe('gameOver');
    expect(won.winner).toBe(0);
    expect(won.log.some((entry) => entry.kind === 'win')).toBe(true);

    const afterwards = applyAction(won, 0, { type: 'endTurn' });
    expect(afterwards.ok).toBe(false);
    if (!afterwards.ok) expect(afterwards.code).toBe('GAME_OVER');
  });

  it('wins on a settlement build', () => {
    let state = actionGame(4, 301);
    state = craftVp(state, 0, { settlements: 5, cities: 4 }); // 5 + 8 = 13
    expect(scorePlayer(state, 0).total).toBe(13);
    const extended = extendToSettlement(state, 0);
    const funded = setResources(extended.state, 0, { wood: 4, brick: 4, sheep: 4, wheat: 4 });
    const won = act(funded, 0, { type: 'buildSettlement', vertex: extended.vertex });
    expect(scorePlayer(won, 0).total).toBe(14);
    expect(won.phase).toBe('gameOver');
    expect(won.winner).toBe(0);
  });

  it('wins mid-card on renown and stops the remaining effects', () => {
    let state = actionGame(4, 302);
    state = craftVp(state, 0, {
      settlements: 5,
      cities: 3,
      charters: { 'quay-deed': 1 },
      renown: 2,
    }); // 5 + 6 + 1 = 12 VP, no award yet
    expect(scorePlayer(state, 0).total).toBe(12);
    expect(state.awards.largestExpedition).toBeNull();

    const extended = extendToSettlement(state, 0);
    const ready = setHand(extended.state, 0, ['shipwrights-yard']);
    const iid = ready.players[0]?.hand[0]?.iid as number;

    const won = act(ready, 0, {
      type: 'playCard',
      iid,
      choice: { kind: 'settlement', vertex: extended.vertex },
    });

    // The renown pushed 3 -> award -> 14 VP before the free settlement ran.
    expect(won.phase).toBe('gameOver');
    expect(won.winner).toBe(0);
    expect(won.awards.largestExpedition).toBe(0);
    expect(scorePlayer(won, 0).total).toBe(14);
    expect(won.buildings[extended.vertex]).toBeUndefined();
    expect(won.players[0]?.renown).toBe(3);
  });

  it('leaves the game running below the target and blocks actions only at the end', () => {
    let state = actionGame(4, 303);
    state = craftVp(state, 0, { settlements: 3, cities: 2 }); // 7 VP
    state = setResources(state, 0, { ore: 3, wheat: 3, brick: 3 });
    const bought = act(state, 0, { type: 'buyCard', defId: 'fleet-charter' });
    expect(scorePlayer(bought, 0).total).toBe(9);
    expect(bought.phase).toBe('action');
    expect(bought.winner).toBeNull();
    const ended = act(bought, 0, { type: 'endTurn' });
    expect(ended.phase).toBe('roll');
    expect(ended.winner).toBeNull();
  });
});
