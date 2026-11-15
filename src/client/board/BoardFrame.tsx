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
  targetList: { id: string; kind: BoardTarget['kind']; label: string }[];
  /** Announced under the board; e.g. what the last roll produced. */
  tableTalk: string;
}

/**
 * The board frame: mat, SVG, dice tray, shared tooltip layer, and the
 * accessible "List legal placements" disclosure. All geometry is in the SVG;
 * this component only owns chrome and the tooltip.
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
  targetList,
  tableTalk,
}: BoardFrameProps): JSX.Element {
  const index = indexBoard(view.board);
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; show: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [listOpen, setListOpen] = useState(false);
  const [diceAnimate, setDiceAnimate] = useState(false);
  const lastRoll = useRef<string>('');

  useEffect(() => {
    const key = view.dice ? `${view.version}:${view.dice.total}` : '';
    if (key && key !== lastRoll.current) {
      lastRoll.current = key;
      setDiceAnimate(true);
      const stop = window.setTimeout(() => setDiceAnimate(false), 700);
      return () => window.clearTimeout(stop);
    }
    return undefined;
  }, [view.version, view.dice]);

  useEffect(() => {
    setListOpen(false);
  }, [mode]);

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);

  const showTip = (target: BoardTarget | null, point: { x: number; y: number } | null): void => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    if (!target) {
      setTip((current) => (current ? { ...current, show: false } : null));
      return;
    }
    const text = targetLabel(view, index, target);
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

      <div className="board-talk" aria-live="polite">{tableTalk}</div>

      {targetList.length > 0 ? (
        <div className="board-a11y">
          <button type="button" className="btn btn-ghost btn-small" aria-expanded={listOpen} onClick={() => setListOpen((open) => !open)}>
            {listOpen ? 'Hide legal placements' : `List legal placements (${targetList.length})`}
          </button>
          {listOpen ? (
            <ul className="target-list">
              {targetList.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <button
                    type="button"
                    className="target-list-item"
                    onClick={() => {
                      onSelect({ kind: item.kind, id: item.id });
                      setListOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {tip && tip.show ? (
        <div className="tooltip" style={{ transform: `translate(${tip.x}px, ${tip.y}px)` }} role="tooltip">
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}
