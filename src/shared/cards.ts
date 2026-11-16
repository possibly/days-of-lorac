import type { CardDef } from './types.js';

/**
 * The complete card set. `docs/CARDS.md` is the design source; this file is the
 * implementation. If they disagree, this file is what the game plays, so change
 * both in the same edit.
 *
 * Costs are single-resource for market piles and fixed multisets for charters.
 * `copies` is the printed market supply. Starting cards are not in the market.
 */
export const CARD_DEFS: CardDef[] = [
  // Starting deck: exactly two of each resource, no choices.
  {
    id: 'start-wood',
    name: 'Driftwood Crew',
    kind: 'starting',
    cost: null,
    copies: 2,
    text: 'Gain 1 Wood.',
    flavor: 'They know every cove that hides a dead hull.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { wood: 1 } }],
  },
  {
    id: 'start-brick',
    name: 'Ballast Crew',
    kind: 'starting',
    cost: null,
    copies: 2,
    text: 'Gain 1 Brick.',
    flavor: 'Heavy work, light fingers.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { brick: 1 } }],
  },
  {
    id: 'start-sheep',
    name: 'Fleece Runner',
    kind: 'starting',
    cost: null,
    copies: 2,
    text: 'Gain 1 Sheep.',
    flavor: 'Quick feet, warm cargo.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { sheep: 1 } }],
  },
  {
    id: 'start-wheat',
    name: 'Victualler',
    kind: 'starting',
    cost: null,
    copies: 2,
    text: 'Gain 1 Wheat.',
    flavor: 'A full hold is a kind of courage.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { wheat: 1 } }],
  },
  {
    id: 'start-ore',
    name: 'Bellows Hand',
    kind: 'starting',
    cost: null,
    copies: 2,
    text: 'Gain 1 Ore.',
    flavor: 'Soot in the lungs, coin in the purse.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { ore: 1 } }],
  },

  // Market piles.
  {
    id: 'salvage-yard',
    name: 'Salvage Yard',
    kind: 'market',
    cost: { wood: 3 },
    copies: 7,
    text: 'Gain 2 Brick and 1 Ore.',
    flavor: 'Everything washes up eventually.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { brick: 2, ore: 1 } }],
  },
  {
    id: 'rope-walk',
    name: 'Rope Walk',
    kind: 'market',
    cost: { wood: 3 },
    copies: 6,
    text: 'Gain 1 Wood. Draw 2 cards.',
    flavor: 'Twist, tar, repeat.',
    tags: ['economy', 'cycling'],
    effects: [
      { kind: 'gain', resources: { wood: 1 } },
      { kind: 'draw', count: 2 },
    ],
  },
  {
    id: 'foundry-quay',
    name: 'Foundry Quay',
    kind: 'market',
    cost: { brick: 3 },
    copies: 6,
    text: 'Gain 2 Ore and 1 Wheat.',
    flavor: 'Ore in, bells out.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { ore: 2, wheat: 1 } }],
  },
  {
    id: 'guild-mason',
    name: 'Guild Mason',
    kind: 'market',
    cost: { brick: 3 },
    copies: 6,
    text: 'Place a road for free. If you cannot, gain 1 Wood and 1 Brick. Draw 1 card.',
    flavor: 'A road is an argument with the coastline.',
    tags: ['board', 'cycling'],
    choice: 'road',
    effects: [
      { kind: 'freeRoad', fallback: { wood: 1, brick: 1 } },
      { kind: 'draw', count: 1 },
    ],
  },
  {
    id: 'wool-factor',
    name: 'Wool Factor',
    kind: 'market',
    cost: { sheep: 3 },
    copies: 6,
    text: 'Gain 2 Sheep. Draw 1 card.',
    flavor: 'Soft goods, hard bargains.',
    tags: ['economy', 'cycling'],
    effects: [
      { kind: 'gain', resources: { sheep: 2 } },
      { kind: 'draw', count: 1 },
    ],
  },
  {
    id: 'wreckers-lamp',
    name: "Wrecker's Lamp",
    kind: 'market',
    cost: { sheep: 3 },
    copies: 5,
    text: 'Gain 1 Renown. You may move the robber and steal 1 resource from the player with a building on that hex.',
    flavor: 'The sea gives. The lamp takes.',
    tags: ['disruption', 'renown'],
    choice: 'robber',
    choiceOptional: true,
    effects: [
      { kind: 'renown', amount: 1 },
      { kind: 'optionalRobber' },
    ],
  },
  {
    id: 'provisioner',
    name: 'Provisioner',
    kind: 'market',
    cost: { wheat: 2 },
    copies: 6,
    text: 'Gain 2 resources of your choice.',
    flavor: 'What the island lacks, the hold supplies.',
    tags: ['flexibility'],
    choice: 'resources',
    effects: [{ kind: 'chooseResources', count: 2 }],
  },
  {
    id: 'survey-voyage',
    name: 'Survey Voyage',
    kind: 'market',
    cost: { wheat: 3 },
    copies: 6,
    text: 'Gain 2 Renown. Draw 1 card.',
    flavor: 'Bring back a map and a story.',
    tags: ['renown', 'cycling'],
    effects: [
      { kind: 'renown', amount: 2 },
      { kind: 'draw', count: 1 },
    ],
  },
  {
    id: 'bellows-yard',
    name: 'Bellows Yard',
    kind: 'market',
    cost: { ore: 3 },
    copies: 6,
    text: 'Gain 2 Ore and 2 Wheat.',
    flavor: 'Hot enough to make a claim.',
    tags: ['economy'],
    effects: [{ kind: 'gain', resources: { ore: 2, wheat: 2 } }],
  },
  {
    id: 'shipwrights-yard',
    name: "Shipwright's Yard",
    kind: 'market',
    cost: { ore: 4 },
    copies: 4,
    text: "Gain 1 Renown. Place a settlement for free. If you cannot, gain 2 Ore and 2 Wheat.",
    flavor: 'A keel on the beach is a promise.',
    tags: ['board', 'renown'],
    choice: 'settlement',
    effects: [
      { kind: 'renown', amount: 1 },
      { kind: 'freeSettlement', fallback: { ore: 2, wheat: 2 } },
    ],
  },

  // Expansion piles. `expansion: true` keeps them out of the standard market;
  // expanded games stock the whole list, varied games deal a seeded subset.
  {
    id: 'tar-kiln',
    name: 'Tar Kiln',
    kind: 'market',
    cost: { wood: 3 },
    copies: 6,
    text: 'Gain 2 Brick and 1 Wood.',
    flavor: 'Slow smoke, hard goods.',
    tags: ['economy'],
    expansion: true,
    effects: [{ kind: 'gain', resources: { brick: 2, wood: 1 } }],
  },
  {
    id: 'salt-pans',
    name: 'Salt Pans',
    kind: 'market',
    cost: { brick: 3 },
    copies: 6,
    text: 'Gain 2 Sheep and 1 Wheat.',
    flavor: 'The sun does the work.',
    tags: ['economy'],
    expansion: true,
    effects: [{ kind: 'gain', resources: { sheep: 2, wheat: 1 } }],
  },
  {
    id: 'copper-works',
    name: 'Copper Works',
    kind: 'market',
    cost: { brick: 2 },
    copies: 5,
    text: 'Gain 1 Ore and 1 Wood.',
    flavor: 'Green metal, honest price.',
    tags: ['economy'],
    expansion: true,
    effects: [{ kind: 'gain', resources: { ore: 1, wood: 1 } }],
  },
  {
    id: 'tide-reader',
    name: 'Tide Reader',
    kind: 'market',
    cost: { wheat: 3 },
    copies: 6,
    text: 'Gain 1 Renown. Draw 2 cards.',
    flavor: 'She reads the water and the guild pays for it.',
    tags: ['renown', 'cycling'],
    expansion: true,
    effects: [
      { kind: 'renown', amount: 1 },
      { kind: 'draw', count: 2 },
    ],
  },
  {
    id: 'pilot-skiff',
    name: 'Pilot Skiff',
    kind: 'market',
    cost: { wood: 2 },
    copies: 5,
    text: 'Gain 1 Sheep and 1 Wheat.',
    flavor: 'A short run out to the good pasture.',
    tags: ['economy'],
    expansion: true,
    effects: [{ kind: 'gain', resources: { sheep: 1, wheat: 1 } }],
  },
  {
    id: 'smithy-row',
    name: 'Smithy Row',
    kind: 'market',
    cost: { ore: 3 },
    copies: 6,
    text: 'Gain 2 Ore and 1 Brick.',
    flavor: 'Ash on the doorstep, iron in the yard.',
    tags: ['economy'],
    expansion: true,
    effects: [{ kind: 'gain', resources: { ore: 2, brick: 1 } }],
  },
  {
    id: 'road-crew',
    name: 'Road Crew',
    kind: 'market',
    cost: { brick: 2 },
    copies: 5,
    text: 'Place a road for free. If you cannot, gain 1 Wood and 1 Brick.',
    flavor: 'Two hands, one causeway.',
    tags: ['board'],
    expansion: true,
    choice: 'road',
    effects: [{ kind: 'freeRoad', fallback: { wood: 1, brick: 1 } }],
  },
  {
    id: 'granary',
    name: 'Granary',
    kind: 'market',
    cost: { wheat: 3 },
    copies: 6,
    text: 'Gain 2 Wheat and 1 Sheep.',
    flavor: 'Full sacks make calm neighbours.',
    tags: ['economy'],
    expansion: true,
    effects: [{ kind: 'gain', resources: { wheat: 2, sheep: 1 } }],
  },

  // Charters: permanent VP, dead draws forever.
  {
    id: 'quay-deed',
    name: 'Quay Deed',
    kind: 'charter',
    cost: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 },
    copies: 9,
    text: 'Worth 1 Victory Point.',
    flavor: 'A scrap of paper worth a harbour.',
    vp: 1,
    tags: ['scoring'],
    effects: [],
  },
  {
    id: 'fleet-charter',
    name: 'Fleet Charter',
    kind: 'charter',
    cost: { ore: 3, wheat: 3, brick: 3 },
    copies: 4,
    text: 'Worth 2 Victory Points.',
    flavor: 'The guild remembers who owns the tide.',
    vp: 2,
    tags: ['scoring'],
    effects: [],
  },
  {
    id: 'salt-charter',
    name: 'Salt Charter',
    kind: 'charter',
    cost: { wood: 2, brick: 1, sheep: 1, wheat: 1 },
    copies: 5,
    text: 'Worth 1 Victory Point.',
    flavor: 'Rights to the pans, and to the road that reaches them.',
    vp: 1,
    tags: ['scoring'],
    expansion: true,
    effects: [],
  },
  {
    id: 'harbour-charter',
    name: 'Harbour Charter',
    kind: 'charter',
    cost: { wood: 2, brick: 2, sheep: 2, wheat: 2, ore: 1 },
    copies: 3,
    text: 'Worth 2 Victory Points.',
    flavor: 'A whole harbour is a heavy piece of paper.',
    vp: 2,
    tags: ['scoring'],
    expansion: true,
    effects: [],
  },
];

export const CARD_BY_ID: ReadonlyMap<string, CardDef> = new Map(
  CARD_DEFS.map((card) => [card.id, card]),
);

export function getCard(defId: string): CardDef {
  const card = CARD_BY_ID.get(defId);
  if (!card) throw new Error(`unknown card: ${defId}`);
  return card;
}

/** True for cards that ask their player to move the robber when played. */
export function cardMovesRobber(def: CardDef): boolean {
  return def.choice === 'robber' || def.effects.some((effect) => effect.kind === 'optionalRobber');
}

export const STARTING_CARDS = CARD_DEFS.filter((card) => card.kind === 'starting');
export const MARKET_CARDS = CARD_DEFS.filter((card) => card.kind === 'market');
export const CHARTER_CARDS = CARD_DEFS.filter((card) => card.kind === 'charter');

/** The piles a standard game stocks, in printed order. */
export const BASE_MARKET_CARDS = MARKET_CARDS.filter((card) => !card.expansion);
/** The charter stacks a standard game stocks, in printed order. */
export const BASE_CHARTER_CARDS = CHARTER_CARDS.filter((card) => !card.expansion);

/** Piles and charters together, in printed display order. */
export const PURCHASABLE_CARDS = CARD_DEFS.filter(
  (card) => card.kind === 'market' || card.kind === 'charter',
);

export function charterVp(defId: string): number {
  return getCard(defId).vp ?? 0;
}
