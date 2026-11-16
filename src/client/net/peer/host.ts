/**
 * Peer host: the real game room, running in this tab.
 *
 * The RoomManager and the wire router are the same modules the offline bot game
 * uses. The only difference is the transport: one RTCDataChannel per guest, plus
 * a loopback pair for the host's own seat, so the host is an ordinary client of
 * their own table.
 *
 * Signaling lives in `relay.ts`. This file only knows how to turn an open data
 * channel into a client of the room.
 */
import { GAME_VERSION } from '@shared/version';
import type { ServerMessage } from '@shared/protocol';
import type { BotDifficulty, MapSettings } from '@shared/types';
import { RoomManager } from '../../../server/room-manager.js';
import { routeClientMessage, sendError, SocketRateLimiter } from '../../../server/message-router.js';
import { systemClock } from '../../../server/rooms.js';
import type { ClientConnection } from '../../../server/rooms.js';
import type { GameClient } from '../socket';
import { createLoopback } from './socket-like';
import type { LoopbackPair } from './socket-like';

export interface RoomSummary {
  code: string;
  host: string;
  seats: 2 | 3 | 4;
}

export class PeerHost {
  private readonly manager: RoomManager;
  private readonly pair: LoopbackPair;
  private managerRoom: RoomSummary | null = null;
  private disposed = false;

  private connectionCounter = 0;

  constructor() {
    this.manager = new RoomManager({
      clock: systemClock,
      // The host tab has no console budget for scheduler tracing.
      log: () => {},
      debug: false,
    });
    this.pair = createLoopback('host-self');
    this.pair.onClientMessage = (raw) => this.receive(this.pair.conn, raw);
  }

  /** Hand the host's own GameClient a socket to this tab's manager. */
  attach(client: GameClient): void {
    client.attachTransport(() => {
      // Open after the client installs its handlers, exactly like a real socket.
      setTimeout(() => {
        if (this.disposed) return;
        this.pair.open();
        this.sendWelcome(this.pair.conn);
      }, 0);
      return this.pair.socket;
    });
  }

  setRoom(room: RoomSummary): void {
    this.managerRoom = room;
  }

  room(): RoomSummary | null {
    return this.managerRoom;
  }

  dispose(): void {
    this.disposed = true;
    this.pair.close();
  }

  /** Wires an open data channel into the manager as a fresh client. */
  addChannel(channel: RTCDataChannel): ClientConnection | null {
    if (this.disposed || channel.readyState !== 'open') return null;
    const connectionId = `peer-c${(this.connectionCounter += 1)}`;
    const conn: ClientConnection = {
      id: connectionId,
      send: (message: ServerMessage) => {
        if (channel.readyState === 'open') channel.send(JSON.stringify(message));
      },
      close: () => {
        try {
          channel.close();
        } catch {
          // already closed
        }
      },
    };
    const limiter = new SocketRateLimiter();
    channel.onmessage = (event: MessageEvent) => {
      const verdict = limiter.check(Date.now());
      if (verdict === 'warn') {
        sendError(conn, 'RATE_LIMITED', 'Slow down a little, then try again.');
        return;
      }
      if (verdict === 'drop') return;
      const data = typeof event.data === 'string' ? event.data : '';
      if (data) this.receive(conn, data);
    };
    channel.addEventListener('close', () => {
      this.manager.handleDisconnect(conn);
    });
    this.sendWelcome(conn);
    return conn;
  }

  /** Parse, route, never throw into the channel. */
  private receive(conn: ClientConnection, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendError(conn, 'BAD_MESSAGE', 'Send JSON objects.');
      return;
    }
    try {
      routeClientMessage(this.manager, conn, parsed);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[peer-host] handler failed: ${detail}`);
      sendError(conn, 'SERVER_ERROR', 'That message could not be handled.');
    }
  }

  private sendWelcome(conn: ClientConnection): void {
    conn.send({
      type: 'welcome',
      version: GAME_VERSION,
      connectionId: conn.id,
      serverTime: Date.now(),
    });
  }
}

/** Maps the room settings the host picked onto the manager's createRoom call. */
export interface HostRoomConfig {
  name: string;
  maxPlayers: 2 | 3 | 4;
  difficulty: BotDifficulty;
  map: MapSettings;
}
