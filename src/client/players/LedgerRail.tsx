import type { GameView } from '@shared/types';
import { PlayerPanel } from './PlayerPanel';
import { CardInspector } from './CardInspector';
import type { CardInstance } from '@shared/types';

interface LedgerRailProps {
  view: GameView;
  inspected: CardInstance | null;
  canPlayInspected: boolean;
  inspectedNeedsChoice: boolean;
  onPlayInspected: () => void;
  onCloseInspector: () => void;
  letters: boolean;
  /** Seats a bot is flying right now, straight from the socket snapshot. */
  pilotSeats: number[];
  /** Seats whose discard just went back into their deck. */
  reshufflingSeats: number[];
}

export function LedgerRail({
  view,
  inspected,
  canPlayInspected,
  inspectedNeedsChoice,
  onPlayInspected,
  onCloseInspector,
  letters,
  pilotSeats,
  reshufflingSeats,
}: LedgerRailProps): JSX.Element {
  return (
    <aside className="ledger-rail" aria-label="Player ledger">
      {inspected ? (
        <CardInspector
          card={inspected}
          playable={canPlayInspected}
          needsChoice={inspectedNeedsChoice}
          onPlay={canPlayInspected ? onPlayInspected : undefined}
          onClose={onCloseInspector}
          letters={letters}
        />
      ) : null}
      <div className="ledger-list">
        {view.players.map((player) => (
          <PlayerPanel
            key={player.seat}
            view={view}
            player={player}
            isCurrent={player.seat === view.currentSeat}
            isYou={player.seat === view.you}
            isPilot={pilotSeats.includes(player.seat)}
            reshuffling={reshufflingSeats.includes(player.seat)}
            letters={letters}
          />
        ))}
      </div>
      <p className="ledger-note">Deck and discard counts are public. Their contents are not.</p>
    </aside>
  );
}

/** Tablet ribbon: four chips, tap to expand the full panel over the board. */
export function SeatRibbon({
  view,
  pilotSeats,
  reshufflingSeats,
  expanded,
  onExpand,
  letters,
}: {
  view: GameView;
  pilotSeats: number[];
  reshufflingSeats: number[];
  expanded: number | null;
  onExpand: (seat: number | null) => void;
  letters: boolean;
}): JSX.Element {
  const player = expanded === null ? null : view.players[expanded] ?? null;
  return (
    <div className="seat-ribbon-wrap">
      <div className="seat-ribbon" role="list" aria-label="Players">
        {view.players.map((entry) => (
          <PlayerPanel
            key={entry.seat}
            view={view}
            player={entry}
            isCurrent={entry.seat === view.currentSeat}
            isYou={entry.seat === view.you}
            isPilot={pilotSeats.includes(entry.seat)}
            reshuffling={reshufflingSeats.includes(entry.seat)}
            compact
            letters={letters}
            onExpand={() => onExpand(expanded === entry.seat ? null : entry.seat)}
          />
        ))}
      </div>
      {player ? (
        <div className="ribbon-expanded">
          <PlayerPanel
            view={view}
            player={player}
            isCurrent={player.seat === view.currentSeat}
            isYou={player.seat === view.you}
            isPilot={pilotSeats.includes(player.seat)}
            reshuffling={reshufflingSeats.includes(player.seat)}
            letters={letters}
          />
          <button type="button" className="btn btn-ghost btn-small" onClick={() => onExpand(null)}>Close</button>
        </div>
      ) : null}
    </div>
  );
}
