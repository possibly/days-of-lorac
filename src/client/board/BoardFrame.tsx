import { useEffect, useRef, useState } from 'react';
import type { GameView } from '@shared/types';
import { BoardSvg, targetLabel } from './BoardSvg';
import type { BoardMode, BoardTarget, Floater } from './BoardSvg';
import { indexBoard } from './geometry';
import { Die } from '../ui/icons';

interface BoardFrameProps {
  view: GameView;
  mode: BoardMode;
  legalVertices: string[];
  legalEdges: string[];
  legalHexes: string[];
  selected: BoardTarget | null;
  floaters: Floater[];
  flashHexes: string[];
  onSelect: (target: BoardTarget) => void;
  /** Announced under the board; e.g. what the last roll produced. */
  tableTalk: string;
}

/**
 * The board frame: mat, SVG, dice tray, and shared tooltip layer. All geometry
 * is in the SVG; this component only owns chrome and the tooltip.
 */
export function BoardFrame({
  view,
  mode,
  legalVertices,
  legalEdges,
  legalHexes,
  selected,
  floaters,
  flashHexes,
  onSelect,
  tableTalk,
}: BoardFrameProps): JSX.Element {
  const index = indexBoard(view.board);
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; show: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const dismissTimer = useRef<number | undefined>(undefined);
  const coarse = useRef(false);
  const [diceAnimate, setDiceAnimate] = useState(false);
  const lastRoll = useRef<string>('');

  useEffect(() => {
    const dice = view.dice;
    if (!dice) {
      lastRoll.current = '';
      return undefined;
    }
    // One tumble per roll. `version` moves on every action, so the old key made
    // the dice bounce again after each build, buy, or card play.
    const key = `${view.gameId}:${view.turn}:${dice.die1}:${dice.die2}`;
    if (key === lastRoll.current) return undefined;
    lastRoll.current = key;
    setDiceAnimate(true);
    const stop = window.setTimeout(() => setDiceAnimate(false), 700);
    return () => window.clearTimeout(stop);
  }, [view.dice, view.gameId, view.turn]);

  useEffect(() => {
    // Touch has no pointerleave, so a hover tooltip would stick around and
    // sit over the board. Treat it as a short tap hint instead.
    coarse.current =
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches;
    const clear = (): void => setTip(null);
    const node = frame.current;
    node?.addEventListener('pointerdown', clear, true);
    return () => {
      node?.removeEventListener('pointerdown', clear, true);
    };
  }, []);

  useEffect(() => {
    setTip(null);
    if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current);
  }, [view.version, view.phase, selected]);

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current);
  }, []);

  const showTip = (target: BoardTarget | null, point: { x: number; y: number } | null): void => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    if (!target) {
      setTip((current) => (current ? { ...current, show: false } : null));
      return;
    }
    const text = targetLabel(view, index, target);
    // Nothing to say (an empty edge) means no bubble at all, not an empty one.
    if (!text) {
      setTip(null);
      return;
    }
    if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current);
    if (coarse.current) {
      dismissTimer.current = window.setTimeout(() => setTip(null), 2200);
    }
    const place = (): void => {
      const rect = frame.current?.getBoundingClientRect();
      if (!rect) return;
      const rawX = point ? point.x - rect.left : rect.width / 2;
      const rawY = point ? point.y - rect.top : 64;
      const x = Math.max(12, Math.min(rawX + 14, rect.width - 272));
      const y = Math.max(12, Math.min(rawY + 14, rect.height - 80));
      setTip({ text, x, y, show: true });
    };
    if (point) place();
    else timer.current = window.setTimeout(place, 60);
  };

  const dice = view.dice;

  return (
    <div className="board-frame" ref={frame}>
      <div className="board-mat" aria-hidden="true" />

      <BoardSvg
        view={view}
        mode={mode}
        legalVertices={legalVertices}
        legalEdges={legalEdges}
        legalHexes={legalHexes}
        selected={selected}
        floaters={floaters}
        flashHexes={flashHexes}
        onSelect={onSelect}
        onHover={showTip}
      />

      <div className={`dice-tray${diceAnimate ? ' dice-animate' : ''}`} aria-label={dice ? `Dice: ${dice.die1} and ${dice.die2}, total ${dice.total}` : 'Dice tray'}>
        <Die value={dice?.die1 ?? 0} animate={diceAnimate} />
        <Die value={dice?.die2 ?? 1} animate={diceAnimate} />
        {dice ? <span className="dice-total">{dice.total}</span> : <span className="dice-total dice-empty">2d6</span>}
      </div>

      {tableTalk ? <div className="board-talk" aria-live="polite">{tableTalk}</div> : null}

      {tip && tip.show ? (
        <div className="tooltip" style={{ transform: `translate(${tip.x}px, ${tip.y}px)` }} role="tooltip">
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}
