import type { GameView, PlayerView, Resource } from '@shared/types';
import { AWARD_BONUS, LARGEST_EXPEDITION_MIN, LONGEST_ROAD_MIN } from '@shared/constants';
import { RESOURCES } from '@shared/types';
import { Pennant, ResourceIcon, seatColor } from '../ui/icons';
import { SeatCoin } from '../ui/SeatCoin';

interface PlayerPanelProps {
  view: GameView;
  player: PlayerView;
  isCurrent: boolean;
  isYou: boolean;
  /** True when a bot is flying this seat because the human dropped. */
  isPilot: boolean;
  /** This seat's discard just shuffled back into its deck. */
  reshuffling?: boolean;
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

export function PlayerPanel({ view, player, isCurrent, isYou, isPilot, reshuffling, compact, onExpand, letters }: PlayerPanelProps): JSX.Element {
  const color = seatColor(player.seat);
  const target = view.targetVp;
  const vp = player.vp;
  const pct = Math.max(0, Math.min(1, target > 0 ? vp / target : 0));
  const segments = Math.max(1, Math.round(target));
  const breakdown = player.vpBreakdown;
  // Every value here is victory points, so the chips read as an addition that
  // lands on the panel's total: "+1 settlements +2 route" is 3 VP.
  const chips: { key: string; label: string; value: number; source: string }[] = [
    { key: 'settlements', label: 'settlements', value: breakdown.settlements, source: 'from settlements' },
    { key: 'cities', label: 'cities', value: breakdown.cities, source: 'from cities' },
    { key: 'charters', label: 'charters', value: breakdown.charters, source: 'from charters' },
    { key: 'route', label: 'route', value: breakdown.longestRoad, source: 'Longest Route award' },
    { key: 'expedition', label: 'expedition', value: breakdown.largestExpedition, source: 'Largest Expedition award' },
  ].filter((chip) => chip.value > 0);
  const breakdownTitle = [
    `${breakdown.settlements} settlement VP`,
    `${breakdown.cities} city VP`,
    `${breakdown.charters} charter VP`,
    `longest route +${breakdown.longestRoad}`,
    `largest expedition +${breakdown.largestExpedition}`,
  ].join(', ');
  const routeLength = view.awards.longestRoadLength[player.seat] ?? 0;
  const holdsRoute = view.awards.longestRoad === player.seat;
  const holdsExpedition = view.awards.largestExpedition === player.seat;

  // The awards are "the most, ties go to the holder". So the number this seat
  // needs is the minimum when nobody holds it, and the holder's number plus one
  // when someone does. Both recompute from the view on every render, so the
  // target moves as the table plays.
  const routeHolderSeat = view.awards.longestRoad;
  const routeHolder = routeHolderSeat === null ? null : view.players[routeHolderSeat] ?? null;
  const routeHolderValue = routeHolderSeat === null ? 0 : view.awards.longestRoadLength[routeHolderSeat] ?? 0;
  const routeNeed = holdsRoute
    ? Math.max(routeLength, LONGEST_ROAD_MIN)
    : routeHolder ? routeHolderValue + 1 : LONGEST_ROAD_MIN;

  const expeditionHolderSeat = view.awards.largestExpedition;
  const expeditionHolder = expeditionHolderSeat === null ? null : view.players[expeditionHolderSeat] ?? null;
  const expeditionHolderValue = expeditionHolder?.renown ?? 0;
  const renownNeed = holdsExpedition
    ? Math.max(player.renown, LARGEST_EXPEDITION_MIN)
    : expeditionHolder ? expeditionHolderValue + 1 : LARGEST_EXPEDITION_MIN;
  const charterCount = Object.values(player.charters).reduce((sum, count) => sum + count, 0);
  const disconnected = !player.connected;
  // Offline only when a human dropped and nobody is flying the seat.
  const offline = disconnected && !player.isBot && !isPilot;
  const filled = Math.min(segments, Math.round(pct * segments));

  if (compact) {
    return (
      <button
        type="button"
        className={`seat-chip${isCurrent ? ' is-current' : ''}${isYou ? ' is-you' : ''}${reshuffling ? ' is-reshuffling' : ''}`}
        style={{ borderLeftColor: color }}
        onClick={onExpand}
        aria-label={`${player.name}${isYou ? ' (you)' : ''}, ${vp} of ${target} victory points, renown ${player.renown} of ${LARGEST_EXPEDITION_MIN}, route ${routeLength}.${holdsRoute ? ' Holds Longest Route.' : ''}${holdsExpedition ? ' Holds Largest Expedition.' : ''} Expand panel.`}
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
        {/* Footer row: status badges on the left, the two 2-VP award tracks on
            the right. Gold means this seat holds that award, so the race reads
            without opening a panel. */}
        <span className="seat-chip-foot">
          <span className="seat-chip-badges">
            {player.isBot ? <span className="badge badge-bot">BOT</span> : null}
            {offline ? <span className="badge badge-offline">OFF</span> : null}
            {isPilot ? <span className="badge badge-pilot">PILOT</span> : null}
          </span>
          <span className="seat-awards">
            <span
              className={`mini-award${holdsRoute ? ' is-held' : ''}`}
              title={holdsRoute
                ? `Longest Route ${routeLength}. Holds the award, +${AWARD_BONUS} VP.`
                : `Longest Route ${routeLength}. Needs ${LONGEST_ROAD_MIN} and the most at the table for +${AWARD_BONUS} VP.`}
            >
              <Pennant kind="route" />
              <span>{routeLength}</span>
            </span>
            <span
              className={`mini-award${holdsExpedition ? ' is-held' : ''}`}
              title={holdsExpedition
                ? `Renown ${player.renown}. Holds Largest Expedition, +${AWARD_BONUS} VP.`
                : `Renown ${player.renown} of ${LARGEST_EXPEDITION_MIN} for Largest Expedition, +${AWARD_BONUS} VP.`}
            >
              <Pennant kind="expedition" />
              <span>{player.renown}</span>
            </span>
          </span>
        </span>
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
          {offline ? <span className="badge badge-offline">OFFLINE</span> : null}
          {isPilot ? <span className="badge badge-pilot">BOT PILOT</span> : null}
        </span>
        <span className="pp-vp" title={`${vp} of ${target} victory points.`}>
          {vp}/{target}
        </span>
      </header>

      <div className={`pp-meter${segments > 14 ? ' is-dense' : ''}`} aria-hidden="true">
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={i}
            className={`meter-seg${i < filled ? ' is-filled' : ''}${i === segments - 1 ? ' is-target' : ''}`}
          />
        ))}
      </div>

      <div className="pp-chips">
        {chips.length === 0 ? <span className="pp-chip pp-chip-muted">no points yet</span> : null}
        {chips.length > 0 ? <span className="pp-chip-label">vp from</span> : null}
        {chips.map((chip) => (
          <span key={chip.key} className="pp-chip" title={`+${chip.value} ${chip.source}. ${breakdownTitle}.`}>
            +{chip.value} {chip.label}
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

      <div className="pp-tracks">
        <span
          className={`pp-track${holdsExpedition ? ' is-held' : ''}`}
          title={holdsExpedition
            ? `Renown ${player.renown}. Holds Largest Expedition for +${AWARD_BONUS} VP.`
            : expeditionHolder
              ? `Renown ${player.renown}. ${AWARD_BONUS} VP at ${renownNeed}, because ${expeditionHolder.name} holds it with ${expeditionHolderValue}.`
              : `Renown ${player.renown}. ${AWARD_BONUS} VP at ${renownNeed} while nobody holds it.`}
        >
          <span className="pp-track-label">renown</span>
          <span className="pp-track-value">
            <b>{player.renown}</b>{holdsExpedition ? null : <span className="pp-track-need">/{renownNeed}</span>}
          </span>
          {holdsExpedition ? <span className="award-pin" title="Largest Expedition"><Pennant kind="expedition" /></span> : null}
          <span className="pp-track-note">
            {holdsExpedition ? `+${AWARD_BONUS} VP` : `+${AWARD_BONUS} VP at ${renownNeed}`}
            {!holdsExpedition && expeditionHolder ? <span className="pp-track-holder"> · {expeditionHolder.name} has {expeditionHolderValue}</span> : null}
          </span>
        </span>

        <span
          className={`pp-track${holdsRoute ? ' is-held' : ''}`}
          title={holdsRoute
            ? `Longest Route ${routeLength}. Holds the award for +${AWARD_BONUS} VP.`
            : routeHolder
              ? `Longest Route ${routeLength}. ${AWARD_BONUS} VP at ${routeNeed}, because ${routeHolder.name} holds it with ${routeHolderValue}.`
              : `Longest Route ${routeLength}. ${AWARD_BONUS} VP at ${routeNeed} while nobody holds it.`}
        >
          <span className="pp-track-label">route</span>
          <span className="pp-track-value">
            <b>{routeLength}</b>{holdsRoute ? null : <span className="pp-track-need">/{routeNeed}</span>}
          </span>
          {holdsRoute ? <span className="award-pin" title="Longest Route"><Pennant kind="route" /></span> : null}
          <span className="pp-track-note">
            {holdsRoute ? `+${AWARD_BONUS} VP` : `+${AWARD_BONUS} VP at ${routeNeed}`}
            {!holdsRoute && routeHolder ? <span className="pp-track-holder"> · {routeHolder.name} has {routeHolderValue}</span> : null}
          </span>
        </span>

        <span className="pp-charters" title={`${charterCount} charter${charterCount === 1 ? '' : 's'} owned.`}>
          <span className="pp-track-label">charters</span>
          <b>{charterCount}</b>
        </span>
      </div>

      <div className={`pp-deckline${reshuffling ? ' is-reshuffling' : ''}`} title="Deck and discard counts are public. Their contents are not.">
        deck {player.deckCount} · discard {player.discardCount} · hand {player.handCount} · play {player.playedCount}
        {reshuffling ? <span className="reshuffle-flag">shuffled</span> : null}
      </div>

      <div className="pp-awards">
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
