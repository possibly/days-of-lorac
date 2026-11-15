/**
 * Temporary bot policy. The bot agent owns this file and replaces it with the
 * real Factor/Guildmaster policy. The server imports only this function, so
 * the room loop can be built and tested before the policy lands.
 */
import type { BotDifficulty, GameAction, GameView, PartialResources, Resource } from '@shared/types';
import { RESOURCES } from '@shared/types';

export function chooseBotAction(view: GameView, _difficulty: BotDifficulty): GameAction {
  const legal = view.legal;

  if (legal.discard) {
    const resources: PartialResources = {};
    let left = legal.discard.required;
    const order = [...RESOURCES].sort((a, b) => view.players[view.you]!.resources[b] - view.players[view.you]!.resources[a]);
    for (const resource of order) {
      if (left <= 0) break;
      const take = Math.min(left, view.players[view.you]!.resources[resource]);
      if (take > 0) {
        resources[resource] = take;
        left -= take;
      }
    }
    return { type: 'discard', resources };
  }

  if (legal.canRespondToTrade && view.tradeOffer) {
    return { type: 'respondTrade', offerId: view.tradeOffer.id, accept: false };
  }

  if (legal.canRoll) return { type: 'roll' };

  if (legal.robber) {
    const hex = legal.robber.hexes[0];
    if (hex) {
      const victim = legal.robber.victims[hex]?.[0];
      return victim === undefined ? { type: 'moveRobber', hex } : { type: 'moveRobber', hex, victimSeat: victim };
    }
  }

  if (view.phase === 'setup') {
    if (legal.setupSettlements[0]) return { type: 'setupSettlement', vertex: legal.setupSettlements[0] };
    if (legal.setupRoads[0]) return { type: 'setupRoad', edge: legal.setupRoads[0] };
  }

  if (view.phase === 'action' && legal.isTurn) {
    const easyCard = legal.playable.find((card) => card.choice === null || card.choiceOptional);
    if (easyCard) return { type: 'playCard', iid: easyCard.iid };

    if (legal.build.affordable.city && legal.build.cities[0]) {
      return { type: 'buildCity', vertex: legal.build.cities[0] };
    }
    if (legal.build.affordable.settlement && legal.build.settlements[0]) {
      return { type: 'buildSettlement', vertex: legal.build.settlements[0] };
    }
    if (legal.build.affordable.road && legal.build.roads[0]) {
      return { type: 'buildRoad', edge: legal.build.roads[0] };
    }
    if (legal.bankTrades[0]) {
      const trade = legal.bankTrades[0];
      return { type: 'bankTrade', give: trade.give, receive: trade.receive, count: trade.count };
    }
    if (legal.buyable[0]) return { type: 'buyCard', defId: legal.buyable[0] };
    return { type: 'endTurn' };
  }

  return { type: 'endTurn' };
}
