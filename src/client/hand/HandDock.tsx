import { useEffect, useRef, useState } from 'react';
import type { CardInstance, GameView } from '@shared/types';
import { getCard } from '@shared/cards';
import { CardFace, cardDef, primaryResource } from './CardFace';
import { ResourceIcon } from '../ui/icons';

interface HandDockProps {
  view: GameView;
  playableIids: Set<number>;
  choiceIids: Set<number>;
  selectedIid: number | null;
  onPlay: (iid: number) => void;
  onInspect: (card: CardInstance) => void;
  letters: boolean;
  boughtStub: { name: string; open: boolean } | null;
}

/**
 * Fanned ledger cards in a parchment shelf. Positions use the fan formula from
 * the spec; the dock measures itself so the fan stays centred at any width.
 */
export function HandDock({ view, playableIids, choiceIids, selectedIid, onPlay, onInspect, letters, boughtStub }: HandDockProps): JSX.Element {
  const you = view.players[view.you];
  const dock = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(872);
  const [cardWidth, setCardWidth] = useState(152);
  const [spread, setSpread] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    // Portrait phones and short landscape viewports both want the flat row.
    const narrow = window.matchMedia('(max-width: 640px)');
    const short = window.matchMedia('(max-height: 520px)');
    const sync = (): void => setPhone(narrow.matches || short.matches);
    sync();
    narrow.addEventListener('change', sync);
    short.addEventListener('change', sync);
    return () => {
      narrow.removeEventListener('change', sync);
      short.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    const node = dock.current;
    if (!node) return undefined;
    // The card width lives in CSS (`--card-w`) so the fan maths and the
    // rendered card stay in sync across desktop, tablet, and phone.
    const measure = (): void => {
      const computed = Number.parseFloat(window.getComputedStyle(node).getPropertyValue('--card-w'));
      if (Number.isFinite(computed) && computed > 0) setCardWidth(computed);
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
      measure();
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    measure();
    return () => observer.disconnect();
  }, []);

  const hand = you?.hand ?? [];
  const played = you?.played ?? [];
  const n = hand.length;
  // Base fan step from the spec, then guard the outer cards' rotated corners
  // so a six- or nine-card hand never pokes past the dock into the rail.
  const baseStep = Math.max(72, Math.min(132, (width - cardWidth) / Math.max(1, n - 1)));
  const edgeGuard = Math.max(64, (width - 238) / Math.max(1, n - 1));
  const step = Math.min(baseStep, edgeGuard);
  const center = width / 2;
  const counts = new Map<string, number>();
  for (const card of hand) counts.set(card.defId, (counts.get(card.defId) ?? 0) + 1);
  // A phone is too narrow for a readable fan: use the scrolling row so no
  // card hides under its neighbour or runs past the dock.
  const showSpread = spread || phone;

  return (
    <section className={`hand-dock${showSpread ? ' is-spread' : ''}`} ref={dock} aria-label="Your hand">
      <div className="play-area" aria-label="Cards played this turn">
        {played.map((card) => {
          const def = cardDef(card);
          if (!def) return null;
          return (
            <span key={card.iid} className="play-stub" title={`${def.name}: ${def.text}`}>
              <span className="play-stub-icon" style={{ color: `var(--${primaryResource(def)})` }}><ResourceIcon resource={primaryResource(def)} size={12} /></span>
              <span className="play-stub-name">{def.name}</span>
            </span>
          );
        })}
        {boughtStub ? (
          <span key={boughtStub.name} className={`play-stub bought-stub${boughtStub.open ? ' is-flipping' : ''}`}>
            <span className="play-stub-name">bought {boughtStub.name}</span>
          </span>
        ) : null}
        {played.length === 0 && !boughtStub ? <span className="play-area-empty">Play area</span> : null}
      </div>

      <div className="hand-counters" aria-hidden="true">
        <span className="counter"><span className="counter-card" />deck {you?.deckCount ?? 0}</span>
        <span className="counter"><span className="counter-card discard" />discard {you?.discardCount ?? 0}</span>
      </div>

      <button type="button" className="spread-toggle" onClick={() => setSpread((value) => !value)} aria-pressed={spread} title="Toggle a scrolling row instead of the fan">
        {showSpread ? 'Fan' : 'Spread'}
      </button>

      <div className="hand-fan" role="list">
        {hand.length === 0 ? <p className="hand-empty">Hand empty.</p> : null}
        {hand.map((card, i) => {
          const def = safeDef(card);
          if (!def) return null;
          const offset = i - (n - 1) / 2;
          const rotation = Math.max(-10, Math.min(10, offset * 3.5));
          const lift = Math.pow(Math.abs(offset), 1.4) * 5;
          const left = showSpread ? undefined : center + offset * step - cardWidth / 2;
          return (
            <div
              key={card.iid}
              className="card-position"
              role="listitem"
              style={showSpread ? undefined : {
                left,
                zIndex: 10 + i,
                transform: `rotate(${rotation}deg)`,
                ['--rot' as string]: `${rotation}deg`,
                ['--lift' as string]: `${lift}px`,
              } as React.CSSProperties}
            >
              <CardFace
                card={card}
                def={def}
                playable={playableIids.has(card.iid)}
                needsChoice={choiceIids.has(card.iid)}
                selected={selectedIid === card.iid}
                duplicateCount={counts.get(card.defId) ?? 1}
                letters={letters}
                onPlay={() => onPlay(card.iid)}
                onInspect={() => onInspect(card)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function safeDef(card: CardInstance) {
  try {
    return getCard(card.defId);
  } catch {
    return null;
  }
}
