/**
 * Days of Lorac signaling relay.
 *
 * One Durable Object per four-letter code. Its only job is to pair one host
 * with up to three guests and forward session descriptions between them. After
 * the WebRTC data channel opens the relay is out of the loop: no game traffic,
 * no chat, no hands.
 *
 * Design choices that keep the free tier comfortable:
 *   - no storage, no alarms, nothing to clean up,
 *   - WebSocket Hibernation API, so an idle lobby costs no duration,
 *   - a hard cap of four sockets per room,
 *   - strict message shapes and a size limit.
 *
 * The host picks the code and retries when a code is taken; the DO rejects a
 * second host with close code 4009 so the client can try again.
 */
import {
  RELAY_MAX_GUESTS,
  RELAY_MAX_MESSAGE,
  isRelayCode,
  parseRelayClientMessage,
} from '../../src/shared/relay';
import type { RelayRole, RelayServerMessage } from '../../src/shared/relay';

export interface Env {
  ROOMS: DurableObjectNamespace;
}

const CLOSE_TAKEN = 4009;
const CLOSE_NO_HOST = 4004;
const CLOSE_FULL = 4013;
const CLOSE_HOST_LEFT = 4001;
const CLOSE_BAD_MESSAGE = 1003;
const CLOSE_TOO_BIG = 1009;
const CLOSE_BUSY = 1008;
/** Signaling is a handful of frames per guest. Well above that is abuse. */
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 10_000;

interface Attachment {
  role: RelayRole;
  id: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, name: 'days-of-lorac-relay' });
    }

    const match = /^\/rooms\/([A-Za-z]{4})$/.exec(url.pathname);
    if (!match) return Response.json({ error: 'not found' }, { status: 404 });
    const code = (match[1] ?? '').toUpperCase();
    if (!isRelayCode(code)) {
      return Response.json({ error: 'bad code' }, { status: 400 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'expected a websocket upgrade' }, { status: 426 });
    }
    const role = url.searchParams.get('role');
    if (role !== 'host' && role !== 'guest') {
      return Response.json({ error: 'role must be host or guest' }, { status: 400 });
    }

    // The DO owns everything after this point, including the upgrade.
    return env.ROOMS.getByName(code).fetch(request);
  },
};

export class Room {
  private readonly state: DurableObjectState;
  /**
   * Per-socket counters. They live only while the object is awake, which is
   * fine: hibernation resets a limit nobody was close to hitting.
   */
  private readonly counts = new Map<WebSocket, { hits: number; since: number }>();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role: RelayRole = url.searchParams.get('role') === 'guest' ? 'guest' : 'host';
    const code = url.pathname.split('/').pop() ?? '';

    const sockets = this.state.getWebSockets();
    const host = sockets.find((socket) => this.roleOf(socket) === 'host');
    const guests = sockets.filter((socket) => this.roleOf(socket) === 'guest');

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (role === 'host' && host) {
      this.state.acceptWebSocket(server, ['host', 'rejected']);
      this.send(server, { t: 'error', code: 'ROOM_TAKEN', message: 'That code is in use.' });
      server.close(CLOSE_TAKEN, 'code in use');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (role === 'guest' && !host) {
      this.state.acceptWebSocket(server, ['guest', 'rejected']);
      this.send(server, { t: 'error', code: 'NO_ROOM', message: 'No table is open with that code.' });
      server.close(CLOSE_NO_HOST, 'no host');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (role === 'guest' && guests.length >= RELAY_MAX_GUESTS) {
      this.state.acceptWebSocket(server, ['guest', 'rejected']);
      this.send(server, { t: 'error', code: 'ROOM_FULL', message: 'That table is full.' });
      server.close(CLOSE_FULL, 'table full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const id = this.assignId(role, sockets);
    this.state.acceptWebSocket(server, [role, id]);
    server.serializeAttachment({ role, id } satisfies Attachment);
    this.send(server, { t: 'welcome', role, code, id });

    if (role === 'guest' && host) {
      this.send(host, { t: 'join', from: id });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const me = this.attachment(socket);
    if (!me) {
      socket.close(CLOSE_BAD_MESSAGE, 'unknown sender');
      return;
    }
    if (typeof raw !== 'string') {
      socket.close(CLOSE_TOO_BIG, 'text only');
      return;
    }
    if (raw.length > RELAY_MAX_MESSAGE) {
      socket.close(CLOSE_TOO_BIG, 'too large');
      return;
    }
    if (!this.withinRate(socket)) {
      socket.close(CLOSE_BUSY, 'slow down');
      return;
    }

    const message = parseRelayClientMessage(raw);
    if (!message) {
      socket.close(CLOSE_BAD_MESSAGE, 'bad message');
      return;
    }

    if (message.t === 'bye') {
      const other = this.counterpart(me, socket);
      if (other) this.send(other, { t: 'gone', from: me.id });
      return;
    }

    if (message.t === 'offer') {
      if (me.role !== 'host') {
        socket.close(CLOSE_BAD_MESSAGE, 'guests send answers');
        return;
      }
      const guest = this.find(message.to);
      if (guest) {
        this.send(guest, { t: 'offer', from: me.id, sdp: message.sdp, room: message.room });
      }
      return;
    }

    if (message.t === 'answer') {
      if (me.role !== 'guest') {
        socket.close(CLOSE_BAD_MESSAGE, 'hosts send offers');
        return;
      }
      const host = this.findHost();
      if (host) this.send(host, { t: 'answer', from: me.id, sdp: message.sdp });
    }
  }

  webSocketClose(socket: WebSocket, _code: number, _reason: string, _clean: boolean): void {
    this.counts.delete(socket);
    const me = this.attachment(socket);
    if (!me) return;
    if (me.role === 'host') {
      // Without a host there is nothing to join, so the room closes with it.
      for (const other of this.state.getWebSockets()) {
        if (other === socket) continue;
        this.send(other, { t: 'gone', from: me.id });
        try {
          other.close(CLOSE_HOST_LEFT, 'host left');
        } catch {
          // already gone
        }
      }
      return;
    }
    const host = this.findHost();
    if (host) this.send(host, { t: 'gone', from: me.id });
  }

  webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket, 1011, 'error', false);
  }

  // ----- helpers -----------------------------------------------------------

  private withinRate(socket: WebSocket): boolean {
    const now = Date.now();
    const entry = this.counts.get(socket);
    if (!entry || now - entry.since > RATE_WINDOW_MS) {
      this.counts.set(socket, { hits: 1, since: now });
      return true;
    }
    entry.hits += 1;
    return entry.hits <= RATE_LIMIT;
  }

  private roleOf(socket: WebSocket): RelayRole | null {
    return this.attachment(socket)?.role ?? null;
  }

  private attachment(socket: WebSocket): Attachment | null {
    const value = socket.deserializeAttachment() as Attachment | null;
    if (!value || (value.role !== 'host' && value.role !== 'guest')) return null;
    if (typeof value.id !== 'string') return null;
    return value;
  }

  private assignId(role: RelayRole, sockets: WebSocket[]): string {
    if (role === 'host') return 'host';
    const used = new Set(
      sockets
        .map((socket) => this.attachment(socket)?.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    for (let index = 1; index <= RELAY_MAX_GUESTS; index += 1) {
      const id = `g${index}`;
      if (!used.has(id)) return id;
    }
    return `g${Date.now().toString(36)}`;
  }

  private find(id: string): WebSocket | null {
    for (const socket of this.state.getWebSockets()) {
      if (this.attachment(socket)?.id === id) return socket;
    }
    return null;
  }

  private findHost(): WebSocket | null {
    for (const socket of this.state.getWebSockets()) {
      if (this.attachment(socket)?.role === 'host') return socket;
    }
    return null;
  }

  private counterpart(me: Attachment, self: WebSocket): WebSocket | null {
    if (me.role === 'host') return null;
    const host = this.findHost();
    return host === self ? null : host;
  }

  private send(socket: WebSocket, message: RelayServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A closed socket is not worth a log line on a free-tier relay.
    }
  }
}
