/**
 * Longest-road search, awards, VP, and the single `refreshDerived` pass that
 * runs after every mutation.
 *
 * Rules (docs/GAME-DESIGN.md section 10):
 *   - longest road is the longest simple path over the player's own roads,
 *     blocked by opponent buildings, minimum 5;
 *   - largest expedition is the most renown, minimum 3;
 *   - ties favour the current holder; with no holder a tie at the top means
 *     nobody holds the award; a challenger needs strictly more.
 */
import { AWARD_BONUS, LARGEST_EXPEDITION_MIN, LONGEST_ROAD_MIN } from '../constants.js';
import { CARD_BY_ID } from '../cards.js';
import type { EdgeId, GameState, Seat, VpBreakdown, VertexId } from '../types.js';
import { addLog } from './log.js';

export function longestRoadLength(state: GameState, seat: Seat): number {
  const adjacency = new Map<VertexId, Array<{ to: VertexId; edge: EdgeId }>>();
  let ownedEdges = 0;

  for (const edge of state.board.edges) {
    if (state.roads[edge.id] !== seat) continue;
    ownedEdges += 1;
    const forward = adjacency.get(edge.a) ?? [];
    forward.push({ to: edge.b, edge: edge.id });
    adjacency.set(edge.a, forward);
    const backward = adjacency.get(edge.b) ?? [];
    backward.push({ to: edge.a, edge: edge.id });
    adjacency.set(edge.b, backward);
  }
  if (ownedEdges === 0) return 0;

  const blocked = new Set<VertexId>();
  for (const vertex of state.board.vertices) {
    const building = state.buildings[vertex.id];
    if (building && building.owner !== seat) blocked.add(vertex.id);
  }

  let best = 0;
  const visited = new Set<VertexId>();

  const search = (vertex: VertexId, length: number): void => {
    if (length > best) best = length;
    for (const link of adjacency.get(vertex) ?? []) {
      if (visited.has(link.to) || blocked.has(link.to)) continue;
      visited.add(link.to);
      search(link.to, length + 1);
      visited.delete(link.to);
    }
  };

  for (const [start] of adjacency) {
    if (blocked.has(start)) continue;
    visited.clear();
    visited.add(start);
    search(start, 0);
    // Cheap bound: the path cannot be longer than the edges we own.
    if (best >= ownedEdges) break;
  }

  return best;
}

function resolveAward(
  seats: readonly Seat[],
  values: Record<Seat, number>,
  previous: Seat | null,
  minValue: number,
): Seat | null {
  let best = -1;
  let leaders: Seat[] = [];
  for (const seat of seats) {
    const value = values[seat] ?? 0;
    if (value > best) {
      best = value;
      leaders = [seat];
    } else if (value === best) {
      leaders.push(seat);
    }
  }
  if (best < minValue) return null;
  if (previous !== null && leaders.includes(previous)) return previous;
  if (leaders.length === 1) return leaders[0] ?? null;
  return null;
}

export function computeVp(state: GameState, seat: Seat): VpBreakdown {
  let settlements = 0;
  let cities = 0;
  for (const building of Object.values(state.buildings)) {
    if (building.owner !== seat) continue;
    if (building.type === 'settlement') settlements += 1;
    else cities += 1;
  }

  const player = state.players[seat];
  let charters = 0;
  if (player) {
    for (const [defId, count] of Object.entries(player.charters)) {
      // Unknown ids cannot come from the engine; ignore rather than throw.
      charters += (CARD_BY_ID.get(defId)?.vp ?? 0) * count;
    }
  }

  const longestRoad = state.awards.longestRoad === seat ? AWARD_BONUS : 0;
  const largestExpedition = state.awards.largestExpedition === seat ? AWARD_BONUS : 0;

  return {
    settlements,
    cities: cities * 2,
    charters,
    longestRoad,
    largestExpedition,
    total: settlements + cities * 2 + charters + longestRoad + largestExpedition,
  };
}

export function scorePlayer(state: GameState, seat: Seat): VpBreakdown {
  return computeVp(state, seat);
}

function describeAwardChange(
  state: GameState,
  name: string,
  previous: Seat | null,
  next: Seat | null,
): void {
  if (previous === next) return;
  if (next !== null) {
    const holder = state.players[next]?.name ?? 'Someone';
    addLog(state, 'award', `${holder} takes ${name}.`, next, {
      award: name,
      holder: next,
      previous,
    });
  } else if (previous !== null) {
    const former = state.players[previous]?.name ?? 'Someone';
    addLog(state, 'award', `${former} loses ${name}.`, previous, {
      award: name,
      holder: null,
      previous,
    });
  }
}

/**
 * Recompute road lengths, awards, VP, and the winner. Idempotent: calling it
 * twice in one action changes nothing the first call did not already set.
 */
export function refreshDerived(draft: GameState): void {
  const seats = draft.players.map((player) => player.seat);

  const lengths: Record<Seat, number> = {};
  for (const seat of seats) lengths[seat] = longestRoadLength(draft, seat);
  draft.awards.longestRoadLength = lengths;

  const renown: Record<Seat, number> = {};
  for (const player of draft.players) renown[player.seat] = player.renown;

  const previousRoad = draft.awards.longestRoad;
  const previousExpedition = draft.awards.largestExpedition;

  draft.awards.longestRoad = resolveAward(seats, lengths, previousRoad, LONGEST_ROAD_MIN);
  draft.awards.largestExpedition = resolveAward(
    seats,
    renown,
    previousExpedition,
    LARGEST_EXPEDITION_MIN,
  );

  describeAwardChange(draft, 'Longest Trade Route', previousRoad, draft.awards.longestRoad);
  describeAwardChange(draft, 'Largest Expedition', previousExpedition, draft.awards.largestExpedition);

  for (const seat of seats) {
    const player = draft.players[seat];
    if (!player) continue;
    player.vpBreakdown = computeVp(draft, seat);
    player.vp = player.vpBreakdown.total;
  }

  if (draft.phase !== 'gameOver') {
    for (const seat of seats) {
      const player = draft.players[seat];
      if (!player) continue;
      if (player.vp >= draft.config.targetVp) {
        draft.winner = seat;
        draft.phase = 'gameOver';
        addLog(draft, 'win', `${player.name} wins with ${player.vp} victory points.`, seat, {
          vp: player.vp,
          target: draft.config.targetVp,
        });
        break;
      }
    }
  }
}
