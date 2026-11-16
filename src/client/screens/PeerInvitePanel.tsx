import { useState } from 'react';
import { Button } from '../ui/Button';
import { QrCode } from '../ui/QrCode';
import { QrScanModal } from '../ui/QrScan';
import { shareLink } from '../ui/share';
import type { ShareResult } from '../ui/share';
import { peer } from '../net/peer/session';
import { usePeer } from '../net/peer/usePeer';

/**
 * Host's invite card, shown inside the lobby while a peer table is open.
 *
 * With a relay the card is a four-letter code and a QR of the join link; one
 * code serves the whole table, one guest at a time. Without one it falls back to
 * the direct flow: an offer link or QR out, a reply code or QR back.
 */
export function PeerInvitePanel(): JSX.Element | null {
  const state = usePeer();
  const [reply, setReply] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [share, setShare] = useState<ShareResult | null>(null);

  if (state.role !== 'host') return null;

  const relay = state.mode === 'relay';
  const waiting = state.invites.filter((invite) => !invite.connected);
  const current = waiting[waiting.length - 1] ?? null;
  const connected = state.invites.filter((invite) => invite.connected).length;

  const create = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    await peer.newInvite();
    setBusy(false);
  };

  const submit = async (text: string): Promise<void> => {
    if (!text.trim()) return;
    setBusy(true);
    const result = await peer.acceptReply(text);
    setBusy(false);
    if (result.ok) {
      setReply('');
      setNote('Reply accepted. Seating them now…');
    } else {
      setNote(result.reason);
    }
  };

  return (
    <section className="peer-invite-panel" aria-label="Invite a phone">
      <header className="peer-invite-head">
        <h2 className="panel-title small">{relay ? 'Join code' : 'Invite a phone'}</h2>
        {connected > 0 ? <span className="badge badge-host">{connected} connected</span> : null}
      </header>

      {relay ? (
        state.relayCode && state.relayLink ? (
          <>
            <div className="relay-code" aria-label={`Join code ${state.relayCode}`}>
              {[...state.relayCode].map((letter, index) => (
                <span key={index} className="relay-letter">{letter}</span>
              ))}
            </div>
            <div className="peer-invite-body">
              <QrCode
                text={state.relayLink}
                size={Math.min(224, Math.max(160, window.innerWidth - 200))}
                label={`Join link for code ${state.relayCode}`}
              />
              <div className="peer-invite-side">
                <p className="peer-invite-note">
                  Type the code on any device, or scan the code. One guest at a time; the next guest
                  types the same code.
                </p>
                <input
                  className="invite-link"
                  readOnly
                  value={state.relayLink}
                  aria-label="Join link"
                  onFocus={(event) => event.target.select()}
                />
                <div className="peer-invite-actions">
                  <Button
                    variant="secondary"
                    className="btn-small"
                    onClick={async () => setShare(await shareLink(state.relayLink ?? '', 'Days of Lorac invite'))}
                  >
                    {share === 'shared' ? 'Sent' : share === 'copied' ? 'Link copied' : share === 'manual' ? 'Select the link' : 'Send the link'}
                  </Button>
                  <Button variant="ghost" className="btn-small" onClick={() => peer.useDirectInvites()}>
                    Use a direct link
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="peer-invite-body is-empty">
            <p className="peer-invite-note">Opening a room code…</p>
            <span className="spinner is-fast" aria-hidden="true" />
          </div>
        )
      ) : current ? (
        <>
          <div className="peer-invite-body">
            <QrCode
              text={current.link}
              size={Math.min(240, Math.max(168, window.innerWidth - 180))}
              label="Invite link for a phone"
            />
            <div className="peer-invite-side">
              <p className="peer-invite-note">
                Have them scan this, or send the link. Then paste their reply here.
              </p>
              <div className="peer-invite-actions">
                <Button
                  variant="secondary"
                  className="btn-small"
                  onClick={async () => setShare(await shareLink(current.link, 'Days of Lorac invite'))}
                >
                  {share === 'shared' ? 'Sent' : share === 'copied' ? 'Link copied' : share === 'manual' ? 'Select the link' : 'Send the link'}
                </Button>
                <Button variant="ghost" className="btn-small" onClick={() => peer.dropInvite(current.id)}>
                  Cancel invite
                </Button>
              </div>
              <input
                className="invite-link"
                readOnly
                value={current.link}
                aria-label="Invite link"
                onFocus={(event) => event.target.select()}
              />
              <label className="field">
                <span>Reply code</span>
                <textarea
                  rows={2}
                  value={reply}
                  spellCheck={false}
                  placeholder="Paste the code from their phone"
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
              <div className="peer-invite-actions">
                <Button variant="primary" className="btn-small" onClick={() => void submit(reply)} disabled={busy || !reply.trim()} reason={!reply.trim() ? 'Paste the reply first.' : null}>
                  Connect
                </Button>
                <Button variant="ghost" className="btn-small" onClick={() => setScanning(true)}>Scan instead</Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="peer-invite-body is-empty">
          <div>
            <p className="peer-invite-note">
              Nobody is waiting on an invite. Make one per phone, one at a time.
            </p>
            <Button variant="secondary" className="btn-small" onClick={() => void create()} disabled={busy}>
              {busy ? 'Making an invite…' : 'Invite a phone'}
            </Button>
          </div>
        </div>
      )}

      {note ? <p className="peer-invite-note" role="status">{note}</p> : null}
      {state.error ? <p className="peer-invite-note server-warn">{state.error}</p> : null}

      {scanning ? (
        <QrScanModal
          onClose={() => setScanning(false)}
          onDecode={(text) => {
            setScanning(false);
            void submit(text);
          }}
        />
      ) : null}
    </section>
  );
}
