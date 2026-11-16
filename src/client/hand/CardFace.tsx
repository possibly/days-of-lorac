import type { CardDef, CardInstance, Resource } from '@shared/types';
import { RESOURCES } from '@shared/types';
import { getCard } from '@shared/cards';
import { ResourceIcon } from '../ui/icons';
import { summarizeCard } from './cardSummary';

export function primaryResource(def: CardDef): Resource {
  for (const effect of def.effects) {
    if (effect.kind === 'gain') {
      const keys = Object.keys(effect.resources) as Resource[];
      if (keys.length > 0) return keys[0] as Resource;
    }
    if (effect.kind === 'chooseResources') return 'wood';
  }
  if (def.cost) {
    let best: Resource | null = null;
    let bestCount = -1;
    for (const resource of RESOURCES) {
      const count = def.cost[resource] ?? 0;
      if (count > bestCount) {
        best = resource;
        bestCount = count;
      }
    }
    if (best) return best;
  }
  return 'wood';
}

export function cardDef(card: CardInstance): CardDef | null {
  try {
    return getCard(card.defId);
  } catch {
    return null;
  }
}

interface CardFaceProps {
  card: CardInstance;
  def: CardDef;
  playable: boolean;
  selected: boolean;
  letters: boolean;
  /** Offsets from this card's final slot back to the deck counter. */
  deal?: { dx: number; dy: number; delay: number } | null;
  onPlay: () => void;
  onInspect: () => void;
}

/**
 * One hand card: the name, the resources it yields, and a short label for the
 * one action it asks for. Prices live on the market and the full rules text in
 * the inspector, so neither crowds the card.
 */
export function CardFace({ card, def, playable, selected, letters, deal, onPlay, onInspect }: CardFaceProps): JSX.Element {
  const primary = primaryResource(def);
  const summary = summarizeCard(def);
  const label = playable
    ? `Play ${def.name}, ${def.text.replace(/\.$/, '')}`
    : `${def.name}. ${def.kind === 'charter' ? 'Charter deed, scores from purchase.' : 'Not playable right now.'} Open inspector.`;

  return (
    <div
      className={`card-slot${selected ? ' is-selected' : ''}${deal ? ' is-dealing' : ''}`}
      style={{
        '--rot': '0deg',
        ...(deal ? {
          '--deal-dx': `${deal.dx}px`,
          '--deal-dy': `${deal.dy}px`,
          '--deal-delay': `${deal.delay}ms`,
        } : {}),
      } as React.CSSProperties}
    >
      <button
        type="button"
        className={`card-face${playable ? ' is-playable' : ' is-dead'}${selected ? ' is-selected' : ''}`}
        onClick={() => {
          if (playable) onPlay();
          else onInspect();
        }}
        onPointerEnter={onInspect}
        onFocus={onInspect}
        aria-label={label}
        aria-pressed={selected}
      >
        <header className="card-head">
          <span className="card-name" title={def.name}>{def.name}</span>
        </header>

        <div className="card-summary">
          {summary.gains.length > 0 ? (
            <div className="card-gains">
              {summary.gains.map((gain) => (
                <span key={gain.resource} className="card-gain" title={`+${gain.count} ${gain.resource}`}>
                  <span className="card-gain-n">+{gain.count}</span>
                  <ResourceIcon resource={gain.resource} size={15} letters={letters} />
                </span>
              ))}
            </div>
          ) : null}
          {def.vp ? <span className="card-vp">{def.vp} VP</span> : null}
          {summary.effects.length > 0 ? (
            <div className="card-effects">
              {summary.effects.map((effect) => (
                <span key={effect} className="card-effect">{effect}</span>
              ))}
            </div>
          ) : null}
        </div>

        {letters ? <span className="sr-only">Resource {primary}</span> : null}
      </button>
    </div>
  );
}
