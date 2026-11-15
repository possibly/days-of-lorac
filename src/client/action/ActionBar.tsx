import type { GameView, PartialResources, Resource, Seat } from '@shared/types';
import { RESOURCES } from '@shared/types';
import type { Pending } from './types';
import { Button } from '../ui/Button';
import { SeatCoin } from '../ui/SeatCoin';

interface ActionBarProps {
  view: GameView;
  pending: Pending;
  selection: { kind: 'vertex' | 'edge' | 'hex'; id: string } | null;
  victim: Seat | null;
  purchaseUsed: boolean;
  onRoll: () => void;
  onEndTurn: () => void;
  onOpenTrade: () => void;
  onOpenMarket: () => void;
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

function describe(map: PartialResources): string {
  const parts = RESOURCES.filter((resource) => (map[resource] ?? 0) > 0).map((resource) => `${map[resource]} ${WORD[resource]}`);
  return parts.length > 0 ? parts.join(' and ') : 'nothing';
}

/**
 * Prompt on the left, at most three buttons on the right. Every enabled
 * control maps to an entry in `view.legal`; every disabled control says why.
 */
export function ActionBar(props: ActionBarProps): JSX.Element {
  const { view, pending, selection, victim, purchaseUsed, frozen } = props;
  const lost = Boolean(frozen);
  const legal = view.legal;
  const you = view.players[view.you];
  const active = view.players[view.currentSeat];
  const activeName = active?.name ?? 'the table';
  const mustDiscard = legal.discard?.required ?? 0;
  const offer = view.tradeOffer;
  const incoming = offer && offer.from !== view.you && offer.to.includes(view.you);
  const myOffer = offer && offer.from === view.you;

  const holding = you ? RESOURCES.reduce((sum, resource) => sum + you.resources[resource], 0) : 0;

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
        <Button variant="ghost" onClick={props.onCancel}>Cancel card</Button>
      </>,
    );
  }

  // ----- setup -------------------------------------------------------------
  if (view.phase === 'setup') {
    if (!legal.isTurn) {
      return bar(`Waiting on ${activeName} to place.`, null);
    }
    const step = view.setup?.step ?? 'settlement';
    const prompt = step === 'settlement'
      ? `Place your ${view.setup && view.setup.index >= view.players.length ? 'second' : 'first'} settlement. Pick a corner.`
      : 'Place a road touching your new settlement.';
    return bar(prompt, <span className="action-note">Click the board</span>);
  }

  // ----- roll --------------------------------------------------------------
  if (view.phase === 'roll') {
    if (!legal.isTurn) return bar(`Waiting on ${activeName} to roll.`, null);
    return bar('Roll for production.', (
      <Button variant="primary" onClick={props.onRoll} disabled={!legal.canRoll || lost} reason={lost ? 'Connection lost. Reconnecting.' : !legal.canRoll ? 'You cannot roll right now.' : null}>
        Roll 2d6
      </Button>
    ));
  }

  // ----- discard -----------------------------------------------------------
  if (view.phase === 'discard') {
    if (mustDiscard > 0) {
      return bar(`Discard ${mustDiscard} resources before play continues.`, (
        <Button variant="primary" onClick={props.onDiscard} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Discard {mustDiscard}</Button>
      ));
    }
    const owing = view.discardQueue.map((seat) => view.players[seat]).filter(Boolean);
    const text = owing.length > 0
      ? `${owing.map((player) => `${player?.name} is discarding ${view.discardRequired[player?.seat ?? 0] ?? 0}`).join('; ')}.`
      : `${activeName} is discarding.`;
    return bar(text, null);
  }

  // ----- robber ------------------------------------------------------------
  if (view.phase === 'robber') {
    if (!legal.robber) return bar(`${activeName} is moving the robber.`, null);
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
      </>
    ));
  }

  if (myOffer && offer) {
    return bar(`Offer open. Waiting on ${offer.to.length} player${offer.to.length === 1 ? '' : 's'}.`, (
      <Button variant="secondary" onClick={props.onCancelOffer} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Cancel offer</Button>
    ));
  }

  // ----- action phase ------------------------------------------------------
  if (!legal.isTurn) {
    return bar(`Waiting on ${activeName} to end their turn.`, null);
  }

  const affordable = legal.build.affordable;
  const empty =
    legal.playable.length === 0 &&
    legal.buyable.length === 0 &&
    !affordable.road &&
    !affordable.settlement &&
    !affordable.city &&
    legal.bankTrades.length === 0;

  const prompt = purchaseUsed
    ? 'One purchase per turn, and you have used it.'
    : empty
      ? 'No affordable build or purchase. Ending turn.'
      : (you?.playedCount ?? 0) > 0
        ? 'Hand played. Build, trade, or end the turn.'
        : 'Play cards, build, trade, or buy one card.';

  const subline = empty ? null : holding >= 9
    ? `${holding} resources held, discard risk at a 7`
    : bankSubline(view);

  if (empty) {
    return (
      <div className="action-bar">
        <div className="prompt-wrap">
          <p className="prompt-line">{prompt}</p>
          {subline ? <p className="prompt-sub">{subline}</p> : null}
        </div>
        <div className="action-buttons">
          <Button variant="primary" className="end-turn pulse" onClick={props.onEndTurn} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>End turn</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="action-bar">
      <div className="prompt-wrap">
        <p className="prompt-line">{prompt}</p>
        {subline ? <p className="prompt-sub">{subline}</p> : null}
      </div>
      <div className="action-buttons">
        <Button variant="secondary" onClick={props.onOpenTrade} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Trade</Button>
        <Button variant="secondary" onClick={props.onOpenMarket} disabled={lost} reason={lost ? 'Connection lost. Reconnecting.' : null}>Buy</Button>
        <Button variant="primary" onClick={props.onEndTurn} disabled={!legal.canEndTurn || lost} reason={lost ? 'Connection lost. Reconnecting.' : !legal.canEndTurn ? 'You cannot end the turn right now.' : null}>
          End turn
        </Button>
      </div>
    </div>
  );

  function bar(promptText: string, buttons: JSX.Element | null): JSX.Element {
    return (
      <div className="action-bar">
        <p className="prompt-line">{promptText}</p>
        <div className="action-buttons">{buttons}</div>
      </div>
    );
  }
}

function bankSubline(view: GameView): string | null {
  const option = view.legal.bankTrades[0];
  if (!option) return null;
  if (option.count === 2) return `${capitalize(option.give)} port 2:1`;
  if (option.count === 3) return 'Generic port 3:1';
  return 'Bank 4:1';
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
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
  if (seats.length === 0) return null;
  return (
    <div className="victim-chips" role="group" aria-label="Choose a victim">
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
