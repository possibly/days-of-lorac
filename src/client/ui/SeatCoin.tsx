import type { Seat } from '@shared/types';
import { SeatMark, seatColor } from './icons';

export function SeatCoin({ seat, size = 24, title }: { seat: Seat; size?: number; title?: string }): JSX.Element {
  return (
    <span
      className="seat-coin"
      style={{ width: size, height: size, background: seatColor(seat), color: '#f6edd8' }}
      title={title ?? `Player ${seat + 1}`}
      aria-hidden="true"
    >
      <span className="seat-coin-num" style={{ fontSize: Math.max(10, Math.round(size * 0.42)) }}>{seat + 1}</span>
      <span className="seat-coin-mark">
        <SeatMark seat={seat} size={Math.max(8, Math.round(size * 0.42))} />
      </span>
    </span>
  );
}
