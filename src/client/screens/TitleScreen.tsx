import { useState } from 'react';
import { GuildSeal } from '../ui/icons';
import { Button } from '../ui/Button';

interface TitleScreenProps {
  name: string;
  onName: (name: string) => void;
  onSolo: () => void;
  /** True when a relay is configured, which is the only way to play with friends. */
  multiplayer: boolean;
  onPeerHost: () => void;
  onPeerJoin: () => void;
  onRules: () => void;
  clientVersion: string;
}

export function TitleScreen({
  name,
  onName,
  onSolo,
  multiplayer,
  onPeerHost,
  onPeerJoin,
  onRules,
  clientVersion,
}: TitleScreenProps): JSX.Element {
  const [showName, setShowName] = useState(false);

  return (
    <main className="title-screen">
      <div className="parchment title-panel">
        <GuildSeal size={96} />
        <h1 className="wordmark">Days of Lorac</h1>
        <p className="tagline">A board game of hexes, settlements and deck building.</p>

        <div className="title-actions">
          <Button variant="primary" className="btn-lg" onClick={onSolo}>Play vs bots</Button>
          {multiplayer ? (
            <>
              <Button variant="secondary" className="btn-lg" onClick={onPeerHost}>Host a table</Button>
              <Button variant="secondary" className="btn-lg" onClick={onPeerJoin}>Join a table</Button>
            </>
          ) : null}
        </div>

        {!multiplayer ? (
          <p className="title-note">
            Solo build. Set a relay URL to play with friends.
          </p>
        ) : null}

        <button type="button" className="text-link" onClick={onRules}>Rules</button>

        <div className="title-name">
          {showName || !name ? (
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                maxLength={24}
                placeholder="e.g. Maren"
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
        </ul>
      </div>

      <footer className="footnote">
        <span className="version">v{clientVersion}</span>
      </footer>
    </main>
  );
}
