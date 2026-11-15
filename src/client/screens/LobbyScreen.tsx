import { useEffect, useRef, useState } from 'react';
import type { LobbyView } from '@shared/protocol';
import type { ChatMessage } from '@shared/protocol';
import type { BotDifficulty, MapSettings, Seat } from '@shared/types';
import { describeMap } from '@shared/map-settings';
import { Button } from '../ui/Button';
import { MapSettingsForm } from '../ui/MapSettingsForm';
import { SeatCoin } from '../ui/SeatCoin';
import { copyText } from '../ui/clipboard';
import type { CopyResult } from '../ui/clipboard';

interface LobbyScreenProps {
  lobby: LobbyView;
  you: Seat;
  chats: ChatMessage[];
  connected: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onMap: (map: MapSettings) => void;
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
  onMap,
  onAddBot,
  onRemove,
  onLeave,
  onChat,
  onRules,
}: LobbyScreenProps): JSX.Element {
  const [copyState, setCopyState] = useState<CopyResult | null>(null);
  const [text, setText] = useState('');
  // The server owns the map setting. The draft keeps rapid clicks from
  // snapping back to the last broadcast while a change is in flight.
  const [mapDraft, setMapDraft] = useState<MapSettings>(lobby.config.map);
  const link = useRef<HTMLInputElement>(null);
  const me = lobby.players.find((player) => player.seat === you);
  const isHost = lobby.hostSeat === you;
  const openSeats = Math.max(0, lobby.config.maxPlayers - lobby.players.length);
  // The host's ready flag is implicit: the host opens the table, so only the
  // guests have to say they are in. Two filled seats is still the floor.
  const guests = lobby.players.filter((player) => !player.isBot && player.seat !== lobby.hostSeat);
  const allGuestsReady = guests.every((player) => player.ready);
  const invite = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}?room=${lobby.code}`;

  useEffect(() => {
    setMapDraft(lobby.config.map);
  }, [lobby.config.map.size, lobby.config.map.terrain, lobby.config.map.tokens]);

  useEffect(() => {
    if (!copyState) return undefined;
    const timer = window.setTimeout(() => setCopyState(null), 3200);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copy = async (): Promise<void> => {
    setCopyState(await copyText(invite));
  };

  const selectInvite = (): void => {
    link.current?.focus();
    link.current?.select();
    link.current?.setSelectionRange(0, invite.length);
  };

  const copyLine = copyState === 'copied'
    ? 'Invite link copied.'
    : copyState === 'manual'
      ? 'Clipboard blocked. Select the invite link below and copy it by hand.'
      : copyState === 'failed'
        ? 'Could not copy. The invite link above is selectable.'
        : null;

  return (
    <main className="lobby-screen">
      <header className="lobby-head">
        <div>
          <p className="eyebrow">Guild table</p>
          <h1 className="panel-title">Room <span className="room-code big-code">{lobby.code}</span></h1>
          <p className="lobby-sub">Race to {lobby.targetVp} · {lobby.config.maxPlayers} seats · fill difficulty {lobby.config.difficulty}</p>
          <p className="lobby-sub lobby-map-line">{describeMap(lobby.config.map)}</p>
        </div>
        <div className="lobby-head-actions">
          <Button variant="secondary" onClick={copy} title={invite}>
            {copyState === 'copied' ? 'Invite copied' : copyState === 'manual' || copyState === 'failed' ? 'Copy failed, select it' : 'Copy invite link'}
          </Button>
          <Button variant="ghost" onClick={onRules}>Rules</Button>
          <Button variant="ghost" onClick={onLeave}>Leave</Button>
        </div>
      </header>
      {copyLine ? <p className={`copy-note is-${copyState}`} role="status">{copyLine}</p> : null}

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

          <div className="lobby-map">
            <h2 className="panel-title small">Island</h2>
            {isHost ? (
              <MapSettingsForm
                value={mapDraft}
                maxSeats={lobby.config.maxPlayers}
                disabled={!connected}
                onChange={(next) => {
                  setMapDraft(next);
                  onMap(next);
                }}
              />
            ) : (
              <p className="map-note">The host picks the island size, land, and numbers. Changes show up here before the start.</p>
            )}
          </div>

          <div className="lobby-controls">
            {isHost ? (
              <span className="host-note" title="The host does not ready up. Guests do.">Host · you start the game</span>
            ) : (
              <Button variant={me?.ready ? 'secondary' : 'primary'} onClick={() => onReady(!me?.ready)} disabled={!connected} reason={!connected ? 'Reconnecting to the server.' : null}>
                {me?.ready ? 'Not ready' : 'Ready'}
              </Button>
            )}
            {isHost ? (
              <Button
                variant="primary"
                onClick={onStart}
                disabled={!connected || lobby.players.length < 2 || !allGuestsReady}
                reason={!connected
                  ? 'Reconnecting to the server.'
                  : lobby.players.length < 2
                    ? 'Seat at least two players.'
                    : !allGuestsReady
                      ? 'Every guest has to be ready.'
                      : null}
              >
                Start game
              </Button>
            ) : (
              <span className="waiting-host">Waiting for the host to start.</span>
            )}
            {openSeats > 0 ? <span className="lobby-open">{openSeats} seat{openSeats === 1 ? '' : 's'} open</span> : null}
          </div>

          <label className="invite-field">
            <span>Invite link</span>
            <input
              ref={link}
              readOnly
              value={invite}
              className="invite-link"
              onFocus={(event) => event.target.select()}
              onPointerUp={selectInvite}
              aria-describedby="invite-hint"
            />
            <span id="invite-hint" className="invite-hint">Open the link on any device on the same network. It resumes your seat here.</span>
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
