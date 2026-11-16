import { useMemo, useState } from 'react';
import type { Building, EdgeId, GameView, HexId, Resource, Seat, Terrain, VertexId } from '@shared/types';
import { ResourceShape, seatColor } from '../ui/icons';
import { hexPath, indexBoard, roadPath, round } from './geometry';
import type { BoardIndex } from './geometry';

export type BoardMode = 'idle' | 'setupSettlement' | 'setupRoad' | 'road' | 'settlement' | 'city' | 'robber';

export interface BoardTarget {
  kind: 'vertex' | 'edge' | 'hex';
  id: string;
}

export interface Floater {
  id: string;
  x: number;
  y: number;
  text: string;
  tone: 'gain' | 'blocked' | 'renown';
}

interface BoardSvgProps {
  view: GameView;
  mode: BoardMode;
  legalVertices: string[];
  legalEdges: string[];
  legalHexes: string[];
  selected: BoardTarget | null;
  floaters: Floater[];
  flashHexes: string[];
  onSelect: (target: BoardTarget) => void;
  onHover: (target: BoardTarget | null, point: { x: number; y: number } | null) => void;
}

const TERRAIN_FILL: Record<Terrain, string> = {
  wood: '#3f5d3a',
  brick: '#8c4a34',
  sheep: '#7d8f56',
  wheat: '#b58a3c',
  ore: '#5d626b',
  desert: '#c9b287',
};

export function BoardSvg({
  view,
  mode,
  legalVertices,
  legalEdges,
  legalHexes,
  selected,
  floaters,
  flashHexes,
  onSelect,
  onHover,
}: BoardSvgProps): JSX.Element {
  const [hover, setHover] = useState<BoardTarget | null>(null);
  const index = useMemo(() => indexBoard(view.board), [view.board]);
  const s = index.scale;
  const legalVertexSet = useMemo(() => new Set(legalVertices), [legalVertices]);
  const legalEdgeSet = useMemo(() => new Set(legalEdges), [legalEdges]);
  const legalHexSet = useMemo(() => new Set(legalHexes), [legalHexes]);
  const flashSet = useMemo(() => new Set(flashHexes), [flashHexes]);

  const hoverPoint = (event: React.PointerEvent): { x: number; y: number } => ({ x: event.clientX, y: event.clientY });

  const pick = (target: BoardTarget) => {
    onSelect(target);
  };

  const interactive = mode !== 'idle';

  return (
    <svg
      className={`board-svg mode-${mode}`}
      viewBox={index.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-live="polite"
      aria-label={boardSummary(view)}
    >
      <defs>
        <pattern id="robberHatch" width={0.16 * s} height={0.16 * s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={0.16 * s} stroke="#241d12" strokeOpacity="0.32" strokeWidth={0.035 * s} />
        </pattern>
        <pattern id="seaGrain" width={0.5 * s} height={0.5 * s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={0.5 * s} stroke="#8fc0a9" strokeOpacity="0.05" strokeWidth={0.02 * s} />
        </pattern>
      </defs>

      <rect x="-50%" y="-50%" width="200%" height="200%" fill="url(#seaGrain)" aria-hidden="true" />

      <PortLayer view={view} index={index} setHover={setHover} onHover={onHover} />

      <HexLayer
        view={view}
        index={index}
        hover={hover}
        setHover={setHover}
        onHover={onHover}
        legalHexSet={legalHexSet}
        flashSet={flashSet}
        interactive={interactive && mode === 'robber'}
        onPick={pick}
        hoverPoint={hoverPoint}
      />

      <RoadLayer view={view} index={index} />
      <RobberLayer view={view} index={index} />

      <BuildingLayer view={view} index={index} />

      {mode === 'setupSettlement' || mode === 'setupRoad' ? (
        <rect x="-50%" y="-50%" width="200%" height="200%" fill="#241d12" opacity="0.12" pointerEvents="none" aria-hidden="true" />
      ) : null}

      {(mode === 'road' || mode === 'setupRoad' || mode === 'settlement' || mode === 'setupSettlement' || mode === 'city') ? (
        <TargetLayer
          mode={mode}
          index={index}
          legalVertexSet={legalVertexSet}
          legalEdgeSet={legalEdgeSet}
          view={view}
          selected={selected}
          hover={hover}
          setHover={setHover}
          onHover={onHover}
          onPick={pick}
          hoverPoint={hoverPoint}
        />
      ) : null}

      {mode === 'robber' ? (
        <RobberTargetLayer
          index={index}
          legalHexSet={legalHexSet}
          selected={selected}
          hover={hover}
          setHover={setHover}
          onHover={onHover}
          onPick={pick}
          hoverPoint={hoverPoint}
        />
      ) : null}

      {floaters.map((floater) => (
        <g key={floater.id} className={`floater floater-${floater.tone}`} aria-hidden="true">
          <text x={round(floater.x)} y={round(floater.y)} textAnchor="middle" className="floater-text">
            {floater.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

function boardSummary(view: GameView): string {
  const you = view.players[view.you];
  const active = view.players[view.currentSeat];
  if (!you || !active) return 'Game board';
  const res = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[])
    .filter((r) => you.resources[r] > 0)
    .map((r) => `${you.resources[r]} ${r}`)
    .join(', ');
  const gains = view.dice
    ? Object.values(view.dice.gains).reduce((sum, gain) => sum + Object.values(gain).reduce((a, b) => a + (b ?? 0), 0), 0)
    : 0;
  return `Turn ${view.turn}. ${active.name} is active. ${gains > 0 ? `Last roll produced ${gains} resources. ` : ''}You hold ${res || 'nothing'}. Victory target ${view.targetVp}.`;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

interface HoverProps {
  hover: BoardTarget | null;
  setHover: (target: BoardTarget | null) => void;
  onHover: (target: BoardTarget | null, point: { x: number; y: number } | null) => void;
  hoverPoint: (event: React.PointerEvent) => { x: number; y: number };
}

function PortLayer({ view, index, setHover, onHover }: { view: GameView; index: BoardIndex } & Omit<HoverProps, 'hover' | 'hoverPoint'>): JSX.Element {
  const s = index.scale;
  const w = 1.02 * s;
  const h = 0.42 * s;
  return (
    <g className="ports">
      {view.board.ports.map((port) => {
        const edge = index.edge.get(port.edge);
        const a = edge ? index.vertex.get(edge.a) : undefined;
        const b = edge ? index.vertex.get(edge.b) : undefined;
        const owned = port.vertices.some((id) => view.buildings[id]?.owner === view.you);
        const midX = a && b ? (a.x + b.x) / 2 : port.x;
        const midY = a && b ? (a.y + b.y) / 2 : port.y;
        return (
          <g key={port.id} className={`port${owned ? ' port-owned' : ''}`}>
            <line x1={round(port.x)} y1={round(port.y)} x2={round(midX)} y2={round(midY)} className="port-rope" />
            <g
              tabIndex={0}
              role="img"
              aria-label={portLabel(port.resource, port.rate, owned)}
              onPointerEnter={(event) => {
                setHover({ kind: 'hex', id: `port:${port.id}` });
                onHover({ kind: 'hex', id: `port:${port.id}` }, { x: event.clientX, y: event.clientY });
              }}
              onPointerLeave={() => {
                setHover(null);
                onHover(null, null);
              }}
            >
              <rect
                x={round(port.x - w / 2)}
                y={round(port.y - h / 2)}
                width={round(w)}
                height={round(h)}
                rx={0.05 * s}
                className="port-tag"
              />
              {port.resource === 'generic' ? (
                <text x={round(port.x)} y={round(port.y + 0.075 * s)} textAnchor="middle" className="port-rate" style={{ fontSize: round(0.22 * s) }}>
                  3:1
                </text>
              ) : (
                <>
                  <g
                    transform={`translate(${round(port.x - 0.30 * s)} ${round(port.y - 0.14 * s)}) scale(${round((0.28 * s) / 24)})`}
                    className={`terrain-glyph res-${port.resource}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <ResourceShape resource={port.resource} />
                  </g>
                  <text x={round(port.x + 0.13 * s)} y={round(port.y + 0.075 * s)} textAnchor="middle" className="port-rate" style={{ fontSize: round(0.22 * s) }}>
                    2:1
                  </text>
                </>
              )}
              {owned ? <circle cx={round(port.x + w / 2 - 0.08 * s)} cy={round(port.y - h / 2 + 0.07 * s)} r={0.035 * s} className="port-dot" /> : null}
            </g>
          </g>
        );
      })}
    </g>
  );
}

function portLabel(resource: Resource | 'generic', rate: 2 | 3, owned: boolean): string {
  const name = resource === 'generic' ? 'Generic port' : `${resource[0]?.toUpperCase()}${resource.slice(1)} port`;
  const rateText = resource === 'generic' ? 'Any 3 for 1.' : `${rate} ${resource} for 1 of anything.`;
  return `${name}. ${rateText} ${owned ? 'You own this port.' : 'You do not own this port.'}`;
}

function HexLayer({
  view,
  index,
  setHover,
  onHover,
  legalHexSet,
  flashSet,
  interactive,
  onPick,
  hoverPoint,
}: {
  view: GameView;
  index: BoardIndex;
  legalHexSet: Set<string>;
  flashSet: Set<string>;
  interactive: boolean;
  onPick: (target: BoardTarget) => void;
} & HoverProps): JSX.Element {
  const s = index.scale;
  return (
    <g className="hexes">
      {view.board.hexes.map((hex) => {
        const isRobber = hex.id === view.robberHex;
        const flash = flashSet.has(hex.id);
        const fill = TERRAIN_FILL[hex.terrain];
        // The terrain badge sits above the number token, not under it. At the
        // old centre-bottom position the token disc covered most of the glyph,
        // which is why the resource was hard to read on the board.
        const hasToken = hex.token !== null;
        const iconScale = (0.28 * s) / 24;
        const iconY = hex.y + (hasToken ? -0.6 * s : 0.05 * s);
        const legal = interactive && legalHexSet.has(hex.id);
        return (
          <g
            key={hex.id}
            className={`hex${isRobber ? ' hex-robber' : ''}${flash ? ' hex-flash' : ''}${legal ? ' hex-legal' : ''}`}
            onPointerEnter={(event) => {
              setHover({ kind: 'hex', id: hex.id });
              onHover({ kind: 'hex', id: hex.id }, { x: event.clientX, y: event.clientY });
            }}
            onPointerLeave={() => {
              setHover(null);
              onHover(null, null);
            }}
            onPointerMove={(event) => onHover({ kind: 'hex', id: hex.id }, hoverPoint(event))}
            onClick={() => {
              if (legal) onPick({ kind: 'hex', id: hex.id });
            }}
            style={{ cursor: legal ? 'pointer' : 'default' }}
          >
            <path d={hexPath(hex.x, hex.y, s)} fill={fill} className="hex-fill" />
            <path d={hexPath(hex.x, hex.y, s * 0.86)} fill="none" className="hex-shade" />
            <g className="terrain-badge-group" aria-hidden="true">
              <circle cx={round(hex.x)} cy={round(iconY)} r={round(0.2 * s)} className="terrain-badge" />
              <g
                transform={`translate(${round(hex.x - 12 * iconScale)} ${round(iconY - 12 * iconScale)}) scale(${round(iconScale)})`}
                className={`terrain-glyph terrain-${hex.terrain}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={isRobber ? 0.45 : 1}
              >
                <ResourceShape resource={hex.terrain} />
              </g>
            </g>
            {hex.token !== null ? (
              <NumberToken x={hex.x} y={hex.y} token={hex.token} s={s} flash={flash} />
            ) : null}
            {isRobber ? <path d={hexPath(hex.x, hex.y, s)} fill="url(#robberHatch)" className="robber-hatch" /> : null}
          </g>
        );
      })}
    </g>
  );
}

function NumberToken({ x, y, token, s, flash }: { x: number; y: number; token: number; s: number; flash: boolean }): JSX.Element {
  const strong = token === 6 || token === 8;
  const pips = Math.max(1, 6 - Math.abs(7 - token));
  const pipY = y + 0.17 * s;
  const startX = x - ((pips - 1) * 0.062 * s) / 2;
  return (
    <g className={`token${strong ? ' token-strong' : ''}${flash ? ' token-flash' : ''}`} aria-label={`Number ${token}`}>
      <circle cx={round(x)} cy={round(y)} r={round(0.3 * s)} className="token-disc" />
      {strong ? <circle cx={round(x)} cy={round(y)} r={round(0.36 * s)} className="token-ring-outer" /> : null}
      {strong ? <circle cx={round(x)} cy={round(y)} r={round(0.325 * s)} className="token-ring-inner" /> : null}
      <text x={round(x)} y={round(y + 0.075 * s)} textAnchor="middle" className="token-num" style={{ fontSize: round((strong ? 0.36 : 0.34) * s) }}>
        {token}
      </text>
      {Array.from({ length: pips }).map((_, i) => (
        <circle
          key={i}
          cx={round(startX + i * 0.062 * s)}
          cy={round(pipY)}
          r={round(0.036 * s)}
          className={strong ? 'token-pip token-pip-strong' : 'token-pip'}
        />
      ))}
    </g>
  );
}

function RoadLayer({ view, index }: { view: GameView; index: BoardIndex }): JSX.Element {
  const s = index.scale;
  return (
    <g className="roads">
      {Object.entries(view.roads).map(([edgeId, seat]) => {
        const edge = index.edge.get(edgeId as EdgeId);
        if (!edge) return null;
        const a = index.vertex.get(edge.a);
        const b = index.vertex.get(edge.b);
        if (!a || !b) return null;
        const d = roadPath(edge, a, b);
        const color = seatColor(seat);
        return (
          <g key={edgeId} className={`road road-seat${seat + 1}`}>
            <path d={d} className="road-casing" strokeWidth={round(0.2 * s)} />
            <path d={d} stroke={color} strokeWidth={round(0.14 * s)} className="road-body" />
            {seat === 1 ? (
              <path d={d} className="road-pattern road-stripe" strokeWidth={round(0.035 * s)} strokeDasharray={`${round(0.14 * s)} ${round(0.05 * s)}`} />
            ) : null}
            {seat === 2 ? (
              <>
                <path d={d} className="road-pattern road-double" strokeWidth={round(0.018 * s)} transform={`translate(0 ${round(-0.04 * s)})`} />
                <path d={d} className="road-pattern road-double" strokeWidth={round(0.018 * s)} transform={`translate(0 ${round(0.04 * s)})`} />
              </>
            ) : null}
            {seat === 3 ? (
              <path d={d} className="road-pattern road-stripe" strokeWidth={round(0.04 * s)} strokeDasharray={`${round(0.06 * s)} ${round(0.09 * s)}`} />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function RobberLayer({ view, index }: { view: GameView; index: BoardIndex }): JSX.Element {
  const hex = index.hex.get(view.robberHex);
  if (!hex) return <g />;
  const s = index.scale;
  const x = hex.x;
  const y = hex.y - 0.1 * s;
  return (
    <g className="robber" aria-label={`Robber on ${hex.terrain} ${hex.token ?? ''}`}>
      <path
        d={`M${round(x - 0.17 * s)} ${round(y + 0.18 * s)} L${round(x - 0.12 * s)} ${round(y - 0.08 * s)} Q${round(x)} ${round(y - 0.26 * s)} ${round(x + 0.12 * s)} ${round(y - 0.08 * s)} L${round(x + 0.17 * s)} ${round(y + 0.18 * s)} Z`}
        className="robber-body"
      />
      <rect x={round(x - 0.075 * s)} y={round(y - 0.02 * s)} width={round(0.15 * s)} height={round(0.035 * s)} rx={round(0.012 * s)} className="robber-eye" />
    </g>
  );
}

function BuildingLayer({ view, index }: { view: GameView; index: BoardIndex }): JSX.Element {
  return (
    <g className="buildings">
      {Object.entries(view.buildings).map(([vertexId, building]) => {
        const vertex = index.vertex.get(vertexId as VertexId);
        if (!vertex) return null;
        return <BuildingShape key={`${vertexId}-${building.type}`} building={building} x={vertex.x} y={vertex.y} s={index.scale} />;
      })}
    </g>
  );
}

function BuildingShape({ building, x, y, s }: { building: Building; x: number; y: number; s: number }): JSX.Element {
  const seat = building.owner;
  const color = seatColor(seat);
  const city = building.type === 'city';
  const w = (city ? 0.6 : 0.46) * s;
  const h = (city ? 0.52 : 0.4) * s;
  const left = x - w / 2;
  const right = x + w / 2;
  const top = y - h;
  const outline = '#241d12';

  const body = (() => {
    if (seat === 1) {
      // round tower
      return <rect x={round(left)} y={round(top + 0.08 * s)} width={round(w)} height={round(h - 0.08 * s)} rx={round(w / 2)} className="building-body" style={{ fill: color }} />;
    }
    if (seat === 2) {
      // octagon
      const cut = 0.11 * s;
      return (
        <polygon
          points={`${round(left + cut)},${round(top)} ${round(right - cut)},${round(top)} ${round(right)},${round(top + cut)} ${round(right)},${round(y - cut)} ${round(right - cut)},${round(y)} ${round(left + cut)},${round(y)} ${round(left)},${round(y - cut)} ${round(left)},${round(top + cut)}`}
          className="building-body"
          style={{ fill: color }}
        />
      );
    }
    if (seat === 3) {
      // tall tower
      return <rect x={round(left + 0.04 * s)} y={round(top - 0.04 * s)} width={round(w - 0.08 * s)} height={round(h + 0.04 * s)} className="building-body" style={{ fill: color }} />;
    }
    // square tower
    return <rect x={round(left)} y={round(top + 0.02 * s)} width={round(w)} height={round(h - 0.02 * s)} className="building-body" style={{ fill: color }} />;
  })();

  return (
    <g className={`building building-seat${seat + 1}${city ? ' building-city' : ' building-settlement'}`} aria-label={`${city ? 'City' : 'Settlement'}, player ${seat + 1}`}>
      <ellipse cx={round(x)} cy={round(y + 0.02 * s)} rx={round(w * 0.62)} ry={round(0.055 * s)} className="building-shadow" />
      {body}
      <path d={`M${round(left + 0.04 * s)} ${round(top + 0.12 * s)} V${round(y - 0.05 * s)}`} className="building-highlight" />
      {city ? (
        <>
          <path
            d={`M${round(left)} ${round(top + 0.08 * s)} v${round(-0.1 * s)} h${round(w * 0.16)} v${round(0.055 * s)} h${round(w * 0.14)} v${round(-0.055 * s)} h${round(w * 0.14)} v${round(0.055 * s)} h${round(w * 0.14)} v${round(-0.055 * s)} h${round(w * 0.16)} v${round(0.1 * s)} Z`}
            className="building-crenels"
            style={{ fill: color }}
          />
          <path d={`M${round(left + 0.04 * s)} ${round(y - 0.12 * s)} h${round(w - 0.08 * s)}`} className="building-gold-band" />
        </>
      ) : null}
      {seat === 0 ? <path d={`M${round(x)} ${round(y - 0.16 * s)} v${round(0.09 * s)} m${round(-0.035 * s)} ${round(-0.035 * s)} h${round(0.07 * s)}`} className="building-notch" /> : null}
      {seat === 1 ? <path d={`M${round(left + 0.06 * s)} ${round(y - 0.1 * s)} q${round(0.07 * s)} ${round(-0.04 * s)} ${round(0.14 * s)} 0 t${round(0.14 * s)} 0`} className="building-band" /> : null}
      {seat === 2 ? <circle cx={round(x)} cy={round(y - 0.15 * s)} r={round(0.035 * s)} className="building-coin" /> : null}
      {seat === 3 ? <path d={`M${round(x)} ${round(top + 0.06 * s)} l${round(0.05 * s)} ${round(0.06 * s)} l${round(-0.05 * s)} ${round(0.06 * s)} l${round(-0.05 * s)} ${round(-0.06 * s)} Z`} className="building-diamond" /> : null}
    </g>
  );
}

function TargetLayer({
  mode,
  index,
  legalVertexSet,
  legalEdgeSet,
  view,
  selected,
  hover,
  setHover,
  onHover,
  onPick,
  hoverPoint,
}: {
  mode: BoardMode;
  index: BoardIndex;
  legalVertexSet: Set<string>;
  legalEdgeSet: Set<string>;
  view: GameView;
  selected: BoardTarget | null;
  onPick: (target: BoardTarget) => void;
} & HoverProps): JSX.Element {
  const s = index.scale;
  const vertexMode = mode === 'settlement' || mode === 'setupSettlement' || mode === 'city';
  return (
    <g className="targets">
      {vertexMode
        ? Array.from(legalVertexSet).map((id) => {
            const vertex = index.vertex.get(id);
            if (!vertex) return null;
            const isHover = hover?.kind === 'vertex' && hover.id === id;
            const isSelected = selected?.kind === 'vertex' && selected.id === id;
            const isCity = mode === 'city';
            return (
              <g
                key={id}
                tabIndex={0}
                role="button"
                aria-label={vertexTooltip(view, index, id, mode === 'setupSettlement')}
                className={`target target-vertex${isHover ? ' target-hover' : ''}${isSelected ? ' target-selected' : ''}${mode === 'setupSettlement' ? ' target-setup' : ''}`}
                onPointerEnter={(event) => {
                  setHover({ kind: 'vertex', id });
                  onHover({ kind: 'vertex', id }, { x: event.clientX, y: event.clientY });
                }}
                onPointerLeave={() => {
                  setHover(null);
                  onHover(null, null);
                }}
                onPointerMove={(event) => onHover({ kind: 'vertex', id }, hoverPoint(event))}
                onFocus={() => {
                  setHover({ kind: 'vertex', id });
                  onHover({ kind: 'vertex', id }, null);
                }}
                onClick={() => onPick({ kind: 'vertex', id })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPick({ kind: 'vertex', id });
                  }
                }}
              >
                <circle cx={round(vertex.x)} cy={round(vertex.y)} r={round(0.55 * s)} className="target-hit" />
                <circle cx={round(vertex.x)} cy={round(vertex.y)} r={round(0.24 * s)} className="target-ring" />
                {isHover ? <circle cx={round(vertex.x)} cy={round(vertex.y)} r={round(0.24 * s)} className="target-fill" /> : null}
                {isCity ? <path d={`M${round(vertex.x)} ${round(vertex.y - 0.42 * s)} l${round(0.1 * s)} ${round(0.12 * s)} l${round(-0.1 * s)} ${round(0.12 * s)} l${round(-0.1 * s)} ${round(-0.12 * s)} Z`} className="target-chevron" /> : null}
                {isSelected ? <Brackets x={vertex.x} y={vertex.y} r={0.3 * s} /> : null}
              </g>
            );
          })
        : null}

      {!vertexMode
        ? Array.from(legalEdgeSet).map((id) => {
            const edge = index.edge.get(id);
            if (!edge) return null;
            const a = index.vertex.get(edge.a);
            const b = index.vertex.get(edge.b);
            if (!a || !b) return null;
            const d = roadPath(edge, a, b);
            const isHover = hover?.kind === 'edge' && hover.id === id;
            const isSelected = selected?.kind === 'edge' && selected.id === id;
            return (
              <g
                key={id}
                tabIndex={0}
                role="button"
                aria-label={edgeLabel(view, index, id)}
                className={`target target-edge${isHover ? ' target-hover' : ''}${isSelected ? ' target-selected' : ''}`}
                onPointerEnter={(event) => {
                  setHover({ kind: 'edge', id });
                  onHover({ kind: 'edge', id }, { x: event.clientX, y: event.clientY });
                }}
                onPointerLeave={() => {
                  setHover(null);
                  onHover(null, null);
                }}
                onPointerMove={(event) => onHover({ kind: 'edge', id }, hoverPoint(event))}
                onFocus={() => {
                  setHover({ kind: 'edge', id });
                  onHover({ kind: 'edge', id }, null);
                }}
                onClick={() => onPick({ kind: 'edge', id })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPick({ kind: 'edge', id });
                  }
                }}
              >
                <path d={d} className="target-edge-hit" strokeWidth={round(0.6 * s)} />
                <path d={d} className="target-edge-ring" strokeWidth={round(0.13 * s)} />
                {isHover ? <path d={d} className="target-edge-core" strokeWidth={round(0.04 * s)} /> : null}
                {isSelected ? <path d={d} className="target-edge-selected" strokeWidth={round(0.2 * s)} /> : null}
              </g>
            );
          })
        : null}
    </g>
  );
}

function RobberTargetLayer({
  index,
  legalHexSet,
  selected,
  hover,
  setHover,
  onHover,
  onPick,
  hoverPoint,
}: {
  index: BoardIndex;
  legalHexSet: Set<string>;
  selected: BoardTarget | null;
  onPick: (target: BoardTarget) => void;
} & HoverProps): JSX.Element {
  const s = index.scale;
  return (
    <g className="targets">
      {Array.from(legalHexSet).map((id) => {
        const hex = index.hex.get(id);
        if (!hex) return null;
        const isHover = hover?.kind === 'hex' && hover.id === id;
        const isSelected = selected?.kind === 'hex' && selected.id === id;
        return (
          <g
            key={id}
            tabIndex={0}
            role="button"
            aria-label={`Move the robber to ${hex.terrain} ${hex.token ?? 'desert'}`}
            className={`target target-hex${isHover ? ' target-hover' : ''}${isSelected ? ' target-selected' : ''}`}
            onPointerEnter={(event) => {
              setHover({ kind: 'hex', id });
              onHover({ kind: 'hex', id }, { x: event.clientX, y: event.clientY });
            }}
            onPointerLeave={() => {
              setHover(null);
              onHover(null, null);
            }}
            onPointerMove={(event) => onHover({ kind: 'hex', id }, hoverPoint(event))}
            onFocus={() => {
              setHover({ kind: 'hex', id });
              onHover({ kind: 'hex', id }, null);
            }}
            onClick={() => onPick({ kind: 'hex', id })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onPick({ kind: 'hex', id });
              }
            }}
          >
            <path d={hexPath(hex.x, hex.y, s * 0.9)} fill="transparent" className="target-hex-hit" />
            <path d={hexPath(hex.x, hex.y, s * 0.9)} className="target-hex-ring" />
            {isHover ? <path d={hexPath(hex.x, hex.y, s * 0.9)} className="target-hex-fill" /> : null}
            {isSelected ? <path d={hexPath(hex.x, hex.y, s * 0.86)} className="target-hex-selected" /> : null}
          </g>
        );
      })}
    </g>
  );
}

function Brackets({ x, y, r }: { x: number; y: number; r: number }): JSX.Element {
  const len = r * 0.55;
  const corners = [
    { cx: x - r, cy: y - r, dx: 1, dy: 1 },
    { cx: x + r, cy: y - r, dx: -1, dy: 1 },
    { cx: x - r, cy: y + r, dx: 1, dy: -1 },
    { cx: x + r, cy: y + r, dx: -1, dy: -1 },
  ];
  return (
    <g className="brackets">
      {corners.map((corner, index) => (
        <path
          key={index}
          d={`M${round(corner.cx + len * corner.dx)} ${round(corner.cy)} L${round(corner.cx)} ${round(corner.cy)} L${round(corner.cx)} ${round(corner.cy + len * corner.dy)}`}
          className="bracket"
        />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Tooltip text
// ---------------------------------------------------------------------------

export function hexLabel(view: GameView, index: BoardIndex, hexId: string): string {
  const hex = index.hex.get(hexId);
  if (!hex) return '';
  const terrain = hex.terrain === 'desert' ? 'Desert' : `${hex.terrain[0]?.toUpperCase()}${hex.terrain.slice(1)}`;
  const token = hex.token;
  const mine = hex.vertices.filter((id) => view.buildings[id]?.owner === view.you).length;
  const theirs = hex.vertices.filter((id) => view.buildings[id] && view.buildings[id]?.owner !== view.you).length;
  const bits: string[] = [];
  if (token !== null) bits.push(`${terrain} ${token}.`);
  else bits.push(`${terrain}. No number token.`);
  if (hex.id === view.robberHex) bits.push('Robber blocks this hex.');
  if (mine > 0) bits.push(`You have ${mine} building${mine === 1 ? '' : 's'} here.`);
  else if (theirs > 0) bits.push(`${theirs} rival building${theirs === 1 ? '' : 's'} here.`);
  else bits.push('You have no buildings here.');
  return bits.join(' ');
}

export function vertexLabel(view: GameView, index: BoardIndex, vertexId: string): string {
  const vertex = index.vertex.get(vertexId);
  if (!vertex) return '';
  const building = view.buildings[vertexId];
  const hexes = vertex.hexes.map((id) => index.hex.get(id)).filter((hex): hex is NonNullable<typeof hex> => Boolean(hex));
  const detail = hexes
    .map((hex) => `${hex.terrain === 'desert' ? 'Desert' : `${hex.terrain[0]?.toUpperCase()}${hex.terrain.slice(1)}`} ${hex.token ?? '-'}`)
    .join(', ');
  if (building) {
    const name = view.players[building.owner]?.name ?? `Player ${building.owner + 1}`;
    return `${name}'s ${building.type}. Touches ${detail}.`;
  }
  const neighbours = view.board.vertices
    .filter((other) => other.id !== vertexId && other.hexes.some((h) => vertex.hexes.includes(h)) && view.buildings[other.id])
    .map((other) => view.players[view.buildings[other.id]?.owner ?? 0]?.name)
    .filter(Boolean);
  const suffix = neighbours.length > 0 ? ` Too close to ${neighbours[0]}'s building.` : '';
  return `Empty corner. Touches ${detail}.${suffix}`;
}

export function edgeLabel(view: GameView, index: BoardIndex, edgeId: string): string {
  const edge = index.edge.get(edgeId);
  if (!edge) return '';
  const owner = view.roads[edgeId];
  // An empty edge has nothing to say. The build bar lists the legal edges, so
  // "empty edge, not connected" was a tooltip repeating the highlight.
  if (owner === undefined) return '';
  const name = view.players[owner]?.name ?? `Player ${owner + 1}`;
  const length = view.awards.longestRoadLength[owner] ?? 0;
  return `${name}'s road. Route length ${length}.`;
}

export function targetLabel(view: GameView, index: BoardIndex, target: BoardTarget | null): string {
  if (!target) return '';
  if (target.id.startsWith('port:')) {
    const port = view.board.ports.find((item) => `port:${item.id}` === target.id);
    if (!port) return '';
    const owned = port.vertices.some((id) => view.buildings[id]?.owner === view.you);
    return portLabel(port.resource, port.rate, owned);
  }
  if (target.kind === 'hex') return hexLabel(view, index, target.id);
  if (target.kind === 'vertex') return vertexLabel(view, index, target.id);
  return edgeLabel(view, index, target.id);
}

export function vertexTooltip(view: GameView, index: BoardIndex, id: string, setup: boolean): string {
  const base = vertexLabel(view, index, id);
  return setup ? `${base} Legal for setup.` : `${base} Legal settlement corner.`;
}
