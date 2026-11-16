/**
 * Card settings: which market this game deals, and how it prices the piles.
 *
 * Pure data and pure helpers, imported by the engine, the server, and the
 * client. The market is resolved once in `createGame` from the game seed, so a
 * seed and a set of settings rebuild the same pile list at the same prices.
 *
 * Standard is the game as designed: the ten printed piles and two charters at
 * their printed costs. Expanded stocks the whole card file. Varied deals a
 * random subset from that file, with one pile per resource guaranteed so the
 * land you own can always buy something. Shuffled prices swap costs between
 * cards of the same total, so a strong effect can land on a resource you do not
 * produce, without changing how much the card costs in total.
 */
import type {
  CardCostMode,
  CardDef,
  CardPoolMode,
  CardSettings,
  PartialResources,
  Resource,
} from './types.js';
import { RESOURCES } from './types.js';
import { BASE_CHARTER_CARDS, BASE_MARKET_CARDS, CHARTER_CARDS, MARKET_CARDS } from './cards.js';
import { shuffleWithRng } from './engine/rng.js';

export interface CardModeInfo<T extends string> {
  id: T;
  label: string;
  note: string;
}

export const CARD_POOL_MODES: readonly CardModeInfo<CardPoolMode>[] = [
  { id: 'standard', label: 'Standard', note: 'the printed pile list, same every game' },
  { id: 'expanded', label: 'Expanded', note: 'every pile in the file, expansion included' },
  { id: 'varied', label: 'Varied', note: 'a random draw from the full pile list' },
] as const;

export const CARD_COST_MODES: readonly CardModeInfo<CardCostMode>[] = [
  { id: 'printed', label: 'Printed', note: 'the designed prices' },
  { id: 'shuffled', label: 'Shuffled', note: 'prices traded within their cost tier' },
] as const;

export const DEFAULT_CARD_SETTINGS: CardSettings = {
  pool: 'standard',
  costs: 'printed',
};

/** Piles dealt in a varied game. Standard stocks ten, expanded eighteen. */
export const VARIED_PILE_SLOTS = 12;
/** A varied game always deals one cheap charter and one premium charter. */
export const VARIED_CHARTER_SLOTS = 2;

export function isCardPoolMode(value: unknown): value is CardPoolMode {
  return value === 'standard' || value === 'expanded' || value === 'varied';
}

export function isCardCostMode(value: unknown): value is CardCostMode {
  return value === 'printed' || value === 'shuffled';
}

/** Keep a host-supplied setting only when every field is known. */
export function normalizeCardSettings(
  raw: unknown,
  fallback: CardSettings = DEFAULT_CARD_SETTINGS,
): CardSettings {
  if (typeof raw !== 'object' || raw === null) return { ...fallback };
  const input = raw as Record<string, unknown>;
  return {
    pool: isCardPoolMode(input.pool) ? input.pool : fallback.pool,
    costs: isCardCostMode(input.costs) ? input.costs : fallback.costs,
  };
}

/** Every card setting is a known value and the object has no extra fields. */
export function isValidCardSettings(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const input = raw as Record<string, unknown>;
  return isCardPoolMode(input.pool) && isCardCostMode(input.costs);
}

export function describeCards(settings: CardSettings): string {
  const pool = CARD_POOL_MODES.find((entry) => entry.id === settings.pool);
  const costs = CARD_COST_MODES.find((entry) => entry.id === settings.costs);
  return `${pool?.label ?? settings.pool} market, ${(costs?.label ?? settings.costs).toLowerCase()} prices.`;
}

export interface MarketResolution {
  /** RNG state after the pile draw and the price shuffle. */
  state: number;
  /** defId -> copies on the table. Charters are in here too. */
  market: Record<string, number>;
  /** defId -> this game's price for every card in the market. */
  costs: Record<string, PartialResources>;
}

interface PickedCards {
  state: number;
  cards: CardDef[];
}

function costTotal(cost: PartialResources | null): number {
  let total = 0;
  for (const resource of RESOURCES) total += cost?.[resource] ?? 0;
  return total;
}

/** The single resource a pile's price is paid in, or null for a mixed cost. */
function pileResource(def: CardDef): Resource | null {
  let found: Resource | null = null;
  for (const resource of RESOURCES) {
    if ((def.cost?.[resource] ?? 0) <= 0) continue;
    if (found !== null) return null;
    found = resource;
  }
  return found;
}

function pickPiles(mode: CardPoolMode, rng: number): PickedCards {
  if (mode === 'standard') return { state: rng, cards: BASE_MARKET_CARDS };
  if (mode === 'expanded') return { state: rng, cards: MARKET_CARDS };

  const shuffled = shuffleWithRng(MARKET_CARDS, rng);
  const chosen = shuffled.items.slice(0, VARIED_PILE_SLOTS);
  const counts: Partial<Record<Resource, number>> = {};
  for (const def of chosen) {
    const resource = pileResource(def);
    if (resource) counts[resource] = (counts[resource] ?? 0) + 1;
  }

  // A market with no pile you can pay for is a dead market, so every resource
  // with no pile in the draw takes over a slot from a resource that has two.
  for (const resource of RESOURCES) {
    if ((counts[resource] ?? 0) > 0) continue;
    const replacement = shuffled.items.find(
      (def) => pileResource(def) === resource && !chosen.includes(def),
    );
    if (!replacement) continue;
    for (let index = chosen.length - 1; index >= 0; index -= 1) {
      const held = chosen[index] as CardDef;
      const heldResource = pileResource(held);
      if (!heldResource || (counts[heldResource] ?? 0) < 2) continue;
      counts[heldResource] = (counts[heldResource] ?? 0) - 1;
      counts[resource] = 1;
      chosen[index] = replacement;
      break;
    }
  }

  // Printed order keeps the rail readable and stable between games.
  const order = new Map(MARKET_CARDS.map((def, index) => [def.id, index]));
  chosen.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { state: shuffled.state, cards: chosen };
}

function pickCharters(mode: CardPoolMode, rng: number): PickedCards {
  if (mode === 'standard') return { state: rng, cards: BASE_CHARTER_CARDS };
  if (mode === 'expanded') return { state: rng, cards: CHARTER_CARDS };

  // One cheap deed and one premium deed, so a varied game always has a sink
  // for a blocked player and a prize for the endgame.
  const cheap = CHARTER_CARDS.filter((def) => (def.vp ?? 0) <= 1);
  const premium = CHARTER_CARDS.filter((def) => (def.vp ?? 0) > 1);
  const first = shuffleWithRng(cheap, rng);
  const second = shuffleWithRng(premium, first.state);
  const cards = [first.items[0], second.items[0]]
    .filter((def): def is CardDef => Boolean(def))
    .slice(0, VARIED_CHARTER_SLOTS);
  const order = new Map(CHARTER_CARDS.map((def, index) => [def.id, index]));
  cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { state: second.state, cards };
}

function printedCosts(cards: readonly CardDef[]): Record<string, PartialResources> {
  const costs: Record<string, PartialResources> = {};
  for (const def of cards) {
    if (def.cost) costs[def.id] = { ...def.cost };
  }
  return costs;
}

function costTier(def: CardDef): string {
  return def.kind === 'charter' ? `charter:${def.vp ?? 0}` : `pile:${costTotal(def.cost)}`;
}

/**
 * Trade prices inside one tier. A tier is every pile of the same total cost, or
 * every charter of the same VP. Each card keeps its tier and therefore its
 * price, but not necessarily its resource, so a shuffled Rope Walk might want
 * the ore you were saving for a city.
 */
function shuffleCosts(
  cards: readonly CardDef[],
  rng: number,
): { state: number; costs: Record<string, PartialResources> } {
  const costs = printedCosts(cards);
  const groups = new Map<string, CardDef[]>();
  for (const def of cards) {
    if (!def.cost) continue;
    const tier = costTier(def);
    const group = groups.get(tier);
    if (group) group.push(def);
    else groups.set(tier, [def]);
  }

  let state = rng;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const shuffled = shuffleWithRng(group, state);
    state = shuffled.state;
    group.forEach((def, index) => {
      const donor = shuffled.items[index];
      if (donor?.cost) costs[def.id] = { ...donor.cost };
    });
  }
  return { state, costs };
}

/** Resolve the market for one game. Consumes randomness only for varied/shuffled. */
export function resolveMarket(settings: CardSettings, rng: number): MarketResolution {
  const piles = pickPiles(settings.pool, rng);
  const charters = pickCharters(settings.pool, piles.state);
  const cards = [...piles.cards, ...charters.cards];
  const priced = settings.costs === 'shuffled'
    ? shuffleCosts(cards, charters.state)
    : { state: charters.state, costs: printedCosts(cards) };

  const market: Record<string, number> = {};
  for (const def of cards) market[def.id] = def.copies;
  return { state: priced.state, market, costs: priced.costs };
}
