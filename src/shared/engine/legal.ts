/**
 * Placement legality and the `legalMoves` payload.
 *
 * Everything the UI may enable has to appear here, and every entry here must
 * be accepted by `applyAction`. Placement arrays are about topology only;
 * `affordable` says whether the player can pay right now.
 */
import {
  BASE_BANK_RATE,
  BUILD_COSTS,
  GENERIC_PORT_RATE,
  countResources,
} from '../constants.js';
import { PURCHASABLE_CARDS } from '../cards.js';
import { RESOURCES } from '../types.js';
import type {
  BankTradeOption,
  EdgeId,
  GameState,
  HexId,
  LegalMoves,
  PartialResources,
  PlayableCard,
  PlayerState,
  Port,
  Resource,
  Seat,
  VertexId,
} from '../types.js';
import { boardIndex } from './board.js';
import { findCard } from './state.js';

export function canAfford(resources: PartialResources, cost: PartialResources): boolean {
  for (const [resource, amount] of Object.entries(cost)) {
    if (!amount) continue;
    if ((resources[resource as Resource] ?? 0) < amount) return false;
  }
  return true;
}

export function payCost(player: PlayerState, cost: PartialResources): void {
  for (const [resource, amount] of Object.entries(cost)) {
    if (!amount) continue;
    player.resources[resource as Resource] -= amount;
  }
}

export function gainResources(player: PlayerState, gain: PartialResources): void {
  for (const [resource, amount] of Object.entries(gain)) {
    if (!amount) continue;
    player.resources[resource as Resource] += amount;
  }
}

/** Ports where the player has a settlement or a city. */
export function ownedPorts(state: GameState, seat: Seat): Port[] {
  return state.board.ports.filter((port) =>
    port.vertices.some((vertex) => state.buildings[vertex]?.owner === seat),
  );
}

/** 2 with the matching 2:1 port, 3 with any generic port, otherwise 4. */
export function bestBankRate(state: GameState, seat: Seat, give: Resource): number {
  const ports = ownedPorts(state, seat);
  if (ports.some((port) => port.resource === give && port.rate === 2)) return 2;
  if (ports.some((port) => port.resource === 'generic')) return GENERIC_PORT_RATE;
  return BASE_BANK_RATE;
}

export function hasBuilding(state: GameState, vertex: VertexId): boolean {
  return state.buildings[vertex] !== undefined;
}

function vertexIsOpen(state: GameState, vertex: VertexId): boolean {
  const index = boardIndex(state.board);
  if (state.buildings[vertex]) return false;
  for (const neighbor of index.vertexNeighbors.get(vertex) ?? []) {
    if (state.buildings[neighbor]) return false;
  }
  return true;
}

function vertexTouchesOwnRoad(state: GameState, seat: Seat, vertex: VertexId): boolean {
  const index = boardIndex(state.board);
  for (const edgeId of index.edgesByVertex.get(vertex) ?? []) {
    if (state.roads[edgeId] === seat) return true;
  }
  return false;
}

export function edgeIsOpen(state: GameState, edge: EdgeId): boolean {
  return state.roads[edge] === undefined;
}

export function edgeTouchesOwnNetwork(state: GameState, seat: Seat, edge: EdgeId): boolean {
  const index = boardIndex(state.board);
  const item = index.edge.get(edge);
  if (!item) return false;
  for (const vertex of [item.a, item.b]) {
    if (state.buildings[vertex]?.owner === seat) return true;
    for (const incident of index.edgesByVertex.get(vertex) ?? []) {
      if (state.roads[incident] === seat) return true;
    }
  }
  return false;
}

export function legalRoadEdges(state: GameState, seat: Seat): EdgeId[] {
  const out: EdgeId[] = [];
  for (const edge of state.board.edges) {
    if (!edgeIsOpen(state, edge.id)) continue;
    if (edgeTouchesOwnNetwork(state, seat, edge.id)) out.push(edge.id);
  }
  return out;
}

export function legalSettlementVertices(state: GameState, seat: Seat): VertexId[] {
  const out: VertexId[] = [];
  for (const vertex of state.board.vertices) {
    if (!vertexIsOpen(state, vertex.id)) continue;
    if (!vertexTouchesOwnRoad(state, seat, vertex.id)) continue;
    out.push(vertex.id);
  }
  return out;
}

export function legalCityVertices(state: GameState, seat: Seat): VertexId[] {
  const out: VertexId[] = [];
  for (const vertex of state.board.vertices) {
    const building = state.buildings[vertex.id];
    if (building && building.owner === seat && building.type === 'settlement') out.push(vertex.id);
  }
  return out;
}

/** Setup settlements ignore the road network but keep the distance rule. */
export function legalSetupSettlements(state: GameState): VertexId[] {
  const index = boardIndex(state.board);
  return state.board.vertices
    .filter((vertex) => {
      if (!vertexIsOpen(state, vertex.id)) return false;
      // Keep at least one open edge for the road that follows, so setup can
      // never strand a player on a fully built-up corner.
      return (index.edgesByVertex.get(vertex.id) ?? []).some((edge) => edgeIsOpen(state, edge));
    })
    .map((vertex) => vertex.id);
}

export function legalSetupRoads(state: GameState): EdgeId[] {
  const pending = state.setup?.pendingVertex;
  if (!pending) return [];
  const index = boardIndex(state.board);
  const out: EdgeId[] = [];
  for (const edgeId of index.edgesByVertex.get(pending) ?? []) {
    if (edgeIsOpen(state, edgeId)) out.push(edgeId);
  }
  return out;
}

export function robberHexOptions(state: GameState): HexId[] {
  return state.board.hexes.filter((hex) => hex.id !== state.robberHex).map((hex) => hex.id);
}

/** Victims by hex, excluding the acting player. Every hex gets an array. */
export function robberVictimsByHex(state: GameState, seat: Seat): Record<HexId, Seat[]> {
  const victims: Record<HexId, Seat[]> = {};
  for (const hex of state.board.hexes) {
    const seats: Seat[] = [];
    for (const vertex of hex.vertices) {
      const building = state.buildings[vertex];
      if (!building) continue;
      if (building.owner === seat) continue;
      if (!seats.includes(building.owner)) seats.push(building.owner);
    }
    seats.sort((a, b) => a - b);
    victims[hex.id] = seats;
  }
  return victims;
}

export function tradeRecipients(state: GameState, from: Seat, to: 'all' | Seat[]): Seat[] {
  const seats: Seat[] = [];
  if (to === 'all') {
    for (const player of state.players) if (player.seat !== from) seats.push(player.seat);
    return seats.sort((a, b) => a - b);
  }
  for (const candidate of to) {
    if (!Number.isInteger(candidate)) continue;
    if (candidate === from) continue;
    if (!state.players.some((player) => player.seat === candidate)) continue;
    if (!seats.includes(candidate)) seats.push(candidate);
  }
  return seats.sort((a, b) => a - b);
}

export function isOfferRecipient(state: GameState, seat: Seat): boolean {
  const offer = state.tradeOffer;
  if (!offer) return false;
  if (offer.from === seat) return false;
  return offer.to.includes(seat);
}

function playableCards(state: GameState, seat: Seat): PlayableCard[] {
  const player = state.players[seat];
  if (!player) return [];
  const roads = legalRoadEdges(state, seat);
  const settlements = legalSettlementVertices(state, seat);
  const hexes = robberHexOptions(state);
  const victims = robberVictimsByHex(state, seat);

  const out: PlayableCard[] = [];
  for (const card of player.hand) {
    const def = findCard(card.defId);
    if (!def) continue;
    if (def.kind === 'charter') continue;
    // A targeting card may be played with no choice only when it has no legal
    // target (its printed fallback). That is exactly what `choiceOptional`
    // reports to the UI and the bots.
    let choiceOptional = def.choiceOptional ?? false;
    if (def.choice === 'road' && roads.length === 0) choiceOptional = true;
    if (def.choice === 'settlement' && settlements.length === 0) choiceOptional = true;
    const entry: PlayableCard = {
      iid: card.iid,
      defId: card.defId,
      choice: def.choice ?? null,
      choiceOptional,
    };
    if (def.choice === 'road') entry.roadOptions = roads;
    if (def.choice === 'settlement') entry.settlementOptions = settlements;
    if (def.choice === 'robber') {
      entry.robberHexes = hexes;
      entry.robberVictims = victims;
    }
    out.push(entry);
  }
  return out;
}

export function legalMoves(state: GameState, seat: Seat): LegalMoves {
  const player = state.players[seat];
  const active = state.phase !== 'gameOver' && state.currentSeat === seat;
  const actionPhase = state.phase === 'action' && active;

  const roads = actionPhase ? legalRoadEdges(state, seat) : [];
  const settlements = actionPhase ? legalSettlementVertices(state, seat) : [];
  const cities = actionPhase ? legalCityVertices(state, seat) : [];
  const resources = player?.resources;

  const bankTrades: BankTradeOption[] = [];
  if (actionPhase && player) {
    for (const give of RESOURCES) {
      const rate = bestBankRate(state, seat, give);
      if ((player.resources[give] ?? 0) < rate) continue;
      for (const receive of RESOURCES) {
        if (receive === give) continue;
        bankTrades.push({ give, receive, count: rate });
      }
    }
  }

  const buyable: string[] = [];
  if (actionPhase && player && !state.turnFlags.purchased) {
    for (const card of PURCHASABLE_CARDS) {
      if ((state.market[card.id] ?? 0) <= 0) continue;
      if (!card.cost) continue;
      if (!canAfford(player.resources, card.cost)) continue;
      buyable.push(card.id);
    }
  }

  const setup = state.setup;
  const setupSettlements =
    state.phase === 'setup' && active && setup?.step === 'settlement'
      ? legalSetupSettlements(state)
      : [];
  const setupRoads =
    state.phase === 'setup' && active && setup?.step === 'road' && setup.pendingVertex
      ? legalSetupRoads(state)
      : [];

  const inQueue = state.discardQueue.includes(seat);

  return {
    seat,
    isTurn: state.currentSeat === seat && state.phase !== 'gameOver',
    phase: state.phase,
    canRoll: state.phase === 'roll' && active && !state.turnFlags.rolled,
    canEndTurn: actionPhase,
    purchaseUsed: state.turnFlags.purchased,
    setupSettlements,
    setupRoads,
    discard: inQueue ? { required: state.discardRequired[seat] ?? 0 } : null,
    robber:
      state.phase === 'robber' && active
        ? { hexes: robberHexOptions(state), victims: robberVictimsByHex(state, seat) }
        : null,
    playable: actionPhase ? playableCards(state, seat) : [],
    build: {
      roads,
      settlements,
      cities,
      affordable: {
        road: resources ? canAfford(resources, BUILD_COSTS.road) : false,
        settlement: resources ? canAfford(resources, BUILD_COSTS.settlement) : false,
        city: resources ? canAfford(resources, BUILD_COSTS.city) : false,
      },
    },
    bankTrades,
    buyable,
    canOfferTrade: actionPhase && state.tradeOffer === null,
    canRespondToTrade: state.phase === 'action' && isOfferRecipient(state, seat),
    canCancelTrade: actionPhase && state.tradeOffer?.from === seat,
  };
}

/** Handy for bots and tests: total resource cards held. */
export function heldResourceCount(player: PlayerState): number {
  return countResources(player.resources);
}
