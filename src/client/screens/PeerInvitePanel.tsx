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
 * One guest at a time: the offer on screen can only be answered by one reply, so
 * a second phone should scan the next invite. The host either pastes the reply
 * code or scans it with the camera.
 */
export function PeerInvitePanel(): JSX.Element | null {
  const state = usePeer();
  const [reply, setReply] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [share, setShare] = useState<ShareResult | null>(null);

  if (state.role !== 'host') return null;

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
        <h2 className="panel-title small">Invite a phone</h2>
        {connected > 0 ? <span className="badge badge-host">{connected} connected</span> : null}
      </header>

      {current ? (
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
              <input
                className="invite-link"
                readOnly
                value={current.link}
                aria-label="Invite link"
                onFocus={(event) => event.target.select()}
              />
              <div className="peer-invite-actions">
                <Button variant="primary" className="btn-small" onClick={() => void submit(reply)} disabled={busy || !reply.trim()} reason={!reply.trim() ? 'Paste the reply first.' : null}>
                  Connect
                </Button>
                <Button variant="ghost" className="btn-small" onClick={() => setScanning(true)}>Scan instead</Button>
              </div>
            </div>
          </div>
          {share === 'manual' ? (
            <input className="invite-link" readOnly value={current.link} onFocus={(event) => event.target.select()} />
          ) : null}
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
