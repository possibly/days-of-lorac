/**
 * Peer host: the real game server, running in this tab.
 *
 * The RoomManager, the wire router and the bot policy are the same modules the
 * Node server uses. The only difference is the transport: instead of sockets
 * there is one RTCDataChannel per guest, plus a loopback pair for the host's own
 * seat, so the host is an ordinary client of their own table.
 *
 * Signaling is manual. `createInvite` builds a peer connection and returns an
 * offer link; `acceptAnswer` takes the guest's reply code. No server sees
 * either, and no TURN server is involved.
 */
import { GAME_VERSION } from '@shared/version';
import type { ServerMessage } from '@shared/protocol';
import type { BotDifficulty, MapSettings } from '@shared/types';
import { RoomManager } from '../../../server/room-manager.js';
import { routeClientMessage, sendError, SocketRateLimiter } from '../../../server/message-router.js';
import { systemClock } from '../../../server/rooms.js';
import type { ClientConnection } from '../../../server/rooms.js';
import { decodeCode, encodeCode } from './codec';
import type { GameClient } from '../socket';
import { createLoopback } from './socket-like';
import type { LoopbackPair } from './socket-like';
import { gatheredDescription, ICE_SERVERS, isAnswer, joinUrl, trimSdp } from './signaling';
import type { AnswerPayload, OfferPayload } from './signaling';

export interface HostInvite {
  id: string;
  /** Share this. It carries the offer in the fragment. */
  link: string;
  /** The same payload, for QR display and for pasting by hand. */
  code: string;
  connected: boolean;
}

interface PendingInvite extends HostInvite {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  conn: ClientConnection | null;
}

export interface RoomSummary {
  code: string;
  host: string;
  seats: 2 | 3 | 4;
}

export class PeerHost {
  private readonly manager: RoomManager;
  private readonly pair: LoopbackPair;
  private readonly pending = new Map<string, PendingInvite>();
  private managerRoom: RoomSummary | null = null;
  private nextId = 0;
  private disposed = false;
  private onInvites: (() => void) | null = null;

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

  onInviteChange(listener: () => void): void {
    this.onInvites = listener;
  }

  invites(): HostInvite[] {
    return [...this.pending.values()].map(({ id, link, code, connected }) => ({ id, link, code, connected }));
  }

  /** Creates a peer connection per invite: one offer can only serve one guest. */
  async createInvite(): Promise<HostInvite> {
    const room = this.managerRoom;
    if (!room) throw new Error('The room is not open yet.');

    const id = `p${(this.nextId += 1)}`;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('lorac', { ordered: true });
    const invite: PendingInvite = { id, link: '', code: '', connected: false, pc, channel, conn: null };
    this.pending.set(id, invite);

    channel.onopen = () => {
      if (this.disposed) return;
      invite.connected = true;
      this.attachGuest(invite);
      this.onInvites?.();
    };
    channel.onclose = () => {
      if (invite.conn) this.manager.handleDisconnect(invite.conn);
      invite.conn = null;
      invite.connected = false;
      this.pending.delete(id);
      this.onInvites?.();
    };
    channel.onerror = () => {
      // `close` follows and owns cleanup.
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (invite.conn) this.manager.handleDisconnect(invite.conn);
        invite.conn = null;
        this.pending.delete(id);
        this.onInvites?.();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = trimSdp(await gatheredDescription(pc));
    const payload: OfferPayload = {
      v: 1,
      t: 'offer',
      id,
      room: room.code,
      host: room.host,
      seats: room.seats,
      sdp,
    };
    invite.code = await encodeCode(payload);
    invite.link = joinUrl(window.location.href, invite.code);
    this.onInvites?.();
    return { id, link: invite.link, code: invite.code, connected: false };
  }

  async acceptAnswer(input: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const payload = await decodeCode<AnswerPayload>(input);
    if (!isAnswer(payload)) return { ok: false, reason: 'That is not a reply code.' };
    const invite = this.pending.get(payload.id);
    if (!invite) {
      return { ok: false, reason: 'That reply belongs to an invite that is no longer waiting.' };
    }
    if (invite.pc.signalingState !== 'have-local-offer') {
      return { ok: false, reason: 'That invite already has a reply.' };
    }
    try {
      await invite.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      return { ok: true };
    } catch {
      return { ok: false, reason: 'The reply did not match this invite. Ask for a fresh one.' };
    }
  }

  dropInvite(id: string): void {
    const invite = this.pending.get(id);
    if (!invite) return;
    try {
      invite.pc.close();
    } catch {
      // already closed
    }
    this.pending.delete(id);
    this.onInvites?.();
  }

  dispose(): void {
    this.disposed = true;
    for (const invite of this.pending.values()) {
      try {
        invite.pc.close();
      } catch {
        // already closed
      }
    }
    this.pending.clear();
    this.pair.close();
  }

  private attachGuest(invite: PendingInvite): void {
    const { channel } = invite;
    const conn: ClientConnection = {
      id: `peer-${invite.id}`,
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
    invite.conn = conn;
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
    this.sendWelcome(conn);
  }

  /** Same contract as `ws.ts`: parse, route, never throw into the channel. */
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
