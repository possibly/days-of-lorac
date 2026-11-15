import { useState } from 'react';
import { Button } from '../ui/Button';

export function JoinScreen({
  initialName,
  initialCode,
  locked,
  onChange,
  onJoin,
  onBack,
  onRules,
  notice,
}: {
  initialName: string;
  initialCode: string;
  locked: boolean;
  onChange: () => void;
  onJoin: (name: string, code: string) => void;
  onBack: () => void;
  onRules: () => void;
  notice: string | null;
}): JSX.Element {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode.toUpperCase());
  const valid = /^[A-Z]{4}$/.test(code);
  const ready = name.trim().length > 0 && valid;

  return (
    <main className="setup-screen">
      <form
        className="parchment setup-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onJoin(name.trim(), code);
        }}
      >
        <p className="eyebrow">By invitation</p>
        <h1 className="panel-title">Join a room</h1>
        {notice ? <p className="join-notice">{notice}</p> : null}
        <p className="setup-note">Ask the host for the four-letter code, or open their invite link.</p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={24} autoFocus={locked} onChange={(event) => setName(event.target.value)} placeholder="Guild factor" />
        </label>

        <div className="field">
          <span>Room code</span>
          {locked ? (
            <div className="code-locked">
              <span className="room-code chip-code">{code}</span>
              <button type="button" className="text-link" onClick={onChange}>Change</button>
            </div>
          ) : (
            <input
              value={code}
              maxLength={4}
              autoFocus={!locked}
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
              className={`code-input${code.length > 0 && !valid ? ' is-bad' : ''}`}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              placeholder="KRTM"
              aria-describedby={code.length > 0 && !valid ? 'code-hint' : undefined}
            />
          )}
          {!locked && code.length > 0 && !valid ? <span id="code-hint" className="field-hint is-bad">Room codes are four letters.</span> : null}
        </div>

        <div className="setup-actions">
          <Button variant="primary" type="submit" disabled={!ready} reason={!ready ? (!valid ? 'Room codes are four letters.' : 'Pick a name first.') : null}>Join room</Button>
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button variant="ghost" onClick={onRules}>Rules</Button>
        </div>
      </form>
    </main>
  );
}
