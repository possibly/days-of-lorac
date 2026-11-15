import { useState } from 'react';
import type { BankTradeOption, GameView, PartialResources, Resource, Seat } from '@shared/types';
import { RESOURCES } from '@shared/types';
import { ResourceIcon } from '../ui/icons';
import { Button } from '../ui/Button';

interface TradeTabProps {
  view: GameView;
  onOffer: (give: PartialResources, want: PartialResources, to: 'all' | Seat[]) => void;
  onCancelOffer: () => void;
  onBankTrade: (option: BankTradeOption) => void;
  letters: boolean;
}

const WORD: Record<Resource, string> = { wood: 'Wood', brick: 'Brick', sheep: 'Sheep', wheat: 'Wheat', ore: 'Ore' };

function count(map: PartialResources): number {
  return Object.values(map).reduce((sum, value) => sum + (value ?? 0), 0);
}

function describe(map: PartialResources): string {
  const parts = RESOURCES.filter((resource) => (map[resource] ?? 0) > 0).map((resource) => `${map[resource]} ${WORD[resource]}`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

export function TradeTab({ view, onOffer, onCancelOffer, onBankTrade, letters }: TradeTabProps): JSX.Element {
  const [give, setGive] = useState<PartialResources>({});
  const [want, setWant] = useState<PartialResources>({});
  const [to, setTo] = useState<'all' | Seat>('all');
  const you = view.players[view.you];
  const offer = view.tradeOffer;

  const step = (side: 'give' | 'want', resource: Resource, delta: number): void => {
    if (side === 'give') setGive((current) => adjust(current, resource, delta, you?.resources[resource] ?? 0));
    else setWant((current) => adjust(current, resource, delta, 99));
  };

  const ready = count(give) > 0 && count(want) > 0;

  return (
    <div className="trade-tab">
      <header className="rail-head">
        <h2 className="rail-title">Trade</h2>
        <span className="market-chip">{view.legal.bankTrades[0] ? `Bank rate ${view.legal.bankTrades[0].count}:1` : 'Bank 4:1'}</span>
      </header>

      {offer ? (
        <section className="open-offer" aria-label="Open offer">
          <p className="offer-line">
            <b>{view.players[offer.from]?.name}</b> offers {describe(offer.give)} for {describe(offer.want)}.
          </p>
          <p className="offer-note">
            {offer.from === view.you
              ? `Waiting on ${offer.to.length} player${offer.to.length === 1 ? '' : 's'}.`
              : 'You are a recipient.'}
          </p>
          {offer.from === view.you ? (
            <Button variant="secondary" onClick={onCancelOffer} disabled={!view.legal.canCancelTrade} reason={!view.legal.canCancelTrade ? 'That offer is not yours to cancel.' : null}>
              Cancel offer
            </Button>
          ) : null}
        </section>
      ) : (
        <>
          <div className="offer-grids">
            <OfferGrid title="You give" side="give" values={give} onStep={step} held={you?.resources ?? null} letters={letters} />
            <div className="offer-arrow" aria-hidden="true">⇄</div>
            <OfferGrid title="You want" side="want" values={want} onStep={step} held={null} letters={letters} />
          </div>

          {view.players.length > 2 ? (
            <div className="recipient-row" role="group" aria-label="Offer to">
              <span className="recipient-label">Offer to</span>
              <button type="button" className={`chip-toggle${to === 'all' ? ' is-on' : ''}`} onClick={() => setTo('all')} aria-pressed={to === 'all'}>Everyone</button>
              {view.players.filter((player) => player.seat !== view.you).map((player) => (
                <button key={player.seat} type="button" className={`chip-toggle${to === player.seat ? ' is-on' : ''}`} onClick={() => setTo(player.seat)} aria-pressed={to === player.seat}>
                  {player.name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="offer-actions">
            <Button
              variant="primary"
              disabled={!ready}
              reason={!ready ? 'Put at least one resource on each side.' : null}
              onClick={() => {
                onOffer(give, want, to === 'all' ? 'all' : [to]);
                setGive({});
                setWant({});
              }}
            >
              {to === 'all' ? 'Offer to all' : 'Offer'}
            </Button>
            <Button variant="ghost" onClick={() => { setGive({}); setWant({}); }}>Cancel</Button>
          </div>
        </>
      )}

      <section className="bank-trades" aria-label="Bank and ports">
        <h3 className="rail-subtitle">Bank and ports</h3>
        {view.legal.bankTrades.length === 0 ? (
          <p className="rail-empty">No bank trade available right now. You need {view.legal.isTurn ? 'four of one resource, or a port.' : 'the action phase.'}</p>
        ) : (
          <ul className="bank-list">
            {view.legal.bankTrades.map((option) => (
              <li key={`${option.give}-${option.receive}`} className="bank-row">
                <span className="bank-line">
                  {option.count} <ResourceIcon resource={option.give} size={12} letters={letters} /> <span className="bank-word">{WORD[option.give]}</span>
                  <span className="bank-for">for 1</span>
                  <ResourceIcon resource={option.receive} size={12} letters={letters} />
                </span>
                <Button variant="ghost" className="btn-small" onClick={() => onBankTrade(option)}>Trade</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function adjust(current: PartialResources, resource: Resource, delta: number, max: number): PartialResources {
  const next = { ...current };
  const value = Math.max(0, Math.min(max, (next[resource] ?? 0) + delta));
  if (value === 0) delete next[resource];
  else next[resource] = value;
  return next;
}

function OfferGrid({
  title,
  side,
  values,
  onStep,
  held,
  letters,
}: {
  title: string;
  side: 'give' | 'want';
  values: PartialResources;
  onStep: (side: 'give' | 'want', resource: Resource, delta: number) => void;
  held: Record<Resource, number> | null;
  letters: boolean;
}): JSX.Element {
  return (
    <fieldset className="offer-grid">
      <legend>{title}</legend>
      {RESOURCES.map((resource) => {
        const value = values[resource] ?? 0;
        const maxed = held ? value >= held[resource] : false;
        return (
          <div key={resource} className={`offer-cell${value > 0 ? ' is-set' : ''}`}>
            <span className="offer-res">
              <ResourceIcon resource={resource} size={14} letters={letters} />
              <span className="offer-word">{WORD[resource]}</span>
            </span>
            <span className="stepper">
              <button type="button" className="step-btn" onClick={() => onStep(side, resource, -1)} disabled={value === 0} aria-label={`One less ${WORD[resource]}`}>−</button>
              <span className="step-value" aria-live="polite">{value}</span>
              <button type="button" className="step-btn" onClick={() => onStep(side, resource, 1)} disabled={maxed} aria-label={`One more ${WORD[resource]}`}>+</button>
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}
