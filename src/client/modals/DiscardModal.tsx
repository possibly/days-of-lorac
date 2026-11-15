import { useState } from 'react';
import type { PartialResources, Resource, ResourceMap } from '@shared/types';
import { RESOURCES } from '@shared/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ResourceIcon } from '../ui/icons';

const WORD: Record<Resource, string> = { wood: 'Wood', brick: 'Brick', sheep: 'Sheep', wheat: 'Wheat', ore: 'Ore' };

/** Mandatory discard: five stepper rows, confirm disabled until the exact count. */
export function DiscardModal({
  required,
  resources,
  onConfirm,
}: {
  required: number;
  resources: ResourceMap;
  onConfirm: (resources: PartialResources) => void;
}): JSX.Element {
  const [picked, setPicked] = useState<PartialResources>({});
  const total = Object.values(picked).reduce((sum, value) => sum + (value ?? 0), 0);
  const [shake, setShake] = useState(false);

  const step = (resource: Resource, delta: number): void => {
    setPicked((current) => {
      const next = { ...current };
      const value = Math.max(0, Math.min(resources[resource], (next[resource] ?? 0) + delta));
      if (value === 0) delete next[resource];
      else next[resource] = value;
      if (Object.values(next).reduce((sum, amount) => sum + (amount ?? 0), 0) > required) {
        setShake(true);
        window.setTimeout(() => setShake(false), 320);
      }
      return next;
    });
  };

  const first = RESOURCES.find((resource) => resources[resource] > 0) ?? 'wood';

  return (
    <Modal
      title={`Discard ${required}`}
      mandatory
      width={420}
      footer={
        <Button
          variant="primary"
          disabled={total !== required}
          reason={total !== required ? `Discard exactly ${required} resources.` : null}
          onClick={() => onConfirm(picked)}
        >
          Discard {required}
        </Button>
      }
    >
      <p className="modal-note">A seven was rolled and you hold more than nine resources. Choose exactly {required}.</p>
      <div className={`discard-counter${shake ? ' is-shaking' : ''}`} aria-live="polite">
        {total} of {required}
      </div>
      <div className="discard-rows">
        {RESOURCES.map((resource, index) => (
          <div key={resource} className={`discard-row${index === RESOURCES.indexOf(first) ? ' is-first' : ''}`}>
            <span className="discard-res">
              <ResourceIcon resource={resource} size={16} />
              {WORD[resource]}
            </span>
            <span className="discard-held">held {resources[resource]}</span>
            <span className="stepper">
              <button type="button" className="step-btn" disabled={(picked[resource] ?? 0) === 0} onClick={() => step(resource, -1)} aria-label={`One less ${WORD[resource]}`}>−</button>
              <span className="step-value">{picked[resource] ?? 0}</span>
              <button type="button" className="step-btn" disabled={(picked[resource] ?? 0) >= resources[resource]} onClick={() => step(resource, 1)} aria-label={`One more ${WORD[resource]}`}>+</button>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
