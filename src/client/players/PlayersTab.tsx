import type { GameView } from '@shared/types';
import { PlayerPanel } from './PlayerPanel';

/** The full stat boxes, shown in the Players drawer. */
export function PlayersTab({
  view,
  letters,
  pilotSeats,
  reshufflingSeats,
}: {
  view: GameView;
  letters: boolean;
  pilotSeats: number[];
  reshufflingSeats: number[];
}): JSX.Element {
  return (
    <div className="players-tab">
      <div className="players-list">
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
      <p className="players-note">Deck and discard counts are public. Their contents are not.</p>
    </div>
  );
}
