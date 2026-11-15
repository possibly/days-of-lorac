import type { CardInstance } from '@shared/types';
import { ResourceIcon } from '../ui/icons';
import { cardDef, primaryResource } from './CardFace';

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardFlightData {
  key: string;
  card: CardInstance;
  from: CardRect;
  /** Distance from the flight copy's centre to the discard counter's centre. */
  dx: number;
  dy: number;
  delay: number;
  tilt: number;
  duration: number;
}

/**
 * Fixed-position copies of cards that have already left the hand. The real
 * cards unmount as soon as the end-turn snapshot lands, so the flight is a
 * throwaway render of the face, measured from the card's last on-screen box.
 */
export function CardFlightLayer({ flights }: { flights: CardFlightData[] }): JSX.Element {
  return (
    <div className="card-flight-layer" aria-hidden="true">
      {flights.map((flight) => {
        const def = cardDef(flight.card);
        if (!def) return null;
        const resource = primaryResource(def);
        return (
          <div
            key={flight.key}
            className="card-flight"
            style={{
              left: flight.from.x,
              top: flight.from.y,
              width: flight.from.w,
              height: flight.from.h,
              '--fly-dx': `${flight.dx}px`,
              '--fly-dy': `${flight.dy}px`,
              '--fly-tilt': `${flight.tilt}deg`,
              animationDelay: `${flight.delay}ms`,
              animationDuration: `${flight.duration}ms`,
            } as React.CSSProperties}
          >
            <div className="flight-face">
              <span className="flight-name">{def.name}</span>
              <span className="flight-mark" style={{ color: `var(--${resource})` }}>
                <ResourceIcon resource={resource} size={18} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
