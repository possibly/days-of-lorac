import { describe, expect, it } from 'vitest';
import { createGame } from '../engine/index.js';
import {
  act,
  actionPhase,
  finishSetup,
  patch,
  setResources,
} from '../engine/__tests__/helpers.js';
import {
  DEFAULT_CARD_SETTINGS,
  normalizeCardSettings,
  resolveMarket,
  VARIED_CHARTER_SLOTS,
  VARIED_PILE_SLOTS,
} from '../card-settings.js';
import {
  BASE_CHARTER_CARDS,
  BASE_MARKET_CARDS,
  CHARTER_CARDS,
  MARKET_CARDS,
} from '../cards.js';
import { RESOURCES } from '../types.js';
import type { CardDef, CardSettings, PartialResources } from '../types.js';

function total(cost: PartialResources | null | undefined): number {
  return RESOURCES.reduce((sum, resource) => sum + (cost?.[resource] ?? 0), 0);
}

function singleResource(cost: PartialResources | null | undefined): string | null {
  const held = RESOURCES.filter((resource) => (cost?.[resource] ?? 0) > 0);
  return held.length === 1 ? held[0] ?? null : null;
}

const settings = (changes: Partial<CardSettings>): CardSettings => ({
  ...DEFAULT_CARD_SETTINGS,
  ...changes,
});

/** A game with host-chosen cards, finished setup and rolled into the action phase. */
function actionGameWith(seed: number, cards: CardSettings) {
  const finished = finishSetup(createGame({ playerCount: 4, seed, cards }));
  const seated = finished.currentSeat === 0
    ? finished
    : patch(finished, (draft) => {
        draft.currentSeat = 0;
      });
  return actionPhase(seated);
}

describe('card settings', () => {
  it('defaults to the printed market', () => {
    expect(DEFAULT_CARD_SETTINGS).toEqual({ pool: 'standard', costs: 'printed' });
    const resolved = resolveMarket(DEFAULT_CARD_SETTINGS, 42);
    const expectedPiles = BASE_MARKET_CARDS.map((def) => def.id).sort();
    const expectedCharters = BASE_CHARTER_CARDS.map((def) => def.id).sort();
    expect(Object.keys(resolved.market).sort()).toEqual([...expectedPiles, ...expectedCharters].sort());
    for (const def of [...BASE_MARKET_CARDS, ...BASE_CHARTER_CARDS]) {
      expect(resolved.costs[def.id]).toEqual(def.cost);
      expect(resolved.market[def.id]).toBe(def.copies);
    }
  });

  it('standard at printed prices consumes no randomness', () => {
    expect(resolveMarket(DEFAULT_CARD_SETTINGS, 7).state).toBe(7);
  });

  it('normalizes unknown settings back to the fallback', () => {
    expect(normalizeCardSettings({ pool: 'nope', costs: 'shuffled' })).toEqual({
      pool: 'standard',
      costs: 'shuffled',
    });
    expect(normalizeCardSettings(null)).toEqual(DEFAULT_CARD_SETTINGS);
  });

  it('expanded stocks every pile and charter in the file', () => {
    const resolved = resolveMarket(settings({ pool: 'expanded' }), 11);
    expect(Object.keys(resolved.market).sort()).toEqual(
      [...MARKET_CARDS, ...CHARTER_CARDS].map((def) => def.id).sort(),
    );
    expect(Object.keys(resolved.costs).sort()).toEqual(
      [...MARKET_CARDS, ...CHARTER_CARDS].map((def) => def.id).sort(),
    );
  });

  it('varied deals a random subset with every resource covered', () => {
    const first = resolveMarket(settings({ pool: 'varied' }), 3);
    const pileIds = MARKET_CARDS.filter((def) => first.market[def.id] !== undefined).map((def) => def.id);
    const charterIds = CHARTER_CARDS.filter((def) => first.market[def.id] !== undefined).map((def) => def.id);
    expect(pileIds).toHaveLength(VARIED_PILE_SLOTS);
    expect(charterIds).toHaveLength(VARIED_CHARTER_SLOTS);

    for (const resource of RESOURCES) {
      expect(
        pileIds.some((id) => singleResource(first.costs[id] ?? null) === resource),
      ).toBe(true);
    }
    // One cheap deed and one premium deed, so the sink and the prize are there.
    const vps = charterIds.map((id) => CHARTER_CARDS.find((def) => def.id === id)?.vp ?? 0);
    expect(Math.min(...vps)).toBeLessThanOrEqual(1);
    expect(Math.max(...vps)).toBeGreaterThan(1);

    expect(resolveMarket(settings({ pool: 'varied' }), 3)).toEqual(first);
  });

  it('varied draws different cards on different seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24; seed += 1) {
      seen.add(Object.keys(resolveMarket(settings({ pool: 'varied' }), seed).market).sort().join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('shuffled prices keep each card in its own cost tier', () => {
    for (const pool of ['standard', 'expanded', 'varied'] as const) {
      const printed = resolveMarket(settings({ pool }), 5);
      const shuffled = resolveMarket(settings({ pool, costs: 'shuffled' }), 5);
      for (const defId of Object.keys(printed.market)) {
        const def = [...MARKET_CARDS, ...CHARTER_CARDS].find((card) => card.id === defId) as CardDef;
        expect(shuffled.costs[defId]).toBeDefined();
        expect(total(shuffled.costs[defId])).toBe(total(def.cost));
        if (def.kind === 'market') {
          expect(singleResource(shuffled.costs[defId])).not.toBeNull();
        }
      }
    }
  });

  it('shuffled actually moves some piles to another resource', () => {
    const printed = resolveMarket(settings({ pool: 'standard' }), 5);
    const shuffled = resolveMarket(settings({ pool: 'standard', costs: 'shuffled' }), 5);
    const moved = Object.keys(printed.market).filter(
      (defId) => singleResource(printed.costs[defId]) !== singleResource(shuffled.costs[defId]),
    );
    expect(moved.length).toBeGreaterThan(0);
  });
});

describe('a game with a shuffled market', () => {
  it('charges the price on the table, not the printed one', () => {
    const cards = settings({ costs: 'shuffled' });
    let seed = 1;
    let probe = createGame({ playerCount: 4, seed, cards });
    while (
      JSON.stringify(probe.cardCosts['salvage-yard']) === JSON.stringify({ wood: 3 })
      && seed < 200
    ) {
      seed += 1;
      probe = createGame({ playerCount: 4, seed, cards });
    }
    const price = probe.cardCosts['salvage-yard'];
    expect(price).toBeDefined();
    expect(price).not.toEqual({ wood: 3 });

    // Fund exactly enough of the shuffled resource to buy one copy.
    const resource = singleResource(price) as (typeof RESOURCES)[number];
    expect(resource).not.toBeNull();
    const game = actionGameWith(seed, cards);
    expect(game.cardCosts['salvage-yard']).toEqual(price);
    const stocked = setResources(game, 0, { [resource]: 6 });
    const after = act(stocked, 0, { type: 'buyCard', defId: 'salvage-yard' });
    expect(after.players[0]?.resources[resource]).toBe(6 - (price?.[resource] ?? 0));
    expect(after.players[0]?.bought['salvage-yard']).toBe(1);
  });

  it('lists only the piles a varied game stocks', () => {
    const game = createGame({
      playerCount: 4,
      seed: 9,
      cards: settings({ pool: 'varied' }),
    });
    const piles = MARKET_CARDS.filter((def) => game.market[def.id] !== undefined);
    expect(piles).toHaveLength(VARIED_PILE_SLOTS);
    expect(Object.keys(game.cardCosts).sort()).toEqual(Object.keys(game.market).sort());
  });
});
