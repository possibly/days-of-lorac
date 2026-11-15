import { useState } from 'react';
import type { BotDifficulty, MapSettings } from '@shared/types';
import { DEFAULT_MAP_SETTINGS, maxSeatsFor } from '@shared/map-settings';
import { Button } from '../ui/Button';
import { MapSettingsForm } from '../ui/MapSettingsForm';

export function CreateRoomScreen({
  initialName,
  onStart,
  onBack,
  onRules,
}: {
  initialName: string;
  onStart: (name: string, maxPlayers: 2 | 3 | 4, difficulty: BotDifficulty, map: MapSettings) => void;
  onBack: () => void;
  onRules: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName);
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4>(4);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal');
  const [map, setMap] = useState<MapSettings>(DEFAULT_MAP_SETTINGS);
  const maxSeats = maxSeatsFor(map.size);
  const ready = name.trim().length > 0;

  return (
    <main className="setup-screen">
      <form
        className="parchment setup-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onStart(name.trim(), maxPlayers, difficulty, map);
        }}
      >
        <p className="eyebrow">Online table</p>
        <h1 className="panel-title">Create room</h1>
        <p className="setup-note">You get a four-letter code and the invite link. Empty seats fill with bots when you start.</p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={24} autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. Maren" />
        </label>

        <fieldset className="choice-row">
          <legend>Max players</legend>
          {([2, 3, 4] as const).map((count) => (
            <button
              key={count}
              type="button"
              className={`choice${maxPlayers === count ? ' is-on' : ''}`}
              onClick={() => setMaxPlayers(count)}
              aria-pressed={maxPlayers === count}
              disabled={count > maxSeats}
              title={count > maxSeats ? `The ${map.size} island seats ${maxSeats}.` : undefined}
            >
              <b>{count}</b><span>seats</span>
            </button>
          ))}
        </fieldset>

        <fieldset className="choice-row">
          <legend>Fill difficulty</legend>
          {(['easy', 'normal', 'hard'] as const).map((level) => (
            <button key={level} type="button" className={`choice${difficulty === level ? ' is-on' : ''}`} onClick={() => setDifficulty(level)} aria-pressed={difficulty === level}>
              <b>{level[0]?.toUpperCase()}{level.slice(1)}</b><span>bots</span>
            </button>
          ))}
        </fieldset>

        <MapSettingsForm
          value={map}
          onChange={(next) => {
            setMap(next);
            if (maxPlayers > maxSeatsFor(next.size)) setMaxPlayers(2);
          }}
        />

        <div className="setup-actions">
          <Button variant="primary" type="submit" disabled={!ready} reason={!ready ? 'Pick a name first.' : null}>Create room</Button>
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button variant="ghost" onClick={onRules}>Rules</Button>
        </div>
      </form>
    </main>
  );
}
