import { useMemo, useRef, useState } from 'react';
import type { GameView, LogKind, Seat } from '@shared/types';
import type { ChatMessage } from '@shared/protocol';
import { seatColor } from '../ui/icons';
import { SeatCoin } from '../ui/SeatCoin';
import { Button } from '../ui/Button';

type Filter = 'all' | 'builds' | 'cards' | 'rolls';

const MATCH: Record<Filter, LogKind[] | null> = {
  all: null,
  builds: ['build'],
  cards: ['card', 'buy'],
  rolls: ['roll', 'production', 'seven'],
};

/**
 * Ship's log plus table talk. The chat is deliberately compact: this rail is
 * the only place a tailnet table can talk mid-game, and it must never steal a
 * keyboard shortcut, so the input stops its own key events.
 */
export function LogTab({
  view,
  chats,
  connected,
  onChat,
}: {
  view: GameView;
  chats: ChatMessage[];
  connected: boolean;
  onChat: (text: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const lines = useRef<HTMLOListElement>(null);
  const entries = useMemo(() => {
    const kinds = MATCH[filter];
    const filtered = kinds ? view.log.filter((entry) => kinds.includes(entry.kind)) : view.log;
    return filtered.slice(-40).reverse();
  }, [view.log, filter]);

  const send = (): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChat(trimmed.slice(0, 160));
    setText('');
  };

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

      <section className="log-chat" aria-label="Table talk">
        <header className="log-chat-head">
          <h3 className="rail-subtitle">Table talk</h3>
          <span className="log-chat-count">{chats.length > 0 ? `${Math.min(chats.length, 12)} lines` : 'quiet'}</span>
        </header>
        <ol className="chat-lines is-compact" ref={lines}>
          {chats.length === 0 ? <li className="chat-empty">No table talk yet. Say hello to the table.</li> : null}
          {chats.slice(-12).map((message) => (
            <li key={message.id} className={message.seat === null ? 'chat-system' : 'chat-line'}>
              {message.seat === null ? (
                <span>{message.text}</span>
              ) : (
                <>
                  <SeatCoin seat={message.seat} size={14} />
                  <span className="chat-name">{message.name}</span>
                  <span className="chat-text">{message.text}</span>
                </>
              )}
            </li>
          ))}
        </ol>
        <form
          className="chat-form is-compact"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          onKeyDown={(event) => {
            // Game shortcuts listen on window; a chat field must never roll,
            // end a turn, or open a drawer while typing.
            event.stopPropagation();
          }}
        >
          <input
            value={text}
            maxLength={160}
            onChange={(event) => setText(event.target.value)}
            placeholder={connected ? 'Say something' : 'Reconnecting…'}
            aria-label="Table talk message"
            disabled={!connected}
          />
          <Button variant="secondary" className="btn-small" type="submit" disabled={!connected || text.trim().length === 0}>Send</Button>
        </form>
      </section>
    </div>
  );
}
