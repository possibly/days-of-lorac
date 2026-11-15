/**
 * Test helpers. Everything here drives the real engine: `createGame`,
 * `applyAction`, `legalMoves`, `refreshDerived`. Scenarios that need a
 * particular board or hand patch a cloned state and then recompute derived
 * values, which is the same path a real mutation takes.
 */
import { emptyResources } from '../../constants.js';
import type {
  ActionError,
  BuildingType,
  EdgeId,
  GameAction,
  GameState,
  Resource,
  Seat,
  VertexId,
} from '../../types.js';
import { applyAction, cloneState, createGame, legalMoves, refreshDerived } from '../index.js';
import { boardIndex } from '../board.js';
import { nextRandom } from '../rng.js';

export function newGame(playerCount = 4, seed = 1): GameState {
  return createGame({ playerCount, seed });
}

export function act(state: GameState, seat: Seat, action: GameAction): GameState {
  const result = applyAction(state, seat, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.code} - ${result.message}`);
  }
  return result.state;
}

export function reject(state: GameState, seat: Seat, action: GameAction): ActionError {
  const result = applyAction(state, seat, action);
  if (result.ok) throw new Error(`${action.type} was accepted but should have been rejected`);
  return result;
}

/** Drives the whole snake draft with legal moves only. */
export function finishSetup(
  state: GameState,
  chooser: (options: string[], kind: 'settlement' | 'road') => string = (options) => options[0] ?? '',
): GameState {
  let current = state;
  let guard = 0;
  while (current.phase === 'setup') {
    const seat = current.currentSeat;
    const legal = legalMoves(current, seat);
    if (legal.setupSettlements.length > 0) {
      const vertex = chooser(legal.setupSettlements, 'settlement');
      current = act(current, seat, { type: 'setupSettlement', vertex });
    } else if (legal.setupRoads.length > 0) {
      const edge = chooser(legal.setupRoads, 'road');
      current = act(current, seat, { type: 'setupRoad', edge });
    } else {
      throw new Error(`setup stuck for seat ${seat} in phase ${current.phase}`);
    }
    guard += 1;
    if (guard > 64) throw new Error('setup did not finish');
  }
  return current;
}

export function patch(state: GameState, mutate: (draft: GameState) => void): GameState {
  const draft = cloneState(state);
  mutate(draft);
  refreshDerived(draft);
  return draft;
}

export function setResources(
  state: GameState,
  seat: Seat,
  resources: Partial<Record<Resource, number>>,
): GameState {
  return patch(state, (draft) => {
    const player = draft.players[seat];
    if (!player) throw new Error(`no seat ${seat}`);
    player.resources = { ...emptyResources(), ...resources };
  });
}

export function setHand(state: GameState, seat: Seat, defIds: string[]): GameState {
  return patch(state, (draft) => {
    const player = draft.players[seat];
    if (!player) throw new Error(`no seat ${seat}`);
    player.hand = defIds.map((defId, offset) => ({ iid: 900000 + offset, defId }));
    draft.nextCardIid = Math.max(draft.nextCardIid, 900000 + defIds.length);
  });
}

export function placeBuilding(
  state: GameState,
  seat: Seat,
  vertex: VertexId,
  type: BuildingType = 'settlement',
): GameState {
  return patch(state, (draft) => {
    draft.buildings[vertex] = { owner: seat, type };
  });
}

export function placeRoad(state: GameState, seat: Seat, edge: EdgeId): GameState {
  return patch(state, (draft) => {
    draft.roads[edge] = seat;
  });
}

/** A seed whose next two die draws total `total`. */
export function findRollSeed(total: number, start = 1): number {
  for (let seed = start; seed < 500000; seed += 1) {
    const first = nextRandom(seed);
    const second = nextRandom(first.state);
    const value = 1 + Math.floor(first.value * 6) + 1 + Math.floor(second.value * 6);
    if (value === total) return seed;
  }
  throw new Error(`no seed found for roll ${total}`);
}

/** Forces the next roll to a known total. */
export function setNextRoll(state: GameState, total: number): GameState {
  return patch(state, (draft) => {
    draft.rng = findRollSeed(total);
  });
}

/** Setup finished + one roll, so the current player is in the action phase. */
export function actionPhase(state: GameState, roll = 8): GameState {
  const rolled = act(setNextRoll(state, roll), state.currentSeat, { type: 'roll' });
  if (rolled.phase !== 'action') {
    throw new Error(`roll ${roll} did not reach the action phase (phase ${rolled.phase})`);
  }
  return rolled;
}

export function setupGame(playerCount = 4, seed = 1): GameState {
  return finishSetup(newGame(playerCount, seed));
}

export function actionGame(playerCount = 4, seed = 1, roll = 8): GameState {
  return actionPhase(setupGame(playerCount, seed), roll);
}

/**
 * Adds two of the seat's roads reaching out from one of its buildings and
 * returns the now-legal settlement vertex at the far end. The distance rule
 * means a settlement always needs that two-edge reach.
 */
export function extendToSettlement(
  state: GameState,
  seat: Seat,
): { state: GameState; vertex: VertexId } {
  const index = boardIndex(state.board);
  for (const [vertexId, building] of Object.entries(state.buildings)) {
    if (building.owner !== seat) continue;
    for (const firstId of index.edgesByVertex.get(vertexId) ?? []) {
      if (state.roads[firstId] !== undefined) continue;
      const first = index.edge.get(firstId);
      if (!first) continue;
      const middle = first.a === vertexId ? first.b : first.a;
      for (const secondId of index.edgesByVertex.get(middle) ?? []) {
        if (secondId === firstId || state.roads[secondId] !== undefined) continue;
        const second = index.edge.get(secondId);
        if (!second) continue;
        const far = second.a === middle ? second.b : second.a;
        if (state.buildings[far]) continue;
        const adjacentBuilding = (index.vertexNeighbors.get(far) ?? []).some(
          (neighbour) => state.buildings[neighbour] !== undefined,
        );
        if (adjacentBuilding) continue;
        const next = patch(state, (draft) => {
          draft.roads[firstId] = seat;
          draft.roads[secondId] = seat;
        });
        return { state: next, vertex: far };
      }
    }
  }
  throw new Error(`no two-edge settlement extension for seat ${seat}`);
}

export interface PathChoice {
  edges: EdgeId[];
  vertices: VertexId[];
}

/** Deterministically finds a simple path of `length` edges on the board. */
export function simplePath(
  state: GameState,
  length: number,
  avoid?: { vertices?: Set<VertexId>; edges?: Set<EdgeId> },
): PathChoice {
  const index = boardIndex(state.board);
  const vertices = state.board.vertices
    .map((vertex) => vertex.id)
    .filter((vertex) => !avoid?.vertices?.has(vertex))
    .sort();
  const visited = new Set<VertexId>();

  const walk = (vertex: VertexId, edges: EdgeId[], path: VertexId[]): PathChoice | null => {
    if (edges.length === length) return { edges: edges.slice(), vertices: path.slice() };
    for (const edgeId of index.edgesByVertex.get(vertex) ?? []) {
      if (avoid?.edges?.has(edgeId)) continue;
      const edge = index.edge.get(edgeId);
      if (!edge) continue;
      const next = edge.a === vertex ? edge.b : edge.a;
      if (visited.has(next)) continue;
      if (avoid?.vertices?.has(next)) continue;
      visited.add(next);
      edges.push(edgeId);
      path.push(next);
      const found = walk(next, edges, path);
      if (found) return found;
      path.pop();
      edges.pop();
      visited.delete(next);
    }
    return null;
  };

  for (const start of vertices) {
    visited.clear();
    visited.add(start);
    const found = walk(start, [], [start]);
    if (found) return found;
  }
  throw new Error(`no simple path of ${length} edges`);
}
