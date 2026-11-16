import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardInstance, GameView } from '@shared/types';
import { getCard } from '@shared/cards';
import { CardFace, cardDef, primaryResource } from './CardFace';
import { CardFlightLayer } from './CardFlight';
import type { CardFlightData, CardRect } from './CardFlight';
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
  /** This seat's deck just took its discard back and shuffled. */
  reshuffling: boolean;
}

/**
 * Ledger cards in a parchment shelf. Desktop gets the fanned hand from the
 * spec; tablets and phones get a flat scrolling row so the cards stay inside
 * the dock and nothing leans into the play strip.
 */
export function HandDock({ view, playableIids, choiceIids, selectedIid, onPlay, onInspect, letters, boughtStub, reshuffling }: HandDockProps): JSX.Element {
  const you = view.players[view.you];
  const dock = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(872);
  const [cardWidth, setCardWidth] = useState(152);
  const [spread, setSpread] = useState(false);
  const [flatHand, setFlatHand] = useState(
    () => typeof window !== 'undefined'
      && (window.matchMedia('(max-width: 1180px)').matches
        || window.matchMedia('(max-height: 520px)').matches),
  );
  const playRow = useRef<HTMLDivElement>(null);
  const [playScrollable, setPlayScrollable] = useState(false);

  useEffect(() => {
    // Tablets, phones, and short landscape viewports all want the flat row: the
    // fan's rotated outer cards overlap the play strip when the dock is short.
    const narrow = window.matchMedia('(max-width: 1180px)');
    const short = window.matchMedia('(max-height: 520px)');
    const sync = (): void => setFlatHand(narrow.matches || short.matches);
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

  // The played strip scrolls sideways once five cards are down. Keep the newest
  // play in view and only show the edge fade when there is more to reach.
  useEffect(() => {
    const node = playRow.current;
    if (!node) return undefined;
    const sync = (): void => {
      setPlayScrollable(node.scrollWidth > node.clientWidth + 1);
      node.scrollLeft = node.scrollWidth;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [played.length, boughtStub]);
  const n = hand.length;
  // Base fan step from the spec, then guard the outer cards' rotated corners
  // so a six- or nine-card hand never pokes past the dock into the rail.
  const baseStep = Math.max(72, Math.min(132, (width - cardWidth) / Math.max(1, n - 1)));
  const edgeGuard = Math.max(64, (width - 238) / Math.max(1, n - 1));
  const step = Math.min(baseStep, edgeGuard);
  const center = width / 2;
  // Small screens are too short for a readable fan: use the scrolling row so
  // no card hides under its neighbour or leans into the play strip.
  const showSpread = spread || flatHand;

  // ----- deal-in and end-of-turn flights ----------------------------------
  // The engine drops a seat's played cards and any charters into its discard on
  // end turn, keeps the rest of the hand, then draws the next seat up to five.
  // Both arrive as one view, so the dock keeps the last card boxes around to
  // launch copies from where the player last saw them.
  const lastTurn = useRef<{
    gameId: string;
    turn: number;
    phase: GameView['phase'];
    seat: number;
    hand: CardInstance[];
    played: CardInstance[];
  } | null>(null);
  const cardRects = useRef(new Map<number, CardRect>());
  const seenHand = useRef(new Map(hand.map((card) => [card.iid, true] as const)));
  const seenGame = useRef(view.gameId);
  const [deals, setDeals] = useState(new Map<number, { dx: number; dy: number; delay: number }>());
  const [flights, setFlights] = useState<CardFlightData[]>([]);
  const flightTimer = useRef<number | undefined>(undefined);
  const dealTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const node = dock.current;
    const currentIds = new Map(hand.map((card) => [card.iid, true] as const));
    if (seenGame.current !== view.gameId) {
      seenGame.current = view.gameId;
      seenHand.current = currentIds;
      setDeals(new Map());
      return;
    }
    const fresh = hand.filter((card) => !seenHand.current.has(card.iid));
    seenHand.current = currentIds;
    if (!node || fresh.length === 0) return;

    const deck = node.querySelector('[data-pile="deck"]');
    const dockBox = node.getBoundingClientRect();
    const deckBox = deck?.getBoundingClientRect() ?? null;
    const hasDeck = deckBox !== null && deckBox.width > 0 && deckBox.height > 0;
    const originX = hasDeck ? deckBox.left + deckBox.width / 2 : dockBox.right - 40;
    const originY = hasDeck ? deckBox.top + deckBox.height / 2 : dockBox.top + 18;
    const next = new Map<number, { dx: number; dy: number; delay: number }>();
    fresh.forEach((card, index) => {
      const element = node.querySelector(`[data-card-iid="${card.iid}"]`);
      if (!element) return;
      const box = element.getBoundingClientRect();
      next.set(card.iid, {
        dx: originX - (box.left + box.width / 2),
        dy: originY - (box.top + box.height / 2),
        delay: Math.min(index * 55, 240),
      });
    });
    if (next.size === 0) return;
    setDeals(next);
    if (dealTimer.current !== undefined) window.clearTimeout(dealTimer.current);
    // Clear the class once the last card has landed so a later layout change
    // does not replay the slide.
    dealTimer.current = window.setTimeout(() => setDeals(new Map()), 240 + 360);
  }, [hand, view.gameId]);

  useLayoutEffect(() => {
    const node = dock.current;
    const snapshot = {
      gameId: view.gameId,
      turn: view.turn,
      phase: view.phase,
      seat: view.currentSeat,
      hand: [...hand],
      played: [...played],
    };
    const previous = lastTurn.current;
    // Kept cards stay in hand, so only played cards and charters fly to the
    // discard. Flying the kept ones would be a lie the hand then contradicts.
    const leaving = previous
      ? [
          ...previous.played,
          ...previous.hand.filter((card) => getCard(card.defId).kind === 'charter'),
        ]
      : [];

    if (
      node
      && previous
      && previous.gameId === view.gameId
      && previous.turn < view.turn
      && previous.phase === 'action'
      && previous.seat === view.you
      && leaving.length > 0
    ) {
      const discard = node.querySelector('[data-pile="discard"]');
      const discardBox = discard?.getBoundingClientRect() ?? null;
      if (discardBox && discardBox.width > 0 && discardBox.height > 0) {
        const targetX = discardBox.left + discardBox.width / 2;
        const targetY = discardBox.top + discardBox.height / 2;
        const list: CardFlightData[] = [];
        leaving.forEach((card, index) => {
          const from = cardRects.current.get(card.iid);
          if (!from) return;
          list.push({
            key: `${view.gameId}:${previous.turn}:${card.iid}`,
            card,
            from,
            dx: targetX - (from.x + from.w / 2),
            dy: targetY - (from.y + from.h / 2),
            delay: Math.min(index * 42, 300),
            tilt: ((index * 37) % 11) - 5,
            duration: 380,
          });
        });
        if (list.length > 0) {
          setFlights(list);
          if (flightTimer.current !== undefined) window.clearTimeout(flightTimer.current);
          flightTimer.current = window.setTimeout(() => setFlights([]), 300 + 380 + 80);
        }
      }
    }

    lastTurn.current = snapshot;
    const rects = new Map<number, CardRect>();
    if (node) {
      node.querySelectorAll('[data-card-iid]').forEach((element) => {
        const iid = Number(element.getAttribute('data-card-iid'));
        if (Number.isFinite(iid)) rects.set(iid, boxOf(element));
      });
      node.querySelectorAll('[data-play-iid]').forEach((element) => {
        const iid = Number(element.getAttribute('data-play-iid'));
        if (Number.isFinite(iid)) rects.set(iid, boxOf(element));
      });
    }
    cardRects.current = rects;
  }, [view, hand, played, width, cardWidth, showSpread]);

  useEffect(() => () => {
    if (flightTimer.current !== undefined) window.clearTimeout(flightTimer.current);
    if (dealTimer.current !== undefined) window.clearTimeout(dealTimer.current);
  }, []);

  return (
    <section className={`hand-dock${showSpread ? ' is-spread' : ''}`} ref={dock} aria-label="Your hand">
      <div className="dock-head">
      <div
        ref={playRow}
        className={`play-area${playScrollable ? ' is-scrollable' : ''}`}
        aria-label="Cards played this turn"
      >
        {played.map((card) => {
          const def = cardDef(card);
          if (!def) return null;
          return (
            <span key={card.iid} className="play-stub" data-play-iid={card.iid} title={`${def.name}: ${def.text}`}>
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

        <div className={`hand-counters${reshuffling ? ' is-reshuffling' : ''}`} aria-hidden="true">
          <span className="counter" data-pile="deck"><span className="counter-card" />deck {you?.deckCount ?? 0}</span>
          <span className="counter" data-pile="discard"><span className="counter-card discard" />discard {you?.discardCount ?? 0}</span>
          {reshuffling ? <span className="reshuffle-flag">shuffled</span> : null}
        </div>
      </div>

      {flatHand ? null : (
        <button type="button" className="spread-toggle" onClick={() => setSpread((value) => !value)} aria-pressed={spread} title="Toggle a scrolling row instead of the fan">
          {showSpread ? 'Fan' : 'Spread'}
        </button>
      )}

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
              data-card-iid={card.iid}
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
                cost={view.cardCosts[card.defId]}
                playable={playableIids.has(card.iid)}
                needsChoice={choiceIids.has(card.iid)}
                selected={selectedIid === card.iid}
                letters={letters}
                deal={deals.get(card.iid) ?? null}
                onPlay={() => onPlay(card.iid)}
                onInspect={() => onInspect(card)}
              />
            </div>
          );
        })}
      </div>

      {flights.length > 0 ? <CardFlightLayer flights={flights} /> : null}
    </section>
  );
}

function boxOf(element: Element): CardRect {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, w: box.width, h: box.height };
}

function safeDef(card: CardInstance) {
  try {
    return getCard(card.defId);
  } catch {
    return null;
  }
}
