import type { CardSettings } from '@shared/types';
import {
  CARD_COST_MODES,
  CARD_POOL_MODES,
  VARIED_CHARTER_SLOTS,
  VARIED_PILE_SLOTS,
  describeCards,
} from '@shared/card-settings';
import {
  BASE_CHARTER_CARDS,
  BASE_MARKET_CARDS,
  CHARTER_CARDS,
  MARKET_CARDS,
} from '@shared/cards';

/**
 * The host's card picker: which piles are for sale, and whether they sell at
 * their printed prices. Standard is the game as designed; the other modes add
 * cards, deal a random subset, or trade prices inside a cost tier.
 */
export function CardSettingsForm({
  value,
  onChange,
  disabled = false,
}: {
  value: CardSettings;
  onChange: (next: CardSettings) => void;
  disabled?: boolean;
}): JSX.Element {
  const update = (patch: Partial<CardSettings>): void => onChange({ ...value, ...patch });
  const piles = value.pool === 'standard'
    ? BASE_MARKET_CARDS.length
    : value.pool === 'expanded'
      ? MARKET_CARDS.length
      : VARIED_PILE_SLOTS;
  const charters = value.pool === 'standard'
    ? BASE_CHARTER_CARDS.length
    : value.pool === 'expanded'
      ? CHARTER_CARDS.length
      : VARIED_CHARTER_SLOTS;

  return (
    <div className="map-settings">
      <fieldset className="choice-row" disabled={disabled}>
        <legend>Card pool</legend>
        {CARD_POOL_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`choice${value.pool === mode.id ? ' is-on' : ''}`}
            aria-pressed={value.pool === mode.id}
            disabled={disabled}
            onClick={() => update({ pool: mode.id })}
            title={mode.note}
          >
            <b>{mode.label}</b>
            <span>{mode.id === 'standard' ? 'as printed' : mode.id === 'expanded' ? 'full file' : 'random draw'}</span>
          </button>
        ))}
      </fieldset>

      <fieldset className="choice-row" disabled={disabled}>
        <legend>Card prices</legend>
        {CARD_COST_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`choice${value.costs === mode.id ? ' is-on' : ''}`}
            aria-pressed={value.costs === mode.id}
            disabled={disabled}
            onClick={() => update({ costs: mode.id })}
            title={mode.note}
          >
            <b>{mode.label}</b>
            <span>{mode.id === 'printed' ? 'designed' : 'same total'}</span>
          </button>
        ))}
      </fieldset>

      <p className="map-note">
        {describeCards(value)} {piles} piles and {charters} charter stacks.
        {value.costs === 'shuffled' ? ' A pile costs the same total, but not always the same resource.' : ''}
      </p>
    </div>
  );
}
