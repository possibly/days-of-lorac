/**
 * Shared contracts for Days of Lorac.
 *
 * Everything in `src/shared` must stay pure: no DOM, no node: imports, no
 * process, no dates, no Math.random. The server, the client, and the balance
 * simulator all import these types.
 *
 * The engine owns the rules. Types here are the wire between engine, server,
 * bots, and UI. Do not add a second source of truth.
 */

export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type ResourceMap = Record<Resource, number>;
export type PartialResources = Partial<Record<Resource, number>>;

export type Terrain = Resource | 'desert';
export type Seat = number;
export type HexId = string;
export type VertexId = string;
export type EdgeId = string;

export type GamePhase = 'setup' | 'roll' | 'discard' | 'robber' | 'action' | 'gameOver';
export type BotDifficulty = 'easy' | 'normal' | 'hard';
export type BuildingType = 'settlement' | 'city';

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface Hex {
  id: HexId;
  q: number;
  r: number;
  /** Centre in board units. The client scales these into its SVG viewBox. */
  x: number;
  y: number;
  terrain: Terrain;
  /** 2-12, never 7. Null on the desert. */
  token: number | null;
  vertices: VertexId[];
  edges: EdgeId[];
  neighbors: HexId[];
}

export interface Vertex {
  id: VertexId;
  x: number;
  y: number;
  hexes: HexId[];
  edges: EdgeId[];
}

export interface Edge {
  id: EdgeId;
  a: VertexId;
  b: VertexId;
  /** One hex on a coastal edge, two on an interior edge. */
  hexes: HexId[];
  coastal: boolean;
}

export interface Port {
  id: string;
  resource: Resource | 'generic';
  rate: 2 | 3;
  edge: EdgeId;
  vertices: [VertexId, VertexId];
  /** Midpoint, pushed seaward, for label placement. */
  x: number;
  y: number;
}

export interface Board {
  hexes: Hex[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
}

export interface Building {
  owner: Seat;
  type: BuildingType;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface CardInstance {
  /** Unique within one game. Never reused. */
  iid: number;
  defId: string;
}

export type CardKind = 'starting' | 'market' | 'charter';
export type CardTag =
  | 'economy'
  | 'cycling'
  | 'board'
  | 'renown'
  | 'disruption'
  | 'scoring'
  | 'flexibility';

export type CardChoiceKind = 'resources' | 'road' | 'settlement' | 'robber';

/**
 * Effects resolve strictly left to right. A `freeRoad` or `freeSettlement`
 * effect consumes the card's single choice and runs its fallback when no legal
 * target exists. Later effects still run.
 */
export type CardEffect =
  | { kind: 'gain'; resources: PartialResources }
  | { kind: 'draw'; count: number }
  | { kind: 'renown'; amount: number }
  | { kind: 'chooseResources'; count: number }
  | { kind: 'freeRoad'; fallback: PartialResources }
  | { kind: 'freeSettlement'; fallback: PartialResources }
  | { kind: 'optionalRobber' };

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  /** Null for starting cards. Charters are multisets, piles are single-type. */
  cost: PartialResources | null;
  /** Printed copies in the market. Starting cards use their deck count. */
  copies: number;
  text: string;
  flavor?: string;
  vp?: number;
  renown?: number;
  /** The one input the card may need. */
  choice?: CardChoiceKind | null;
  /** Wrecker's Lamp can be played with no robber move. */
  choiceOptional?: boolean;
  tags: CardTag[];
  effects: CardEffect[];
}

// ---------------------------------------------------------------------------
// Randomness and game state
// ---------------------------------------------------------------------------

export interface DiceRoll {
  die1: number;
  die2: number;
  total: number;
  gains: Record<Seat, PartialResources>;
  /** Hexes that would have produced but the robber blocked them. */
  blockedByRobber: HexId[];
}

export interface VpBreakdown {
  settlements: number;
  cities: number;
  charters: number;
  longestRoad: number;
  largestExpedition: number;
  total: number;
}

export interface PlayerState {
  seat: Seat;
  name: string;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  resources: ResourceMap;
  renown: number;
  vp: number;
  vpBreakdown: VpBreakdown;
  /** defId -> owned count for charter cards. Public. */
  charters: Record<string, number>;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  /** Cards played this turn. Public until the turn ends. */
  played: CardInstance[];
  /** Purchases made over the whole game, for stats and bots. */
  purchases: number;
}

export interface SetupState {
  /** 2n entries: settlement, road, settlement, road... snake order. */
  order: Seat[];
  index: number;
  step: 'settlement' | 'road';
  /** Set after a setup settlement, consumed by its road. */
  pendingVertex: VertexId | null;
}

export interface TradeOffer {
  id: string;
  from: Seat;
  give: PartialResources;
  want: PartialResources;
  /** Empty array means everyone except the offerer. */
  to: Seat[];
  createdTurn: number;
}

export interface Awards {
  longestRoad: Seat | null;
  largestExpedition: Seat | null;
  /** Continuous road length per player. Public and used by the UI. */
  longestRoadLength: Record<Seat, number>;
}

export type LogKind =
  | 'setup'
  | 'turn'
  | 'roll'
  | 'production'
  | 'seven'
  | 'discard'
  | 'robber'
  | 'steal'
  | 'card'
  | 'build'
  | 'trade'
  | 'buy'
  | 'award'
  | 'win'
  | 'info';

export interface LogEntry {
  id: number;
  turn: number;
  /** Null for system entries. */
  seat: Seat | null;
  kind: LogKind;
  text: string;
  /** Small structured payload for UI animations. Keep it public-safe. */
  data?: Record<string, unknown>;
}

export interface GameConfig {
  playerCount: number;
  targetVp: number;
  seed: number;
}

export interface TurnFlags {
  rolled: boolean;
  /** One purchase per turn, across every pile. */
  purchased: boolean;
}

export interface GameState {
  gameId: string;
  /** Increments on every accepted action. */
  version: number;
  config: GameConfig;
  /** 32-bit PRNG state. Only the engine advances it. */
  rng: number;
  phase: GamePhase;
  /** 1-based. Setup entries log as turn 0. */
  turn: number;
  currentSeat: Seat;
  setup: SetupState | null;
  board: Board;
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Seat>;
  robberHex: HexId;
  players: PlayerState[];
  /** defId -> remaining copies. Charters live here too. */
  market: Record<string, number>;
  dice: DiceRoll | null;
  /** Players who still owe a discard after a 7. Empty outside that step. */
  discardQueue: Seat[];
  discardRequired: Record<Seat, number>;
  tradeOffer: TradeOffer | null;
  awards: Awards;
  log: LogEntry[];
  nextLogId: number;
  nextCardIid: number;
  turnFlags: TurnFlags;
  winner: Seat | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface RobberMove {
  hex: HexId;
  victimSeat?: Seat;
}

export type PlayChoice =
  | { kind: 'resources'; resources: [Resource, Resource] }
  | { kind: 'road'; edge: EdgeId }
  | { kind: 'settlement'; vertex: VertexId }
  | { kind: 'robber'; move?: RobberMove };

export type GameAction =
  | { type: 'setupSettlement'; vertex: VertexId }
  | { type: 'setupRoad'; edge: EdgeId }
  | { type: 'roll' }
  | { type: 'discard'; resources: PartialResources }
  | { type: 'moveRobber'; hex: HexId; victimSeat?: Seat }
  | { type: 'playCard'; iid: number; choice?: PlayChoice }
  | { type: 'buildRoad'; edge: EdgeId }
  | { type: 'buildSettlement'; vertex: VertexId }
  | { type: 'buildCity'; vertex: VertexId }
  | { type: 'bankTrade'; give: Resource; receive: Resource; count: number }
  | { type: 'offerTrade'; give: PartialResources; want: PartialResources; to: 'all' | Seat[] }
  | { type: 'respondTrade'; offerId: string; accept: boolean }
  | { type: 'cancelTrade' }
  | { type: 'buyCard'; defId: string }
  | { type: 'endTurn' };

export type GameActionType = GameAction['type'];

export type ActionErrorCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'GAME_OVER'
  | 'INVALID_ACTION'
  | 'INVALID_PLACEMENT'
  | 'NOT_CONNECTED'
  | 'OCCUPIED'
  | 'TOO_CLOSE'
  | 'CANNOT_AFFORD'
  | 'PILE_EMPTY'
  | 'PURCHASE_LIMIT'
  | 'NO_CARD'
  | 'CARD_NOT_PLAYABLE'
  | 'CHOICE_REQUIRED'
  | 'INVALID_CHOICE'
  | 'ROBBER_SAME_HEX'
  | 'INVALID_ROBBER_HEX'
  | 'INVALID_VICTIM'
  | 'DISCARD_NOT_REQUIRED'
  | 'INVALID_DISCARD'
  | 'TRADE_EXISTS'
  | 'NO_TRADE'
  | 'TRADE_STALE'
  | 'NOT_RECIPIENT'
  | 'INVALID_TRADE'
  | 'SETUP_COMPLETE'
  | 'SEAT_INVALID'
  | 'INTERNAL';

export interface ActionOk {
  ok: true;
  state: GameState;
}

export interface ActionError {
  ok: false;
  code: ActionErrorCode;
  message: string;
}

export type ActionResult = ActionOk | ActionError;

// ---------------------------------------------------------------------------
// Legal moves and views
// ---------------------------------------------------------------------------

export interface BankTradeOption {
  give: Resource;
  receive: Resource;
  /** Best legal rate for this give resource. */
  count: number;
}

export interface PlayableCard {
  iid: number;
  defId: string;
  choice: CardChoiceKind | null;
  choiceOptional: boolean;
  roadOptions?: EdgeId[];
  settlementOptions?: VertexId[];
  robberHexes?: HexId[];
  robberVictims?: Record<HexId, Seat[]>;
}

export interface LegalMoves {
  seat: Seat;
  isTurn: boolean;
  phase: GamePhase;
  canRoll: boolean;
  canEndTurn: boolean;
  setupSettlements: VertexId[];
  setupRoads: EdgeId[];
  /** Set when this viewer owes a discard, even if it is not their turn. */
  discard: { required: number } | null;
  /** Set for the player who must move the robber. */
  robber: { hexes: HexId[]; victims: Record<HexId, Seat[]> } | null;
  playable: PlayableCard[];
  build: {
    roads: EdgeId[];
    settlements: VertexId[];
    cities: VertexId[];
    affordable: { road: boolean; settlement: boolean; city: boolean };
  };
  bankTrades: BankTradeOption[];
  buyable: string[];
  canOfferTrade: boolean;
  canRespondToTrade: boolean;
  canCancelTrade: boolean;
}

export interface PlayerView {
  seat: Seat;
  name: string;
  isBot: boolean;
  connected: boolean;
  resources: ResourceMap;
  renown: number;
  vp: number;
  vpBreakdown: VpBreakdown;
  charters: Record<string, number>;
  /** Only the viewer's own hand. Null for everyone else. */
  hand: CardInstance[] | null;
  handCount: number;
  deckCount: number;
  discardCount: number;
  playedCount: number;
  played: CardInstance[];
  purchases: number;
}

export interface GameView {
  gameId: string;
  version: number;
  you: Seat;
  config: GameConfig;
  targetVp: number;
  phase: GamePhase;
  turn: number;
  currentSeat: Seat;
  setup: SetupState | null;
  board: Board;
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Seat>;
  robberHex: HexId;
  players: PlayerView[];
  market: Record<string, number>;
  dice: DiceRoll | null;
  discardQueue: Seat[];
  discardRequired: Record<Seat, number>;
  tradeOffer: TradeOffer | null;
  awards: Awards;
  log: LogEntry[];
  winner: Seat | null;
  legal: LegalMoves;
}

// ---------------------------------------------------------------------------
// Engine API (implemented in src/shared/engine)
// ---------------------------------------------------------------------------

export interface CreateGameOptions {
  playerCount: number;
  seed: number;
  names?: string[];
  bots?: boolean[];
  difficulties?: (BotDifficulty | null)[];
}

export interface EngineApi {
  createGame(options: CreateGameOptions): GameState;
  applyAction(state: GameState, seat: Seat, action: GameAction): ActionResult;
  legalMoves(state: GameState, seat: Seat): LegalMoves;
  viewFor(
    state: GameState,
    seat: Seat,
    connected?: Partial<Record<Seat, boolean>>,
  ): GameView;
}
