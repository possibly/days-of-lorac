/**
 * Map generation: pick terrain and number tokens for one island size.
 *
 * The classic 19-hex table from the design doc is a literal layout, so `fixed`
 * on a standard island reproduces it exactly. Every other combination is
 * generated with the seeded RNG:
 *
 *   fixed     one deterministic map per size (a constant seed, no game draws),
 *   balanced  greedy placement so no two touching hexes share a terrain, no
 *             two touching hexes share a number, and no 6 touches an 8,
 *   shuffled  one plain shuffle.
 *
 * Balanced restarts when an order paints itself into a corner, so the cost is
 * bounded and the result stays a pure function of the seed.
 */
import { HEX_TEMPLATE } from '../board-template.js';
import {
  desertCountFor,
  hexCoordsFor,
  hexCountFor,
  terrainBagFor,
  tokenBagFor,
} from '../map-settings.js';
import type { AxialCoord } from '../map-settings.js';
import { randomInt, shuffleWithRng } from './rng.js';
import type { MapSettings, MapSize, Terrain } from '../types.js';

export interface MapHex extends AxialCoord {
  terrain: Terrain;
  token: number | null;
}

export interface MapLayout {
  size: MapSize;
  hexes: MapHex[];
}

const DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Seed for `fixed` maps on sizes the design doc has no table for. */
const FIXED_MAP_SEED = 0x1f2e3d4c;
/** Restarts for the greedy placement. Each attempt is cheap; 96 is plenty. */
const GREEDY_ATTEMPTS = 96;

interface Shape {
  coords: AxialCoord[];
  neighbors: number[][];
}

const shapeCache = new Map<MapSize, Shape>();

function coordKey(q: number, r: number): string {
  return `${q},${r}`;
}

function shapeFor(size: MapSize): Shape {
  const cached = shapeCache.get(size);
  if (cached) return cached;
  const coords = hexCoordsFor(size);
  const index = new Map<string, number>();
  coords.forEach((coord, position) => index.set(coordKey(coord.q, coord.r), position));
  const neighbors = coords.map((coord) => {
    const found: number[] = [];
    for (const [dq, dr] of DIRECTIONS) {
      const neighbor = index.get(coordKey(coord.q + dq, coord.r + dr));
      if (neighbor !== undefined) found.push(neighbor);
    }
    return found;
  });
  const shape: Shape = { coords, neighbors };
  shapeCache.set(size, shape);
  return shape;
}

function isRed(token: number): boolean {
  return token === 6 || token === 8;
}

interface GreedyOptions<T> {
  shape: Shape;
  bag: readonly T[];
  rng: number;
  /** True when the two items may not sit on adjacent hexes. */
  conflict: (left: T, right: T) => boolean;
  /** Hexes that take no item at all (the desert takes no number token). */
  skip?: (index: number) => boolean;
}

/**
 * Place a bag onto the shape so that no two conflicting items touch.
 *
 * Hexes are filled in a seeded order. At each hex the item with the most copies
 * left wins among the legal ones, so scarce items do not get stranded; ties are
 * broken by the same RNG. If an order paints itself into a corner the whole
 * attempt restarts. Every supported size has a clean layout, and the fallback
 * is a plain shuffle so a valid setting always returns a board.
 */
function greedyPlace<T>(options: GreedyOptions<T>): { state: number; items: (T | null)[] } {
  const { shape, bag } = options;
  let state = options.rng;

  for (let attempt = 0; attempt < GREEDY_ATTEMPTS; attempt += 1) {
    const orderStep = shuffleWithRng(
      shape.coords.map((_, index) => index),
      state,
    );
    state = orderStep.state;
    const remaining = new Map<T, number>();
    for (const item of bag) remaining.set(item, (remaining.get(item) ?? 0) + 1);
    const placed: (T | null)[] = shape.coords.map(() => null);
    let clean = true;

    for (const hexIndex of orderStep.items) {
      if (options.skip?.(hexIndex)) continue;
      const forbidden = new Set<T>();
      for (const neighbor of shape.neighbors[hexIndex] as number[]) {
        const item = placed[neighbor];
        if (item === null || item === undefined) continue;
        for (const candidate of remaining.keys()) {
          if (options.conflict(candidate, item)) forbidden.add(candidate);
        }
      }
      const legal: T[] = [];
      let bestCount = 0;
      for (const [item, count] of remaining) {
        if (count <= 0 || forbidden.has(item)) continue;
        if (count > bestCount) {
          bestCount = count;
          legal.length = 0;
        }
        if (count === bestCount) legal.push(item);
      }
      if (legal.length === 0) {
        clean = false;
        break;
      }
      const pick = randomInt(state, legal.length);
      state = pick.state;
      const chosen = legal[pick.value] as T;
      placed[hexIndex] = chosen;
      remaining.set(chosen, (remaining.get(chosen) ?? 1) - 1);
    }

    if (clean) return { state, items: placed };
  }

  // Last resort: one plain shuffle, keeping the skip hexes empty. The merge
  // keeps the array aligned with the shape even when the bag is shorter.
  const fallback = shuffleWithRng(bag, state);
  const plain: (T | null)[] = shape.coords.map(() => null);
  let cursor = 0;
  shape.coords.forEach((_, index) => {
    if (options.skip?.(index)) return;
    plain[index] = fallback.items[cursor] ?? null;
    cursor += 1;
  });
  return { state: fallback.state, items: plain };
}

/** The designed table, keyed by coordinate, or null for generated sizes. */
function classicLayout(size: MapSize): Map<string, MapHex> | null {
  if (size !== 'standard') return null;
  const byCoord = new Map<string, MapHex>();
  for (const hex of HEX_TEMPLATE) {
    byCoord.set(coordKey(hex.q, hex.r), {
      q: hex.q,
      r: hex.r,
      terrain: hex.terrain,
      token: hex.token,
    });
  }
  return byCoord;
}

interface TerrainResult {
  state: number;
  terrains: Terrain[];
}

function placeTerrain(settings: MapSettings, shape: Shape, rng: number): TerrainResult {
  const classic = settings.terrain === 'fixed' ? classicLayout(settings.size) : null;
  if (classic) {
    return {
      state: rng,
      terrains: shape.coords.map(
        (coord) => (classic.get(coordKey(coord.q, coord.r)) as MapHex).terrain,
      ),
    };
  }

  const bag = terrainBagFor(settings.size);
  if (settings.terrain === 'shuffled') {
    const step = shuffleWithRng(bag, rng);
    return { state: step.state, terrains: step.items };
  }

  // Balanced land: no two touching hexes share a terrain.
  const fixed = settings.terrain === 'fixed';
  const placed = greedyPlace({
    shape,
    bag,
    rng: fixed ? FIXED_MAP_SEED : rng,
    conflict: (left, right) => left === right,
  });
  return {
    state: fixed ? rng : placed.state,
    terrains: placed.items as Terrain[],
  };
}

interface TokenResult {
  state: number;
  tokens: (number | null)[];
}

function placeTokens(settings: MapSettings, shape: Shape, terrains: readonly Terrain[], rng: number): TokenResult {
  const classic = settings.tokens === 'fixed' ? classicLayout(settings.size) : null;
  if (classic) {
    return {
      state: rng,
      tokens: shape.coords.map(
        (coord) => (classic.get(coordKey(coord.q, coord.r)) as MapHex).token,
      ),
    };
  }

  const skip = (index: number): boolean => terrains[index] === 'desert';
  const bag = tokenBagFor(settings.size);

  if (settings.tokens === 'shuffled') {
    const step = shuffleWithRng(bag, rng);
    let cursor = 0;
    const tokens = shape.coords.map((_, index) => {
      if (skip(index)) return null;
      const token = step.items[cursor];
      cursor += 1;
      return token ?? null;
    });
    return { state: step.state, tokens };
  }

  // Balanced numbers: no twins touching, and no 6 beside an 8.
  const fixed = settings.tokens === 'fixed';
  const placed = greedyPlace({
    shape,
    bag,
    rng: fixed ? FIXED_MAP_SEED : rng,
    conflict: (left, right) => left === right || (isRed(left) && isRed(right)),
    skip,
  });
  return {
    state: fixed ? rng : placed.state,
    tokens: placed.items,
  };
}

/**
 * Build the terrain and token layout. Returns the advanced RNG state so
 * `createGame` can keep its documented draw order.
 */
export function generateMap(settings: MapSettings, rng: number): { state: number; layout: MapLayout } {
  const shape = shapeFor(settings.size);
  if (shape.coords.length !== hexCountFor(settings.size)) {
    throw new Error(`map: ${settings.size} lost its hex count`);
  }
  const terrain = placeTerrain(settings, shape, rng);
  const tokens = placeTokens(settings, shape, terrain.terrains, terrain.state);
  const hexes: MapHex[] = shape.coords.map((coord, index) => ({
    q: coord.q,
    r: coord.r,
    terrain: terrain.terrains[index] as Terrain,
    token: tokens.tokens[index] ?? null,
  }));
  const deserts = hexes.filter((hex) => hex.terrain === 'desert').length;
  if (deserts !== desertCountFor(settings.size)) {
    throw new Error(`map: ${settings.size} placed ${deserts} deserts`);
  }
  return { state: tokens.state, layout: { size: settings.size, hexes } };
}
