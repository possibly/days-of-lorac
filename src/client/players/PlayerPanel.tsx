import type { GameView, PlayerView, Resource } from '@shared/types';
import { LARGEST_EXPEDITION_MIN, } from '@shared/constants';
import { RESOURCES } from '@shared/types';
import { Pennant, ResourceIcon, seatColor } from '../ui/icons';
import { SeatCoin } from '../ui/SeatCoin';

interface PlayerPanelProps {
  view: GameView;
  player: PlayerView;
  isCurrent: boolean;
  isYou: boolean;
  botPilot: boolean;
  compact?: boolean;
  onExpand?: () => void;
  letters?: boolean;
}

const RESOURCE_LABEL: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
};

export function PlayerPanel({ view, player, isCurrent, isYou, botPilot, compact, onExpand, letters }: PlayerPanelProps): JSX.Element {
  const color = seatColor(player.seat);
  const target = view.targetVp;
  const vp = player.vp;
  const pct = Math.max(0, Math.min(1, target > 0 ? vp / target : 0));
  const breakdown = player.vpBreakdown;
  const chips: { key: string; label: string; value: number }[] = [
    { key: 'settlements', label: 'settlements', value: breakdown.settlements },
    { key: 'cities', label: 'cities', value: breakdown.cities },
    { key: 'charters', label: 'charters', value: breakdown.charters },
    { key: 'route', label: 'route', value: breakdown.longestRoad },
    { key: 'expedition', label: 'expedition', value: breakdown.largestExpedition },
  ].filter((chip) => chip.value > 0);
  const breakdownTitle = [
    `${breakdown.settlements} settlement VP`,
    `${breakdown.cities} city VP`,
    `${breakdown.charters} charter VP`,
    `longest route +${breakdown.longestRoad}`,
    `largest expedition +${breakdown.largestExpedition}`,
  ].join(', ');
  const charterCount = Object.values(player.charters).reduce((sum, count) => sum + count, 0);
  const disconnected = !player.connected;

  if (compact) {
    return (
      <button
        type="button"
        className={`seat-chip${isCurrent ? ' is-current' : ''}${isYou ? ' is-you' : ''}`}
        style={{ borderLeftColor: color }}
        onClick={onExpand}
        aria-label={`${player.name}${isYou ? ' (you)' : ''}, ${vp} of ${target} victory points. Expand panel.`}
      >
        <SeatCoin seat={player.seat} size={22} />
        <span className="seat-chip-name">{player.name}{isYou ? ' · you' : ''}</span>
        <span className="seat-chip-vp">{vp}/{target}</span>
        <span className="seat-chip-res">
          {RESOURCES.map((resource) => (
            <span key={resource} className={`mini-res${player.resources[resource] === 0 ? ' is-zero' : ''}`}>
              <ResourceIcon resource={resource} size={12} />
              <span>{player.resources[resource]}</span>
            </span>
          ))}
        </span>
        {player.isBot ? <span className="badge badge-bot">BOT</span> : null}
        {disconnected ? <span className="badge badge-offline">OFF</span> : null}
        {botPilot && isYou ? <span className="badge badge-pilot">PILOT</span> : null}
      </button>
    );
  }

  return (
    <section className={`player-panel${isCurrent ? ' is-current' : ''}${isYou ? ' is-you' : ''}`} style={{ '--seat-color': color } as React.CSSProperties} aria-label={`${player.name}${isYou ? ', you' : ''}. ${vp} of ${target} victory points.`}>
      {isYou ? <span className="you-tag">You</span> : null}
      <header className="pp-head">
        <SeatCoin seat={player.seat} size={24} title={`Seat ${player.seat + 1}`} />
        <span className="pp-name" title={player.name}>{player.name}</span>
        <span className="pp-badges">
          {player.isBot ? <span className="badge badge-bot">BOT</span> : null}
          {disconnected ? <span className="badge badge-offline">OFFLINE</span> : null}
          {botPilot && isYou ? <span className="badge badge-pilot">BOT PILOT</span> : null}
        </span>
        <span className="pp-vp" title={`${vp} of ${target} victory points.`}>
          {vp}/{target}
        </span>
      </header>

      <div className="pp-meter" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => {
          const filled = i < Math.round(pct * 12);
          return <span key={i} className={`meter-seg${filled ? ' is-filled' : ''}${i === Math.min(11, target - 1) ? ' is-target' : ''}`} />;
        })}
      </div>

      <div className="pp-chips">
        {chips.length === 0 ? <span className="pp-chip pp-chip-muted">no points yet</span> : null}
        {chips.map((chip) => (
          <span key={chip.key} className="pp-chip" title={breakdownTitle}>
            {chip.value} {chip.label}
          </span>
        ))}
      </div>

      <div className="pp-res">
        {RESOURCES.map((resource) => (
          <span
            key={resource}
            className={`pp-res-cell${player.resources[resource] === 0 ? ' is-zero' : ''}`}
            title={`${RESOURCE_LABEL[resource]} ${player.resources[resource]}. ${productionLine(view, player, resource)}`}
          >
            <ResourceIcon resource={resource} size={14} letters={letters} />
            <span className="pp-res-count">{player.resources[resource]}</span>
          </span>
        ))}
      </div>

      <div className="pp-meta">
        <span className="pp-renown" title={`Renown ${player.renown}. ${LARGEST_EXPEDITION_MIN} holds Largest Expedition.`}>
          renown <b>{player.renown}</b>/{LARGEST_EXPEDITION_MIN}
          <span className={`renown-tick${player.renown >= LARGEST_EXPEDITION_MIN ? ' is-met' : ''}`} aria-hidden="true" />
          {view.awards.largestExpedition === player.seat ? <span className="award-pin" title="Largest Expedition"><Pennant kind="expedition" /></span> : null}
        </span>
        <span className="pp-charters" title={`${charterCount} charter${charterCount === 1 ? '' : 's'} owned.`}>
          charters <b>{charterCount}</b>
        </span>
      </div>

      <div className="pp-deckline" title="Deck and discard counts are public. Their contents are not.">
        deck {player.deckCount} · discard {player.discardCount} · hand {player.handCount} · play {player.playedCount}
      </div>

      <div className="pp-awards">
        {view.awards.longestRoad === player.seat ? (
          <span className="award-chip" title="Longest trade route, +2 VP"><Pennant kind="route" /> route {view.awards.longestRoadLength[player.seat] ?? 0}</span>
        ) : null}
        {view.awards.largestExpedition === player.seat ? (
          <span className="award-chip" title="Largest expedition, +2 VP"><Pennant kind="expedition" /> renown</span>
        ) : null}
        {player.seat === view.currentSeat ? <span className="pp-turn-flag">turn</span> : null}
      </div>
    </section>
  );
}

/** "You produce 4 of 36 on wood." Derived from board pips, not legality. */
function productionLine(view: GameView, player: PlayerView, resource: Resource): string {
  let pips = 0;
  for (const hex of view.board.hexes) {
    if (hex.terrain !== resource || hex.token === null || hex.id === view.robberHex) continue;
    for (const vertexId of hex.vertices) {
      const building = view.buildings[vertexId];
      if (!building || building.owner !== player.seat) continue;
      pips += (6 - Math.abs(7 - hex.token)) * (building.type === 'city' ? 2 : 1);
      break;
    }
  }
  return `You produce ${pips} of 36 on ${resource}.`;
}
