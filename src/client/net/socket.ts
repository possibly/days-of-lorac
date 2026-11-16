/**
 * Room-protocol client for peer tables.
 *
 * The host's tab runs the room manager; guests reach it over a WebRTC data
 * channel. There is no origin WebSocket and no reconnect address, so this client
 * only ever talks over a transport handed to it by `attachTransport`.
 *
 * Module-level singleton on purpose: React StrictMode mounts effects twice, so
 * a hook-owned socket would connect twice and seat the player twice. Callers
 * only ever touch `client`, and `start()` is idempotent.
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
import { SOCKET_OPEN } from './peer/socket-like';
import type { SocketLike } from './peer/socket-like';

const MAX_CHAT = 40;

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
  /** Host seat of the room, from the lobby or a game message. */
  hostSeat: Seat | null;
  /** Seats a bot is flying because the human dropped mid-game. */
  pilotSeats: Seat[];
  lobby: LobbyView | null;
  game: GameView | null;
  error: WireError | null;
  chats: ChatMessage[];
  roomClosed: string | null;
}

const INITIAL: ClientSnapshot = {
  link: 'idle',
  serverVersion: null,
  mismatch: false,
  ready: false,
  roomCode: null,
  you: null,
  hostSeat: null,
  pilotSeats: [],
  lobby: null,
  game: null,
  error: null,
  chats: [],
  roomClosed: null,
};

type Listener = () => void;

export class GameClient {
  private snapshot: ClientSnapshot = INITIAL;
  private listeners = new Set<Listener>();
  private socket: SocketLike | null = null;
  /** When set, `connect` asks this for a socket instead of opening one itself. */
  private transport: (() => SocketLike) | null = null;
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
    if (this.disposed || !this.transport || this.socket) return;
    this.connect();
  }

  /** Play over a data channel to the host, or the host's own loopback. */
  attachTransport(transport: () => SocketLike): void {
    this.resetSession();
    this.transport = transport;
    this.disposed = false;
    this.connect();
  }

  detachTransport(): void {
    this.transport = null;
    this.resetSession();
  }

  private resetSession(): void {
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
    this.socket = null;
    this.snapshot = { ...INITIAL };
    for (const listener of this.listeners) listener();
  }

  stop(): void {
    this.disposed = true;
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.disposed || !this.transport) return;
    this.update({ link: 'connecting' });
    let socket: SocketLike;
    try {
      socket = this.transport();
    } catch {
      this.update({ link: 'closed' });
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.update({ link: 'open', error: null });
      // The host greets first; intents wait for `welcome` so a version mismatch
      // never touches a seat.
    };

    socket.onmessage = (event: { data: string }) => {
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
      this.update({ link: 'closed', ready: false });
    };

    socket.onerror = () => {
      // `close` follows and owns the state change.
    };
  }

  // ----- outbound ----------------------------------------------------------

  private transmit(message: ClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN || !this.snapshot.ready) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  send(message: ClientMessage): void {
    this.transmit(message);
  }

  sendAction(action: GameAction): void {
    this.seq += 1;
    this.transmit({ type: 'action', action, seq: this.seq });
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
        return;
      }
      case 'lobby': {
        this.update({
          lobby: message.room,
          you: message.you,
          roomCode: message.room.code,
          hostSeat: message.room.hostSeat,
          pilotSeats: [],
          game: message.room.status === 'lobby' ? null : this.snapshot.game,
          error: null,
        });
        return;
      }
      case 'game': {
        this.update({
          game: message.view,
          you: message.you,
          roomCode: message.roomCode,
          hostSeat: message.hostSeat ?? this.snapshot.hostSeat ?? (this.snapshot.lobby?.hostSeat ?? null),
          pilotSeats: Array.isArray(message.pilotSeats) ? message.pilotSeats.slice() : [],
          error: null,
        });
        return;
      }
      case 'error': {
        const error: WireError = {
          code: message.code,
          message: message.message,
          at: Date.now(),
        };
        if (message.seq !== undefined) error.seq = message.seq;
        const gone = message.code === 'ROOM_NOT_FOUND' || message.code === 'NOT_IN_ROOM';
        if (gone) {
          this.update({
            roomCode: null,
            lobby: null,
            game: null,
            you: null,
            hostSeat: null,
            pilotSeats: [],
            error,
          });
        } else {
          this.update({ error });
        }
        return;
      }
      case 'chat': {
        this.update({ chats: [...this.snapshot.chats, message.message].slice(-MAX_CHAT) });
        return;
      }
      case 'roomClosed': {
        this.update({
          roomClosed: message.reason,
          roomCode: null,
          lobby: null,
          game: null,
          you: null,
          hostSeat: null,
          pilotSeats: [],
        });
        return;
      }
      default:
        return;
    }
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
}

export const onlineClient = new GameClient();

// Dev-only handle for QA scripts and console debugging. Never in a build.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __lorac?: GameClient }).__lorac = onlineClient;
}
export type { SocketLike };
