/**
 * Board construction: the fixed 19-hex template, one of twelve seeded
 * orientations, the 54-vertex / 72-edge graph, and the 9-port ring.
 *
 * Geometry is pointy-top axial with hex size 1 and corners at
 * 30 + 60k degrees. A lattice point is stored as the exact integer pair
 * (u, v) with world position
 *
 *   x = (sqrt(3) / 2) * u,  y = v / 2
 *
 * which keeps every rotation and mirror exact (no float drift, stable ids)
 * and gives the client plain board units it can scale into its viewBox.
 * Hex corners for axial (q, r) are (2q + r + du, 3r + dv) with the offsets
 * below; rotations and mirrors are integer maps on (u, v).
 *
 * Ids are derived from the canonical (unrotated) template and never move:
 * vertices are `v1..v54`, edges `e1..e72`, ports `port-0..port-8`. Terrain and
 * number tokens stay attached to their hex ids, so an orientation rotates the
 * island geometry (and the port ring with it) and leaves the terrain table
 * intact.
 */
import { HEX_TEMPLATE, PORT_ORDER } from '../board-template.js';
import type {
  Board,
  Edge,
  EdgeId,
  Hex,
  HexId,
  Port,
  Vertex,
  VertexId,
} from '../types.js';

export interface Orientation {
  /** 0-5, one 60 degree step each. */
  rotation: number;
  /** 0 or 1. */
  mirror: number;
}

const SQRT3 = Math.sqrt(3);

interface Uv {
  u: number;
  v: number;
}

/** Corner offsets in (u, v) for k = 0..5, starting at 30 degrees. */
const CORNER_OFFSETS: readonly Uv[] = [
  { u: 1, v: 1 },
  { u: 0, v: 2 },
  { u: -1, v: 1 },
  { u: -1, v: -1 },
  { u: 0, v: -2 },
  { u: 1, v: -1 },
];

function orientUv(uv: Uv, orientation: Orientation): Uv {
  let u = orientation.mirror === 1 ? -uv.u : uv.u;
  let v = uv.v;
  for (let step = 0; step < orientation.rotation; step += 1) {
    const nu = (u - v) / 2;
    const nv = (3 * u + v) / 2;
    u = nu;
    v = nv;
  }
  return { u, v };
}

function positionOf(uv: Uv): { x: number; y: number } {
  return { x: (SQRT3 / 2) * uv.u, y: uv.v / 2 };
}

function cornerUv(q: number, r: number, k: number): Uv {
  const offset = CORNER_OFFSETS[k % 6] as Uv;
  return { u: 2 * q + r + offset.u, v: 3 * r + offset.v };
}

function centerUv(q: number, r: number): Uv {
  return { u: 2 * q + r, v: 3 * r };
}

function uvKey(uv: Uv): string {
  return `${uv.u},${uv.v}`;
}

function vertexId(index: number): VertexId {
  return `v${index + 1}`;
}

function edgeId(index: number): EdgeId {
  return `e${index + 1}`;
}

interface BaseGraph {
  /** Sorted canonical vertices. */
  vertices: Uv[];
  vertexIndex: Map<string, number>;
  /** For each hex (template order), its six corner vertex indices. */
  hexCorners: number[][];
  /** For each hex, its six side edge indices (side k is corner k -> k + 1). */
  hexEdges: number[][];
  /** For each edge, the two vertex indices with the lower one first. */
  edgeVertices: Array<[number, number]>;
  /** For each edge, the hexes that touch it, in template order. */
  edgeHexes: HexId[][];
}

function buildBaseGraph(): BaseGraph {
  const vertexMap = new Map<string, Uv>();
  const hexCorners: number[][] = [];

  for (const hex of HEX_TEMPLATE) {
    const corners: number[] = [];
    for (let k = 0; k < 6; k += 1) {
      const uv = cornerUv(hex.q, hex.r, k);
      const key = uvKey(uv);
      if (!vertexMap.has(key)) vertexMap.set(key, uv);
      corners.push(k);
    }
    hexCorners.push(corners);
  }

  // Collect vertices first so indices are assigned in canonical sorted order.
  const raw = [...vertexMap.values()];
  raw.sort((a, b) => (a.u === b.u ? a.v - b.v : a.u - b.u));
  const vertexIndex = new Map<string, number>();
  raw.forEach((uv, index) => vertexIndex.set(uvKey(uv), index));

  // Rebuild hex corners with real indices.
  for (let h = 0; h < HEX_TEMPLATE.length; h += 1) {
    const hex = HEX_TEMPLATE[h] as (typeof HEX_TEMPLATE)[number];
    const corners: number[] = [];
    for (let k = 0; k < 6; k += 1) {
      const uv = cornerUv(hex.q, hex.r, k);
      const index = vertexIndex.get(uvKey(uv));
      if (index === undefined) throw new Error('board: corner missing from vertex map');
      corners.push(index);
    }
    hexCorners[h] = corners;
  }

  const edgeMap = new Map<string, number>();
  const edgeVertices: Array<[number, number]> = [];
  const edgeHexes: HexId[][] = [];
  const hexEdges: number[][] = [];

  for (let h = 0; h < HEX_TEMPLATE.length; h += 1) {
    const hex = HEX_TEMPLATE[h] as (typeof HEX_TEMPLATE)[number];
    const corners = hexCorners[h] as number[];
    const sides: number[] = [];
    for (let k = 0; k < 6; k += 1) {
      const a = corners[k] as number;
      const b = corners[(k + 1) % 6] as number;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}-${hi}`;
      let index = edgeMap.get(key);
      if (index === undefined) {
        index = edgeVertices.length;
        edgeMap.set(key, index);
        edgeVertices.push([lo, hi]);
        edgeHexes.push([]);
      }
      const owners = edgeHexes[index] as HexId[];
      if (!owners.includes(hex.id)) owners.push(hex.id);
      sides.push(index);
    }
    hexEdges[h] = sides;
  }

  // Sort edge indices by their vertex pair, then renumber references.
  const order = edgeVertices.map((_, index) => index);
  order.sort((x, y) => {
    const ex = edgeVertices[x] as [number, number];
    const ey = edgeVertices[y] as [number, number];
    return ex[0] === ey[0] ? ex[1] - ey[1] : ex[0] - ey[0];
  });
  const remap = new Map<number, number>();
  order.forEach((oldIndex, newIndex) => remap.set(oldIndex, newIndex));

  const sortedEdgeVertices: Array<[number, number]> = [];
  const sortedEdgeHexes: HexId[][] = [];
  order.forEach((oldIndex) => {
    sortedEdgeVertices.push(edgeVertices[oldIndex] as [number, number]);
    sortedEdgeHexes.push(edgeHexes[oldIndex] as HexId[]);
  });

  return {
    vertices: raw,
    vertexIndex,
    hexCorners,
    hexEdges: hexEdges.map((sides) => sides.map((side) => remap.get(side) as number)),
    edgeVertices: sortedEdgeVertices,
    edgeHexes: sortedEdgeHexes,
  };
}

const BASE_GRAPH = buildBaseGraph();

/** Boundary (single-hex) edges, ordered clockwise from the top-left edge. */
function buildCoastalRing(base: BaseGraph): number[] {
  const coastal: number[] = [];
  base.edgeVertices.forEach((vertices, index) => {
    const hexes = base.edgeHexes[index] as HexId[];
    if (hexes.length === 1) coastal.push(index);
  });

  const verticesOfEdge = (index: number): [number, number] => base.edgeVertices[index] as [number, number];
  const positionOfVertex = (index: number): { x: number; y: number } =>
    positionOf(base.vertices[index] as Uv);
  const midpointOfEdge = (index: number): { x: number; y: number } => {
    const [a, b] = verticesOfEdge(index);
    const pa = positionOfVertex(a);
    const pb = positionOfVertex(b);
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  };

  // Coastal edges incident to each boundary vertex.
  const byVertex = new Map<number, number[]>();
  for (const index of coastal) {
    for (const vertex of verticesOfEdge(index)) {
      const list = byVertex.get(vertex) ?? [];
      list.push(index);
      byVertex.set(vertex, list);
    }
  }

  const walk = (startEdge: number, exitVertex: number): number[] => {
    const ring: number[] = [startEdge];
    let currentEdge = startEdge;
    let currentVertex = exitVertex;
    for (let guard = 0; guard <= coastal.length; guard += 1) {
      const [a, b] = verticesOfEdge(currentEdge);
      const nextVertex = a === currentVertex ? b : a;
      const candidates = (byVertex.get(nextVertex) ?? []).filter((edge) => edge !== currentEdge);
      const nextEdge = candidates[0];
      if (nextEdge === undefined || nextEdge === startEdge) break;
      ring.push(nextEdge);
      currentEdge = nextEdge;
      currentVertex = nextVertex;
    }
    return ring;
  };

  // "Top-left": topmost coastal edge midpoint, leftmost on a tie.
  let startEdge = coastal[0] as number;
  let best = midpointOfEdge(startEdge);
  for (const index of coastal) {
    const mid = midpointOfEdge(index);
    if (mid.y < best.y - 1e-9 || (Math.abs(mid.y - best.y) <= 1e-9 && mid.x < best.x)) {
      startEdge = index;
      best = mid;
    }
  }

  const [startA, startB] = verticesOfEdge(startEdge);
  const forward = walk(startEdge, startA);
  const backward = walk(startEdge, startB);
  const isComplete = (ring: number[]): boolean => {
    const seen = new Set(ring);
    return seen.size === coastal.length && ring.length === coastal.length;
  };
  const shoelace = (ring: number[]): number => {
    let sum = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const p = midpointOfEdge(ring[i] as number);
      const q = midpointOfEdge(ring[(i + 1) % ring.length] as number);
      sum += p.x * q.y - q.x * p.y;
    }
    return sum;
  };

  // Screen coordinates have y pointing down, so a visually clockwise ring has a
  // positive shoelace sum.
  if (isComplete(forward) && shoelace(forward) > 0) return forward;
  if (isComplete(backward) && shoelace(backward) > 0) return backward;
  if (isComplete(forward)) return forward;
  return backward;
}

const COASTAL_RING = buildCoastalRing(BASE_GRAPH);

/** Every second coastal edge would need 18 of them; a 19-hex island has 30. */
export const COASTAL_EDGE_COUNT = COASTAL_RING.length;

/** Build the finished board for one orientation. */
export function buildBoard(orientation: Orientation): Board {
  const base = BASE_GRAPH;
  const hexPositions: Array<{ q: number; r: number; x: number; y: number }> = [];

  for (const hex of HEX_TEMPLATE) {
    const oriented = orientUv(centerUv(hex.q, hex.r), orientation);
    const r = Math.round(oriented.v / 3);
    const q = Math.round((oriented.u - r) / 2);
    const pos = positionOf(oriented);
    hexPositions.push({ q, r, x: pos.x, y: pos.y });
  }

  const vertexPositions = base.vertices.map((uv) => positionOf(orientUv(uv, orientation)));
  const vertexHexes: HexId[][] = base.vertices.map(() => []);
  const vertexEdges: number[][] = base.vertices.map(() => []);

  base.edgeVertices.forEach(([a, b], index) => {
    (vertexEdges[a] as number[]).push(index);
    (vertexEdges[b] as number[]).push(index);
  });

  HEX_TEMPLATE.forEach((hex, h) => {
    for (const vertex of base.hexCorners[h] as number[]) {
      (vertexHexes[vertex] as HexId[]).push(hex.id);
    }
  });

  const hexNeighbors = new Map<HexId, HexId[]>();
  const hexAt = new Map<string, HexId>();
  for (const hex of HEX_TEMPLATE) hexAt.set(`${hex.q},${hex.r}`, hex.id);
  const DIRS: ReadonlyArray<[number, number]> = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  for (const hex of HEX_TEMPLATE) {
    const neighbors: HexId[] = [];
    for (const [dq, dr] of DIRS) {
      const id = hexAt.get(`${hex.q + dq},${hex.r + dr}`);
      if (id !== undefined) neighbors.push(id);
    }
    hexNeighbors.set(hex.id, neighbors);
  }

  const hexes: Hex[] = HEX_TEMPLATE.map((hex, h) => {
    const pos = hexPositions[h] as { q: number; r: number; x: number; y: number };
    return {
      id: hex.id,
      q: pos.q,
      r: pos.r,
      x: pos.x,
      y: pos.y,
      terrain: hex.terrain,
      token: hex.token,
      vertices: (base.hexCorners[h] as number[]).map((index) => vertexId(index)),
      edges: (base.hexEdges[h] as number[]).map((index) => edgeId(index)),
      neighbors: hexNeighbors.get(hex.id) ?? [],
    };
  });

  const vertices: Vertex[] = base.vertices.map((_, index) => {
    const pos = vertexPositions[index] as { x: number; y: number };
    return {
      id: vertexId(index),
      x: pos.x,
      y: pos.y,
      hexes: (vertexHexes[index] as HexId[]).slice(),
      edges: (vertexEdges[index] as number[]).map((edge) => edgeId(edge)),
    };
  });

  const edges: Edge[] = base.edgeVertices.map(([a, b], index) => {
    const hexIds = base.edgeHexes[index] as HexId[];
    return {
      id: edgeId(index),
      a: vertexId(a),
      b: vertexId(b),
      hexes: hexIds.slice(),
      coastal: hexIds.length === 1,
    };
  });

  // Ports: 9 evenly spaced around the coastal ring. The design text says "every
  // second coastal edge", which presumes 18; the island has 30, and evenly
  // spacing 9 ports keeps the intended 3-or-4-edge gaps and the 2:1 / 3:1 mix.
  const ports: Port[] = [];
  for (let i = 0; i < PORT_ORDER.length; i += 1) {
    const ringIndex = Math.round((i * COASTAL_RING.length) / PORT_ORDER.length) % COASTAL_RING.length;
    const edgeIndex = COASTAL_RING[ringIndex] as number;
    const [a, b] = base.edgeVertices[edgeIndex] as [number, number];
    const pa = vertexPositions[a] as { x: number; y: number };
    const pb = vertexPositions[b] as { x: number; y: number };
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const length = Math.hypot(mid.x, mid.y) || 1;
    const spec = PORT_ORDER[i] as { resource: Port['resource']; rate: 2 | 3 };
    ports.push({
      id: `port-${i}`,
      resource: spec.resource,
      rate: spec.rate,
      edge: edgeId(edgeIndex),
      vertices: [vertexId(a), vertexId(b)],
      x: mid.x + (mid.x / length) * 0.85,
      y: mid.y + (mid.y / length) * 0.85,
    });
  }

  return { hexes, vertices, edges, ports };
}

export interface BoardIndex {
  hex: Map<HexId, Hex>;
  vertex: Map<VertexId, Vertex>;
  edge: Map<EdgeId, Edge>;
  vertexNeighbors: Map<VertexId, VertexId[]>;
  edgesByVertex: Map<VertexId, EdgeId[]>;
  hexesByVertex: Map<VertexId, HexId[]>;
  portsByVertex: Map<VertexId, Port[]>;
}

const indexCache = new WeakMap<Board, BoardIndex>();

/** Cached lookups over an immutable board. */
export function boardIndex(board: Board): BoardIndex {
  const cached = indexCache.get(board);
  if (cached) return cached;

  const hex = new Map<HexId, Hex>();
  for (const item of board.hexes) hex.set(item.id, item);
  const vertex = new Map<VertexId, Vertex>();
  for (const item of board.vertices) vertex.set(item.id, item);
  const edge = new Map<EdgeId, Edge>();
  for (const item of board.edges) edge.set(item.id, item);

  const vertexNeighbors = new Map<VertexId, VertexId[]>();
  const edgesByVertex = new Map<VertexId, EdgeId[]>();
  for (const item of board.vertices) {
    vertexNeighbors.set(item.id, []);
    edgesByVertex.set(item.id, item.edges.slice());
  }
  for (const item of board.edges) {
    (vertexNeighbors.get(item.a) as VertexId[]).push(item.b);
    (vertexNeighbors.get(item.b) as VertexId[]).push(item.a);
  }

  const hexesByVertex = new Map<VertexId, HexId[]>();
  for (const item of board.vertices) hexesByVertex.set(item.id, item.hexes.slice());

  const portsByVertex = new Map<VertexId, Port[]>();
  for (const port of board.ports) {
    for (const id of port.vertices) {
      const list = portsByVertex.get(id) ?? [];
      list.push(port);
      portsByVertex.set(id, list);
    }
  }

  const index: BoardIndex = {
    hex,
    vertex,
    edge,
    vertexNeighbors,
    edgesByVertex,
    hexesByVertex,
    portsByVertex,
  };
  indexCache.set(board, index);
  return index;
}
