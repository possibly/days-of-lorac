import type { MapSettings } from '@shared/types';
import {
  MAP_SIZES,
  TERRAIN_MODES,
  TOKEN_MODES,
  describeMap,
} from '@shared/map-settings';

/**
 * The host's island picker: size, land placement, number placement. Each row is
 * a plain three-way choice, and the summary line underneath spells out what the
 * combination means so nobody has to decode "balanced".
 */
export function MapSettingsForm({
  value,
  onChange,
  disabled = false,
  maxSeats,
}: {
  value: MapSettings;
  onChange: (next: MapSettings) => void;
  disabled?: boolean;
  /** Seats the table needs. Islands smaller than this are greyed out. */
  maxSeats?: number;
}): JSX.Element {
  const update = (patch: Partial<MapSettings>): void => onChange({ ...value, ...patch });

  return (
    <div className="map-settings">
      <fieldset className="choice-row" disabled={disabled}>
        <legend>Island size</legend>
        {MAP_SIZES.map((size) => (
          <button
            key={size.id}
            type="button"
            className={`choice${value.size === size.id ? ' is-on' : ''}`}
            aria-pressed={value.size === size.id}
            disabled={disabled || (maxSeats !== undefined && size.maxSeats < maxSeats)}
            onClick={() => update({ size: size.id })}
            title={
              maxSeats !== undefined && size.maxSeats < maxSeats
                ? `The ${size.label.toLowerCase()} island seats ${size.maxSeats}.`
                : size.note
            }
          >
            <b>{size.label}</b>
            <span>{size.hexes} hexes</span>
          </button>
        ))}
      </fieldset>

      <fieldset className="choice-row" disabled={disabled}>
        <legend>Land placement</legend>
        {TERRAIN_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`choice${value.terrain === mode.id ? ' is-on' : ''}`}
            aria-pressed={value.terrain === mode.id}
            disabled={disabled}
            onClick={() => update({ terrain: mode.id })}
            title={mode.note}
          >
            <b>{mode.label}</b>
            <span>{mode.id === 'fixed' ? 'designed' : mode.id === 'balanced' ? 'spread' : 'random'}</span>
          </button>
        ))}
      </fieldset>

      <fieldset className="choice-row" disabled={disabled}>
        <legend>Number placement</legend>
        {TOKEN_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`choice${value.tokens === mode.id ? ' is-on' : ''}`}
            aria-pressed={value.tokens === mode.id}
            disabled={disabled}
            onClick={() => update({ tokens: mode.id })}
            title={mode.note}
          >
            <b>{mode.label}</b>
            <span>{mode.id === 'fixed' ? 'designed' : mode.id === 'balanced' ? 'spread' : 'random'}</span>
          </button>
        ))}
      </fieldset>

      <p className="map-note">{describeMap(value)}</p>
    </div>
  );
}
