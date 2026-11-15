/**
 * Board geometry, derived only from the `Board` the server sends.
 *
 * The one board-wide value is `S`, the median distance from a hex centre to one
 * of its vertices. Everything else in the renderer is a multiple of it. The
 * topology (which vertex is which, which edge joins a and b, where ports sit)
 * comes from GameView.board; nothing here re-derives it.
 */
import type { Board, Edge, EdgeId, Hex, HexId, Vertex, VertexId } from '@shared/types';

export interface BoardIndex {
  hex: Map<HexId, Hex>;
  vertex: Map<VertexId, Vertex>;
  edge: Map<EdgeId, Edge>;
  scale: number;
  viewBox: string;
}

export function hexCorners(cx: number, cy: number, s: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = ((-90 + 60 * i) * Math.PI) / 180;
    out.push({ x: cx + s * Math.cos(angle), y: cy + s * Math.sin(angle) });
  }
  return out;
}

export function hexPath(cx: number, cy: number, s: number): string {
  return hexCorners(cx, cy, s)
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join(' ')
    .concat(' Z');
}

/** Union of every vertex and port tag, padded a hair, rounded to 2 decimals. */
function computeViewBox(board: Board, s: number): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of board.vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  // The port tag is 1.02S by 0.42S, centred on the port anchor.
  for (const port of board.ports) {
    minX = Math.min(minX, port.x - 0.51 * s);
    maxX = Math.max(maxX, port.x + 0.51 * s);
    minY = Math.min(minY, port.y - 0.21 * s);
    maxY = Math.max(maxY, port.y + 0.21 * s);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return '0 0 10 10';
  // 0.75S of air around a 10S island wasted a fifth of the frame. A quarter of
  // that still keeps port tags and building corners off the mat edge.
  const pad = 0.28 * s;
  const x = Math.floor((minX - pad) * 100) / 100;
  const y = Math.floor((minY - pad) * 100) / 100;
  const w = Math.ceil((maxX + pad) * 100) / 100 - x;
  const h = Math.ceil((maxY + pad) * 100) / 100 - y;
  return `${x} ${y} ${w} ${h}`;
}

export function indexBoard(board: Board): BoardIndex {
  const distances: number[] = [];
  const vertexMap = new Map<VertexId, Vertex>();
  for (const vertex of board.vertices) vertexMap.set(vertex.id, vertex);
  for (const hex of board.hexes) {
    for (const id of hex.vertices) {
      const vertex = vertexMap.get(id);
      if (!vertex) continue;
      distances.push(Math.hypot(vertex.x - hex.x, vertex.y - hex.y));
    }
  }
  distances.sort((a, b) => a - b);
  const mid = Math.floor(distances.length / 2);
  const scale =
    distances.length === 0
      ? 1
      : distances.length % 2 === 1
        ? distances[mid] ?? 1
        : ((distances[mid - 1] ?? 1) + (distances[mid] ?? 1)) / 2;

  const hex = new Map<HexId, Hex>();
  for (const item of board.hexes) hex.set(item.id, item);
  const edge = new Map<EdgeId, Edge>();
  for (const item of board.edges) edge.set(item.id, item);
  return { hex, vertex: vertexMap, edge, scale, viewBox: computeViewBox(board, scale) };
}

/** Point along an edge, `t` from 0 (a) to 1 (b). */
export function alongEdge(edge: Edge, a: Vertex, b: Vertex, t: number): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Inset road path: trim 0.05 of the edge at each end. */
export function roadPath(edge: Edge, from: Vertex, to: Vertex): string {
  const start = alongEdge(edge, from, to, 0.05);
  const end = alongEdge(edge, from, to, 0.95);
  return `M${round(start.x)} ${round(start.y)} L${round(end.x)} ${round(end.y)}`;
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
