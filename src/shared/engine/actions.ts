/**
 * Action dispatch. Every handler mutates a private clone; the input state is
 * never touched. One accepted action increments `version` and ends with one
 * `refreshDerived` pass (cards also refresh mid-resolution so a win stops the
 * remaining effects). Rejections return a code and a message and change
 * nothing.
 */
import {
  BUILD_COSTS,
  HAND_SIZE,
  RESOURCE_LIMIT,
  countResources,
} from '../constants.js';
import { RESOURCES } from '../types.js';
import type {
  ActionResult,
  EdgeId,
  GameAction,
  GameState,
  HexId,
  PartialResources,
  Resource,
  Seat,
  VertexId,
} from '../types.js';
import { boardIndex } from './board.js';
import { addLog, describeResources, playerName } from './log.js';
import { refreshDerived } from './awards.js';
import { buyCard as buyCardAction, playCard as playCardAction } from './cards.js';
import {
  bestBankRate,
  canAfford,
  gainResources,
  legalRoadEdges,
  legalSettlementVertices,
  payCost,
  robberVictimsByHex,
  tradeRecipients,
} from './legal.js';
import { cloneState, drawCards, failure, performRobberMove } from './state.js';
import { randomInt } from './rng.js';
import type { EngineFailure } from './state.js';
import { setupRoad, setupSettlement } from './setup.js';

type DiscardAction = Extract<GameAction, { type: 'discard' }>;
type MoveRobberAction = Extract<GameAction, { type: 'moveRobber' }>;
type OfferTradeAction = Extract<GameAction, { type: 'offerTrade' }>;
type RespondTradeAction = Extract<GameAction, { type: 'respondTrade' }>;
type BankTradeAction = Extract<GameAction, { type: 'bankTrade' }>;

export function applyAction(state: GameState, seat: Seat, action: GameAction): ActionResult {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) {
    return {
      ok: false,
      code: 'SEAT_INVALID',
      message: `Seat ${String(seat)} does not exist in this game.`,
    };
  }
  if (state.phase === 'gameOver') {
    return { ok: false, code: 'GAME_OVER', message: 'The game is over.' };
  }

  const draft = cloneState(state);
  const problem = dispatch(draft, seat, action);
  if (problem) {
    return { ok: false, code: problem.code, message: problem.message };
  }

  draft.version = state.version + 1;
  refreshDerived(draft);
  return { ok: true, state: draft };
}

function dispatch(draft: GameState, seat: Seat, action: GameAction): EngineFailure | null {
  switch (action.type) {
    case 'setupSettlement':
      return setupSettlement(draft, seat, action.vertex);
    case 'setupRoad':
      return setupRoad(draft, seat, action.edge);
    case 'roll':
      return roll(draft, seat);
    case 'discard':
      return discard(draft, seat, action);
    case 'moveRobber':
      return moveRobber(draft, seat, action);
    case 'playCard':
      return playCardAction(draft, seat, action);
    case 'buildRoad':
      return buildRoad(draft, seat, action.edge);
    case 'buildSettlement':
      return buildSettlement(draft, seat, action.vertex);
    case 'buildCity':
      return buildCity(draft, seat, action.vertex);
    case 'bankTrade':
      return bankTrade(draft, seat, action);
    case 'offerTrade':
      return offerTrade(draft, seat, action);
    case 'respondTrade':
      return respondTrade(draft, seat, action);
    case 'cancelTrade':
      return cancelTrade(draft, seat);
    case 'buyCard':
      return buyCardAction(draft, seat, action);
    case 'endTurn':
      return endTurn(draft, seat);
    default:
      return failure('INVALID_ACTION', 'Unknown action type.');
  }
}

function requireActionTurn(draft: GameState, seat: Seat): EngineFailure | null {
  if (draft.phase !== 'action') {
    return failure('WRONG_PHASE', 'That action belongs to the action phase.');
  }
  if (seat !== draft.currentSeat) return failure('NOT_YOUR_TURN', 'It is not your turn.');
  return null;
}

function isResource(value: string): value is Resource {
  return (RESOURCES as readonly string[]).includes(value);
}

function roll(draft: GameState, seat: Seat): EngineFailure | null {
  if (draft.phase !== 'roll') {
    return failure('WRONG_PHASE', 'The dice are rolled at the start of the turn.');
  }
  if (seat !== draft.currentSeat) return failure('NOT_YOUR_TURN', 'It is not your turn.');
  if (draft.turnFlags.rolled) return failure('INVALID_ACTION', 'You already rolled this turn.');

  const first = randomInt(draft.rng, 6);
  draft.rng = first.state;
  const second = randomInt(draft.rng, 6);
  draft.rng = second.state;
  const die1 = first.value + 1;
  const die2 = second.value + 1;
  const total = die1 + die2;

  draft.turnFlags.rolled = true;

  const gains: Record<Seat, PartialResources> = {};
  for (const player of draft.players) gains[player.seat] = {};
  const blockedByRobber: HexId[] = [];

  if (total !== 7) {
    for (const hex of draft.board.hexes) {
      if (hex.token !== total) continue;
      if (hex.terrain === 'desert') continue;
      if (hex.id === draft.robberHex) {
        blockedByRobber.push(hex.id);
        continue;
      }
      for (const vertex of hex.vertices) {
        const building = draft.buildings[vertex];
        if (!building) continue;
        const amount = building.type === 'city' ? 2 : 1;
        const bucket = gains[building.owner];
        if (!bucket) continue;
        bucket[hex.terrain] = (bucket[hex.terrain] ?? 0) + amount;
      }
    }
    for (const player of draft.players) {
      const gain = gains[player.seat];
      if (gain) gainResources(player, gain);
    }
  }

  draft.dice = { die1, die2, total, gains, blockedByRobber };
  addLog(draft, 'roll', `${playerName(draft, seat)} rolls ${total} (${die1} + ${die2}).`, seat, {
    die1,
    die2,
    total,
    blockedByRobber,
  });

  if (total === 7) {
    const required: Record<Seat, number> = {};
    const owing: Seat[] = [];
    for (const player of draft.players) {
      const held = countResources(player.resources);
      const need = held > RESOURCE_LIMIT ? Math.floor(held / 2) : 0;
      required[player.seat] = need;
      if (need > 0) owing.push(player.seat);
    }
    draft.discardRequired = required;
    draft.discardQueue = owing;

    if (owing.length > 0) {
      draft.phase = 'discard';
      addLog(
        draft,
        'seven',
        `Seven rolled. ${owing
          .map((owingSeat) => `${playerName(draft, owingSeat)} discards ${required[owingSeat]}`)
          .join(', ')}.`,
        seat,
        { queue: owing, required },
      );
    } else {
      draft.phase = 'robber';
      addLog(draft, 'seven', 'Seven rolled. Nobody is over the resource limit.', seat, {
        queue: [],
        required,
      });
      addLog(draft, 'info', `${playerName(draft, seat)} must move the robber.`, seat, {});
    }
    return null;
  }

  draft.discardQueue = [];
  draft.discardRequired = {};
  draft.phase = 'action';
  logProduction(draft, gains, blockedByRobber);
  return null;
}

function logProduction(
  draft: GameState,
  gains: Record<Seat, PartialResources>,
  blockedByRobber: HexId[],
): void {
  const lines: string[] = [];
  for (const player of draft.players) {
    const gain = gains[player.seat];
    if (!gain) continue;
    if (countResources(gain) === 0) continue;
    lines.push(`${player.name}: +${describeResources(gain)}`);
  }
  const text =
    lines.length > 0 ? `Production: ${lines.join('; ')}.` : 'Production: nothing was produced.';
  addLog(draft, 'production', text, null, {
    gains,
    blockedByRobber,
  });
}

function discard(draft: GameState, seat: Seat, action: DiscardAction): EngineFailure | null {
  if (draft.phase !== 'discard') {
    return failure('WRONG_PHASE', 'No discard is pending.');
  }
  const queueIndex = draft.discardQueue.indexOf(seat);
  if (queueIndex < 0) {
    return failure('DISCARD_NOT_REQUIRED', 'You do not owe a discard.');
  }
  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');
  const required = draft.discardRequired[seat] ?? 0;

  let total = 0;
  for (const [resource, amount] of Object.entries(action.resources)) {
    if (!isResource(resource)) {
      return failure('INVALID_DISCARD', `Unknown resource ${resource}.`);
    }
    if (!Number.isInteger(amount) || (amount ?? 0) < 0) {
      return failure('INVALID_DISCARD', 'Discard counts must be non-negative integers.');
    }
    const count = amount ?? 0;
    if (count > player.resources[resource]) {
      return failure('INVALID_DISCARD', `You do not hold ${count} ${resource}.`);
    }
    total += count;
  }
  if (total !== required) {
    return failure('INVALID_DISCARD', `You must discard exactly ${required} resources.`);
  }

  for (const [resource, amount] of Object.entries(action.resources)) {
    if (!isResource(resource)) continue;
    player.resources[resource] -= amount ?? 0;
  }

  draft.discardQueue.splice(queueIndex, 1);
  draft.discardRequired[seat] = 0;
  addLog(
    draft,
    'discard',
    `${player.name} discards ${describeResources(action.resources)}.`,
    seat,
    { resources: action.resources },
  );

  if (draft.discardQueue.length === 0) {
    draft.phase = 'robber';
    addLog(draft, 'info', `${playerName(draft, draft.currentSeat)} must move the robber.`, draft.currentSeat, {});
  }
  return null;
}

function moveRobber(draft: GameState, seat: Seat, action: MoveRobberAction): EngineFailure | null {
  if (draft.phase !== 'robber') {
    return failure('WRONG_PHASE', 'The robber moves after the seven resolves.');
  }
  if (seat !== draft.currentSeat) return failure('NOT_YOUR_TURN', 'It is not your turn.');

  const index = boardIndex(draft.board);
  if (!index.hex.has(action.hex)) {
    return failure('INVALID_ROBBER_HEX', `There is no hex ${action.hex}.`);
  }
  if (action.hex === draft.robberHex) {
    return failure('ROBBER_SAME_HEX', 'The robber must move to a different hex.');
  }
  if (action.victimSeat !== undefined) {
    const victims = robberVictimsByHex(draft, seat)[action.hex] ?? [];
    if (!victims.includes(action.victimSeat)) {
      return failure('INVALID_VICTIM', 'That player has no building on the chosen hex.');
    }
  }

  performRobberMove(draft, seat, action.hex, action.victimSeat);
  draft.phase = 'action';
  return null;
}

function buildRoad(draft: GameState, seat: Seat, edge: EdgeId): EngineFailure | null {
  const turnProblem = requireActionTurn(draft, seat);
  if (turnProblem) return turnProblem;

  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');
  const index = boardIndex(draft.board);
  if (!index.edge.has(edge)) return failure('INVALID_PLACEMENT', `There is no edge ${edge}.`);
  if (draft.roads[edge] !== undefined) return failure('OCCUPIED', 'That edge already has a road.');
  if (!legalRoadEdges(draft, seat).includes(edge)) {
    return failure('NOT_CONNECTED', 'A road must touch your network.');
  }
  if (!canAfford(player.resources, BUILD_COSTS.road)) {
    return failure('CANNOT_AFFORD', 'A road costs 1 wood and 1 brick.');
  }

  payCost(player, BUILD_COSTS.road);
  draft.roads[edge] = seat;
  addLog(draft, 'build', `${player.name} builds a road on ${edge}.`, seat, { edge });
  return null;
}

function buildSettlement(draft: GameState, seat: Seat, vertex: VertexId): EngineFailure | null {
  const turnProblem = requireActionTurn(draft, seat);
  if (turnProblem) return turnProblem;

  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');
  const index = boardIndex(draft.board);
  if (!index.vertex.has(vertex)) {
    return failure('INVALID_PLACEMENT', `There is no vertex ${vertex}.`);
  }
  if (draft.buildings[vertex]) {
    return failure('OCCUPIED', 'That vertex already has a building.');
  }
  for (const neighbor of index.vertexNeighbors.get(vertex) ?? []) {
    if (draft.buildings[neighbor]) {
      return failure('TOO_CLOSE', 'A settlement must be two edges away from every building.');
    }
  }
  if (!legalSettlementVertices(draft, seat).includes(vertex)) {
    return failure('NOT_CONNECTED', 'A settlement must connect to your own road.');
  }
  if (!canAfford(player.resources, BUILD_COSTS.settlement)) {
    return failure('CANNOT_AFFORD', 'A settlement costs 1 wood, 1 brick, 1 sheep and 1 wheat.');
  }

  payCost(player, BUILD_COSTS.settlement);
  draft.buildings[vertex] = { owner: seat, type: 'settlement' };
  addLog(draft, 'build', `${player.name} builds a settlement on ${vertex}.`, seat, { vertex });
  return null;
}

function buildCity(draft: GameState, seat: Seat, vertex: VertexId): EngineFailure | null {
  const turnProblem = requireActionTurn(draft, seat);
  if (turnProblem) return turnProblem;

  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');
  const index = boardIndex(draft.board);
  if (!index.vertex.has(vertex)) {
    return failure('INVALID_PLACEMENT', `There is no vertex ${vertex}.`);
  }
  const building = draft.buildings[vertex];
  if (!building || building.owner !== seat || building.type !== 'settlement') {
    return failure('INVALID_PLACEMENT', 'A city must upgrade one of your own settlements.');
  }
  if (!canAfford(player.resources, BUILD_COSTS.city)) {
    return failure('CANNOT_AFFORD', 'A city costs 2 wheat and 3 ore.');
  }

  payCost(player, BUILD_COSTS.city);
  draft.buildings[vertex] = { owner: seat, type: 'city' };
  addLog(draft, 'build', `${player.name} upgrades ${vertex} to a city.`, seat, { vertex });
  return null;
}

function bankTrade(draft: GameState, seat: Seat, action: BankTradeAction): EngineFailure | null {
  const turnProblem = requireActionTurn(draft, seat);
  if (turnProblem) return turnProblem;

  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');
  if (!isResource(action.give) || !isResource(action.receive)) {
    return failure('INVALID_TRADE', 'Unknown resource.');
  }
  if (action.give === action.receive) {
    return failure('INVALID_TRADE', 'You cannot trade a resource for itself.');
  }
  const rate = bestBankRate(draft, seat, action.give);
  if (action.count !== rate) {
    return failure('INVALID_TRADE', `Your best rate for ${action.give} is ${rate}:1.`);
  }
  if (player.resources[action.give] < rate) {
    return failure('CANNOT_AFFORD', `You need ${rate} ${action.give}.`);
  }

  player.resources[action.give] -= rate;
  player.resources[action.receive] += 1;
  addLog(
    draft,
    'trade',
    `${player.name} trades ${rate} ${action.give} for 1 ${action.receive} with the bank.`,
    seat,
    { give: action.give, receive: action.receive, count: rate, bank: true },
  );
  return null;
}

function sanitizeResources(input: PartialResources | undefined): PartialResources | null {
  if (!input || typeof input !== 'object') return null;
  const clean: PartialResources = {};
  for (const [resource, amount] of Object.entries(input)) {
    if (!isResource(resource)) return null;
    if (amount === undefined) continue;
    if (!Number.isInteger(amount) || amount < 0) return null;
    if (amount > 0) clean[resource] = amount;
  }
  return clean;
}

function offerTrade(draft: GameState, seat: Seat, action: OfferTradeAction): EngineFailure | null {
  const turnProblem = requireActionTurn(draft, seat);
  if (turnProblem) return turnProblem;
  if (draft.tradeOffer) {
    return failure('TRADE_EXISTS', 'Only one trade offer may be open at a time.');
  }

  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');
  const give = sanitizeResources(action.give);
  const want = sanitizeResources(action.want);
  if (!give || !want) return failure('INVALID_TRADE', 'Offers may only contain resources.');
  if (countResources(give) === 0 || countResources(want) === 0) {
    return failure('INVALID_TRADE', 'An offer needs at least one resource on each side.');
  }
  if (action.to !== 'all' && !Array.isArray(action.to)) {
    return failure('INVALID_TRADE', 'Choose all players or a list of seats.');
  }
  const recipients = tradeRecipients(draft, seat, action.to);
  if (recipients.length === 0) {
    return failure('INVALID_TRADE', 'An offer needs at least one recipient.');
  }
  if (!canAfford(player.resources, give)) {
    return failure('CANNOT_AFFORD', 'You do not hold what you are offering.');
  }

  draft.tradeOffer = {
    id: `offer-${draft.turn}-${draft.version}`,
    from: seat,
    give,
    want,
    to: recipients,
    createdTurn: draft.turn,
  };
  addLog(
    draft,
    'trade',
    `${player.name} offers ${describeResources(give)} for ${describeResources(want)}.`,
    seat,
    { id: draft.tradeOffer.id, give, want, to: recipients },
  );
  return null;
}

function respondTrade(draft: GameState, seat: Seat, action: RespondTradeAction): EngineFailure | null {
  if (draft.phase !== 'action') {
    return failure('NO_TRADE', 'There is no open offer.');
  }
  const offer = draft.tradeOffer;
  if (!offer) return failure('NO_TRADE', 'There is no open offer.');
  if (offer.id !== action.offerId) {
    return failure('TRADE_STALE', 'That offer is no longer open.');
  }
  if (seat === offer.from) {
    return failure('INVALID_ACTION', 'You cannot answer your own offer.');
  }
  const recipientIndex = offer.to.indexOf(seat);
  if (recipientIndex < 0) return failure('NOT_RECIPIENT', 'That offer was not made to you.');

  const from = draft.players[offer.from];
  const to = draft.players[seat];
  if (!from || !to) return failure('SEAT_INVALID', 'Unknown seat.');

  if (!action.accept) {
    offer.to.splice(recipientIndex, 1);
    addLog(draft, 'trade', `${to.name} declines the offer.`, seat, { id: offer.id });
    if (offer.to.length === 0) {
      draft.tradeOffer = null;
      addLog(draft, 'info', `Offer from ${from.name} closed with no takers.`, offer.from, {
        id: offer.id,
      });
    }
    return null;
  }

  if (!canAfford(from.resources, offer.give) || !canAfford(to.resources, offer.want)) {
    return failure('TRADE_STALE', 'A side can no longer pay for that trade.');
  }

  payCost(from, offer.give);
  gainResources(from, offer.want);
  payCost(to, offer.want);
  gainResources(to, offer.give);
  draft.tradeOffer = null;
  addLog(
    draft,
    'trade',
    `${from.name} trades ${describeResources(offer.give)} to ${to.name} for ${describeResources(offer.want)}.`,
    offer.from,
    { id: offer.id, from: offer.from, to: seat, give: offer.give, want: offer.want },
  );
  return null;
}

function cancelTrade(draft: GameState, seat: Seat): EngineFailure | null {
  const turnProblem = requireActionTurn(draft, seat);
  if (turnProblem) return turnProblem;
  const offer = draft.tradeOffer;
  if (!offer || offer.from !== seat) {
    return failure('NO_TRADE', 'You have no open offer.');
  }
  draft.tradeOffer = null;
  addLog(draft, 'trade', `${playerName(draft, seat)} withdraws the offer.`, seat, { id: offer.id });
  return null;
}

function endTurn(draft: GameState, seat: Seat): EngineFailure | null {
  const turnProblem = requireActionTurn(draft, seat);
  if (turnProblem) return turnProblem;

  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');

  if (player.hand.length > 0 || player.played.length > 0) {
    const discarded = player.hand.length + player.played.length;
    player.discard.push(...player.hand, ...player.played);
    player.hand = [];
    player.played = [];
    addLog(draft, 'info', `${player.name} discards ${discarded} cards.`, seat, { count: discarded });
  }

  draft.tradeOffer = null;
  draft.discardQueue = [];
  draft.discardRequired = {};
  draft.dice = null;
  draft.turnFlags = { rolled: false, purchased: false };

  const nextSeat = (seat + 1) % draft.players.length;
  draft.turn += 1;
  draft.currentSeat = nextSeat;
  draft.phase = 'roll';
  addLog(draft, 'turn', `Turn ${draft.turn}: ${playerName(draft, nextSeat)} to play.`, nextSeat, {
    turn: draft.turn,
    seat: nextSeat,
  });

  const next = draft.players[nextSeat];
  if (next) {
    while (next.hand.length < HAND_SIZE) {
      if (drawCards(draft, next, 1) === 0) break;
    }
  }
  return null;
}
