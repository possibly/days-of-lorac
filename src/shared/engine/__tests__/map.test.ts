import { describe, expect, it } from 'vitest';
import { buildBoard, portCountFor, portSpecsFor } from '../board.js';
import { generateMap } from '../map.js';
import type { MapHex } from '../map.js';
import { HEX_TEMPLATE, PORT_ORDER } from '../../board-template.js';
import {
  DEFAULT_MAP_SETTINGS,
  MAP_SIZES,
  desertCountFor,
  hexCoordsFor,
  hexCountFor,
  terrainBagFor,
  tokenBagFor,
} from '../../map-settings.js';
import { applyAction, createGame, legalMoves } from '../index.js';
import type { GameAction, GameState, MapSettings, MapSize } from '../../types.js';

const SIZES: MapSize[] = ['compact', 'standard', 'grand'];

function key(q: number, r: number): string {
  return `${q},${r}`;
}

function neighborCounts(hexes: readonly MapHex[]): Map<string, MapHex[]> {
  const at = new Map<string, MapHex>();
  for (const hex of hexes) at.set(key(hex.q, hex.r), hex);
  const out = new Map<string, MapHex[]>();
  for (const hex of hexes) {
    const neighbors: MapHex[] = [];
    for (const [dq, dr] of [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ] as const) {
      const neighbor = at.get(key(hex.q + dq, hex.r + dr));
      if (neighbor) neighbors.push(neighbor);
    }
    out.set(key(hex.q, hex.r), neighbors);
  }
  return out;
}

function settings(size: MapSize, terrain: MapSettings['terrain'], tokens: MapSettings['tokens']): MapSettings {
  return { size, terrain, tokens };
}

describe('map sizes and bags', () => {
  it('gives every size the hex count its label promises', () => {
    expect(SIZES.map(hexCountFor)).toEqual([7, 19, 37]);
    for (const size of SIZES) expect(hexCoordsFor(size)).toHaveLength(hexCountFor(size));
    expect(new Set(hexCoordsFor('standard').map((coord) => key(coord.q, coord.r))).size).toBe(19);
  });

  it('keeps the design-doc terrain mix on the standard island', () => {
    const terrain: Record<string, number> = {};
    for (const hex of terrainBagFor('standard')) terrain[hex] = (terrain[hex] ?? 0) + 1;
    expect(terrain).toEqual({ wood: 4, wheat: 4, sheep: 4, brick: 3, ore: 3, desert: 1 });
  });

  it('gives every size one token per produced hex and never a seven', () => {
    for (const size of SIZES) {
      const produced = hexCountFor(size) - desertCountFor(size);
      const tokens = tokenBagFor(size);
      expect(tokens).toHaveLength(produced);
      expect(tokens).not.toContain(7);
      expect(tokens.every((token) => token >= 2 && token <= 12)).toBe(true);
    }
    expect(tokenBagFor('standard').slice().sort((a, b) => a - b)).toEqual([
      2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
    ]);
  });

  it('scales the port ring with the coast and keeps the classic nine', () => {
    expect(portCountFor(18)).toBe(5);
    expect(portCountFor(30)).toBe(9);
    expect(portCountFor(42)).toBe(12);
    expect(portSpecsFor(9)).toEqual(PORT_ORDER.map((spec) => ({ ...spec })));
    for (const count of [4, 5, 9, 12]) {
      const specs = portSpecsFor(count);
      expect(specs).toHaveLength(count);
      expect(specs.some((spec) => spec.resource === 'generic')).toBe(true);
      expect(specs.filter((spec) => spec.resource === 'generic').every((spec) => spec.rate === 3)).toBe(true);
      expect(specs.filter((spec) => spec.resource !== 'generic').every((spec) => spec.rate === 2)).toBe(true);
    }
  });
});

describe('map generation', () => {
  it('uses the designed table for a fixed standard island', () => {
    const layout = generateMap(DEFAULT_MAP_SETTINGS, 99).layout;
    const byCoord = new Map(layout.hexes.map((hex) => [key(hex.q, hex.r), hex]));
    for (const hex of HEX_TEMPLATE) {
      const placed = byCoord.get(key(hex.q, hex.r));
      expect(placed?.terrain).toBe(hex.terrain);
      expect(placed?.token).toBe(hex.token);
    }
  });

  it('does not draw from the game RNG when both placements are fixed', () => {
    const before = generateMap(settings('standard', 'fixed', 'fixed'), 12345);
    const after = generateMap(settings('standard', 'fixed', 'fixed'), 12345);
    expect(after.state).toBe(12345);
    expect(after.layout).toEqual(before.layout);

    const compact = generateMap(settings('compact', 'fixed', 'fixed'), 1).layout;
    const compactAgain = generateMap(settings('compact', 'fixed', 'fixed'), 2).layout;
    expect(compactAgain).toEqual(compact);
  });

  it('is deterministic per seed and settings, and varies when shuffled', () => {
    const one = generateMap(settings('standard', 'shuffled', 'shuffled'), 7);
    const two = generateMap(settings('standard', 'shuffled', 'shuffled'), 7);
    expect(two.layout).toEqual(one.layout);

    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const layout = generateMap(settings('standard', 'shuffled', 'shuffled'), seed).layout;
      seen.add(layout.hexes.map((hex) => `${hex.terrain}:${hex.token}`).join(','));
    }
    expect(seen.size).toBeGreaterThan(6);
  });

  it('places the promised deserts on every size', () => {
    for (const size of SIZES) {
      for (const terrain of ['fixed', 'balanced', 'shuffled'] as const) {
        const layout = generateMap(settings(size, terrain, 'balanced'), 3).layout;
        expect(layout.hexes.filter((hex) => hex.terrain === 'desert')).toHaveLength(desertCountFor(size));
        expect(layout.hexes.filter((hex) => hex.token !== null)).toHaveLength(
          hexCountFor(size) - desertCountFor(size),
        );
      }
    }
  });

  it('keeps balanced land from touching itself, at every size', () => {
    for (const size of SIZES) {
      for (let seed = 1; seed <= 8; seed += 1) {
        const layout = generateMap(settings(size, 'balanced', 'shuffled'), seed).layout;
        const neighbors = neighborCounts(layout.hexes);
        for (const hex of layout.hexes) {
          for (const neighbor of neighbors.get(key(hex.q, hex.r)) ?? []) {
            expect(
              hex.terrain === neighbor.terrain,
              `${hex.terrain} touches ${neighbor.terrain} at seed ${seed}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('keeps balanced numbers apart, at every size', () => {
    for (const size of SIZES) {
      for (let seed = 1; seed <= 8; seed += 1) {
        const layout = generateMap(settings(size, 'fixed', 'balanced'), seed).layout;
        const neighbors = neighborCounts(layout.hexes);
        for (const hex of layout.hexes) {
          if (hex.token === null) continue;
          for (const neighbor of neighbors.get(key(hex.q, hex.r)) ?? []) {
            if (neighbor.token === null) continue;
            const red = (token: number): boolean => token === 6 || token === 8;
            expect(neighbor.token === hex.token, `duplicate ${hex.token} at seed ${seed}`).toBe(false);
            expect(
              red(hex.token) && red(neighbor.token),
              `${hex.token} beside ${neighbor.token} at seed ${seed}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('refuses to seat a table the island cannot hold', () => {
    expect(() =>
      createGame({ playerCount: 4, seed: 1, map: settings('compact', 'fixed', 'fixed') }),
    ).toThrow(/seats at most 2/);
  });

  it('builds a complete graph for every size', () => {
    for (const size of SIZES) {
      const layout = generateMap(settings(size, 'balanced', 'balanced'), 5).layout;
      const board = buildBoard(layout, { rotation: 0, mirror: 0 });
      expect(board.hexes).toHaveLength(hexCountFor(size));
      for (const hex of board.hexes) {
        expect(hex.vertices).toHaveLength(6);
        expect(hex.edges).toHaveLength(6);
        expect(new Set(hex.vertices).size).toBe(6);
        expect(new Set(hex.edges).size).toBe(6);
      }
      for (const edge of board.edges) {
        expect(edge.hexes.length).toBeGreaterThanOrEqual(1);
        expect(edge.hexes.length).toBeLessThanOrEqual(2);
        expect(edge.coastal).toBe(edge.hexes.length === 1);
      }
      for (const vertex of board.vertices) {
        expect(vertex.hexes.length).toBeGreaterThanOrEqual(1);
        expect(vertex.hexes.length).toBeLessThanOrEqual(3);
      }
      const portEdges = new Set(board.ports.map((port) => port.edge));
      expect(portEdges.size).toBe(board.ports.length);
      const used = new Set<string>();
      for (const port of board.ports) {
        for (const vertex of port.vertices) {
          expect(used.has(vertex)).toBe(false);
          used.add(vertex);
        }
        const edge = board.edges.find((item) => item.id === port.edge);
        expect(edge?.coastal).toBe(true);
      }
    }
  });
});

describe('createGame with a map setting', () => {
  it('publishes the setting and builds the requested island', () => {
    for (const size of SIZES) {
      const state = createGame({
        playerCount: 2,
        seed: 42,
        map: settings(size, 'balanced', 'balanced'),
      });
      expect(state.config.map).toEqual(settings(size, 'balanced', 'balanced'));
      expect(state.board.hexes).toHaveLength(hexCountFor(size));
      const robber = state.board.hexes.find((hex) => hex.id === state.robberHex);
      expect(robber?.terrain).toBe('desert');
      expect(legalMoves(state, state.currentSeat).setupSettlements.length).toBeGreaterThan(0);
    }
  });

  it('runs a full setup on the small and large islands', () => {
    for (const [size, players] of [
      ['compact', 2],
      ['grand', 4],
    ] as Array<[MapSize, number]>) {
      let state = createGame({ playerCount: players, seed: 8, map: settings(size, 'balanced', 'balanced') });
      let guard = 0;
      while (state.phase === 'setup') {
        const legal = legalMoves(state, state.currentSeat);
        if (legal.setupSettlements.length > 0) {
          state = accepted(state, { type: 'setupSettlement', vertex: legal.setupSettlements[0] as string });
        } else {
          state = accepted(state, { type: 'setupRoad', edge: legal.setupRoads[0] as string });
        }
        guard += 1;
        if (guard > 40) throw new Error('setup did not finish');
      }
      expect(state.phase).toBe('roll');
      expect(state.players.every((player) => player.hand.length === 5)).toBe(true);
    }
  });
});

function accepted(state: ReturnType<typeof createGame>, action: GameAction): GameState {
  const result = applyAction(state, state.currentSeat, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.code}`);
  return result.state;
}
