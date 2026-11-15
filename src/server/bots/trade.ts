/**
 * Player trades.
 *
 * Valuation is marginal, not per-unit average: the fifth wood in hand is worth
 * less than the first wheat, so a 2-for-1 that fixes a real shortage clears the
 * bar and a 1-for-1 that feeds a pile does not.
 *
 * Accept when the incoming set is worth at least `tradeAcceptRatio` of what the
 * bot gives up (0.62 to 0.68 depending on difficulty), never accept a trade
 * that pays for the leader's winning turn, and offer at most once per turn, so
 * a table that never answers costs nothing.
 */
import { RESOURCES } from '../../shared/types.js';
import type { GameAction, PartialResources, Resource } from '../../shared/types.js';
import type { Sense } from './sense.js';
import { canPay, gainValue, lossValue, totalOf } from './sense.js';
import type { BotWeights } from './weights.js';

function respondToTradeOrDecline(sense: Sense, w: BotWeights): GameAction | null {
  const offer = sense.view.tradeOffer;
  if (!offer) return null;
  return respondToTrade(sense, w);
}

export { respondToTradeOrDecline };

export function respondToTrade(sense: Sense, w: BotWeights): GameAction {
  const offer = sense.view.tradeOffer;
  const refuse: GameAction = { type: 'respondTrade', offerId: offer?.id ?? '', accept: false };
  if (!offer) return refuse;
  if (offer.from === sense.you) return refuse;
  if (!canPay(sense.me.resources, offer.want)) return refuse;

  const receive = gainValue(sense.me.resources, offer.give, sense.plan.cost, sense.production);
  const pay = lossValue(sense.me.resources, offer.want, sense.plan.cost, sense.production);
  if (pay <= 0.01) return { type: 'respondTrade', offerId: offer.id, accept: true };

  const ratio = receive / pay;

  // Completing the next build right now is worth a discount.
  const after: PartialResources = { ...sense.me.resources };
  for (const resource of RESOURCES) {
    after[resource] = (after[resource] ?? 0) + (offer.give[resource] ?? 0) - (offer.want[resource] ?? 0);
  }
  const completesPlan = !canPay(sense.me.resources, sense.plan.cost) && canPay(after, sense.plan.cost);
  const needed = completesPlan ? 1 : 0;

  // Never pay for the leader's winning turn. If the offerer is about to win,
  // only take the deal when it wins for this bot instead.
  const offerer = sense.player(offer.from);
  if (offerer && offerer.vp >= sense.vpTarget() - 2) {
    const planVp = sense.plan.kind === 'city' ? 2 : 1;
    const winsForMe =
      canPay(after, sense.plan.cost) && sense.me.vp + planVp >= sense.vpTarget();
    if (!winsForMe) return refuse;
  }

  if (ratio + needed * 0.08 >= w.tradeAcceptRatio) {
    return { type: 'respondTrade', offerId: offer.id, accept: true };
  }
  return refuse;
}

/**
 * Offer one surplus resource for one the bot is short of, once per turn, and
 * only when the shortage is what stands between it and the next build. The bot
 * never waits on an answer: if nobody takes it, the offer dies with the turn.
 */
export function maybeOfferTrade(sense: Sense, w: BotWeights): GameAction | null {
  const view = sense.view;
  if (!w.tradeProposals) return null;
  if (!view.legal.canOfferTrade) return null;
  if (sense.offersThisTurn() > 0) return null;
  if (sense.view.players.length < 2) return null;

  const plan = sense.plan;
  if (plan.affordable) return null;
  if (plan.etaTurns > 3) return null;

  const deficits: Resource[] = [];
  for (const resource of RESOURCES) {
    if ((sense.me.resources[resource] ?? 0) < (plan.cost[resource] ?? 0)) deficits.push(resource);
  }
  if (deficits.length === 0 || deficits.length > 2) return null;

  const want: PartialResources = {};
  for (const resource of deficits) want[resource] = 1;

  let giveResource: Resource | null = null;
  let bestSurplus = 0;
  for (const resource of RESOURCES) {
    if (deficits.includes(resource)) continue;
    // One unit stays in reserve on top of what the plan needs, so the offer
    // cannot be the thing that breaks the build it was meant to fix.
    const surplus = (sense.me.resources[resource] ?? 0) - (plan.cost[resource] ?? 0) - 1;
    if (surplus > bestSurplus) {
      bestSurplus = surplus;
      giveResource = resource;
    }
  }
  if (!giveResource || bestSurplus < 2) return null;

  const give: PartialResources = { [giveResource]: 1 };
  if (totalOf(give) === 0) return null;
  return { type: 'offerTrade', give, want, to: 'all' };
}
