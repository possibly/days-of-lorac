/**
 * Per-seat view filtering.
 *
 * Hidden: other players' hands, deck order and discard contents. Everything
 * else is public in this game (resources, counts, charters, played cards,
 * awards, VP). The last 120 log entries go on the wire; state keeps them all.
 *
 * `config` is public-only: the seed stays in `GameState.config` because a
 * client that knows it can predict every remaining shuffle and die roll.
 */
import type {
  CardInstance,
  DiceRoll,
  GameState,
  GameView,
  PartialResources,
  PlayerView,
  Seat,
  TradeOffer,
} from '../types.js';
import { legalMoves } from './legal.js';

const LOG_WINDOW = 120;

function copyCards(cards: readonly CardInstance[]): CardInstance[] {
  return cards.map((card) => ({ iid: card.iid, defId: card.defId }));
}

function copyDice(dice: DiceRoll): DiceRoll {
  const gains: Record<Seat, PartialResources> = {};
  for (const [seat, gain] of Object.entries(dice.gains)) gains[Number(seat)] = { ...gain };
  return {
    die1: dice.die1,
    die2: dice.die2,
    total: dice.total,
    gains,
    blockedByRobber: dice.blockedByRobber.slice(),
  };
}

function copyCosts(costs: Record<string, PartialResources>): Record<string, PartialResources> {
  const out: Record<string, PartialResources> = {};
  for (const [defId, cost] of Object.entries(costs)) out[defId] = { ...cost };
  return out;
}

function copyOffer(offer: TradeOffer): TradeOffer {
  return {
    id: offer.id,
    from: offer.from,
    give: { ...offer.give },
    want: { ...offer.want },
    to: offer.to.slice(),
    createdTurn: offer.createdTurn,
  };
}

export function viewFor(
  state: GameState,
  seat: Seat,
  connected?: Partial<Record<Seat, boolean>>,
): GameView {
  const players: PlayerView[] = state.players.map((player) => ({
    seat: player.seat,
    name: player.name,
    isBot: player.isBot,
    connected: connected?.[player.seat] ?? true,
    resources: { ...player.resources },
    renown: player.renown,
    vp: player.vp,
    vpBreakdown: { ...player.vpBreakdown },
    charters: { ...player.charters },
    hand: player.seat === seat ? copyCards(player.hand) : null,
    handCount: player.hand.length,
    deckCount: player.deck.length,
    discardCount: player.discard.length,
    playedCount: player.played.length,
    played: copyCards(player.played),
    purchases: player.purchases,
    bought: { ...player.bought },
  }));

  const buildings: GameView['buildings'] = {};
  for (const [vertex, building] of Object.entries(state.buildings)) {
    buildings[vertex] = { owner: building.owner, type: building.type };
  }

  const lastPlay = state.lastPlay;
  return {
    gameId: state.gameId,
    version: state.version,
    unplayableIid:
      lastPlay && lastPlay.seat === seat && state.phase === 'action' && state.currentSeat === seat
        ? lastPlay.iid
        : null,
    you: seat,
    config: {
      playerCount: state.config.playerCount,
      targetVp: state.config.targetVp,
      map: { ...state.config.map },
      cards: { ...state.config.cards },
    },
    targetVp: state.config.targetVp,
    phase: state.phase,
    turn: state.turn,
    firstSeat: state.firstSeat,
    currentSeat: state.currentSeat,
    setup: state.setup
      ? {
          order: state.setup.order.slice(),
          index: state.setup.index,
          step: state.setup.step,
          pendingVertex: state.setup.pendingVertex,
        }
      : null,
    board: state.board,
    buildings,
    roads: { ...state.roads },
    robberHex: state.robberHex,
    players,
    market: { ...state.market },
    cardCosts: copyCosts(state.cardCosts),
    dice: state.dice ? copyDice(state.dice) : null,
    discardQueue: state.discardQueue.slice(),
    discardRequired: { ...state.discardRequired },
    tradeOffer: state.tradeOffer ? copyOffer(state.tradeOffer) : null,
    awards: {
      longestRoad: state.awards.longestRoad,
      largestExpedition: state.awards.largestExpedition,
      longestRoadLength: { ...state.awards.longestRoadLength },
    },
    log: state.log.slice(-LOG_WINDOW).map((entry) => ({
      ...entry,
      ...(entry.data ? { data: JSON.parse(JSON.stringify(entry.data)) as Record<string, unknown> } : {}),
    })),
    winner: state.winner,
    legal: legalMoves(state, seat),
  };
}
