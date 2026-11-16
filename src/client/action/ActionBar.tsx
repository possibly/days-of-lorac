import { useEffect, useRef, useState } from 'react';
import type { GameView, PartialResources, Resource, Seat } from '@shared/types';
import { RESOURCES } from '@shared/types';
import type { Pending } from './types';
import { Button } from '../ui/Button';
import { ResourceIcon } from '../ui/icons';
import { SeatCoin } from '../ui/SeatCoin';

interface ActionBarProps {
  view: GameView;
  pending: Pending;
  selection: { kind: 'vertex' | 'edge' | 'hex'; id: string } | null;
  victim: Seat | null;
  /** True while the road/settlement/city picker is open. */
  buildOpen: boolean;
  letters: boolean;
  onRoll: () => void;
  onEndTurn: () => void;
  onOpenTrade: () => void;
  onOpenMarket: () => void;
  onOpenPlayers: () => void;
  onOpenBuild: () => void;
  onCloseBuild: () => void;
  onPickBuild: (kind: 'road' | 'settlement' | 'city') => void;
  onDiscard: () => void;
  onMoveRobber: () => void;
  onVictim: (seat: Seat) => void;
  onCancel: () => void;
  onSkipRobber: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onCancelOffer: () => void;
  onSeeResult: () => void;
  onConfirmRobber: () => void;
  frozen?: boolean;
}

const WORD: Record<Resource, string> = { wood: 'wood', brick: 'brick', sheep: 'sheep', wheat: 'wheat', ore: 'ore' };

const BUILD_COST: Record<'road' | 'settlement' | 'city', PartialResources> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
};

const BUILD_WORD: Record<'road' | 'settlement' | 'city', string> = {
  road: 'Road',
  settlement: 'Settlement',
  city: 'City',
};

function describe(map: PartialResources): string {
  const parts = RESOURCES.filter((resource) => (map[resource] ?? 0) > 0).map((resource) => `${map[resource]} ${WORD[resource]}`);
  return parts.length > 0 ? parts.join(' and ') : 'nothing';
}

/**
 * Prompt on the left, at most three buttons on the right. Every enabled
 * control maps to an entry in `view.legal`; every disabled control says why.
 */
export function ActionBar(props: ActionBarProps): JSX.Element {
  const { view, pending, selection, victim, frozen, buildOpen, letters } = props;
  const lost = Boolean(frozen);
  const legal = view.legal;
  const active = view.players[view.currentSeat];
  const activeName = active?.name ?? 'the table';
  const mustDiscard = legal.discard?.required ?? 0;
  const offer = view.tradeOffer;
  const incoming = offer && offer.from !== view.you && offer.to.includes(view.you);
  const myOffer = offer && offer.from === view.you;


  // On tablet and phone the market lives in a drawer, so waiting players need
  // a way to open it. Desktop already shows the rail, hence the CSS hiding.
  const marketButton = (
    <Button
      variant="ghost"
      className="rail-open-only"
      onClick={props.onOpenMarket}
      disabled={lost}
      reason={lost ? 'Connection lost. Reconnecting.' : null}
    >
      Market
    </Button>
  );

  const playersButton = (
    <Button variant="ghost" onClick={props.onOpenPlayers}>Players</Button>
  );

  // ----- game over ---------------------------------------------------------
  if (view.phase === 'gameOver') {
    const winner = view.players.find((player) => player.seat === view.winner);
    return (
      <div className="action-bar">
        <p className="prompt-line">{winner ? `${winner.name} wins at ${winner.vp} points.` : 'The game is over.'}</p>
        <div className="action-buttons">
          <Button variant="primary" onClick={props.onSeeResult}>See the result</Button>
        </div>
      </div>
    );
  }

  // ----- targeting flows ---------------------------------------------------
  if (pending?.type === 'provisioner') {
    return bar(
      'Choose 2 resources. Repeats are allowed.',
      <>
        <span className="action-note">Modal open</span>
        <Button variant="ghost" onClick={props.onCancel}>Cancel card</Button>
      </>,
    );
  }

  if (pending?.type === 'card' || pending?.type === 'build') {
    const road = pending.type === 'build' ? pending.kind === 'road' : pending.choice === 'road';
    const city = pending.type === 'build' && pending.kind === 'city';
    const robberCard = pending.type === 'card' && pending.choice === 'robber';
    // Only a card hands out a free piece. A paid build is just a build.
    const granted = pending.type === 'card';
    const prompt = robberCard
      ? selection?.kind === 'hex'
        ? 'Choose who to steal from.'
        : 'Choose a hex for the robber.'
      : road
        ? (granted ? 'Choose an edge for the free road.' : 'Choose an edge for the road.')
        : city
          ? 'Choose one of your settlements to upgrade.'
          : (granted ? 'Choose a corner for the free settlement.' : 'Choose a corner for the settlement.');
    const banner =
      pending.type === 'card'
        ? pending.choice === 'road'
          ? 'Free road from Guild Mason'
          : pending.choice === 'settlement'
            ? "Free settlement from Shipwright's Yard"
            : "Wrecker's Lamp: move the robber or skip"
        : null;
    const card = robberCard && pending.type === 'card'
      ? view.legal.playable.find((entry) => entry.iid === pending.iid)
      : undefined;
    const cardVictims = selection?.kind === 'hex' ? card?.robberVictims?.[selection.id] ?? [] : [];
    return bar(
      prompt,
      <>
        {banner ? <span className="action-banner">{banner}</span> : null}
        {robberCard && selection?.kind === 'hex' ? (
          <VictimButtons view={view} seats={cardVictims} victim={victim} onVictim={props.onVictim} />
        ) : null}
        {robberCard && selection?.kind === 'hex' ? (
          <Button variant="primary" onClick={props.onConfirmRobber}>
            {cardVictims.length > 0 ? 'Steal 1' : 'Move robber'}
          </Button>
        ) : null}
        {robberCard && selection?.kind === 'hex' ? (
          <Button variant="ghost" onClick={props.onSkipRobber}>Skip the move</Button>
        ) : null}
        <Button variant="ghost" onClick={props.onCancel}>{pending.type === 'build' ? 'Cancel build' : 'Cancel card'}</Button>
      </>,
      robberCard && selection?.kind === 'hex' ? 'has-victims' : '',
    );
  }

  // ----- setup -------------------------------------------------------------
  if (view.phase === 'setup') {
    if (!legal.isTurn) {
      return bar(`Waiting on ${activeName} to place.`, marketButton);
    }
    const step = view.setup?.step ?? 'settlement';
    const prompt = step === 'settlement'
      ? `Place your ${view.setup && view.setup.index >= view.players.length ? 'second' : 'first'} settlement. Pick a corner.`
      : 'Place a road touching your new settlement.';
    return bar(prompt, <span className="action-note">Click the board</span>);
  }

  // ----- roll --------------------------------------------------------------
  if (view.phase === 'roll') {
    if (!legal.isTurn) return bar(`Waiting on ${activeName} to roll.`, marketButton);
    return bar('Roll for production.', (
      <>
        <Button variant="primary" onClick={props.onRoll} disabled={!legal.canRoll || lost} reason={lost ? 'Connection lost. Reconnecting.' : !legal.canRoll ? 'You cannot roll right now.' : null}>
          Roll 2d6
        </Button>
        {playersButton}
      </>
    ));
  }

  // ----- discard -----------------------------------------------------------
  if (view.phase === 'discard') {
    if (mustDiscard > 0) {
      return bar(`Discard ${mustDiscard} resources before play continues.`, (
        <>
          <Button variant="primary" onClick={props.onDiscard} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Discard {mustDiscard}</Button>
          {playersButton}
        </>
      ));
    }
    const owing = view.discardQueue.map((seat) => view.players[seat]).filter(Boolean);
    const text = owing.length > 0
      ? `${owing.map((player) => `${player?.name} is discarding ${view.discardRequired[player?.seat ?? 0] ?? 0}`).join('; ')}.`
      : `${activeName} is discarding.`;
    return bar(text, marketButton);
  }

  // ----- robber ------------------------------------------------------------
  if (view.phase === 'robber') {
    if (!legal.robber) return bar(`${activeName} is moving the robber.`, marketButton);
    const hex = selection?.kind === 'hex' ? selection.id : null;
    const victims = hex ? legal.robber.victims[hex] ?? [] : [];
    return (
      <div className="action-bar has-victims">
        <p className="prompt-line">{hex ? 'Choose who to steal from.' : 'Move the robber to another hex.'}</p>
        <div className="action-buttons">
          {hex && victims.length > 0 ? (
            <VictimButtons view={view} seats={victims} victim={victim} onVictim={props.onVictim} />
          ) : null}
          {hex ? (
            <Button variant="primary" onClick={props.onMoveRobber} disabled={!hex || lost} reason={lost ? 'Connection lost. Reconnecting.' : !hex ? 'Pick a hex first.' : null}>
              {victims.length > 0 ? 'Steal 1' : 'Move robber'}
            </Button>
          ) : (
            <Button variant="primary" disabled reason="Pick a hex first.">Move robber</Button>
          )}
        </div>
      </div>
    );
  }

  // ----- incoming / open offer --------------------------------------------
  if (incoming && offer) {
    const from = view.players[offer.from]?.name ?? 'A player';
    return bar(`${from} offers ${describe(offer.give)} for ${describe(offer.want)}.`, (
      <>
        <Button variant="primary" onClick={props.onAccept} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Accept</Button>
        <Button variant="secondary" onClick={props.onDecline} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Decline</Button>
        {playersButton}
      </>
    ));
  }

  if (myOffer && offer) {
    return bar(`Offer open. Waiting on ${offer.to.length} player${offer.to.length === 1 ? '' : 's'}.`, (
      <>
        <Button variant="secondary" onClick={props.onCancelOffer} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Cancel offer</Button>
        {playersButton}
      </>
    ));
  }

  // ----- action phase ------------------------------------------------------
  if (!legal.isTurn) {
    return bar(`Waiting on ${activeName} to end their turn.`, marketButton);
  }

  const affordable = legal.build.affordable;

  // The action phase carries no text at all. Every prompt it used to show was
  // either restating the buttons or telling the player their turn was over
  // ("Play cards, build, trade, or buy one card.", "Hand played.", "No
  // affordable build or purchase. Ending turn.", "One purchase per turn, and you
  // have used it."). The purchase state is visible on the market's own chip.

  // ----- build picker ------------------------------------------------------
  if (buildOpen) {
    return (
      <div className="action-bar is-build">
        <div className="prompt-wrap">
          <p className="prompt-line">Build what?</p>
        </div>
        <Button variant="ghost" onClick={props.onCloseBuild}>Cancel</Button>
        <div className="action-buttons">
          <div className="build-chips" role="group" aria-label="Choose a build">
            {(['road', 'settlement', 'city'] as const).map((kind) => {
              const spots = kind === 'road' ? legal.build.roads : kind === 'settlement' ? legal.build.settlements : legal.build.cities;
              const disabled = lost || !affordable[kind] || spots.length === 0;
              const reason = lost
                ? 'Connection lost. Reconnecting.'
                : !affordable[kind]
                  ? `Not enough resources for a ${kind}.`
                  : spots.length === 0
                    ? `Nowhere legal to put a ${kind} right now.`
                    : null;
              return (
                <BuildChip
                  key={kind}
                  kind={kind}
                  letters={letters}
                  disabled={disabled}
                  reason={reason}
                  onPick={() => props.onPickBuild(kind)}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="action-bar">
      <div className="action-buttons">
        <Button variant="secondary" onClick={props.onOpenBuild} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Build</Button>
        <Button variant="secondary" onClick={props.onOpenTrade} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Trade</Button>
        <Button variant="secondary" onClick={props.onOpenMarket} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Buy</Button>
        {playersButton}
        <Button variant="primary" onClick={props.onEndTurn} disabled={!legal.canEndTurn || lost} reason={lost ? 'Connection lost. Reconnecting.' : !legal.canEndTurn ? 'You cannot end the turn right now.' : null}>
          End turn
        </Button>
      </div>
    </div>
  );

  function bar(promptText: string, buttons: JSX.Element | null, className = ''): JSX.Element {
    return (
      <div className={`action-bar${className ? ` ${className}` : ''}`}>
        <p className="prompt-line">{promptText}</p>
        <div className="action-buttons">{buttons}</div>
      </div>
    );
  }
}

/**
 * One build choice in the action bar: name on the left, cost pips on the right.
 * Carries its own disabled reason, the same way Button does, so a phone player
 * gets told why the chip is grey instead of nothing happening.
 */
function BuildChip({
  kind,
  letters,
  disabled,
  reason,
  onPick,
}: {
  kind: 'road' | 'settlement' | 'city';
  letters: boolean;
  disabled: boolean;
  reason: string | null;
  onPick: () => void;
}): JSX.Element {
  const cost = BUILD_COST[kind];
  const reasonId = `build-reason-${kind}`;
  return (
    <button
      type="button"
      className="build-chip"
      disabled={disabled}
      title={reason ?? undefined}
      aria-describedby={disabled && reason ? reasonId : undefined}
      onClick={onPick}
    >
      <span className="build-chip-name">{BUILD_WORD[kind]}</span>
      <span className="build-chip-cost">
        {RESOURCES.filter((resource) => (cost[resource] ?? 0) > 0).map((resource) => (
          <span key={resource} className={`cost-pip cost-${resource}`}>
            <span className="pip-n">{cost[resource]}</span>
            <ResourceIcon resource={resource} size={10} letters={letters} />
          </span>
        ))}
      </span>
      {disabled && reason ? (
        <span id={reasonId} className="sr-only">{reason}</span>
      ) : null}
    </button>
  );
}

function VictimButtons({
  view,
  seats,
  victim,
  onVictim,
}: {
  view: GameView;
  seats: Seat[];
  victim: Seat | null;
  onVictim: (seat: Seat) => void;
}): JSX.Element | null {
  const row = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  // On a narrow bar the chip row scrolls sideways. A fade at the right edge is
  // the only cue that another player is waiting out there, so it is only on
  // when the row actually overflows.
  useEffect(() => {
    const node = row.current;
    if (!node) return undefined;
    const sync = (): void => setScrollable(node.scrollWidth > node.clientWidth + 1);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [seats.length]);

  if (seats.length === 0) return null;
  return (
    <div ref={row} className={`victim-chips${scrollable ? ' is-scrollable' : ''}`} role="group" aria-label="Choose a victim">
      {seats.map((seat) => {
        const player = view.players[seat];
        if (!player) return null;
        const total = RESOURCES.reduce((sum, resource) => sum + player.resources[resource], 0);
        return (
          <button
            key={seat}
            type="button"
            className={`victim-chip${victim === seat ? ' is-on' : ''}`}
            onClick={() => onVictim(seat)}
            aria-pressed={victim === seat}
          >
            <SeatCoin seat={seat} size={22} />
            <span className="victim-name">{player.name}</span>
            <span className="victim-count">{total} res</span>
          </button>
        );
      })}
    </div>
  );
}
