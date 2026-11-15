/**
 * Setup phase: a snake draft of settlement + road pairs, no resources, no
 * costs, and the distance rule still applies to the settlements.
 */
import { HAND_SIZE } from '../constants.js';
import { playerName, addLog } from './log.js';
import { boardIndex } from './board.js';
import { drawCards, failure } from './state.js';
import type { EngineFailure } from './state.js';
import type { EdgeId, GameState, Seat, VertexId } from '../types.js';

export function finishSetup(draft: GameState): void {
  const firstSeat = draft.setup?.order[0] ?? draft.firstSeat;
  draft.setup = null;
  draft.phase = 'roll';
  draft.turn = 1;
  draft.currentSeat = firstSeat;
  draft.dice = null;
  draft.turnFlags = { rolled: false, purchased: false };
  draft.discardQueue = [];
  // Setup is the moment the decks are dealt: shuffle already happened in
  // createGame, so this only draws 5 per player in seat order.
  for (const player of draft.players) {
    while (player.hand.length < HAND_SIZE) {
      if (drawCards(draft, player, 1) === 0) break;
    }
  }
  addLog(draft, 'turn', `Turn 1: ${playerName(draft, firstSeat)} to play.`, firstSeat, {
    turn: 1,
    seat: firstSeat,
  });
}

export function setupSettlement(
  draft: GameState,
  seat: Seat,
  vertex: VertexId,
): EngineFailure | null {
  const setup = draft.setup;
  if (!setup || draft.phase !== 'setup') return failure('SETUP_COMPLETE', 'Setup is over.');
  if (seat !== draft.currentSeat) return failure('NOT_YOUR_TURN', 'It is not your setup pick.');
  if (setup.step !== 'settlement') {
    return failure('WRONG_PHASE', 'A road pick is pending.');
  }

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
  const openEdge = (index.edgesByVertex.get(vertex) ?? []).some(
    (edge) => draft.roads[edge] === undefined,
  );
  if (!openEdge) {
    return failure('INVALID_PLACEMENT', 'That vertex has no open edge for its starting road.');
  }

  draft.buildings[vertex] = { owner: seat, type: 'settlement' };
  setup.step = 'road';
  setup.pendingVertex = vertex;
  addLog(
    draft,
    'setup',
    `${playerName(draft, seat)} places a starting settlement.`,
    seat,
    { step: 'settlement', vertex, index: setup.index },
  );
  return null;
}

export function setupRoad(draft: GameState, seat: Seat, edge: EdgeId): EngineFailure | null {
  const setup = draft.setup;
  if (!setup || draft.phase !== 'setup') return failure('SETUP_COMPLETE', 'Setup is over.');
  if (seat !== draft.currentSeat) return failure('NOT_YOUR_TURN', 'It is not your setup pick.');
  if (setup.step !== 'road') {
    return failure('WRONG_PHASE', 'A settlement pick is pending.');
  }

  const index = boardIndex(draft.board);
  const item = index.edge.get(edge);
  if (!item) return failure('INVALID_PLACEMENT', `There is no edge ${edge}.`);
  if (draft.roads[edge] !== undefined) {
    return failure('OCCUPIED', 'That edge already has a road.');
  }
  if (item.a !== setup.pendingVertex && item.b !== setup.pendingVertex) {
    return failure('NOT_CONNECTED', 'A starting road must touch the settlement just placed.');
  }

  draft.roads[edge] = seat;
  addLog(
    draft,
    'setup',
    `${playerName(draft, seat)} places a starting road.`,
    seat,
    { step: 'road', edge, index: setup.index },
  );

  setup.index += 1;
  setup.step = 'settlement';
  setup.pendingVertex = null;

  if (setup.index >= setup.order.length) {
    finishSetup(draft);
    return null;
  }

  draft.currentSeat = setup.order[setup.index] ?? 0;
  return null;
}
