import { useState } from 'react';
import type { BotDifficulty, MapSettings } from '@shared/types';
import { targetVpFor } from '@shared/constants';
import { DEFAULT_MAP_SETTINGS, maxSeatsFor } from '@shared/map-settings';
import { Button } from '../ui/Button';
import { MapSettingsForm } from '../ui/MapSettingsForm';

export function SoloSetupScreen({
  initialName,
  onStart,
  onBack,
  onRules,
}: {
  initialName: string;
  onStart: (name: string, seats: 2 | 3 | 4, difficulty: BotDifficulty, map: MapSettings) => void;
  onBack: () => void;
  onRules: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName);
  const [seats, setSeats] = useState<2 | 3 | 4>(4);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal');
  const [map, setMap] = useState<MapSettings>(DEFAULT_MAP_SETTINGS);
  const target = targetVpFor(seats, map.size);
  const maxSeats = maxSeatsFor(map.size);
  const ready = name.trim().length > 0;

  return (
    <main className="setup-screen">
      <form
        className="parchment setup-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onStart(name.trim(), seats, difficulty, map);
        }}
      >
        <p className="eyebrow">Solo table</p>
        <h1 className="panel-title">Play vs bots</h1>
        <p className="setup-note">Race to {target}. Bots take the free seats and answer trade offers.</p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={24} autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. Maren" />
        </label>

        <fieldset className="choice-row">
          <legend>Seats</legend>
          {([2, 3, 4] as const).map((count) => (
            <button
              key={count}
              type="button"
              className={`choice${seats === count ? ' is-on' : ''}`}
              onClick={() => setSeats(count)}
              aria-pressed={seats === count}
              disabled={count > maxSeats}
              title={count > maxSeats ? `The ${map.size} island seats ${maxSeats}.` : undefined}
            >
              <b>{count}</b>
              <span>{count === 2 ? 'duel' : count === 3 ? 'table' : 'full house'}</span>
            </button>
          ))}
        </fieldset>

        <fieldset className="choice-row">
          <legend>Bot difficulty</legend>
          {(['easy', 'normal', 'hard'] as const).map((level) => (
            <button key={level} type="button" className={`choice${difficulty === level ? ' is-on' : ''}`} onClick={() => setDifficulty(level)} aria-pressed={difficulty === level}>
              <b>{level[0]?.toUpperCase()}{level.slice(1)}</b>
              <span>{level === 'easy' ? 'loose play' : level === 'normal' ? 'steady' : 'sharp'}</span>
            </button>
          ))}
        </fieldset>

        <MapSettingsForm
          value={map}
          onChange={(next) => {
            setMap(next);
            if (seats > maxSeatsFor(next.size)) setSeats(2);
          }}
        />

        <p className="target-note">
          <b>Race to {target}.</b> {seats}-player target. Victory is checked after every action.
        </p>

        <div className="setup-actions">
          <Button variant="primary" type="submit" disabled={!ready} reason={!ready ? 'Pick a name first.' : null}>Start game</Button>
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button variant="ghost" onClick={onRules}>Rules</Button>
        </div>
      </form>
    </main>
  );
}
