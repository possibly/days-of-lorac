/**
 * Map settings: how big the island is, and how its land and numbers are laid
 * out. Pure data and pure helpers, imported by the engine, the server, and the
 * client.
 *
 * Sizes are axial hexagons. Radius 0 is one hex, radius 1 is 7, radius 2 is the
 * 19-hex classic island, radius 3 is 37. Hex ids come from the finished board
 * (row letter + column number), so the same coordinate always gets the same id.
 */
import type {
  MapSettings,
  MapSize,
  Resource,
  Terrain,
  TerrainMode,
  TokenMode,
} from './types.js';
import { RESOURCES } from './types.js';

export interface MapSizeInfo {
  id: MapSize;
  label: string;
  note: string;
  radius: number;
  hexes: number;
  /**
   * Seats the island can carry. A seven-hex island has 24 corners, and four
   * seats drafting two settlements each can run the distance rule dry, so the
   * compact island is a duel board.
   */
  maxSeats: 2 | 4;
}

export const MAP_SIZES: readonly MapSizeInfo[] = [
  { id: 'compact', label: 'Compact', note: '7 hexes, a duel', radius: 1, hexes: 7, maxSeats: 2 },
  { id: 'standard', label: 'Standard', note: '19 hexes, the classic island', radius: 2, hexes: 19, maxSeats: 4 },
  { id: 'grand', label: 'Grand', note: '37 hexes, a long game', radius: 3, hexes: 37, maxSeats: 4 },
] as const;

export const TERRAIN_MODES: readonly { id: TerrainMode; label: string; note: string }[] = [
  { id: 'fixed', label: 'Fixed', note: 'the designed land, same every game' },
  { id: 'balanced', label: 'Balanced', note: 'random, no two neighbours alike' },
  { id: 'shuffled', label: 'Wild', note: 'fully random land' },
] as const;

export const TOKEN_MODES: readonly { id: TokenMode; label: string; note: string }[] = [
  { id: 'fixed', label: 'Fixed', note: 'the designed numbers' },
  { id: 'balanced', label: 'Balanced', note: 'no 6 beside an 8, no twins touching' },
  { id: 'shuffled', label: 'Wild', note: 'fully random numbers' },
] as const;

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  size: 'standard',
  terrain: 'fixed',
  tokens: 'fixed',
};

export function isMapSize(value: unknown): value is MapSize {
  return value === 'compact' || value === 'standard' || value === 'grand';
}

export function isTerrainMode(value: unknown): value is TerrainMode {
  return value === 'fixed' || value === 'balanced' || value === 'shuffled';
}

export function isTokenMode(value: unknown): value is TokenMode {
  return value === 'fixed' || value === 'balanced' || value === 'shuffled';
}

/**
 * Keep a host-supplied setting only when every field is known. Anything else
 * falls back to the matching default, so an old client or a hostile socket
 * cannot invent a size the engine has no shape for.
 */
export function normalizeMapSettings(raw: unknown, fallback: MapSettings = DEFAULT_MAP_SETTINGS): MapSettings {
  if (typeof raw !== 'object' || raw === null) return { ...fallback };
  const input = raw as Record<string, unknown>;
  return {
    size: isMapSize(input.size) ? input.size : fallback.size,
    terrain: isTerrainMode(input.terrain) ? input.terrain : fallback.terrain,
    tokens: isTokenMode(input.tokens) ? input.tokens : fallback.tokens,
  };
}

/** Every map setting is a known value and the object has no extra fields. */
export function isValidMapSettings(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const input = raw as Record<string, unknown>;
  return isMapSize(input.size) && isTerrainMode(input.terrain) && isTokenMode(input.tokens);
}

export function mapSizeInfo(size: MapSize): MapSizeInfo {
  return MAP_SIZES.find((entry) => entry.id === size) ?? (MAP_SIZES[1] as MapSizeInfo);
}

export function hexCountFor(size: MapSize): number {
  return mapSizeInfo(size).hexes;
}

/** Most seats this island can seat. */
export function maxSeatsFor(size: MapSize): 2 | 4 {
  return mapSizeInfo(size).maxSeats;
}

/** True when this island cannot seat a table of `players`. */
export function seatsFit(settings: MapSettings, players: number): boolean {
  return players <= maxSeatsFor(settings.size);
}

export interface AxialCoord {
  q: number;
  r: number;
}

/** The axial hexagon of `radius`, ordered by row (r) then column (q). */
export function hexCoordsFor(size: MapSize): AxialCoord[] {
  const radius = mapSizeInfo(size).radius;
  const out: AxialCoord[] = [];
  for (let r = -radius; r <= radius; r += 1) {
    const low = Math.max(-radius, -r - radius);
    const high = Math.min(radius, -r + radius);
    for (let q = low; q <= high; q += 1) out.push({ q, r });
  }
  return out;
}

/** Desert hexes: one, except on the grand map where two split the supply. */
export function desertCountFor(size: MapSize): number {
  return size === 'grand' ? 2 : 1;
}

const ABUNDANCE_ORDER: readonly Resource[] = ['wood', 'wheat', 'sheep', 'brick', 'ore'];

/**
 * Land for one size. The remainder always goes to wood, then wheat, then sheep,
 * which is why the 19-hex bag reproduces the design doc exactly:
 * 4 wood, 4 wheat, 4 sheep, 3 brick, 3 ore, 1 desert.
 */
export function terrainBagFor(size: MapSize): Terrain[] {
  const hexes = hexCountFor(size);
  const deserts = desertCountFor(size);
  const resources = hexes - deserts;
  const base = Math.floor(resources / RESOURCES.length);
  const extra = resources % RESOURCES.length;
  const bag: Terrain[] = [];
  for (let index = 0; index < ABUNDANCE_ORDER.length; index += 1) {
    const count = base + (index < extra ? 1 : 0);
    for (let copy = 0; copy < count; copy += 1) bag.push(ABUNDANCE_ORDER[index] as Resource);
  }
  for (let copy = 0; copy < deserts; copy += 1) bag.push('desert');
  return bag;
}

const CLASSIC_TOKENS: readonly number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/**
 * Number tokens for one size. The 7 is never on the board. The compact map uses
 * the middle of the curve instead of the two weakest seats; the grand map
 * doubles the classic bag and drops one 2, so every produced hex has a number.
 */
export function tokenBagFor(size: MapSize): number[] {
  const produced = hexCountFor(size) - desertCountFor(size);
  if (size === 'compact') return [4, 5, 6, 8, 9, 10].slice(0, produced);
  const doubled = [...CLASSIC_TOKENS, ...CLASSIC_TOKENS];
  if (doubled.length === produced) return doubled;
  return doubled.slice(0, produced);
}

/** "Standard island, balanced land, fixed numbers." For the lobby sub-line. */
export function describeMap(settings: MapSettings): string {
  const size = mapSizeInfo(settings.size);
  const terrain = TERRAIN_MODES.find((entry) => entry.id === settings.terrain);
  const tokens = TOKEN_MODES.find((entry) => entry.id === settings.tokens);
  const land = (terrain?.label ?? settings.terrain).toLowerCase();
  const numbers = (tokens?.label ?? settings.tokens).toLowerCase();
  return `${size.label} island, ${land} land, ${numbers} numbers.`;
}
