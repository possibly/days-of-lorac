/**
 * Peer session: the small state machine behind the peer screens.
 *
 * Host: spin up the in-tab server, become its first client, create a room, then
 * take guests. Guests arrive one of two ways, and the session owns both:
 *
 *   relay  - four-letter code through the Cloudflare relay (default when a
 *            relay URL is configured), no copy and paste at all;
 *   direct - an invite link or QR one way, a reply code back, which needs no
 *            service anywhere.
 *
 * Everything the UI needs is in one external store so screens do not have to
 * thread callbacks around. React binding lives in `usePeer.ts`.
 */
import { isRelayCode } from '@shared/relay';
import type { ClientSnapshot } from '../socket';
import { onlineClient, activateOffline, activateOnline, OFFLINE_MODE } from '../store';
import type { GameStore } from '../store';
import { PeerGuest } from './guest';
import { PeerHost } from './host';
import type { HostInvite, HostRoomConfig } from './host';
import {
  RelayGuest,
  RelayHost,
  readRelayCode,
  relayBaseUrl,
  relayJoinUrl,
} from './relay';
import { readHashCode, HASH_KEY } from './signaling';

export type PeerRole = 'idle' | 'host' | 'guest';
export type PeerPhase =
  | 'idle'
  | 'host-starting'
  | 'host-ready'
  | 'guest-preview'
  | 'guest-answering'
  | 'guest-waiting'
  | 'connected'
  | 'error';

/** How guests are being invited: through the relay, or by hand. */
export type PeerMode = 'relay' | 'manual';

export interface PeerSnapshot {
  role: PeerRole;
  phase: PeerPhase;
  mode: PeerMode | null;
  /** True when this build has a relay URL, so codes are possible. */
  relayAvailable: boolean;
  /** The four-letter code guests type, when relaying. */
  relayCode: string | null;
  relayLink: string | null;
  /** Room code inside the host tab, once one exists. */
  room: string | null;
  hostName: string | null;
  seats: 2 | 3 | 4;
  invites: HostInvite[];
  /** Direct mode, guest side: the reply to hand back to the host. */
  answer: { code: string; link: string } | null;
  error: string | null;
}

const INITIAL: PeerSnapshot = {
  role: 'idle',
  phase: 'idle',
  mode: null,
  relayAvailable: relayBaseUrl() !== null,
  relayCode: null,
  relayLink: null,
  room: null,
  hostName: null,
  seats: 4,
  invites: [],
  answer: null,
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
  private guest: PeerGuest | null = null;
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
    const host = new PeerHost();
    this.host = host;
    this.set({ ...INITIAL, role: 'host', phase: 'host-starting', seats: config.maxPlayers });
    host.onInviteChange(() => this.set({ invites: host.invites() }));

    // Attach the transport before switching the store, or the client would
    // first try to reach the page's own origin.
    host.attach(onlineClient);
    activateOnline();

    const ready = await waitFor(onlineClient, (snapshot) => snapshot.ready || snapshot.mismatch);
    if (!ready?.ready) {
      this.fail('This browser could not start the table. Reload and try again.');
      return;
    }

    onlineClient.createRoom(config.name, config.maxPlayers, config.difficulty, config.map);
    const lobby = await waitFor(onlineClient, (snapshot) => snapshot.lobby !== null || snapshot.error !== null);
    if (!lobby?.lobby) {
      this.fail(lobby?.error?.message ?? 'The table did not open.');
      return;
    }

    host.setRoom({ code: lobby.lobby.code, host: config.name, seats: config.maxPlayers });
    const relay = relayBaseUrl();
    this.set({
      phase: 'host-ready',
      room: lobby.lobby.code,
      hostName: config.name,
      mode: relay ? 'relay' : 'manual',
    });
    await this.holdWakeLock();
    this.watchConnection();

    if (!relay) return;
    await this.openRelay(relay, lobby.lobby.code);
  }

  /**
   * Opens the relay room and publishes the code. A relay that will not start is
   * not fatal: the host keeps the table and falls back to direct invites.
   */
  private async openRelay(base: string, room: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    const signaling = new RelayHost(base, room, {
      onChannel: (channel) => {
        host.addChannel(channel);
      },
      onGuestLeft: () => {
        this.set({ invites: host.invites() });
      },
      onClosed: (reason) => {
        if (this.snapshot.role !== 'host' || this.snapshot.phase === 'idle') return;
        this.set({ error: `${reason} Direct invites still work.` });
      },
    });
    this.relayHost = signaling;
    try {
      const code = await signaling.start();
      this.set({ relayCode: code, relayLink: relayJoinUrl(code), invites: [] });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.set({
        mode: 'manual',
        relayCode: null,
        relayLink: null,
        error: `${detail} Falling back to direct invites.`,
      });
    }
  }

  /** Give up on the relay and use link and reply codes instead. */
  useDirectInvites(): void {
    this.relayHost?.stopSignaling();
    this.relayHost = null;
    this.set({ mode: 'manual', relayCode: null, relayLink: null, error: null, invites: [] });
  }

  async newInvite(): Promise<HostInvite | null> {
    const host = this.host;
    if (!host) return null;
    if (this.snapshot.mode !== 'manual') return null;
    // Only one offer is on screen at a time, so an older waiting one is dead
    // weight: drop it before making the next, rather than leaving a peer
    // connection around that nobody can answer any more.
    for (const invite of host.invites()) {
      if (!invite.connected) host.dropInvite(invite.id);
    }
    try {
      const invite = await host.createInvite();
      this.set({ invites: host.invites() });
      return invite;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.fail(`Could not make an invite: ${detail}`);
      return null;
    }
  }

  async acceptReply(input: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const host = this.host;
    if (!host) return { ok: false, reason: 'No table is open.' };
    const result = await host.acceptAnswer(input);
    if (!result.ok) this.set({ error: result.reason });
    else this.set({ error: null });
    return result;
  }

  dropInvite(id: string): void {
    this.host?.dropInvite(id);
    this.set({ invites: this.host?.invites() ?? [] });
  }

  // ----- guest --------------------------------------------------------------

  /** Reads `#code=` or `#join=` from the current URL. */
  async loadInviteFromUrl(): Promise<boolean> {
    const code = readRelayCode(window.location.href);
    if (code) return this.previewCode(code);
    const invite = readHashCode(window.location.href, HASH_KEY);
    if (!invite) return false;
    return this.previewInvite(invite);
  }

  /** Relay mode: a four-letter code, no payload to decode. */
  previewCode(input: string): boolean {
    this.teardown();
    const code = input.trim().toUpperCase();
    if (!isRelayCode(code)) {
      this.set({ ...INITIAL, phase: 'error', error: 'Codes are four letters. Check it and try again.' });
      return false;
    }
    this.set({ ...INITIAL, role: 'guest', phase: 'guest-preview', mode: 'relay', relayCode: code });
    return true;
  }

  /** Direct mode: an invite link or code with the offer inside it. */
  async previewInvite(input: string): Promise<boolean> {
    this.teardown();
    const guest = new PeerGuest();
    this.guest = guest;
    const offer = await guest.readOffer(input);
    if (!offer) {
      this.set({ ...INITIAL, phase: 'error', error: 'That invite is not valid. Ask the host for a fresh link.' });
      return false;
    }
    this.set({
      role: 'guest',
      phase: 'guest-preview',
      mode: 'manual',
      room: offer.room,
      hostName: offer.host,
      seats: offer.seats,
      invites: [],
      answer: null,
      error: null,
    });
    return true;
  }

  async joinAsGuest(name: string): Promise<void> {
    if (this.snapshot.mode === 'relay') {
      await this.joinViaRelay(name);
      return;
    }
    await this.joinViaDirect(name);
  }

  private async joinViaRelay(name: string): Promise<void> {
    const base = relayBaseUrl();
    const code = this.snapshot.relayCode;
    if (!base || !code) {
      this.fail('No relay is configured for this build.');
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
    if (this.snapshot.phase === 'error') return;
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
    if (!seated?.lobby && !seated?.game) {
      this.fail(seated?.error?.message ?? 'The table did not seat you. It may be full or already started.');
      return;
    }
    this.set({ phase: 'connected', room });
    this.clearUrlCode();
    this.watchConnection();
  }

  private async joinViaDirect(name: string): Promise<void> {
    const guest = this.guest;
    const offer = guest?.offer;
    if (!guest || !offer) {
      this.fail('That invite is no longer loaded.');
      return;
    }
    this.set({ phase: 'guest-answering', error: null });

    let answer: { code: string; link: string };
    try {
      answer = await guest.answer(offer);
      this.set({ answer, phase: 'guest-waiting' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[peer] answer failed: ${detail}`);
      this.fail(`The browser could not build a reply: ${detail}`);
      return;
    }
    if (!answer.code) return;

    // Attach before the host has pasted the reply: the channel, the welcome and
    // the first view can all arrive in one burst, and a client that attaches
    // afterwards would miss the welcome.
    onlineClient.attachTransport(() => guest.socket());
    activateOnline();
    this.clearUrlCode();

    const ready = await waitFor(
      onlineClient,
      (snapshot) => snapshot.ready || snapshot.mismatch || snapshot.link === 'closed',
    );
    if (!ready?.ready) {
      this.fail('The host never connected. Ask for a new invite.');
      return;
    }
    onlineClient.joinRoom(offer.room, name);
    const seated = await waitFor(onlineClient, (snapshot) => snapshot.lobby !== null || snapshot.game !== null || snapshot.error !== null);
    if (!seated?.lobby && !seated?.game) {
      this.fail(seated?.error?.message ?? 'The table did not seat you. It may be full or already started.');
      return;
    }
    this.set({ phase: 'connected' });
    this.watchConnection();
  }

  // ----- shared -------------------------------------------------------------

  /** Back to whatever the build does without peers. */
  leave(): void {
    const wasPeer = this.active;
    this.teardown();
    onlineClient.detachTransport();
    if (OFFLINE_MODE) activateOffline();
    else activateOnline();
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
    this.guest?.dispose();
    this.guest = null;
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

export type { HostInvite, HostRoomConfig };
