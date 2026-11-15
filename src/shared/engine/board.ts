/**
 * Board construction: a generated layout, one of twelve seeded orientations,
 * the vertex/edge graph, and the port ring.
 *
 * Geometry is pointy-top axial with hex size 1 and corners at 30 + 60k
 * degrees. A lattice point is stored as the exact integer pair (u, v) with
 * world position
 *
 *   x = (sqrt(3) / 2) * u,  y = v / 2
 *
 * which keeps every rotation and mirror exact (no float drift, stable ids)
 * and gives the client plain board units it can scale into its viewBox.
 * Hex corners for axial (q, r) are (2q + r + du, 3r + dv) with the offsets
 * below; rotations and mirrors are integer maps on (u, v).
 *
 * Ids are derived from the shape and never move: a hex is its row letter plus
 * its column number (row A is the top row, column 1 the leftmost hex of that
 * row), vertices are `v1..vN` in sorted lattice order, edges `e1..eM`, ports
 * `port-0..`. Terrain and number tokens stay attached to their coordinates, so
 * an orientation rotates the island geometry (and the port ring with it) and
 * leaves the layout table intact.
 */
import { PORT_ORDER } from '../board-template.js';
import { hexCoordsFor, hexCountFor, mapSizeInfo } from '../map-settings.js';
import type { MapLayout, MapHex } from './map.js';
import type {
  Board,
  Edge,
  EdgeId,
  Hex,
  HexId,
  MapSize,
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

/** Row letter + column number, e.g. `C3` for the middle of a standard island. */
function hexIdsFor(hexes: readonly MapHex[]): HexId[] {
  const rows = new Map<number, number[]>();
  hexes.forEach((hex, index) => {
    const row = rows.get(hex.r) ?? [];
    row.push(index);
    rows.set(hex.r, row);
  });
  const ids: HexId[] = hexes.map(() => '');
  const rowOrder = [...rows.keys()].sort((a, b) => a - b);
  rowOrder.forEach((r, rowIndex) => {
    const members = (rows.get(r) ?? []).slice().sort((a, b) => (hexes[a] as MapHex).q - (hexes[b] as MapHex).q);
    const letter = String.fromCharCode(65 + rowIndex);
    members.forEach((hexIndex, column) => {
      ids[hexIndex] = `${letter}${column + 1}`;
    });
  });
  return ids;
}

interface BaseGraph {
  /** Sorted canonical vertices. */
  vertices: Uv[];
  vertexIndex: Map<string, number>;
  /** For each hex (layout order), its six corner vertex indices. */
  hexCorners: number[][];
  /** For each hex, its six side edge indices (side k is corner k -> k + 1). */
  hexEdges: number[][];
  /** For each edge, the two vertex indices with the lower one first. */
  edgeVertices: Array<[number, number]>;
  /** For each edge, the hexes that touch it, in layout order. */
  edgeHexes: HexId[][];
  /** Boundary edges, clockwise from the top-left edge. */
  coastalRing: number[];
}

const graphCache = new Map<MapSize, BaseGraph>();

function buildBaseGraph(size: MapSize, hexIds: readonly HexId[], hexes: readonly MapHex[]): BaseGraph {
  const vertexMap = new Map<string, Uv>();

  for (const hex of hexes) {
    for (let k = 0; k < 6; k += 1) {
      const uv = cornerUv(hex.q, hex.r, k);
      const key = uvKey(uv);
      if (!vertexMap.has(key)) vertexMap.set(key, uv);
    }
  }

  // Collect vertices first so indices are assigned in canonical sorted order.
  const raw = [...vertexMap.values()];
  raw.sort((a, b) => (a.u === b.u ? a.v - b.v : a.u - b.u));
  const vertexIndex = new Map<string, number>();
  raw.forEach((uv, index) => vertexIndex.set(uvKey(uv), index));

  const hexCorners: number[][] = hexes.map((hex) => {
    const corners: number[] = [];
    for (let k = 0; k < 6; k += 1) {
      const index = vertexIndex.get(uvKey(cornerUv(hex.q, hex.r, k)));
      if (index === undefined) throw new Error('board: corner missing from vertex map');
      corners.push(index);
    }
    return corners;
  });

  const edgeMap = new Map<string, number>();
  const edgeVertices: Array<[number, number]> = [];
  const edgeHexes: HexId[][] = [];
  const hexEdges: number[][] = [];

  hexCorners.forEach((corners, h) => {
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
      const id = hexIds[h] as HexId;
      if (!owners.includes(id)) owners.push(id);
      sides.push(index);
    }
    hexEdges[h] = sides;
  });

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

  const base = {
    vertices: raw,
    vertexIndex,
    hexCorners,
    hexEdges: hexEdges.map((sides) => sides.map((side) => remap.get(side) as number)),
    edgeVertices: sortedEdgeVertices,
    edgeHexes: sortedEdgeHexes,
  };
  return { ...base, coastalRing: buildCoastalRing(base) };
}

function graphFor(size: MapSize, hexIds: readonly HexId[], hexes: readonly MapHex[]): BaseGraph {
  // The graph cache is keyed by size, so every layout of a size has to arrive
  // in the same row-major order the generator uses.
  const expected = hexCoordsFor(size);
  if (
    hexes.length !== hexCountFor(size) ||
    hexes.some((hex, index) => hex.q !== expected[index]?.q || hex.r !== expected[index]?.r)
  ) {
    throw new Error(`board: ${size} layout is not in generated order`);
  }
  const cached = graphCache.get(size);
  if (cached) return cached;
  const built = buildBaseGraph(size, hexIds, hexes);
  graphCache.set(size, built);
  return built;
}

/** Boundary (single-hex) edges, ordered clockwise from the top-left edge. */
function buildCoastalRing(base: Omit<BaseGraph, 'coastalRing'>): number[] {
  const coastal: number[] = [];
  base.edgeVertices.forEach((vertices, index) => {
    if ((base.edgeHexes[index] as HexId[]).length === 1) coastal.push(index);
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

/** Port count that keeps the classic ring at nine and scales with the coast. */
export function portCountFor(coastalEdges: number): number {
  return Math.max(4, Math.min(12, Math.round(coastalEdges * 0.3)));
}

interface PortSpec {
  resource: Port['resource'];
  rate: 2 | 3;
}

const PORT_RESOURCE_ORDER = ['ore', 'wheat', 'brick', 'sheep', 'wood'] as const;

/**
 * Generic and resource ports interleaved around the ring. Nine ports give
 * exactly the design doc's order; other sizes keep the same 3:1 / 2:1 mix and
 * spacing.
 */
export function portSpecsFor(count: number): PortSpec[] {
  if (count === PORT_ORDER.length) return PORT_ORDER.map((spec) => ({ ...spec }));
  const genericCount = Math.max(1, Math.min(count - 1, Math.round((count * 4) / 9)));
  const generic = new Set<number>();
  for (let index = 0; index < genericCount; index += 1) {
    generic.add((Math.floor((index * count) / genericCount) + 1) % count);
  }
  const specs: PortSpec[] = [];
  let resourceIndex = 0;
  for (let index = 0; index < count; index += 1) {
    if (generic.has(index)) {
      specs.push({ resource: 'generic', rate: 3 });
    } else {
      const resource = PORT_RESOURCE_ORDER[resourceIndex % PORT_RESOURCE_ORDER.length] as Port['resource'];
      resourceIndex += 1;
      specs.push({ resource, rate: 2 });
    }
  }
  return specs;
}

/** Build the finished board for one layout and orientation. */
export function buildBoard(layout: MapLayout, orientation: Orientation): Board {
  const hexesIn = layout.hexes;
  const ids = hexIdsFor(hexesIn);
  const base = graphFor(layout.size, ids, hexesIn);

  const hexPositions: Array<{ q: number; r: number; x: number; y: number }> = [];
  for (const hex of hexesIn) {
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

  hexesIn.forEach((_, h) => {
    for (const vertex of base.hexCorners[h] as number[]) {
      (vertexHexes[vertex] as HexId[]).push(ids[h] as HexId);
    }
  });

  const hexNeighbors = new Map<HexId, HexId[]>();
  const hexAt = new Map<string, HexId>();
  hexesIn.forEach((hex, h) => hexAt.set(`${hex.q},${hex.r}`, ids[h] as HexId));
  const DIRS: ReadonlyArray<[number, number]> = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  hexesIn.forEach((hex, h) => {
    const neighbors: HexId[] = [];
    for (const [dq, dr] of DIRS) {
      const id = hexAt.get(`${hex.q + dq},${hex.r + dr}`);
      if (id !== undefined) neighbors.push(id);
    }
    hexNeighbors.set(ids[h] as HexId, neighbors);
  });

  const hexes: Hex[] = hexesIn.map((hex, h) => {
    const pos = hexPositions[h] as { q: number; r: number; x: number; y: number };
    return {
      id: ids[h] as HexId,
      q: pos.q,
      r: pos.r,
      x: pos.x,
      y: pos.y,
      terrain: hex.terrain,
      token: hex.token,
      vertices: (base.hexCorners[h] as number[]).map((index) => vertexId(index)),
      edges: (base.hexEdges[h] as number[]).map((index) => edgeId(index)),
      neighbors: hexNeighbors.get(ids[h] as HexId) ?? [],
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

  // Ports sit on coastal edges, evenly spaced around the ring and pushed
  // seaward for the label.
  const specs = portSpecsFor(portCountFor(base.coastalRing.length));
  const ports: Port[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const ringIndex = Math.round((i * base.coastalRing.length) / specs.length) % base.coastalRing.length;
    const edgeIndex = base.coastalRing[ringIndex] as number;
    const [a, b] = base.edgeVertices[edgeIndex] as [number, number];
    const pa = vertexPositions[a] as { x: number; y: number };
    const pb = vertexPositions[b] as { x: number; y: number };
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const length = Math.hypot(mid.x, mid.y) || 1;
    const spec = specs[i] as PortSpec;
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

/** The desert hex the robber starts on: the first one in id order. */
export function desertHexId(board: Board): HexId {
  let chosen: HexId | null = null;
  for (const hex of board.hexes) {
    if (hex.terrain !== 'desert') continue;
    if (chosen === null || hex.id < chosen) chosen = hex.id;
  }
  return chosen ?? ((board.hexes[0] as Hex).id as HexId);
}

/** Board radius in hexes, for UI copy and tests. */
export function boardRadius(size: MapSize): number {
  return mapSizeInfo(size).radius;
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
