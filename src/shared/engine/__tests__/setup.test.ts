import { describe, expect, it } from 'vitest';
import { HAND_SIZE } from '../../constants.js';
import type { EdgeId, GameState, Seat } from '../../types.js';
import { applyAction, createGame, legalMoves } from '../index.js';
import { boardIndex } from '../board.js';
import { act, finishSetup, newGame, reject, setupGame } from './helpers.js';

function snakeSeats(state: GameState): Seat[] {
  return state.setup?.order.slice() ?? [];
}

describe('setup', () => {
  it('builds the snake order for 4, 3 and 2 players', () => {
    expect(snakeSeats(newGame(4))).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    expect(snakeSeats(newGame(3))).toEqual([0, 1, 2, 2, 1, 0]);
    expect(snakeSeats(newGame(2))).toEqual([0, 1, 1, 0]);
  });

  it('starts with seat 0 placing a settlement, no resources, undealt hands', () => {
    const state = newGame(4, 7);
    expect(state.phase).toBe('setup');
    expect(state.turn).toBe(0);
    expect(state.version).toBe(0);
    expect(state.currentSeat).toBe(0);
    expect(state.setup?.step).toBe('settlement');
    expect(state.robberHex).toBe('C3');
    for (const player of state.players) {
      expect(player.resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
      expect(player.hand).toHaveLength(0);
      expect(player.deck).toHaveLength(HAND_SIZE * 2);
      expect(player.discard).toHaveLength(0);
      expect(player.vp).toBe(0);
    }
  });

  it('places settlement then road for the same seat, and only roads touching that settlement', () => {
    let state = newGame(4, 3);
    const legal = legalMoves(state, 0);
    const vertex = legal.setupSettlements[0] as string;
    state = act(state, 0, { type: 'setupSettlement', vertex });
    expect(state.setup?.step).toBe('road');
    expect(state.setup?.pendingVertex).toBe(vertex);
    expect(state.buildings[vertex]).toEqual({ owner: 0, type: 'settlement' });
    expect(state.currentSeat).toBe(0);

    const roads = legalMoves(state, 0).setupRoads;
    expect(roads.length).toBeGreaterThan(0);
    const index = boardIndex(state.board);
    for (const edgeId of roads) {
      const edge = index.edge.get(edgeId);
      expect([edge?.a, edge?.b]).toContain(vertex);
    }

    // An edge that exists and is free but does not touch the settlement is illegal.
    const unrelated = state.board.edges.find(
      (edge) => edge.a !== vertex && edge.b !== vertex && state.roads[edge.id] === undefined,
    ) as { id: EdgeId };
    const problem = reject(state, 0, { type: 'setupRoad', edge: unrelated.id });
    expect(problem.code).toBe('NOT_CONNECTED');

    state = act(state, 0, { type: 'setupRoad', edge: roads[0] as EdgeId });
    expect(state.roads[roads[0] as EdgeId]).toBe(0);
    expect(state.setup?.step).toBe('settlement');
    expect(state.setup?.pendingVertex).toBeNull();
    expect(state.setup?.index).toBe(1);
    expect(state.currentSeat).toBe(1);
  });

  it('follows the snake for every pick and ends in seat 0 turn 1', () => {
    let state = newGame(4, 11);
    const seatTrace: Seat[] = [];
    let guard = 0;
    while (state.phase === 'setup') {
      const seat = state.currentSeat;
      const legal = legalMoves(state, seat);
      if (legal.setupSettlements.length > 0) {
        seatTrace.push(seat);
        state = act(state, seat, { type: 'setupSettlement', vertex: legal.setupSettlements[0] as string });
      } else {
        state = act(state, seat, { type: 'setupRoad', edge: legal.setupRoads[0] as EdgeId });
      }
      guard += 1;
      if (guard > 40) throw new Error('setup loop');
    }
    expect(seatTrace).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    expect(state.phase).toBe('roll');
    expect(state.turn).toBe(1);
    expect(state.currentSeat).toBe(0);
    expect(state.setup).toBeNull();
    for (const player of state.players) {
      expect(player.hand).toHaveLength(HAND_SIZE);
      expect(player.deck).toHaveLength(HAND_SIZE);
    }
    expect(Object.keys(state.buildings)).toHaveLength(8);
    expect(Object.keys(state.roads)).toHaveLength(8);
    expect(state.log.some((entry) => entry.kind === 'turn' && entry.text.startsWith('Turn 1'))).toBe(
      true,
    );
  });

  it('applies the distance rule during setup and rejects a non-touching road', () => {
    let state = newGame(4, 5);
    const first = legalMoves(state, 0).setupSettlements[0] as string;
    state = act(state, 0, { type: 'setupSettlement', vertex: first });
    state = act(state, 0, { type: 'setupRoad', edge: legalMoves(state, 0).setupRoads[0] as EdgeId });

    const index = boardIndex(state.board);
    const neighbour = index.vertexNeighbors.get(first)?.[0] as string;
    const problem = reject(state, 1, { type: 'setupSettlement', vertex: neighbour });
    expect(problem.code).toBe('TOO_CLOSE');

    // Legal pick for seat 1, but seat 0 cannot act out of turn.
    const other = legalMoves(state, 1).setupSettlements.find((vertex) => vertex !== neighbour);
    expect(other).toBeDefined();
    const outOfTurn = reject(state, 0, { type: 'setupSettlement', vertex: other as string });
    expect(outOfTurn.code).toBe('NOT_YOUR_TURN');
  });

  it('refuses setup actions after setup and reseats the current player', () => {
    const finished = setupGame(4, 9);
    const vertex = finished.board.vertices[0]?.id as string;
    const problem = reject(finished, 0, { type: 'setupSettlement', vertex });
    expect(problem.code).toBe('SETUP_COMPLETE');
  });

  it('increments version and log for each accepted setup placement only', () => {
    const start = newGame(3, 21);
    const legal = legalMoves(start, 0);
    const afterSettlement = act(start, 0, {
      type: 'setupSettlement',
      vertex: legal.setupSettlements[0] as string,
    });
    expect(afterSettlement.version).toBe(start.version + 1);
    expect(afterSettlement.log.length).toBe(start.log.length + 1);
    expect(afterSettlement.log[afterSettlement.log.length - 1]?.kind).toBe('setup');

    // A rejected action does not bump the version.
    const failed = applyAction(afterSettlement, 2, {
      type: 'setupRoad',
      edge: legalMoves(afterSettlement, 0).setupRoads[0] as EdgeId,
    });
    expect(failed.ok).toBe(false);
    expect(afterSettlement.version).toBe(start.version + 1);
    expect(afterSettlement.log.length).toBe(start.log.length + 1);
  });

  it('rejects player counts outside 2-4 and non-integers', () => {
    expect(() => createGame({ playerCount: 1, seed: 1 })).toThrow();
    expect(() => createGame({ playerCount: 5, seed: 1 })).toThrow();
    expect(() => createGame({ playerCount: 2.5, seed: 1 })).toThrow();
  });

  it('finishes setup for 2 and 3 players as well', () => {
    for (const count of [2, 3]) {
      const state = finishSetup(createGame({ playerCount: count, seed: 99 + count }));
      expect(state.phase).toBe('roll');
      expect(Object.keys(state.buildings)).toHaveLength(count * 2);
      expect(Object.keys(state.roads)).toHaveLength(count * 2);
      expect(state.config.targetVp).toBe(count === 2 ? 16 : 14);
    }
  });
});
