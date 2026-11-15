import { describe, expect, it } from 'vitest';
import { HAND_SIZE } from '../../constants.js';
import type { EdgeId, GameState, Seat } from '../../types.js';
import { applyAction, createGame, legalMoves } from '../index.js';
import { boardIndex } from '../board.js';
import { act, finishSetup, newGame, reject, setNextRoll, setupGame } from './helpers.js';

function snakeSeats(state: GameState): Seat[] {
  return state.setup?.order.slice() ?? [];
}

/** The snake order the engine promises for a given starting seat. */
function rotatedSnake(playerCount: number, firstSeat: Seat): Seat[] {
  const forward = Array.from({ length: playerCount }, (_, step) => (firstSeat + step) % playerCount);
  return [...forward, ...[...forward].reverse()];
}

describe('setup', () => {
  it('builds the snake order from the seeded first seat for 4, 3 and 2 players', () => {
    for (const count of [4, 3, 2]) {
      const seen = new Set<Seat>();
      for (let offset = 0; offset < 60; offset += 1) {
        const state = newGame(count, 1 + offset);
        expect(snakeSeats(state)).toEqual(rotatedSnake(count, state.firstSeat));
        expect(state.currentSeat).toBe(state.firstSeat);
        expect(state.setup?.order).toHaveLength(count * 2);
        seen.add(state.firstSeat);
      }
      // Every seat starts at least one of the sampled games.
      expect([...seen].sort()).toEqual(
        Array.from({ length: count }, (_, seat) => seat).sort(),
      );
    }
  });

  it('starts with the seeded first seat placing a settlement, no resources, undealt hands', () => {
    const state = newGame(4, 7);
    expect(state.phase).toBe('setup');
    expect(state.turn).toBe(0);
    expect(state.version).toBe(0);
    expect(state.currentSeat).toBe(state.firstSeat);
    expect(state.setup?.step).toBe('settlement');
    // Default settings mean the designed island: the desert sits at centre, C3.
    expect(state.config.map).toEqual({ size: 'standard', terrain: 'fixed', tokens: 'fixed' });
    expect(state.robberHex).toBe('C3');
    expect(state.board.hexes.find((hex) => hex.id === state.robberHex)?.terrain).toBe('desert');
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
    const seat = state.currentSeat;
    const legal = legalMoves(state, seat);
    const vertex = legal.setupSettlements[0] as string;
    state = act(state, seat, { type: 'setupSettlement', vertex });
    expect(state.setup?.step).toBe('road');
    expect(state.setup?.pendingVertex).toBe(vertex);
    expect(state.buildings[vertex]).toEqual({ owner: seat, type: 'settlement' });
    expect(state.currentSeat).toBe(seat);

    const roads = legalMoves(state, seat).setupRoads;
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
    const problem = reject(state, seat, { type: 'setupRoad', edge: unrelated.id });
    expect(problem.code).toBe('NOT_CONNECTED');

    const nextSeat = state.setup?.order[1] as Seat;
    state = act(state, seat, { type: 'setupRoad', edge: roads[0] as EdgeId });
    expect(state.roads[roads[0] as EdgeId]).toBe(seat);
    expect(state.setup?.step).toBe('settlement');
    expect(state.setup?.pendingVertex).toBeNull();
    expect(state.setup?.index).toBe(1);
    expect(state.currentSeat).toBe(nextSeat);
  });

  it('follows the snake for every pick and ends on the first seat at turn 1', () => {
    let state = newGame(4, 11);
    const firstSeat = state.firstSeat;
    const seatTrace: Seat[] = [];
    let guard = 0;
    while (state.phase === 'setup') {
      const seat = state.currentSeat;
      const legal = legalMoves(state, seat);
      if (legal.setupSettlements.length > 0) {
        seatTrace.push(seat);
        state = act(state, seat, {
          type: 'setupSettlement',
          vertex: legal.setupSettlements[0] as string,
        });
      } else {
        state = act(state, seat, { type: 'setupRoad', edge: legal.setupRoads[0] as EdgeId });
      }
      guard += 1;
      if (guard > 40) throw new Error('setup loop');
    }
    expect(seatTrace).toEqual(rotatedSnake(4, firstSeat));
    expect(state.phase).toBe('roll');
    expect(state.turn).toBe(1);
    expect(state.currentSeat).toBe(firstSeat);
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

  it('keeps play clockwise from the first seat', () => {
    for (const count of [4, 3, 2]) {
      let state = finishSetup(newGame(count, 23 + count));
      const start = state.currentSeat;
      state = act(setNextRoll(state, 8), start, { type: 'roll' });
      state = act(state, start, { type: 'endTurn' });
      expect(state.currentSeat).toBe((start + 1) % count);
    }
  });

  it('applies the distance rule during setup and rejects a non-touching road', () => {
    let state = newGame(4, 5);
    const seat = state.currentSeat;
    const otherSeat = state.setup?.order[1] as Seat;
    const first = legalMoves(state, seat).setupSettlements[0] as string;
    state = act(state, seat, { type: 'setupSettlement', vertex: first });
    state = act(state, seat, { type: 'setupRoad', edge: legalMoves(state, seat).setupRoads[0] as EdgeId });

    const index = boardIndex(state.board);
    const neighbour = index.vertexNeighbors.get(first)?.[0] as string;
    const problem = reject(state, otherSeat, { type: 'setupSettlement', vertex: neighbour });
    expect(problem.code).toBe('TOO_CLOSE');

    // Legal pick for the next seat, but the first seat cannot act out of turn.
    const other = legalMoves(state, otherSeat).setupSettlements.find(
      (vertex) => vertex !== neighbour,
    );
    expect(other).toBeDefined();
    const outOfTurn = reject(state, seat, { type: 'setupSettlement', vertex: other as string });
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
    const seat = start.currentSeat;
    const legal = legalMoves(start, seat);
    const afterSettlement = act(start, seat, {
      type: 'setupSettlement',
      vertex: legal.setupSettlements[0] as string,
    });
    expect(afterSettlement.version).toBe(start.version + 1);
    expect(afterSettlement.log.length).toBe(start.log.length + 1);
    expect(afterSettlement.log[afterSettlement.log.length - 1]?.kind).toBe('setup');

    // A rejected action does not bump the version.
    const failed = applyAction(afterSettlement, (seat + 2) % 3, {
      type: 'setupRoad',
      edge: legalMoves(afterSettlement, seat).setupRoads[0] as EdgeId,
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
      expect(state.currentSeat).toBe(state.firstSeat);
      expect(Object.keys(state.buildings)).toHaveLength(count * 2);
      expect(Object.keys(state.roads)).toHaveLength(count * 2);
      expect(state.config.targetVp).toBe(count === 2 ? 18 : 16);
    }
  });
});
