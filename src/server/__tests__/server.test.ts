/**
 * Server integration tests: a real HTTP server on an ephemeral port, a real
 * WebSocket client, the real engine, and the real bot stub.
 *
 * Nothing here asserts which move a bot picks, only that turns make progress
 * and that each human sees only their own hand.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { cloneState } from '@shared/engine/index';
import type { GameAction, GameView } from '@shared/types';
import type { ClientMessage, ServerMessage } from '@shared/protocol';
import { startServer } from '../index.js';
import type { RunningServer } from '../index.js';

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

interface Waiter {
  test: (message: ServerMessage) => boolean;
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Minimal client that can await the next message of a given type. */
class TestClient {
  readonly socket: WebSocket;
  readonly messages: ServerMessage[] = [];
  private readonly queues = new Map<string, ServerMessage[]>();
  private waiters: Waiter[] = [];
  private open = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }
      this.messages.push(parsed);
      const index = this.waiters.findIndex((waiter) => waiter.test(parsed));
      if (index >= 0) {
        const waiter = this.waiters[index];
        this.waiters.splice(index, 1);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(parsed);
        }
        return;
      }
      const queue = this.queues.get(parsed.type) ?? [];
      queue.push(parsed);
      this.queues.set(parsed.type, queue);
    });
    this.socket.on('close', () => {
      this.open = false;
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('socket closed before the expected message'));
      }
    });
  }

  static connect(url: string): Promise<TestClient> {
    const client = new TestClient(url);
    return new Promise((resolve, reject) => {
      client.socket.once('open', () => {
        client.open = true;
        resolve(client);
      });
      client.socket.once('error', reject);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  /** Resolves with the first message of `type` that `predicate` accepts. */
  waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: MessageOf<T>) => boolean = () => true,
    timeoutMs = 8_000,
  ): Promise<MessageOf<T>> {
    const test = (message: ServerMessage): message is MessageOf<T> =>
      message.type === type && predicate(message as MessageOf<T>);

    const queue = this.queues.get(type) ?? [];
    const index = queue.findIndex((message) => test(message));
    if (index >= 0) {
      const [found] = queue.splice(index, 1);
      if (found) return Promise.resolve(found as MessageOf<T>);
    }

    return new Promise<MessageOf<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (pending >= 0) this.waiters.splice(pending, 1);
        const seen = [...new Set(this.messages.map((message) => message.type))].join(', ');
        reject(new Error(`timed out waiting for ${type}; saw: ${seen || 'nothing'}`));
      }, timeoutMs);
      this.waiters.push({
        test,
        resolve: (message) => resolve(message as MessageOf<T>),
        reject,
        timer,
      });
    });
  }

  /** Newest message of a type ever received, ignoring the pending queue. */
  latest<T extends ServerMessage['type']>(type: T): MessageOf<T> | null {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const message = this.messages[i];
      if (message && message.type === type) return message as MessageOf<T>;
    }
    return null;
  }

  /** Drops buffered messages so the next waitFor only sees fresh frames. */
  drain(type: ServerMessage['type']): void {
    this.queues.delete(type);
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      this.socket.once('close', done);
      this.socket.close();
      setTimeout(done, 1_000);
    });
  }
}

let running: RunningServer;
let wsUrl: string;
const clients: TestClient[] = [];

async function connectClient(): Promise<TestClient> {
  const client = await TestClient.connect(wsUrl);
  clients.push(client);
  return client;
}

async function getJson(
  pathname: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${running.port}${pathname}`);
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

type SetupAction = Extract<GameAction, { type: 'setupSettlement' | 'setupRoad' }>;

/** Picks the setup move from the view's own legal moves. */
function setupMove(view: GameView): SetupAction | null {
  const vertex = view.legal.setupSettlements[0];
  if (vertex) return { type: 'setupSettlement', vertex };
  const edge = view.legal.setupRoads[0];
  if (edge) return { type: 'setupRoad', edge };
  return null;
}

/**
 * Waits for a strictly newer view. Bots act on their own timers, so the next
 * frame after our action may belong to another seat; matching on version keeps
 * the helpers from mistaking a bot update for the answer to our own action.
 */
async function nextView(client: TestClient, previous: GameView): Promise<GameView> {
  return (await client.waitFor('game', (message) => message.view.version > previous.version, 12_000)).view;
}

/** One client's whole setup draft, driven from the wire. */
async function draft(client: TestClient, first: GameView): Promise<GameView> {
  let view = first;
  for (let step = 0; step < 80; step += 1) {
    if (view.phase !== 'setup') return view;
    if (view.currentSeat === view.you) {
      const action = setupMove(view);
      if (!action) throw new Error(`no setup move for seat ${view.you}`);
      client.send({ type: 'action', action, seq: step });
    }
    view = await nextView(client, view);
  }
  throw new Error('setup did not finish over the wire');
}

/** Roll, resolve a seven if one shows up, then end the turn. */
async function playTurn(client: TestClient, first: GameView): Promise<GameView> {
  let view = first;
  for (let step = 0; step < 20; step += 1) {
    if (!view.legal.isTurn) {
      view = await nextView(client, view);
      continue;
    }
    if (view.legal.canRoll) {
      client.send({ type: 'action', action: { type: 'roll' } });
    } else if (view.legal.discard) {
      const resources: Record<string, number> = {};
      let left = view.legal.discard.required;
      const me = view.players[view.you];
      if (me) {
        for (const resource of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) {
          if (left <= 0) break;
          const take = Math.min(left, me.resources[resource]);
          if (take > 0) {
            resources[resource] = take;
            left -= take;
          }
        }
      }
      client.send({
        type: 'action',
        action: { type: 'discard', resources: resources as never },
      });
    } else if (view.legal.robber) {
      const hex = view.legal.robber.hexes[0];
      if (!hex) throw new Error('robber with no legal hex');
      const victim = view.legal.robber.victims[hex]?.[0];
      client.send({
        type: 'action',
        action:
          victim === undefined
            ? { type: 'moveRobber', hex }
            : { type: 'moveRobber', hex, victimSeat: victim },
      });
    } else if (view.legal.canEndTurn) {
      client.send({ type: 'action', action: { type: 'endTurn' } });
      return await nextView(client, view);
    } else {
      throw new Error(`nothing to do in phase ${view.phase}`);
    }
    view = await nextView(client, view);
  }
  throw new Error('turn did not finish over the wire');
}

beforeAll(async () => {
  running = await startServer({
    port: 0,
    host: '127.0.0.1',
    quiet: true,
    managerOptions: {
      // The spec range is 400-900ms. Tests shrink it so a bot turn lands fast.
      botDelayMs: [2, 8],
      takeoverMs: 150,
      log: () => {},
    },
  });
  wsUrl = `ws://127.0.0.1:${running.port}/ws`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

afterAll(async () => {
  await running.close();
});

describe('http surface', () => {
  it('serves health with room and game counts', async () => {
    const { status, body } = await getJson('/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe('days-of-lorac');
    expect(body.wsPath).toBe('/ws');
    expect(typeof body.rooms).toBe('number');
    expect(typeof body.games).toBe('number');
    expect(typeof body.wsClients).toBe('number');
  });

  it('answers share links for known rooms and 404 JSON for the rest', async () => {
    const host = await connectClient();
    host.send({ type: 'createRoom', name: 'Ada', maxPlayers: 3, difficulty: 'normal' });
    const lobby = await host.waitFor('lobby');
    const code = lobby.room.code;

    const found = await getJson(`/api/rooms/${code}`);
    expect(found.status).toBe(200);
    const room = found.body.room as Record<string, unknown>;
    expect(room.status).toBe('lobby');
    expect(found.body.canJoin).toBe(true);
    expect(JSON.stringify(found.body)).not.toContain(lobby.token);

    const missing = await getJson('/api/rooms/ZZZZ');
    expect(missing.status).toBe(404);
    expect(missing.body.ok).toBe(false);

    expect((await getJson('/api/rooms/abc')).status).toBe(404);
    expect((await getJson('/api/nope')).status).toBe(404);
  });
});

describe('quickPlay over the wire', () => {
  it('drafts, filters hands per seat, and completes a bot turn', async () => {
    const client = await connectClient();
    client.send({ type: 'quickPlay', name: 'Ada', seats: 2, difficulty: 'normal' });

    const welcome = await client.waitFor('welcome');
    expect(typeof welcome.version).toBe('string');
    expect(welcome.connectionId).toMatch(/^c\d+$/);

    const game = await client.waitFor('game');
    expect(game.you).toBe(0);
    expect(game.roomCode).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(game.view.players).toHaveLength(2);
    expect(game.view.players[1]?.isBot).toBe(true);

    const afterDraft = await draft(client, game.view);
    expect(afterDraft.phase).toBe('roll');
    expect(afterDraft.players[0]?.hand).toHaveLength(5);
    expect(afterDraft.players[1]?.hand).toBeNull();
    expect(afterDraft.players[1]?.handCount).toBe(5);

    // The seeded first seat can be the bot, so wait until the human is up.
    const myTurn =
      afterDraft.currentSeat === 0
        ? afterDraft
        : (
            await client.waitFor(
              'game',
              (message) => message.view.currentSeat === 0 && message.view.legal.canRoll,
              15_000,
            )
          ).view;
    expect(myTurn.legal.canRoll).toBe(true);
    const afterMyTurn = await playTurn(client, myTurn);
    expect(afterMyTurn.currentSeat).toBe(1);
    const versionAfterMyTurn = afterMyTurn.version;

    // The bot's whole turn, with no further input from the human.
    const botDone = await client.waitFor(
      'game',
      (message) => message.view.currentSeat === 0 && message.view.turn >= 3,
      15_000,
    );
    expect(botDone.view.version).toBeGreaterThan(versionAfterMyTurn);
    expect(botDone.view.phase).toBe('roll');
    expect(botDone.view.legal.canRoll).toBe(true);
    expect(botDone.view.players[1]?.hand).toBeNull();
    expect(botDone.view.players[0]?.hand).not.toBeNull();
    expect(botDone.token).toBe(game.token);
  }, 25_000);
});

describe('create, join, start', () => {
  it('drives a lobby, filters views, and routes errors to one socket', async () => {
    const alpha = await connectClient();
    const beta = await connectClient();

    alpha.send({ type: 'createRoom', name: 'Ada', maxPlayers: 3, difficulty: 'normal' });
    const hostLobby = await alpha.waitFor('lobby');
    const code = hostLobby.room.code;
    const hostToken = hostLobby.token;
    expect(hostLobby.room.hostSeat).toBe(0);

    beta.send({ type: 'joinRoom', code: code.toLowerCase(), name: 'Bo' });
    const guestLobby = await beta.waitFor('lobby');
    expect(guestLobby.you).toBe(1);
    expect(guestLobby.token).not.toBe(hostToken);

    const both = await alpha.waitFor('lobby', (message) => message.room.players.length === 2);
    expect(both.room.players.map((player) => player.name)).toEqual(['Ada', 'Bo']);
    expect(both.room.players[0]?.host).toBe(true);

    alpha.send({ type: 'addBot', difficulty: 'easy' });
    const withBot = await alpha.waitFor('lobby', (message) => message.room.players.length === 3);
    expect(withBot.room.players[2]?.isBot).toBe(true);

    beta.send({ type: 'startGame' });
    expect((await beta.waitFor('error')).code).toBe('NOT_HOST');

    alpha.send({ type: 'startGame' });
    const hostGame = await alpha.waitFor('game');
    const guestGame = await beta.waitFor('game');
    expect(hostGame.you).toBe(0);
    expect(guestGame.you).toBe(1);
    expect(hostGame.view.players).toHaveLength(3);
    expect(hostGame.view.legal.seat).toBe(0);
    expect(guestGame.view.legal.seat).toBe(1);
    expect(hostGame.view.players[0]?.hand).toEqual([]);
    expect(guestGame.view.players[0]?.hand).toBeNull();
    expect(hostGame.token).toBe(hostToken);

    // Out of turn: only the sender hears about it. The seeded first seat can be
    // the bot, so use the newest view (never a buffered older frame) and wait
    // for a strictly newer one when the host is not up yet.
    // Drive the draft until the host is up. Bots act on their own timers and
    // the guest also has picks, so read the newest view each round instead of
    // assuming a single frame moves the turn to the host. `isTurn` covers both
    // the settlement step and its paired road step.
    let hostView = alpha.latest('game')?.view ?? hostGame.view;
    for (let step = 0; step < 24 && !hostView.legal.isTurn; step += 1) {
      if (hostView.currentSeat === guestGame.you) {
        // The guest's socket can be a frame behind the host's. Catch it up
        // before deciding whether the guest can act, or both sides wait.
        let guestView = beta.latest('game')?.view ?? guestGame.view;
        if (guestView.version < hostView.version) {
          guestView = (
            await beta.waitFor('game', (message) => message.view.version >= hostView.version, 8_000)
          ).view;
        }
        if (guestView.legal.isTurn) {
          const guestMove = setupMove(guestView);
          if (guestMove) beta.send({ type: 'action', action: guestMove, seq: 200 + step });
        }
      }
      hostView = await nextView(alpha, hostView);
    }
    const hostAction = setupMove(hostView);
    if (!hostAction) throw new Error('no setup move for the host');
    const versionBefore = hostView.version;
    beta.send({ type: 'action', action: hostAction, seq: 3 });
    const error = await beta.waitFor('error');
    expect(error.code).toBe('NOT_YOUR_TURN');
    expect(error.seq).toBe(3);

    // In turn: both humans get a fresh view at the new version. Drop buffered
    // frames so a stale draft view cannot satisfy the wait.
    alpha.drain('game');
    beta.drain('game');
    alpha.send({ type: 'action', action: hostAction, seq: 4 });
    const hostNext = await alpha.waitFor('game', (message) => message.view.version > versionBefore);
    const guestNext = await beta.waitFor('game', (message) => message.view.version > versionBefore);
    expect(hostNext.view.version).toBeGreaterThan(versionBefore);
    expect(guestNext.view.version).toBe(hostNext.view.version);
    expect(hostNext.view.legal.seat).toBe(0);
    expect(guestNext.view.legal.seat).toBe(1);
    if (hostAction.type === 'setupSettlement') {
      expect(hostNext.view.buildings[hostAction.vertex]).toEqual({ owner: 0, type: 'settlement' });
      expect(guestNext.view.buildings[hostAction.vertex]).toEqual({ owner: 0, type: 'settlement' });
    } else {
      expect(hostNext.view.roads[hostAction.edge]).toBe(0);
      expect(guestNext.view.roads[hostAction.edge]).toBe(0);
    }

    const started = await getJson(`/api/rooms/${code}`);
    expect(started.status).toBe(200);
    expect((started.body.room as Record<string, unknown>).status).toBe('playing');
    expect(started.body.canJoin).toBe(false);
  }, 15_000);

  it('never leaks another seat token through the wire', async () => {
    const alpha = await connectClient();
    const beta = await connectClient();
    alpha.send({ type: 'createRoom', name: 'Ada', maxPlayers: 2, difficulty: 'normal' });
    const hostLobby = await alpha.waitFor('lobby');
    beta.send({ type: 'joinRoom', code: hostLobby.room.code, name: 'Bo' });
    const guestLobby = await beta.waitFor('lobby');
    alpha.send({ type: 'startGame' });
    const hostGame = await alpha.waitFor('game');
    const guestGame = await beta.waitFor('game');

    expect(hostGame.token).toBe(hostLobby.token);
    expect(guestGame.token).toBe(guestLobby.token);
    expect(hostGame.token).not.toBe(guestGame.token);
    expect(JSON.stringify(hostGame)).not.toContain(guestGame.token);
    expect(JSON.stringify(guestGame)).not.toContain(hostGame.token);
  }, 10_000);
});

describe('map settings over the wire', () => {
  it('carries the host island choice into the game view', async () => {
    const host = await connectClient();
    const guest = await connectClient();

    host.send({
      type: 'createRoom',
      name: 'Ada',
      maxPlayers: 2,
      difficulty: 'normal',
      map: { size: 'compact', terrain: 'balanced', tokens: 'shuffled' },
    });
    const lobby = await host.waitFor('lobby');
    expect(lobby.room.config.map).toEqual({
      size: 'compact',
      terrain: 'balanced',
      tokens: 'shuffled',
    });
    const code = lobby.room.code;

    guest.send({ type: 'joinRoom', code, name: 'Bo' });
    await guest.waitFor('lobby');

    guest.send({ type: 'setMapSettings', map: { size: 'grand', terrain: 'fixed', tokens: 'fixed' } });
    expect((await guest.waitFor('error')).code).toBe('NOT_HOST');

    host.send({ type: 'setMapSettings', map: { size: 'grand', terrain: 'fixed', tokens: 'fixed' } });
    const changed = await host.waitFor('lobby', (message) => message.room.config.map.size === 'grand');
    expect(changed.room.config.map).toEqual({ size: 'grand', terrain: 'fixed', tokens: 'fixed' });

    guest.send({ type: 'setReady', ready: true });
    await host.waitFor('lobby', (message) =>
      message.room.players.some((player) => player.seat === 1 && player.ready),
    );
    host.send({ type: 'startGame' });
    const game = await host.waitFor('game');
    expect(game.view.config.map).toEqual({ size: 'grand', terrain: 'fixed', tokens: 'fixed' });
    expect(game.view.board.hexes).toHaveLength(37);
    const robber = game.view.board.hexes.find((hex) => hex.id === game.view.robberHex);
    expect(robber?.terrain).toBe('desert');
  });

  it('rejects a malformed map before touching a room', async () => {
    const host = await connectClient();
    host.send({
      type: 'createRoom',
      name: 'Ada',
      maxPlayers: 2,
      difficulty: 'normal',
      map: { size: 'huge' },
    } as unknown as ClientMessage);
    expect((await host.waitFor('error')).code).toBe('BAD_MESSAGE');

    host.send({ type: 'quickPlay', name: 'Ada', seats: 2, difficulty: 'normal', map: {} } as unknown as ClientMessage);
    expect((await host.waitFor('error')).code).toBe('BAD_MESSAGE');
  });
});

describe('robustness', () => {
  it('survives malformed JSON, unknown types, and rate limiting', async () => {
    const client = await connectClient();

    client.sendRaw('this is not json');
    expect((await client.waitFor('error')).code).toBe('BAD_MESSAGE');

    client.send({ type: 'totallyUnknown' } as unknown as ClientMessage);
    expect((await client.waitFor('error')).code).toBe('BAD_MESSAGE');

    client.send({ type: 'action' } as unknown as ClientMessage);
    expect((await client.waitFor('error')).code).toBe('BAD_MESSAGE');

    for (let index = 0; index < 60; index += 1) client.send({ type: 'ping', t: index });
    const limited = await client.waitFor('error', (message) => message.code === 'RATE_LIMITED');
    expect(limited.code).toBe('RATE_LIMITED');

    const health = await getJson('/api/health');
    expect(health.status).toBe(200);
  }, 15_000);

  it('answers ping with pong and the original timestamp', async () => {
    const client = await connectClient();
    client.send({ type: 'ping', t: 1234 });
    const pong = await client.waitFor('pong');
    expect(pong.t).toBe(1234);
    expect(typeof pong.serverTime).toBe('number');
  });
});

describe('reconnect', () => {
  it('keeps the seat, shows the disconnect, and restores the view on resume', async () => {
    const alpha = await connectClient();
    const beta = await connectClient();

    alpha.send({ type: 'createRoom', name: 'Ada', maxPlayers: 2, difficulty: 'normal' });
    const hostLobby = await alpha.waitFor('lobby');
    const code = hostLobby.room.code;
    beta.send({ type: 'joinRoom', code, name: 'Bo' });
    const guestLobby = await beta.waitFor('lobby');
    alpha.send({ type: 'startGame' });
    await alpha.waitFor('game');
    await beta.waitFor('game');

    await beta.close();
    const dropped = await alpha.waitFor(
      'game',
      (message) => message.view.players[1]?.connected === false,
    );
    expect(dropped.view.players[1]?.hand).toBeNull();

    const resumed = await connectClient();
    resumed.send({ type: 'resume', code, token: guestLobby.token });
    const resumedGame = await resumed.waitFor('game');
    expect(resumedGame.you).toBe(1);
    expect(resumedGame.token).toBe(guestLobby.token);
    expect(resumedGame.view.players[1]?.connected).toBe(true);
    expect(resumedGame.view.phase).toBe('setup');
    expect(resumedGame.view.players[1]?.hand).not.toBeNull();

    await alpha.waitFor('game', (message) => message.view.players[1]?.connected === true);

    // Resuming with a bad token is refused without closing the socket.
    const probe = await connectClient();
    probe.send({ type: 'resume', code, token: 'wrong-token-wrong-token' });
    expect((await probe.waitFor('error')).code).toBe('INVALID_ROOM');
    expect(probe.isOpen).toBe(true);
  }, 20_000);
});

describe('rematch', () => {
  it('starts a fresh game for the same table after game over', async () => {
    const client = await connectClient();
    client.send({ type: 'quickPlay', name: 'Ada', seats: 2, difficulty: 'normal' });
    const first = await client.waitFor('game');
    const code = first.roomCode;

    const room = running.manager.getRoom(code);
    expect(room).toBeDefined();
    if (!room?.state) throw new Error('room has no game');
    const finished = cloneState(room.state);
    finished.phase = 'gameOver';
    finished.winner = 0;
    room.state = finished;
    room.status = 'finished';

    client.send({ type: 'rematch' });
    const rematch = await client.waitFor('game');
    expect(rematch.view.phase).toBe('setup');
    expect(rematch.view.version).toBe(0);
    expect(rematch.view.gameId).not.toBe(first.view.gameId);
    expect(rematch.view.config).toEqual({ ...first.view.config });
    expect(rematch.view.players.map((player) => player.name)).toEqual(
      first.view.players.map((player) => player.name),
    );
    expect(rematch.token).toBe(first.token);

    const info = await getJson(`/api/rooms/${code}`);
    expect((info.body.room as Record<string, unknown>).status).toBe('playing');
  }, 15_000);
});
