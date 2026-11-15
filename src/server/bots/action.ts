/**
 * The action phase, in the design's order.
 *
 *   cards first (economy, choices, renown)
 *   then build (city before sprawl, settlement before road, road only when it
 *   reaches something worth reaching or the award)
 *   then bank and port trades toward the next build
 *   then at most one purchase
 *   then at most one trade offer
 *   then end the turn
 *
 * Each call returns exactly one action; the server (or the simulator) calls
 * back for the next one, so the order above holds without the bot having to
 * plan a whole turn up front.
 */
import { RESOURCES } from '../../shared/types.js';
import type { EdgeId, GameAction } from '../../shared/types.js';
import { chooseCardPlay, choosePurchase, chooseWinningPurchase } from './cards.js';
import { bestRoadEdge, bestSettlementVertex, roadScore, settlementScore } from './placement.js';
import type { Sense } from './sense.js';
import { canPay } from './sense.js';
import { maybeOfferTrade } from './trade.js';
import type { BotWeights } from './weights.js';

/** Highest pip count among the bot's city-upgrade candidates. */
function bestCityVertex(sense: Sense): { vertex: string; pips: number } | null {
  let best: { vertex: string; pips: number } | null = null;
  for (const vertex of sense.view.legal.build.cities) {
    const pips = sense.vertexPips(vertex);
    if (!best || pips > best.pips) best = { vertex, pips };
  }
  return best;
}

/** True when one more of the bot's roads would take the trade-route award. */
function roadAwardInReach(sense: Sense, w: BotWeights): boolean {
  if (w.roadAwardFocus <= 0) return false;
  const awards = sense.view.awards;
  const holder = awards.longestRoad;
  if (holder === sense.you) return false;
  const mine = awards.longestRoadLength[sense.you] ?? 0;
  if (mine < 4) return false;
  const holderLength = holder === null ? 0 : awards.longestRoadLength[holder] ?? 0;
  return mine + 1 >= 5 && (holder === null || mine + 1 > holderLength);
}

/**
 * Cities before sprawl when the city sits on a good hex; otherwise a fresh
 * settlement, because a new vertex produces more than a doubled mediocre one
 * and 1 VP plus a port is real.
 *
 * Roads are means, not ends. The bot only lays one when it has no connected
 * vertex left to settle, when a road would reach a site clearly better than
 * anything already connected, or when the road award is one road away. Without
 * that rule a rich bot happily paves the island and never saves for the
 * settlement the road was for.
 */
export function chooseBuild(sense: Sense, w: BotWeights): GameAction | null {
  const legal = sense.view.legal.build;
  const canCity = legal.affordable.city && legal.cities.length > 0;
  const canSettle = legal.affordable.settlement && legal.settlements.length > 0;
  const canRoad = legal.affordable.road && legal.roads.length > 0;

  const city = canCity ? bestCityVertex(sense) : null;
  const settlement = canSettle
    ? bestSettlementVertex(sense, legal.settlements, w)
    : null;
  const settlementPoints = settlement === null ? -Infinity : settlementScore(sense, settlement, w);

  if (city && city.pips >= w.cityPipMin) return { type: 'buildCity', vertex: city.vertex };
  if (settlement && settlementPoints >= w.settlementMin) {
    return { type: 'buildSettlement', vertex: settlement };
  }

  if (canRoad) {
    const edge = roadIsWorthIt(sense, w);
    if (edge) return { type: 'buildRoad', edge };
  }

  if (city) return { type: 'buildCity', vertex: city.vertex };
  if (settlement) return { type: 'buildSettlement', vertex: settlement };

  // Nothing worth building. Only spend on a road when the hand is too big to
  // survive a seven comfortably and the road still opens something.
  if (canRoad) {
    let held = 0;
    for (const resource of RESOURCES) held += sense.me.resources[resource];
    if (held >= 8) {
      const edge = bestRoadEdge(sense, legal.roads, w);
      if (edge && roadScore(sense, edge, w) >= w.roadBuildMin) return { type: 'buildRoad', edge };
    }
  }
  return null;
}

function roadIsWorthIt(sense: Sense, w: BotWeights): EdgeId | null {
  const legal = sense.view.legal.build;
  if (legal.roads.length === 0) return null;

  let held = 0;
  for (const resource of RESOURCES) held += sense.me.resources[resource];

  // One more road takes the trade route award: always worth it.
  if (roadAwardInReach(sense, w)) {
    const edge = bestRoadEdge(sense, legal.roads, w);
    if (edge) return edge;
  }

  // A road is progress only when it opens a vertex that can actually be
  // settled: the far end must have no building adjacent, otherwise the
  // distance rule keeps it dead forever and the road is two resources spent on
  // scenery.
  const enabling = legal.roads.filter((edge) => roadOpensSettlement(sense, edge));

  if (legal.settlements.length > 0) {
    // A connected site exists. The wood and brick belong to the settlement
    // unless this road opens something clearly better and the settlement is
    // still a while away.
    const plan = sense.plan;
    if (plan.kind === 'settlement' && plan.etaTurns <= 2.5) return null;
    const connected = bestSettlementVertex(sense, legal.settlements, w);
    const connectedScore = connected ? settlementScore(sense, connected, w) : 0;
    if (enabling.length === 0) return null;
    const edge = bestRoadEdge(sense, enabling, w);
    if (!edge) return null;
    return roadScore(sense, edge, w) > connectedScore + 4 ? edge : null;
  }

  // Nothing connected: the network has to grow. Prefer a road that opens a
  // settle spot right now; otherwise only pave when the hand is large enough
  // that the road cannot be the thing that stops the settlement.
  if (enabling.length > 0) {
    const edge = bestRoadEdge(sense, enabling, w);
    if (edge && roadScore(sense, edge, w) >= w.roadBuildMin) return edge;
  }
  if (held >= 8) {
    const edge = bestRoadEdge(sense, legal.roads, w);
    if (edge && roadScore(sense, edge, w) >= w.roadBuildMin) return edge;
  }
  return null;
}

/** True when this road would make one of its endpoints a legal settlement. */
function roadOpensSettlement(sense: Sense, edgeId: EdgeId): boolean {
  const edge = sense.edge(edgeId);
  if (!edge) return false;
  return sense.vertexOpen(edge.a) || sense.vertexOpen(edge.b);
}

export function chooseBankTrade(sense: Sense): GameAction | null {
  if (sense.bankTradesThisTurn() >= 3) return null;
  const plan = sense.plan.cost;
  if (canPay(sense.me.resources, plan)) return null;

  const deficit: Record<string, number> = {};
  let missing = 0;
  for (const resource of RESOURCES) {
    const need = (plan[resource] ?? 0) - (sense.me.resources[resource] ?? 0);
    if (need > 0) {
      deficit[resource] = need;
      missing += need;
    }
  }
  if (missing === 0) return null;

  let best: { give: (typeof RESOURCES)[number]; receive: (typeof RESOURCES)[number]; count: number } | null =
    null;
  let bestScore = 0;
  for (const option of sense.view.legal.bankTrades) {
    if (!deficit[option.receive]) continue;
    const surplus =
      (sense.me.resources[option.give] ?? 0) - (plan[option.give] ?? 0);
    if (surplus < option.count) continue;
    // Rate first, then how badly the incoming resource is needed.
    const score = (5 - option.count) * 2 + Math.min(2, deficit[option.receive] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = { give: option.give, receive: option.receive, count: option.count };
    }
  }
  if (!best) return null;
  return { type: 'bankTrade', give: best.give, receive: best.receive, count: best.count };
}

export function chooseActionPhaseAction(sense: Sense, w: BotWeights): GameAction {
  const card = chooseCardPlay(sense, w);
  if (card) return card;

  // Close the game before anything else if the last point is on the table.
  const winning = chooseWinningPurchase(sense, w);
  if (winning) return winning;

  const build = chooseBuild(sense, w);
  if (build) return build;

  const bank = chooseBankTrade(sense);
  if (bank) return bank;

  const purchase = choosePurchase(sense, w);
  if (purchase) return purchase;

  const offer = maybeOfferTrade(sense, w);
  if (offer) return offer;

  return { type: 'endTurn' };
}
