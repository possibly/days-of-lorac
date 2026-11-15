import { useState } from 'react';
import type { LinkState } from '../net/socket';
import { GuildSeal } from '../ui/icons';
import { Button } from '../ui/Button';
import type { StoredSession } from '../net/storage';

interface TitleScreenProps {
  name: string;
  onName: (name: string) => void;
  onSolo: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onResume: (code: string) => void;
  onForget: () => void;
  onRules: () => void;
  session: StoredSession | null;
  offline: boolean;
  link: LinkState;
  serverVersion: string | null;
  clientVersion: string;
  latency: number | null;
}

export function TitleScreen({
  name,
  onName,
  onSolo,
  onCreate,
  onJoin,
  onResume,
  onForget,
  onRules,
  session,
  offline,
  link,
  serverVersion,
  clientVersion,
  latency,
}: TitleScreenProps): JSX.Element {
  const [showName, setShowName] = useState(false);
  const mismatch = link === 'open' && serverVersion !== null && serverVersion !== clientVersion;

  return (
    <main className="title-screen">
      <div className="parchment title-panel">
        <GuildSeal size={96} />
        <p className="eyebrow">Guild charter · merchants of the inland sea</p>
        <h1 className="wordmark">Days of Lorac</h1>
        <p className="tagline">
          A board game of hexes, roads, and hard-won decks. Settle the island, build your guild,
          and be the first to the target.
        </p>

        {!offline && session ? (
          <div className="resume-strip">
            <span>You have a game in room <b className="room-code">{session.code}</b>.</span>
            <div className="resume-actions">
              <Button variant="primary" className="btn-small" onClick={() => onResume(session.code)}>Resume</Button>
              <Button variant="ghost" className="btn-small" onClick={onForget}>Forget</Button>
            </div>
          </div>
        ) : null}

        <div className="title-actions">
          <Button variant="primary" className="btn-lg" onClick={onSolo}>Play vs bots</Button>
          {offline ? null : (
            <>
              <Button variant="secondary" className="btn-lg" onClick={onCreate}>Create room</Button>
              <Button variant="secondary" className="btn-lg" onClick={onJoin}>Join with code</Button>
            </>
          )}
        </div>

        <button type="button" className="text-link" onClick={onRules}>Rules</button>

        <div className="title-name">
          {showName || !name ? (
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                maxLength={24}
                placeholder="Guild factor"
                onChange={(event) => onName(event.target.value)}
                onBlur={() => { if (name.trim()) setShowName(false); }}
                autoComplete="nickname"
              />
            </label>
          ) : (
            <button type="button" className="text-link" onClick={() => setShowName(true)}>
              Playing as <b>{name}</b> · change
            </button>
          )}
        </div>

        <ul className="pillars">
          <li><span className="pillar-title">20–35 min</span><span className="pillar-note">2–4 players</span></li>
          <li><span className="pillar-title">19 hexes</span><span className="pillar-note">one island, nine ports</span></li>
          <li><span className="pillar-title">Personal decks</span><span className="pillar-note">buy, cycle, score</span></li>
        </ul>
      </div>

      <footer className="footnote">
        <span className="version">v{clientVersion}</span>
        <span className={`socket socket-${offline || link === 'open' ? 'connected' : link === 'connecting' ? 'connecting' : 'disconnected'}`} title={offline ? 'This build runs entirely in your browser' : mismatch ? `Server runs v${serverVersion}` : 'WebSocket status'}>
          <span className="socket-dot" aria-hidden="true" />
          <span className="socket-label">
            {offline ? 'Offline build' : link === 'open' ? 'Server connected' : link === 'connecting' ? 'Connecting to server' : link === 'idle' ? 'Server idle' : 'Server offline'}
          </span>
          {!offline && mismatch ? <span className="socket-warn">v{serverVersion}</span> : null}
        </span>
        {!offline && latency !== null && link === 'open' ? <span className="latency">{latency} ms</span> : null}
      </footer>
    </main>
  );
}
