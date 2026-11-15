import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_VERSION } from '@shared/version';
import type { GameAction, GameView, Seat } from '@shared/types';
import { client } from './net/socket';
import type { LinkState } from './net/socket';
import { useGame } from './net/useGame';
import { errorLine } from './net/errors';
import {
  forgetSession,
  loadLastSession,
  loadLetters,
  loadName,
  loadResumable,
  loadSound,
  saveLetters,
  saveName,
  saveSound,
} from './net/storage';
import type { StoredSession } from './net/storage';
import { TitleScreen } from './screens/TitleScreen';
import { SoloSetupScreen } from './screens/SoloSetupScreen';
import { CreateRoomScreen } from './screens/CreateRoomScreen';
import { JoinScreen } from './screens/JoinScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { RulesSheet } from './modals/RulesSheet';
import { RoomClosedModal, VersionMismatchModal } from './modals/RoomClosedModal';
import { Toasts } from './ui/Toasts';
import type { ToastItem } from './ui/Toasts';
import { Button } from './ui/Button';
import { setSoundEnabled, playCue } from './sound/audio';
import type { FixtureMode, FixtureSession } from './dev/fixture';

type Screen = 'title' | 'solo' | 'create' | 'join' | 'connecting' | 'resume' | 'lobby' | 'game';

const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

export default function App(): JSX.Element {
  const snapshot = useGame();
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const fixtureParam = params.get('fixture');
  const fixtureMode = isDev && fixtureParam !== null;
  const fixtureKind: FixtureMode = fixtureParam === 'setup' || fixtureParam === 'discard' || fixtureParam === 'over' || fixtureParam === 'robber' || fixtureParam === 'offer' ? fixtureParam : 'mid';

  const [screen, setScreen] = useState<Screen>('title');
  const [name, setName] = useState(() => loadName());
  const [joinCode, setJoinCode] = useState('');
  const [joinLocked, setJoinLocked] = useState(false);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(() => loadSound());
  const [letters, setLetters] = useState(() => loadLetters());
  const [lastSession, setLastSession] = useState<StoredSession | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [closed, setClosed] = useState<string | null>(null);
  const [fixture, setFixture] = useState<FixtureSession | null>(null);
  const fixtureLoader = useRef<((mode: FixtureMode) => FixtureSession) | null>(null);
  const [fixtureView, setFixtureView] = useState<GameView | null>(null);
  const [busyLabel, setBusyLabel] = useState('Seating the table…');

  const toastId = useRef(1);
  const booted = useRef(false);
  const previousLink = useRef<LinkState>('idle');
  const hostSeat = useRef<Seat | null>(null);
  const lastCode = useRef<string | null>(null);
  const seenError = useRef<string>('');
  const screenRef = useRef<Screen>('title');
  screenRef.current = screen;

  const pushToast = useCallback((text: string, tone: ToastItem['tone'] = 'info') => {
    const id = toastId.current;
    toastId.current += 1;
    setToasts((current) => [...current, { id, text, tone }].slice(-3));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    setSoundEnabled(soundOn);
    saveSound(soundOn);
  }, [soundOn]);

  useEffect(() => {
    saveLetters(letters);
  }, [letters]);

  useEffect(() => {
    saveName(name);
  }, [name]);

  useEffect(() => {
    setLastSession(loadResumable());
  }, []);

  // One delegated click cue: no cue for buttons that were disabled.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      if (!button || button.disabled) return;
      playCue('click');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // ----- boot routing ------------------------------------------------------
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    if (fixtureMode) {
      void loadFixture(fixtureKind);
      return;
    }

    const room = params.get('room');
    if (room === null) return;
    const code = room.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) {
      pushToast('Room codes are four letters.', 'error');
      setRoomParam(null);
      return;
    }
    const resumable = loadResumable();
    if (resumable && resumable.code === code) {
      setBusyLabel(`Rejoining room ${code}…`);
      setScreen('resume');
      client.resumeSession(code, resumable.token);
      return;
    }
    setJoinCode(code);
    setJoinLocked(true);
    setScreen('join');
    // Refs and toast helper are stable; run once on boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- snapshot routing --------------------------------------------------
  useEffect(() => {
    if (fixtureMode) return;
    if (snapshot.mismatch) return;
    if (snapshot.hostSeat !== null) hostSeat.current = snapshot.hostSeat;
    if (snapshot.game) {
      if (screenRef.current !== 'game') setScreen('game');
      lastCode.current = snapshot.roomCode;
      if (snapshot.roomCode) setRoomParam(snapshot.roomCode);
      setLastSession(loadResumable());
      return;
    }
    if (snapshot.lobby) {
      if (screenRef.current !== 'lobby') setScreen('lobby');
      hostSeat.current = snapshot.lobby.hostSeat;
      lastCode.current = snapshot.lobby.code;
      setRoomParam(snapshot.lobby.code);
      setLastSession(loadResumable());
    }
  }, [snapshot.game, snapshot.lobby, snapshot.hostSeat, snapshot.mismatch, fixtureMode]);

  // ----- errors ------------------------------------------------------------
  useEffect(() => {
    const error = snapshot.error;
    if (!error) return;
    const key = `${error.at}:${error.code}`;
    if (seenError.current === key) return;
    seenError.current = key;
    const line = errorLine(error.code, error.message);
    pushToast(line, 'error');
    playCue('reject');

    if (error.code === 'ROOM_NOT_FOUND' || error.code === 'NOT_IN_ROOM') {
      const code = lastCode.current ?? snapshot.roomCode ?? joinCode;
      setJoinCode(code);
      setJoinLocked(Boolean(code));
      setJoinNotice(error.code === 'ROOM_NOT_FOUND' ? 'That room has ended. Ask for a fresh code.' : 'You are no longer in that room.');
      setScreen('join');
      setRoomParam(code || null);
      setLastSession(loadResumable());
    } else if (error.code === 'ROOM_FULL' || error.code === 'ALREADY_STARTED' || error.code === 'NAME_REQUIRED') {
      setJoinNotice(line);
      setScreen(joinCode ? 'join' : 'title');
      setRoomParam(joinCode || null);
    } else if (screenRef.current === 'connecting' || screenRef.current === 'resume') {
      setScreen('title');
    }
    client.clearError();
  }, [snapshot.error, snapshot.roomCode, joinCode, pushToast]);

  // ----- room closed -------------------------------------------------------
  useEffect(() => {
    if (!snapshot.roomClosed) return;
    setClosed(snapshot.roomClosed);
    setLastSession(null);
    setRoomParam(null);
  }, [snapshot.roomClosed]);

  useEffect(() => {
    if (!closed) return undefined;
    const timer = window.setTimeout(() => {
      setClosed(null);
      setScreen('title');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [closed]);

  // ----- reconnect toast ---------------------------------------------------
  useEffect(() => {
    const previous = previousLink.current;
    previousLink.current = snapshot.link;
    if (previous === 'closed' && snapshot.link === 'open') pushToast('Reconnected.', 'ok');
  }, [snapshot.link, pushToast]);

  // ----- helpers -----------------------------------------------------------
  const goTitle = (): void => {
    if (fixtureMode) {
      setScreen('title');
      setFixtureView(null);
      return;
    }
    if (snapshot.roomCode) client.leaveRoom();
    setRoomParam(null);
    setJoinNotice(null);
    setJoinLocked(false);
    setScreen('title');
    setLastSession(loadResumable());
    setClosed(null);
  };

  const sendAction = (action: GameAction): void => {
    if (fixture) {
      const next = fixture.apply(action);
      setFixtureView(next);
      return;
    }
    client.sendAction(action);
  };

  const soundToggle = (): void => {
    setSoundOn((on) => {
      const next = !on;
      if (next) playCue('click');
      return next;
    });
  };

  const currentView = fixtureMode ? fixtureView : snapshot.game;
  const you = currentView?.you ?? snapshot.you ?? 0;
  const seatHost = fixtureMode ? true : snapshot.hostSeat !== null ? snapshot.hostSeat === you : hostSeat.current !== null ? hostSeat.current === you : lastCode.current === null ? true : null;
  const isHost = seatHost;

  // ----- render ------------------------------------------------------------
  let body: JSX.Element;
  if (screen === 'game' && currentView) {
    body = (
      <GameScreen
        key={currentView.gameId}
        view={currentView}
        you={currentView.you}
        connected={fixtureMode ? true : snapshot.link === 'open'}
        link={snapshot.link}
        botPilot={fixtureMode ? false : snapshot.botPilot}
        pilotSeats={fixtureMode ? [] : snapshot.pilotSeats}
        chats={fixtureMode ? [] : snapshot.chats}
        onChat={(text) => (fixtureMode ? undefined : client.chat(text))}
        roomCode={fixtureMode ? 'TEST' : snapshot.roomCode}
        soundOn={soundOn}
        letters={letters}
        isHost={isHost}
        sendAction={sendAction}
        onLeave={goTitle}
        onRematch={() => {
          if (fixtureMode) {
            void loadFixture(fixtureKind);
          } else {
            client.rematch();
          }
        }}
        onRules={() => setRulesOpen(true)}
        onToggleSound={soundToggle}
        onToggleLetters={() => setLetters((value) => !value)}
      />
    );
  } else if (screen === 'lobby' && snapshot.lobby) {
    body = (
      <LobbyScreen
        lobby={snapshot.lobby}
        you={snapshot.you ?? 0}
        chats={snapshot.chats}
        connected={snapshot.link === 'open'}
        onReady={(ready) => client.setReady(ready)}
        onStart={() => client.startGame()}
        onAddBot={(difficulty) => client.addBot(difficulty)}
        onRemove={(seat) => client.removePlayer(seat)}
        onLeave={goTitle}
        onChat={(text) => client.chat(text)}
        onRules={() => setRulesOpen(true)}
      />
    );
  } else if (screen === 'solo') {
    body = <SoloSetupScreen initialName={name} onStart={startSolo} onBack={() => setScreen('title')} onRules={() => setRulesOpen(true)} />;
  } else if (screen === 'create') {
    body = <CreateRoomScreen initialName={name} onStart={startCreate} onBack={() => setScreen('title')} onRules={() => setRulesOpen(true)} />;
  } else if (screen === 'join') {
    body = (
      <JoinScreen
        initialName={name}
        initialCode={joinCode}
        locked={joinLocked}
        notice={joinNotice}
        onChange={() => setJoinLocked(false)}
        onJoin={startJoin}
        onBack={() => { setScreen('title'); setRoomParam(null); }}
        onRules={() => setRulesOpen(true)}
      />
    );
  } else if (screen === 'resume' || screen === 'connecting') {
    body = (
      <main className="setup-screen">
        <div className="parchment setup-panel busy-panel" role="status" aria-live="polite">
          <p className="eyebrow">{screen === 'resume' ? 'Reconnect' : 'Opening the table'}</p>
          <h1 className="panel-title">{busyLabel}</h1>
          <p className="setup-note">
            {snapshot.link === 'open' ? 'Waiting on the server.' : 'Connecting to the server. The buttons return if it stays down.'}
          </p>
          <span className={`spinner${snapshot.link === 'open' ? ' is-fast' : ''}`} aria-hidden="true" />
          <div className="setup-actions">
            <Button variant="ghost" onClick={goTitle}>Cancel</Button>
          </div>
        </div>
      </main>
    );
  } else {
    body = (
      <TitleScreen
        name={name}
        onName={setName}
        onSolo={() => setScreen('solo')}
        onCreate={() => setScreen('create')}
        onJoin={() => { setJoinCode(''); setJoinLocked(false); setJoinNotice(null); setScreen('join'); }}
        onResume={resume}
        onForget={forget}
        onRules={() => setRulesOpen(true)}
        session={lastSession}
        link={snapshot.link}
        serverVersion={snapshot.serverVersion}
        clientVersion={GAME_VERSION}
        latency={snapshot.latency}
      />
    );
  }

  return (
    <>
      <a
        className="skip-link"
        href="#hand-dock"
        onClick={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>('.hand-dock')?.scrollIntoView({ block: 'nearest' });
          document.querySelector<HTMLElement>('.hand-dock .card-face')?.focus();
        }}
      >
        Jump to my hand
      </a>
      {body}
      {rulesOpen ? <RulesSheet onClose={() => setRulesOpen(false)} /> : null}
      {closed ? (
        <RoomClosedModal
          reason={closed}
          onTitle={() => {
            setClosed(null);
            goTitle();
          }}
        />
      ) : null}
      {snapshot.mismatch && snapshot.serverVersion ? (
        <VersionMismatchModal serverVersion={snapshot.serverVersion} clientVersion={GAME_VERSION} />
      ) : null}
      <Toasts items={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </>
  );

  async function loadFixture(mode: FixtureMode): Promise<void> {
    if (!fixtureLoader.current) {
      const module = await import('./dev/fixture');
      fixtureLoader.current = module.createFixture;
    }
    const session = fixtureLoader.current(mode);
    setFixture(session);
    setFixtureView(session.view);
    setScreen('game');
  }

  function startSolo(person: string, seats: 2 | 3 | 4, difficulty: 'easy' | 'normal' | 'hard'): void {
    setName(person);
    saveName(person);
    if (fixtureMode) return;
    setBusyLabel('Seating the bots…');
    setScreen('connecting');
    client.quickPlay(person, seats, difficulty);
  }

  function startCreate(person: string, maxPlayers: 2 | 3 | 4, difficulty: 'easy' | 'normal' | 'hard'): void {
    setName(person);
    saveName(person);
    if (fixtureMode) return;
    setBusyLabel('Creating your room…');
    setScreen('connecting');
    client.createRoom(person, maxPlayers, difficulty);
  }

  function startJoin(person: string, code: string): void {
    setName(person);
    saveName(person);
    setJoinCode(code);
    setJoinLocked(true);
    setJoinNotice(null);
    setRoomParam(code);
    if (fixtureMode) return;
    setBusyLabel(`Joining room ${code}…`);
    setScreen('connecting');
    client.joinRoom(code, person);
  }

  function resume(code: string): void {
    if (fixtureMode) return;
    if (!client.resumeStored(code)) {
      setJoinCode(code);
      setJoinLocked(true);
      setJoinNotice('That room has ended. Ask for a fresh code.');
      setScreen('join');
      return;
    }
    setBusyLabel(`Rejoining room ${code}…`);
    setScreen('resume');
  }

  function forget(): void {
    forgetSession();
    setLastSession(null);
    pushToast('Session forgotten.');
  }
}

function setRoomParam(code: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    window.history.replaceState(null, '', `${url.pathname}${url.search ? url.search : ''}`);
  } catch {
    // History is unavailable in some embedded views; the app still works.
  }
}
