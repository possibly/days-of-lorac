/**
 * Short-code signaling over the relay Worker.
 *
 * Host: open one relay socket per room and hand out a four-letter code. Every
 * guest that connects gets its own peer connection and offer, because one offer
 * cannot seat two guests.
 *
 * Guest: open a relay socket with the code and wait for the offer. The answer
 * goes back through the same socket.
 *
 * The relay only forwards session descriptions. Game data runs on the data
 * channel and never touches Cloudflare.
 */
import { randomRelayCode, relayServerMessage } from '@shared/relay';
import type { RelayClientMessage } from '@shared/relay';
import { gatheredDescription, ICE_SERVERS, trimSdp } from './signaling';
import { createDeferredSocket, rtcSocket } from './socket-like';
import type { DeferredSocket } from './socket-like';

const RELAY_ENV_KEY = 'VITE_RELAY_URL';
const RELAY_QUERY_KEY = 'relay';

/** `wss://host` with no trailing slash, or null when no relay is configured. */
export function relayBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const fromQuery = new URLSearchParams(window.location.search).get(RELAY_QUERY_KEY);
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const fromEnv = typeof env?.[RELAY_ENV_KEY] === 'string' ? (env[RELAY_ENV_KEY] as string) : null;
  const raw = (fromQuery ?? fromEnv ?? '').trim();
  if (!raw || raw === 'off') return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `${window.location.protocol === 'https:' ? 'https' : 'http'}://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return null;
  }
  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  if (!secure && window.location.protocol === 'https:') return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${secure ? 'wss' : 'ws'}://${url.host}${path}`;
}

/** Shareable link that opens the join screen with the code filled in. */
export function relayJoinUrl(code: string): string {
  const url = new URL(window.location.href);
  url.hash = `code=${code}`;
  return url.toString();
}

export function readRelayCode(href: string): string | null {
  try {
    const hash = new URL(href).hash.replace(/^#/, '');
    if (!hash) return null;
    const code = new URLSearchParams(hash).get('code');
    return code ? code.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

export function relayCloseReason(code: number): string {
  if (code === 4004) return 'No table is open with that code. Check the letters and that the host tab is still open.';
  if (code === 4009) return 'That code was just taken. Try again.';
  if (code === 4013) return 'That table is full.';
  if (code === 4001) return 'The host closed the table.';
  return 'Lost the relay connection. Check your network and try again.';
}

interface HostEvents {
  onChannel: (channel: RTCDataChannel) => void;
  onGuestLeft?: (id: string) => void;
  onClosed?: (reason: string) => void;
  onState?: (state: 'connecting' | 'open') => void;
}

export class RelayHost {
  private socket: WebSocket | null = null;
  private readonly peers = new Map<string, RTCPeerConnection>();
  private closed = false;
  private code: string | null = null;
  private settled = false;

  constructor(
    private readonly base: string,
    private readonly room: string,
    private readonly events: HostEvents,
  ) {}

  get roomCode(): string | null {
    return this.code;
  }

  /**
   * Tries codes until one is free. Rejects when the relay is unreachable, with
   * an overall budget so a blackholed network reports a clear error instead of
   * leaving the host staring at a spinner.
   */
  async start(attempts = 6, budgetMs = 8000): Promise<string> {
    const deadline = Date.now() + budgetMs;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.closed) throw new Error('Cancelled.');
      const left = deadline - Date.now();
      if (left <= 0) break;
      const code = randomRelayCode();
      this.events.onState?.('connecting');
      try {
        await this.connect(code, Math.min(3000, left));
        this.code = code;
        this.events.onState?.('open');
        return code;
      } catch (error) {
        if (error instanceof TakenError) continue;
        throw error instanceof Error ? error : new Error('The relay did not answer.');
      }
    }
    throw new Error('The relay is unreachable. Check the address and your network.');
  }

  private connect(code: string, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.settled = false;
      let opened = false;
      const socket = new WebSocket(`${this.base}/rooms/${code}?role=host`);
      this.socket = socket;
      const timer = window.setTimeout(() => {
        if (this.settled) return;
        this.settled = true;
        try {
          socket.close();
        } catch {
          // already closed
        }
        reject(new Error('The relay did not answer in time.'));
      }, timeoutMs);
      const settle = (): void => {
        window.clearTimeout(timer);
      };

      socket.onmessage = (event) => {
        const message = relayServerMessage(String(event.data));
        if (!message) return;
        if (message.t === 'welcome') {
          opened = true;
          this.settled = true;
          settle();
          resolve();
          return;
        }
        if (message.t === 'join') {
          void this.offerTo(message.from);
          return;
        }
        if (message.t === 'answer') {
          void this.acceptAnswer(message.from, message.sdp);
          return;
        }
        if (message.t === 'gone') {
          this.dropPeer(message.from);
          return;
        }
        if (message.t === 'error' && message.code === 'ROOM_TAKEN') {
          this.settled = true;
          settle();
          reject(new TakenError());
        }
      };

      socket.onerror = () => {
        if (this.settled) return;
        this.settled = true;
        settle();
        reject(new Error('The relay is unreachable.'));
      };

      socket.onclose = (event) => {
        if (!this.settled) {
          this.settled = true;
          settle();
          if (event.code === 4009) reject(new TakenError());
          else reject(new Error(relayCloseReason(event.code)));
          return;
        }
        if (opened && !this.closed) {
          this.events.onClosed?.(relayCloseReason(event.code));
        }
      };
    });
  }

  private async offerTo(guestId: string): Promise<void> {
    if (this.closed) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('lorac', { ordered: true });
    this.peers.set(guestId, pc);

    channel.onopen = () => {
      if (this.closed) return;
      this.events.onChannel(channel);
    };
    channel.onclose = () => this.dropPeer(guestId);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPeer(guestId);
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = trimSdp(await gatheredDescription(pc));
      if (this.closed || this.peers.get(guestId) !== pc) return;
      this.send({ t: 'offer', to: guestId, sdp, room: this.room });
    } catch {
      this.dropPeer(guestId);
    }
  }

  private async acceptAnswer(guestId: string, sdp: string): Promise<void> {
    const pc = this.peers.get(guestId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      this.dropPeer(guestId);
    }
  }

  private dropPeer(guestId: string): void {
    const pc = this.peers.get(guestId);
    if (!pc) return;
    this.peers.delete(guestId);
    try {
      pc.close();
    } catch {
      // already closed
    }
    this.events.onGuestLeft?.(guestId);
  }

  private send(message: RelayClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The close handler owns the aftermath.
    }
  }

  /** Stops taking new guests but leaves existing data channels alone. */
  stopSignaling(): void {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
  }

  close(): void {
    this.stopSignaling();
    for (const guestId of [...this.peers.keys()]) this.dropPeer(guestId);
  }
}

class TakenError extends Error {}

interface GuestEvents {
  onFail: (reason: string) => void;
  onState?: (state: 'connecting' | 'waiting' | 'open') => void;
}

export class RelayGuest {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private readonly deferred: DeferredSocket = createDeferredSocket();
  private roomCode: string | null = null;
  private closed = false;
  private timer: number | undefined;

  constructor(
    private readonly base: string,
    private readonly code: string,
    private readonly events: GuestEvents,
  ) {}

  /** The socket the game client should attach to, channel or not yet. */
  socket(): DeferredSocket {
    return this.deferred;
  }

  /** The game room to join, known once the host's offer arrives. */
  room(): string | null {
    return this.roomCode;
  }

  connect(): void {
    this.events.onState?.('connecting');
    const socket = new WebSocket(`${this.base}/rooms/${this.code}?role=guest`);
    this.ws = socket;

    // The host should answer a join within a second or two. Give it plenty on a
    // slow phone, then say something useful instead of spinning forever.
    this.timer = window.setTimeout(() => {
      if (!this.roomCode) this.events.onFail('The host did not answer. Ask them to check their tab.');
    }, 20_000);

    socket.onmessage = (event) => {
      const message = relayServerMessage(String(event.data));
      if (!message) return;
      if (message.t === 'welcome') {
        this.events.onState?.('waiting');
        return;
      }
      if (message.t === 'offer') {
        void this.acceptOffer(message.sdp, message.room);
        return;
      }
      if (message.t === 'gone') {
        this.close();
        this.events.onFail('The host closed the table.');
        return;
      }
      if (message.t === 'error') {
        this.events.onFail(message.message);
      }
    };

    socket.onerror = () => {
      if (this.closed) return;
      this.events.onFail('The relay is unreachable. Check your network and try again.');
    };

    socket.onclose = (event) => {
      if (this.closed) return;
      this.events.onFail(relayCloseReason(event.code));
    };
  }

  private async acceptOffer(sdp: string, room: string): Promise<void> {
    if (this.closed) return;
    this.roomCode = room;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.ondatachannel = (event) => {
      if (this.closed) return;
      this.deferred.attach(rtcSocket(event.channel));
    };

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const local = trimSdp(await gatheredDescription(pc));
      if (this.closed) return;
      this.send({ t: 'answer', sdp: local });
      this.events.onState?.('open');
    } catch {
      this.events.onFail('Could not complete the handshake with the host.');
    }
  }

  private send(message: RelayClientMessage): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The close handler owns the aftermath.
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
    try {
      this.pc?.close();
    } catch {
      // already closed
    }
    this.pc = null;
    this.deferred.close();
  }
}
