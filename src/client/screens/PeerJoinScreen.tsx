import { useState } from 'react';
import { isRelayCode } from '@shared/relay';
import { Button } from '../ui/Button';
import { QrCode } from '../ui/QrCode';
import { QrScanModal } from '../ui/QrScan';
import { shareText } from '../ui/share';
import type { ShareResult } from '../ui/share';
import { peer } from '../net/peer/session';
import { readRelayCode } from '../net/peer/relay';
import type { PeerSnapshot } from '../net/peer/session';

/**
 * Guest side of a peer invite, in three acts.
 *
 * Entry: type the four-letter code, scan the host's screen, or paste a direct
 * invite. Preview: name yourself. Reply: with a relay there is nothing to hand
 * back, so the screen waits; with a direct invite it shows a reply code for the
 * host to scan or paste.
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
  const [link, setLink] = useState('');
  const [scanning, setScanning] = useState(false);
  const [share, setShare] = useState<ShareResult | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const ready = name.trim().length > 0;
  const answer = state.answer;
  const relay = state.mode === 'relay';

  const submitCode = (): void => {
    const cleaned = code.trim().toUpperCase();
    if (!isRelayCode(cleaned)) {
      setEntryError('Codes are four letters.');
      return;
    }
    setEntryError(null);
    peer.previewCode(cleaned);
  };

  const openInvite = async (input: string): Promise<void> => {
    if (!input.trim()) return;
    setEntryError(null);
    const ok = await peer.previewInvite(input);
    if (!ok) setEntryError('That is not an invite. Ask the host to show the link again.');
  };

  /** A scanned QR is either a join link with a code, a direct invite, or a code. */
  const acceptScan = async (text: string): Promise<void> => {
    const scannedCode = readRelayCode(text) ?? text.trim().toUpperCase();
    if (isRelayCode(scannedCode)) {
      setCode(scannedCode);
      peer.previewCode(scannedCode);
      return;
    }
    await openInvite(text);
  };

  return (
    <main className="setup-screen">
      <div className="parchment setup-panel peer-panel">
        <p className="eyebrow">Direct invite</p>
        <h1 className="panel-title">
          {state.phase === 'idle'
            ? 'Join a table'
            : relay
              ? `Table ${state.relayCode ?? ''}`
              : `${state.hostName ?? 'Host'}'s table`}
        </h1>

        {state.phase === 'idle' ? (
          <>
            <p className="setup-note">
              The table runs in the host's browser. {state.relayAvailable
                ? 'Signaling goes through a small relay; game data goes straight between the two devices.'
                : 'Ask the host for their invite link or QR code.'}
            </p>

            {state.relayAvailable ? (
              <>
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
              </>
            ) : null}

            <details className="peer-manual-entry">
              <summary>{state.relayAvailable ? 'Have a direct invite link instead?' : 'Open a direct invite'}</summary>
              <label className="field">
                <span>Invite link or code</span>
                <textarea
                  rows={3}
                  value={link}
                  spellCheck={false}
                  placeholder="https://…/#join=…"
                  onChange={(event) => setLink(event.target.value)}
                />
              </label>
              <div className="setup-actions">
                <Button variant="secondary" className="btn-small" onClick={() => void openInvite(link)} disabled={!link.trim()} reason={!link.trim() ? 'Paste the invite first.' : null}>
                  Open invite
                </Button>
              </div>
            </details>

            {entryError ? <p className="server-note server-warn">{entryError}</p> : null}
            <div className="setup-actions">
              <Button variant="ghost" onClick={onRules}>Rules</Button>
            </div>
          </>
        ) : null}

        {state.phase === 'guest-preview' ? (
          <>
            <p className="setup-note">
              {relay
                ? 'The host will seat you as soon as your device connects. Nothing is uploaded; the game is peer to peer.'
                : `${state.seats} seats, hosted in the host's browser. Nothing leaves the two devices.`}
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
            <p className="setup-note">
              {relay ? "Knocking on the host's table…" : 'Building your reply code…'}
            </p>
          </div>
        ) : null}

        {state.phase === 'guest-waiting' && answer ? (
          <div className="peer-reply">
            <p className="setup-note">
              Show this to the host. They scan it, or paste the code into their lobby.
            </p>
            <QrCode text={answer.code} size={Math.min(260, Math.max(180, window.innerWidth - 140))} label="Reply code for the host" />
            <label className="field">
              <span>Reply code</span>
              <textarea readOnly rows={3} value={answer.code} onFocus={(event) => event.target.select()} />
            </label>
            <div className="setup-actions">
              <Button
                variant="secondary"
                className="btn-small"
                onClick={async () => setShare(await shareText(answer.code, 'Days of Lorac reply'))}
              >
                {share === 'shared' ? 'Sent' : share === 'copied' ? 'Copied' : share === 'manual' ? 'Copy by hand' : 'Send the code'}
              </Button>
              <Button variant="ghost" className="btn-small" onClick={onBack}>Start over</Button>
            </div>
            <div className="peer-waiting">
              <span className="spinner is-fast" aria-hidden="true" />
              <span>Waiting for the host to connect…</span>
            </div>
          </div>
        ) : null}

        {state.phase === 'error' ? (
          <>
            <p className="server-note server-warn">{state.error ?? 'That invite did not work.'}</p>
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
            void acceptScan(text);
          }}
        />
      ) : null}
    </main>
  );
}
