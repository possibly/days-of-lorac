/**
 * The one store the UI talks to.
 *
 * The page starts in the in-tab bot game. Hosting or joining a peer table swaps
 * in the WebSocket-style client that talks over a data channel; leaving swaps
 * back. Screens keep calling `client.*` and `useSyncExternalStore` keeps one
 * subscribe function, while `activate` swaps the store underneath and notifies
 * once.
 */
import type { BotDifficulty, CardSettings, GameAction, MapSettings, Seat } from '@shared/types';
import type { ClientSnapshot } from './socket';
import { onlineClient } from './socket';
import { LocalClient } from './local';

export interface GameStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ClientSnapshot;
  start(): void;
  stop?(): void;

  quickPlay(
    name: string,
    seats: 2 | 3 | 4,
    difficulty: BotDifficulty,
    map: MapSettings,
    cards: CardSettings,
  ): void;
  leaveRoom(): void;

  setReady(ready: boolean): void;
  setMapSettings(map: MapSettings): void;
  setCardSettings(cards: CardSettings): void;
  addBot(difficulty: BotDifficulty): void;
  removePlayer(seat: Seat): void;
  startGame(): void;
  rematch(): void;

  chat(text: string): void;
  sendAction(action: GameAction): void;
  clearError(): void;
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
  leaveRoom = (): void => this.active.leaveRoom();
  setReady = (ready: boolean): void => this.active.setReady(ready);
  setMapSettings = (map: MapSettings): void => this.active.setMapSettings(map);
  setCardSettings = (cards: CardSettings): void => this.active.setCardSettings(cards);
  addBot = (difficulty: BotDifficulty): void => this.active.addBot(difficulty);
  removePlayer = (seat: Seat): void => this.active.removePlayer(seat);
  startGame = (): void => this.active.startGame();
  rematch = (): void => this.active.rematch();
  chat = (text: string): void => this.active.chat(text);
  sendAction = (action: GameAction): void => this.active.sendAction(action);
  clearError = (): void => this.active.clearError();
}

const localClient = new LocalClient();

export { localClient };

export const client = new StoreFront(localClient);

/** The room-protocol client. Peer hosting and peer joining both use it. */
export { onlineClient };

export function activateLocal(): void {
  client.activate(localClient);
}

export function activateOnline(): void {
  client.activate(onlineClient);
}

export type { ClientSnapshot, LinkState, WireError } from './socket';

// Dev-only handle, same idea as __lorac in socket.ts: the bot game has its own
// store, so a console or a QA script needs a way to read the solo snapshot.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __loracLocal?: LocalClient }).__loracLocal = localClient;
}
