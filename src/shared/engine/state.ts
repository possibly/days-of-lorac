/**
 * Game creation, state cloning, and small shared state helpers.
 *
 * `createGame` consumes randomness in this fixed order:
 *   1. board rotation (one draw), 2. board mirror (one draw),
 *   3. one shuffle per player, in seat order, for the 10-card starting decks.
 * The robber starts on the desert, the market is stocked to printed counts, and
 * the snake setup order is built. Hands are drawn (5 each) when the last setup
 * road lands; drawing consumes no randomness. `version`/`turn` stay 0 until
 * then.
 */
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  STARTING_DECK_IDS,
  countResources,
  emptyResources,
  targetVpFor,
} from '../constants.js';
import { PURCHASABLE_CARDS, getCard } from '../cards.js';
import { DESERT_HEX_ID } from '../board-template.js';
import { RESOURCES } from '../types.js';
import type {
  ActionErrorCode,
  Building,
  CardInstance,
  CreateGameOptions,
  GameState,
  HexId,
  PlayerState,
  ResourceMap,
  Seat,
} from '../types.js';
import { addLog, playerName } from './log.js';
import { randomInt, shuffleWithRng } from './rng.js';
import { buildBoard } from './board.js';
import { refreshDerived } from './awards.js';

export interface EngineFailure {
  code: ActionErrorCode;
  message: string;
}

export function failure(code: ActionErrorCode, message: string): EngineFailure {
  return { code, message };
}

/** Snake setup seats: 4p [0,1,2,3,3,2,1,0], 3p [0,1,2,2,1,0], 2p [0,1,1,0]. */
export function setupOrder(playerCount: number): Seat[] {
  const forward: Seat[] = [];
  for (let seat = 0; seat < playerCount; seat += 1) forward.push(seat);
  return [...forward, ...[...forward].reverse()];
}

function startingCardInstances(startIid: number): CardInstance[] {
  const cards: CardInstance[] = [];
  STARTING_DECK_IDS.forEach((defId, offset) => {
    cards.push({ iid: startIid + offset, defId });
  });
  return cards;
}

export function createGame(options: CreateGameOptions): GameState {
  const playerCount = options.playerCount;
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(
      `createGame: playerCount must be an integer between ${MIN_PLAYERS} and ${MAX_PLAYERS}`,
    );
  }
  if (!Number.isFinite(options.seed)) {
    throw new Error('createGame: seed must be a finite number');
  }

  const seed = options.seed >>> 0;
  let rng = seed;

  const rotation = randomInt(rng, 6);
  rng = rotation.state;
  const mirror = randomInt(rng, 2);
  rng = mirror.state;
  const board = buildBoard({ rotation: rotation.value, mirror: mirror.value });

  let nextCardIid = 0;
  const players: PlayerState[] = [];
  for (let seat = 0; seat < playerCount; seat += 1) {
    const cards = startingCardInstances(nextCardIid);
    nextCardIid += cards.length;
    const shuffled = shuffleWithRng(cards, rng);
    rng = shuffled.state;
    const deck = shuffled.items;
    const isBot = options.bots?.[seat] ?? false;
    const difficulty = options.difficulties?.[seat] ?? (isBot ? 'normal' : null);
    players.push({
      seat,
      name: options.names?.[seat] ?? `Player ${seat + 1}`,
      isBot,
      botDifficulty: difficulty,
      resources: emptyResources(),
      renown: 0,
      vp: 0,
      vpBreakdown: {
        settlements: 0,
        cities: 0,
        charters: 0,
        longestRoad: 0,
        largestExpedition: 0,
        total: 0,
      },
      charters: {},
      deck,
      // Hands stay empty through the draft; each player draws 5 when setup
      // ends, exactly as the design's setup step 7 describes.
      hand: [],
      discard: [],
      played: [],
      purchases: 0,
    });
  }

  const market: Record<string, number> = {};
  for (const card of PURCHASABLE_CARDS) market[card.id] = card.copies;

  const order = setupOrder(playerCount);
  const discardRequired: Record<Seat, number> = {};
  const longestRoadLength: Record<Seat, number> = {};
  for (let seat = 0; seat < playerCount; seat += 1) {
    discardRequired[seat] = 0;
    longestRoadLength[seat] = 0;
  }

  const state: GameState = {
    gameId: `lorac-${seed}-${playerCount}`,
    version: 0,
    config: { playerCount, targetVp: targetVpFor(playerCount), seed },
    rng,
    phase: 'setup',
    turn: 0,
    currentSeat: order[0] ?? 0,
    setup: { order, index: 0, step: 'settlement', pendingVertex: null },
    board,
    buildings: {},
    roads: {},
    robberHex: DESERT_HEX_ID,
    players,
    market,
    dice: null,
    discardQueue: [],
    discardRequired,
    tradeOffer: null,
    awards: { longestRoad: null, largestExpedition: null, longestRoadLength },
    log: [],
    nextLogId: 0,
    nextCardIid,
    turnFlags: { rolled: false, purchased: false },
    winner: null,
  };

  addLog(
    state,
    'setup',
    `New game: ${playerCount} players, first to ${state.config.targetVp} victory points.`,
    null,
    { playerCount, targetVp: state.config.targetVp, seed },
  );
  refreshDerived(state);
  return state;
}

function cloneCardList(cards: readonly CardInstance[]): CardInstance[] {
  return cards.map((card) => ({ iid: card.iid, defId: card.defId }));
}

/** Deep copy of everything mutable. The board is immutable and shared. */
export function cloneState(state: GameState): GameState {
  const buildings: Record<string, Building> = {};
  for (const [vertexId, building] of Object.entries(state.buildings)) {
    buildings[vertexId] = { owner: building.owner, type: building.type };
  }

  const gains: Record<Seat, Partial<ResourceMap>> = {};
  const blockedByRobber = state.dice ? state.dice.blockedByRobber.slice() : [];
  if (state.dice) {
    for (const [seat, gain] of Object.entries(state.dice.gains)) {
      gains[Number(seat)] = { ...gain };
    }
  }

  return {
    gameId: state.gameId,
    version: state.version,
    config: { ...state.config },
    rng: state.rng,
    phase: state.phase,
    turn: state.turn,
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
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty,
      resources: { ...player.resources },
      renown: player.renown,
      vp: player.vp,
      vpBreakdown: { ...player.vpBreakdown },
      charters: { ...player.charters },
      deck: cloneCardList(player.deck),
      hand: cloneCardList(player.hand),
      discard: cloneCardList(player.discard),
      played: cloneCardList(player.played),
      purchases: player.purchases,
    })),
    market: { ...state.market },
    dice: state.dice
      ? {
          die1: state.dice.die1,
          die2: state.dice.die2,
          total: state.dice.total,
          gains,
          blockedByRobber,
        }
      : null,
    discardQueue: state.discardQueue.slice(),
    discardRequired: { ...state.discardRequired },
    tradeOffer: state.tradeOffer
      ? {
          id: state.tradeOffer.id,
          from: state.tradeOffer.from,
          give: { ...state.tradeOffer.give },
          want: { ...state.tradeOffer.want },
          to: state.tradeOffer.to.slice(),
          createdTurn: state.tradeOffer.createdTurn,
        }
      : null,
    awards: {
      longestRoad: state.awards.longestRoad,
      largestExpedition: state.awards.largestExpedition,
      longestRoadLength: { ...state.awards.longestRoadLength },
    },
    log: state.log.map((entry) => ({
      ...entry,
      ...(entry.data ? { data: JSON.parse(JSON.stringify(entry.data)) as Record<string, unknown> } : {}),
    })),
    nextLogId: state.nextLogId,
    nextCardIid: state.nextCardIid,
    turnFlags: { ...state.turnFlags },
    winner: state.winner,
  };
}

/** Card definition lookup that never throws for bad ids coming off the wire. */
export function findCard(defId: string): ReturnType<typeof getCard> | null {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}

/**
 * Draw cards for one player. Reshuffles the discard pile when the deck runs
 * dry; if both are empty the draw stops. Returns how many cards were drawn.
 */
export function drawCards(draft: GameState, player: PlayerState, count: number): number {
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) break;
      const shuffled = shuffleWithRng(player.discard, draft.rng);
      draft.rng = shuffled.state;
      player.deck = shuffled.items;
      player.discard = [];
    }
    const card = player.deck.shift();
    if (!card) break;
    player.hand.push(card);
    drawn += 1;
  }
  return drawn;
}

/**
 * Move the robber and optionally steal one random resource. Callers validate
 * the hex and the victim first; this only applies the effect.
 */
export function performRobberMove(
  draft: GameState,
  seat: Seat,
  hex: HexId,
  victimSeat?: Seat,
): void {
  draft.robberHex = hex;
  addLog(draft, 'robber', `${playerName(draft, seat)} moves the robber to ${hex}.`, seat, { hex });

  if (victimSeat === undefined) return;
  const victim = draft.players[victimSeat];
  if (!victim) return;
  const total = countResources(victim.resources);
  if (total <= 0) return;

  const roll = randomInt(draft.rng, total);
  draft.rng = roll.state;
  let index = roll.value;
  for (const resource of RESOURCES) {
    const held = victim.resources[resource];
    if (index < held) {
      victim.resources[resource] = held - 1;
      const roller = draft.players[seat];
      if (roller) roller.resources[resource] += 1;
      addLog(
        draft,
        'steal',
        `${playerName(draft, seat)} steals 1 ${resource} from ${victim.name}.`,
        seat,
        { from: victimSeat, to: seat, resource },
      );
      return;
    }
    index -= held;
  }
}
