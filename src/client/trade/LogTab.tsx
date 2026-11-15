import { useMemo, useState } from 'react';
import type { GameView, LogKind, Seat } from '@shared/types';
import { seatColor } from '../ui/icons';

type Filter = 'all' | 'builds' | 'cards' | 'rolls';

const MATCH: Record<Filter, LogKind[] | null> = {
  all: null,
  builds: ['build'],
  cards: ['card', 'buy'],
  rolls: ['roll', 'production', 'seven'],
};

export function LogTab({ view }: { view: GameView }): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const entries = useMemo(() => {
    const kinds = MATCH[filter];
    const filtered = kinds ? view.log.filter((entry) => kinds.includes(entry.kind)) : view.log;
    return filtered.slice(-40).reverse();
  }, [view.log, filter]);

  return (
    <div className="log-tab">
      <header className="rail-head">
        <h2 className="rail-title">Ship's log</h2>
        <div className="log-filters" role="group" aria-label="Log filters">
          {(['all', 'builds', 'cards', 'rolls'] as Filter[]).map((key) => (
            <button key={key} type="button" className={`chip-toggle${filter === key ? ' is-on' : ''}`} onClick={() => setFilter(key)} aria-pressed={filter === key}>
              {key[0]?.toUpperCase()}{key.slice(1)}
            </button>
          ))}
        </div>
      </header>
      <ol className="log-lines">
        {entries.length === 0 ? <li className="log-empty">Nothing logged under this filter yet.</li> : null}
        {entries.map((entry) => (
          <li key={entry.id} className={`log-line log-${entry.kind}`}>
            <span className="log-seat" style={{ background: entry.seat === null ? 'var(--sea-300)' : seatColor(entry.seat as Seat) }} aria-hidden="true" />
            <span className="log-turn">T{entry.turn}</span>
            <span className="log-text">{entry.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
