import { describe, expect, it } from 'vitest';
import { countResources } from '../../constants.js';
import type { EdgeId, GameState, Resource, VertexId } from '../../types.js';
import { applyAction, bestBankRate, legalMoves } from '../index.js';
import {
  act,
  actionGame,
  actionPhase,
  extendToSettlement,
  finishSetup,
  newGame,
  patch,
  reject,
  setNextRoll,
  setResources,
  setupGame,
} from './helpers.js';

function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

describe('actions: core invariants', () => {
  it('never mutates the input state, on success or failure', () => {
    const state = actionGame(4, 4);
    const before = snapshot(state);
    const played = applyAction(state, 0, { type: 'endTurn' });
    expect(played.ok).toBe(true);
    expect(snapshot(state)).toBe(before);

    const failed = applyAction(state, 0, { type: 'buildRoad', edge: 'e-not-real' });
    expect(failed.ok).toBe(false);
    expect(snapshot(state)).toBe(before);
  });

  it('is deterministic: same seed and actions produce a deep-equal state', () => {
    const run = (seed: number): string => {
      let state = finishSetup(newGame(4, seed));
      const first = state.currentSeat;
      const second = (first + 1) % 4;
      state = act(setNextRoll(state, 6), first, { type: 'roll' });
      state = act(state, first, { type: 'endTurn' });
      state = setResources(state, second, { wood: 5, brick: 5 });
      state = act(setNextRoll(state, 9), second, { type: 'roll' });
      const edge = legalMoves(state, second).build.roads[0];
      if (edge) state = act(state, second, { type: 'buildRoad', edge });
      state = act(state, second, { type: 'endTurn' });
      return snapshot(state);
    };

    expect(run(1234)).toBe(run(1234));
    expect(run(1234)).not.toBe(run(4321));
  });

  it('increments version once per accepted action and rejects unknown or out-of-turn actions', () => {
    const setup = setupGame(4, 12);
    const state = setNextRoll(setup, 8);
    const rolled = act(state, 0, { type: 'roll' });
    expect(rolled.version).toBe(state.version + 1);

    const outOfTurn = reject(rolled, 1, { type: 'endTurn' });
    expect(outOfTurn.code).toBe('NOT_YOUR_TURN');

    const notInPhase = reject(rolled, 0, { type: 'roll' });
    expect(notInPhase.code).toBe('WRONG_PHASE');

    const bogus = applyAction(rolled, 0, { type: 'nonsense' } as never);
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) expect(bogus.code).toBe('INVALID_ACTION');

    const badSeat = applyAction(rolled, 9, { type: 'roll' });
    expect(badSeat.ok).toBe(false);
    if (!badSeat.ok) expect(badSeat.code).toBe('SEAT_INVALID');
  });
});

describe('production', () => {
  function expectedGains(state: GameState, seat: number, token: number): Record<string, number> {
    const expected: Record<string, number> = {};
    for (const hex of state.board.hexes) {
      if (hex.token !== token || hex.id === state.robberHex) continue;
      for (const vertex of hex.vertices) {
        const building = state.buildings[vertex];
        if (!building || building.owner !== seat) continue;
        const amount = building.type === 'city' ? 2 : 1;
        expected[hex.terrain] = (expected[hex.terrain] ?? 0) + amount;
      }
    }
    return expected;
  }

  it('pays settlements 1 and cities 2 on the rolled number', () => {
    let state = setupGame(4, 2);
    const entry = Object.entries(state.buildings)[0] as [string, { owner: number }];
    const [vertex, info] = entry;
    const hex = state.board.hexes.find((candidate) => candidate.vertices.includes(vertex));
    const token = hex?.token as number;
    expect(token).toBeGreaterThanOrEqual(2);

    state = patch(state, (draft) => {
      draft.buildings[vertex] = { owner: info.owner, type: 'city' };
    });
    const before = { ...(state.players[info.owner]?.resources ?? {}) } as Record<Resource, number>;
    const expected = expectedGains(state, info.owner, token);

    const rolled = act(setNextRoll(state, token), 0, { type: 'roll' });
    expect(rolled.phase).toBe('action');
    expect(rolled.dice?.total).toBe(token);
    const after = rolled.players[info.owner]?.resources as Record<Resource, number>;
    for (const resource of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[]) {
      expect(after[resource] - before[resource]).toBe(expected[resource] ?? 0);
    }
    expect(rolled.dice?.gains[info.owner]).toEqual(expected);
    // The city produced 2 of something, not 1.
    expect(Object.values(expected).some((amount) => amount >= 2)).toBe(true);
  });

  it('blocks production on the robber hex and reports it', () => {
    let state = setupGame(4, 6);
    const [vertex] = Object.entries(state.buildings)[0] as [string, { owner: number }];
    const hex = state.board.hexes.find((candidate) => candidate.vertices.includes(vertex));
    const token = hex?.token as number;
    const owner = (state.buildings[vertex] as { owner: number }).owner;
    state = patch(state, (draft) => {
      draft.robberHex = hex?.id as string;
    });

    const before = { ...(state.players[owner]?.resources ?? {}) } as Record<Resource, number>;
    const rolled = act(setNextRoll(state, token), 0, { type: 'roll' });
    expect(rolled.dice?.total).toBe(token);
    expect(rolled.dice?.blockedByRobber).toContain(hex?.id);
    const after = rolled.players[owner]?.resources as Record<Resource, number>;
    // Every producing hex for this token is blocked, so the owner gains nothing.
    const produces = rolled.board.hexes.some(
      (candidate) =>
        candidate.token === token &&
        candidate.id !== hex?.id &&
        candidate.vertices.some((v) => rolled.buildings[v]?.owner === owner),
    );
    if (!produces) {
      expect(after).toEqual(before);
      expect(rolled.dice?.gains[owner]).toEqual({});
    }
  });

  it('accepts a roll with nobody producing and still opens the action phase', () => {
    let state = setupGame(2, 8);
    state = patch(state, (draft) => {
      draft.buildings = {};
    });
    const rolled = act(setNextRoll(state, 8), 0, { type: 'roll' });
    expect(rolled.phase).toBe('action');
    expect(rolled.dice?.gains[0]).toEqual({});
    expect(rolled.log.some((entry) => entry.text.includes('nothing was produced'))).toBe(true);
  });
});

describe('seven: discards, robber, steal', () => {
  it('queues discards out of turn, enforces exact counts, then moves the robber', () => {
    let state = setupGame(4, 14);
    state = setResources(state, 0, { wood: 12 });
    state = setResources(state, 1, { ore: 9 });
    state = setResources(state, 2, { sheep: 14 });

    const rolled = act(setNextRoll(state, 7), 0, { type: 'roll' });
    expect(rolled.phase).toBe('discard');
    expect(rolled.discardQueue).toEqual([0, 2]);
    expect(rolled.discardRequired[0]).toBe(6);
    expect(rolled.discardRequired[2]).toBe(7);
    expect(rolled.discardQueue.includes(1)).toBe(false);

    // Seat 2, out of turn, may discard.
    const afterSeatTwo = act(rolled, 2, { type: 'discard', resources: { sheep: 7 } });
    expect(afterSeatTwo.discardQueue).toEqual([0]);
    expect(afterSeatTwo.players[2]?.resources.sheep).toBe(7);

    expect(reject(afterSeatTwo, 0, { type: 'discard', resources: { wood: 5 } }).code).toBe(
      'INVALID_DISCARD',
    );
    expect(reject(afterSeatTwo, 0, { type: 'discard', resources: { wood: 13 } }).code).toBe(
      'INVALID_DISCARD',
    );
    expect(reject(afterSeatTwo, 1, { type: 'discard', resources: { ore: 1 } }).code).toBe(
      'DISCARD_NOT_REQUIRED',
    );
    expect(
      reject(afterSeatTwo, 0, { type: 'discard', resources: { wood: 4, ore: 1 } }).code,
    ).toBe('INVALID_DISCARD');

    const finish = act(afterSeatTwo, 0, { type: 'discard', resources: { wood: 6 } });
    expect(finish.phase).toBe('robber');
    expect(finish.discardQueue).toEqual([]);
    expect(finish.players[0]?.resources.wood).toBe(6);

    expect(reject(finish, 0, { type: 'moveRobber', hex: finish.robberHex }).code).toBe(
      'ROBBER_SAME_HEX',
    );
    expect(reject(finish, 0, { type: 'moveRobber', hex: 'ZZ' }).code).toBe('INVALID_ROBBER_HEX');
  });

  it('steals exactly one random resource from the chosen victim', () => {
    let state = setupGame(4, 30);
    state = setResources(state, 0, { wood: 11 });
    state = setResources(state, 1, { ore: 5 });

    let rolled = act(setNextRoll(state, 7), 0, { type: 'roll' });
    expect(rolled.phase).toBe('discard');
    rolled = act(rolled, 0, { type: 'discard', resources: { wood: 5 } });
    expect(rolled.phase).toBe('robber');

    const target = rolled.board.hexes.find(
      (hex) =>
        hex.id !== rolled.robberHex &&
        hex.vertices.some((vertex) => rolled.buildings[vertex]?.owner === 1),
    );
    const hexId = target?.id as string;

    const emptyHex = rolled.board.hexes.find(
      (hex) =>
        hex.id !== rolled.robberHex &&
        !hex.vertices.some((vertex) => rolled.buildings[vertex] !== undefined),
    );
    const invalidVictim = reject(rolled, 0, {
      type: 'moveRobber',
      hex: emptyHex?.id as string,
      victimSeat: 1,
    });
    expect(invalidVictim.code).toBe('INVALID_VICTIM');

    const totals = {
      roller: countResources(rolled.players[0]?.resources ?? {}),
      victim: countResources(rolled.players[1]?.resources ?? {}),
    };
    const moved = act(rolled, 0, { type: 'moveRobber', hex: hexId, victimSeat: 1 });
    expect(moved.phase).toBe('action');
    expect(moved.robberHex).toBe(hexId);
    expect(countResources(moved.players[0]?.resources ?? {})).toBe(totals.roller + 1);
    expect(countResources(moved.players[1]?.resources ?? {})).toBe(totals.victim - 1);
    expect(moved.log.some((entry) => entry.kind === 'steal')).toBe(true);
  });

  it('moves the robber and skips the steal when nobody is adjacent', () => {
    let state = setupGame(2, 41);
    state = setResources(state, 0, { wood: 10 });
    let rolled = act(setNextRoll(state, 7), 0, { type: 'roll' });
    rolled = act(rolled, 0, { type: 'discard', resources: { wood: 5 } });
    const emptyHex = rolled.board.hexes.find(
      (hex) =>
        hex.id !== rolled.robberHex &&
        !hex.vertices.some((vertex) => rolled.buildings[vertex] !== undefined),
    );
    const moved = act(rolled, 0, { type: 'moveRobber', hex: emptyHex?.id as string });
    expect(moved.phase).toBe('action');
    expect(moved.log.some((entry) => entry.kind === 'steal')).toBe(false);
  });

  it('does not queue a discard at exactly the resource limit', () => {
    let state = setupGame(2, 52);
    state = setResources(state, 0, { wood: 9 });
    const rolled = act(setNextRoll(state, 7), 0, { type: 'roll' });
    expect(rolled.phase).toBe('robber');
    expect(rolled.discardQueue).toEqual([]);
  });
});

describe('builds', () => {
  it('builds a road, pays exactly, and refuses a disconnected one', () => {
    let state = actionPhase(setupGame(4, 60), 5);
    state = setResources(state, 0, { wood: 5, brick: 5, sheep: 2, wheat: 2, ore: 3 });
    const legal = legalMoves(state, 0).build.roads[0] as EdgeId;
    const built = act(state, 0, { type: 'buildRoad', edge: legal });
    expect(built.roads[legal]).toBe(0);
    expect(built.players[0]?.resources.wood).toBe(4);
    expect(built.players[0]?.resources.brick).toBe(4);

    const stranded = built.board.edges.find(
      (edge) => built.roads[edge.id] === undefined && !legalMoves(built, 0).build.roads.includes(edge.id),
    );
    expect(stranded).toBeDefined();
    const problem = reject(built, 0, { type: 'buildRoad', edge: stranded?.id as EdgeId });
    expect(problem.code).toBe('NOT_CONNECTED');

    const occupied = reject(built, 0, { type: 'buildRoad', edge: legal });
    expect(occupied.code).toBe('OCCUPIED');
  });

  it('builds a settlement with the distance rule, then upgrades it to a city', () => {
    let state = actionPhase(setupGame(4, 61), 6);
    state = setResources(state, 0, { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 });
    const extended = extendToSettlement(state, 0);
    const vertex = extended.vertex;
    const funded = setResources(extended.state, 0, { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 });
    const placed = act(funded, 0, { type: 'buildSettlement', vertex });
    expect(placed.buildings[vertex]).toEqual({ owner: 0, type: 'settlement' });
    expect(placed.players[0]?.resources.wood).toBe(8);
    expect(placed.players[0]?.resources.brick).toBe(8);

    const upgraded = act(placed, 0, { type: 'buildCity', vertex });
    expect(upgraded.buildings[vertex]).toEqual({ owner: 0, type: 'city' });
    expect(upgraded.players[0]?.resources.wheat).toBe(6);
    expect(upgraded.players[0]?.resources.ore).toBe(6);

    const notMine = upgraded.board.vertices.find((candidate) => {
      const building = upgraded.buildings[candidate.id];
      return building !== undefined && building.owner !== 0;
    });
    expect(reject(upgraded, 0, { type: 'buildCity', vertex: notMine?.id as string }).code).toBe(
      'INVALID_PLACEMENT',
    );
  });

  it('rejects a settlement next to an existing building and when broke', () => {
    let state = actionPhase(setupGame(4, 62), 4);
    state = setResources(state, 0, { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 });
    const extended = extendToSettlement(state, 0);
    const vertex = extended.vertex;
    const funded = setResources(extended.state, 0, { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 });
    const placed = act(funded, 0, { type: 'buildSettlement', vertex });

    const incident = placed.board.vertices.find((item) => item.id === vertex)?.edges[0] as string;
    const edge = placed.board.edges.find((item) => item.id === incident);
    const neighbourVertex = edge?.a === vertex ? edge?.b : edge?.a;
    expect(neighbourVertex).toBeDefined();
    expect(reject(placed, 0, { type: 'buildSettlement', vertex: neighbourVertex as string }).code).toBe(
      'TOO_CLOSE',
    );

    const broke = setResources(placed, 0, {});
    expect(reject(broke, 0, { type: 'buildRoad', edge: legalMoves(broke, 0).build.roads[0] as EdgeId }).code).toBe(
      'CANNOT_AFFORD',
    );
    const brokeAgain = extendToSettlement(broke, 0);
    expect(
      reject(brokeAgain.state, 0, {
        type: 'buildSettlement',
        vertex: brokeAgain.vertex,
      }).code,
    ).toBe('CANNOT_AFFORD');
    expect(reject(broke, 0, { type: 'buildCity', vertex }).code).toBe('CANNOT_AFFORD');
  });
});

describe('bank and port trades', () => {
  it('trades 4:1 at the bank, 2:1 on a matching port and 3:1 on a generic port', () => {
    let state = actionPhase(setupGame(4, 70), 8);
    // Clear the draft so setup settlements on ports cannot skew the rates.
    state = patch(state, (draft) => {
      draft.buildings = {};
      draft.roads = {};
    });
    state = setResources(state, 0, { wood: 8, brick: 8, sheep: 8, wheat: 8, ore: 8 });

    expect(bestBankRate(state, 0, 'wood')).toBe(4);
    const four = act(state, 0, { type: 'bankTrade', give: 'wood', receive: 'ore', count: 4 });
    expect(four.players[0]?.resources.wood).toBe(4);
    expect(four.players[0]?.resources.ore).toBe(9);

    expect(
      reject(four, 0, { type: 'bankTrade', give: 'wood', receive: 'ore', count: 3 }).code,
    ).toBe('INVALID_TRADE');
    expect(
      reject(four, 0, { type: 'bankTrade', give: 'wood', receive: 'wood', count: 4 }).code,
    ).toBe('INVALID_TRADE');
    const short = setResources(four, 0, { wood: 2, ore: 1 });
    expect(
      reject(short, 0, { type: 'bankTrade', give: 'wood', receive: 'ore', count: 4 }).code,
    ).toBe('CANNOT_AFFORD');

    const woodPort = state.board.ports.find((port) => port.resource === 'wood');
    const withPort = patch(state, (draft) => {
      draft.buildings[woodPort?.vertices[0] as string] = { owner: 0, type: 'settlement' };
    });
    expect(bestBankRate(withPort, 0, 'wood')).toBe(2);
    expect(bestBankRate(withPort, 0, 'ore')).toBe(4);
    const two = act(withPort, 0, { type: 'bankTrade', give: 'wood', receive: 'ore', count: 2 });
    expect(two.players[0]?.resources.wood).toBe(6);

    const genericPort = state.board.ports.find((port) => port.resource === 'generic');
    const withGeneric = patch(state, (draft) => {
      draft.buildings[genericPort?.vertices[0] as string] = { owner: 0, type: 'settlement' };
    });
    expect(bestBankRate(withGeneric, 0, 'wood')).toBe(3);
    expect(bestBankRate(withGeneric, 0, 'sheep')).toBe(3);
    expect(bestBankRate(withGeneric, 1, 'wood')).toBe(4);
  });
});

describe('end turn', () => {
  it('discards hand and played cards, resets flags, passes the turn and draws up', () => {
    let state = actionPhase(setupGame(4, 80), 8);
    const hand = state.players[0]?.hand.slice() ?? [];
    expect(hand).toHaveLength(5);
    state = act(state, 0, { type: 'playCard', iid: hand[0]?.iid as number });
    expect(state.players[0]?.played).toHaveLength(1);
    expect(state.players[0]?.hand).toHaveLength(4);

    const ended = act(state, 0, { type: 'endTurn' });
    expect(ended.currentSeat).toBe(1);
    expect(ended.turn).toBe(state.turn + 1);
    expect(ended.phase).toBe('roll');
    expect(ended.players[0]?.hand).toHaveLength(0);
    expect(ended.players[0]?.played).toHaveLength(0);
    expect(ended.players[0]?.discard).toHaveLength(5);
    expect(ended.players[1]?.hand).toHaveLength(5);
    expect(ended.turnFlags).toEqual({ rolled: false, purchased: false });
    expect(ended.dice).toBeNull();
    expect(ended.tradeOffer).toBeNull();
    expect(ended.log[ended.log.length - 1]?.kind).toBe('turn');
  });

  it('cannot end the turn during setup or before rolling', () => {
    expect(reject(newGame(3, 5), 0, { type: 'endTurn' }).code).toBe('WRONG_PHASE');
    expect(reject(setupGame(3, 5), 0, { type: 'endTurn' }).code).toBe('WRONG_PHASE');
  });
});
