import type { GameView, Resource } from '@shared/types';
import { RESOURCES } from '@shared/types';
import { RESOURCE_LIMIT, RESOURCE_NAMES } from '@shared/constants';
import { ResourceIcon } from './icons';

interface MyResourcesProps {
  view: GameView;
  letters: boolean;
}

/**
 * The viewer's own resource counts, pinned above the market and trade panels.
 *
 * On a phone the rail becomes a full-screen drawer, which covers the player
 * panel, so the market needs its own copy of the numbers a purchase depends on.
 * It is sticky: scrolling to the expensive piles keeps the counts in view.
 */
export function MyResources({ view, letters }: MyResourcesProps): JSX.Element | null {
  const you = view.players[view.you];
  if (!you) return null;

  const total = RESOURCES.reduce((sum, resource) => sum + you.resources[resource], 0);
  const over = total > RESOURCE_LIMIT;
  const label = RESOURCES.map((resource) => `${you.resources[resource]} ${RESOURCE_NAMES[resource]}`).join(', ');
  const discard = Math.floor(total / 2);

  return (
    <div
      className={`my-res${over ? ' is-over' : ''}`}
      role="group"
      aria-label={`Your resources: ${label}. ${total} held.`}
    >
      <span className="my-res-label">Your hold</span>
      <span className="my-res-cells">
        {RESOURCES.map((resource: Resource) => {
          const count = you.resources[resource];
          return (
            <span
              key={resource}
              className={`my-res-cell${count === 0 ? ' is-zero' : ''}`}
              title={`${RESOURCE_NAMES[resource]}: ${count}`}
            >
              <ResourceIcon resource={resource} size={18} letters={letters} />
              <span className="my-res-count">{count}</span>
            </span>
          );
        })}
      </span>
      <span
        className="my-res-total"
        title={
          over
            ? `Holding ${total}. A seven makes you discard ${discard}.`
            : `Holding ${total}. A seven is safe up to ${RESOURCE_LIMIT}.`
        }
      >
        {total}
        <span className="my-res-limit">/{RESOURCE_LIMIT}</span>
      </span>
    </div>
  );
}
