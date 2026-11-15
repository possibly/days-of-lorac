import { useEffect, useRef, useState } from 'react';
import { GAME_VERSION, versionLabel } from '@shared/version';

/**
 * Client shell for Days of Lorac.
 *
 * Owned by the shell agent. Later agents replace the `<TitleScreen />` body and
 * mount real views here. Keep the socket helper in this file for now; move it to
 * `src/client/net/` once the shared protocol module exists.
 *
 * TODO(client agent):
 *   - route on `?room=CODE` (shareable link) instead of always showing the title
 *   - replace the disabled New Game button with the lobby flow
 *   - consume the shared protocol types from `src/shared/protocol.ts`
 */

type LinkState = 'connecting' | 'connected' | 'disconnected';

interface Link {
  state: LinkState;
  serverVersion: string | null;
}

const WS_RECONNECT_MS = 2000;

function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws`;
}

/** Minimal socket lifecycle: connect, greet, reconnect on drop. */
function useServerLink(): Link {
  const [state, setState] = useState<LinkState>('connecting');
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const attempt = useRef(0);

  useEffect(() => {
    let current: WebSocket | null = null;
    let retry: number | undefined;
    let disposed = false;

    const connect = (): void => {
      if (disposed) return;
      setState(attempt.current === 0 ? 'connecting' : 'disconnected');
      const socket = new WebSocket(wsUrl());
      current = socket;
      // Ignore events from a socket this effect has already replaced
      // (React StrictMode mounts effects twice, and reconnects re-assign).
      const stale = (): boolean => disposed || current !== socket;

      socket.addEventListener('open', () => {
        if (stale()) return;
        attempt.current = 0;
        setState('connected');
        socket.send(JSON.stringify({ type: 'hello' }));
      });

      socket.addEventListener('message', (event: MessageEvent<string>) => {
        if (stale()) return;
        try {
          const message = JSON.parse(event.data) as { type?: string; version?: string };
          if (message.type === 'hello' && typeof message.version === 'string') {
            setServerVersion(message.version);
          }
        } catch {
          // Ignore non-JSON frames; the server never sends them today.
        }
      });

      socket.addEventListener('close', () => {
        if (stale()) return;
        setState('disconnected');
        attempt.current += 1;
        retry = window.setTimeout(connect, WS_RECONNECT_MS);
      });

      socket.addEventListener('error', () => {
        socket.close();
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      current?.close();
      current = null;
    };
  }, []);

  return { state, serverVersion };
}

function GuildSeal(): JSX.Element {
  return (
    <svg className="seal" viewBox="0 0 200 200" role="img" aria-label="Guild seal of Lorac">
      <defs>
        <linearGradient id="sealGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8cf98" />
          <stop offset="55%" stopColor="#c9a75f" />
          <stop offset="100%" stopColor="#a07f3d" />
        </linearGradient>
        <linearGradient id="sealSea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2c6a5a" />
          <stop offset="100%" stopColor="#123c33" />
        </linearGradient>
      </defs>

      <circle cx="100" cy="100" r="92" fill="url(#sealSea)" stroke="url(#sealGold)" strokeWidth="3" />
      <circle cx="100" cy="100" r="82" fill="none" stroke="#c9a75f" strokeWidth="1" opacity="0.55" />

      {/* Hex tile ring: the island of Lorac, drawn as six coast segments. */}
      <g fill="none" stroke="url(#sealGold)" strokeWidth="2" opacity="0.9">
        <polygon points="100,44 148,72 148,128 100,156 52,128 52,72" />
        <polygon points="100,62 133,81 133,119 100,138 67,119 67,81" opacity="0.5" />
      </g>

      {/* Trade routes leaving the island. */}
      <g stroke="#c9a75f" strokeWidth="1.5" strokeLinecap="round" opacity="0.7">
        <line x1="100" y1="44" x2="100" y2="26" />
        <line x1="148" y1="72" x2="164" y2="63" />
        <line x1="52" y1="72" x2="36" y2="63" />
      </g>

      {/* Waves. */}
      <g stroke="#8fc0a9" strokeWidth="2" fill="none" opacity="0.85" strokeLinecap="round">
        <path d="M74 104 q9 -8 18 0 t18 0" className="wave" />
        <path d="M78 116 q8 -7 16 0 t16 0" className="wave wave2" />
      </g>

      {/* The card: deck-building is the other half of the guild. */}
      <g transform="rotate(-8 100 82)">
        <rect x="88" y="70" width="24" height="30" rx="3" fill="#efe2c2" stroke="#7a5f2e" strokeWidth="1.2" />
        <line x1="93" y1="78" x2="107" y2="78" stroke="#7a5f2e" strokeWidth="1" opacity="0.7" />
        <line x1="93" y1="84" x2="107" y2="84" stroke="#7a5f2e" strokeWidth="1" opacity="0.5" />
        <line x1="93" y1="90" x2="101" y2="90" stroke="#7a5f2e" strokeWidth="1" opacity="0.35" />
      </g>
    </svg>
  );
}

function TitleScreen(): JSX.Element {
  return (
    <main className="title-screen">
      <div className="parchment">
        <GuildSeal />

        <p className="eyebrow">Guild charter · merchants of the inland sea</p>
        <h1 className="wordmark">Days of Lorac</h1>
        <p className="tagline">
          A board game of hexes, roads, and hard-won decks. Settle the island, buy your
          guild, and be the first to ten renown.
        </p>

        <div className="actions">
          <button className="btn btn-primary" type="button" disabled title="Wiring up in the next build">
            New Game
          </button>
          <p className="actions-note">
            Bots and online rooms are wired up in the next build. Nothing to do here yet.
          </p>
        </div>

        <ul className="pillars">
          <li>
            <span className="pillar-title">20-35 min</span>
            <span className="pillar-note">2-4 players</span>
          </li>
          <li>
            <span className="pillar-title">Catan island</span>
            <span className="pillar-note">19 hexes, 54 corners</span>
          </li>
          <li>
            <span className="pillar-title">Personal decks</span>
            <span className="pillar-note">buy, cycle, upgrade</span>
          </li>
        </ul>
      </div>

      <footer className="footnote">
        <span className="version">{versionLabel()}</span>
        <SocketStatus />
      </footer>
    </main>
  );
}

function SocketStatus(): JSX.Element {
  const { state, serverVersion } = useServerLink();
  const label =
    state === 'connected'
      ? 'Server connected'
      : state === 'connecting'
        ? 'Connecting to server'
        : 'Server offline';
  const mismatch = state === 'connected' && serverVersion !== null && serverVersion !== GAME_VERSION;

  return (
    <span className={`socket socket-${state}`} title={mismatch ? `Server runs v${serverVersion}` : wsUrlLabel()}>
      <span className="socket-dot" aria-hidden="true" />
      <span className="socket-label">{label}</span>
      {mismatch ? <span className="socket-warn">v{serverVersion}</span> : null}
    </span>
  );
}

function wsUrlLabel(): string {
  return wsUrl();
}

export default function App(): JSX.Element {
  return <TitleScreen />;
}
