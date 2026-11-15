/**
 * Bot policy tests.
 *
 * Two layers:
 *   1. full games through the real engine with the real policy, asserting no
 *      rejected action, no stall, no hidden-information leak and deterministic
 *      replay;
 *   2. targeted unit tests on the decisions that are easy to get subtly wrong:
 *      the Provisioner pick, the discard, the robber target, the trade
 *      threshold, the charter gate, and the phase fallbacks.
 */
import { describe, expect, it } from 'vitest';
import { boardIndex } from '../../../shared/engine/board.js';
import {
  applyAction,
  cloneState,
  createGame,
  legalMoves,
  refreshDerived,
  viewFor,
} from '../../../shared/engine/index.js';
import type {
  BotDifficulty,
  GameState,
  PartialResources,
  PlayableCard,
  ResourceMap,
  Seat,
  VertexId,
} from '../../../shared/types.js';
import { CARD_BY_ID } from '../../../shared/cards.js';
import { chooseProvisionerResources, choosePurchase } from '../cards.js';
import { chooseDiscard } from '../discard.js';
import { chooseBotAction, isLegalAction } from '../index.js';
import { bestRobberTarget } from '../robber.js';
import { Sense } from '../sense.js';
import { formatReport, playOutGame, runBalance, runGame } from '../simulate.js';
import { maybeOfferTrade } from '../trade.js';
import { BOT_WEIGHTS, weightsFor } from '../weights.js';

const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

function patch(state: GameState, edit: (draft: GameState) => void): GameState {
  const draft = cloneState(state);
  edit(draft);
  refreshDerived(draft);
  return draft;
}

/** Runs the draft with the bot so tests start from a normal board. */
function afterSetup(playerCount: number, seed: number, difficulty: BotDifficulty = 'normal'): GameState {
  let state = createGame({ playerCount, seed });
  let guard = 0;
  while (state.phase === 'setup') {
    const seat = state.currentSeat;
    const action = chooseBotAction(viewFor(state, seat), difficulty);
    const result = applyAction(state, seat, action);
    if (!result.ok) throw new Error(`setup rejected: ${result.code}`);
    state = result.state;
    guard += 1;
    if (guard > 40) throw new Error('setup did not finish');
  }
  return state;
}

function plainResources(): ResourceMap {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

function fullResources(set: PartialResources): ResourceMap {
  return { ...plainResources(), ...set };
}

/**
 * A charter mix worth exactly `need` VP, capped at the printed copy counts.
 * Bot tests that want a player one purchase from winning ask for
 * `targetVp - 2 - boardVp` instead of hardcoding copies, so a retarget or a
 * copy-count change does not silently turn the test into a different scenario.
 */
function chartersWorthVp(need: number): Record<string, number> {
  const fleet = CARD_BY_ID.get('fleet-charter')?.vp ?? 2;
  const quay = CARD_BY_ID.get('quay-deed')?.vp ?? 1;
  const fleets = Math.max(0, Math.min(4, Math.floor(need / fleet)));
  const quays = Math.max(0, Math.round((need - fleets * fleet) / quay));
  return { 'fleet-charter': fleets, 'quay-deed': quays };
}

/** VP that comes from buildings, ignoring charters and awards. */
function boardVp(state: GameState, seat: Seat): number {
  const breakdown = state.players[seat]?.vpBreakdown;
  if (!breakdown) return 0;
  return breakdown.settlements + breakdown.cities;
}

// ---------------------------------------------------------------------------
// Full games
// ---------------------------------------------------------------------------

describe('bot policy: full games', () => {
  const cases: Array<{ playerCount: number; difficulty: BotDifficulty }> = [];
  for (const playerCount of [2, 3, 4]) {
    for (const difficulty of DIFFICULTIES) {
      cases.push({ playerCount, difficulty });
      cases.push({ playerCount, difficulty });
    }
  }
  // 18 games: two per (player count, difficulty) pair.
  expect(cases.length).toBe(18);

  it('plays every difficulty to a finish without a rejected action or a stall', () => {
    const results = cases.map(({ playerCount, difficulty }, index) =>
      runGame(playerCount, 100 + index, new Array<BotDifficulty>(playerCount).fill(difficulty), 3000),
    );

    for (const result of results) {
      expect(result.rejected, `${result.gameId} rejected an action: ${result.stall ?? ''}`).toBe(0);
      expect(result.stall, `${result.gameId}`).toBeNull();
      expect(result.winner, `${result.gameId} produced no winner`).not.toBeNull();
      expect(result.winnerVp).toBeGreaterThanOrEqual(result.vpTarget);
      expect(result.turns).toBeGreaterThan(8);
      expect(result.actions).toBeGreaterThan(50);
    }

    const winners = new Set(results.map((result) => result.winner));
    expect(winners.size).toBeGreaterThan(1);
  });

  it('only ever emits actions the engine accepts, in every phase', () => {
    for (const playerCount of [2, 3, 4]) {
      let state = createGame({ playerCount, seed: 900 + playerCount });
      let previousVersion = -1;
      const seenPhases = new Set<string>();

      for (let step = 0; step < 2500 && state.phase !== 'gameOver'; step += 1) {
        expect(state.version, 'state must advance every action').toBeGreaterThan(previousVersion);
        previousVersion = state.version;

        let seat: Seat = state.currentSeat;
        if (state.phase === 'discard' && state.discardQueue.length > 0) {
          seat = state.discardQueue[0] as Seat;
        } else if (state.phase === 'action' && state.tradeOffer && state.tradeOffer.to.length > 0) {
          seat = state.tradeOffer.to[0] as Seat;
        }

        const view = viewFor(state, seat);
        seenPhases.add(state.phase);
        const action = chooseBotAction(view, 'normal');
        expect(isLegalAction(view, action), `${action.type} in ${state.phase}`).toBe(true);

        const result = applyAction(state, seat, action);
        expect(result.ok, `${action.type}: ${result.ok ? '' : result.message}`).toBe(true);
        if (!result.ok) break;
        state = result.state;
      }

      expect(seenPhases.has('setup')).toBe(true);
      expect(seenPhases.has('roll')).toBe(true);
      expect(seenPhases.has('action')).toBe(true);
      expect(state.phase).toBe('gameOver');
    }
  });

  it('replays identically for a fixed seed', () => {
    for (const playerCount of [2, 4]) {
      const first = runGame(playerCount, 4242, new Array<BotDifficulty>(playerCount).fill('normal'), 3000);
      const second = runGame(playerCount, 4242, new Array<BotDifficulty>(playerCount).fill('normal'), 3000);
      expect(second.winner).toBe(first.winner);
      expect(second.turns).toBe(first.turns);
      expect(second.actions).toBe(first.actions);
      expect(second.pileBuys).toEqual(first.pileBuys);
    }

    const initial = createGame({ playerCount: 3, seed: 77 });
    const a = playOutGame(initial, () => 'hard', 3000);
    const b = playOutGame(initial, () => 'hard', 3000);
    expect(b.trace).toEqual(a.trace);
    expect(b.state.log.length).toBe(a.state.log.length);
  });

  it('never reads another seat\'s hidden cards', () => {
    // Two states that differ only in hidden information (other players' hands,
    // every deck order, the viewer's discard pile) produce the same view for
    // the seat, so the policy, which only sees the view, must answer the same.
    const state = afterSetup(4, 31337);
    let checked = 0;

    let current = state;
    for (let step = 0; step < 400 && current.phase !== 'gameOver'; step += 1) {
      let seat: Seat = current.currentSeat;
      if (current.phase === 'discard' && current.discardQueue.length > 0) {
        seat = current.discardQueue[0] as Seat;
      }
      const view = viewFor(current, seat);
      const action = chooseBotAction(view, 'normal');

      const scrambled = cloneState(current);
      for (const player of scrambled.players) {
        // The viewer's own hand is visible, so leave it alone. Everything else
        // here is hidden from the viewer by `viewFor`.
        if (player.seat !== seat) {
          for (const card of player.hand) card.defId = 'start-ore';
        }
        for (const card of player.deck) card.defId = 'start-wood';
        player.deck.reverse();
        player.discard.reverse();
        for (const card of player.discard) card.defId = 'start-sheep';
      }
      const scrambledView = viewFor(scrambled, seat);
      expect(JSON.stringify(scrambledView)).toBe(JSON.stringify(view));
      expect(chooseBotAction(scrambledView, 'normal')).toEqual(action);
      checked += 1;

      const result = applyAction(current, seat, action);
      if (!result.ok) throw new Error(`${action.type} rejected: ${result.code}`);
      current = result.state;
    }

    expect(checked).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

describe('bot policy: card choices', () => {
  it('Provisioner picks the resources the next settlement is missing', () => {
    const state = patch(createGame({ playerCount: 4, seed: 11 }), (draft) => {
      draft.players[0]!.resources = { wood: 0, brick: 0, sheep: 3, wheat: 3, ore: 2 };
    });
    const sense = new Sense(viewFor(state, 0));
    const picks = chooseProvisionerResources(sense);
    expect([...picks].sort()).toEqual(['brick', 'wood']);
  });

  it('Provisioner takes the scarce resource when the build set is already complete', () => {
    const state = patch(createGame({ playerCount: 4, seed: 12 }), (draft) => {
      draft.players[0]!.resources = { wood: 2, brick: 2, sheep: 2, wheat: 2, ore: 0 };
    });
    const sense = new Sense(viewFor(state, 0));
    const picks = chooseProvisionerResources(sense);
    expect(picks).toContain('ore');
  });

});

describe('bot policy: discard', () => {
  it('keeps a complete settlement set and dumps surplus wood', () => {
    const state = patch(createGame({ playerCount: 4, seed: 21 }), (draft) => {
      draft.players[0]!.resources = { wood: 6, brick: 3, sheep: 1, wheat: 2, ore: 1 };
      draft.discardQueue = [0];
      draft.discardRequired = { 0: 3, 1: 0, 2: 0, 3: 0 };
      draft.phase = 'discard';
    });
    const sense = new Sense(viewFor(state, 0));
    const discard = chooseDiscard(sense, 3);
    expect(discard).toEqual({ wood: 3 });
  });

  it('discards exactly the required count and never below zero', () => {
    const state = patch(createGame({ playerCount: 3, seed: 22 }), (draft) => {
      draft.players[0]!.resources = { wood: 3, brick: 4, sheep: 5, wheat: 1, ore: 2 };
      draft.discardQueue = [0];
      draft.discardRequired = { 0: 7, 1: 0, 2: 0 };
      draft.phase = 'discard';
    });
    const sense = new Sense(viewFor(state, 0));
    const action = chooseBotAction(viewFor(state, 0), 'normal');
    expect(action.type).toBe('discard');
    if (action.type !== 'discard') return;
    let total = 0;
    for (const value of Object.values(action.resources)) total += value ?? 0;
    expect(total).toBe(7);
    expect(chooseDiscard(sense, 7)).toEqual(action.resources);
  });
});

describe('bot policy: robber', () => {
  it('targets the leader\'s best hex and steals from the leader', () => {
    const base = afterSetup(4, 55);
    const index = boardIndex(base.board);

    // Highest-pip hex with no building of ours on it.
    const mine = new Set<VertexId>();
    for (const [vertexId, building] of Object.entries(base.buildings)) {
      if (building.owner === 0) for (const hexId of index.hexesByVertex.get(vertexId) ?? []) mine.add(hexId);
    }
    let targetHex: string | null = null;
    let targetVertex: VertexId | null = null;
    let bestPips = -1;
    for (const hex of base.board.hexes) {
      if (mine.has(hex.id) || hex.token === null) continue;
      const ways = hex.token === 6 || hex.token === 8 ? 5 : 3;
      if (ways > bestPips) {
        bestPips = ways;
        targetHex = hex.id;
        targetVertex = hex.vertices[0] ?? null;
      }
    }
    expect(targetHex).not.toBeNull();

    const state = patch(base, (draft) => {
      if (targetVertex) draft.buildings[targetVertex] = { owner: 1, type: 'city' };
      draft.players[1]!.charters = { 'fleet-charter': 2 };
      draft.phase = 'robber';
      draft.currentSeat = 0;
      draft.players[0]!.resources = { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 };
    });

    const view = viewFor(state, 0);
    expect(view.legal.robber).not.toBeNull();
    const action = chooseBotAction(view, 'normal');
    expect(action.type).toBe('moveRobber');
    if (action.type !== 'moveRobber') return;
    expect(action.hex).toBe(targetHex);
    expect(action.victimSeat).toBe(1);
  });

  it('prefers a rival\'s hex over one of its own', () => {
    const base = createGame({ playerCount: 4, seed: 56 });
    // Two equivalent hexes, one built on by the bot and one by the leader.
    const index = boardIndex(base.board);
    const candidates = base.board.hexes.filter((hex) => hex.id !== base.robberHex && hex.terrain !== 'desert');
    const mineHex = candidates[0]!;
    const rivalHex = candidates[1]!;
    // A vertex that touches only this hex, so the building cannot also sit on a
    // richer neighbour and change the answer.
    const lonelyVertex = (hex: { vertices: string[] }): string => {
      const single = hex.vertices.find((vertex) => (index.hexesByVertex.get(vertex) ?? []).length === 1);
      return single ?? (hex.vertices[0] as string);
    };
    const state = patch(base, (draft) => {
      draft.buildings = {};
      draft.roads = {};
      draft.buildings[lonelyVertex(mineHex)] = { owner: 0, type: 'settlement' };
      draft.buildings[lonelyVertex(rivalHex)] = { owner: 1, type: 'settlement' };
      draft.players[1]!.charters = { 'fleet-charter': 2 };
      draft.phase = 'robber';
      draft.currentSeat = 0;
    });
    expect(state.players[1]!.vp).toBeGreaterThan(state.players[0]!.vp);

    const view = viewFor(state, 0);
    const sense = new Sense(view);
    expect(view.legal.robber).not.toBeNull();
    const hexes = view.legal.robber?.hexes ?? [];
    const { target } = bestRobberTarget(sense, hexes, view.legal.robber?.victims, weightsFor('normal'));
    expect(target).not.toBeNull();
    if (!target) return;
    expect(target.hex).toBe(rivalHex.id);
    expect(target.victimSeat).toBe(1);
  });
});

describe('bot policy: trades', () => {
  function offerState(give: PartialResources, want: PartialResources, held: PartialResources): GameState {
    const base = afterSetup(4, 71);
    return patch(base, (draft) => {
      draft.phase = 'action';
      draft.currentSeat = 1;
      draft.players[0]!.resources = fullResources(held);
      draft.tradeOffer = {
        id: 'offer-test',
        from: 1,
        give,
        want,
        to: [0, 2, 3],
        createdTurn: draft.turn,
      };
    });
  }

  it('accepts an offer that is clearly worth more than it costs', () => {
    const state = offerState({ wood: 2 }, { sheep: 1 }, { wood: 1, brick: 1, sheep: 4, wheat: 1, ore: 1 });
    const action = chooseBotAction(viewFor(state, 0), 'normal');
    expect(action.type).toBe('respondTrade');
    if (action.type !== 'respondTrade') return;
    expect(action.accept).toBe(true);
    expect(action.offerId).toBe('offer-test');
  });

  it('declines an offer that would strip a build set', () => {
    const state = offerState({ sheep: 1 }, { wood: 3 }, { wood: 4, brick: 1, sheep: 1, wheat: 1, ore: 0 });
    const action = chooseBotAction(viewFor(state, 0), 'normal');
    expect(action.type).toBe('respondTrade');
    if (action.type !== 'respondTrade') return;
    expect(action.accept).toBe(false);
  });

  it('declines when it cannot pay', () => {
    const state = offerState({ wood: 1 }, { ore: 2 }, { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 0 });
    const action = chooseBotAction(viewFor(state, 0), 'easy');
    expect(action.type).toBe('respondTrade');
    if (action.type !== 'respondTrade') return;
    expect(action.accept).toBe(false);
  });

  it('offers a surplus resource for the one that completes the next build', () => {
    const base = afterSetup(4, 70);
    const state = patch(base, (draft) => {
      draft.phase = 'action';
      draft.currentSeat = 0;
      draft.turn = 8;
      draft.players[0]!.resources = { wood: 0, brick: 2, sheep: 6, wheat: 2, ore: 1 };
      draft.tradeOffer = null;
      draft.turnFlags = { rolled: true, purchased: false };
    });
    const action = maybeOfferTrade(new Sense(viewFor(state, 0)), weightsFor('normal'));
    expect(action).not.toBeNull();
    if (!action) return;
    expect(action.type).toBe('offerTrade');
    if (action.type !== 'offerTrade') return;
    expect(action.want).toEqual({ wood: 1 });
    expect(action.give).toEqual({ sheep: 1 });
  });

  it('does not hand the leader the win', () => {
    const base = afterSetup(4, 72);
    const state = patch(base, (draft) => {
      draft.phase = 'action';
      draft.currentSeat = 1;
      // Seat 1 is one charter away from the target, so accepting a wood for
      // sheep trade would hand it the win.
      draft.players[1]!.charters = chartersWorthVp(
        draft.config.targetVp - 2 - boardVp(draft, 1),
      );
      draft.players[0]!.resources = { wood: 1, brick: 1, sheep: 4, wheat: 1, ore: 1 };
      draft.tradeOffer = {
        id: 'offer-leader',
        from: 1,
        give: { wood: 2 },
        want: { sheep: 1 },
        to: [0, 2, 3],
        createdTurn: draft.turn,
      };
    });
    expect(state.players[1]!.vp).toBe(state.config.targetVp - 2);
    const action = chooseBotAction(viewFor(state, 0), 'hard');
    expect(action.type).toBe('respondTrade');
    if (action.type !== 'respondTrade') return;
    expect(action.accept).toBe(false);
  });
});

describe('bot policy: purchases', () => {
  it('does not buy charters before turn 6 even when they are the only thing on the shelf', () => {
    const base = afterSetup(4, 80);
    const early = patch(base, (draft) => {
      draft.phase = 'action';
      draft.currentSeat = 0;
      draft.turn = 3;
      draft.players[0]!.resources = { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 };
      draft.players[0]!.charters = { 'fleet-charter': 2 };
      for (const key of Object.keys(draft.market)) draft.market[key] = 0;
      draft.market['quay-deed'] = 8;
      draft.market['fleet-charter'] = 4;
      draft.turnFlags = { rolled: true, purchased: false };
    });
    expect(choosePurchase(new Sense(viewFor(early, 0)), weightsFor('normal'))).toBeNull();

    const late = patch(early, (draft) => {
      draft.turn = 9;
    });
    const buy = choosePurchase(new Sense(viewFor(late, 0)), weightsFor('normal'));
    expect(buy).not.toBeNull();
    expect(buy?.type).toBe('buyCard');
  });

  it('takes a charter that wins the game on the spot', () => {
    const base = afterSetup(4, 81);
    const state = patch(base, (draft) => {
      draft.phase = 'action';
      draft.currentSeat = 0;
      draft.turn = 9;
      // One fleet charter short of the target: buying it wins on the spot.
      draft.players[0]!.charters = chartersWorthVp(
        draft.config.targetVp - (CARD_BY_ID.get('fleet-charter')?.vp ?? 2) - boardVp(draft, 0),
      );
      draft.players[0]!.resources = { wood: 3, brick: 3, sheep: 1, wheat: 3, ore: 3 };
      // Cards are free to play and go first, so empty the hand to get straight
      // to the closing purchase.
      draft.players[0]!.hand = [];
      draft.players[0]!.played = [];
      for (const key of Object.keys(draft.market)) draft.market[key] = 0;
      draft.market['fleet-charter'] = 1;
      draft.turnFlags = { rolled: true, purchased: false };
    });
    expect(state.players[0]!.vp).toBe(state.config.targetVp - 2);
    const action = chooseBotAction(viewFor(state, 0), 'normal');
    expect(action.type).toBe('buyCard');
    if (action.type !== 'buyCard') return;
    expect(action.defId).toBe('fleet-charter');
  });
});

describe('bot policy: phase fallbacks', () => {
  it('rolls when it owes a roll', () => {
    const base = afterSetup(4, 90);
    expect(chooseBotAction(viewFor(base, base.currentSeat), 'normal').type).toBe('roll');
  });

  it('ends the turn when nothing is legal', () => {
    const base = afterSetup(4, 91);
    const state = patch(base, (draft) => {
      draft.phase = 'action';
      draft.currentSeat = 0;
      draft.players[0]!.hand = [];
      draft.players[0]!.resources = plainResources();
      for (const key of Object.keys(draft.market)) draft.market[key] = 0;
      draft.tradeOffer = null;
      draft.turnFlags = { rolled: true, purchased: true };
    });
    const view = viewFor(state, 0);
    expect(view.legal.canEndTurn).toBe(true);
    expect(chooseBotAction(view, 'normal')).toEqual({ type: 'endTurn' });
  });

  it('answers endTurn defensively once the game is over', () => {
    const base = afterSetup(3, 92);
    const state = patch(base, (draft) => {
      draft.winner = 1;
      draft.phase = 'gameOver';
      draft.players[1]!.charters = { 'fleet-charter': 4 };
    });
    expect(chooseBotAction(viewFor(state, 0), 'normal')).toEqual({ type: 'endTurn' });
  });

  it('plays every card in hand, charters never', () => {
    const base = afterSetup(4, 93);
    const state = patch(base, (draft) => {
      draft.phase = 'action';
      draft.currentSeat = 0;
      draft.turnFlags = { rolled: true, purchased: true };
      draft.tradeOffer = null;
    });
    const view = viewFor(state, 0);
    const legality = legalMoves(state, 0);
    const charters = view.players[0]!.hand?.filter((card) => card.defId.includes('charter')) ?? [];
    for (const card of charters) {
      const playable = legality.playable.find((entry: PlayableCard) => entry.iid === card.iid);
      expect(playable).toBeUndefined();
    }
  });
});

describe('bot policy: difficulty', () => {
  it('easy drafts worse land than normal and hard', () => {
    let normalBetter = 0;
    let differing = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const first = createGame({ playerCount: 4, seed: 2000 + seed });
      // The seeded first seat can be a bot, so view for whoever picks first.
      const view = viewFor(first, first.currentSeat);
      const index = boardIndex(first.board);
      const pipsOf = (vertex: string): number => {
        let total = 0;
        for (const hexId of index.hexesByVertex.get(vertex) ?? []) {
          const hex = index.hex.get(hexId);
          if (!hex || hex.token === null) continue;
          total += hex.token === 6 || hex.token === 8 ? 5 : 1;
        }
        return total;
      };
      const easy = chooseBotAction(view, 'easy');
      const normal = chooseBotAction(view, 'normal');
      if (easy.type !== 'setupSettlement' || normal.type !== 'setupSettlement') continue;
      if (easy.vertex !== normal.vertex) differing += 1;
      if (pipsOf(normal.vertex) >= pipsOf(easy.vertex)) normalBetter += 1;
    }
    expect(differing).toBeGreaterThan(2);
    expect(normalBetter).toBeGreaterThanOrEqual(16);
  });

  it('keeps every difficulty on the same policy shape', () => {
    for (const difficulty of DIFFICULTIES) {
      const weights = weightsFor(difficulty);
      expect(weights.setupDiscipline).toBe(1);
      expect(weights.charterTurn).toBeGreaterThanOrEqual(5);
      expect(weights.tradeAcceptRatio).toBeGreaterThanOrEqual(0.6);
    }
    expect(BOT_WEIGHTS.easy.discipline).toBe(0);
    expect(BOT_WEIGHTS.normal.discipline).toBe(1);
    expect(BOT_WEIGHTS.hard.discipline).toBe(1);
    // Hard projects a turn ahead; normal does not.
   expect(BOT_WEIGHTS.hard.lookahead).toBeGreaterThan(0);
    expect(BOT_WEIGHTS.normal.lookahead).toBe(0);
  });
});

describe('balance simulator', () => {
  it('summarises a small run', () => {
    const report = runBalance({ games: 2, playerCounts: [4], difficulties: ['normal'], seed: 5, mixed: [] });
    expect(report.buckets).toHaveLength(1);
    const bucket = report.buckets[0]!;
    expect(bucket.games).toBe(2);
    expect(bucket.rejected).toBe(0);
    expect(bucket.stalls).toHaveLength(0);
    expect(bucket.seatWins.reduce((sum, wins) => sum + wins, 0)).toBe(2);
    const text = formatReport(report);
    expect(text).toContain('win rate by seat');
    expect(text).toContain('purchases per game');
    expect(text).toContain('stalls: 0');
  });
});
