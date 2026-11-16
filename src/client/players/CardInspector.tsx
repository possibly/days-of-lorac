import type { CardDef, CardInstance, PartialResources } from '@shared/types';
import { getCard } from '@shared/cards';
import { ResourceIcon } from '../ui/icons';
import { Button } from '../ui/Button';

/** Rail inspector: full card text and the single action the card allows. */
export function CardInspector({
  card,
  cost,
  playable,
  needsChoice,
  onPlay,
  onClose,
  letters,
}: {
  card: CardInstance;
  /** This game's price when it differs from the printed one. */
  cost?: PartialResources | null;
  playable: boolean;
  needsChoice: boolean;
  onPlay?: () => void;
  onClose: () => void;
  letters: boolean;
}): JSX.Element {
  const def = safeCard(card.defId);
  if (!def) return <div className="card-inspector">Unknown card</div>;
  const price = cost ?? def.cost;
  const costs = price
    ? Object.entries(price).filter(([, n]) => (n ?? 0) > 0)
    : [];
  return (
    <aside className="card-inspector" aria-label={`${def.name} inspector`}>
      <header className="ci-head">
        <span className="ci-eyebrow">{def.kind === 'charter' ? 'Charter deed' : def.kind === 'starting' ? 'Starting crew' : 'Market card'}</span>
        <button type="button" className="ci-close" onClick={onClose} aria-label="Close inspector">×</button>
      </header>
      <h3 className="ci-name">{def.name}</h3>
      <div className="ci-cost">
        {costs.length === 0 ? <span className="ci-blank">—</span> : costs.map(([resource, count]) => (
          <span key={resource} className="cost-pip">
            <span className="pip-n">{count}</span>
            <ResourceIcon resource={resource as never} size={10} letters={letters} />
          </span>
        ))}
        {def.vp ? <span className="vp-seal ci-vp">{def.vp}</span> : null}
      </div>
      <p className="ci-text">{def.text}</p>
      <p className="ci-flavor">{def.flavor ?? (def.kind === 'charter' ? 'Counts from the moment you buy it.' : '')}</p>
      <dl className="ci-meta">
        <div><dt>Tag</dt><dd>{def.tags[0] ?? 'none'}</dd></div>
        <div><dt>Renown</dt><dd>{def.renown ?? 0}</dd></div>
        <div><dt>Copies</dt><dd>{def.copies}</dd></div>
      </dl>
      <div className="ci-actions">
        {playable && onPlay ? (
          <Button variant="primary" onClick={onPlay}>
            {needsChoice ? 'Play and target' : 'Play card'}
          </Button>
        ) : (
          <p className="ci-dead">
            {def.kind === 'charter'
              ? 'Deed. Stays in your deck and scores from purchase. Nothing happens when played.'
              : 'Not playable right now. Cards are played in your action phase.'}
          </p>
        )}
      </div>
    </aside>
  );
}

function safeCard(defId: string): CardDef | null {
  try {
    return getCard(defId);
  } catch {
    return null;
  }
}
