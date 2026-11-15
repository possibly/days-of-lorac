import { describe, expect, it } from 'vitest';
import { viewFor } from '../index.js';
import { act, actionGame, newGame, patch, setResources, setupGame } from './helpers.js';

function findUndefined(value: unknown, path = 'view'): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === undefined) return `${path}[${index}]`;
      const nested = findUndefined(value[index], `${path}[${index}]`);
      if (nested) return nested;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) return `${path}.${key}`;
      const nested = findUndefined(nestedValue, `${path}.${key}`);
      if (nested) return nested;
    }
  }
  return null;
}

describe('viewFor', () => {
  it('shows the viewer own hand and hides everyone else', () => {
    const state = actionGame(4, 400);
    const view = viewFor(state, 0);
    expect(view.you).toBe(0);
    expect(view.players[0]?.hand).not.toBeNull();
    expect(view.players[0]?.hand).toHaveLength(state.players[0]?.hand.length ?? 0);
    for (const seat of [1, 2, 3]) {
      expect(view.players[seat]?.hand).toBeNull();
      expect(view.players[seat]?.handCount).toBe(state.players[seat]?.hand.length ?? 0);
      expect(view.players[seat]?.deckCount).toBe(state.players[seat]?.deck.length ?? 0);
      expect(view.players[seat]?.discardCount).toBe(state.players[seat]?.discard.length ?? 0);
    }
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('"deck":[');
    expect(serialized).not.toContain('"discard":[');
  });

  it('keeps played cards and resources public for every player', () => {
    let state = actionGame(4, 401);
    const iid = state.players[0]?.hand[0]?.iid as number;
    const played = act(state, 0, { type: 'playCard', iid });
    const view = viewFor(played, 1);
    expect(view.players[0]?.played).toHaveLength(1);
    expect(view.players[0]?.playedCount).toBe(1);
    expect(view.players[0]?.played[0]?.defId).toBe(played.players[0]?.played[0]?.defId);
    expect(view.players[0]?.hand).toBeNull();
    expect(view.players[0]?.resources).toEqual(played.players[0]?.resources);
    expect(view.players[0]?.vp).toBe(played.players[0]?.vp);
  });

  it('sends only the last 120 log entries', () => {
    let state = setupGame(4, 402);
    state = patch(state, (draft) => {
      draft.log = Array.from({ length: 200 }, (_, index) => ({
        id: index,
        turn: 1,
        seat: null,
        kind: 'info' as const,
        text: `line ${index}`,
      }));
      draft.nextLogId = 200;
    });
    expect(state.log).toHaveLength(200);
    const view = viewFor(state, 0);
    expect(view.log).toHaveLength(120);
    expect(view.log[0]?.id).toBe(80);
    expect(view.log[119]?.id).toBe(199);
  });

  it('computes legality for the viewer, not for the current player', () => {
    const state = actionGame(4, 403);
    const active = viewFor(state, 0);
    const waiting = viewFor(state, 1);
    expect(active.legal.seat).toBe(0);
    expect(active.legal.isTurn).toBe(true);
    expect(active.legal.canEndTurn).toBe(true);
    expect(waiting.legal.seat).toBe(1);
    expect(waiting.legal.isTurn).toBe(false);
    expect(waiting.legal.canEndTurn).toBe(false);
    expect(waiting.legal.build.roads).toEqual([]);
    expect(waiting.legal.playable).toEqual([]);
    expect(waiting.legal.bankTrades).toEqual([]);
    expect(waiting.legal.buyable).toEqual([]);
    expect(waiting.legal.discard).toBeNull();
    expect(waiting.legal.robber).toBeNull();
  });

  it('defaults connected to true and honours the map', () => {
    const state = actionGame(4, 404);
    expect(viewFor(state, 0).players.every((player) => player.connected)).toBe(true);
    const view = viewFor(state, 0, { 1: false, 3: true });
    expect(view.players[1]?.connected).toBe(false);
    expect(view.players[2]?.connected).toBe(true);
    expect(view.players[3]?.connected).toBe(true);
  });

  it('is JSON-serializable with no undefined entries and public market data', () => {
    let state = actionGame(4, 405);
    state = setResources(state, 0, { wood: 3 });
    const view = viewFor(state, 0);
    expect(findUndefined(view)).toBeNull();
    const roundTrip = JSON.parse(JSON.stringify(view)) as typeof view;
    expect(roundTrip.version).toBe(view.version);
    expect(roundTrip.market).toEqual(view.market);
    expect(roundTrip.players[0]?.hand).toEqual(view.players[0]?.hand);
    expect(roundTrip.board.hexes).toHaveLength(19);
    expect(roundTrip.targetVp).toBe(state.config.targetVp);
    expect(roundTrip.legal.buyable.length).toBeGreaterThan(0);
  });

  it('exposes the setup state, pending vertex and setup targets', () => {
    const state = newGame(4, 406);
    const view = viewFor(state, 0);
    expect(view.setup?.step).toBe('settlement');
    expect(view.legal.setupSettlements.length).toBeGreaterThan(0);

    const vertex = view.legal.setupSettlements[0] as string;
    const placed = act(state, 0, { type: 'setupSettlement', vertex });
    const afterView = viewFor(placed, 0);
    expect(afterView.setup?.pendingVertex).toBe(vertex);
    expect(afterView.setup?.step).toBe('road');
    expect(afterView.legal.setupRoads.length).toBeGreaterThan(0);
    // Other seats never receive setup targets.
    expect(viewFor(placed, 1).legal.setupRoads).toEqual([]);
  });

  it('reports a finished game view with winner and empty legal moves', () => {
    const state = setupGame(4, 407);
    const finished = patch(state, (draft) => {
      draft.phase = 'gameOver';
      draft.winner = 2;
    });
    const view = viewFor(finished, 0);
    expect(view.phase).toBe('gameOver');
    expect(view.winner).toBe(2);
    expect(view.legal.canEndTurn).toBe(false);
    expect(view.legal.canRoll).toBe(false);
    expect(view.legal.isTurn).toBe(false);
  });
});
