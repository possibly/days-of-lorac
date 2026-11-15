/**
 * Placement scoring: where a settlement or a road is actually worth putting.
 *
 * Both the setup draft and the action phase use these functions, so the bot's
 * idea of a good vertex never drifts between "picking my second settlement"
 * and "spending four resources on a third".
 */
import { RESOURCES } from '../../shared/types.js';
import type { Edge, EdgeId, VertexId } from '../../shared/types.js';
import { seededSigned } from './hash.js';
import type { Sense } from './sense.js';
import { VP_POINTS } from './sense.js';
import type { BotWeights } from './weights.js';

/** Stable noise for one candidate, so replays pick the same site. */
function noiseFor(sense: Sense, salt: string, id: string, amplitude: number): number {
  if (amplitude <= 0) return 0;
  return amplitude * seededSigned(sense.view.gameId, sense.view.turn, sense.you, salt, id);
}

function otherEnd(edge: Edge, vertex: VertexId): VertexId {
  return edge.a === vertex ? edge.b : edge.a;
}

/**
 * How crowded a site is by the neighbours' expansion. The distance rule means
 * a legal vertex never touches a building, so crowding is measured two steps
 * out: opponents' buildings and roads that will eat the space around it.
 */
function crowding(sense: Sense, vertex: VertexId): number {
  let crowd = 0;
  const seen = new Set<VertexId>([vertex]);
  for (const near of sense.index.vertexNeighbors.get(vertex) ?? []) {
    if (seen.has(near)) continue;
    seen.add(near);
    for (const far of sense.index.vertexNeighbors.get(near) ?? []) {
      if (seen.has(far)) continue;
      seen.add(far);
      const building = sense.buildingAt(far);
      if (building && building.owner !== sense.you) crowd += 1;
      for (const edgeId of sense.index.edgesByVertex.get(far) ?? []) {
        const owner = sense.roadOwner(edgeId);
        if (owner !== undefined && owner !== sense.you) crowd += 0.5;
      }
    }
  }
  return crowd;
}

/**
 * Base score for a settlement vertex, in utility points. Pips dominate,
 * diversity against the bot's existing board adds on top, ore and brick carry
 * a scarcity premium, a matching port is worth real points, and a crowded site
 * loses a little.
 */
export function settlementScore(
  sense: Sense,
  vertex: VertexId,
  w: BotWeights,
  options: {
    noiseSalt?: string;
    noise?: number;
    diversity?: boolean;
  } = {},
): number {
  if (!sense.vertex(vertex)) return -Infinity;
  const mix = sense.vertexMix(vertex);
  let score = 0;
  for (const resource of RESOURCES) score += mix[resource];
  score += mix.ore * w.oreBonus + mix.brick * w.brickBonus;

  if (options.diversity !== false) {
    const covered = sense.coveredResources();
    for (const resource of RESOURCES) {
      if (mix[resource] > 0 && !covered[resource]) score += w.setupDiversity;
    }
  }

  for (const port of sense.portsAt(vertex)) {
    if (port.resource === 'generic') score += w.genericPortBonus;
    else if (mix[port.resource] > 0) score += w.specificPortBonus;
    else score += 0.3;
  }

  score -= crowding(sense, vertex) * w.crowdPenalty;
  score += noiseFor(sense, options.noiseSalt ?? 'site', vertex, options.noise ?? 0);
  return score;
}

/**
 * The candidate with the highest score. `discipline` at 0 keeps whichever
 * candidate came first instead, which is how Deckhand plays without a second
 * code path.
 */
export function pickCandidate<T>(
  candidates: readonly T[],
  scoreOf: (candidate: T, index: number) => number,
  discipline: number,
): T | null {
  if (candidates.length === 0) return null;
  const normalize = 40 / Math.max(1, candidates.length);
  let best: T | null = null;
  let bestKey = -Infinity;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] as T;
    const score = scoreOf(candidate, index);
    const key = discipline * score - (1 - discipline) * index * normalize;
    if (key > bestKey) {
      bestKey = key;
      best = candidate;
    }
  }
  return best;
}

export function bestSettlementVertex(
  sense: Sense,
  vertices: readonly VertexId[],
  w: BotWeights,
  options: {
    noiseSalt?: string;
    noise?: number;
    diversity?: boolean;
    discipline?: number;
  } = {},
): VertexId | null {
  return pickCandidate(
    vertices,
    (vertex) => settlementScore(sense, vertex, w, options),
    options.discipline ?? w.discipline,
  );
}

/**
 * Every empty vertex a new road would put in reach: one step out through the
 * edge's far end, and two steps out along a further edge. Sites two steps out
 * are the ones a settlement can legally use, because the vertex next to your
 * own building is blocked by the distance rule forever.
 */
export function reachableSites(sense: Sense, edge: Edge): VertexId[] {
  const sites = new Set<VertexId>();
  for (const near of [edge.a, edge.b]) {
    for (const firstEdge of sense.index.edgesByVertex.get(near) ?? []) {
      if (firstEdge === edge.id) continue;
      const first = sense.edge(firstEdge);
      if (!first) continue;
      const mid = otherEnd(first, near);
      if (sense.vertexOpen(mid)) sites.add(mid);
      for (const secondEdge of sense.index.edgesByVertex.get(mid) ?? []) {
        if (secondEdge === firstEdge) continue;
        const second = sense.edge(secondEdge);
        if (!second) continue;
        const far = otherEnd(second, mid);
        if (far === near) continue;
        if (!sense.vertexOpen(far)) continue;
        sites.add(far);
      }
    }
  }
  sites.delete(edge.a);
  sites.delete(edge.b);
  return [...sites];
}

/** Points for a road: what it opens, plus the road award when it is live. */
export function roadScore(sense: Sense, edgeId: EdgeId, w: BotWeights): number {
  const edge = sense.edge(edgeId);
  if (!edge) return -Infinity;

  const scored = reachableSites(sense, edge)
    .map((vertex) => settlementScore(sense, vertex, w, { diversity: true }))
    .sort((a, b) => b - a);
  const best = scored[0] ?? 0;
  const second = scored[1] ?? 0;
  let score = best + second * 0.3 + Math.min(2, scored.length) * 0.2;

  const awards = sense.view.awards;
  const myLength = awards.longestRoadLength[sense.you] ?? 0;
  const holder = awards.longestRoad;
  if (holder !== sense.you && myLength >= 4) {
    const holderLength = holder === null ? 0 : awards.longestRoadLength[holder] ?? 0;
    const after = myLength + 1;
    if (after >= 5 && (holder === null || after > holderLength)) {
      score += VP_POINTS * w.roadAwardFocus * w.awardFocus;
    }
  }
  return score;
}

export function bestRoadEdge(
  sense: Sense,
  edges: readonly EdgeId[],
  w: BotWeights,
): EdgeId | null {
  return pickCandidate(edges, (edge) => roadScore(sense, edge, w), w.discipline);
}
