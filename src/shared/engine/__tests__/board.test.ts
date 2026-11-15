import { describe, expect, it } from 'vitest';
import { buildBoard, desertHexId } from '../board.js';
import { generateMap } from '../map.js';
import { HEX_TEMPLATE, PORT_ORDER } from '../../board-template.js';
import { DEFAULT_MAP_SETTINGS } from '../../map-settings.js';
import type { Board } from '../../types.js';

/** The classic layout the rest of these tests measure. */
function classicLayout() {
  return generateMap(DEFAULT_MAP_SETTINGS, 1).layout;
}

function byId(board: Board): Map<string, { x: number; y: number }> {
  return new Map(board.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }]));
}

describe('board topology', () => {
  const board = buildBoard(classicLayout(), { rotation: 0, mirror: 0 });

  it('has 19 hexes, 54 vertices, 72 edges, 30 coastal edges and 9 ports', () => {
    expect(board.hexes).toHaveLength(19);
    expect(board.vertices).toHaveLength(54);
    expect(board.edges).toHaveLength(72);
    expect(board.edges.filter((edge) => edge.coastal)).toHaveLength(30);
    expect(board.ports).toHaveLength(9);
  });

  it('keeps the designed terrain mix and number tokens', () => {
    const terrain: Record<string, number> = {};
    for (const hex of board.hexes) terrain[hex.terrain] = (terrain[hex.terrain] ?? 0) + 1;
    expect(terrain).toEqual({ wood: 4, wheat: 4, sheep: 4, brick: 3, ore: 3, desert: 1 });

    const tokens = board.hexes
      .map((hex) => hex.token)
      .filter((token): token is number => token !== null)
      .sort((a, b) => a - b);
    expect(tokens).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    expect(board.hexes.find((hex) => hex.id === 'C3')?.token).toBeNull();
    expect(board.hexes.find((hex) => hex.id === 'C3')?.terrain).toBe('desert');
  });

  it('derives a consistent graph: shared corners, two-hex interior edges, six per hex', () => {
    for (const hex of board.hexes) {
      expect(hex.vertices).toHaveLength(6);
      expect(hex.edges).toHaveLength(6);
      expect(new Set(hex.vertices).size).toBe(6);
      expect(new Set(hex.edges).size).toBe(6);
      // Side k connects corner k and k + 1.
      for (let k = 0; k < 6; k += 1) {
        const side = board.edges.find((edge) => edge.id === hex.edges[k]);
        expect(side).toBeDefined();
        const a = hex.vertices[k];
        const b = hex.vertices[(k + 1) % 6];
        expect([side?.a, side?.b].sort()).toEqual([a, b].sort());
        expect(side?.hexes).toContain(hex.id);
      }
    }

    for (const edge of board.edges) {
      expect(edge.hexes.length === 1 || edge.hexes.length === 2).toBe(true);
      expect(edge.coastal).toBe(edge.hexes.length === 1);
    }
    const interior = board.edges.filter((edge) => !edge.coastal);
    expect(interior).toHaveLength(42);
  });

  it('gives every vertex the edges that name it and symmetric neighbours', () => {
    for (const vertex of board.vertices) {
      expect(vertex.edges.length).toBeGreaterThanOrEqual(2);
      for (const edgeId of vertex.edges) {
        const edge = board.edges.find((item) => item.id === edgeId);
        expect(edge).toBeDefined();
        expect([edge?.a, edge?.b]).toContain(vertex.id);
      }
      expect(vertex.hexes.length).toBeGreaterThanOrEqual(1);
      expect(vertex.hexes.length).toBeLessThanOrEqual(3);
    }
  });

  it('shares vertex coordinates exactly between hexes and vertex records', () => {
    const positions = byId(board);
    const seen = new Set<string>();
    for (const hex of board.hexes) {
      let sumX = 0;
      let sumY = 0;
      for (const vertexId of hex.vertices) {
        const position = positions.get(vertexId);
        expect(position).toBeDefined();
        seen.add(`${position?.x},${position?.y}`);
        sumX += position?.x ?? 0;
        sumY += position?.y ?? 0;
      }
      // A regular hexagon's corners average to its centre.
      expect(sumX / 6).toBeCloseTo(hex.x, 9);
      expect(sumY / 6).toBeCloseTo(hex.y, 9);
    }
    expect(seen.size).toBe(54);
  });

  it('places 9 ports on distinct coastal edges with the designed mix', () => {
    const portEdges = new Set(board.ports.map((port) => port.edge));
    expect(portEdges.size).toBe(9);
    for (const port of board.ports) {
      const edge = board.edges.find((item) => item.id === port.edge);
      expect(edge?.coastal).toBe(true);
      expect([edge?.a, edge?.b].sort()).toEqual([...port.vertices].sort());
    }

    const generic = board.ports.filter((port) => port.resource === 'generic');
    expect(generic).toHaveLength(4);
    expect(generic.every((port) => port.rate === 3)).toBe(true);
    const specific = board.ports.filter((port) => port.resource !== 'generic');
    expect(specific).toHaveLength(5);
    expect(specific.every((port) => port.rate === 2)).toBe(true);
    expect(specific.map((port) => port.resource).sort()).toEqual([
      'brick',
      'ore',
      'sheep',
      'wheat',
      'wood',
    ]);
  });

  it('follows PORT_ORDER clockwise from the top-left coastal edge', () => {
    // port-0 is the topmost, leftmost coastal edge; the ring then runs clockwise.
    for (let i = 0; i < board.ports.length; i += 1) {
      expect(board.ports[i]?.resource).toBe(PORT_ORDER[i]?.resource);
      expect(board.ports[i]?.rate).toBe(PORT_ORDER[i]?.rate);
    }
    // Screen coordinates put y downwards, so a clockwise ring has increasing
    // atan2 angles. Unwrap across the +pi/-pi seam.
    const angles: number[] = [];
    for (const port of board.ports) {
      let angle = Math.atan2(port.y, port.x);
      if (angles.length > 0) {
        const previous = angles[angles.length - 1] as number;
        while (angle <= previous) angle += Math.PI * 2;
      }
      angles.push(angle);
    }
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i] as number).toBeGreaterThan(angles[i - 1] as number);
    }
    // port-0 is the top-left coastal edge: above the midline, left of centre.
    const first = board.ports[0];
    expect(first?.y ?? 0).toBeLessThan(0);
    expect(first?.x ?? 0).toBeLessThan(0);
  });

  it('does not let two ports share a vertex', () => {
    const used = new Set<string>();
    for (const port of board.ports) {
      for (const vertex of port.vertices) {
        expect(used.has(vertex)).toBe(false);
        used.add(vertex);
      }
    }
  });

  it('puts the robber start on the desert', () => {
    expect(desertHexId(board)).toBe('C3');
  });

  it('keeps hex ids attached to their terrain across all twelve orientations', () => {
    const hexIds = HEX_TEMPLATE.map((hex) => hex.id);
    const terrains = new Map(HEX_TEMPLATE.map((hex) => [hex.id, hex.terrain]));
    for (let rotation = 0; rotation < 6; rotation += 1) {
      for (let mirror = 0; mirror < 2; mirror += 1) {
        const variant = buildBoard(classicLayout(), { rotation, mirror });
        expect(variant.hexes).toHaveLength(19);
        expect(variant.vertices).toHaveLength(54);
        expect(variant.edges).toHaveLength(72);
        expect(variant.ports).toHaveLength(9);
        expect(variant.hexes.map((hex) => hex.id)).toEqual(hexIds);
        for (const hex of variant.hexes) expect(hex.terrain).toBe(terrains.get(hex.id));
        for (const vertex of variant.vertices) {
          expect(Number.isFinite(vertex.x)).toBe(true);
          expect(Number.isFinite(vertex.y)).toBe(true);
        }
      }
    }
  });

  it('is deterministic per orientation and actually varies the geometry', () => {
    const a = buildBoard(classicLayout(), { rotation: 3, mirror: 1 });
    const b = buildBoard(classicLayout(), { rotation: 3, mirror: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const base = buildBoard(classicLayout(), { rotation: 0, mirror: 0 });
    expect({ ...base.vertices[0] }).not.toEqual({ ...a.vertices[0] });

    // Twelve distinct terrain layouts: the hex positions (in template order)
    // differ for every rotation/mirror combination.
    const signatures = new Set<string>();
    for (let rotation = 0; rotation < 6; rotation += 1) {
      for (let mirror = 0; mirror < 2; mirror += 1) {
        const boardVariant = buildBoard(classicLayout(), { rotation, mirror });
        signatures.add(
          boardVariant.hexes
            .map((hex) => `${hex.id}:${hex.x.toFixed(3)}:${hex.y.toFixed(3)}`)
            .join(','),
        );
      }
    }
    expect(signatures.size).toBe(12);
  });
});
