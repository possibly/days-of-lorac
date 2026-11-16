import type { CardDef, CardInstance, PartialResources, Resource } from '@shared/types';
import { RESOURCES } from '@shared/types';
import { getCard } from '@shared/cards';
import { ResourceIcon } from '../ui/icons';

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
  /** This game's price when it differs from the printed one. */
  cost?: PartialResources | null;
  playable: boolean;
  needsChoice: boolean;
  selected: boolean;
  letters: boolean;
  /** Offsets from this card's final slot back to the deck counter. */
  deal?: { dx: number; dy: number; delay: number } | null;
  onPlay: () => void;
  onInspect: () => void;
}

/** One ledger card. Name one line, rules text verbatim, flavor in the footer. */
export function CardFace({ card, def, cost, playable, needsChoice, selected, letters, deal, onPlay, onInspect }: CardFaceProps): JSX.Element {
  const primary = primaryResource(def);
  const price = cost ?? def.cost;
  const costs = price
    ? RESOURCES.filter((resource) => (price?.[resource] ?? 0) > 0).map((resource) => ({ resource, count: price?.[resource] ?? 0 }))
    : [];
  const oneEach = def.kind === 'charter' && costs.length >= 4 && costs.every((cost) => cost.count === 1);
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
          <span className="card-head-side">
            {needsChoice ? <span className="choice-badge" title="Pick a target after you play this">?</span> : null}
            <span className="card-cost" aria-label={costs.length > 0 ? costs.map((c) => `${c.count} ${c.resource}`).join(', ') : 'no cost'}>
              {costs.length === 0 ? <span className="cost-rule" aria-hidden="true" /> : oneEach ? (
                <span className="cost-each" title={costs.map((cost) => `1 ${cost.resource}`).join(', ')}>1 each</span>
              ) : costs.map(({ resource, count }) => (
                <span key={resource} className={`cost-pip cost-${resource}`} title={`${count} ${resource}`}>
                  <span className="pip-n">{count}</span>
                  <ResourceIcon resource={resource} size={10} />
                </span>
              ))}
            </span>
          </span>
        </header>

        <div className="card-plate" style={{ color: `var(--${primary})` }}>
          <svg viewBox="-12 -12 24 24" width="46" height="46" aria-hidden="true">
            <polygon points="0,-11 9.5,-5.5 9.5,5.5 0,11 -9.5,5.5 -9.5,-5.5" style={{ fill: 'color-mix(in srgb, currentColor 22%, transparent)' }} stroke="#a07f3d" strokeWidth="1.4" />
            <g transform="scale(0.62)" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <ResourceGlyph resource={primary} />
            </g>
          </svg>
          {def.vp ? <span className="vp-seal card-seal">{def.vp}</span> : null}
        </div>

        <p className="card-text">{def.text}</p>
        <div className="rope-rule" aria-hidden="true" />
        <p className="card-flavor">{def.flavor ?? (def.kind === 'charter' ? 'Counts from the moment you buy it.' : '')}</p>

        <footer className="card-foot">
          <span className="card-tag">{def.tags[0] ?? 'card'}</span>
        </footer>

        {!playable && def.kind === 'charter' ? <span className="charter-stamp" aria-hidden="true">deed</span> : null}
        {letters ? <span className="sr-only">Resource {primary}</span> : null}
      </button>
    </div>
  );
}

function ResourceGlyph({ resource }: { resource: Resource }): JSX.Element {
  if (resource === 'wood') {
    return <><path d="M4 15.5 9 6.5h9.5L14 15.5H4Z" /><path d="M6.5 15.5 11 7.6" /><circle cx="17" cy="9.4" r="2.2" /></>;
  }
  if (resource === 'brick') {
    return <><rect x="3.5" y="9" width="17" height="9.5" rx="1.2" /><path d="M12.5 9v4.4M8 13.4v5.1M16 13.4v5.1" /></>;
  }
  if (resource === 'sheep') {
    return <><path d="M5 12.2c0-2.7 2-4.7 4.6-4.7h5.2c2.7 0 4.6 2 4.6 4.7v1.6H5v-1.6Z" /><path d="M9.6 15.2c0 1.6 1.1 2.6 2.5 2.6s2.5-1 2.5-2.6" /><path d="M8.2 18v1.8M16 18v1.8" /></>;
  }
  if (resource === 'wheat') {
    return <><path d="M12 4v15M7.5 8.5c0 3 1.5 4.6 4.5 6M16.5 8.5c0 3-1.5 4.6-4.5 6" /><path d="M7.2 17.2h9.6" /></>;
  }
  return <><path d="M6 9.2 10 4.8h6.2L20 10.6 16.4 19H7.6L4 10.6 6 9.2Z" /><path d="M4 10.6h16M9.6 4.8 7.6 19M14.4 4.8l2.4 14.2" /></>;
}
