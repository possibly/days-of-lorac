/**
 * Board and economy reading for the bot.
 *
 * `Sense` is a read-only lens over one `GameView`. It never touches hidden
 * state: the view has no deck order, no discard contents and no other player's
 * hand, and nothing here asks for them.
 *
 * Units, used across the whole policy:
 *   - pips are dice ways out of 36, weighted by resource scarcity, so a 6 on
 *     ore is worth more than a 6 on sheep;
 *   - utility "points" put one victory point at `VP_POINTS` and one weighted
 *     pip at about one point, which is the exchange rate the build choice uses.
 */
import { boardIndex } from '../../shared/engine/board.js';
import type { BoardIndex } from '../../shared/engine/board.js';
import { BUILD_COSTS } from '../../shared/constants.js';
import { RESOURCES } from '../../shared/types.js';
import type {
  Building,
  Edge,
  EdgeId,
  GameView,
  Hex,
  HexId,
  LogEntry,
  PartialResources,
  PlayerView,
  Port,
  Resource,
  Seat,
  Vertex,
  VertexId,
} from '../../shared/types.js';

/** Ore and brick are scarce terrains and both build-critical. */
export const RESOURCE_WEIGHT: Record<Resource, number> = {
  wood: 1,
  brick: 1.08,
  sheep: 0.92,
  wheat: 1.06,
  ore: 1.18,
};

/** Ways to roll each total out of 36. Seven is never a token. */
const PIP_WAYS: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

/** One victory point, in the utility points the build and purchase choice use. */
export const VP_POINTS = 14;

/** Rough average resource value of one card in a working deck. */
export const AVG_CARD_VALUE = 1.3;

export function emptyMix(): Record<Resource, number> {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

export function totalOf(set: PartialResources): number {
  let total = 0;
  for (const resource of RESOURCES) total += set[resource] ?? 0;
  return total;
}

export function canPay(held: PartialResources, cost: PartialResources): boolean {
  for (const resource of RESOURCES) {
    if ((held[resource] ?? 0) < (cost[resource] ?? 0)) return false;
  }
  return true;
}

/** The bot's next intended purchase, used to value resources and discards. */
export interface BuildPlan {
  kind: 'settlement' | 'city';
  cost: PartialResources;
  /** Turns of income before the plan becomes payable, on a rough estimate. */
  etaTurns: number;
  /** True when the bot can pay right now. */
  affordable: boolean;
}

export class Sense {
  readonly view: GameView;
  readonly index: BoardIndex;
  readonly you: Seat;
  readonly me: PlayerView;
  readonly plan: BuildPlan;
  readonly production: Record<Resource, number>;
  private readonly sources = new Map<Resource, number>();
  private readonly prodCache = new Map<Seat, Record<Resource, number>>();

  constructor(view: GameView) {
    this.view = view;
    this.index = boardIndex(view.board);
    this.you = view.you;
    const me = view.players.find((player) => player.seat === view.you);
    if (!me) throw new Error(`bot: no player view for seat ${view.you}`);
    this.me = me;
    this.production = this.productionOf(view.you);
    this.plan = this.computePlan();
  }

  // -- board lookups -------------------------------------------------------

  hex(id: HexId): Hex | undefined {
    return this.index.hex.get(id);
  }

  vertex(id: VertexId): Vertex | undefined {
    return this.index.vertex.get(id);
  }

  edge(id: EdgeId): Edge | undefined {
    return this.index.edge.get(id);
  }

  buildingAt(id: VertexId): Building | undefined {
    return this.view.buildings[id];
  }

  roadOwner(id: EdgeId): Seat | undefined {
    return this.view.roads[id];
  }

  hexesOf(id: VertexId): Hex[] {
    const out: Hex[] = [];
    for (const hexId of this.index.hexesByVertex.get(id) ?? []) {
      const hex = this.index.hex.get(hexId);
      if (hex) out.push(hex);
    }
    return out;
  }

  /** Ways to roll this hex's token, 0 for the desert. */
  hexPips(hex: Hex): number {
    if (hex.terrain === 'desert' || hex.token === null) return 0;
    return PIP_WAYS[hex.token] ?? 0;
  }

  /** Scarcity-weighted pips by resource for one vertex. */
  vertexMix(id: VertexId): Record<Resource, number> {
    const mix = emptyMix();
    for (const hex of this.hexesOf(id)) {
      if (hex.terrain === 'desert') continue;
      const resource = hex.terrain;
      mix[resource] += this.hexPips(hex) * RESOURCE_WEIGHT[resource];
    }
    return mix;
  }

  /** Total scarcity-weighted pips on one vertex. */
  vertexPips(id: VertexId): number {
    let total = 0;
    for (const hex of this.hexesOf(id)) {
      if (hex.terrain === 'desert') continue;
      total += this.hexPips(hex) * RESOURCE_WEIGHT[hex.terrain];
    }
    return total;
  }

  vertexDiversity(id: VertexId): number {
    let count = 0;
    for (const hex of this.hexesOf(id)) {
      if (hex.terrain !== 'desert' && this.hexPips(hex) > 0) count += 1;
    }
    return count;
  }

  portsAt(id: VertexId): Port[] {
    return this.index.portsByVertex.get(id) ?? [];
  }

  /** No building here and none on an adjacent vertex. */
  vertexOpen(id: VertexId): boolean {
    if (this.view.buildings[id]) return false;
    for (const neighbor of this.index.vertexNeighbors.get(id) ?? []) {
      if (this.view.buildings[neighbor]) return false;
    }
    return true;
  }

  // -- players -------------------------------------------------------------

  player(seat: Seat): PlayerView | undefined {
    return this.view.players.find((player) => player.seat === seat);
  }

  /** Expected resources per roll from buildings, weighted by scarcity. */
  productionOf(seat: Seat): Record<Resource, number> {
    const cached = this.prodCache.get(seat);
    if (cached) return cached;
    const out = emptyMix();
    const sourceCount = new Map<Resource, number>();
    for (const [vertexId, building] of Object.entries(this.view.buildings)) {
      if (building.owner !== seat) continue;
      const multiplier = building.type === 'city' ? 2 : 1;
      for (const hex of this.hexesOf(vertexId)) {
        if (hex.terrain === 'desert') continue;
        const pips = this.hexPips(hex);
        if (pips <= 0) continue;
        out[hex.terrain] += (pips / 36) * multiplier * RESOURCE_WEIGHT[hex.terrain];
        sourceCount.set(hex.terrain, (sourceCount.get(hex.terrain) ?? 0) + 1);
      }
    }
    this.prodCache.set(seat, out);
    if (seat === this.you) {
      for (const [resource, count] of sourceCount) this.sources.set(resource, count);
    }
    return out;
  }

  /** How many of this seat's building-hexes produce the resource. */
  sourceCount(resource: Resource): number {
    if (this.sources.size === 0) this.productionOf(this.you);
    return this.sources.get(resource) ?? 0;
  }

  myBuildings(): Array<{ vertex: VertexId; type: Building['type'] }> {
    const out: Array<{ vertex: VertexId; type: Building['type'] }> = [];
    for (const [vertexId, building] of Object.entries(this.view.buildings)) {
      if (building.owner === this.you) out.push({ vertex: vertexId, type: building.type });
    }
    return out;
  }

  countBuildings(type: Building['type']): number {
    let count = 0;
    for (const building of Object.values(this.view.buildings)) {
      if (building.owner === this.you && building.type === type) count += 1;
    }
    return count;
  }

  /** Resource types the bot already produces somewhere on the board. */
  coveredResources(): Record<Resource, boolean> {
    const covered: Record<Resource, boolean> = {
      wood: false,
      brick: false,
      sheep: false,
      wheat: false,
      ore: false,
    };
    for (const { vertex } of this.myBuildings()) {
      for (const hex of this.hexesOf(vertex)) {
        if (hex.terrain !== 'desert' && this.hexPips(hex) > 0) covered[hex.terrain] = true;
      }
    }
    return covered;
  }

  /** Seats ranked by standing: VP first, then production, then seat order. */
  standings(): Seat[] {
    const seats = this.view.players.map((player) => player.seat);
    const pips = new Map<Seat, number>();
    for (const seat of seats) {
      let total = 0;
      for (const { vertex } of this.myBuildingsOf(seat)) total += this.vertexPips(vertex);
      pips.set(seat, total);
    }
    return seats.sort((a, b) => {
      const va = this.player(a)?.vp ?? 0;
      const vb = this.player(b)?.vp ?? 0;
      if (va !== vb) return vb - va;
      const pa = pips.get(a) ?? 0;
      const pb = pips.get(b) ?? 0;
      if (pa !== pb) return pb - pa;
      return a - b;
    });
  }

  /** Every building of one seat, including opponents. */
  myBuildingsOf(seat: Seat): Array<{ vertex: VertexId; type: Building['type'] }> {
    const out: Array<{ vertex: VertexId; type: Building['type'] }> = [];
    for (const [vertexId, building] of Object.entries(this.view.buildings)) {
      if (building.owner === seat) out.push({ vertex: vertexId, type: building.type });
    }
    return out;
  }

  leader(): Seat {
    const ranked = this.standings();
    return ranked[0] ?? this.you;
  }

  /** Seats other than the bot, strongest first. */
  rivals(): Seat[] {
    return this.standings().filter((seat) => seat !== this.you);
  }

  isLeaderAhead(): boolean {
    const ranked = this.standings();
    return (ranked[0] ?? this.you) !== this.you;
  }

  vpTarget(): number {
    return this.view.targetVp;
  }

  /** The round number, counting a full circle of players as one. */
  round(): number {
    const count = Math.max(1, this.view.players.length);
    return Math.max(1, Math.ceil(Math.max(1, this.view.turn) / count));
  }

  /** Total cards the bot owns, the n in the deck-economy formula. */
  deckSize(): number {
    return this.me.handCount + this.me.deckCount + this.me.discardCount + this.me.playedCount;
  }

  // -- per-turn bookkeeping from the public log ---------------------------

  countThisTurn(predicate: (entry: LogEntry) => boolean): number {
    let count = 0;
    for (const entry of this.view.log) {
      if (entry.turn !== this.view.turn || entry.seat !== this.you) continue;
      if (predicate(entry)) count += 1;
    }
    return count;
  }

  bankTradesThisTurn(): number {
    return this.countThisTurn((entry) => entry.kind === 'trade' && entry.data?.['bank'] === true);
  }

  offersThisTurn(): number {
    return this.countThisTurn(
      (entry) =>
        entry.kind === 'trade' &&
        entry.data?.['give'] !== undefined &&
        entry.data?.['want'] !== undefined,
    );
  }

  // -- plan and resource value -------------------------------------------

  private computePlan(): BuildPlan {
    const settlements = this.countBuildings('settlement');
    const cities = this.countBuildings('city');
    // Settle while the map still has room, then convert the settlements into
    // cities. That is the order the design's own economy check assumes.
    const wantCity = settlements >= 5 || (settlements >= 4 && cities >= 2);
    const kind: BuildPlan['kind'] = wantCity ? 'city' : 'settlement';
    const cost = kind === 'city' ? BUILD_COSTS.city : BUILD_COSTS.settlement;
    const etaTurns = this.turnsToAfford(cost);
    return { kind, cost, etaTurns, affordable: canPay(this.me.resources, cost) };
  }

  /** Per-turn income estimate for one resource: deck plus buildings. */
  incomePerTurn(resource: Resource): number {
    // Five cards a turn from a deck that started at two of each resource, and
    // a board that produces `production` weighted pips per roll.
    return 1 + this.production[resource];
  }

  /** Rough number of this seat's turns before it can pay a cost. */
  turnsToAfford(cost: PartialResources): number {
    return this.turnsToAffordWith(this.me.resources, cost);
  }

  /** Same, against a hypothetical holding after spending something. */
  turnsToAffordWith(held: PartialResources, cost: PartialResources): number {
    let worst = 0;
    for (const resource of RESOURCES) {
      const need = (cost[resource] ?? 0) - (held[resource] ?? 0);
      if (need <= 0) continue;
      const income = Math.max(0.25, this.incomePerTurn(resource));
      worst = Math.max(worst, need / income);
    }
    return worst;
  }

  /** How many of the bot's own turns are probably left. */
  turnsLeft(): number {
    const missing = Math.max(0, this.vpTarget() - this.me.vp);
    return Math.max(2, Math.round(missing * 1.6 + 1));
  }
}

/**
 * Value of the k-th unit of a resource (0-based) given the current plan.
 * Units inside the plan cost are protected; surplus decays; a resource the
 * bot's board does not produce is worth a little extra because it is the one
 * the deck has to carry.
 */
export function unitValue(
  plan: PartialResources,
  production: Record<Resource, number>,
  resource: Resource,
  index: number,
): number {
  const need = plan[resource] ?? 0;
  let value = RESOURCE_WEIGHT[resource];
  if (index < need) value += 1.7;
  else if (index >= need + 2) value -= 0.3 * (index - need - 1);
  if (production[resource] < 0.25) value += 0.5;
  else if (production[resource] > 1.2) value -= 0.3;
  return Math.max(0.15, value);
}

/** Marginal value of gaining `set` on top of current holdings. */
export function gainValue(
  held: PartialResources,
  set: PartialResources,
  plan: PartialResources,
  production: Record<Resource, number>,
): number {
  let total = 0;
  for (const resource of RESOURCES) {
    const count = set[resource] ?? 0;
    const start = held[resource] ?? 0;
    for (let i = 0; i < count; i += 1) total += unitValue(plan, production, resource, start + i);
  }
  return total;
}

/** Value of the units `set` would take off the top of current holdings. */
export function lossValue(
  held: PartialResources,
  set: PartialResources,
  plan: PartialResources,
  production: Record<Resource, number>,
): number {
  let total = 0;
  for (const resource of RESOURCES) {
    const count = Math.min(set[resource] ?? 0, held[resource] ?? 0);
    const start = (held[resource] ?? 0) - 1;
    for (let i = 0; i < count; i += 1) {
      total += unitValue(plan, production, resource, Math.max(0, start - i));
    }
  }
  return total;
}
