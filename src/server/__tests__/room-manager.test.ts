/**
 * Room manager tests. No sockets, no real timers: a recording connection and
 * a hand-driven clock run the real room code and the real engine.
 */
import { describe, expect, it } from 'vitest';
import { cloneState, legalMoves } from '@shared/engine/index';
import type { GameAction, GameView, PartialResources, Seat } from '@shared/types';
import type { ServerMessage } from '@shared/protocol';
import { RoomManager } from '../room-manager.js';
import type { RoomManagerOptions } from '../room-manager.js';
import type { ClientConnection, Clock, Room, TimerHandle } from '../rooms.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CONNECTION_SEQ = { value: 0 };

class FakeClock implements Clock {
  private nowMs = 1_700_000_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void, ms: number): TimerHandle {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.nowMs + Math.max(0, ms), callback });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Runs every timer due inside the window, including ones scheduled by them. */
  advance(ms: number): void {
    const target = this.nowMs + ms;
    for (let guard = 0; guard < 10_000; guard += 1) {
      let nextId: number | null = null;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, timer] of this.timers) {
        if (timer.at > target) continue;
        if (timer.at < nextAt || (timer.at === nextAt && nextId !== null && id < nextId)) {
          nextId = id;
          nextAt = timer.at;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      if (!timer) continue;
      this.nowMs = timer.at;
      timer.callback();
    }
    this.nowMs = target;
  }
}

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

class FakeConn implements ClientConnection {
  readonly id: string;
  messages: ServerMessage[] = [];

  constructor(id?: string) {
    CONNECTION_SEQ.value += 1;
    this.id = id ?? `c${CONNECTION_SEQ.value}`;
  }

  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  ofType<T extends ServerMessage['type']>(type: T): MessageOf<T>[] {
    return this.messages.filter((message): message is MessageOf<T> => message.type === type);
  }

  last<T extends ServerMessage['type']>(type: T): MessageOf<T> | null {
    const all = this.ofType(type);
    return all.length > 0 ? (all[all.length - 1] as MessageOf<T>) : null;
  }

  count(type: ServerMessage['type']): number {
    return this.messages.filter((message) => message.type === type).length;
  }

  clear(): void {
    this.messages = [];
  }
}

function codeFactory(): () => string {
  let next = 0;
  return () => {
    let value = next;
    next += 1;
    let code = '';
    for (let index = 0; index < 4; index += 1) {
      code = CODE_ALPHABET.charAt(value % CODE_ALPHABET.length) + code;
      value = Math.floor(value / CODE_ALPHABET.length);
    }
    return code;
  };
}

function seedFactory(): () => number {
  let next = 0;
  return () => {
    next += 1;
    return 2_000 + next;
  };
}

function makeManager(overrides: RoomManagerOptions = {}): {
  clock: FakeClock;
  manager: RoomManager;
} {
  const clock = new FakeClock();
  const manager = new RoomManager({
    clock,
    botDelayMs: [500, 500],
    log: () => {},
    seed: seedFactory(),
    ...overrides,
    code: overrides.code ?? codeFactory(),
  });
  return { clock, manager };
}

function makeRoom(
  context: { manager: RoomManager; clock: FakeClock },
  options: { seats?: 2 | 3 | 4; humans?: number } = {},
): { code: string; conns: FakeConn[]; tokens: string[] } {
  const seats = options.seats ?? 2;
  const humans = options.humans ?? 1;
  const conns = Array.from({ length: humans }, () => new FakeConn());
  const host = conns[0];
  if (!host) throw new Error('need a host connection');
  context.manager.createRoom(host, { name: 'Ada', maxPlayers: seats, difficulty: 'normal' });
  const lobby = host.last('lobby');
  if (!lobby) throw new Error('no lobby');
  const code = lobby.room.code;
  const tokens = [lobby.token];
  for (let index = 1; index < humans; index += 1) {
    const conn = conns[index];
    if (!conn) throw new Error('missing connection');
    context.manager.joinRoom(conn, { code, name: `Player ${index + 1}` });
    const guestLobby = conn.last('lobby');
    if (!guestLobby) throw new Error('guest got no lobby');
    tokens.push(guestLobby.token);
  }
  return { code, conns, tokens };
}

function stateOf(manager: RoomManager, code: string): Room {
  const room = manager.getRoom(code);
  if (!room) throw new Error(`no room ${code}`);
  return room;
}

/**
 * Setup order starts at the seeded first seat, which may be a bot. Advance the
 * fake clock until a seat the test can act for is current.
 */
function advanceToActor(
  context: { manager: RoomManager; clock: FakeClock },
  code: string,
  actors: Map<Seat, FakeConn>,
): number {
  for (let step = 0; step < 32; step += 1) {
    const state = stateOf(context.manager, code).state;
    if (!state) throw new Error('no state');
    if (state.phase !== 'setup') return state.currentSeat;
    if (actors.has(state.currentSeat)) return state.currentSeat;
    context.clock.advance(600);
  }
  throw new Error('no seat a test can act for became current');
}

function viewOf(conn: FakeConn): GameView {
  const game = conn.last('game');
  if (!game) throw new Error('no game view');
  return game.view;
}

function errorCode(conn: FakeConn): string | null {
  return conn.last('error')?.code ?? null;
}

function setupAction(view: GameView): GameAction | null {
  const legal = view.legal;
  const vertex = legal.setupSettlements[0];
  if (vertex) return { type: 'setupSettlement', vertex };
  const edge = legal.setupRoads[0];
  if (edge) return { type: 'setupRoad', edge };
  return null;
}

function discardPayload(view: GameView): PartialResources {
  const required = view.legal.discard?.required ?? 0;
  const player = view.players[view.you];
  const resources: PartialResources = {};
  let left = required;
  if (!player) return resources;
  for (const resource of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) {
    if (left <= 0) break;
    const take = Math.min(left, player.resources[resource]);
    if (take > 0) {
      resources[resource] = take;
      left -= take;
    }
  }
  return resources;
}

/**
 * Plays the snake draft using the real engine's legal moves. Human seats act
 * through the manager; bot seats get the clock advanced so their timers fire.
 */
function driveSetup(
  context: { manager: RoomManager; clock: FakeClock },
  code: string,
  actors: Map<Seat, FakeConn>,
): void {
  for (let step = 0; step < 300; step += 1) {
    const room = stateOf(context.manager, code);
    const state = room.state;
    if (!state) throw new Error('no state');
    if (state.phase !== 'setup') return;
    const seat = state.currentSeat;
    const conn = actors.get(seat);
    if (conn) {
      const legal = legalMoves(state, seat);
      const action: GameAction | null = legal.setupSettlements[0]
        ? { type: 'setupSettlement', vertex: legal.setupSettlements[0] }
        : legal.setupRoads[0]
          ? { type: 'setupRoad', edge: legal.setupRoads[0] }
          : null;
      if (!action) throw new Error(`no setup move for seat ${seat}`);
      context.manager.action(conn, action);
    } else {
      context.clock.advance(600);
    }
  }
  throw new Error('setup did not finish');
}

/** Human turn helper: roll, handle a seven, then end the turn. */
function playHumanTurn(manager: RoomManager, conn: FakeConn): void {
  for (let step = 0; step < 12; step += 1) {
    const view = viewOf(conn);
    const legal = view.legal;
    if (legal.canRoll) {
      manager.action(conn, { type: 'roll' });
      continue;
    }
    if (legal.discard) {
      manager.action(conn, { type: 'discard', resources: discardPayload(view) });
      continue;
    }
    if (legal.robber) {
      const hex = legal.robber.hexes[0];
      if (!hex) throw new Error('robber with no hex');
      const victim = legal.robber.victims[hex]?.[0];
      manager.action(
        conn,
        victim === undefined ? { type: 'moveRobber', hex } : { type: 'moveRobber', hex, victimSeat: victim },
      );
      continue;
    }
    if (legal.canEndTurn) {
      manager.action(conn, { type: 'endTurn' });
      return;
    }
    throw new Error(`nothing to do in phase ${view.phase}`);
  }
  throw new Error('turn did not finish');
}

describe('quickPlay', () => {
  it('seats the human at 0, fills bots, and sends one filtered game view', () => {
    const { manager } = makeManager();
    const host = new FakeConn();

    manager.quickPlay(host, { name: '  Ada <b> ', seats: 4, difficulty: 'hard' });

    const game = host.last('game');
    expect(game).not.toBeNull();
    expect(game?.you).toBe(0);
    expect(game?.roomCode).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(game?.token.length).toBeGreaterThanOrEqual(16);
    expect(game?.view.phase).toBe('setup');
    expect(game?.view.players).toHaveLength(4);
    expect(game?.view.players[0]?.isBot).toBe(false);
    expect(game?.view.players[0]?.name).toBe('Ada b');
    expect(game?.view.players.slice(1).every((player) => player.isBot)).toBe(true);
    expect(game?.view.players[0]?.hand).toEqual([]);
    expect(game?.view.players[1]?.hand).toBeNull();
    expect(host.count('game')).toBe(1);
    expect(host.count('lobby')).toBe(0);
    expect(manager.stats()).toMatchObject({
      rooms: 1,
      games: 1,
      playing: 1,
      humans: 1,
      bots: 3,
    });
  });

  it('rejects empty names and bad seat counts', () => {
    const { manager } = makeManager();
    const host = new FakeConn();

    manager.quickPlay(host, { name: '   ', seats: 2, difficulty: 'normal' });
    expect(errorCode(host)).toBe('NAME_REQUIRED');

    manager.quickPlay(host, { name: 'Ada', seats: 5 as unknown as 2, difficulty: 'normal' });
    expect(errorCode(host)).toBe('BAD_MESSAGE');

    expect(manager.stats().rooms).toBe(0);
  });
});

describe('lobby', () => {
  it('creates a room, joins by lowercase code, and keeps tokens private', () => {
    const { manager } = makeManager();
    const host = new FakeConn();
    const guest = new FakeConn();

    manager.createRoom(host, { name: 'Ada', maxPlayers: 3, difficulty: 'normal' });
    const hostLobby = host.last('lobby');
    expect(hostLobby).not.toBeNull();
    expect(hostLobby?.room.status).toBe('lobby');
    expect(hostLobby?.room.targetVp).toBe(16);
    expect(hostLobby?.you).toBe(0);
    expect(hostLobby?.room.players[0]?.host).toBe(true);
    const code = hostLobby?.room.code ?? '';

    manager.joinRoom(guest, { code: code.toLowerCase(), name: 'Bo' });

    const updated = host.last('lobby');
    expect(updated?.room.players.map((player) => player.name)).toEqual(['Ada', 'Bo']);
    expect(updated?.room.hostSeat).toBe(0);
    expect(updated?.room.players[0]?.host).toBe(true);
    expect(updated?.room.players[1]?.host).toBe(false);
    expect(guest.last('lobby')?.you).toBe(1);
    expect(guest.last('lobby')?.token).not.toBe(updated?.token);
    expect(host.last('lobby')?.token).toBe(hostLobby?.token);
    // Every lobby payload carries only the recipient's token.
    expect(host.ofType('lobby').every((message) => message.token === hostLobby?.token)).toBe(true);
    expect(guest.ofType('lobby').every((message) => message.token === guest.last('lobby')?.token)).toBe(
      true,
    );

    const joinLine = host
      .ofType('chat')
      .map((message) => message.message)
      .find((message) => message.text === 'Bo joined the room.');
    expect(joinLine?.seat).toBeNull();
    expect(joinLine?.name).toBe('Table');
  });

  it('rejects unknown, malformed, full, and unstartable rooms', () => {
    const { manager } = makeManager();
    const host = new FakeConn();
    const guest = new FakeConn();
    const third = new FakeConn();

    manager.createRoom(host, { name: 'Ada', maxPlayers: 2, difficulty: 'normal' });
    const code = host.last('lobby')?.room.code ?? '';

    manager.joinRoom(guest, { code: 'ZZZZ', name: 'Bo' });
    expect(errorCode(guest)).toBe('ROOM_NOT_FOUND');

    manager.joinRoom(guest, { code: 'ABC', name: 'Bo' });
    expect(errorCode(guest)).toBe('INVALID_ROOM');

    manager.joinRoom(guest, { code, name: '   ' });
    expect(errorCode(guest)).toBe('NAME_REQUIRED');

    manager.joinRoom(guest, { code, name: 'Bo' });
    manager.joinRoom(third, { code, name: 'Cy' });
    expect(errorCode(third)).toBe('ROOM_FULL');

    manager.startGame(host);
    expect(stateOf(manager, code).status).toBe('playing');

    manager.joinRoom(third, { code, name: 'Cy' });
    expect(errorCode(third)).toBe('ALREADY_STARTED');
  });

  it('only the host adds bots and removes players, and only in the lobby', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 4, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];

    context.manager.addBotToRoom(guest, 'hard');
    expect(errorCode(guest)).toBe('NOT_HOST');

    context.manager.addBotToRoom(host, 'hard');
    const lobby = host.last('lobby');
    expect(lobby?.room.players.map((player) => player.seat)).toEqual([0, 1, 2]);
    expect(lobby?.room.players[2]?.isBot).toBe(true);
    expect(lobby?.room.players[2]?.connected).toBe(true);
    expect(lobby?.room.players[2]?.ready).toBe(true);

    context.manager.removePlayer(guest, 2);
    expect(errorCode(guest)).toBe('NOT_HOST');

    context.manager.removePlayer(host, 1);
    expect(host.last('lobby')?.room.players.map((player) => player.seat)).toEqual([0, 2]);
    expect(guest.last('roomClosed')?.reason).toContain('removed');

    context.manager.removePlayer(host, 0);
    expect(errorCode(host)).toBe('INVALID_ROOM');

    context.manager.startGame(host);
    const room = stateOf(context.manager, code);
    expect(room.status).toBe('playing');
    context.manager.addBotToRoom(host, 'hard');
    expect(errorCode(host)).toBe('ALREADY_STARTED');
  });

  it('toggles ready but not once the game starts', () => {
    const context = makeManager();
    const { conns } = makeRoom(context, { seats: 2, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];

    context.manager.setReady(guest, true);
    expect(host.last('lobby')?.room.players[1]?.ready).toBe(true);

    context.manager.setReady(guest, false);
    expect(host.last('lobby')?.room.players[1]?.ready).toBe(false);

    context.manager.startGame(host);
    context.manager.setReady(guest, true);
    expect(errorCode(guest)).toBe('ALREADY_STARTED');
  });

  it('promotes a new host when the host leaves', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 3, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];

    context.manager.leaveRoom(host);

    const lobby = guest.last('lobby');
    expect(lobby?.room.players.map((player) => player.name)).toEqual(['Player 2']);
    expect(lobby?.room.hostSeat).toBe(1);
    expect(lobby?.room.players[0]?.host).toBe(true);
    expect(stateOf(context.manager, code).seats[0]).toBeNull();

    const line = guest
      .ofType('chat')
      .map((message) => message.message)
      .find((message) => message.text === 'Ada left the room.');
    expect(line?.seat).toBeNull();
  });
});

describe('startGame', () => {
  it('fills empty seats with bots and sends a distinct view per human', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 4, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];

    context.manager.startGame(host);

    const hostGame = host.last('game');
    const guestGame = guest.last('game');
    expect(hostGame).not.toBeNull();
    expect(guestGame).not.toBeNull();
    expect(hostGame?.you).toBe(0);
    expect(guestGame?.you).toBe(1);
    expect(hostGame?.view.players).toHaveLength(4);
    expect(hostGame?.view.players[2]?.isBot).toBe(true);
    expect(hostGame?.view.players[3]?.isBot).toBe(true);
    expect(hostGame?.view.legal.seat).toBe(0);
    expect(guestGame?.view.legal.seat).toBe(1);

    // Draft, then check hand filtering with real five-card hands.
    driveSetup(context, code, new Map<Seat, FakeConn>([[0, host], [1, guest]]));

    const hostView = viewOf(host);
    const guestView = viewOf(guest);
    expect(hostView.phase).toBe('roll');
    expect(hostView.players[0]?.hand).toHaveLength(5);
    expect(hostView.players[1]?.hand).toBeNull();
    expect(hostView.players[2]?.hand).toBeNull();
    expect(guestView.players[1]?.hand).toHaveLength(5);
    expect(guestView.players[0]?.hand).toBeNull();
    expect(hostView.gameId).toBe(guestView.gameId);
    expect(hostView.version).toBe(guestView.version);
    // The board is shared, the hands are not.
    expect(hostView.board).toEqual(guestView.board);
  });

  it('requires the host and at least two seats', () => {
    const context = makeManager();
    const solo = new FakeConn();
    context.manager.createRoom(solo, { name: 'Solo', maxPlayers: 4, difficulty: 'normal' });
    context.manager.startGame(solo);
    expect(errorCode(solo)).toBe('NOT_ENOUGH_PLAYERS');
    expect(context.manager.stats().playing).toBe(0);

    const { code, conns } = makeRoom(context, { seats: 2, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];

    context.manager.startGame(guest);
    expect(errorCode(guest)).toBe('NOT_HOST');

    context.manager.startGame(host);
    expect(stateOf(context.manager, code).status).toBe('playing');

    context.manager.startGame(host);
    expect(errorCode(host)).toBe('ALREADY_STARTED');
  });
});

describe('actions', () => {
  it('routes by session seat, per-seat views, and unicast errors', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 4, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];
    context.manager.startGame(host);

    // The seeded first seat may be a bot; let any bot pick before a human does.
    const actors = new Map<Seat, FakeConn>([
      [0, host],
      [1, guest],
    ]);
    const actingSeat = advanceToActor(context, code, actors);
    const acting = actors.get(actingSeat);
    const watchingSeat = actingSeat === 0 ? 1 : 0;
    const watching = watchingSeat === 0 ? host : guest;
    if (!acting) throw new Error(`seat ${actingSeat} has no connection`);

    const state = stateOf(context.manager, code).state;
    if (!state) throw new Error('no state');
    expect(state.currentSeat).toBe(actingSeat);

    // The seat that is not on turn is refused; only it hears about it, and
    // nobody gets a view.
    const actingGamesBefore = acting.count('game');
    const watchingGamesBefore = watching.count('game');
    const wrongSeat = legalMoves(state, actingSeat).setupSettlements[0];
    if (!wrongSeat) throw new Error('no legal setup settlement');
    context.manager.action(watching, { type: 'setupSettlement', vertex: wrongSeat }, 7);
    expect(watching.last('error')?.code).toBe('NOT_YOUR_TURN');
    expect(watching.last('error')?.seq).toBe(7);
    expect(watching.count('game')).toBe(watchingGamesBefore);
    expect(acting.count('game')).toBe(actingGamesBefore);

    // The right seat's action reaches both humans, each with its own view.
    const versionBefore = state.version;
    const legal = legalMoves(state, actingSeat);
    const vertex = legal.setupSettlements[0];
    if (!vertex) throw new Error('no setup vertex');
    context.manager.action(acting, { type: 'setupSettlement', vertex }, 8);
    expect(acting.last('error')).toBeNull();
    expect(acting.count('game')).toBe(actingGamesBefore + 1);
    expect(watching.count('game')).toBe(watchingGamesBefore + 1);
    expect(stateOf(context.manager, code).state?.version).toBe(versionBefore + 1);
    expect(acting.last('game')?.view.legal.seat).toBe(actingSeat);
    expect(watching.last('game')?.view.legal.seat).toBe(watchingSeat);

    // Unknown action types and garbage get friendly errors, not crashes.
    context.manager.action(acting, { type: 'bogus' } as unknown as GameAction, 9);
    expect(acting.last('error')?.code).toBe('INVALID_ACTION');
    context.manager.action(acting, null as unknown as GameAction, 10);
    expect(acting.last('error')?.code).toBe('INTERNAL');
    expect(stateOf(context.manager, code).state?.version).toBe(versionBefore + 1);
  });

  it('refuses actions from a spectator socket', () => {
    const context = makeManager();
    const { conns } = makeRoom(context, { seats: 2, humans: 2 });
    const outsider = new FakeConn();
    context.manager.action(outsider, { type: 'roll' });
    expect(errorCode(outsider)).toBe('NOT_IN_ROOM');
    expect(conns.length).toBe(2);
  });
});

describe('bots', () => {
  it('plays a full bot turn after the human ends theirs', () => {
    const context = makeManager();
    const host = new FakeConn();
    context.manager.quickPlay(host, { name: 'Ada', seats: 2, difficulty: 'normal' });
    const code = host.last('game')?.roomCode ?? '';

    driveSetup(context, code, new Map<Seat, FakeConn>([[0, host]]));
    expect(stateOf(context.manager, code).state?.phase).toBe('roll');
    expect(viewOf(host).legal.canRoll).toBe(true);

    playHumanTurn(context.manager, host);
    const afterTurn = stateOf(context.manager, code);
    expect(afterTurn.state?.currentSeat).toBe(1);

    const gamesBefore = host.count('game');
    for (let tick = 0; tick < 400; tick += 1) {
      const room = stateOf(context.manager, code);
      const state = room.state;
      if (state && state.turn >= 3 && state.currentSeat === 0) break;
      context.clock.advance(600);
    }

    const room = stateOf(context.manager, code);
    expect(room.state?.turn).toBeGreaterThanOrEqual(3);
    expect(room.state?.currentSeat).toBe(0);
    expect(host.count('game')).toBeGreaterThan(gamesBefore);
    expect(viewOf(host).legal.canRoll).toBe(true);
  });

  it('never arms two bot timers at once and clears them at game over', () => {
    const context = makeManager();
    const host = new FakeConn();
    context.manager.quickPlay(host, { name: 'Ada', seats: 4, difficulty: 'normal' });
    const code = host.last('game')?.roomCode ?? '';

    // The seeded first seat can be a bot. Let those pick, then the human takes
    // its setup picks until the snake hands the table to a bot. The human can
    // sit on both sides of the snake, so this may be two pairs in a row.
    advanceToActor(context, code, new Map<Seat, FakeConn>([[0, host]]));
    const state = stateOf(context.manager, code).state;
    if (!state) throw new Error('no state');
    expect(state.currentSeat).toBe(0);
    const open = legalMoves(state, 0);
    const vertex = open.setupSettlements[0];
    if (!vertex) throw new Error('no setup vertex');
    context.manager.action(host, { type: 'setupSettlement', vertex });
    expect(context.clock.pending).toBe(0);

    let placed = 1;
    while (placed < 4) {
      const now = stateOf(context.manager, code).state;
      if (!now || now.phase !== 'setup' || now.currentSeat !== 0) break;
      const legal = legalMoves(now, 0);
      const edge = legal.setupRoads[0];
      if (!edge) throw new Error('no setup road');
      context.manager.action(host, { type: 'setupRoad', edge });
      placed += 1;
      const after = stateOf(context.manager, code).state;
      // Still the human's turn means no bot timer; a bot seat means exactly one.
      expect(context.clock.pending).toBe(after?.currentSeat === 0 ? 0 : 1);
      if (after?.currentSeat !== 0) break;
      const next = legalMoves(after, 0).setupSettlements[0];
      if (!next) throw new Error('no second setup settlement');
      context.manager.action(host, { type: 'setupSettlement', vertex: next });
      placed += 1;
      expect(context.clock.pending).toBe(0);
    }
    expect(stateOf(context.manager, code).state?.currentSeat).not.toBe(0);
    expect(context.clock.pending).toBe(1);

    const versionBefore = stateOf(context.manager, code).state?.version;
    context.clock.advance(499);
    expect(stateOf(context.manager, code).state?.version).toBe(versionBefore);
    context.clock.advance(2);
    expect(stateOf(context.manager, code).state?.version).toBe((versionBefore ?? 0) + 1);

    // Forcing the end of the game must drop every bot timer.
    const current = stateOf(context.manager, code);
    if (current.state) {
      current.state = { ...cloneState(current.state), phase: 'gameOver', winner: 0 };
    }
    current.status = 'finished';
    // A rematch clears timers and starts fresh instead of acting on the old one.
    context.manager.rematch(host);
    expect(stateOf(context.manager, code).state?.phase).toBe('setup');
    // Only the new game's own timer can be armed, never one from the old board.
    expect(context.clock.pending).toBeLessThanOrEqual(1);
    const rematchVersion = stateOf(context.manager, code).state?.version;
    context.clock.advance(499);
    expect(stateOf(context.manager, code).state?.version).toBe(rematchVersion);
  });

  it('lets bots discard on their own but waits for humans', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 4, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];
    context.manager.startGame(host);

    const room = stateOf(context.manager, code);
    const base = room.state;
    if (!base) throw new Error('no state');
    const patched = cloneState(base);
    patched.phase = 'discard';
    patched.currentSeat = 0;
    patched.discardQueue = [0, 1, 2];
    patched.discardRequired = { 0: 1, 1: 1, 2: 1 };
    for (const seat of [0, 1, 2]) {
      const player = patched.players[seat];
      if (player) player.resources.wood = 3;
    }
    room.state = patched;

    // This is exactly what commit() does after a state change.
    (context.manager as unknown as { scheduleBots(room: Room): void }).scheduleBots(room);

    context.clock.advance(600);
    const afterBot = stateOf(context.manager, code).state;
    expect(afterBot?.version).toBe(1);
    expect(afterBot?.discardQueue).toEqual([0, 1]);
    expect(afterBot?.phase).toBe('discard');

    context.clock.advance(5_000);
    const settled = stateOf(context.manager, code).state;
    expect(settled?.version).toBe(1);
    expect(settled?.discardQueue).toEqual([0, 1]);
    expect(guest.last('game')).not.toBeNull();
    expect(host.last('game')).not.toBeNull();
  });
});

describe('disconnects', () => {
  it('hands a seat to a bot after the grace period and gives it back on resume', () => {
    const context = makeManager();
    const { code, conns, tokens } = makeRoom(context, { seats: 2, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];
    context.manager.startGame(host);

    const room = stateOf(context.manager, code);
    const base = room.state;
    if (!base) throw new Error('no state');
    room.state = { ...cloneState(base), currentSeat: 1 };

    context.manager.handleDisconnect(guest);

    expect(stateOf(context.manager, code).seats[1]?.connected).toBe(false);
    expect(stateOf(context.manager, code).seats[1]?.connection).toBeNull();
    const seen = host.last('game')?.view;
    expect(seen?.players[1]?.connected).toBe(false);

    context.clock.advance(44_000);
    expect(stateOf(context.manager, code).seats[1]?.takeover).toBe(false);
    context.clock.advance(2_000);
    expect(stateOf(context.manager, code).seats[1]?.takeover).toBe(true);
    expect(
      host
        .ofType('chat')
        .map((message) => message.message.text)
        .some((text) => text.includes('played by a bot')),
    ).toBe(true);

    // The bot pilots the seat: at least one setup action lands.
    const versionBeforePilot = stateOf(context.manager, code).state?.version ?? 0;
    context.clock.advance(600);
    expect(stateOf(context.manager, code).state?.version ?? 0).toBeGreaterThan(versionBeforePilot);

    // Resume takes control back and cancels the takeover.
    const before = host.count('game');
    context.manager.resume(guest, { code, token: tokens[1] ?? '' });
    expect(stateOf(context.manager, code).seats[1]?.connected).toBe(true);
    expect(stateOf(context.manager, code).seats[1]?.takeover).toBe(false);
    expect(guest.last('game')).not.toBeNull();
    expect(guest.last('game')?.token).toBe(tokens[1]);
    expect(host.count('game')).toBeGreaterThan(before);
    expect(host.last('game')?.view.players[1]?.connected).toBe(true);

    // No bot acts for the human seat again.
    const version = stateOf(context.manager, code).state?.version;
    context.clock.advance(2_000);
    expect(stateOf(context.manager, code).seats[1]?.takeover).toBe(false);
    expect(stateOf(context.manager, code).state?.version).toBe(version);
  });

  it('rejects a wrong token and an unknown room', () => {
    const context = makeManager();
    const { code } = makeRoom(context, { seats: 2, humans: 2 });
    const probe = new FakeConn();

    context.manager.resume(probe, { code, token: 'not-a-real-token' });
    expect(errorCode(probe)).toBe('INVALID_ROOM');

    context.manager.resume(probe, { code: 'ZZZZ', token: 'not-a-real-token' });
    expect(errorCode(probe)).toBe('ROOM_NOT_FOUND');
  });

  it('holds a lobby seat for ten minutes, then frees it', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 3, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];

    context.manager.handleDisconnect(guest);
    expect(host.last('lobby')?.room.players[1]?.connected).toBe(false);
    expect(stateOf(context.manager, code).seats[1]).not.toBeNull();

    context.clock.advance(9 * 60_000);
    expect(stateOf(context.manager, code).seats[1]).not.toBeNull();

    context.clock.advance(2 * 60_000);
    expect(stateOf(context.manager, code).seats[1]).toBeNull();
    expect(host.last('lobby')?.room.players.map((player) => player.seat)).toEqual([0]);
    expect(
      host
        .ofType('chat')
        .map((message) => message.message.text)
        .some((text) => text.includes('timed out')),
    ).toBe(true);
  });

  it('expires the room thirty minutes after the last human goes', () => {
    const context = makeManager();
    const host = new FakeConn();
    context.manager.quickPlay(host, { name: 'Ada', seats: 2, difficulty: 'normal' });
    const code = host.last('game')?.roomCode ?? '';
    expect(context.manager.getRoom(code)).toBeDefined();

    context.manager.handleDisconnect(host);
    context.clock.advance(29 * 60_000);
    expect(context.manager.getRoom(code)).toBeDefined();

    context.clock.advance(2 * 60_000);
    expect(context.manager.getRoom(code)).toBeUndefined();
    expect(context.manager.stats().rooms).toBe(0);
  });

  it('keeps a human seat in a game until they leave for good', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 3, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];
    context.manager.startGame(host);

    context.manager.leaveRoom(guest);
    const slot = stateOf(context.manager, code).seats[1];
    expect(slot).not.toBeNull();
    expect(slot?.connected).toBe(false);
    expect(slot?.takeover).toBe(true);
    expect(host.last('game')?.view.players[1]?.connected).toBe(false);

    const outsider = new FakeConn();
    context.manager.leaveRoom(outsider);
    expect(errorCode(outsider)).toBe('NOT_IN_ROOM');
  });
});

describe('rematch', () => {
  it('restarts with the same seats and a new board', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 3, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];
    context.manager.addBotToRoom(host, 'hard');
    context.manager.startGame(host);

    const first = stateOf(context.manager, code);
    const firstGameId = first.state?.gameId;
    const firstSeed = first.state?.config.seed;
    expect(first.state?.version).toBe(0);

    // White-box finish: the rematch path only needs status + phase.
    first.status = 'finished';
    if (first.state) first.state = { ...cloneState(first.state), phase: 'gameOver', winner: 0 };
    host.clear();
    guest.clear();

    context.manager.rematch(guest);
    expect(errorCode(guest)).toBe('NOT_HOST');

    context.manager.rematch(host);
    const restarted = stateOf(context.manager, code);
    expect(restarted.status).toBe('playing');
    expect(restarted.state?.phase).toBe('setup');
    expect(restarted.state?.version).toBe(0);
    expect(restarted.state?.gameId).not.toBe(firstGameId);
    expect(restarted.state?.config.seed).not.toBe(firstSeed);
    expect(restarted.state?.players.map((player) => player.name)).toEqual([
      'Ada',
      'Player 2',
      'Marrow',
    ]);
    expect(restarted.seats[2]?.isBot).toBe(true);
    expect(host.last('game')?.view.phase).toBe('setup');
    expect(guest.last('game')?.view.phase).toBe('setup');
    expect(
      host
        .ofType('chat')
        .map((message) => message.message.text)
        .some((text) => text.includes('Rematch')),
    ).toBe(true);

    context.manager.rematch(host);
    expect(errorCode(host)).toBe('ALREADY_STARTED');
  });
});

describe('chat', () => {
  it('sanitises text, caps history, and keeps sender metadata', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 3, humans: 2 });
    const [host, guest] = conns as [FakeConn, FakeConn];

    context.manager.chat(host, '  <script>alert(1)</script>  hello   there  ');
    const clean = guest.last('chat')?.message;
    expect(clean?.text).toBe('alert(1) hello there');
    expect(clean?.seat).toBe(0);
    expect(clean?.name).toBe('Ada');
    expect(clean?.at).toBeTypeOf('number');
    expect(clean?.id).toBeTypeOf('number');

    context.manager.chat(host, 'x'.repeat(500));
    expect(guest.last('chat')?.message.text).toHaveLength(200);

    context.manager.chat(host, '   <>   ');
    expect(errorCode(host)).toBe('BAD_MESSAGE');

    for (let index = 0; index < 230; index += 1) context.manager.chat(host, `line ${index}`);
    const room = stateOf(context.manager, code);
    expect(room.chat).toHaveLength(200);
    expect(room.chat[room.chat.length - 1]?.text).toBe('line 229');
    expect(room.chat.every((message) => message.text.length <= 200)).toBe(true);

    // A late joiner gets the tail of the conversation, newest last.
    const late = new FakeConn();
    context.manager.joinRoom(late, { code: room.code, name: 'Late' });
    expect(late.ofType('chat').length).toBeGreaterThan(0);
    // One join line plus at most twenty history lines.
    expect(late.ofType('chat').length).toBeLessThanOrEqual(21);
  });

  it('refuses chat from outside a room', () => {
    const { manager } = makeManager();
    const outsider = new FakeConn();
    manager.chat(outsider, 'hello');
    expect(errorCode(outsider)).toBe('NOT_IN_ROOM');
  });
});

describe('map settings', () => {
  it('lets only the host change the island, and builds it when the game starts', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 2, humans: 2 });
    const host = conns[0] as FakeConn;
    const guest = conns[1] as FakeConn;

    context.manager.setMapSettings(host, { size: 'compact', terrain: 'shuffled', tokens: 'balanced' });
    expect(host.last('lobby')?.room.config.map).toEqual({
      size: 'compact',
      terrain: 'shuffled',
      tokens: 'balanced',
    });
    // The guest sees the change on the next broadcast.
    expect(guest.last('lobby')?.room.config.map.size).toBe('compact');

    context.manager.setMapSettings(guest, { size: 'grand', terrain: 'fixed', tokens: 'fixed' });
    expect(errorCode(guest)).toBe('NOT_HOST');
    expect(stateOf(context.manager, code).config.map).toEqual({
      size: 'compact',
      terrain: 'shuffled',
      tokens: 'balanced',
    });

    context.manager.setReady(guest, true);
    context.manager.startGame(host);
    const room = stateOf(context.manager, code);
    expect(room.state?.board.hexes).toHaveLength(7);
    expect(room.state?.config.map.size).toBe('compact');
    expect(room.state?.board.hexes.find((hex) => hex.id === room.state?.robberHex)?.terrain).toBe(
      'desert',
    );
  });

  it('refuses a map that is not one of the offered islands', () => {
    const context = makeManager();
    const { conns } = makeRoom(context, { seats: 2, humans: 1 });
    const host = conns[0] as FakeConn;
    context.manager.setMapSettings(host, { size: 'huge', terrain: 'fixed', tokens: 'fixed' });
    expect(errorCode(host)).toBe('INVALID_ROOM');
  });

  it('locks the map once the game is running', () => {
    const context = makeManager();
    const { code, conns } = makeRoom(context, { seats: 2, humans: 2 });
    const host = conns[0] as FakeConn;
    const guest = conns[1] as FakeConn;
    context.manager.setReady(guest, true);
    context.manager.startGame(host);
    expect(stateOf(context.manager, code).status).toBe('playing');
    context.manager.setMapSettings(host, { size: 'grand', terrain: 'fixed', tokens: 'fixed' });
    expect(errorCode(host)).toBe('ALREADY_STARTED');
  });
});

describe('room metadata', () => {  it('reports share-link info without leaking tokens', () => {
    const context = makeManager();
    const { code } = makeRoom(context, { seats: 3, humans: 2 });
    const info = context.manager.roomInfo(code);
    expect(info?.room.status).toBe('lobby');
    expect(info?.canJoin).toBe(true);
    expect(info?.room.players.map((player) => player.name)).toEqual(['Ada', 'Player 2']);
    expect(JSON.stringify(info)).not.toContain('"token"');

    expect(context.manager.roomInfo('ZZZZ')).toBeNull();
    expect(context.manager.roomInfo('../etc')).toBeNull();
  });
});
