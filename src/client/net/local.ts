/**
 * Local store: the whole game in one tab.
 *
 * `LocalClient` presents the same snapshot and intent surface as the WebSocket
 * client, so every screen works unchanged. The difference is underneath: the
 * shared engine runs in the browser, and the bots that `src/server/room-manager`
 * would have paced over a socket are paced here with `setTimeout`.
 *
 * This is what the GitHub Pages build uses. The bot policy is pure TypeScript
 * with no Node imports, so it ships in the client bundle. Online play keeps
 * using `socket.ts` and never touches this file.
 */
import { applyAction, createGame, viewFor } from '@shared/engine';
import { GAME_VERSION } from '@shared/version';
import { RESOURCES } from '@shared/types';
import type {
  BotDifficulty,
  GameAction,
  GameState,
  GameView,
  PartialResources,
  Seat,
} from '@shared/types';
import { chooseBotAction } from '../../server/bots/index.js';
import type { ClientSnapshot } from './socket';

const BOT_NAMES = ['Vale', 'Kestrel', 'Marrow'] as const;
const BOT_DELAY: [number, number] = [450, 950];
const MAX_BOT_FAILURES = 8;

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function randomId(): string {
  const ref = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (ref?.randomUUID) return ref.randomUUID();
  return `local-${Math.floor(Math.random() * 0xffffffff).toString(16)}-${Date.now().toString(16)}`;
}

function initialSnapshot(): ClientSnapshot {
  return {
    link: 'open',
    serverVersion: GAME_VERSION,
    mismatch: false,
    ready: true,
    roomCode: null,
    you: null,
    token: null,
    hostSeat: null,
    pilotSeats: [],
    lobby: null,
    game: null,
    error: null,
    chats: [],
    roomClosed: null,
    attempt: 0,
    droppedAt: null,
    botPilot: false,
    latency: null,
    resuming: false,
  };
}

export class LocalClient {
  private snapshot: ClientSnapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private state: GameState | null = null;
  private seats: 2 | 3 | 4 = 4;
  private difficulty: BotDifficulty = 'normal';
  private humanName = 'You';
  private timer: number | undefined;
  private botFailures = 0;
  private disposed = false;

  // ----- store plumbing ----------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ClientSnapshot => this.snapshot;

  private update(patch: Partial<ClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ----- lifecycle ---------------------------------------------------------

  /** Nothing to connect to. Kept for API parity with the socket client. */
  start(): void {}

  stop(): void {
    this.disposed = true;
    this.clearTimer();
  }

  // ----- intents -----------------------------------------------------------

  quickPlay(name: string, seats: 2 | 3 | 4, difficulty: BotDifficulty): void {
    this.humanName = name.trim() || 'You';
    this.seats = seats;
    this.difficulty = difficulty;
    this.newGame();
  }

  rematch(): void {
    if (!this.state || this.state.phase !== 'gameOver') return;
    this.newGame();
  }

  sendAction(action: GameAction): void {
    const state = this.state;
    if (!state) return;
    const result = applyAction(state, 0, action);
    if (!result.ok) {
      this.update({
        error: { code: result.code, message: result.message, at: Date.now() },
      });
      return;
    }
    this.state = result.state;
    this.botFailures = 0;
    this.publish();
    this.scheduleBots();
  }

  leaveRoom(): void {
    this.clearTimer();
    this.state = null;
    this.botFailures = 0;
    this.update(initialSnapshot());
  }

  forget(): void {
    this.leaveRoom();
  }

  clearError(): void {
    if (this.snapshot.error) this.update({ error: null });
  }

  clearRoomClosed(): void {
    if (this.snapshot.roomClosed) this.update({ roomClosed: null });
  }

  // Online-only intents. The offline UI never shows their controls; these exist
  // so the screens type-check against one store interface.
  createRoom(): void {}

  joinRoom(): void {}

  resumeSession(): void {}

  resumeStored(): boolean {
    return false;
  }

  setReady(): void {}

  addBot(): void {}

  removePlayer(): void {}

  startGame(): void {}

  chat(): void {}

  // ----- game plumbing -----------------------------------------------------

  private newGame(): void {
    this.clearTimer();
    this.botFailures = 0;
    const names: string[] = [this.humanName];
    for (let seat = 1; seat < this.seats; seat += 1) {
      names.push(BOT_NAMES[(seat - 1) % BOT_NAMES.length] ?? `Bot ${seat}`);
    }
    const bots = names.map((_, seat) => seat > 0);
    const difficulties = names.map((_, seat) => (seat > 0 ? this.difficulty : null));
    this.state = createGame({
      playerCount: this.seats,
      seed: randomSeed(),
      gameId: randomId(),
      names,
      bots,
      difficulties,
    });
    this.publish();
    this.scheduleBots();
  }

  private publish(): void {
    const state = this.state;
    if (!state) {
      this.update({ game: null, you: null, hostSeat: null });
      return;
    }
    this.update({
      game: viewFor(state, 0),
      you: 0,
      hostSeat: 0,
      roomCode: null,
      link: 'open',
      ready: true,
      serverVersion: GAME_VERSION,
      resuming: false,
    });
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One timer at a time, with the state captured so a stale timer cannot apply
   * an action to a board it no longer describes.
   */
  private scheduleBots(): void {
    this.clearTimer();
    if (this.disposed) return;
    const state = this.state;
    if (!state || state.phase === 'gameOver') return;
    const seat = this.nextBotSeat(state);
    if (seat === null) return;

    const [min, max] = BOT_DELAY;
    const delay = min + Math.floor(Math.random() * (max - min));
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      if (this.state !== state) return;
      this.stepBot(seat);
    }, delay);
  }

  /**
   * Mirrors the server's rule: mandatory discards first, then bot answers to an
   * open trade, then the current seat if a bot holds it. A human's owed discard
   * or trade answer leaves this null, which stops the timer until they act.
   */
  private nextBotSeat(state: GameState): Seat | null {
    const isBot = (seat: Seat): boolean => state.players[seat]?.isBot === true;

    if (state.phase === 'discard') {
      for (const seat of state.discardQueue) {
        if (isBot(seat)) return seat;
      }
      return null;
    }

    const offer = state.tradeOffer;
    if (offer) {
      for (const seat of offer.to) {
        if (seat !== offer.from && isBot(seat)) return seat;
      }
    }

    return isBot(state.currentSeat) ? state.currentSeat : null;
  }

  private stepBot(seat: Seat): void {
    const state = this.state;
    if (!state || state.phase === 'gameOver') return;

    const view = viewFor(state, seat);
    const difficulty = state.players[seat]?.botDifficulty ?? this.difficulty;
    let result = applyAction(state, seat, chooseBotAction(view, difficulty));

    if (!result.ok) {
      const emergency = emergencyAction(view);
      if (emergency) result = applyAction(state, seat, emergency);
    }

    if (!result.ok) {
      this.botFailures += 1;
      if (this.botFailures < MAX_BOT_FAILURES) this.scheduleBots();
      return;
    }

    this.botFailures = 0;
    this.state = result.state;
    this.publish();
    this.scheduleBots();
  }
}

/**
 * Last-resort legal move if the bot policy ever returns something the engine
 * rejects. Mirrors the server's fallback in spirit, not in code, so this file
 * stays independent of the room manager.
 */
function emergencyAction(view: GameView): GameAction | null {
  const legal = view.legal;
  const me = view.players[view.you];

  if (legal.discard && me) {
    const resources: PartialResources = {};
    let left = legal.discard.required;
    const order = [...RESOURCES].sort((a, b) => (me.resources[b] ?? 0) - (me.resources[a] ?? 0));
    for (const resource of order) {
      if (left <= 0) break;
      const take = Math.min(left, me.resources[resource] ?? 0);
      if (take > 0) {
        resources[resource] = take;
        left -= take;
      }
    }
    return left === 0 ? { type: 'discard', resources } : null;
  }

  if (legal.setupSettlements.length > 0) {
    return { type: 'setupSettlement', vertex: legal.setupSettlements[0] as string };
  }
  if (legal.setupRoads.length > 0) {
    return { type: 'setupRoad', edge: legal.setupRoads[0] as string };
  }  if (legal.canRoll) return { type: 'roll' };

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

  if (legal.canEndTurn) return { type: 'endTurn' };
  return null;
}
