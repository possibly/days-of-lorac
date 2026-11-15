/**
 * Discard selection after a seven.
 *
 * Every held resource is a unit with a value: units inside the next build's
 * cost are protected, surplus units decay fast as the pile grows, and a
 * resource the board does not produce is worth a little more. The bot throws
 * away the cheapest units until it owes exactly `required`. Complete build
 * sets therefore survive on their own, because the fourth unit of a set is the
 * one that was never cheap.
 */
import { RESOURCES } from '../../shared/types.js';
import type { PartialResources, Resource } from '../../shared/types.js';
import type { Sense } from './sense.js';
import { unitValue } from './sense.js';

interface Unit {
  resource: Resource;
  index: number;
  value: number;
}

export function chooseDiscard(sense: Sense, required: number): PartialResources {
  const held = sense.me.resources;
  let total = 0;
  for (const resource of RESOURCES) total += held[resource];
  const count = Math.max(0, Math.min(required, total));

  const units: Unit[] = [];
  for (const resource of RESOURCES) {
    for (let index = 0; index < held[resource]; index += 1) {
      units.push({
        resource,
        index,
        value: unitValue(sense.plan.cost, sense.production, resource, index),
      });
    }
  }
  units.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    if (a.resource !== b.resource) return a.resource < b.resource ? -1 : 1;
    return a.index - b.index;
  });

  const discard: PartialResources = {};
  for (let i = 0; i < count; i += 1) {
    const unit = units[i];
    if (!unit) break;
    discard[unit.resource] = (discard[unit.resource] ?? 0) + 1;
  }
  return discard;
}
