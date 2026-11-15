/**
 * The one store the UI talks to.
 *
 * Two implementations satisfy `GameStore`: the WebSocket client in `socket.ts`
 * and the in-browser client in `local.ts`. The build picks one at load, so no
 * screen has to know whether it is playing online or offline.
 */
import type { BotDifficulty, GameAction, Seat } from '@shared/types';
import type { ClientSnapshot } from './socket';
import { onlineClient } from './socket';
import { LocalClient } from './local';
import { OFFLINE_MODE } from './mode';

export interface GameStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ClientSnapshot;
  start(): void;
  stop?(): void;

  quickPlay(name: string, seats: 2 | 3 | 4, difficulty: BotDifficulty): void;
  createRoom(name: string, maxPlayers: 2 | 3 | 4, difficulty: BotDifficulty): void;
  joinRoom(code: string, name: string): void;
  resumeSession(code: string, token: string): void;
  resumeStored(code: string): boolean;
  leaveRoom(): void;
  forget(): void;

  setReady(ready: boolean): void;
  addBot(difficulty: BotDifficulty): void;
  removePlayer(seat: Seat): void;
  startGame(): void;
  rematch(): void;

  chat(text: string): void;
  sendAction(action: GameAction): void;
  clearError(): void;
  clearRoomClosed(): void;
}

export const client: GameStore = OFFLINE_MODE ? new LocalClient() : onlineClient;

export { OFFLINE_MODE };
export type { ClientSnapshot, LinkState, WireError } from './socket';
