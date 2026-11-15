/**
 * Balance simulator.
 *
 * Drives real games through `createGame` -> `viewFor` -> `chooseBotAction` ->
 * `applyAction`, including the two out-of-turn actions (discards after a seven
 * and trade responses), and reports enough per-game data to answer the balance
 * questions: how long games run, who wins from which seat, where the winner's
 * victory points came from, which piles actually sell, and how often a charter
 * was the thing that ended the game.
 *
 * `scripts/balance.ts` is the CLI wrapper. Kept under src/ so `npm run check`
 * type-checks it with the rest of the server code.
 */
import { applyAction, createGame, viewFor } from '../../shared/engine/index.js';
import { RESOURCES } from '../../shared/types.js';
import type {
  BotDifficulty,
  GameAction,
  GameState,
  ResourceMap,
  Seat,
  VpBreakdown,
} from '../../shared/types.js';
import { chooseBotAction } from './index.js';

export const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

export interface SimOptions {
  /** Games per (player count, difficulty) matchup. */
  games: number;
  playerCounts: number[];
  difficulties: BotDifficulty[];
  /** First seed; games use seed + index. */
  seed: number;
  /** Hard cap on accepted actions in one game before it is called a stall. */
  maxActions: number;
  /**
   * Extra head-to-head matchups: seat 0 gets the first difficulty, everyone
   * else the second. The odd seat rotates every game so positional bias
   * cancels out, and the bucket reports the odd seat's win rate.
   */
  mixed: Array<{ label: string; odd: BotDifficulty; rest: BotDifficulty }>;
}

export interface SimGameResult {
  gameId: string;
  playerCount: number;
  /** Bucket label: 'normal', 'easy-vs-normal', ... */
  difficulty: string;
  seatDifficulties: BotDifficulty[];
  /** Seat running the odd difficulty in a mixed bucket, null when homogeneous. */
  oddSeat: Seat | null;
  seed: number;
  winner: Seat | null;
  vpTarget: number;
  turns: number;
  rounds: number;
  actions: number;
  purchases: number[];
  pileBuys: Record<string, number>;
  vp: VpBreakdown[];
  winnerVp: number;
  winnerSplit: VpBreakdown | null;
  winnerBoardVp: number;
  winnerFinalResources: ResourceMap | null;
  awards: { longestRoad: Seat | null; largestExpedition: Seat | null };
  winningAction: string | null;
  charterPurchaseWon: boolean;
  chartersNeeded: boolean;
  emptyTurns: number;
  totalTurns: number;
  rejected: number;
  stall: string | null;
}

/** Whose turn it is, counting the two out-of-turn actions. */
function activeSeat(state: GameState): Seat {
  if (state.phase === 'discard' && state.discardQueue.length > 0) {
    return state.discardQueue[0] as Seat;
  }
  if (state.phase === 'action' && state.tradeOffer && state.tradeOffer.to.length > 0) {
    return state.tradeOffer.to[0] as Seat;
  }
  return state.currentSeat;
}

/** Turns where the acting player only rolled and ended. */
function countEmptyTurns(state: GameState): number {
  const active = new Map<number, boolean>();
  for (const entry of state.log) {
    if (entry.turn <= 0) continue;
    if (entry.kind === 'build' || entry.kind === 'card' || entry.kind === 'buy') {
      active.set(entry.turn, true);
    }
    if (entry.kind === 'trade' && entry.data?.['bank'] !== true) active.set(entry.turn, true);
  }
  let empty = 0;
  for (let turn = 1; turn < state.turn; turn += 1) if (!active.get(turn)) empty += 1;
  return empty;
}

export interface PlayOut {
  state: GameState;
  actions: number;
  rejected: number;
  stall: string | null;
  /** One line per accepted action: `seat:type[:detail]`. */
  trace: string[];
  pileBuys: Record<string, number>;
  winningAction: string | null;
}

/**
 * The game loop itself: ask the bot whose turn it is (or who owes a discard, or
 * who can answer an open offer), apply what it returns, repeat. Any rejection
 * stops the loop and is reported rather than retried, so a policy bug shows up
 * as one rejected action instead of an infinite game.
 */
export function playOutGame(
  initial: GameState,
  difficultyFor: (seat: Seat) => BotDifficulty,
  maxActions: number,
): PlayOut {
  let state = initial;
  const pileBuys: Record<string, number> = {};
  const trace: string[] = [];
  let actions = 0;
  let rejected = 0;
  let stall: string | null = null;
  let winningAction: string | null = null;
  let previousVersion = -1;
  let repeated = 0;

  while (state.phase !== 'gameOver') {
    if (actions >= maxActions) {
      stall = `action cap ${maxActions} in phase ${state.phase}`;
      break;
    }
    if (state.version === previousVersion) {
      repeated += 1;
      if (repeated > 2) {
        stall = 'state stopped advancing';
        break;
      }
    } else {
      repeated = 0;
      previousVersion = state.version;
    }

    const seat = activeSeat(state);
    const view = viewFor(state, seat);
    const action: GameAction = chooseBotAction(view, difficultyFor(seat));
    const result = applyAction(state, seat, action);
    if (!result.ok) {
      rejected += 1;
      stall = `${action.type} rejected: ${result.code} (${result.message})`;
      break;
    }
    trace.push(describeAction(seat, action));
    if (action.type === 'buyCard') {
      pileBuys[action.defId] = (pileBuys[action.defId] ?? 0) + 1;
    }
    state = result.state;
    actions += 1;
    if (state.phase === 'gameOver') {
      winningAction = action.type === 'buyCard' ? `buyCard:${action.defId}` : action.type;
    }
  }

  return { state, actions, rejected, stall, trace, pileBuys, winningAction };
}

function describeAction(seat: Seat, action: GameAction): string {
  switch (action.type) {
    case 'setupSettlement':
    case 'buildSettlement':
      return `${seat}:${action.type}:${action.vertex}`;
    case 'setupRoad':
    case 'buildRoad':
      return `${seat}:${action.type}:${action.edge}`;
    case 'buildCity':
      return `${seat}:buildCity:${action.vertex}`;
    case 'buyCard':
      return `${seat}:buyCard:${action.defId}`;
    case 'playCard':
      return `${seat}:playCard:${action.iid}`;
    case 'discard':
      return `${seat}:discard:${JSON.stringify(action.resources)}`;
    case 'moveRobber':
      return `${seat}:moveRobber:${action.hex}:${action.victimSeat ?? '-'}`;
    case 'bankTrade':
      return `${seat}:bankTrade:${action.count}${action.give}->${action.receive}`;
    case 'respondTrade':
      return `${seat}:respondTrade:${String(action.accept)}`;
    default:
      return `${seat}:${action.type}`;
  }
}

export function runGame(
  playerCount: number,
  seed: number,
  seatDifficulties: BotDifficulty[],
  maxActions: number,
  label?: string,
  oddSeat: Seat | null = null,
): SimGameResult {
  const seats = Array.from({ length: playerCount }, (_, index) => index);
  const difficultyFor = (seat: Seat): BotDifficulty =>
    seatDifficulties[seat] ?? seatDifficulties[0] ?? 'normal';
  const initial = createGame({
    playerCount,
    seed,
    bots: seats.map(() => true),
    difficulties: seats.map((seat) => difficultyFor(seat)),
    names: seats.map((seat) => `Bot ${seat + 1} (${difficultyFor(seat)})`),
  });
  const played = playOutGame(initial, difficultyFor, maxActions);
  const { state, actions, rejected, stall, pileBuys, winningAction } = played;

  const winner = state.winner;
  const winnerPlayer = winner === null ? null : state.players[winner] ?? null;
  const split = winnerPlayer ? winnerPlayer.vpBreakdown : null;
  const totalTurns = Math.max(0, state.turn - 1);

  return {
    gameId: state.gameId,
    playerCount,
    difficulty: label ?? seatDifficulties[0] ?? 'normal',
    seatDifficulties: seatDifficulties.slice(),
    oddSeat,
    seed,
    winner,
    vpTarget: state.config.targetVp,
    turns: totalTurns,
    rounds: Math.max(1, Math.round(totalTurns / Math.max(1, playerCount))),
    actions,
    purchases: state.players.map((player) => player.purchases),
    pileBuys,
    vp: state.players.map((player) => ({ ...player.vpBreakdown })),
    winnerVp: winnerPlayer?.vp ?? 0,
    winnerSplit: split ? { ...split } : null,
    winnerBoardVp: split ? split.settlements + split.cities : 0,
    winnerFinalResources: winnerPlayer ? { ...winnerPlayer.resources } : null,
    awards: {
      longestRoad: state.awards.longestRoad,
      largestExpedition: state.awards.largestExpedition,
    },
    winningAction,
    charterPurchaseWon: winningAction === 'buyCard:quay-deed' || winningAction === 'buyCard:fleet-charter',
    chartersNeeded: split ? split.charters > 0 && split.total - split.charters < state.config.targetVp : false,
    emptyTurns: countEmptyTurns(state),
    totalTurns,
    rejected,
    stall,
  };
}

export interface SimBucket {
  playerCount: number;
  difficulty: string;
  games: number;
  rejected: number;
  stalls: string[];
  medianTurns: number;
  medianRounds: number;
  medianActions: number;
  seatWins: number[];
  seatGames: number[];
  winnerVp: number;
  winnerSplit: { settlements: number; cities: number; charters: number; awards: number };
  boardShare: number;
  pileBuys: Record<string, number>;
  pileBuysPerGame: Record<string, number>;
  purchasesPerPlayer: number;
  charterPurchaseWins: number;
  fleetCharterWins: number;
  chartersNeededWins: number;
  winningActions: Record<string, number>;
  emptyTurnsPerGame: number;
  emptyTurnShare: number;
  awardHolders: { longestRoad: Record<string, number>; largestExpedition: Record<string, number> };
  winnerResources: number;
  /** Mixed buckets only: how often the odd-difficulty seat won. */
  oddWins: number;
  oddGames: number;
}

export interface SimReport {
  options: SimOptions;
  buckets: SimBucket[];
  results: SimGameResult[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function summarize(
  playerCount: number,
  difficulty: string,
  games: SimGameResult[],
): SimBucket {
  const seatCount = playerCount;
  const seatWins = new Array<number>(seatCount).fill(0);
  const seatGames = new Array<number>(seatCount).fill(0);
  const pileBuys: Record<string, number> = {};
  const longestRoad: Record<string, number> = {};
  const largestExpedition: Record<string, number> = {};
  let rejected = 0;
  let charterPurchaseWins = 0;
  let fleetCharterWins = 0;
  let chartersNeededWins = 0;
  const winningActions: Record<string, number> = {};
  let purchases = 0;
  let winnerVp = 0;
  let settlementVp = 0;
  let cityVp = 0;
  let charterVp = 0;
  let awardVp = 0;
  let boardVp = 0;
  let emptyTurns = 0;
  let totalTurns = 0;
  let winnerResources = 0;
  let oddWins = 0;
  let oddGames = 0;
  const stalls: string[] = [];

  for (const game of games) {
    rejected += game.rejected;
    if (game.stall) stalls.push(`${game.gameId}: ${game.stall}`);
    if (game.oddSeat !== null) {
      oddGames += 1;
      if (game.winner === game.oddSeat) oddWins += 1;
    }
    if (game.winner !== null) {
      seatWins[game.winner] = (seatWins[game.winner] ?? 0) + 1;
      const split = game.winnerSplit;
      if (split) {
        winnerVp += split.total;
        settlementVp += split.settlements;
        cityVp += split.cities;
        charterVp += split.charters;
        awardVp += split.longestRoad + split.largestExpedition;
        boardVp += game.winnerBoardVp;
      }
      if (game.winnerFinalResources) {
        for (const resource of RESOURCES) winnerResources += game.winnerFinalResources[resource];
      }
      if (game.charterPurchaseWon) charterPurchaseWins += 1;
      if (game.winningAction === 'buyCard:fleet-charter') fleetCharterWins += 1;
      if (game.winningAction) {
        winningActions[game.winningAction] = (winningActions[game.winningAction] ?? 0) + 1;
      }
      if (game.chartersNeeded) chartersNeededWins += 1;
      longestRoad[String(game.awards.longestRoad)] = (longestRoad[String(game.awards.longestRoad)] ?? 0) + 1;
      largestExpedition[String(game.awards.largestExpedition)] =
        (largestExpedition[String(game.awards.largestExpedition)] ?? 0) + 1;
    }
    for (let seat = 0; seat < seatCount; seat += 1) seatGames[seat] = (seatGames[seat] ?? 0) + 1;
    for (const [defId, count] of Object.entries(game.pileBuys)) {
      pileBuys[defId] = (pileBuys[defId] ?? 0) + count;
    }
    for (const count of game.purchases) purchases += count;
    emptyTurns += game.emptyTurns;
    totalTurns += game.totalTurns;
  }

  const gameCount = games.length;
  const pileBuysPerGame: Record<string, number> = {};
  for (const [defId, count] of Object.entries(pileBuys)) {
    pileBuysPerGame[defId] = round1(count / Math.max(1, gameCount));
  }

  return {
    playerCount,
    difficulty,
    games: gameCount,
    rejected,
    stalls,
    medianTurns: median(games.map((game) => game.turns)),
    medianRounds: median(games.map((game) => game.rounds)),
    medianActions: median(games.map((game) => game.actions)),
    seatWins,
    seatGames,
    winnerVp: round1(winnerVp / Math.max(1, gameCount)),
    winnerSplit: {
      settlements: round1(settlementVp / Math.max(1, gameCount)),
      cities: round1(cityVp / Math.max(1, gameCount)),
      charters: round1(charterVp / Math.max(1, gameCount)),
      awards: round1(awardVp / Math.max(1, gameCount)),
    },
    boardShare: round1((100 * boardVp) / Math.max(1, winnerVp)),
    pileBuys,
    pileBuysPerGame,
    purchasesPerPlayer: round1(purchases / Math.max(1, gameCount * playerCount)),
    charterPurchaseWins,
    fleetCharterWins,
    chartersNeededWins,
    winningActions,
    emptyTurnsPerGame: round1(emptyTurns / Math.max(1, gameCount)),
    emptyTurnShare: round1((100 * emptyTurns) / Math.max(1, totalTurns)),
    awardHolders: { longestRoad, largestExpedition },
    winnerResources: round1(winnerResources / Math.max(1, gameCount)),
    oddWins,
    oddGames,
  };
}

export function runBalance(options: Partial<SimOptions> = {}): SimReport {
  const resolved: SimOptions = {
    games: options.games ?? 10,
    playerCounts: options.playerCounts ?? [2, 3, 4],
    difficulties: options.difficulties ?? ['normal'],
    seed: options.seed ?? 1,
    maxActions: options.maxActions ?? 5000,
    mixed:
      options.mixed ?? [
        { label: 'easy-vs-normal', odd: 'easy', rest: 'normal' },
        { label: 'hard-vs-normal', odd: 'hard', rest: 'normal' },
      ],
  };

  const results: SimGameResult[] = [];
  const buckets: SimBucket[] = [];

  for (const difficulty of resolved.difficulties) {
    for (const playerCount of resolved.playerCounts) {
      const games: SimGameResult[] = [];
      for (let index = 0; index < resolved.games; index += 1) {
        const seed = resolved.seed + index;
        const game = runGame(
          playerCount,
          seed,
          Array.from({ length: playerCount }, () => difficulty),
          resolved.maxActions,
        );
        games.push(game);
        results.push(game);
      }
      buckets.push(summarize(playerCount, difficulty, games));
    }
  }

  for (const matchup of resolved.mixed) {
    for (const playerCount of resolved.playerCounts) {
      if (playerCount < 2) continue;
      const games: SimGameResult[] = [];
      for (let index = 0; index < resolved.games; index += 1) {
        const seed = resolved.seed + index;
        const oddSeat = index % playerCount;
        const perSeat: BotDifficulty[] = [];
        for (let seat = 0; seat < playerCount; seat += 1) {
          perSeat.push(seat === oddSeat ? matchup.odd : matchup.rest);
        }
        const game = runGame(playerCount, seed, perSeat, resolved.maxActions, matchup.label, oddSeat);
        games.push(game);
        results.push(game);
      }
      buckets.push(summarize(playerCount, matchup.label, games));
    }
  }

  return { options: resolved, buckets, results };
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function padLeft(value: string | number, width: number): string {
  return String(value).padStart(width);
}

/** Compact multi-section text report. */
export function formatReport(report: SimReport): string {
  const lines: string[] = [];
  const { options } = report;
  lines.push(
    `Days of Lorac balance sim — ${options.games} games per matchup, players ${options.playerCounts.join(
      '/',
    )}, difficulty ${options.difficulties.join('+')}, seeds ${options.seed}..${options.seed + options.games - 1}`,
  );
  lines.push('');

  lines.push('matchup            games  rej  stalls  turns  rounds  actions  buys/player  empty%');
  for (const bucket of report.buckets) {
    lines.push(
      `${pad(`${bucket.playerCount}p ${bucket.difficulty}`, 18)} ${padLeft(bucket.games, 5)} ${padLeft(
        bucket.rejected,
        4,
      )} ${padLeft(bucket.stalls.length, 7)} ${padLeft(bucket.medianTurns, 6)} ${padLeft(
        bucket.medianRounds,
        7,
      )} ${padLeft(bucket.medianActions, 8)} ${padLeft(bucket.purchasesPerPlayer, 12)} ${padLeft(
        bucket.emptyTurnShare,
        6,
      )}`,
    );
  }
  lines.push('');

  lines.push('win rate by seat (games each seat won / games played), then odd seat in mixed');
  for (const bucket of report.buckets) {
    const parts = bucket.seatWins.map(
      (wins, seat) =>
        `s${seat} ${wins}/${bucket.seatGames[seat] ?? 0} (${Math.round(
          (100 * wins) / Math.max(1, bucket.seatGames[seat] ?? 1),
        )}%)`,
    );
    const odd =
      bucket.oddGames > 0
        ? `   odd seat ${bucket.oddWins}/${bucket.oddGames} (${Math.round(
            (100 * bucket.oddWins) / Math.max(1, bucket.oddGames),
          )}%)`
        : '';
    lines.push(`  ${pad(`${bucket.playerCount}p ${bucket.difficulty}`, 18)} ${parts.join('  ')}${odd}`);
  }
  lines.push('');

  lines.push('average winner (VP and where it came from)');
  for (const bucket of report.buckets) {
    const split = bucket.winnerSplit;
    lines.push(
      `  ${pad(`${bucket.playerCount}p ${bucket.difficulty}`, 16)} vp ${padLeft(
        bucket.winnerVp,
        4,
      )}  settle ${padLeft(split.settlements, 4)}  cities ${padLeft(split.cities, 4)}  charter ${padLeft(
        split.charters,
        4,
      )}  awards ${padLeft(split.awards, 4)}  board ${padLeft(bucket.boardShare, 4)}%  final res ${padLeft(
        bucket.winnerResources,
        4,
      )}`,
    );
  }
  lines.push('');

  lines.push('purchases per game, by pile (median-ish: total / games)');
  const pileOrder = new Set<string>();
  for (const bucket of report.buckets) {
    for (const defId of Object.keys(bucket.pileBuysPerGame)) pileOrder.add(defId);
  }
  for (const defId of pileOrder) {
    const parts = report.buckets.map(
      (bucket) => `${bucket.playerCount}p:${bucket.difficulty} ${(bucket.pileBuysPerGame[defId] ?? 0).toFixed(1)}`,
    );
    lines.push(`  ${pad(defId, 16)} ${parts.join('   ')}`);
  }
  lines.push('');

  lines.push('award holders (count over all games in the bucket)');
  for (const bucket of report.buckets) {
    const road = Object.entries(bucket.awardHolders.longestRoad)
      .map(([seat, count]) => `${seat === 'null' ? 'none' : `s${seat}`}:${count}`)
      .join(' ');
    const expedition = Object.entries(bucket.awardHolders.largestExpedition)
      .map(([seat, count]) => `${seat === 'null' ? 'none' : `s${seat}`}:${count}`)
      .join(' ');
    lines.push(`  ${pad(`${bucket.playerCount}p ${bucket.difficulty}`, 16)} road ${pad(road, 34)} expedition ${expedition}`);
  }
  lines.push('');

  lines.push('how the winning point arrived (count per bucket, top 4)');
  for (const bucket of report.buckets) {
    const top = Object.entries(bucket.winningActions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([action, count]) => `${action} ${count}`)
      .join(', ');
    lines.push(`  ${pad(`${bucket.playerCount}p ${bucket.difficulty}`, 18)} ${top}`);
  }
  lines.push('');

  lines.push('endgame');
  for (const bucket of report.buckets) {
    lines.push(
      `  ${pad(`${bucket.playerCount}p ${bucket.difficulty}`, 18)} any charter won ${
        bucket.charterPurchaseWins
      }/${bucket.games}  fleet charter won ${bucket.fleetCharterWins}/${
        bucket.games
      }  charters required ${bucket.chartersNeededWins}/${bucket.games}`,
    );
  }
  lines.push('');

  const stalls = report.buckets.flatMap((bucket) => bucket.stalls);
  lines.push(`stalls: ${stalls.length}`);
  for (const stall of stalls.slice(0, 10)) lines.push(`  ${stall}`);

  return lines.join('\n');
}
