import type { Resource, Terrain } from './types.js';

/**
 * The designed standard island, as written in docs/GAME-DESIGN.md section 4.1.
 *
 * Rows are pointy-top axial hexes: r = -2..2, row sizes 3-4-5-4-3. This table
 * is what `fixed` terrain and `fixed` tokens use on a standard island. Other
 * map sizes are generated in src/shared/engine/map.ts. The engine applies one
 * of twelve rotations/mirrors to whichever layout it was given, builds the
 * vertex/edge graph, and places ports; the client only ever sees the finished
 * Board.
 */
export interface HexTemplate {
  id: string;
  q: number;
  r: number;
  terrain: Terrain;
  token: number | null;
}

export const HEX_TEMPLATE: readonly HexTemplate[] = [
  { id: 'A1', q: 0, r: -2, terrain: 'wood', token: 5 },
  { id: 'A2', q: 1, r: -2, terrain: 'wheat', token: 11 },
  { id: 'A3', q: 2, r: -2, terrain: 'sheep', token: 6 },

  { id: 'B1', q: -1, r: -1, terrain: 'brick', token: 6 },
  { id: 'B2', q: 0, r: -1, terrain: 'ore', token: 4 },
  { id: 'B3', q: 1, r: -1, terrain: 'wood', token: 9 },
  { id: 'B4', q: 2, r: -1, terrain: 'sheep', token: 10 },

  { id: 'C1', q: -2, r: 0, terrain: 'wheat', token: 11 },
  { id: 'C2', q: -1, r: 0, terrain: 'ore', token: 3 },
  { id: 'C3', q: 0, r: 0, terrain: 'desert', token: null },
  { id: 'C4', q: 1, r: 0, terrain: 'brick', token: 4 },
  { id: 'C5', q: 2, r: 0, terrain: 'wood', token: 3 },

  { id: 'D1', q: -2, r: 1, terrain: 'sheep', token: 2 },
  { id: 'D2', q: -1, r: 1, terrain: 'wheat', token: 12 },
  { id: 'D3', q: 0, r: 1, terrain: 'ore', token: 8 },
  { id: 'D4', q: 1, r: 1, terrain: 'wood', token: 5 },

  { id: 'E1', q: -2, r: 2, terrain: 'brick', token: 9 },
  { id: 'E2', q: -1, r: 2, terrain: 'wheat', token: 8 },
  { id: 'E3', q: 0, r: 2, terrain: 'sheep', token: 10 },
] as const;

/** Fixed port ring, clockwise from the top-left coastal edge. */
export const PORT_ORDER: readonly { resource: Resource | 'generic'; rate: 2 | 3 }[] = [
  { resource: 'ore', rate: 2 },
  { resource: 'generic', rate: 3 },
  { resource: 'wheat', rate: 2 },
  { resource: 'generic', rate: 3 },
  { resource: 'brick', rate: 2 },
  { resource: 'generic', rate: 3 },
  { resource: 'sheep', rate: 2 },
  { resource: 'generic', rate: 3 },
  { resource: 'wood', rate: 2 },
] as const;
