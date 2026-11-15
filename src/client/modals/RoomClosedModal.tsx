import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

/** Room closed or version mismatch: blocking sheets with one way forward. */
export function RoomClosedModal({ reason, onTitle }: { reason: string; onTitle: () => void }): JSX.Element {
  return (
    <Modal
      title="This room has closed."
      width={420}
      footer={<Button variant="primary" onClick={onTitle}>Back to title</Button>}
    >
      <p className="modal-note">{reason || 'The host left or the table was cleaned up.'}</p>
      <p className="modal-small">Returning to the title in a moment.</p>
    </Modal>
  );
}

export function VersionMismatchModal({ serverVersion, clientVersion }: { serverVersion: string; clientVersion: string }): JSX.Element {
  return (
    <Modal title="Server and client versions differ." width={440} mandatory>
      <p className="modal-note">
        The server runs <b>v{serverVersion}</b> and this page is <b>v{clientVersion}</b>. Reload the page to pick up the matching client.
      </p>
      <Button variant="primary" onClick={() => window.location.reload()}>Reload the page</Button>
    </Modal>
  );
}
