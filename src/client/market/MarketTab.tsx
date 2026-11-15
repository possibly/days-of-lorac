import { useEffect, useState } from 'react';
import type { CardDef, GameView, Resource } from '@shared/types';
import { MARKET_CARDS, CHARTER_CARDS } from '@shared/cards';
import { RESOURCES } from '@shared/types';
import { ResourceIcon } from '../ui/icons';
import { Button } from '../ui/Button';

interface MarketTabProps {
  view: GameView;
  purchaseUsed: boolean;
  onBuy: (defId: string) => void;
  letters: boolean;
}

const RESOURCE_WORD: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
};

/** Right rail "Market": charters on top, ten piles under, inline confirm. */
export function MarketTab({ view, purchaseUsed, onBuy, letters }: MarketTabProps): JSX.Element {
  const [confirm, setConfirm] = useState<string | null>(null);
  const you = view.players[view.you];

  useEffect(() => {
    if (!confirm) return;
    const node = document.querySelector('.inline-confirm');
    node?.scrollIntoView({ block: 'nearest' });
  }, [confirm]);

  const myTurn = view.legal.isTurn;
  const isTurn = myTurn && view.phase === 'action';
  const buyable = new Set(view.legal.buyable);
  const target = view.targetVp;

  const chip = purchaseUsed
    ? <span className="market-chip is-used"><span className="gold-dot" aria-hidden="true" />Purchase used</span>
    : !myTurn
      ? <span className="market-chip is-waiting">Waiting on {view.players[view.currentSeat]?.name ?? 'the table'}</span>
      : isTurn
        ? <span className="market-chip">1 purchase per turn</span>
        : <span className="market-chip is-waiting">Action phase only</span>;

  return (
    <div className={`market-tab${letters ? ' letters-on' : ''}`}>
      <header className="rail-head">
        <h2 className="rail-title">Market</h2>
        {chip}
      </header>

      <section className="charter-row" aria-label="Charter stacks">
        {CHARTER_CARDS.map((def) => (
          <MarketRow
            key={def.id}
            def={def}
            view={view}
            stock={view.market[def.id] ?? 0}
            buyable={buyable.has(def.id)}
            purchaseUsed={purchaseUsed}
            isTurn={isTurn}
            confirm={confirm === def.id}
            onConfirm={() => setConfirm(def.id)}
            onCancel={() => setConfirm(null)}
            onBuy={() => {
              onBuy(def.id);
              setConfirm(null);
            }}
            letters={letters}
            charter
            targetVp={target}
            resources={you?.resources ?? { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }}
          />
        ))}
      </section>

      {view.legal.buyable.length === 0 && !purchaseUsed && isTurn ? (
        <p className="market-hint">Nothing here is affordable yet. You need 2 resource types within reach.</p>
      ) : null}

      <div className="pile-list">
        {MARKET_CARDS.map((def) => (
          <MarketRow
            key={def.id}
            def={def}
            view={view}
            stock={view.market[def.id] ?? 0}
            buyable={buyable.has(def.id)}
            purchaseUsed={purchaseUsed}
            isTurn={isTurn}
            confirm={confirm === def.id}
            onConfirm={() => setConfirm(def.id)}
            onCancel={() => setConfirm(null)}
            onBuy={() => {
              onBuy(def.id);
              setConfirm(null);
            }}
            letters={letters}
            targetVp={target}
            resources={you?.resources ?? { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }}
          />
        ))}
      </div>
    </div>
  );
}

function missingText(cost: Record<string, number | undefined>, resources: Record<Resource, number>): string {
  const parts: string[] = [];
  for (const resource of RESOURCES) {
    const need = cost[resource] ?? 0;
    const short = need - resources[resource];
    if (short > 0) parts.push(`${short} more ${RESOURCE_WORD[resource]}`);
  }
  if (parts.length === 0) return '';
  return `Need ${parts.join(' and ')}.`;
}

function costLabel(def: CardDef): string {
  if (!def.cost) return 'no cost';
  return RESOURCES.filter((resource) => (def.cost?.[resource] ?? 0) > 0)
    .map((resource) => `${def.cost?.[resource] ?? 0} ${RESOURCE_WORD[resource]}`)
    .join(', ');
}

function MarketRow({
  def,
  view,
  stock,
  buyable,
  purchaseUsed,
  isTurn,
  confirm,
  onConfirm,
  onCancel,
  onBuy,
  letters,
  charter,
  targetVp,
  resources,
}: {
  def: CardDef;
  view: GameView;
  stock: number;
  buyable: boolean;
  purchaseUsed: boolean;
  isTurn: boolean;
  confirm: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onBuy: () => void;
  letters: boolean;
  charter?: boolean;
  targetVp: number;
  resources: Record<Resource, number>;
}): JSX.Element {
  const soldOut = stock <= 0;
  const costs = def.cost ? RESOURCES.filter((resource) => (def.cost?.[resource] ?? 0) > 0) : [];
  const missing = def.cost ? missingText(def.cost, resources) : '';
  let reason: string | null = null;
  if (soldOut) reason = 'Sold out. Empty piles stay empty.';
  else if (purchaseUsed) reason = 'One purchase per turn. Yours is spent.';
  else if (!isTurn) reason = 'You can only buy during your action phase.';
  else if (!buyable) reason = missing || 'You cannot afford that right now.';
  const primary = costs[0] ?? 'ore';
  const firstClause = def.text.split('.')[0] ?? def.text;
  const reasonId = `buy-reason-${def.id}`;

  if (soldOut && !charter) {
    return (
      <div className="market-row is-soldout">
        <div className="row-bar" style={{ background: `var(--${primary})` }} aria-hidden="true" />
        <span className="row-soldout-name">{def.name}</span>
        <span className="row-soldout">Sold out</span>
      </div>
    );
  }

  return (
    <section className={`market-row${soldOut ? ' is-soldout' : ''}${charter ? ' is-charter' : ''}${confirm ? ' is-confirming' : ''}`} aria-label={def.name}>
      <div className="row-bar" style={{ background: `var(--${primary})` }} aria-hidden="true" />
      <header className="row-head">
        <span className="row-name">{def.name}</span>
        <span className={`row-stock${stock <= 2 ? ' is-low' : ''}`}>
          {charter ? `x${stock}` : `${stock} left`}
        </span>
      </header>

      <div className="row-cost">
        {costs.length === 0 ? <span className="ci-blank">—</span> : costs.map((resource) => {
          const need = def.cost?.[resource] ?? 0;
          const short = Math.max(0, need - resources[resource]);
          return (
            <span key={resource} className={`cost-pip cost-${resource}${short > 0 ? ' is-missing' : ''}`} title={`${need} ${RESOURCE_WORD[resource]}`}>
              <span className="pip-n">{need}</span>
              <ResourceIcon resource={resource} size={11} letters={letters} />
            </span>
          );
        })}
        {def.vp ? <span className="vp-seal row-seal" title={`${def.vp} victory points`}>{def.vp}</span> : null}
      </div>

      <p className="row-effect" title={def.text}>{firstClause}.</p>

      <div className="row-action">
        <Button
          variant="secondary"
          className="buy-btn"
          disabled={!buyable}
          reason={reason}
          onClick={onConfirm}
          aria-describedby={reason ? reasonId : undefined}
        >
          Buy
        </Button>
      </div>
      {reason ? <span id={reasonId} className="sr-only">{reason}</span> : null}

      {confirm && buyable ? (
        <div className="inline-confirm">
          <p className="confirm-q">Buy {def.name} for {costLabel(def)}?</p>
          <p className="confirm-note">
            Goes straight to your discard. You cannot play it this turn.
            {charter ? ` Adds ${def.vp ?? 0} victory point${(def.vp ?? 0) === 1 ? '' : 's'} to your total right now, and stays in your deck forever. Target is ${targetVp}.` : ''}
          </p>
          <div className="confirm-actions">
            <Button variant="primary" onClick={onBuy}>Buy card</Button>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
