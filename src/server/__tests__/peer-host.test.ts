/**
 * The host tab without a browser: a real RoomManager, the browser-safe router,
 * and the in-memory loopback that stands in for the host's own seat.
 *
 * This is the wiring `src/client/net/peer/host.ts` uses, minus WebRTC. If the
 * manager, the router, or the loopback ordering regresses, a peer game breaks
 * in a way that is hard to debug in a browser.
 */
import { describe, expect, it } from 'vitest';
import { GAME_VERSION } from '@shared/version';
import type { ClientMessage, ServerMessage } from '@shared/protocol';
import { RoomManager } from '../room-manager.js';
import { routeClientMessage } from '../message-router.js';
import { createLoopback } from '../../client/net/peer/socket-like.js';

interface Peer {
  received: ServerMessage[];
  send(message: ClientMessage): void;
  close(): void;
}

function makePeer(manager: RoomManager, id: string): Peer {
  const pair = createLoopback(id);
  const received: ServerMessage[] = [];
  pair.socket.onmessage = (event) => {
    received.push(JSON.parse(event.data) as ServerMessage);
  };
  pair.onClientMessage = (raw) => {
    routeClientMessage(manager, pair.conn, JSON.parse(raw));
  };
  pair.open();
  pair.conn.send({
    type: 'welcome',
    version: GAME_VERSION,
    connectionId: id,
    serverTime: 0,
  });
  return {
    received,
    send: (message) => pair.socket.send(JSON.stringify(message)),
    close: () => pair.close(),
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/** Polls instead of assuming a fixed number of timer turns under test load. */
async function until(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for a message');
    await tick();
  }
}

function last<T extends ServerMessage['type']>(
  peer: Peer,
  type: T,
): Extract<ServerMessage, { type: T }> | null {
  for (let index = peer.received.length - 1; index >= 0; index -= 1) {
    const message = peer.received[index];
    if (message?.type === type) return message as Extract<ServerMessage, { type: T }>;
  }
  return null;
}

describe('peer host wiring', () => {
  it('runs a room for two loopback clients', async () => {
    const manager = new RoomManager({ log: () => {}, botDelayMs: [0, 0] });
    const host = makePeer(manager, 'host');
    const guest = makePeer(manager, 'guest');

    await until(() => last(host, 'welcome') !== null);
    expect(last(host, 'welcome')?.version).toBe(GAME_VERSION);

    host.send({ type: 'createRoom', name: 'Tyler', maxPlayers: 2, difficulty: 'normal' });
    await until(() => last(host, 'lobby') !== null);
    const created = last(host, 'lobby');
    expect(created?.room.status).toBe('lobby');
    const code = created?.room.code;
    expect(code).toMatch(/^[A-Z]{4}$/);

    guest.send({ type: 'joinRoom', code: code ?? '', name: 'Guest' });
    await until(() => last(guest, 'lobby') !== null);
    const guestLobby = last(guest, 'lobby');
    expect(guestLobby?.room.players.map((player) => player.name)).toEqual(['Tyler', 'Guest']);
    expect(guestLobby?.you).toBe(1);

    guest.send({ type: 'setReady', ready: true });
    await until(() => last(guest, 'lobby')?.room.players[1]?.ready === true);
    host.send({ type: 'startGame' });
    await until(() => last(host, 'game') !== null && last(guest, 'game') !== null);

    const hostGame = last(host, 'game');
    const guestGame = last(guest, 'game');
    expect(hostGame?.view.phase).toBe('setup');
    expect(hostGame?.you).toBe(0);
    expect(guestGame?.you).toBe(1);
    // Each seat gets its own view, so the hidden information stays hidden.
    expect(hostGame?.view.you).toBe(0);
    expect(guestGame?.view.you).toBe(1);
    expect(hostGame?.view.version).toBe(guestGame?.view.version);

    host.close();
    guest.close();
  });

  it('reloads a seat through the reconnect token', async () => {
    const manager = new RoomManager({ log: () => {}, botDelayMs: [0, 0] });
    const host = makePeer(manager, 'host');
    const guest = makePeer(manager, 'guest');

    host.send({ type: 'createRoom', name: 'Tyler', maxPlayers: 2, difficulty: 'normal' });
    await until(() => last(host, 'lobby') !== null);
    const code = last(host, 'lobby')?.room.code ?? '';
    guest.send({ type: 'joinRoom', code, name: 'Guest' });
    await until(() => last(guest, 'lobby') !== null);
    const token = last(guest, 'lobby')?.token;
    expect(token).toBeTruthy();

    // A dropped phone comes back on a new channel with the same token.
    guest.close();
    await tick();
    const back = makePeer(manager, 'guest-again');
    back.send({ type: 'resume', code, token: token ?? '' });
    await until(() => last(back, 'lobby') !== null);
    expect(last(back, 'lobby')?.you).toBe(1);

    host.close();
    back.close();
  });

  it('rebuilds a whole table from a snapshot after a refresh', async () => {
    const first = new RoomManager({ log: () => {}, botDelayMs: [0, 0] });
    const host = makePeer(first, 'host');
    const guest = makePeer(first, 'guest');

    host.send({ type: 'createRoom', name: 'Tyler', maxPlayers: 2, difficulty: 'normal' });
    await until(() => last(host, 'lobby') !== null);
    const code = last(host, 'lobby')?.room.code ?? '';
    guest.send({ type: 'joinRoom', code, name: 'Guest' });
    await until(() => last(guest, 'lobby') !== null);
    guest.send({ type: 'setReady', ready: true });
    await until(() => last(guest, 'lobby')?.room.players[1]?.ready === true);
    host.send({ type: 'startGame' });
    await until(() => last(host, 'game') !== null && last(guest, 'game') !== null);

    const hostToken = last(host, 'game')?.token ?? '';
    const guestToken = last(guest, 'game')?.token ?? '';
    const version = last(host, 'game')?.view.version;
    const snapshot = first.exportRoom(code) ?? '';
    expect(snapshot).not.toBe('');

    // The browser reloaded: brand new process, same localStorage blob.
    const second = new RoomManager({ log: () => {}, botDelayMs: [0, 0] });
    expect(second.restoreRoom(snapshot)).not.toBeNull();

    const hostAgain = makePeer(second, 'host-again');
    hostAgain.send({ type: 'resume', code, token: hostToken });
    await until(() => last(hostAgain, 'game') !== null);
    expect(last(hostAgain, 'game')?.you).toBe(0);
    expect(last(hostAgain, 'game')?.view.version).toBe(version);

    const guestAgain = makePeer(second, 'guest-again');
    guestAgain.send({ type: 'resume', code, token: guestToken });
    await until(() => last(guestAgain, 'game') !== null);
    expect(last(guestAgain, 'game')?.you).toBe(1);
    expect(last(guestAgain, 'game')?.view.version).toBe(version);

    host.close();
    guest.close();
    hostAgain.close();
    guestAgain.close();
  });
});
