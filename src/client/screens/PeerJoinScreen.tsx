import { useState } from 'react';
import { Button } from '../ui/Button';
import { QrCode } from '../ui/QrCode';
import { QrScanModal } from '../ui/QrScan';
import { shareText } from '../ui/share';
import type { ShareResult } from '../ui/share';
import { peer } from '../net/peer/session';
import type { PeerSnapshot } from '../net/peer/session';

/**
 * Guest side of a peer invite, in three acts.
 *
 * Entry: paste an invite link or scan the host's screen. Preview: who invited
 * you, then name yourself. Reply: a code the host scans or pastes. Once the
 * channel opens the app moves to the normal lobby, so nothing after this screen
 * is peer specific.
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
  const [link, setLink] = useState('');
  const [scanning, setScanning] = useState(false);
  const [share, setShare] = useState<ShareResult | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const ready = name.trim().length > 0;
  const answer = state.answer;

  const openInvite = async (input: string): Promise<void> => {
    if (!input.trim()) return;
    setEntryError(null);
    const ok = await peer.previewInvite(input);
    if (!ok) setEntryError('That is not an invite. Ask the host to show the link again.');
  };

  return (
    <main className="setup-screen">
      <div className="parchment setup-panel peer-panel">
        <p className="eyebrow">Direct invite</p>
        <h1 className="panel-title">
          {state.hostName && state.phase !== 'idle' ? `${state.hostName}'s table` : 'Join a table'}
        </h1>

        {state.phase === 'idle' ? (
          <>
            <p className="setup-note">
              Point your camera at the host's screen, or paste the invite link they sent you.
              The game connects phone to phone; there is no server in the middle.
            </p>
            <div className="peer-entry-actions">
              <Button variant="primary" onClick={() => setScanning(true)}>Scan the host's screen</Button>
            </div>
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
            {entryError ? <p className="server-note server-warn">{entryError}</p> : null}
            <div className="setup-actions">
              <Button variant="secondary" onClick={() => void openInvite(link)} disabled={!link.trim()} reason={!link.trim() ? 'Paste the invite first.' : null}>
                Open invite
              </Button>
              <Button variant="ghost" onClick={onBack}>Back</Button>
              <Button variant="ghost" onClick={onRules}>Rules</Button>
            </div>
          </>
        ) : null}

        {state.phase === 'guest-preview' ? (
          <>
            <p className="setup-note">
              {state.seats} seats, hosted in the host's browser. Nothing leaves the two devices.
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
            <p className="setup-note">Building your reply code…</p>
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
            void openInvite(text);
          }}
        />
      ) : null}
    </main>
  );
}
