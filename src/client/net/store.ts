/**
 * The one store the UI talks to.
 *
 * Normally the build picks a store once: the WebSocket client for a build with
 * a server, the in-browser client for the static build. Peer play breaks that
 * assumption, because the same page may host a table (which needs the room
 * protocol and therefore the online client) after starting out offline.
 *
 * So `client` is a stable front that forwards to whichever store is active.
 * Screens keep calling `client.*` and `useSyncExternalStore` keeps one subscribe
 * function, while `activate` swaps the store underneath and notifies once.
 */
import type { BotDifficulty, GameAction, MapSettings, Seat } from '@shared/types';
import type { ClientSnapshot } from './socket';
import { onlineClient } from './socket';
import { LocalClient } from './local';
import { OFFLINE_MODE } from './mode';

export interface GameStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ClientSnapshot;
  start(): void;
  stop?(): void;

  quickPlay(name: string, seats: 2 | 3 | 4, difficulty: BotDifficulty, map: MapSettings): void;
  createRoom(name: string, maxPlayers: 2 | 3 | 4, difficulty: BotDifficulty, map: MapSettings): void;
  joinRoom(code: string, name: string): void;
  resumeSession(code: string, token: string): void;
  resumeStored(code: string): boolean;
  leaveRoom(): void;
  forget(): void;

  setReady(ready: boolean): void;
  setMapSettings(map: MapSettings): void;
  addBot(difficulty: BotDifficulty): void;
  removePlayer(seat: Seat): void;
  startGame(): void;
  rematch(): void;

  chat(text: string): void;
  sendAction(action: GameAction): void;
  clearError(): void;
  clearRoomClosed(): void;
}

class StoreFront implements GameStore {
  private active: GameStore;
  private readonly listeners = new Set<() => void>();
  private detach: (() => void) | null = null;

  constructor(initial: GameStore) {
    this.active = initial;
    this.detach = initial.subscribe(this.notify);
  }

  private notify = (): void => {
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ClientSnapshot => this.active.getSnapshot();

  /** Swap the backing store. Idempotent, and safe before anyone subscribes. */
  activate(target: GameStore): void {
    if (this.active === target) return;
    this.detach?.();
    this.active = target;
    this.detach = target.subscribe(this.notify);
    target.start();
    this.notify();
  }

  activeStore(): GameStore {
    return this.active;
  }

  start = (): void => this.active.start();
  stop = (): void => this.active.stop?.();

  quickPlay = (...args: Parameters<GameStore['quickPlay']>): void => this.active.quickPlay(...args);
  createRoom = (...args: Parameters<GameStore['createRoom']>): void => this.active.createRoom(...args);
  joinRoom = (...args: Parameters<GameStore['joinRoom']>): void => this.active.joinRoom(...args);
  resumeSession = (...args: Parameters<GameStore['resumeSession']>): void => this.active.resumeSession(...args);
  resumeStored = (code: string): boolean => this.active.resumeStored(code);
  leaveRoom = (): void => this.active.leaveRoom();
  forget = (): void => this.active.forget();
  setReady = (ready: boolean): void => this.active.setReady(ready);
  setMapSettings = (map: MapSettings): void => this.active.setMapSettings(map);
  addBot = (difficulty: BotDifficulty): void => this.active.addBot(difficulty);
  removePlayer = (seat: Seat): void => this.active.removePlayer(seat);
  startGame = (): void => this.active.startGame();
  rematch = (): void => this.active.rematch();
  chat = (text: string): void => this.active.chat(text);
  sendAction = (action: GameAction): void => this.active.sendAction(action);
  clearError = (): void => this.active.clearError();
  clearRoomClosed = (): void => this.active.clearRoomClosed();
}

const localClient = new LocalClient();

export const client = new StoreFront(OFFLINE_MODE ? localClient : onlineClient);

/** The room-protocol client. Peer hosting and peer joining both use it. */
export { onlineClient };

export function activateOffline(): void {
  client.activate(localClient);
}

export function activateOnline(): void {
  client.activate(onlineClient);
}

export { OFFLINE_MODE };
export type { ClientSnapshot, LinkState, WireError } from './socket';
