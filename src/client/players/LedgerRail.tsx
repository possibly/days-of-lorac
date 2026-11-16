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
          cost={view.cardCosts[inspected.defId]}
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
