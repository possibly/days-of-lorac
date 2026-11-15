import type { MapSize, PartialResources, Resource } from './types.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const HAND_SIZE = 5;
export const RESOURCE_LIMIT = 9;
export const AWARD_BONUS = 2;
export const LONGEST_ROAD_MIN = 5;
export const LARGEST_EXPEDITION_MIN = 3;

/** Victory target by player count, from docs/GAME-DESIGN.md section 11. */
export const VP_TARGETS: Record<2 | 3 | 4, number> = {
  2: 18,
  3: 16,
  4: 14,
};

/**
 * Small islands produce less board VP, so the race is shorter there; a grand
 * island gives every seat more corners to build on, so the race is longer.
 * Without this the compact island cannot reach the standard target no matter
 * how long the table plays.
 */
export const VP_TARGET_SHIFT: Record<MapSize, number> = {
  compact: -4,
  standard: 0,
  grand: 4,
};

export function targetVpFor(playerCount: number, size: MapSize = 'standard'): number {
  const base = playerCount <= 2 ? VP_TARGETS[2] : playerCount === 3 ? VP_TARGETS[3] : VP_TARGETS[4];
  return base + (VP_TARGET_SHIFT[size] ?? 0);
}

export const BUILD_COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
} as const satisfies Record<string, PartialResources>;

export type BuildType = keyof typeof BUILD_COSTS;

export const BUILD_VP = {
  road: 0,
  settlement: 1,
  city: 2,
} as const;

/** Best bank rate when the player has no port. */
export const BASE_BANK_RATE = 4;
export const GENERIC_PORT_RATE = 3;

export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
};

export const RESOURCE_PLURALS: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
};

export const STARTING_DECK_IDS = [
  'start-wood',
  'start-wood',
  'start-brick',
  'start-brick',
  'start-sheep',
  'start-sheep',
  'start-wheat',
  'start-wheat',
  'start-ore',
  'start-ore',
] as const;

export function emptyResources(): Record<Resource, number> {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

export function countResources(resources: PartialResources): number {
  let total = 0;
  for (const value of Object.values(resources)) total += value ?? 0;
  return total;
}
