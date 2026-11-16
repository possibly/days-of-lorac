import type { GameView } from '@shared/types';
import { RESOURCES } from '@shared/types';
import { AWARD_BONUS, LARGEST_EXPEDITION_MIN, LONGEST_ROAD_MIN } from '@shared/constants';
import { Pennant, ResourceIcon, seatColor } from '../ui/icons';
import { SeatCoin } from '../ui/SeatCoin';

/**
 * The active seat's public ledger, sitting above the action bar. The full stat
 * boxes live in the Players drawer; this strip keeps the numbers a player needs
 * while deciding a move on screen.
 */
export function ActivePlayerBar({ view, letters }: { view: GameView; letters: boolean }): JSX.Element | null {
  const player = view.players[view.currentSeat];
  if (!player) return null;
  const routeLength = view.awards.longestRoadLength[player.seat] ?? 0;
  const holdsRoute = view.awards.longestRoad === player.seat;
  const holdsExpedition = view.awards.largestExpedition === player.seat;
  const isYou = player.seat === view.you;
  const label = view.phase === 'gameOver'
    ? 'final'
    : view.legal.isTurn ? 'your turn' : 'active';

  return (
    <div
      className="active-player-bar"
      style={{ '--seat-color': seatColor(player.seat) } as React.CSSProperties}
      aria-label={`${player.name}${isYou ? ', you' : ''}. ${label}. Wood ${player.resources.wood}, brick ${player.resources.brick}, sheep ${player.resources.sheep}, wheat ${player.resources.wheat}, ore ${player.resources.ore}. Route ${routeLength}. Renown ${player.renown}.`}
    >
      <span className="apb-who">
        <SeatCoin seat={player.seat} size={20} />
        <span className="apb-name" title={player.name}>{player.name}{isYou ? ' · you' : ''}</span>
        <span className="apb-flag">{label}</span>
      </span>

      <span className="apb-res">
        {RESOURCES.map((resource) => (
          <span
            key={resource}
            className={`apb-res-cell${player.resources[resource] === 0 ? ' is-zero' : ''}`}
            title={`${resource} ${player.resources[resource]}`}
          >
            <ResourceIcon resource={resource} size={16} letters={letters} />
            <span>{player.resources[resource]}</span>
          </span>
        ))}
      </span>

      <span className="apb-stats">
        <span
          className={`apb-stat${holdsRoute ? ' is-held' : ''}`}
          title={holdsRoute
            ? `Longest Route: ${routeLength} roads. Holds the award for +${AWARD_BONUS} VP.`
            : `Longest Route: ${routeLength} roads. ${LONGEST_ROAD_MIN} and the most at the table wins +${AWARD_BONUS} VP.`}
        >
          <Pennant kind="route" />
          <span className="apb-stat-label">route</span>
          <b>{routeLength}</b>
        </span>
        <span
          className={`apb-stat${holdsExpedition ? ' is-held' : ''}`}
          title={holdsExpedition
            ? `Renown: ${player.renown}. Holds Largest Expedition for +${AWARD_BONUS} VP.`
            : `Renown: ${player.renown}. ${LARGEST_EXPEDITION_MIN} and the most at the table wins +${AWARD_BONUS} VP.`}
        >
          <Pennant kind="expedition" />
          <span className="apb-stat-label">renown</span>
          <b>{player.renown}</b>
        </span>
      </span>
    </div>
  );
}
