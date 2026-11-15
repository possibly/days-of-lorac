/**
 * Room manager: every authoritative thing the server does.
 *
 * - owns the in-memory room map, seats, tokens and timers,
 * - validates session-scoped requests (the sender never names its own seat),
 * - runs actions through the engine and broadcasts one fresh view per seat,
 * - schedules bot turns and bot trade answers with a single guarded timer,
 * - handles disconnect, bot takeover, resume, and room expiry.
 *
 * Sockets are `ClientConnection` objects and time comes from a `Clock`, so the
 * unit tests run the whole thing without a network and without waiting.
 */
import { randomUUID } from 'node:crypto';
import { RESOURCES } from '@shared/types';
import type {
  ActionResult,
  BotDifficulty,
  GameAction,
  GameState,
  MapSettings,
  PartialResources,
  Seat,
} from '@shared/types';
import { applyAction, createGame, viewFor } from '@shared/engine/index';
import {
  DEFAULT_MAP_SETTINGS,
  isValidMapSettings,
  maxSeatsFor,
  normalizeMapSettings,
  seatsFit,
} from '@shared/map-settings';
import type { ChatMessage, LobbyView, ServerMessage, WireErrorCode } from '@shared/protocol';
import { chooseBotAction } from './bots/index.js';
import {
  MAX_CHAT_HISTORY,
  MAX_SEATS,
  SYSTEM_NAME,
  botName,
  buildLobbyView,
  connectedMap,
  difficultyOr,
  findSlot,
  findSlotByToken,
  firstEmptySeat,
  isSeatCount,
  newReconnectToken,
  normalizeCode,
  occupiedSlots,
  pilotSeats,
  randomCode,
  sanitizeChat,
  sanitizeName,
  systemClock,
} from './rooms.js';
import type { ClientConnection, Clock, Room, RoomStats, SeatSlot } from './rooms.js';

export interface RoomManagerOptions {
  clock?: Clock;
  /** Bot think time in ms, inclusive. Defaults to the 400-900ms spec. */
  botDelayMs?: [number, number];
  /** How long a disconnected human keeps control before a bot takes over. */
  takeoverMs?: number;
  /** How long a disconnected lobby seat is held before it is freed. */
  lobbySeatTtlMs?: number;
  /** How long an empty room survives after the last human goes. */
  roomIdleTtlMs?: number;
  random?: () => number;
  seed?: () => number;
  code?: () => string;
  /** Console sink; tests pass a no-op. */
  log?: (line: string) => void;
}

interface Session {
  roomCode: string;
  seat: Seat;
}

const DEFAULT_BOT_DELAY: [number, number] = [400, 900];
const DEFAULT_TAKEOVER_MS = 45_000;
const DEFAULT_LOBBY_SEAT_TTL_MS = 10 * 60_000;
const DEFAULT_ROOM_IDLE_TTL_MS = 30 * 60_000;
/** Give up after this many rejected bot actions in a row. */
const MAX_BOT_FAILURES = 3;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<ClientConnection, Session>();
  private readonly clock: Clock;
  private readonly botDelayMs: [number, number];
  private readonly takeoverMs: number;
  private readonly lobbySeatTtlMs: number;
  private readonly roomIdleTtlMs: number;
  private readonly random: () => number;
  private readonly seedFn: (() => number) | null;
  private readonly codeFn: (() => string) | null;
  private readonly log: (line: string) => void;
  private seedCounter = 0;

  constructor(options: RoomManagerOptions = {}) {
    this.clock = options.clock ?? systemClock;
    const delay = options.botDelayMs ?? DEFAULT_BOT_DELAY;
    const min = Math.max(0, Math.min(delay[0], delay[1]));
    const max = Math.max(0, Math.max(delay[0], delay[1]));
    this.botDelayMs = [min, max];
    this.takeoverMs = options.takeoverMs ?? DEFAULT_TAKEOVER_MS;
    this.lobbySeatTtlMs = options.lobbySeatTtlMs ?? DEFAULT_LOBBY_SEAT_TTL_MS;
    this.roomIdleTtlMs = options.roomIdleTtlMs ?? DEFAULT_ROOM_IDLE_TTL_MS;
    this.random = options.random ?? Math.random;
    this.seedFn = options.seed ?? null;
    this.codeFn = options.code ?? null;
    this.log = options.log ?? ((line) => console.log(line));
  }

  // -------------------------------------------------------------------------
  // Introspection (health endpoint, share links, tests)
  // -------------------------------------------------------------------------

  stats(): RoomStats {
    const stats: RoomStats = {
      rooms: this.rooms.size,
      games: 0,
      lobby: 0,
      playing: 0,
      finished: 0,
      humans: 0,
      bots: 0,
    };
    for (const room of this.rooms.values()) {
      if (room.state) stats.games += 1;
      if (room.status === 'lobby') stats.lobby += 1;
      else if (room.status === 'playing') stats.playing += 1;
      else stats.finished += 1;
      for (const slot of occupiedSlots(room)) {
        if (slot.isBot) stats.bots += 1;
        else stats.humans += 1;
      }
    }
    return stats;
  }

  /** Lobby metadata for a share link, or null when the code is unknown. */
  roomInfo(rawCode: string): { room: LobbyView; canJoin: boolean } | null {
    const code = normalizeCode(rawCode);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room || room.closed) return null;
    return {
      room: buildLobbyView(room),
      canJoin: room.status === 'lobby' && firstEmptySeat(room) !== null,
    };
  }

  /** Test and debugging hook. Treat the returned room as read-only. */
  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  // -------------------------------------------------------------------------
  // Room lifecycle
  // -------------------------------------------------------------------------

  quickPlay(
    conn: ClientConnection,
    input: { name: string; seats: 2 | 3 | 4; difficulty: BotDifficulty; map?: MapSettings },
  ): void {
    const name = sanitizeName(input.name);
    if (!name) return this.error(conn, 'NAME_REQUIRED', 'Pick a name before playing.');
    if (!isSeatCount(input.seats)) {
      return this.error(conn, 'BAD_MESSAGE', 'Choose 2, 3, or 4 seats.');
    }
    const difficulty = difficultyOr(input.difficulty, 'normal');
    const map = normalizeMapSettings(input.map, DEFAULT_MAP_SETTINGS);
    if (!seatsFit(map, input.seats)) {
      return this.error(
        conn,
        'INVALID_ROOM',
        `The ${map.size} island seats ${maxSeatsFor(map.size)}. Choose standard or grand.`,
      );
    }

    this.detach(conn);
    try {
      const room = this.newRoom(input.seats, difficulty, map);
      const human = this.addHuman(room, 0, name);
      for (let seat = 1; seat < input.seats; seat += 1) this.addBot(room, seat, difficulty);
      room.status = 'playing';
      room.state = this.buildGame(room);
      this.rooms.set(room.code, room);

      human.connected = true;
      human.connection = conn;
      this.sessions.set(conn, { roomCode: room.code, seat: 0 });

      this.sendGame(room, human);
      this.updateCleanup(room);
      this.scheduleBots(room);
    } catch (error) {
      this.report('quickPlay failed', error);
      this.error(conn, 'SERVER_ERROR', 'Could not start a solo game. Try again.');
    }
  }

  createRoom(
    conn: ClientConnection,
    input: { name: string; maxPlayers: 2 | 3 | 4; difficulty: BotDifficulty; map?: MapSettings },
  ): void {
    const name = sanitizeName(input.name);
    if (!name) return this.error(conn, 'NAME_REQUIRED', 'Pick a name before creating a room.');
    if (!isSeatCount(input.maxPlayers)) {
      return this.error(conn, 'BAD_MESSAGE', 'Rooms hold 2, 3, or 4 players.');
    }
    const difficulty = difficultyOr(input.difficulty, 'normal');
    const map = normalizeMapSettings(input.map, DEFAULT_MAP_SETTINGS);
    if (!seatsFit(map, input.maxPlayers)) {
      return this.error(
        conn,
        'INVALID_ROOM',
        `The ${map.size} island seats ${maxSeatsFor(map.size)}. Choose standard or grand.`,
      );
    }

    this.detach(conn);
    try {
      const room = this.newRoom(input.maxPlayers, difficulty, map);
      const host = this.addHuman(room, 0, name);
      host.connected = true;
      host.connection = conn;
      room.hostSeat = 0;
      this.rooms.set(room.code, room);
      this.sessions.set(conn, { roomCode: room.code, seat: 0 });
      this.broadcastLobby(room);
      this.updateCleanup(room);
    } catch (error) {
      this.report('createRoom failed', error);
      this.error(conn, 'SERVER_ERROR', 'Could not create a room. Try again.');
    }
  }

  joinRoom(conn: ClientConnection, input: { code: string; name: string }): void {
    const name = sanitizeName(input.name);
    if (!name) return this.error(conn, 'NAME_REQUIRED', 'Pick a name before joining.');

    const code = normalizeCode(input.code);
    if (!code) {
      return this.error(conn, 'INVALID_ROOM', 'Room codes are 4 letters, like KQJM.');
    }
    const room = this.rooms.get(code);
    if (!room || room.closed) {
      return this.error(conn, 'ROOM_NOT_FOUND', 'No room with that code is open.');
    }
    const current = this.sessions.get(conn);
    if (current && current.roomCode === code) {
      return this.error(conn, 'ALREADY_STARTED', 'You are already in that room.');
    }
    if (room.status !== 'lobby') {
      return this.error(conn, 'ALREADY_STARTED', 'That game has already started.');
    }
    const seat = firstEmptySeat(room);
    if (seat === null) return this.error(conn, 'ROOM_FULL', 'That room is full.');

    this.detach(conn);
    const slot = this.addHuman(room, seat, name);
    slot.connected = true;
    slot.connection = conn;
    this.ensureHost(room);
    this.sessions.set(conn, { roomCode: room.code, seat });
    this.broadcastLobby(room);
    this.sendChatHistory(room, slot);
    this.systemChat(room, `${slot.name} joined the room.`);
    this.updateCleanup(room);
  }

  resume(conn: ClientConnection, input: { code: string; token: string }): void {
    const code = normalizeCode(input.code);
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (!code || token.length < 8) {
      return this.error(conn, 'INVALID_ROOM', 'That reconnect link is not valid.');
    }
    const room = this.rooms.get(code);
    if (!room || room.closed) {
      return this.error(conn, 'ROOM_NOT_FOUND', 'That room is no longer open.');
    }
    const slot = findSlotByToken(room, token);
    if (!slot) {
      return this.error(conn, 'INVALID_ROOM', 'That reconnect token does not match a seat.');
    }

    const session = this.sessions.get(conn);
    if (session && (session.roomCode !== room.code || session.seat !== slot.seat)) {
      this.detach(conn);
    }

    const previous = slot.connection;
    if (previous && previous !== conn) {
      this.sessions.delete(previous);
      this.send(previous, {
        type: 'roomClosed',
        reason: 'This seat reconnected from another window.',
      });
      try {
        previous.close?.('seat resumed elsewhere');
      } catch {
        /* the transport is already gone */
      }
    }

    slot.connection = conn;
    slot.connected = true;
    slot.disconnectedAt = null;
    slot.takeover = false;
    this.clearSeatTimers(slot);
    this.sessions.set(conn, { roomCode: room.code, seat: slot.seat });

    this.broadcast(room);
    this.sendChatHistory(room, slot);
    this.systemChat(room, `${slot.name} reconnected.`);
    this.updateCleanup(room);
    this.scheduleBots(room);
  }

  leaveRoom(conn: ClientConnection): void {
    const found = this.lookup(conn);
    if (!found) {
      return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    }
    const { room, slot } = found;
    this.sessions.delete(conn);
    slot.connection = null;
    slot.connected = false;
    slot.disconnectedAt = this.clock.now();

    if (room.status === 'lobby') {
      this.freeSeat(room, slot, 'left the room');
      this.updateCleanup(room);
      return;
    }

    // Mid-game the seat has to stay: the game has a fixed player count. The
    // bots take over right away because the human said goodbye.
    if (room.status === 'playing') {
      slot.takeover = true;
      this.clearSeatTimers(slot);
    }
    this.promoteHost(room);
    this.broadcast(room);
    this.systemChat(room, `${slot.name} left the game.`);
    this.updateCleanup(room);
    this.scheduleBots(room);
  }

  setReady(conn: ClientConnection, ready: boolean): void {
    const found = this.lookup(conn);
    if (!found) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    const { room, slot } = found;
    if (room.status !== 'lobby') {
      return this.error(conn, 'ALREADY_STARTED', 'The game has already started.');
    }
    slot.ready = ready;
    this.broadcastLobby(room);
  }

  /** Host-only: pick the island before the first card is dealt. */
  setMapSettings(conn: ClientConnection, map: unknown): void {
    const found = this.lookup(conn);
    if (!found) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    const { room, slot } = found;
    if (room.hostSeat !== slot.seat || slot.isBot) {
      return this.error(conn, 'NOT_HOST', 'Only the host can set the map.');
    }
    if (room.status !== 'lobby') {
      return this.error(conn, 'ALREADY_STARTED', 'The map is locked once the game starts.');
    }
    if (!isValidMapSettings(map)) {
      return this.error(conn, 'INVALID_ROOM', 'That map setting is not one of the offered islands.');
    }
    const next = normalizeMapSettings(map, room.config.map);
    if (!seatsFit(next, room.config.maxPlayers)) {
      return this.error(
        conn,
        'INVALID_ROOM',
        `The ${next.size} island seats ${maxSeatsFor(next.size)}, and this table has ${room.config.maxPlayers} seats.`,
      );
    }
    const current = room.config.map;
    if (next.size === current.size && next.terrain === current.terrain && next.tokens === current.tokens) {
      return;
    }
    room.config.map = next;
    this.broadcastLobby(room);
  }

  addBotToRoom(conn: ClientConnection, difficulty?: BotDifficulty): void {
    const found = this.lookup(conn);
    if (!found) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    const { room, slot } = found;
    if (room.hostSeat !== slot.seat || slot.isBot) {
      return this.error(conn, 'NOT_HOST', 'Only the host can add bots.');
    }
    if (room.status !== 'lobby') {
      return this.error(conn, 'ALREADY_STARTED', 'The game has already started.');
    }
    const seat = firstEmptySeat(room);
    if (seat === null) return this.error(conn, 'ROOM_FULL', 'That room is full.');
    const bot = this.addBot(room, seat, difficultyOr(difficulty, room.config.difficulty));
    this.broadcastLobby(room);
    this.systemChat(room, `${bot.name} (bot) sat down.`);
  }

  removePlayer(conn: ClientConnection, seat: Seat): void {
    const found = this.lookup(conn);
    if (!found) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    const { room, slot } = found;
    if (room.hostSeat !== slot.seat || slot.isBot) {
      return this.error(conn, 'NOT_HOST', 'Only the host can remove players.');
    }
    if (room.status !== 'lobby') {
      return this.error(conn, 'ALREADY_STARTED', 'The game has already started.');
    }
    if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS) {
      return this.error(conn, 'INVALID_ROOM', 'That seat does not exist.');
    }
    if (seat === slot.seat) {
      return this.error(conn, 'INVALID_ROOM', 'Use leave room to give up the host seat.');
    }
    const target = findSlot(room, seat);
    if (!target) return this.error(conn, 'INVALID_ROOM', 'That seat is empty.');

    this.evict(room, target, 'You were removed from the room.');
    this.systemChat(room, `${target.name} was removed from the room.`);
    this.updateCleanup(room);
  }

  startGame(conn: ClientConnection): void {
    const found = this.lookup(conn);
    if (!found) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    const { room, slot } = found;
    if (room.status !== 'lobby') {
      return this.error(conn, 'ALREADY_STARTED', 'The game has already started.');
    }
    if (room.hostSeat !== slot.seat || slot.isBot) {
      return this.error(conn, 'NOT_HOST', 'Only the host can start the game.');
    }
    if (occupiedSlots(room).length < 2) {
      return this.error(conn, 'NOT_ENOUGH_PLAYERS', 'A game needs at least two seats.');
    }

    for (let seat = 0; seat < room.config.maxPlayers; seat += 1) {
      if (!room.seats[seat]) this.addBot(room, seat, room.config.difficulty);
    }
    for (const filled of occupiedSlots(room)) this.clearSeatTimers(filled);
    room.status = 'playing';
    room.state = this.buildGame(room);
    room.botFailures = 0;
    this.systemChat(room, 'The game has started.');
    this.broadcast(room);
    this.updateCleanup(room);
    this.scheduleBots(room);
  }

  rematch(conn: ClientConnection): void {
    const found = this.lookup(conn);
    if (!found) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    const { room, slot } = found;
    if (room.status !== 'finished') {
      return this.error(conn, 'ALREADY_STARTED', 'Finish the current game first.');
    }
    if (room.hostSeat !== slot.seat || slot.isBot) {
      return this.error(conn, 'NOT_HOST', 'Only the host can start a rematch.');
    }

    this.clearGameTimers(room);
    // Same humans and bots. A human who is still gone keeps a bot at the helm.
    for (const filled of occupiedSlots(room)) {
      if (!filled.isBot && !filled.connected) filled.takeover = true;
    }
    room.status = 'playing';
    room.state = this.buildGame(room);
    room.botFailures = 0;
    this.systemChat(room, 'Rematch: same table, new board.');
    this.broadcast(room);
    this.updateCleanup(room);
    this.scheduleBots(room);
  }

  // -------------------------------------------------------------------------
  // Actions and chat
  // -------------------------------------------------------------------------

  action(conn: ClientConnection, action: GameAction, seq?: number): void {
    const found = this.lookup(conn);
    if (!found) {
      return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.', seq);
    }
    const { room, slot } = found;
    if (!room.state || room.status === 'lobby') {
      return this.error(conn, 'WRONG_PHASE', 'The game has not started yet.', seq);
    }
    if (room.status === 'finished') {
      return this.error(conn, 'GAME_OVER', 'The game is over.', seq);
    }

    let result: ActionResult;
    try {
      result = applyAction(room.state, slot.seat, action);
    } catch (error) {
      this.report('action threw', error);
      return this.error(conn, 'INTERNAL', 'The engine could not read that action.', seq);
    }

    if (!result.ok) {
      this.error(conn, result.code, result.message, seq);
      return;
    }
    this.commit(room, result.state);
  }

  chat(conn: ClientConnection, text: string): void {
    const found = this.lookup(conn);
    if (!found) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room.');
    const { room, slot } = found;
    const clean = sanitizeChat(text);
    if (!clean) return this.error(conn, 'BAD_MESSAGE', 'Say something with a few letters in it.');
    this.appendChat(room, slot.seat, slot.name, clean);
  }

  // -------------------------------------------------------------------------
  // Disconnects
  // -------------------------------------------------------------------------

  handleDisconnect(conn: ClientConnection): void {
    const session = this.sessions.get(conn);
    if (!session) return;
    this.sessions.delete(conn);

    const room = this.rooms.get(session.roomCode);
    if (!room || room.closed) return;
    const slot = room.seats[session.seat];
    if (!slot || slot.connection !== conn) return;

    slot.connection = null;
    slot.connected = false;
    slot.disconnectedAt = this.clock.now();

    if (room.status === 'lobby') {
      this.broadcastLobby(room);
      this.systemChat(room, `${slot.name} disconnected.`);
      this.armLobbyExpiry(room, slot);
    } else {
      this.broadcast(room);
      this.systemChat(room, `${slot.name} disconnected.`);
      if (room.status === 'playing') this.armTakeover(room, slot);
    }
    this.updateCleanup(room);
    if (room.status === 'playing') this.scheduleBots(room);
  }

  /** Server shutdown: tell everyone and drop every timer. */
  closeAll(reason = 'Server shutting down.'): void {
    for (const room of [...this.rooms.values()]) this.closeRoom(room, reason);
    this.sessions.clear();
  }

  // -------------------------------------------------------------------------
  // Bot scheduling
  // -------------------------------------------------------------------------

  /**
   * Arms at most one bot action. Called after every state change; clearing the
   * old timer first means two callbacks can never act on the same version.
   */
  private scheduleBots(room: Room): void {
    this.clearBotTimer(room);
    if (room.closed || room.status !== 'playing') return;
    const state = room.state;
    if (!state || state.phase === 'gameOver') return;

    const seat = this.nextBotSeat(room);
    if (seat === null) return;

    const [min, max] = this.botDelayMs;
    const span = max - min;
    const delay = min + Math.floor(this.random() * (span + 1));
    const token = room.botToken;
    this.debug(room, `arm bot seat=${seat} delay=${delay} v=${state.version} token=${token} at=${this.clock.now()}`);

    room.botTimer = this.clock.setTimeout(() => {
      room.botTimer = null;
      this.debug(room, `fire seat=${seat} token=${token} roomToken=${room.botToken} at=${this.clock.now()}`);
      try {
        if (room.closed || room.botToken !== token) {
          this.debug(room, `timer seat=${seat} dropped (closed or stale token)`);
          return;
        }
        if (room.state !== state || room.state.version !== state.version) {
          this.debug(room, `timer seat=${seat} dropped (state moved on)`);
          return;
        }
        this.runBotStep(room);
      } catch (error) {
        this.report('bot timer threw', error);
      }
    }, delay);
  }

  /**
   * Picks the one bot that should move now, or null when humans owe something.
   *
   * Discards come first and only consider seats actually in the queue, so a
   * seven waits for every human to choose. Bot trade answers come next, then
   * the current seat if a bot (or a bot-piloted human) holds it.
   */
  private nextBotSeat(room: Room): Seat | null {
    const state = room.state;
    if (!state) return null;

    if (state.phase === 'discard') {
      for (const seat of state.discardQueue) {
        const slot = findSlot(room, seat);
        if (slot && this.botControlled(slot)) return seat;
      }
      return null;
    }

    const offer = state.tradeOffer;
    if (offer) {
      for (const seat of offer.to) {
        if (seat === offer.from) continue;
        const slot = findSlot(room, seat);
        if (slot && this.botControlled(slot)) return seat;
      }
    }

    const current = findSlot(room, state.currentSeat);
    if (current && this.botControlled(current)) return current.seat;
    return null;
  }

  private botControlled(slot: SeatSlot): boolean {
    if (slot.isBot) return true;
    return slot.takeover && !slot.connected;
  }

  private runBotStep(room: Room): void {
    const state = room.state;
    if (!state || state.phase === 'gameOver') {
      this.debug(room, 'bot step skipped: no live state');
      return;
    }
    const seat = this.nextBotSeat(room);
    if (seat === null) {
      this.debug(room, `bot step skipped: nobody to move (phase ${state.phase})`);
      return;
    }
    const slot = findSlot(room, seat);
    if (!slot) {
      this.debug(room, `bot step skipped: empty seat ${seat}`);
      return;
    }

    const view = viewFor(state, seat, connectedMap(room));
    const difficulty = slot.difficulty ?? room.config.difficulty;

    let next: GameState | null = null;
    let chosen: GameAction | null = null;
    try {
      chosen = chooseBotAction(view, difficulty);
      next = this.tryBotAction(state, seat, chosen);
      this.debug(
        room,
        `bot seat=${seat} ${chosen.type} -> ${next ? `ok v=${next.version}` : 'rejected'}`,
      );
    } catch (error) {
      this.report(`bot policy threw for seat ${seat}`, error);
    }
    if (!next) {
      const fallback = this.fallbackAction(seat, view);
      this.debug(
        room,
        `bot seat=${seat} ${chosen?.type ?? 'none'} rejected, fallback=${fallback?.type ?? 'none'}`,
      );
      if (fallback) next = this.tryBotAction(state, seat, fallback);
    }

    if (!next) {
      room.botFailures += 1;
      this.log(`[room ${room.code}] bot seat ${seat} had no legal move (${room.botFailures})`);
      if (room.botFailures >= MAX_BOT_FAILURES) {
        this.systemChat(room, 'The table is stuck: a bot could not find a legal move.');
        return;
      }
      // Try again after the normal delay; the version guard keeps this to one
      // timer at a time.
      this.scheduleBots(room);
      return;
    }

    room.botFailures = 0;
    this.commit(room, next);
  }

  private tryBotAction(state: GameState, seat: Seat, action: GameAction): GameState | null {
    try {
      const result = applyAction(state, seat, action);
      if (result.ok) return result.state;
      this.log(`[bot] ${action.type} rejected: ${result.code} ${result.message}`);
      return null;
    } catch (error) {
      this.report('bot action threw', error);
      return null;
    }
  }

  /** Last-resort legal move so a bad bot choice never freezes a table. */
  private fallbackAction(seat: Seat, view: ReturnType<typeof viewFor>): GameAction | null {
    const legal = view.legal;
    const player = view.players[seat];

    if (legal.discard && player) {
      const resources: PartialResources = {};
      let left = legal.discard.required;
      const order = [...RESOURCES].sort(
        (a, b) => (player.resources[b] ?? 0) - (player.resources[a] ?? 0),
      );
      for (const resource of order) {
        if (left <= 0) break;
        const take = Math.min(left, player.resources[resource] ?? 0);
        if (take > 0) {
          resources[resource] = take;
          left -= take;
        }
      }
      return { type: 'discard', resources };
    }

    if (view.phase === 'setup') {
      const vertex = legal.setupSettlements[0];
      if (vertex) return { type: 'setupSettlement', vertex };
      const edge = legal.setupRoads[0];
      if (edge) return { type: 'setupRoad', edge };
    }

    if (legal.canRoll) return { type: 'roll' };

    if (legal.robber) {
      const hex = legal.robber.hexes[0];
      if (hex) {
        const victim = legal.robber.victims[hex]?.[0];
        return victim === undefined
          ? { type: 'moveRobber', hex }
          : { type: 'moveRobber', hex, victimSeat: victim };
      }
    }

    if (legal.canRespondToTrade && view.tradeOffer) {
      return { type: 'respondTrade', offerId: view.tradeOffer.id, accept: false };
    }

    if (view.phase === 'action' && legal.isTurn && legal.canEndTurn) {
      return { type: 'endTurn' };
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Commit, broadcast, chat
  // -------------------------------------------------------------------------

  private commit(room: Room, next: GameState): void {
    room.state = next;
    if (next.phase === 'gameOver') {
      room.status = 'finished';
      this.clearGameTimers(room);
      const winner = next.winner;
      const name = winner === null ? null : next.players[winner]?.name ?? null;
      this.appendChat(
        room,
        null,
        SYSTEM_NAME,
        name ? `${name} wins the game.` : 'The game is over.',
      );
      this.broadcast(room);
      this.updateCleanup(room);
      return;
    }

    this.broadcast(room);
    this.scheduleBots(room);
  }

  private broadcast(room: Room): void {
    if (room.status === 'lobby') {
      this.broadcastLobby(room);
      return;
    }
    this.broadcastGame(room);
  }

  private broadcastLobby(room: Room): void {
    const lobby = buildLobbyView(room);
    for (const slot of occupiedSlots(room)) {
      if (slot.isBot || !slot.connection || !slot.token) continue;
      this.send(slot.connection, {
        type: 'lobby',
        room: lobby,
        you: slot.seat,
        token: slot.token,
      });
    }
  }

  /**
   * One view per human. Views are never shared: `viewFor` includes the
   * viewer's hand and legal moves, so every seat gets its own object.
   */
  private broadcastGame(room: Room): void {
    for (const slot of occupiedSlots(room)) {
      if (slot.isBot || !slot.connection) continue;
      this.sendGame(room, slot);
    }
  }

  private sendGame(room: Room, slot: SeatSlot): void {
    if (!room.state || !slot.connection || !slot.token) return;
    const view = viewFor(room.state, slot.seat, connectedMap(room));
    this.send(slot.connection, {
      type: 'game',
      roomCode: room.code,
      you: slot.seat,
      hostSeat: room.hostSeat,
      pilotSeats: pilotSeats(room),
      token: slot.token,
      view,
    });
  }

  private systemChat(room: Room, text: string): void {
    this.appendChat(room, null, SYSTEM_NAME, text);
  }

  private appendChat(room: Room, seat: Seat | null, name: string, text: string): void {
    const message: ChatMessage = {
      id: room.nextChatId,
      seat,
      name,
      text,
      at: this.clock.now(),
    };
    room.nextChatId += 1;
    room.chat.push(message);
    if (room.chat.length > MAX_CHAT_HISTORY) room.chat.splice(0, room.chat.length - MAX_CHAT_HISTORY);
    this.broadcastChat(room, message);
  }

  private broadcastChat(room: Room, message: ChatMessage): void {
    for (const slot of occupiedSlots(room)) {
      if (slot.isBot || !slot.connection) continue;
      this.send(slot.connection, { type: 'chat', message });
    }
  }

  /** New joiners and reconnectors get the tail of the table talk. */
  private sendChatHistory(room: Room, slot: SeatSlot): void {
    if (!slot.connection) return;
    for (const message of room.chat.slice(-20)) {
      this.send(slot.connection, { type: 'chat', message });
    }
  }

  // -------------------------------------------------------------------------
  // Seats, hosts, timers
  // -------------------------------------------------------------------------

  private newRoom(maxPlayers: 2 | 3 | 4, difficulty: BotDifficulty, map: MapSettings): Room {
    return {
      code: this.allocateCode(),
      createdAt: this.clock.now(),
      hostSeat: 0,
      config: { maxPlayers, difficulty, map: { ...map } },
      status: 'lobby',
      seats: [null, null, null, null],
      state: null,
      chat: [],
      nextChatId: 1,
      botTimer: null,
      botToken: 0,
      botFailures: 0,
      cleanupTimer: null,
      cleanupToken: 0,
      closed: false,
    };
  }

  private allocateCode(): string {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const code = this.codeFn ? this.codeFn() : randomCode(this.random);
      if (normalizeCode(code) !== code) continue;
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('could not allocate a room code');
  }

  private addHuman(room: Room, seat: Seat, name: string): SeatSlot {
    const slot: SeatSlot = {
      seat,
      name,
      isBot: false,
      difficulty: null,
      connected: false,
      ready: false,
      token: newReconnectToken(),
      connection: null,
      takeover: false,
      disconnectedAt: null,
      takeoverTimer: null,
      takeoverToken: 0,
      expiryTimer: null,
      expiryToken: 0,
    };
    room.seats[seat] = slot;
    return slot;
  }

  private addBot(room: Room, seat: Seat, difficulty: BotDifficulty): SeatSlot {
    const slot: SeatSlot = {
      seat,
      name: botName(seat),
      isBot: true,
      difficulty,
      connected: true,
      ready: true,
      token: null,
      connection: null,
      takeover: false,
      disconnectedAt: null,
      takeoverTimer: null,
      takeoverToken: 0,
      expiryTimer: null,
      expiryToken: 0,
    };
    room.seats[seat] = slot;
    return slot;
  }

  private buildGame(room: Room): GameState {
    const playerCount = room.config.maxPlayers;
    const slots: SeatSlot[] = [];
    for (let seat = 0; seat < playerCount; seat += 1) {
      const slot = room.seats[seat];
      if (!slot) throw new Error(`seat ${seat} is empty`);
      slots.push(slot);
    }
    return createGame({
      playerCount,
      map: room.config.map,
      seed: this.nextSeed(),
      // Random, so the public id says nothing about the seed. Bot tie-breaks
      // still work: they hash the id, they do not invert it.
      gameId: randomUUID(),
      names: slots.map((slot) => slot.name),
      bots: slots.map((slot) => slot.isBot),
      difficulties: slots.map((slot) =>
        slot.isBot || slot.takeover ? slot.difficulty ?? room.config.difficulty : null,
      ),
    });
  }

  private nextSeed(): number {
    if (this.seedFn) return this.seedFn();
    this.seedCounter += 1;
    return (this.clock.now() ^ Math.imul(this.seedCounter, 2654435761)) >>> 0;
  }

  /** Keeps the host seat on a human whenever one is left. */
  private ensureHost(room: Room): void {
    const current = findSlot(room, room.hostSeat);
    if (current && !current.isBot) return;
    const occupied = occupiedSlots(room);
    const human = occupied.find((slot) => !slot.isBot);
    const next = human ?? occupied[0];
    if (next) room.hostSeat = next.seat;
  }

  /**
   * Mid-game host rights follow a connected human. Called when the host seat
   * stops being one: they left for good, or a bot took over after the 45s
   * timeout. With no connected human left the seat stays put, so a host who
   * reconnects keeps its room.
   *
   * Callers broadcast afterwards, so the new `hostSeat` rides the next view.
   */
  private promoteHost(room: Room): void {
    const current = findSlot(room, room.hostSeat);
    if (current && !current.isBot && current.connected) return;
    const next = occupiedSlots(room).find(
      (slot) => !slot.isBot && slot.connected && slot.seat !== room.hostSeat,
    );
    if (!next) return;
    room.hostSeat = next.seat;
    this.systemChat(room, `${next.name} is the host now.`);
  }

  /** Drops a lobby seat, notifying its socket if it still has one. */
  private freeSeat(room: Room, slot: SeatSlot, verb: string): void {
    this.evict(room, slot, `You ${verb}.`);
    this.systemChat(room, `${slot.name} ${verb}.`);
  }

  private evict(room: Room, slot: SeatSlot, reason: string): void {
    this.clearSeatTimers(slot);
    const conn = slot.connection;
    const wasHost = room.hostSeat === slot.seat;
    slot.connection = null;
    if (conn) {
      this.sessions.delete(conn);
      this.send(conn, { type: 'roomClosed', reason });
    }
    room.seats[slot.seat] = null;
    if (wasHost) this.ensureHost(room);
    this.broadcastLobby(room);
  }

  private armTakeover(room: Room, slot: SeatSlot): void {
    this.clearTakeoverTimer(slot);
    const token = slot.takeoverToken;
    slot.takeoverTimer = this.clock.setTimeout(() => {
      slot.takeoverTimer = null;
      if (slot.takeoverToken !== token) return;
      if (room.closed || room.status !== 'playing') return;
      if (slot.connected || slot.isBot) return;
      slot.takeover = true;
      this.promoteHost(room);
      this.systemChat(room, `${slot.name} is being played by a bot until they return.`);
      this.broadcast(room);
      this.scheduleBots(room);
    }, this.takeoverMs);
  }

  private armLobbyExpiry(room: Room, slot: SeatSlot): void {
    this.clearExpiryTimer(slot);
    const token = slot.expiryToken;
    slot.expiryTimer = this.clock.setTimeout(() => {
      slot.expiryTimer = null;
      if (slot.expiryToken !== token) return;
      if (room.closed || room.status !== 'lobby') return;
      if (slot.connected || slot.isBot) return;
      this.freeSeat(room, slot, 'timed out of the room');
      this.updateCleanup(room);
    }, this.lobbySeatTtlMs);
  }

  private updateCleanup(room: Room): void {
    if (room.closed) return;
    const humans = occupiedSlots(room).filter((slot) => !slot.isBot);
    if (humans.some((slot) => slot.connected)) {
      this.clearCleanupTimer(room);
      return;
    }
    if (room.cleanupTimer !== null) return;
    const token = room.cleanupToken;
    room.cleanupTimer = this.clock.setTimeout(() => {
      room.cleanupTimer = null;
      if (room.cleanupToken !== token) return;
      if (room.closed) return;
      this.closeRoom(room, 'Room expired after everyone left.');
    }, this.roomIdleTtlMs);
  }

  private closeRoom(room: Room, reason: string): void {
    if (room.closed) return;
    room.closed = true;
    this.clearGameTimers(room);
    this.clearCleanupTimer(room);
    for (const slot of occupiedSlots(room)) this.clearSeatTimers(slot);
    for (const slot of occupiedSlots(room)) {
      const conn = slot.connection;
      slot.connection = null;
      if (!conn) continue;
      this.sessions.delete(conn);
      this.send(conn, { type: 'roomClosed', reason });
    }
    this.rooms.delete(room.code);
    this.log(`[room ${room.code}] closed: ${reason}`);
  }

  /** Bot timer plus every seat's takeover timer. Lobby timers are separate. */
  private clearGameTimers(room: Room): void {
    this.clearBotTimer(room);
    for (const slot of occupiedSlots(room)) this.clearTakeoverTimer(slot);
  }

  private clearBotTimer(room: Room): void {
    if (room.botTimer !== null) {
      this.clock.clearTimeout(room.botTimer);
      room.botTimer = null;
    }
    room.botToken += 1;
  }

  private clearTakeoverTimer(slot: SeatSlot): void {
    if (slot.takeoverTimer !== null) {
      this.clock.clearTimeout(slot.takeoverTimer);
      slot.takeoverTimer = null;
    }
    slot.takeoverToken += 1;
  }

  private clearExpiryTimer(slot: SeatSlot): void {
    if (slot.expiryTimer !== null) {
      this.clock.clearTimeout(slot.expiryTimer);
      slot.expiryTimer = null;
    }
    slot.expiryToken += 1;
  }

  private clearCleanupTimer(room: Room): void {
    if (room.cleanupTimer !== null) {
      this.clock.clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    room.cleanupToken += 1;
  }

  private clearSeatTimers(slot: SeatSlot): void {
    this.clearTakeoverTimer(slot);
    this.clearExpiryTimer(slot);
  }

  // -------------------------------------------------------------------------
  // Session lookup and sends
  // -------------------------------------------------------------------------

  private lookup(conn: ClientConnection): { room: Room; slot: SeatSlot } | null {
    const session = this.sessions.get(conn);
    if (!session) return null;
    const room = this.rooms.get(session.roomCode);
    if (!room || room.closed) {
      this.sessions.delete(conn);
      return null;
    }
    const slot = room.seats[session.seat];
    if (!slot || slot.connection !== conn) {
      this.sessions.delete(conn);
      return null;
    }
    return { room, slot };
  }

  /**
   * Leaves whatever the socket is attached to. Used when a socket creates or
   * joins a different room, so one socket never holds two seats.
   */
  private detach(conn: ClientConnection): void {
    const session = this.sessions.get(conn);
    if (!session) return;
    const room = this.rooms.get(session.roomCode);
    this.sessions.delete(conn);
    if (!room || room.closed) return;
    const slot = room.seats[session.seat];
    if (!slot || slot.connection !== conn) return;

    slot.connection = null;
    slot.connected = false;
    slot.disconnectedAt = this.clock.now();
    if (room.status === 'lobby') {
      this.freeSeat(room, slot, 'left the room');
    } else {
      if (room.status === 'playing') {
        slot.takeover = true;
        this.clearSeatTimers(slot);
      }
      this.promoteHost(room);
      this.broadcast(room);
      this.systemChat(room, `${slot.name} left the game.`);
    }
    this.updateCleanup(room);
    if (room.status === 'playing') this.scheduleBots(room);
  }

  private send(conn: ClientConnection, message: ServerMessage): void {
    try {
      conn.send(message);
    } catch (error) {
      this.report('send failed', error);
    }
  }

  private error(conn: ClientConnection, code: WireErrorCode, message: string, seq?: number): void {
    const payload: ServerMessage =
      seq === undefined
        ? { type: 'error', code, message }
        : { type: 'error', code, message, seq };
    this.send(conn, payload);
  }

  private report(what: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.log(`[room-manager] ${what}: ${detail}`);
  }

  /** Extra scheduler tracing; enable with LORAC_DEBUG=1. */
  private debug(room: Room, line: string): void {
    if (process.env.LORAC_DEBUG) this.log(`[room ${room.code}] ${line}`);
  }
}
