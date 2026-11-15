import { describe, expect, it } from 'vitest';
import type { EdgeId, GameState, VertexId } from '../../types.js';
import { applyAction, longestRoadLength, scorePlayer } from '../index.js';
import { patch, reject, simplePath, setupGame } from './helpers.js';

/**
 * Puts a whole path of roads on the board for one seat. Paths avoid every
 * existing building, since an opponent building would cut the chain.
 */
function withPath(
  state: GameState,
  seat: number,
  length: number,
): { state: GameState; path: ReturnType<typeof simplePath> } {
  const avoid = new Set<VertexId>(Object.keys(state.buildings));
  const path = simplePath(state, length, { vertices: avoid });
  const next = patch(state, (draft) => {
    for (const edge of path.edges) draft.roads[edge] = seat;
  });
  return { state: next, path };
}

describe('longest trade route', () => {
  it('counts a simple chain and awards it at 5 roads', () => {
    const base = setupGame(3, 100);
    const four = withPath(base, 0, 4);
    expect(longestRoadLength(four.state, 0)).toBe(4);
    expect(four.state.awards.longestRoad).toBeNull();

    const five = withPath(base, 0, 5);
    expect(longestRoadLength(five.state, 0)).toBe(5);
    expect(five.state.awards.longestRoad).toBe(0);
    expect(five.state.awards.longestRoadLength[0]).toBe(5);
    const score = scorePlayer(five.state, 0);
    expect(score.longestRoad).toBe(2);
    expect(five.state.players[0]?.vp).toBe(score.total);
  });

  it('is blocked by an opponent building placed at the middle of the chain', () => {
    const base = setupGame(3, 101);
    const six = withPath(base, 0, 6);
    expect(longestRoadLength(six.state, 0)).toBe(6);
    const middle = six.path.vertices[3] as VertexId;
    const cut = patch(six.state, (draft) => {
      draft.buildings[middle] = { owner: 1, type: 'settlement' };
    });
    // The two halves are 0-1-2 and 4-5-6, two edges each.
    expect(longestRoadLength(cut, 0)).toBe(2);
    expect(cut.awards.longestRoad).toBeNull();
  });

  it('passes through the player own buildings', () => {
    const base = setupGame(3, 102);
    const six = withPath(base, 0, 6);
    const middle = six.path.vertices[3] as VertexId;
    const through = patch(six.state, (draft) => {
      draft.buildings[middle] = { owner: 0, type: 'settlement' };
    });
    expect(longestRoadLength(through, 0)).toBe(6);
    expect(through.awards.longestRoad).toBe(0);
  });

  it('handles ties: no holder means nobody, a holder keeps it, a strict leader takes it', () => {
    const base = setupGame(4, 103);
    const first = withPath(base, 0, 5);
    const usedVertices = new Set([...Object.keys(first.state.buildings), ...first.path.vertices]);
    const usedEdges = new Set(first.path.edges);
    const secondPath = simplePath(first.state, 5, { vertices: usedVertices, edges: usedEdges });
    const tie = patch(first.state, (draft) => {
      for (const edge of secondPath.edges) draft.roads[edge] = 1;
    });

    // Seat 0 already held it, so the tie keeps seat 0.
    expect(tie.awards.longestRoad).toBe(0);

    // Without a holder the tie leaves the award unclaimed.
    const noHolder = patch(tie, (draft) => {
      draft.awards.longestRoad = null;
    });
    expect(noHolder.awards.longestRoad).toBeNull();

    // One more road at the end of seat 1's chain takes it outright.
    const endpoint = secondPath.vertices[secondPath.vertices.length - 1] as VertexId;
    const extendEdge = tie.board.edges.find((edge) => {
      if (edge.a !== endpoint && edge.b !== endpoint) return false;
      if (tie.roads[edge.id] !== undefined) return false;
      const other = edge.a === endpoint ? edge.b : edge.a;
      return !secondPath.vertices.includes(other);
    });
    expect(extendEdge).toBeDefined();
    const challenger = patch(tie, (draft) => {
      draft.roads[extendEdge?.id as EdgeId] = 1;
    });
    expect(longestRoadLength(challenger, 1)).toBe(6);
    expect(challenger.awards.longestRoad).toBe(1);
  });

  it('reassigns the award in the same action when an opponent cuts a road', () => {
    const base = setupGame(4, 104);
    const six = withPath(base, 0, 6);
    const otherPath = simplePath(six.state, 5, {
      vertices: new Set([...Object.keys(six.state.buildings), ...six.path.vertices]),
      edges: new Set(six.path.edges),
    });
    let state = patch(six.state, (draft) => {
      for (const edge of otherPath.edges) draft.roads[edge] = 2;
    });
    expect(state.awards.longestRoad).toBe(0);
    expect(state.awards.longestRoadLength[2]).toBe(5);

    // Give seat 1 a road touching the middle vertex so it can build there, and
    // hand it the turn.
    const middle = six.path.vertices[3] as VertexId;
    const thirdEdge = state.board.edges.find(
      (edge) =>
        (edge.a === middle || edge.b === middle) &&
        state.roads[edge.id] === undefined &&
        (edge.a !== six.path.vertices[2] && edge.b !== six.path.vertices[2]) &&
        (edge.a !== six.path.vertices[4] && edge.b !== six.path.vertices[4]),
    );
    expect(thirdEdge).toBeDefined();
    state = patch(state, (draft) => {
      draft.roads[thirdEdge?.id as EdgeId] = 1;
      draft.phase = 'action';
      draft.currentSeat = 1;
      draft.turnFlags = { rolled: true, purchased: false };
      draft.players[1]!.resources = { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 };
    });
    expect(state.awards.longestRoad).toBe(0);

    const result = applyAction(state, 1, { type: 'buildSettlement', vertex: middle });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.state;
    expect(after.awards.longestRoadLength[0]).toBe(2);
    expect(after.awards.longestRoad).toBe(2);
    expect(after.awards.longestRoadLength[2]).toBe(5);
  });

  it('rejects nothing and scores zero with no roads', () => {
    const state = setupGame(2, 105);
    const cleared = patch(state, (draft) => {
      draft.roads = {};
      draft.buildings = {};
    });
    expect(longestRoadLength(cleared, 0)).toBe(0);
    expect(cleared.awards.longestRoad).toBeNull();
    expect(scorePlayer(cleared, 0).longestRoad).toBe(0);
  });
});

describe('largest expedition', () => {
  it('awards at 3 renown and scores 2 VP', () => {
    const base = setupGame(4, 110);
    const two = patch(base, (draft) => {
      draft.players[0]!.renown = 2;
    });
    expect(two.awards.largestExpedition).toBeNull();

    const three = patch(base, (draft) => {
      draft.players[0]!.renown = 3;
    });
    expect(three.awards.largestExpedition).toBe(0);
    expect(scorePlayer(three, 0).largestExpedition).toBe(2);
  });

  it('keeps ties with the holder and only a strict challenger takes it', () => {
    const base = setupGame(4, 111);
    const holder = patch(base, (draft) => {
      draft.players[0]!.renown = 3;
    });
    expect(holder.awards.largestExpedition).toBe(0);

    const tie = patch(holder, (draft) => {
      draft.players[1]!.renown = 3;
    });
    expect(tie.awards.largestExpedition).toBe(0);

    const ahead = patch(tie, (draft) => {
      draft.players[1]!.renown = 4;
    });
    expect(ahead.awards.largestExpedition).toBe(1);

    // Two players crossing 3 in the same pass with no holder: nobody gets it.
    const simultaneous = patch(base, (draft) => {
      draft.players[2]!.renown = 3;
      draft.players[3]!.renown = 3;
    });
    expect(simultaneous.awards.largestExpedition).toBeNull();
  });
});

describe('scoring', () => {
  it('adds settlements, cities, charters and awards into one total', () => {
    const base = setupGame(4, 112);
    const crafted = patch(base, (draft) => {
      draft.buildings = {
        v1: { owner: 0, type: 'settlement' },
        v2: { owner: 0, type: 'settlement' },
        v3: { owner: 0, type: 'city' },
        v4: { owner: 1, type: 'city' },
      };
      draft.players[0]!.charters = { 'quay-deed': 2, 'fleet-charter': 1 };
      draft.players[0]!.renown = 3;
    });
    const breakdown = scorePlayer(crafted, 0);
    expect(breakdown.settlements).toBe(2);
    expect(breakdown.cities).toBe(2);
    expect(breakdown.charters).toBe(4);
    expect(breakdown.largestExpedition).toBe(2);
    expect(breakdown.longestRoad).toBe(0);
    expect(breakdown.total).toBe(10);
    expect(crafted.players[0]?.vp).toBe(10);
  });
});
