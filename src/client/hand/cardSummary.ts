import type { CardDef, Resource } from '@shared/types';
import { RESOURCES } from '@shared/types';

export interface CardGain {
  resource: Resource;
  count: number;
}

export interface CardSummary {
  gains: CardGain[];
  effects: string[];
}

/**
 * The two lines a hand card carries: what it yields, and the one short action
 * it asks for. Full rules text stays in the inspector.
 */
export function summarizeCard(def: CardDef): CardSummary {
  const gains: CardGain[] = [];
  const effects: string[] = [];

  for (const effect of def.effects) {
    switch (effect.kind) {
      case 'gain':
        for (const resource of RESOURCES) {
          const count = effect.resources[resource] ?? 0;
          if (count > 0) gains.push({ resource, count });
        }
        break;
      case 'renown':
        effects.push(`+${effect.amount} renown`);
        break;
      case 'draw':
        effects.push(`Draw ${effect.count}`);
        break;
      case 'chooseResources':
        effects.push(`Gain ${effect.count} resources`);
        break;
      case 'freeRoad':
        effects.push('Free road');
        break;
      case 'freeSettlement':
        effects.push('Free settlement');
        break;
      case 'optionalRobber':
        effects.push('Move robber');
        break;
      default:
        break;
    }
  }

  return { gains, effects };
}
