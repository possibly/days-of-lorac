import { useEffect, useRef, useState } from 'react';
import type { LobbyView } from '@shared/protocol';
import type { ChatMessage } from '@shared/protocol';
import type { BotDifficulty, Seat } from '@shared/types';
import { Button } from '../ui/Button';
import { SeatCoin } from '../ui/SeatCoin';

interface LobbyScreenProps {
  lobby: LobbyView;
  you: Seat;
  chats: ChatMessage[];
  connected: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onAddBot: (difficulty: BotDifficulty) => void;
  onRemove: (seat: Seat) => void;
  onLeave: () => void;
  onChat: (text: string) => void;
  onRules: () => void;
}

export function LobbyScreen({
  lobby,
  you,
  chats,
  connected,
  onReady,
  onStart,
  onAddBot,
  onRemove,
  onLeave,
  onChat,
  onRules,
}: LobbyScreenProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const me = lobby.players.find((player) => player.seat === you);
  const isHost = lobby.hostSeat === you;
  const openSeats = Math.max(0, lobby.config.maxPlayers - lobby.players.length);
  const allReady = lobby.players.filter((player) => !player.isBot).every((player) => player.ready);
  const invite = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}?room=${lobby.code}`;

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(invite);
    } catch {
      // Clipboard can fail without permission; the field below is selectable.
    }
    setCopied(true);
  };

  return (
    <main className="lobby-screen">
      <header className="lobby-head">
        <div>
          <p className="eyebrow">Guild table</p>
          <h1 className="panel-title">Room <span className="room-code big-code">{lobby.code}</span></h1>
          <p className="lobby-sub">Race to {lobby.targetVp} · {lobby.config.maxPlayers} seats · fill difficulty {lobby.config.difficulty}</p>
        </div>
        <div className="lobby-head-actions">
          <Button variant="secondary" onClick={copy}>{copied ? 'Invite copied' : 'Copy invite link'}</Button>
          <Button variant="ghost" onClick={onRules}>Rules</Button>
          <Button variant="ghost" onClick={onLeave}>Leave</Button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="parchment lobby-seats" aria-label="Seats">
          <div className="lobby-seat-grid">
            {Array.from({ length: lobby.config.maxPlayers }).map((_, seat) => {
              const player = lobby.players.find((item) => item.seat === seat);
              return (
                <article key={seat} className={`lobby-seat${player ? ' is-filled' : ' is-empty'}${player?.seat === you ? ' is-you' : ''}`}>
                  <header className="seat-head">
                    <SeatCoin seat={seat as Seat} size={28} />
                    <span className="seat-name">{player ? player.name : 'Open seat'}</span>
                    {player?.host ? <span className="badge badge-host">HOST</span> : null}
                    {player?.isBot ? <span className="badge badge-bot">BOT</span> : null}
                    {player && !player.connected ? <span className="badge badge-offline">OFFLINE</span> : null}
                  </header>
                  {player ? (
                    <div className="seat-state">
                      {player.isBot ? (
                        <span className="seat-ready">Bot seat · {lobby.config.difficulty}</span>
                      ) : (
                        <span className={`seat-ready${player.ready ? ' is-ready' : ''}`}>{player.ready ? 'Ready' : 'Not ready'}</span>
                      )}
                      {isHost && !player.isBot && player.seat !== you ? (
                        <Button variant="ghost" className="btn-small" onClick={() => onRemove(player.seat)}>Remove</Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="seat-state">
                      <span className="seat-wait">Waiting for a player</span>
                      {isHost ? (
                        <div className="bot-add">
                          {(['easy', 'normal', 'hard'] as const).map((level) => (
                            <Button key={level} variant="ghost" className="btn-small" onClick={() => onAddBot(level)}>
                              + {level} bot
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="lobby-controls">
            <Button variant={me?.ready ? 'secondary' : 'primary'} onClick={() => onReady(!me?.ready)} disabled={!connected} reason={!connected ? 'Reconnecting to the server.' : null}>
              {me?.ready ? 'Not ready' : 'Ready'}
            </Button>
            {isHost ? (
              <Button variant="primary" onClick={onStart} disabled={!connected || lobby.players.length < 2 || !allReady} reason={!connected ? 'Reconnecting to the server.' : lobby.players.length < 2 ? 'Seat at least two players.' : !allReady ? 'Everyone has to be ready.' : null}>
                Start game
              </Button>
            ) : (
              <span className="waiting-host">Waiting for the host to start.</span>
            )}
            {openSeats > 0 ? <span className="lobby-open">{openSeats} seat{openSeats === 1 ? '' : 's'} open</span> : null}
          </div>

          <label className="invite-field">
            <span>Invite link</span>
            <input readOnly value={invite} onFocus={(event) => event.target.select()} />
          </label>
        </section>

        <aside className="parchment lobby-chat" aria-label="Table talk">
          <h2 className="panel-title small">Table talk</h2>
          <ol className="chat-lines">
            {chats.length === 0 ? <li className="chat-empty">No table talk yet.</li> : null}
            {chats.slice(-12).map((message) => (
              <li key={message.id} className={message.seat === null ? 'chat-system' : 'chat-line'}>
                {message.seat === null ? (
                  <span>{message.text}</span>
                ) : (
                  <>
                    <SeatCoin seat={message.seat} size={16} />
                    <span className="chat-name">{message.name}</span>
                    <span className="chat-text">{message.text}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = text.trim();
              if (!trimmed) return;
              onChat(trimmed.slice(0, 160));
              setText('');
            }}
          >
            <input value={text} maxLength={160} onChange={(event) => setText(event.target.value)} placeholder="Say something" aria-label="Chat message" />
            <Button variant="secondary" className="btn-small" type="submit" disabled={!connected || text.trim().length === 0}>Send</Button>
          </form>
        </aside>
      </div>
    </main>
  );
}
