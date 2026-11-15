import type { GameView } from '@shared/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SeatCoin } from '../ui/SeatCoin';
import { GuildSeal } from '../ui/icons';

/** Victory sheet: winner line, full VP table, three-line digest, rematch. */
export function GameOverSheet({
  view,
  isHost,
  onRematch,
  onTitle,
}: {
  view: GameView;
  isHost: boolean | null;
  onRematch: () => void;
  onTitle: () => void;
}): JSX.Element {
  const winner = view.players.find((player) => player.seat === view.winner);
  const ranked = [...view.players].sort((a, b) => b.vp - a.vp || a.seat - b.seat);
  const digest = view.log.filter((entry) => entry.kind === 'buy' || entry.kind === 'award' || entry.kind === 'win').slice(-3);

  return (
    <Modal
      title="The guild has a winner"
      width={640}
      className="game-over-sheet"
      footer={
        <>
          {isHost === false ? (
            <span className="waiting-host">Waiting for the host to start a rematch.</span>
          ) : (
            <Button variant="primary" onClick={onRematch}>Play again</Button>
          )}
          <Button variant="secondary" onClick={onTitle}>Back to title</Button>
        </>
      }
    >
      <div className="victory-head">
        <GuildSeal size={64} />
        <div>
          <p className="victory-line">{winner ? `${winner.name} wins at ${winner.vp} points.` : 'The game is over.'}</p>
          <p className="victory-sub">Race to {view.targetVp} · {view.players.length} players · {view.turn} turns</p>
        </div>
      </div>

      <table className="vp-table">
        <thead>
          <tr>
            <th scope="col">Place</th>
            <th scope="col">Name</th>
            <th scope="col">VP</th>
            <th scope="col">Settlements</th>
            <th scope="col">Cities</th>
            <th scope="col">Charters</th>
            <th scope="col">Route</th>
            <th scope="col">Expedition</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((player, index) => (
            <tr key={player.seat} className={player.seat === view.winner ? 'is-winner' : 'is-loser'}>
              <td>{index + 1}</td>
              <th scope="row">
                <span className="table-name"><SeatCoin seat={player.seat} size={18} />{player.name}{player.seat === view.you ? ' (you)' : ''}</span>
              </th>
              <td className="num">{player.vp}</td>
              <td className="num">{player.vpBreakdown.settlements}</td>
              <td className="num">{player.vpBreakdown.cities}</td>
              <td className="num">{player.vpBreakdown.charters}</td>
              <td className="num">{player.vpBreakdown.longestRoad ? `+${player.vpBreakdown.longestRoad}` : '0'}</td>
              <td className="num">{player.vpBreakdown.largestExpedition ? `+${player.vpBreakdown.largestExpedition}` : '0'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="digest">
        <h3>Last of the log</h3>
        {digest.length === 0 ? <p className="modal-small">No purchases, awards, or victory line recorded.</p> : null}
        <ul>
          {digest.map((entry) => <li key={entry.id}>{entry.text}</li>)}
        </ul>
      </div>
    </Modal>
  );
}
