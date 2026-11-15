import { useState } from 'react';
import type { BotDifficulty } from '@shared/types';
import { VP_TARGETS } from '@shared/constants';
import { Button } from '../ui/Button';

export function SoloSetupScreen({
  initialName,
  onStart,
  onBack,
  onRules,
}: {
  initialName: string;
  onStart: (name: string, seats: 2 | 3 | 4, difficulty: BotDifficulty) => void;
  onBack: () => void;
  onRules: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName);
  const [seats, setSeats] = useState<2 | 3 | 4>(4);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal');
  const target = VP_TARGETS[seats];
  const ready = name.trim().length > 0;

  return (
    <main className="setup-screen">
      <form
        className="parchment setup-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onStart(name.trim(), seats, difficulty);
        }}
      >
        <p className="eyebrow">Solo table</p>
        <h1 className="panel-title">Play vs bots</h1>
        <p className="setup-note">Race to {target}. Bots take the free seats and answer trade offers.</p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={24} autoFocus onChange={(event) => setName(event.target.value)} placeholder="Guild factor" />
        </label>

        <fieldset className="choice-row">
          <legend>Seats</legend>
          {([2, 3, 4] as const).map((count) => (
            <button key={count} type="button" className={`choice${seats === count ? ' is-on' : ''}`} onClick={() => setSeats(count)} aria-pressed={seats === count}>
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
