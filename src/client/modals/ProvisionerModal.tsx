import { useState } from 'react';
import type { Resource } from '@shared/types';
import { RESOURCES } from '@shared/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ResourceIcon } from '../ui/icons';

const WORD: Record<Resource, string> = { wood: 'Wood', brick: 'Brick', sheep: 'Sheep', wheat: 'Wheat', ore: 'Ore' };

/**
 * Provisioner: pick two resources, repeats allowed. Nothing is sent until the
 * player confirms, so Esc, the backdrop, the close button, and Cancel all back
 * out with the card still in hand. The engine's two-wood fallback is only for
 * a play that arrives without a choice, never for a player walking away.
 */
export function ProvisionerModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (resources: [Resource, Resource]) => void;
  onCancel: () => void;
}): JSX.Element {
  const [picks, setPicks] = useState<Resource[]>([]);

  return (
    <Modal
      title="Provisioner"
      width={360}
      onClose={onCancel}
      footer={
        <>
          <Button
            variant="primary"
            disabled={picks.length !== 2}
            reason={picks.length !== 2 ? 'Pick two resources.' : null}
            onClick={() => {
              if (picks[0] && picks[1]) onConfirm([picks[0], picks[1]]);
            }}
          >
            Gain 2 resources
          </Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <p className="modal-note">Choose 2 resources. Repeats are allowed.</p>
      <div className="provisioner-counter" aria-live="polite">{picks.length} of 2</div>
      <div className="provisioner-rows">
        {RESOURCES.map((resource) => {
          const count = picks.filter((pick) => pick === resource).length;
          return (
            <div key={resource} className="provisioner-row">
              <span className="discard-res"><ResourceIcon resource={resource} size={16} />{WORD[resource]}</span>
              <span className="stepper">
                <button type="button" className="step-btn" disabled={count === 0} onClick={() => setPicks((current) => removeOne(current, resource))} aria-label={`One less ${WORD[resource]}`}>−</button>
                <span className="step-value">{count}</span>
                <button type="button" className="step-btn" disabled={picks.length >= 2} onClick={() => setPicks((current) => (current.length < 2 ? [...current, resource] : current))} aria-label={`One more ${WORD[resource]}`}>+</button>
              </span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function removeOne(picks: Resource[], resource: Resource): Resource[] {
  const index = picks.lastIndexOf(resource);
  if (index < 0) return picks;
  return [...picks.slice(0, index), ...picks.slice(index + 1)];
}
