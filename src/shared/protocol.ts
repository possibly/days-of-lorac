import type {
  ActionErrorCode,
  BotDifficulty,
  GameAction,
  GameView,
  MapSettings,
  Seat,
} from './types.js';

/** WebSocket protocol shared by client and server. */

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface RoomConfig {
  maxPlayers: 2 | 3 | 4;
  difficulty: BotDifficulty;
  /** Host-chosen island size and placement. Editable until the game starts. */
  map: MapSettings;
}

export interface LobbyPlayer {
  seat: Seat;
  name: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  host: boolean;
}

export interface LobbyView {
  code: string;
  status: RoomStatus;
  hostSeat: Seat;
  config: RoomConfig;
  targetVp: number;
  players: LobbyPlayer[];
}

export interface ChatMessage {
  id: number;
  /** Null for system lines. */
  seat: Seat | null;
  name: string;
  text: string;
  /** Server clock, display only. Never used by the engine. */
  at: number;
}

export type WireErrorCode =
  | ActionErrorCode
  | 'BAD_MESSAGE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NAME_REQUIRED'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'ALREADY_STARTED'
  | 'INVALID_ROOM'
  | 'TOO_MANY_PLAYERS'
  | 'NOT_ENOUGH_PLAYERS'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR';

export type ClientMessage =
  | { type: 'ping'; t?: number }
  | {
      type: 'quickPlay';
      name: string;
      seats: 2 | 3 | 4;
      difficulty: BotDifficulty;
      map?: MapSettings;
    }
  | {
      type: 'createRoom';
      name: string;
      maxPlayers: 2 | 3 | 4;
      difficulty: BotDifficulty;
      map?: MapSettings;
    }
  | { type: 'joinRoom'; code: string; name: string }
  | { type: 'resume'; code: string; token: string }
  | { type: 'leaveRoom' }
  | { type: 'setReady'; ready: boolean }
  | { type: 'setMapSettings'; map: MapSettings }
  | { type: 'addBot'; difficulty?: BotDifficulty }
  | { type: 'removePlayer'; seat: Seat }
  | { type: 'startGame' }
  | { type: 'rematch' }
  | { type: 'action'; action: GameAction; seq?: number }
  | { type: 'chat'; text: string };

export type ServerMessage =
  | {
      type: 'welcome';
      version: string;
      connectionId: string;
      serverTime: number;
    }
  | {
      type: 'lobby';
      room: LobbyView;
      you: Seat;
      /** Sent only to its owner. Store it for reconnect. */
      token: string;
    }
  | {
      type: 'game';
      roomCode: string;
      you: Seat;
      /** Host of the room, so a refreshed guest does not get rematch rights. */
      hostSeat?: Seat;
      /** Seats currently flown by the bot because the human dropped. */
      pilotSeats?: Seat[];
      token: string;
      view: GameView;
    }
  | {
      type: 'error';
      code: WireErrorCode;
      message: string;
      /** Echo of the client's action sequence, when there was one. */
      seq?: number;
    }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'roomClosed'; reason: string }
  | { type: 'pong'; t: number | null; serverTime: number };
