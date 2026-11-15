/**
 * The bot policy: one `chooseBotAction` for every phase and every difficulty.
 *
 * `view` is already seat-filtered, so the policy cannot see another player's
 * hand, the deck order or the discard contents. It does not try to: everything
 * below reads public state only.
 *
 * The policy is a single scored-candidate pipeline plus weight profiles in
 * `weights.ts`. Deckhand (easy) scores with `discipline: 0`, which keeps the
 * first legal candidate; Factor (normal) and Guildmaster (hard) score with
 * `discipline: 1` and differ only in thresholds, noise and lookahead.
 *
 * The last step of `chooseBotAction` re-validates the choice against
 * `view.legal`. A policy bug should cost the bot one turn, never a rejected
 * action, so an illegal answer falls back to a conservative legal move.
 */
import { RESOURCES } from '../../shared/types.js';
import type {
  BotDifficulty,
  EdgeId,
  GameAction,
  GameView,
  HexId,
  PartialResources,
  PlayableCard,
  Resource,
  VertexId,
} from '../../shared/types.js';
import { chooseActionPhaseAction } from './action.js';
import { chooseDiscard } from './discard.js';
import { bestRobberTarget } from './robber.js';
import { Sense } from './sense.js';
import { chooseSetupRoad, chooseSetupSettlement } from './setup.js';
import { respondToTrade } from './trade.js';
import type { BotWeights } from './weights.js';
import { weightsFor } from './weights.js';

export { BOT_WEIGHTS, weightsFor } from './weights.js';
export type { BotWeights } from './weights.js';

export function chooseBotAction(view: GameView, difficulty: BotDifficulty): GameAction {
  const weights = weightsFor(difficulty);
  const action = decide(view, weights);
  if (isLegalAction(view, action)) return action;

  const fallback = conservativeAction(view);
  if (isLegalAction(view, fallback)) return fallback;

  // Nothing legal to do at all. The server only asks when it should not, so
  // this is the documented defensive answer.
  return { type: 'endTurn' };
}

function decide(view: GameView, w: BotWeights): GameAction {
  if (view.phase === 'gameOver' || view.winner !== null) return { type: 'endTurn' };

  const legal = view.legal;
  const sense = new Sense(view);

  // 1. Mandatory discard, possibly out of turn.
  if (legal.discard) {
    return { type: 'discard', resources: chooseDiscard(sense, legal.discard.required) };
  }

  // 2. Answer an open trade offer, possibly out of turn.
  if (legal.canRespondToTrade && view.tradeOffer) {
    return respondToTrade(sense, w);
  }

  // 3. Setup draft: settlement, then the road that pairs with it.
  if (view.phase === 'setup') {
    const vertex = chooseSetupSettlement(sense, w);
    if (vertex) return { type: 'setupSettlement', vertex };
    const edge = chooseSetupRoad(sense, w);
    if (edge) return { type: 'setupRoad', edge };
    return { type: 'endTurn' };
  }

  // 4. Production roll.
  if (legal.canRoll) return { type: 'roll' };

  // 5. Robber.
  if (legal.robber) {
    const { target } = bestRobberTarget(sense, legal.robber.hexes, legal.robber.victims, w);
    if (target) {
      return target.victimSeat === undefined
        ? { type: 'moveRobber', hex: target.hex }
        : { type: 'moveRobber', hex: target.hex, victimSeat: target.victimSeat };
    }
    return { type: 'endTurn' };
  }

  // 6. Action phase.
  if (view.phase === 'action' && legal.isTurn) {
    return chooseActionPhaseAction(sense, w);
  }

  return { type: 'endTurn' };
}

// ---------------------------------------------------------------------------
// Legality guard
// ---------------------------------------------------------------------------

function isResource(value: string): value is Resource {
  return (RESOURCES as readonly string[]).includes(value);
}

function legalPlayable(view: GameView, iid: number): PlayableCard | undefined {
  return view.legal.playable.find((card) => card.iid === iid);
}

function choiceOk(card: PlayableCard, action: Extract<GameAction, { type: 'playCard' }>): boolean {
  const choice = action.choice;
  if (!choice) {
    // A choice is only omittable when the card has none or has no legal target.
    return card.choice === null || card.choiceOptional;
  }
  if (choice.kind === 'resources') {
    if (card.choice !== 'resources') return false;
    return choice.resources.every((resource) => isResource(resource));
  }
  if (choice.kind === 'road') {
    return card.choice === 'road' && (card.roadOptions ?? []).includes(choice.edge);
  }
  if (choice.kind === 'settlement') {
    return card.choice === 'settlement' && (card.settlementOptions ?? []).includes(choice.vertex);
  }
  if (card.choice !== 'robber') return false;
  const move = choice.move;
  if (!move) return true;
  if (!(card.robberHexes ?? []).includes(move.hex)) return false;
  if (move.victimSeat === undefined) return true;
  return (card.robberVictims?.[move.hex] ?? []).includes(move.victimSeat);
}

export function isLegalAction(view: GameView, action: GameAction): boolean {
  const legal = view.legal;
  switch (action.type) {
    case 'endTurn':
      return legal.canEndTurn;
    case 'roll':
      return legal.canRoll;
    case 'discard': {
      if (!legal.discard) return false;
      let total = 0;
      for (const [resource, amount] of Object.entries(action.resources)) {
        if (!isResource(resource)) return false;
        const count = amount ?? 0;
        if (!Number.isInteger(count) || count < 0) return false;
        if (count > (view.players[view.you]?.resources[resource] ?? 0)) return false;
        total += count;
      }
      return total === legal.discard.required;
    }
    case 'moveRobber': {
      if (!legal.robber) return false;
      if (!legal.robber.hexes.includes(action.hex)) return false;
      if (action.victimSeat === undefined) return true;
      return (legal.robber.victims[action.hex] ?? []).includes(action.victimSeat);
    }
    case 'setupSettlement':
      return legal.setupSettlements.includes(action.vertex);
    case 'setupRoad':
      return legal.setupRoads.includes(action.edge);
    case 'buildRoad':
      return legal.build.affordable.road && legal.build.roads.includes(action.edge);
    case 'buildSettlement':
      return legal.build.affordable.settlement && legal.build.settlements.includes(action.vertex);
    case 'buildCity':
      return legal.build.affordable.city && legal.build.cities.includes(action.vertex);
    case 'playCard': {
      const card = legalPlayable(view, action.iid);
      if (!card) return false;
      return choiceOk(card, action);
    }
    case 'bankTrade':
      return legal.bankTrades.some(
        (option) =>
          option.give === action.give &&
          option.receive === action.receive &&
          option.count === action.count,
      );
    case 'buyCard':
      return legal.buyable.includes(action.defId);
    case 'offerTrade':
      return legal.canOfferTrade;
    case 'respondTrade':
      return legal.canRespondToTrade && view.tradeOffer?.id === action.offerId;
    case 'cancelTrade':
      return legal.canCancelTrade;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Conservative fallback: the documented "bot must always find a move" path
// ---------------------------------------------------------------------------

function firstDiscard(view: GameView, required: number): PartialResources {  const held = view.players[view.you]?.resources;
  const out: PartialResources = {};
  let left = required;
  if (!held) return out;
  const order = [...RESOURCES].sort((a, b) => held[b] - held[a]);
  for (const resource of order) {
    if (left <= 0) break;
    const take = Math.min(left, held[resource]);
    if (take > 0) {
      out[resource] = take;
      left -= take;
    }
  }
  return out;
}

/** Does the bot itself collect from this hex? Read-only, from the public view. */
function producesForSelf(view: GameView, hexId: HexId): boolean {
  const hex = view.board.hexes.find((entry) => entry.id === hexId);
  if (!hex || hex.terrain === 'desert') return false;
  return hex.vertices.some((vertex) => view.buildings[vertex]?.owner === view.you);
}

function conservativeAction(view: GameView): GameAction {
  const legal = view.legal;

  if (legal.discard) {
    return { type: 'discard', resources: firstDiscard(view, legal.discard.required) };
  }
  if (legal.canRespondToTrade && view.tradeOffer) {
    return { type: 'respondTrade', offerId: view.tradeOffer.id, accept: false };
  }
  if (legal.setupSettlements.length > 0) {
    const vertex = legal.setupSettlements[0] as VertexId;
    return { type: 'setupSettlement', vertex };
  }
  if (legal.setupRoads.length > 0) {
    const edge = legal.setupRoads[0] as EdgeId;
    return { type: 'setupRoad', edge };
  }
  if (legal.canRoll) return { type: 'roll' };
  if (legal.robber) {
    // Last line of defence: never a hex the bot itself produces on while any
    // other legal hex exists. Same rule as `selfHarmTier`, without the Sense.
    const hexes = legal.robber.hexes;
    const quiet = hexes.find((candidate) => !producesForSelf(view, candidate)) ?? hexes[0];
    const hex = quiet as HexId;
    const victim = legal.robber.victims[hex]?.[0];
    return victim === undefined
      ? { type: 'moveRobber', hex }
      : { type: 'moveRobber', hex, victimSeat: victim };
  }

  const card = legal.playable.find((entry) => entry.choice === null || entry.choiceOptional);
  if (card) {
    const action: Extract<GameAction, { type: 'playCard' }> = { type: 'playCard', iid: card.iid };
    return action;
  }
  const cardAny = legal.playable[0];
  if (cardAny) {
    if (cardAny.choice === 'road') {
      const edge = cardAny.roadOptions?.[0];
      return edge
        ? { type: 'playCard', iid: cardAny.iid, choice: { kind: 'road', edge } }
        : { type: 'playCard', iid: cardAny.iid };
    }
    if (cardAny.choice === 'settlement') {
      const vertex = cardAny.settlementOptions?.[0];
      return vertex
        ? { type: 'playCard', iid: cardAny.iid, choice: { kind: 'settlement', vertex } }
        : { type: 'playCard', iid: cardAny.iid };
    }
    if (cardAny.choice === 'resources') {
      return {
        type: 'playCard',
        iid: cardAny.iid,
        choice: { kind: 'resources', resources: ['wheat', 'ore'] },
      };
    }
    if (cardAny.choice === 'robber') {
      const hex = cardAny.robberHexes?.[0];
      const victim = hex === undefined ? undefined : cardAny.robberVictims?.[hex]?.[0];
      if (hex !== undefined) {
        return {
          type: 'playCard',
          iid: cardAny.iid,
          choice: {
            kind: 'robber',
            move: victim === undefined ? { hex } : { hex, victimSeat: victim },
          },
        };
      }
    }
    return { type: 'playCard', iid: cardAny.iid };
  }

  if (legal.build.affordable.city && legal.build.cities[0]) {
    return { type: 'buildCity', vertex: legal.build.cities[0] };
  }
  if (legal.build.affordable.settlement && legal.build.settlements[0]) {
    return { type: 'buildSettlement', vertex: legal.build.settlements[0] };
  }
  if (legal.build.affordable.road && legal.build.roads[0]) {
    return { type: 'buildRoad', edge: legal.build.roads[0] };
  }
  const trade = legal.bankTrades[0];
  if (trade) {
    return { type: 'bankTrade', give: trade.give, receive: trade.receive, count: trade.count };
  }
  if (legal.buyable[0]) return { type: 'buyCard', defId: legal.buyable[0] };
  return { type: 'endTurn' };
}
