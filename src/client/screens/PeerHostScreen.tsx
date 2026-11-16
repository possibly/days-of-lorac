import { useState } from 'react';
import type { BotDifficulty, MapSettings } from '@shared/types';
import { DEFAULT_MAP_SETTINGS, maxSeatsFor } from '@shared/map-settings';
import { Button } from '../ui/Button';
import { MapSettingsForm } from '../ui/MapSettingsForm';
import type { HostRoomConfig } from '../net/peer/session';

/**
 * Host setup for a table that lives in this tab.
 *
 * Same choices as the bot setup, with one extra note: the phone or laptop that
 * opens the table has to stay awake and in this tab for the whole game.
 */
export function PeerHostScreen({
  initialName,
  onStart,
  onBack,
  onRules,
}: {
  initialName: string;
  onStart: (config: HostRoomConfig) => void;
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
          if (ready) onStart({ name: name.trim(), maxPlayers, difficulty, map });
        }}
      >
        <p className="eyebrow">Peer table</p>
        <h1 className="panel-title">Host a table</h1>
        <p className="setup-note">
          The table runs in this tab and phones join over the relay. No accounts.
          Keep this tab open and awake for the whole game: a refresh ends the table.
        </p>

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
              className={`choice${maxPlayers === count ? ' is-on' : ''}`}
              onClick={() => setMaxPlayers(count)}
              aria-pressed={maxPlayers === count}
              disabled={count > maxSeats}
              title={count > maxSeats ? `The ${map.size} island seats ${maxSeats}.` : undefined}
            >
              <b>{count}</b>
              <span>{count === 2 ? 'duel' : count === 3 ? 'table' : 'full house'}</span>
            </button>
          ))}
        </fieldset>

        <fieldset className="choice-row">
          <legend>Empty seats</legend>
          {(['easy', 'normal', 'hard'] as const).map((level) => (
            <button
              key={level}
              type="button"
              className={`choice${difficulty === level ? ' is-on' : ''}`}
              onClick={() => setDifficulty(level)}
              aria-pressed={difficulty === level}
            >
              <b>{level[0]?.toUpperCase()}{level.slice(1)}</b>
              <span>bots</span>
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
          <Button variant="primary" type="submit" disabled={!ready} reason={!ready ? 'Pick a name first.' : null}>Open the table</Button>
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button variant="ghost" onClick={onRules}>Rules</Button>
        </div>
      </form>
    </main>
  );
}
