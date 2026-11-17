import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_VERSION } from '@shared/version';
import type { CardSettings, GameAction, GameView, MapSettings, Seat } from '@shared/types';
import { normalizeMapSettings } from '@shared/map-settings';
import { client, localClient } from './net/store';
import { useGame } from './net/useGame';
import { clearSoloGame, isSoloFresh, loadSoloGame, soloResumeInfo } from './net/solo-save';
import type { SoloResumeInfo } from './net/solo-save';
import { errorLine } from './net/errors';
import {
  loadLetters,
  loadName,
  loadSound,
  saveLetters,
  saveName,
  saveSound,
} from './net/storage';
import { TitleScreen } from './screens/TitleScreen';
import { SoloSetupScreen } from './screens/SoloSetupScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { PeerHostScreen } from './screens/PeerHostScreen';
import { PeerJoinScreen } from './screens/PeerJoinScreen';
import { GameScreen } from './screens/GameScreen';
import { RulesSheet } from './modals/RulesSheet';
import { RoomClosedModal, VersionMismatchModal } from './modals/RoomClosedModal';
import { Toasts } from './ui/Toasts';
import type { ToastItem } from './ui/Toasts';
import { Button } from './ui/Button';
import { setSoundEnabled, playCue } from './sound/audio';
import type { FixtureMode, FixtureSession } from './dev/fixture';
import { installDiagnostics } from './dev/diagnose';
import { peer } from './net/peer/session';
import { usePeer } from './net/peer/usePeer';
import type { HostRoomConfig } from './net/peer/session';

type Screen = 'title' | 'solo' | 'peer-host' | 'peer-join' | 'connecting' | 'lobby' | 'game';

const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

export default function App(): JSX.Element {
  const snapshot = useGame();
  const peerState = usePeer();
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const fixtureParam = params.get('fixture');
  const fixtureMode = isDev && fixtureParam !== null;
  const fixtureKind: FixtureMode = fixtureParam === 'setup' || fixtureParam === 'discard' || fixtureParam === 'over' || fixtureParam === 'robber' || fixtureParam === 'offer' ? fixtureParam : 'mid';
  // Dev fixtures can render any island: ?fixture=mid&size=grand&land=balanced
  const fixtureMap = normalizeMapSettings({
    size: params.get('size') ?? undefined,
    terrain: params.get('land') ?? undefined,
    tokens: params.get('numbers') ?? undefined,
  });

  const [screen, setScreen] = useState<Screen>('title');
  const [name, setName] = useState(() => loadName());
  const [rulesOpen, setRulesOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(() => loadSound());
  const [letters, setLetters] = useState(() => loadLetters());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [closed, setClosed] = useState<string | null>(null);
  const [fixture, setFixture] = useState<FixtureSession | null>(null);
  const fixtureLoader = useRef<((mode: FixtureMode, map: MapSettings) => FixtureSession) | null>(null);
  const [fixtureView, setFixtureView] = useState<GameView | null>(null);
  const [busyLabel, setBusyLabel] = useState('Opening the table…');
  const [soloResume, setSoloResume] = useState<SoloResumeInfo | null>(null);

  const toastId = useRef(1);
  const booted = useRef(false);
  const peerBooted = useRef(false);
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

  // #code=... is a relay join link. Without one, boot looks for work this
  // browser left behind, which is how a reload comes back into a table or a
  // bot game. A live peer table wins over a solo save; both are offered on the
  // title screen when neither is fresh.
  useEffect(() => {
    if (peerBooted.current || fixtureMode) return;
    peerBooted.current = true;
    const invited = window.location.hash.includes('code=');
    if (invited) {
      if (peer.loadInviteFromUrl()) setScreen('peer-join');
      return;
    }

    const peerMode = peer.boot();
    const savedSolo = loadSoloGame();
    const freshSolo = savedSolo !== null && isSoloFresh(savedSolo);

    if (peerMode === 'auto') {
      // A live table wins the boot. Keep the bot game on offer for later.
      if (savedSolo) setSoloResume(soloResumeInfo(savedSolo));
      setBusyLabel('Reopening the table…');
      setScreen('connecting');
      return;
    }
    if (savedSolo && freshSolo) {
      localClient.restore(savedSolo);
      return;
    }
    if (savedSolo) setSoloResume(soloResumeInfo(savedSolo));
  }, [fixtureMode]);

  // Peer phases own their screens until the room protocol takes over.
  useEffect(() => {
    if (peerState.phase === 'host-starting') {
      setBusyLabel(peerState.room ? 'Reopening the table…' : 'Opening the table…');
      setScreen('connecting');
      return;
    }
    if (peerState.phase === 'guest-reconnecting') {
      setBusyLabel('Reconnecting to the table…');
      setScreen('connecting');
      return;
    }
    if (peerState.phase === 'guest-preview' || peerState.phase === 'guest-answering') {
      setScreen('peer-join');
      return;
    }
    if (peerState.phase === 'error') {
      const message = peerState.error;
      // Tear the half-open table down before the title screen can start a solo
      // game; otherwise the store would still be pointing at the room client.
      peer.leave();
      if (message) pushToast(message, 'error');
      setScreen('title');
    }
  }, [peerState.phase, peerState.error, peerState.room, pushToast]);

  // ?diag=1 pins an on-device measurement panel over the game. Inert otherwise.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('diag') === null) return;
    installDiagnostics();
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
    if (fixtureMode) void loadFixture(fixtureKind);
    // Everything else starts at the title screen.
  }, []);

  // ----- snapshot routing --------------------------------------------------
  useEffect(() => {
    if (fixtureMode) return;
    if (snapshot.mismatch) return;
    if (snapshot.game) {
      if (screenRef.current !== 'game') setScreen('game');
      return;
    }
    if (snapshot.lobby) {
      if (screenRef.current !== 'lobby') setScreen('lobby');
    }
  }, [snapshot.game, snapshot.lobby, snapshot.mismatch, fixtureMode]);

  // ----- errors ------------------------------------------------------------
  useEffect(() => {
    const error = snapshot.error;
    if (!error) return;
    const key = `${error.at}:${error.code}`;
    if (seenError.current === key) return;
    seenError.current = key;
    pushToast(errorLine(error.code, error.message), 'error');
    playCue('reject');
    if (screenRef.current === 'connecting') setScreen('title');
    client.clearError();
  }, [snapshot.error, pushToast]);

  // ----- room closed -------------------------------------------------------
  useEffect(() => {
    if (!snapshot.roomClosed) return;
    setClosed(snapshot.roomClosed);
    peer.leave();
  }, [snapshot.roomClosed]);

  useEffect(() => {
    if (!closed) return undefined;
    const timer = window.setTimeout(() => {
      setClosed(null);
      setScreen('title');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [closed]);

  // ----- helpers -----------------------------------------------------------
  const goTitle = (): void => {
    if (fixtureMode) {
      setScreen('title');
      setFixtureView(null);
      return;
    }
    // A peer table lives behind its own teardown, not just a leaveRoom message.
    if (peer.active) peer.leave();
    else client.leaveRoom();
    setScreen('title');
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
  const isHost = fixtureMode ? true : snapshot.hostSeat !== null ? snapshot.hostSeat === you : null;

  // ----- render ------------------------------------------------------------
  let body: JSX.Element;
  if (screen === 'game' && currentView) {
    body = (
      <GameScreen
        key={currentView.gameId}
        view={currentView}
        you={currentView.you}
        connected={fixtureMode ? true : snapshot.link === 'open'}
        pilotSeats={fixtureMode ? [] : snapshot.pilotSeats}
        chats={fixtureMode ? [] : snapshot.chats}
        onChat={(text) => (fixtureMode ? undefined : client.chat(text))}
        roomCode={fixtureMode ? 'TEST' : peerState.relayCode ?? snapshot.roomCode}
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
        onMap={(map) => client.setMapSettings(map)}
        onCards={(cards) => client.setCardSettings(cards)}
        onAddBot={(difficulty) => client.addBot(difficulty)}
        onRemove={(seat) => client.removePlayer(seat)}
        onLeave={goTitle}
        onChat={(text) => client.chat(text)}
        onRules={() => setRulesOpen(true)}
      />
    );
  } else if (screen === 'solo') {
    body = <SoloSetupScreen initialName={name} onStart={startSolo} onBack={() => setScreen('title')} onRules={() => setRulesOpen(true)} />;
  } else if (screen === 'peer-host') {
    body = (
      <PeerHostScreen
        initialName={name}
        onStart={startPeerHost}
        onBack={() => setScreen('title')}
        onRules={() => setRulesOpen(true)}
      />
    );
  } else if (screen === 'peer-join') {
    body = (
      <PeerJoinScreen
        state={peerState}
        initialName={name}
        onJoin={joinPeer}
        onBack={leavePeer}
        onRules={() => setRulesOpen(true)}
      />
    );
  } else if (screen === 'connecting') {
    body = (
      <main className="setup-screen">
        <div className="parchment setup-panel busy-panel" role="status" aria-live="polite">
          <p className="eyebrow">Opening the table</p>
          <h1 className="panel-title">{busyLabel}</h1>
          <p className="setup-note">
            {peerState.role === 'host'
              ? 'This browser is the table. Nothing is uploaded.'
              : 'Game data goes straight between the devices. Nothing is uploaded.'}
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
        multiplayer={peerState.relayAvailable}
        onPeerHost={() => { peer.leave(); setScreen('peer-host'); }}
        onPeerJoin={() => { peer.leave(); setScreen('peer-join'); }}
        onRules={() => setRulesOpen(true)}
        clientVersion={GAME_VERSION}
        resumable={peerState.resumable}
        onResume={() => {
          setBusyLabel('Reopening the table…');
          setScreen('connecting');
          void peer.resumeSaved();
        }}
        onDiscardResume={() => peer.discardSaved()}
        soloResume={soloResume}
        onResumeSolo={() => {
          const saved = loadSoloGame();
          setSoloResume(null);
          if (!saved) return;
          localClient.restore(saved);
        }}
        onForgetSolo={() => {
          clearSoloGame();
          setSoloResume(null);
        }}
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

  async function loadFixture(mode: FixtureMode, map: MapSettings = fixtureMap): Promise<void> {
    if (!fixtureLoader.current) {
      const module = await import('./dev/fixture');
      fixtureLoader.current = module.createFixture;
    }
    const session = fixtureLoader.current(mode, fixtureMap);
    setFixture(session);
    setFixtureView(session.view);
    setScreen('game');
  }

  function startSolo(
    person: string,
    seats: 2 | 3 | 4,
    difficulty: 'easy' | 'normal' | 'hard',
    map: MapSettings,
    cards: CardSettings,
  ): void {
    setName(person);
    saveName(person);
    if (fixtureMode) return;
    client.quickPlay(person, seats, difficulty, map, cards);
  }

  function startPeerHost(config: HostRoomConfig): void {
    setName(config.name);
    saveName(config.name);
    setBusyLabel('Opening the table…');
    setScreen('connecting');
    void peer.hostTable(config);
  }

  function joinPeer(person: string): void {
    setName(person);
    saveName(person);
    void peer.joinAsGuest(person);
  }

  function leavePeer(): void {
    peer.leave();
    goTitle();
  }
}
