import { describe, expect, it } from 'vitest';
import type { GameAction, GameState, Resource, Seat } from '../../types.js';
import { RESOURCES } from '../../types.js';
import { legalMoves } from '../index.js';
import { act, newGame } from './helpers.js';

/**
 * A deterministic, legal-only policy. It is not a good bot, but it exercises
 * every phase including the out-of-turn discard, and it must always find a
 * move the engine accepts.
 */
function chooseAction(state: GameState): GameAction {
  if (state.phase === 'setup') {
    const legal = legalMoves(state, state.currentSeat);
    if (legal.setupSettlements.length > 0) {
      return { type: 'setupSettlement', vertex: legal.setupSettlements[0] as string };
    }
    return { type: 'setupRoad', edge: legal.setupRoads[0] as string };
  }

  if (state.phase === 'discard') {
    const seat = state.discardQueue[0] as Seat;
    const required = state.discardRequired[seat] ?? 0;
    const player = state.players[seat];
    const resources: Partial<Record<Resource, number>> = {};
    let left = required;
    for (const resource of RESOURCES) {
      const take = Math.min(left, player?.resources[resource] ?? 0);
      if (take > 0) {
        resources[resource] = take;
        left -= take;
      }
    }
    if (left > 0) throw new Error(`seat ${seat} cannot cover a discard of ${required}`);
    return { type: 'discard', resources };
  }

  if (state.phase === 'robber') {
    const legal = legalMoves(state, state.currentSeat);
    const hex = legal.robber?.hexes[0] as string;
    const victims = legal.robber?.victims[hex] ?? [];
    return { type: 'moveRobber', hex, ...(victims.length > 0 ? { victimSeat: victims[0] } : {}) };
  }

  const seat = state.currentSeat;
  const legal = legalMoves(state, seat);
  if (legal.canRoll) return { type: 'roll' };

  for (const card of legal.playable) {
    if (card.choice === 'road') {
      const edge = card.roadOptions?.[0];
      return edge
        ? { type: 'playCard', iid: card.iid, choice: { kind: 'road', edge } }
        : { type: 'playCard', iid: card.iid };
    }
    if (card.choice === 'settlement') {
      const vertex = card.settlementOptions?.[0];
      return vertex
        ? { type: 'playCard', iid: card.iid, choice: { kind: 'settlement', vertex } }
        : { type: 'playCard', iid: card.iid };
    }
    if (card.choice === 'resources') {
      return {
        type: 'playCard',
        iid: card.iid,
        choice: { kind: 'resources', resources: ['ore', 'wheat'] },
      };
    }
    return { type: 'playCard', iid: card.iid };
  }

  if (legal.build.affordable.settlement && legal.build.settlements.length > 0) {
    return { type: 'buildSettlement', vertex: legal.build.settlements[0] as string };
  }
  if (legal.build.affordable.city && legal.build.cities.length > 0) {
    return { type: 'buildCity', vertex: legal.build.cities[0] as string };
  }
  if (legal.build.affordable.road && legal.build.roads.length > 0) {
    return { type: 'buildRoad', edge: legal.build.roads[0] as string };
  }
  if (legal.buyable.length > 0) {
    return { type: 'buyCard', defId: legal.buyable[0] as string };
  }
  if (legal.canEndTurn) return { type: 'endTurn' };
  throw new Error(`no legal action in phase ${state.phase}`);
}

function playGame(playerCount: number, seed: number): GameState {
  let state = newGame(playerCount, seed);
  for (let step = 0; step < 6000; step += 1) {
    if (state.phase === 'gameOver') return state;
    const seat = state.phase === 'discard' ? (state.discardQueue[0] as Seat) : state.currentSeat;
    state = act(state, seat, chooseAction(state));
  }
  throw new Error('game did not finish');
}

describe('full games', () => {
  for (const playerCount of [2, 3, 4]) {
    it(`plays a complete ${playerCount}-player game without stalls or illegal moves`, () => {
      const state = playGame(playerCount, 777 + playerCount);
      expect(state.phase).toBe('gameOver');
      expect(state.winner).not.toBeNull();
      const winner = state.players[state.winner as number];
      expect(winner?.vp).toBeGreaterThanOrEqual(state.config.targetVp);
      expect(state.log.some((entry) => entry.kind === 'win')).toBe(true);
      expect(state.discardQueue).toEqual([]);
      expect(state.tradeOffer).toBeNull();
      expect(state.setup).toBeNull();
      for (const player of state.players) {
        expect(player.vp).toBe(player.vpBreakdown.total);
      }
    });
  }

  it('is deterministic across a whole game', () => {
    const first = playGame(4, 4242);
    const second = playGame(4, 4242);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const different = playGame(4, 4243);
    expect(JSON.stringify(different)).not.toBe(JSON.stringify(first));
  });
});
