/**
 * One WebSocket client for the whole app.
 *
 * Module-level singleton on purpose: React StrictMode mounts effects twice, so
 * a hook-owned socket would connect twice and seat the player twice. Callers
 * only ever touch `client`, and `start()` is idempotent.
 *
 * Responsibilities:
 *   - connect to /ws, parse typed ServerMessages,
 *   - check the welcome version before anything else,
 *   - resume with the stored token on every reconnect,
 *   - exponential backoff, bot-pilot flag after 45s,
 *   - hold one pending action across a drop and resend it exactly once, only
 *     after the resumed view proves the original send never landed.
 */
import type {
  ChatMessage,
  ClientMessage,
  LobbyView,
  ServerMessage,
  WireErrorCode,
} from '@shared/protocol';
import type { GameAction, GameView, MapSettings, Seat } from '@shared/types';
import { GAME_VERSION } from '@shared/version';
import { clearToken, loadToken, saveToken } from './storage';

const MAX_CHAT = 40;
const BOT_PILOT_MS = 45_000;
const BACKOFF = [400, 900, 1800, 3600, 7200, 10000];

export type LinkState = 'idle' | 'connecting' | 'open' | 'closed';

export interface WireError {
  code: WireErrorCode;
  message: string;
  seq?: number;
  at: number;
}

export interface ClientSnapshot {
  link: LinkState;
  serverVersion: string | null;
  mismatch: boolean;
  /** True after a welcome was seen and versions agree. */
  ready: boolean;
  roomCode: string | null;
  you: Seat | null;
  token: string | null;
  /** Host seat of the room, from the lobby or a game message. */
  hostSeat: Seat | null;
  /** Seats a bot is flying because the human dropped mid-game. */
  pilotSeats: Seat[];
  lobby: LobbyView | null;
  game: GameView | null;
  error: WireError | null;
  chats: ChatMessage[];
  roomClosed: string | null;
  attempt: number;
  droppedAt: number | null;
  botPilot: boolean;
  latency: number | null;
  /** Set when a resume attempt is in flight, so screens can show a spinner. */
  resuming: boolean;
}

function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws`;
}

const INITIAL: ClientSnapshot = {
  link: 'idle',
  serverVersion: null,
  mismatch: false,
  ready: false,
  roomCode: null,
  you: null,
  token: null,
  hostSeat: null,
  pilotSeats: [],
  lobby: null,
  game: null,
  error: null,
  chats: [],
  roomClosed: null,
  attempt: 0,
  droppedAt: null,
  botPilot: false,
  latency: null,
  resuming: false,
};

type Listener = () => void;

class GameClient {
  private snapshot: ClientSnapshot = INITIAL;
  private listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private retryTimer: number | undefined;
  private botTimer: number | undefined;
  private pingTimer: number | undefined;
  private resume: { code: string; token: string } | null = null;
  private pendingAction: { message: ClientMessage; seq: number } | null = null;
  /**
   * Set when `resume` went out with an unconfirmed action still held. The next
   * view decides: a higher version means it already applied.
   */
  private gate: { seq: number; versionAtSend: number | null; resent: boolean } | null = null;
  private outbox: ClientMessage[] = [];
  private seq = 0;
  private disposed = false;

  // ----- store plumbing ----------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ClientSnapshot => this.snapshot;

  private update(patch: Partial<ClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ----- lifecycle ---------------------------------------------------------

  /** Idempotent: safe to call from an effect that StrictMode runs twice. */
  start(): void {
    if (this.disposed) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  stop(): void {
    this.disposed = true;
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    if (this.botTimer !== undefined) window.clearTimeout(this.botTimer);
    if (this.pingTimer !== undefined) window.clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.disposed) return;
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      try {
        this.socket.close();
      } catch {
        // already closed
      }
    }
    this.update({ link: 'connecting' });
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.update({
        link: 'open',
        attempt: 0,
        droppedAt: null,
        botPilot: false,
        error: null,
      });
      if (this.botTimer !== undefined) window.clearTimeout(this.botTimer);
      this.botTimer = undefined;
      // The server greets first; resume and queued intents wait for `welcome`
      // so a version mismatch never touches a seat.
      if (this.pingTimer !== undefined) window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: Date.now() }), 25_000);
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      if (this.socket !== socket) return;
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.handle(parsed);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer !== undefined) window.clearInterval(this.pingTimer);
      this.pingTimer = undefined;
      this.update({
        link: 'closed',
        droppedAt: Date.now(),
        attempt: this.snapshot.attempt + 1,
        resuming: false,
      });
      if (this.snapshot.roomCode && this.snapshot.token) {
        if (this.botTimer !== undefined) window.clearTimeout(this.botTimer);
        this.botTimer = window.setTimeout(() => {
          this.update({ botPilot: true });
        }, BOT_PILOT_MS);
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // `close` follows and owns the retry.
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    const step = Math.min(this.snapshot.attempt, BACKOFF.length - 1);
    const base = BACKOFF[step] ?? 10000;
    const delay = base + Math.floor(Math.random() * 250);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  // ----- outbound ----------------------------------------------------------

  private transmit(message: ClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.snapshot.ready) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  /** Sends now or queues until open. Intents are replayed in order. */
  send(message: ClientMessage): void {
    if (this.transmit(message)) return;
    if (message.type === 'action') return; // actions go through sendAction
    this.outbox.push(message);
    if (this.outbox.length > 12) this.outbox.shift();
    this.start();
  }

  sendAction(action: GameAction): void {
    this.seq += 1;
    const message: ClientMessage = { type: 'action', action, seq: this.seq };
    this.pendingAction = { message, seq: this.seq };
    this.gate = null;
    if (!this.transmit(message)) {
      // Held in memory; replayed after the next successful resume.
      return;
    }
  }

  private flush(): void {
    const queued = this.outbox;
    this.outbox = [];
    for (const message of queued) this.transmit(message);
  }

  // ----- session -----------------------------------------------------------

  /** Prime a resume. Call before `start()` when the URL names a room. */
  resumeSession(code: string, token: string): void {
    this.resume = { code: code.toUpperCase(), token };
    this.update({ resuming: true, error: null });
    this.start();
  }

  private maybeResume(): void {
    const token = this.snapshot.token;
    const code = this.snapshot.roomCode;
    const target =
      this.resume ??
      (code && token ? { code, token } : null);
    this.resume = target;
    if (!target) {
      this.update({ resuming: false });
      this.flush();
      return;
    }
    const sent = this.transmit({ type: 'resume', code: target.code, token: target.token });
    this.update({ resuming: sent });
    if (!sent) return;
    // A lost reply and a lost send look identical from here, so never resend
    // blind. The next view decides; only an unchanged version earns one retry.
    if (this.pendingAction) {
      const pending = this.pendingAction;
      if (!this.gate || this.gate.seq !== pending.seq) {
        this.gate = { seq: pending.seq, versionAtSend: this.snapshot.game?.version ?? null, resent: false };
      }
    }
  }

  forget(): void {
    const code = this.snapshot.roomCode;
    if (code) clearToken(code);
    this.resume = null;
    this.pendingAction = null;
    this.gate = null;
    this.outbox = [];
    this.update({ ...INITIAL, link: this.snapshot.link, serverVersion: this.snapshot.serverVersion, ready: this.snapshot.ready });
  }

  clearError(): void {
    if (this.snapshot.error) this.update({ error: null });
  }

  clearRoomClosed(): void {
    if (this.snapshot.roomClosed) this.update({ roomClosed: null });
  }

  // ----- inbound -----------------------------------------------------------

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome': {
        const mismatch = message.version !== GAME_VERSION;
        this.update({
          serverVersion: message.version,
          mismatch,
          ready: !mismatch,
        });
        if (mismatch) {
          // Never resume against a server with a different protocol build.
          return;
        }
        this.maybeResume();
        return;
      }
      case 'lobby': {
        saveToken(message.room.code, message.token, message.you);
        this.resume = { code: message.room.code, token: message.token };
        this.update({
          lobby: message.room,
          you: message.you,
          token: message.token,
          roomCode: message.room.code,
          hostSeat: message.room.hostSeat,
          pilotSeats: [],
          resuming: false,
          game: message.room.status === 'lobby' ? null : this.snapshot.game,
          error: null,
        });
        this.pendingAction = null;
        this.gate = null;
        return;
      }
      case 'game': {
        saveToken(message.roomCode, message.token, message.you);
        this.resume = { code: message.roomCode, token: message.token };
        this.resolvePending(message.view.version);
        this.update({
          game: message.view,
          you: message.you,
          token: message.token,
          roomCode: message.roomCode,
          hostSeat: message.hostSeat ?? this.snapshot.hostSeat ?? (this.snapshot.lobby?.hostSeat ?? null),
          pilotSeats: Array.isArray(message.pilotSeats) ? message.pilotSeats.slice() : [],
          resuming: false,
          error: null,
        });
        this.pendingAction = null;
        this.gate = null;
        return;
      }
      case 'error': {
        const error: WireError = {
          code: message.code,
          message: message.message,
          at: Date.now(),
        };
        if (message.seq !== undefined) error.seq = message.seq;
        if (message.seq !== undefined && this.pendingAction?.seq === message.seq) {
          this.pendingAction = null;
          this.gate = null;
        }
        const gone = message.code === 'ROOM_NOT_FOUND' || message.code === 'NOT_IN_ROOM';
        if (gone) {
          const code = this.snapshot.roomCode;
          if (code) clearToken(code);
          this.resume = null;
          this.pendingAction = null;
          this.gate = null;
          this.outbox = [];
          this.update({
            roomCode: null,
            lobby: null,
            game: null,
            you: null,
            token: null,
            hostSeat: null,
            pilotSeats: [],
            resuming: false,
            error,
          });
        } else {
          this.update({ error, resuming: false });
        }
        return;
      }
      case 'chat': {
        this.update({ chats: [...this.snapshot.chats, message.message].slice(-MAX_CHAT) });
        return;
      }
      case 'roomClosed': {
        const code = this.snapshot.roomCode;
        if (code) clearToken(code);
        this.resume = null;
        this.pendingAction = null;
        this.gate = null;
        this.update({
          roomClosed: message.reason,
          roomCode: null,
          lobby: null,
          game: null,
          you: null,
          token: null,
          hostSeat: null,
          pilotSeats: [],
        });
        return;
      }
      case 'pong': {
        if (message.t !== null) this.update({ latency: Math.max(0, Date.now() - message.t) });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Decide what to do with an action held across a reconnect. A higher version
   * than the one at send time means the server applied it and only the reply
   * was lost, so the action is dropped. Otherwise it is resent exactly once.
   */
  private resolvePending(version: number): void {
    const pending = this.pendingAction;
    const gate = this.gate;
    if (!pending || !gate || gate.seq !== pending.seq) return;
    if (gate.versionAtSend !== null && version > gate.versionAtSend) return; // applied
    if (gate.resent) return; // already retried once; give up quietly
    gate.resent = true;
    this.transmit(pending.message);
  }

  // ----- convenience intents ----------------------------------------------

  quickPlay(
    name: string,
    seats: 2 | 3 | 4,
    difficulty: 'easy' | 'normal' | 'hard',
    map: MapSettings,
  ): void {
    this.send({ type: 'quickPlay', name, seats, difficulty, map });
  }

  createRoom(
    name: string,
    maxPlayers: 2 | 3 | 4,
    difficulty: 'easy' | 'normal' | 'hard',
    map: MapSettings,
  ): void {
    this.send({ type: 'createRoom', name, maxPlayers, difficulty, map });
  }

  joinRoom(code: string, name: string): void {
    this.send({ type: 'joinRoom', code: code.toUpperCase(), name });
  }

  leaveRoom(): void {
    this.send({ type: 'leaveRoom' });
    const code = this.snapshot.roomCode;
    if (code) clearToken(code);
    this.resume = null;
    this.pendingAction = null;
    this.gate = null;
    this.update({
      ...INITIAL,
      link: this.snapshot.link,
      serverVersion: this.snapshot.serverVersion,
      ready: this.snapshot.ready,
      chats: this.snapshot.chats.slice(-4),
    });
  }

  setReady(ready: boolean): void {
    this.send({ type: 'setReady', ready });
  }

  setMapSettings(map: MapSettings): void {
    this.send({ type: 'setMapSettings', map });
  }

  addBot(difficulty: 'easy' | 'normal' | 'hard'): void {
    this.send({ type: 'addBot', difficulty });
  }

  removePlayer(seat: Seat): void {
    this.send({ type: 'removePlayer', seat });
  }

  startGame(): void {
    this.send({ type: 'startGame' });
  }

  rematch(): void {
    this.send({ type: 'rematch' });
  }

  chat(text: string): void {
    this.send({ type: 'chat', text });
  }

  /** Replay the last stored room after a page reload. */
  resumeStored(code: string): boolean {
    const token = loadToken(code);
    if (!token) return false;
    this.resumeSession(code, token);
    return true;
  }
}

export const onlineClient = new GameClient();

// Dev-only handle for QA scripts and console debugging. Never in a build.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __lorac?: GameClient }).__lorac = onlineClient;
}
export { wsUrl };
