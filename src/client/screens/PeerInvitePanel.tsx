import { useState } from 'react';
import { Button } from '../ui/Button';
import { QrCode } from '../ui/QrCode';
import { shareLink } from '../ui/share';
import type { ShareResult } from '../ui/share';
import { usePeer } from '../net/peer/usePeer';

/**
 * Host's invite card, shown inside the lobby while a peer table is open.
 *
 * One four-letter code serves the whole table, one guest at a time. The QR is
 * the same join link, for a phone camera.
 */
export function PeerInvitePanel(): JSX.Element | null {
  const state = usePeer();
  const [share, setShare] = useState<ShareResult | null>(null);

  if (state.role !== 'host') return null;

  return (
    <section className="peer-invite-panel" aria-label="Invite a phone">
      <header className="peer-invite-head">
        <h2 className="panel-title small">Join code</h2>
      </header>

      {state.relayCode && state.relayLink ? (
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
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="peer-invite-body is-empty">
          <p className="peer-invite-note">Opening a room code…</p>
          <span className="spinner is-fast" aria-hidden="true" />
        </div>
      )}

      {state.error ? <p className="peer-invite-note server-warn">{state.error}</p> : null}
    </section>
  );
}
