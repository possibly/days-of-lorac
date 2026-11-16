/**
 * Card decisions: which card to play next, what its choice should be, and what
 * the market is worth buying.
 *
 * Play order is fixed by card type rather than by hand order: economy and draw
 * first, then the cards whose choice depends on what the turn has produced
 * (Provisioner, Shipwright's Yard), then builds, then the free road from Guild
 * Mason so it can extend the network the builds just made, then the renown and
 * robber card last.
 *
 * Purchase value follows the deck-economy formula in docs/CARDS.md section 6.1:
 * a card of per-appearance value V in a deck of n cards changes income by
 * `5 * (V - 1.3) / (n + 1)` per turn. Multiply by the turns left, subtract the
 * cost, and only buy what pays back before the game ends.
 */
import { CARD_BY_ID } from '../../shared/cards.js';
import { RESOURCES } from '../../shared/types.js';
import type {
  CardDef,
  GameAction,
  PartialResources,
  PlayableCard,
  Resource,
} from '../../shared/types.js';
import { bestRoadEdge, bestSettlementVertex, roadScore } from './placement.js';
import { chooseLampTarget } from './robber.js';
import type { Sense } from './sense.js';
import { AVG_CARD_VALUE, RESOURCE_WEIGHT, totalOf, unitValue } from './sense.js';
import type { BotWeights } from './weights.js';

/** Stage order for playing cards. Lower plays first. */
export function cardStage(defId: string): number {
  const def = CARD_BY_ID.get(defId);
  if (!def) return 9;
  if (def.choice === 'road') return 4;
  if (def.choice === 'settlement') return 3;
  if (def.choice === 'resources') return 2;
  if (def.choice === 'robber') return 5;
  return 1;
}

/** Cards that draw ideally play before cards that only gain resources. */
function drawWeight(defId: string): number {
  const def = CARD_BY_ID.get(defId);
  if (!def) return 0;
  let draws = 0;
  for (const effect of def.effects) if (effect.kind === 'draw') draws += effect.count;
  return draws;
}

/**
 * Provisioner: the two resources that finish the nearest settlement or city,
 * valued with the same unit values the discard and trade code uses.
 */
export function chooseProvisionerResources(sense: Sense): [Resource, Resource] {
  const held = { ...sense.me.resources };
  const picks: Resource[] = [];
  for (let round = 0; round < 2; round += 1) {
    let best: Resource = 'wheat';
    let bestValue = -Infinity;
    for (const resource of RESOURCES) {
      const index = held[resource] + picks.filter((pick) => pick === resource).length;
      const value = unitValue(sense.plan.cost, sense.production, resource, index);
      if (value > bestValue) {
        bestValue = value;
        best = resource;
      }
    }
    picks.push(best);
  }
  return [picks[0] ?? 'wheat', picks[1] ?? 'ore'];
}

function choiceActionFor(sense: Sense, card: PlayableCard, w: BotWeights): GameAction {
  if (card.choice === 'resources') {
    return {
      type: 'playCard',
      iid: card.iid,
      choice: { kind: 'resources', resources: chooseProvisionerResources(sense) },
    };
  }
  if (card.choice === 'road') {
    const options = card.roadOptions ?? [];
    const edge = bestRoadEdge(sense, options, w);
    if (!edge) return { type: 'playCard', iid: card.iid };
    return { type: 'playCard', iid: card.iid, choice: { kind: 'road', edge } };
  }
  if (card.choice === 'settlement') {
    const options = card.settlementOptions ?? [];
    const vertex = bestSettlementVertex(sense, options, w);
    if (!vertex) return { type: 'playCard', iid: card.iid };
    return { type: 'playCard', iid: card.iid, choice: { kind: 'settlement', vertex } };
  }
  if (card.choice === 'robber') {
    const target = chooseLampTarget(sense, card.robberHexes ?? [], card.robberVictims, w);
    if (!target) return { type: 'playCard', iid: card.iid };
    return {
      type: 'playCard',
      iid: card.iid,
      choice: {
        kind: 'robber',
        move: target.victimSeat === undefined ? { hex: target.hex } : target,
      },
    };
  }
  return { type: 'playCard', iid: card.iid };
}

/**
 * Next card to play, or null when the hand is empty. A Guild Mason is held
 * back while a paid settlement is affordable, so the free road can extend the
 * network the settlement is about to create.
 */
export function chooseCardPlay(sense: Sense, w: BotWeights): GameAction | null {
  const playable = sense.view.legal.playable;
  if (playable.length === 0) return null;

  const ranked = playable
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const stageA = cardStage(a.card.defId);
      const stageB = cardStage(b.card.defId);
      if (stageA !== stageB) return stageA - stageB;
      const drawA = drawWeight(a.card.defId);
      const drawB = drawWeight(b.card.defId);
      if (drawA !== drawB) return drawB - drawA;
      return a.index - b.index;
    });

  const chosen = ranked[0];
  if (!chosen) return null;

  const stage = cardStage(chosen.card.defId);
  const build = sense.view.legal.build;
  // Build the settlement first: a free road is worth more once it can reach
  // from the new building.
  if (stage === 4 && build.affordable.settlement && build.settlements.length > 0) return null;

  return choiceActionFor(sense, chosen.card, w);
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

/** Value of the renown a card prints, for the expedition award. */
function renownValue(sense: Sense, amount: number, w: BotWeights): number {
  if (amount <= 0) return 0;
  const holder = sense.view.awards.largestExpedition;
  if (holder === sense.you) return 0.4 * amount;
  const mine = sense.me.renown;
  let rivalBest = 0;
  for (const rival of sense.rivals()) {
    rivalBest = Math.max(rivalBest, sense.player(rival)?.renown ?? 0);
  }
  const after = mine + amount;
  const takes = after >= 3 && after > rivalBest;
  // Progress is worth something even when it does not take the award this time:
  // two Survey Voyages are the cheapest two VP in the game.
  return (takes ? 2 * w.vpToResources * w.awardFocus : 0) + 1.4 * amount;
}

/**
 * What a printed gain is worth per appearance. This stays close to the printed
 * resource count: a small bonus when the resource is one the plan is short of,
 * and nothing else. Valuing it with the marginal unit values used for discards
 * would double-count the deficit and make Provisioner look like three cards in
 * one, which is how a policy ends up buying the same pile six times a game.
 */
function printedGainValue(sense: Sense, set: PartialResources): number {
  let total = 0;
  for (const resource of RESOURCES) {
    const count = set[resource] ?? 0;
    if (count <= 0) continue;
    const short = (sense.me.resources[resource] ?? 0) < (sense.plan.cost[resource] ?? 0);
    total += count * RESOURCE_WEIGHT[resource] * (short ? 1.3 : 1);
  }
  return total;
}

/** What one appearance of this card is worth, in resource-equivalents. */
export function appearanceValue(sense: Sense, def: CardDef, w: BotWeights): number {
  let value = 0;
  const legalBuild = sense.view.legal.build;
  for (const effect of def.effects) {
    if (effect.kind === 'gain') value += printedGainValue(sense, effect.resources);
    else if (effect.kind === 'draw') value += effect.count * AVG_CARD_VALUE;
    else if (effect.kind === 'renown') value += renownValue(sense, effect.amount, w);
    else if (effect.kind === 'chooseResources') value += 2 * 1.25;
    else if (effect.kind === 'freeRoad') {
      const edge = bestRoadEdge(sense, legalBuild.roads, w);
      if (edge && roadScore(sense, edge, w) >= w.roadBuildMin) value += 2.4;
      else value += printedGainValue(sense, effect.fallback);
    } else if (effect.kind === 'freeSettlement') {
      const vertex = bestSettlementVertex(sense, legalBuild.settlements, w);
      if (vertex) value += 4 + w.vpToResources * 0.55;
      else value += printedGainValue(sense, effect.fallback);
    } else if (effect.kind === 'optionalRobber') {
      value += 0.8;
    }
  }
  return Math.min(6, value);
}

/** Wins above replacement in the deck, times the turns left, minus the price. */
function marketCardValue(sense: Sense, def: CardDef, w: BotWeights): number {
  const appearance = appearanceValue(sense, def, w);
  const deckSize = sense.deckSize();
  const delta = (5 * (appearance - AVG_CARD_VALUE)) / (deckSize + 1);
  const turns = sense.turnsLeft();
  const benefit = delta * turns;
  // This game's price, not the printed one: shuffled-cost games move prices
  // between cards inside a tier, so the bot has to read the market it sits at.
  const price = sense.view.cardCosts[def.id] ?? def.cost;
  const cost = totalOf(price ?? {});
  let net = benefit - cost * w.purchaseRatio;

  // One-ply lookahead: spending this now can push the next build out a turn.
  if (w.lookahead > 0 && price) {
    const after: PartialResources = { ...sense.me.resources };
    for (const resource of RESOURCES) {
      after[resource] = (after[resource] ?? 0) - (price[resource] ?? 0);
    }
    const delay = sense.turnsToAffordWith(after, sense.plan.cost) - sense.plan.etaTurns;
    if (delay > 0.34) net -= delay * 1.4 * w.lookahead;
  }
  return net;
}

/** Charter value: raw VP, discounted for the dead draws it adds forever. */
function charterValue(sense: Sense, def: CardDef, w: BotWeights): number | null {
  const vp = def.vp ?? 0;
  if (vp <= 0) return null;
  const view = sense.view;
  if (view.turn < w.charterTurn) return null;

  const near = sense.me.vp >= sense.vpTarget() - w.charterVpWindow;
  const boardOpen = view.legal.build.settlements.length > 0;
  const eta = sense.plan.etaTurns;
  let held = 0;
  for (const resource of RESOURCES) held += sense.me.resources[resource];

  // Never trade a settlement away for paperwork.
  if (boardOpen && eta <= 1 && !near) return null;
  // Mid-game charters are a tempo loss unless the board is closed, the bot is
  // already close to the target, or it is simply sitting on a pile it cannot
  // spend. Five dead resources are worth less than a permanent point.
  if (!near && boardOpen && held < 7) return null;
  // Quay Deed is the sink of last resort: close to the target, blocked, or rich.
  if (vp <= 1 && !near && held < 8 && (boardOpen || eta > 2)) return null;

  let value = vp * w.vpToResources - w.charterDilution;

  // Buy the last copy out from under an opponent who is about to win.
  if (w.denyCharters > 0 && (view.market[def.id] ?? 0) === 1) {
    for (const rival of sense.rivals()) {
      const other = sense.player(rival);
      if (other && other.vp >= sense.vpTarget() - 3) value += w.denyCharters * 3;
    }
  }
  return value;
}

/**
 * A purchase that ends the game right now. Checked before building, because a
 * Fleet Charter is worth 2 VP and a city upgrade only 1, so the closing move is
 * often a charter rather than the last building.
 */
export function chooseWinningPurchase(sense: Sense, w: BotWeights): GameAction | null {
  const target = sense.vpTarget();
  if (sense.me.vp >= target) return null;
  for (const defId of sense.view.legal.buyable) {
    const def = CARD_BY_ID.get(defId);
    if (!def || def.kind !== 'charter') continue;
    if (sense.view.turn < w.charterTurn) continue;
    if (sense.me.vp + (def.vp ?? 0) >= target) return { type: 'buyCard', defId };
  }
  return null;
}

/**
 * One purchase per turn is a cap, not a quota. Every affordable card is
 * scored; the best net value above zero wins, and the bot goes without when
 * nothing clears the bar.
 */
export function choosePurchase(sense: Sense, w: BotWeights): GameAction | null {
  const buyable = sense.view.legal.buyable;
  if (buyable.length === 0) return null;

  let bestId: string | null = null;
  let bestKey = 0;
  for (let index = 0; index < buyable.length; index += 1) {
    const defId = buyable[index];
    if (!defId) continue;
    const def = CARD_BY_ID.get(defId);
    if (!def) continue;
    const cost = totalOf(sense.view.cardCosts[defId] ?? def.cost ?? {});
    const evaluated = def.kind === 'charter' ? charterValue(sense, def, w) : marketCardValue(sense, def, w);
    if (evaluated === null) continue;
    // discipline 1 scores the card; discipline 0 prefers whatever is cheapest.
    const key = w.discipline * evaluated + (1 - w.discipline) * (10 - cost);
    if (key <= 0) continue;
    if (bestId === null || key > bestKey) {
      bestKey = key;
      bestId = defId;
    }
  }

  return bestId === null ? null : { type: 'buyCard', defId: bestId };
}
