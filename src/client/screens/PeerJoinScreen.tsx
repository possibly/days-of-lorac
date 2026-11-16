import { useState } from 'react';
import { isRelayCode } from '@shared/relay';
import { Button } from '../ui/Button';
import { QrScanModal } from '../ui/QrScan';
import { peer } from '../net/peer/session';
import { readRelayCode } from '../net/peer/relay';
import type { PeerSnapshot } from '../net/peer/session';

/**
 * Guest side of a peer table.
 *
 * Entry: type the four-letter code or scan the host's screen. Preview: name
 * yourself. Then wait for the host to seat you.
 */
export function PeerJoinScreen({
  state,
  initialName,
  onJoin,
  onBack,
  onRules,
}: {
  state: PeerSnapshot;
  initialName: string;
  onJoin: (name: string) => void;
  onBack: () => void;
  onRules: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(state.relayCode ?? '');
  const [scanning, setScanning] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const ready = name.trim().length > 0;

  const submitCode = (): void => {
    const cleaned = code.trim().toUpperCase();
    if (!isRelayCode(cleaned)) {
      setEntryError('Codes are four letters.');
      return;
    }
    setEntryError(null);
    peer.previewCode(cleaned);
  };

  /** A scanned QR is a join link with a code, or just the code. */
  const acceptScan = (text: string): void => {
    const scannedCode = readRelayCode(text) ?? text.trim().toUpperCase();
    if (!isRelayCode(scannedCode)) {
      setEntryError('That screen did not have a table code.');
      return;
    }
    setEntryError(null);
    setCode(scannedCode);
    peer.previewCode(scannedCode);
  };

  return (
    <main className="setup-screen">
      <div className="parchment setup-panel peer-panel">
        <p className="eyebrow">Peer table</p>
        <h1 className="panel-title">
          {state.phase === 'idle' ? 'Join a table' : `Table ${state.relayCode ?? ''}`}
        </h1>

        {state.phase === 'idle' ? (
          <>
            <p className="setup-note">
              The table runs in the host's browser. Signaling goes through a small relay;
              game data goes straight between the two devices.
            </p>

            <label className="field">
              <span>Four-letter code</span>
              <input
                className="relay-input"
                value={code}
                maxLength={4}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="ABCD"
                onChange={(event) => setCode(event.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
                onKeyDown={(event) => { if (event.key === 'Enter') submitCode(); }}
              />
            </label>
            <div className="setup-actions">
              <Button variant="primary" onClick={submitCode} disabled={!isRelayCode(code)} reason={!isRelayCode(code) ? 'Four letters, from the host.' : null}>
                Join with code
              </Button>
              <Button variant="ghost" onClick={() => setScanning(true)}>Scan the screen</Button>
              <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>

            {entryError ? <p className="server-note server-warn">{entryError}</p> : null}
            <div className="setup-actions">
              <Button variant="ghost" onClick={onRules}>Rules</Button>
            </div>
          </>
        ) : null}

        {state.phase === 'guest-preview' ? (
          <>
            <p className="setup-note">
              The host will seat you as soon as your device connects. Nothing is uploaded;
              the game is peer to peer.
            </p>
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                maxLength={24}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Maren"
                onKeyDown={(event) => { if (event.key === 'Enter' && ready) onJoin(name.trim()); }}
              />
            </label>
            <div className="setup-actions">
              <Button variant="primary" onClick={() => onJoin(name.trim())} disabled={!ready} reason={!ready ? 'Pick a name first.' : null}>
                Join the table
              </Button>
              <Button variant="ghost" onClick={onBack}>Back</Button>
              <Button variant="ghost" onClick={onRules}>Rules</Button>
            </div>
          </>
        ) : null}

        {state.phase === 'guest-answering' ? (
          <div className="peer-waiting">
            <span className="spinner is-fast" aria-hidden="true" />
            <p className="setup-note">Knocking on the host's table…</p>
          </div>
        ) : null}

        {state.phase === 'error' ? (
          <>
            <p className="server-note server-warn">{state.error ?? 'That table did not answer.'}</p>
            <div className="setup-actions">
              <Button variant="primary" onClick={onBack}>Start over</Button>
            </div>
          </>
        ) : null}
      </div>

      {scanning ? (
        <QrScanModal
          onClose={() => setScanning(false)}
          onDecode={(text) => {
            setScanning(false);
            acceptScan(text);
          }}
        />
      ) : null}
    </main>
  );
}
