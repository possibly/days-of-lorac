import type { Resource, Seat, Terrain } from '@shared/types';

/**
 * The icon set, one 24x24 viewBox, 1.6px stroke, round caps. Resources read by
 * silhouette at 14px; terrain icons reuse the same six shapes. Everything is
 * currentColor so callers can tint with the palette.
 */

export const RESOURCE_LETTER: Record<Resource, string> = {
  wood: 'W',
  brick: 'B',
  sheep: 'S',
  wheat: 'H',
  ore: 'O',
};

export const SEAT_COLORS: Record<Seat, string> = {
  0: 'var(--p1)',
  1: 'var(--p2)',
  2: 'var(--p3)',
  3: 'var(--p4)',
};

export function seatColor(seat: Seat): string {
  return SEAT_COLORS[seat] ?? 'var(--p1)';
}

export function ResourceIcon({
  resource,
  size = 24,
  letters = false,
  className,
  title,
}: {
  resource: Resource;
  size?: number;
  letters?: boolean;
  className?: string;
  title?: string;
}): JSX.Element {
  const glyph = GLYPHS[resource];
  return (
    <span className={`res-icon res-${resource}${className ? ` ${className}` : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {glyph}
      </svg>
      {letters ? <span className="res-letter" aria-hidden="true">{RESOURCE_LETTER[resource]}</span> : null}
      {title ? <span className="sr-only">{title}</span> : null}
    </span>
  );
}

/** Inner paths for nesting inside another SVG (the board's terrain icons). */
export function ResourceShape({ resource }: { resource: Terrain }): JSX.Element {
  return GLYPHS[resource];
}

const GLYPHS: Record<Terrain, JSX.Element> = {
  wood: (
    <>
      <path d="M4 15.5 9 6.5h9.5L14 15.5H4Z" />
      <path d="M6.5 15.5 11 7.6" opacity="0.55" />
      <circle cx="17" cy="9.4" r="2.2" />
      <path d="M15.6 8.9 18.4 9.9" />
      <path d="M7.5 19h11" opacity="0.5" />
    </>
  ),
  brick: (
    <>
      <rect x="3.5" y="9" width="17" height="9.5" rx="1.2" />
      <path d="M12.5 9v4.2M8 13.2v5.3M16 13.2v5.3" />
    </>
  ),
  sheep: (
    <>
      <path d="M5 12.2c0-2.7 2-4.7 4.6-4.7h5.2c2.7 0 4.6 2 4.6 4.7v1.6H5v-1.6Z" />
      <path d="M9.6 15.2c0 1.6 1.1 2.6 2.5 2.6s2.5-1 2.5-2.6" />
      <path d="M8 9.8c1.2-1.8 3.6-2.5 5.6-1.6" opacity="0.55" />
      <path d="M8.2 18v1.8M16 18v1.8" />
      <circle cx="12" cy="11.7" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  wheat: (
    <>
      <path d="M12 4v15M7.5 8.5c0 3 1.5 4.6 4.5 6M16.5 8.5c0 3-1.5 4.6-4.5 6" />
      <path d="M7.2 17.2h9.6" />
      <path d="M12 8.6 9.6 6.4M12 12.4 9.6 10.2M12 8.6l2.4-2.2M12 12.4l2.4-2.2" opacity="0.7" />
    </>
  ),
  ore: (
    <>
      <path d="M6 9.2 10 4.8h6.2L20 10.6 16.4 19H7.6L4 10.6 6 9.2Z" />
      <path d="M4 10.6h16M9.6 4.8 7.6 19M14.4 4.8l2.4 14.2" opacity="0.6" />
    </>
  ),
  desert: (
    <>
      <path d="M3.5 17.5c3.2 0 4.4-5.6 8.2-5.6 3.4 0 4.6 5.6 8.8 5.6" />
      <circle cx="16.8" cy="7.4" r="2.1" />
      <path d="M3.5 20h17" opacity="0.5" />
    </>
  ),
};

/** Seat silhouettes double as the color-blind cue on coins and pieces. */
export function SeatMark({ seat, size = 14 }: { seat: Seat; size?: number }): JSX.Element {
  const marks: Record<Seat, JSX.Element> = {
    0: (
      <>
        <rect x="6" y="8" width="12" height="12" />
        <path d="M9.5 20v-5h5v5" />
      </>
    ),
    1: (
      <>
        <circle cx="12" cy="13.5" r="6.5" />
        <path d="M5.8 12.6c2 1.2 4 1.2 6 0s4-1.2 6.2 0" />
      </>
    ),
    2: (
      <>
        <path d="M8 5.5h8l3.5 3.5v6L16 18.5H8L4.5 15V9L8 5.5Z" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </>
    ),
    3: (
      <>
        <path d="M9 3.5h6l2.5 4v9L15 20.5H9L7 16.5v-9l2-4Z" />
        <path d="M12 9.5v3.4M10.6 11.2h2.8" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {marks[seat] ?? marks[0]}
    </svg>
  );
}

export function GuildSeal({ size = 72 }: { size?: number }): JSX.Element {
  return (
    <svg className="guild-seal" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Guild seal of Lorac">
      <circle cx="50" cy="50" r="46" fill="#143026" stroke="#c9a75f" strokeWidth="2" />
      <circle cx="50" cy="50" r="39" fill="none" stroke="#c9a75f" strokeWidth="0.8" opacity="0.6" />
      <polygon points="50,18 74,32 74,60 50,74 26,60 26,32" fill="none" stroke="#e8cf98" strokeWidth="1.4" />
      <polygon points="50,27 66,36 66,54 50,63 34,54 34,36" fill="none" stroke="#c9a75f" strokeWidth="0.8" opacity="0.55" />
      <g stroke="#8fc0a9" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M34 49q6-5 12 0t12 0" />
        <path d="M37 56q5-4 10 0t10 0" opacity="0.75" />
      </g>
      <path d="M50 18v-7M74 32l6-4M26 32l-6-4" stroke="#c9a75f" strokeWidth="1" opacity="0.7" />
    </svg>
  );
}

export function Pennant({ kind }: { kind: 'route' | 'expedition' }): JSX.Element {
  if (kind === 'route') {
    return (
      <svg className="award-mark" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 21V3l12 5-12 5" fill="currentColor" opacity="0.9" />
      </svg>
    );
  }
  return (
    <svg className="award-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.6 8.4-2 5.2-5.2 2 2-5.2 5.2-2Z" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  );
}

export function Die({ value, animate }: { value: number; animate: boolean }): JSX.Element {
  const layouts: Record<number, [number, number][]> = {
    1: [[12, 12]],
    2: [[7, 7], [17, 17]],
    3: [[7, 7], [12, 12], [17, 17]],
    4: [[7, 7], [17, 7], [7, 17], [17, 17]],
    5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
    6: [[7, 6], [17, 6], [7, 12], [17, 12], [7, 18], [17, 18]],
  };
  const pips = layouts[value] ?? layouts[1] ?? [];
  return (
    <svg className={`die${animate ? ' die-roll' : ''}`} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="4" fill="#f6edd8" stroke="#a07f3d" strokeWidth="1.4" />
      {pips.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r="2.1" fill="#241d12" />
      ))}
    </svg>
  );
}
