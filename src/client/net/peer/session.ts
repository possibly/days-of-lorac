/**
 * Peer session: the small state machine behind the peer screens.
 *
 * Host: spin up the in-tab room server, become its first client, create a room,
 * then publish a four-letter code through the relay. Guests type the code and
 * connect straight to this tab over WebRTC. The relay carries the handshake
 * only.
 *
 * Everything the UI needs is in one external store so screens do not have to
 * thread callbacks around. React binding lives in `usePeer.ts`.
 */
import { isRelayCode } from '@shared/relay';
import type { ClientSnapshot } from '../socket';
import { onlineClient, activateLocal, activateOnline } from '../store';
import type { GameStore } from '../store';
import { PeerHost } from './host';
import type { HostRoomConfig } from './host';
import {
  RelayGuest,
  RelayHost,
  readRelayCode,
  relayBaseUrl,
  relayJoinUrl,
} from './relay';

export type PeerRole = 'idle' | 'host' | 'guest';
export type PeerPhase =
  | 'idle'
  | 'host-starting'
  | 'host-ready'
  | 'guest-preview'
  | 'guest-answering'
  | 'connected'
  | 'error';

export interface PeerSnapshot {
  role: PeerRole;
  phase: PeerPhase;
  /** True when this build has a relay URL, so multiplayer is possible. */
  relayAvailable: boolean;
  /** The four-letter code guests type. */
  relayCode: string | null;
  relayLink: string | null;
  /** Room code inside the host tab, once one exists. */
  room: string | null;
  hostName: string | null;
  seats: 2 | 3 | 4;
  error: string | null;
}

const INITIAL: PeerSnapshot = {
  role: 'idle',
  phase: 'idle',
  relayAvailable: relayBaseUrl() !== null,
  relayCode: null,
  relayLink: null,
  room: null,
  hostName: null,
  seats: 4,
  error: null,
};

const START_TIMEOUT_MS = 15_000;
const GUEST_TIMEOUT_MS = 25_000;

function waitFor(
  store: GameStore,
  test: (snapshot: ClientSnapshot) => boolean,
  timeoutMs = START_TIMEOUT_MS,
): Promise<ClientSnapshot | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = (): boolean => {
      const snapshot = store.getSnapshot();
      if (test(snapshot)) {
        resolve(snapshot);
        return true;
      }
      if (Date.now() - started > timeoutMs) {
        resolve(null);
        return true;
      }
      return false;
    };
    if (check()) return;
    const timer = window.setInterval(() => {
      if (check()) window.clearInterval(timer);
    }, 50);
  });
}

class PeerSession {
  private snapshot: PeerSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private host: PeerHost | null = null;
  private relayHost: RelayHost | null = null;
  private relayGuest: RelayGuest | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private watchLink: (() => void) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PeerSnapshot => this.snapshot;

  get active(): boolean {
    return this.snapshot.role !== 'idle';
  }

  private set(patch: Partial<PeerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ----- host ---------------------------------------------------------------

  async hostTable(config: HostRoomConfig): Promise<void> {
    this.teardown();
    const relay = relayBaseUrl();
    if (!relay) {
      this.set({
        ...INITIAL,
        phase: 'error',
        error: 'Multiplayer needs the relay. Set VITE_RELAY_URL at build time, or add ?relay= to the page URL.',
      });
      return;
    }

    const host = new PeerHost();
    this.host = host;
    this.set({ ...INITIAL, role: 'host', phase: 'host-starting', seats: config.maxPlayers });

    // Attach the transport before switching the store, or the client would
    // first try to reach the page's own origin.
    host.attach(onlineClient);
    activateOnline();

    const ready = await waitFor(onlineClient, (snapshot) => snapshot.ready || snapshot.mismatch);
    if (this.host !== host) return;
    if (!ready?.ready) {
      this.fail('This browser could not start the table. Reload and try again.');
      return;
    }

    onlineClient.createRoom(config.name, config.maxPlayers, config.difficulty, config.map);
    const lobby = await waitFor(onlineClient, (snapshot) => snapshot.lobby !== null || snapshot.error !== null);
    if (this.host !== host) return;
    if (!lobby?.lobby) {
      this.fail(lobby?.error?.message ?? 'The table did not open.');
      return;
    }

    host.setRoom({ code: lobby.lobby.code, host: config.name, seats: config.maxPlayers });
    this.set({
      phase: 'host-ready',
      room: lobby.lobby.code,
      hostName: config.name,
    });
    await this.holdWakeLock();
    this.watchConnection();

    await this.openRelay(relay, lobby.lobby.code);
  }

  /** Publishes the code. Without it there is no way for guests to find the table. */
  private async openRelay(base: string, room: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    const signaling = new RelayHost(base, room, {
      onChannel: (channel) => {
        host.addChannel(channel);
      },
      onClosed: (reason) => {
        if (this.snapshot.role !== 'host' || this.snapshot.phase === 'idle') return;
        this.fail(reason);
      },
    });
    this.relayHost = signaling;
    try {
      const code = await signaling.start();
      if (this.host !== host) {
        signaling.close();
        return;
      }
      this.set({ relayCode: code, relayLink: relayJoinUrl(code) });
    } catch (error) {
      signaling.close();
      this.relayHost = null;
      if (this.host !== host) return;
      const detail = error instanceof Error ? error.message : String(error);
      this.fail(detail);
    }
  }

  // ----- guest --------------------------------------------------------------

  /** Reads `#code=` from the current URL. */
  loadInviteFromUrl(): boolean {
    const code = readRelayCode(window.location.href);
    if (!code) return false;
    return this.previewCode(code);
  }

  /** A four-letter code, no payload to decode. */
  previewCode(input: string): boolean {
    this.teardown();
    const code = input.trim().toUpperCase();
    if (!isRelayCode(code)) {
      this.set({ ...INITIAL, phase: 'error', error: 'Codes are four letters. Check it and try again.' });
      return false;
    }
    this.set({ ...INITIAL, role: 'guest', phase: 'guest-preview', relayCode: code });
    return true;
  }

  async joinAsGuest(name: string): Promise<void> {
    const base = relayBaseUrl();
    const code = this.snapshot.relayCode;
    if (!base || !code) {
      this.fail('Multiplayer needs the relay, and this build has none configured.');
      return;
    }
    this.set({ phase: 'guest-answering', error: null });
    const guest = new RelayGuest(base, code, {
      onFail: (reason) => {
        if (this.snapshot.role !== 'guest') return;
        if (this.snapshot.phase === 'connected') return;
        this.fail(reason);
      },
    });
    this.relayGuest = guest;

    // Attach first: the welcome and the first view can arrive the moment the
    // channel opens, and a client that attaches later misses them.
    onlineClient.attachTransport(() => guest.socket());
    activateOnline();
    guest.connect();

    const ready = await waitFor(
      onlineClient,
      (snapshot) =>
        snapshot.ready ||
        snapshot.mismatch ||
        snapshot.link === 'closed' ||
        this.snapshot.phase === 'error',
      GUEST_TIMEOUT_MS,
    );
    if (this.relayGuest !== guest || this.snapshot.phase === 'error') return;
    if (!ready?.ready) {
      this.fail('The table did not answer. Ask the host for a new code.');
      return;
    }
    const room = guest.room();
    if (!room) {
      this.fail('The host did not send a room code.');
      return;
    }
    onlineClient.joinRoom(room, name);
    const seated = await waitFor(onlineClient, (snapshot) => snapshot.lobby !== null || snapshot.game !== null || snapshot.error !== null);
    if (this.relayGuest !== guest) return;
    if (!seated?.lobby && !seated?.game) {
      this.fail(seated?.error?.message ?? 'The table did not seat you. It may be full or already started.');
      return;
    }
    this.set({ phase: 'connected', room });
    this.clearUrlCode();
    this.watchConnection();
  }

  // ----- shared -------------------------------------------------------------

  /** Back to the in-tab bot game. */
  leave(): void {
    const wasPeer = this.active;
    this.teardown();
    onlineClient.detachTransport();
    activateLocal();
    if (wasPeer) this.clearUrlCode();
  }

  private fail(reason: string): void {
    this.set({ phase: 'error', error: reason });
  }

  private clearUrlCode(): void {
    try {
      const url = new URL(window.location.href);
      url.hash = '';
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    } catch {
      // History is unavailable in some embedded views; harmless.
    }
  }

  private watchConnection(): void {
    this.watchLink?.();
    const unsubscribe = onlineClient.subscribe(() => {
      if (this.snapshot.role === 'idle') return;
      if (onlineClient.getSnapshot().link === 'closed') {
        this.fail('The connection ended. Start a new table.');
      }
    });
    this.watchLink = unsubscribe;
  }

  /**
   * Phone nicety: keep the screen awake while this tab is the table. Failure is
   * expected on browsers without the API and on battery saver; hosts can still
   * play, they just have to avoid locking the screen.
   */
  private async holdWakeLock(): Promise<void> {
    const wake = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } }).wakeLock;
    if (!wake) return;
    try {
      this.wakeLock = await wake.request('screen');
    } catch {
      return;
    }
    document.addEventListener('visibilitychange', this.reacquireWakeLock);
  }

  private reacquireWakeLock = (): void => {
    if (document.visibilityState !== 'visible' || this.snapshot.role !== 'host') return;
    void this.holdWakeLock();
  };

  private teardown(): void {
    this.watchLink?.();
    this.watchLink = null;
    this.relayHost?.close();
    this.relayHost = null;
    this.relayGuest?.close();
    this.relayGuest = null;
    this.host?.dispose();
    this.host = null;
    document.removeEventListener('visibilitychange', this.reacquireWakeLock);
    try {
      void this.wakeLock?.release();
    } catch {
      // already released
    }
    this.wakeLock = null;
    this.snapshot = { ...INITIAL };
    for (const listener of this.listeners) listener();
  }
}

export const peer = new PeerSession();

// Dev-only handle, same idea as __lorac in socket.ts: lets a browser console or
// a QA script read the peer state machine.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __loracPeer?: PeerSession }).__loracPeer = peer;
}

export type { HostRoomConfig };
