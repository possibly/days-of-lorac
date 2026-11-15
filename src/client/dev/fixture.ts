/**
 * Dev-only visual fixture. Not shipped as game data and never reached without
 * ?fixture=1 in a dev build. It plays the real engine into a mid-game state,
 * then hands the viewer a few choice cards so every flow can be inspected.
 */
import { applyAction, createGame, legalMoves, refreshDerived, viewFor } from '@shared/engine';
import type { GameAction, GameState, GameView } from '@shared/types';

export interface FixtureSession {
  view: GameView;
  apply: (action: GameAction) => GameView;
}

const GUARD = 200;

function apply(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, state.currentSeat, action);
  if (!result.ok) return state;
  return result.state;
}

function setupToEnd(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < GUARD && current.phase === 'setup'; i += 1) {
    const legal = legalMoves(current, current.currentSeat);
    if (current.setup?.step === 'settlement') {
      const vertex = legal.setupSettlements[0];
      if (!vertex) break;
      current = apply(current, { type: 'setupSettlement', vertex });
    } else {
      const edge = legal.setupRoads[0];
      if (!edge) break;
      current = apply(current, { type: 'setupRoad', edge });
    }
  }
  return current;
}

function playSeatTurn(state: GameState, seat: number): GameState {
  let current = state;
  for (let i = 0; i < 40; i += 1) {
    if (current.phase === 'gameOver' || current.currentSeat !== seat) return current;
    if (current.phase === 'discard') {
      const legal = legalMoves(current, seat);
      if (legal.discard) {
        const player = current.players[seat];
        const resources: Record<string, number> = {};
        let left = legal.discard.required;
        if (player) {
          for (const [resource, count] of Object.entries(player.resources)) {
            if (left <= 0) break;
            const take = Math.min(left, count);
            if (take > 0) {
              resources[resource] = take;
              left -= take;
            }
          }
        }
        current = apply(current, { type: 'discard', resources });
        continue;
      }
      break;
    }
    if (current.phase === 'robber') {
      const legal = legalMoves(current, seat);
      const hex = legal.robber?.hexes[0];
      if (!hex) break;
      current = apply(current, { type: 'moveRobber', hex });
      continue;
    }
    if (current.phase === 'roll') {
      current = apply(current, { type: 'roll' });
      continue;
    }
    if (current.phase === 'action') {
      const legal = legalMoves(current, seat);
      const card = legal.playable.find((entry) => entry.choice === null);
      if (card) {
        current = apply(current, { type: 'playCard', iid: card.iid });
        continue;
      }
      const buy = legal.buyable[0];
      if (buy) {
        current = apply(current, { type: 'buyCard', defId: buy });
        continue;
      }
      const city = legal.build.cities[0];
      if (city && legal.build.affordable.city) {
        current = apply(current, { type: 'buildCity', vertex: city });
        continue;
      }
      const settlement = legal.build.settlements[0];
      if (settlement && legal.build.affordable.settlement) {
        current = apply(current, { type: 'buildSettlement', vertex: settlement });
        continue;
      }
      const road = legal.build.roads[0];
      if (road && legal.build.affordable.road) {
        current = apply(current, { type: 'buildRoad', edge: road });
        continue;
      }
      current = apply(current, { type: 'endTurn' });
      return current;
    }
    break;
  }
  return current;
}

/** Dev fixture only: clear every owed discard so the fixture never stalls. */
function resolveAllDiscards(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 8; i += 1) {
    if (current.phase !== 'discard' || current.discardQueue.length === 0) return current;
    const seat = current.discardQueue[0];
    if (seat === undefined) return current;
    const player = current.players[seat];
    const need = current.discardRequired[seat] ?? 0;
    if (!player || need === 0) return current;
    const resources: Record<string, number> = {};
    let left = need;
    for (const [resource, count] of Object.entries(player.resources)) {
      if (left <= 0) break;
      const take = Math.min(left, count);
      if (take > 0) {
        resources[resource] = take;
        left -= take;
      }
    }
    const result = applyAction(current, seat, { type: 'discard', resources });
    if (!result.ok) return current;
    current = result.state;
  }
  return current;
}

function injectShowcaseHand(state: GameState): GameState {
  const clone = JSON.parse(JSON.stringify(state)) as GameState;
  const you = clone.players[0];
  if (!you) return state;
  const showcase = ['provisioner', 'guild-mason', "shipwrights-yard", 'wreckers-lamp', 'salvage-yard', 'quay-deed'];
  you.hand = showcase.map((defId, index) => ({ iid: 9000 + index, defId }));
  you.resources = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  you.deck = clone.players[0]?.deck ?? [];
  refreshDerived(clone);
  return clone;
}

export type FixtureMode = 'setup' | 'mid' | 'discard' | 'over' | 'robber' | 'offer';

export function createFixture(mode: FixtureMode = 'mid'): FixtureSession {
  let state = createGame({
    playerCount: 4,
    seed: 4242,
    names: ['Maren', 'Kell', 'Osric', 'Tally'],
    bots: [false, true, true, true],
    difficulties: [null, 'normal', 'normal', 'hard'],
  });
  if (mode === 'setup') {
    return fixtureFrom(state);
  }
  state = setupToEnd(state);
  if (mode === 'over') {
    for (let round = 0; round < 220 && state.phase !== 'gameOver'; round += 1) {
      state = playSeatTurn(state, state.currentSeat);
      state = resolveAllDiscards(state);
    }
    return fixtureFrom(state);
  }
  for (let round = 0; round < 10; round += 1) {
    if (state.phase === 'gameOver') break;
    state = playSeatTurn(state, state.currentSeat);
    state = resolveAllDiscards(state);
  }
  let guard = 0;
  while (state.currentSeat !== 0 && state.phase !== 'gameOver' && guard < 8) {
    state = playSeatTurn(state, state.currentSeat);
    state = resolveAllDiscards(state);
    guard += 1;
  }
  state = injectShowcaseHand(state);
  if (mode === 'robber' || mode === 'offer') {
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    clone.phase = 'action';
    clone.currentSeat = 0;
    clone.dice = { die1: 3, die2: 4, total: 7, gains: { 0: {}, 1: {}, 2: {}, 3: {} }, blockedByRobber: [] };
    if (mode === 'robber') {
      clone.phase = 'robber';
      clone.discardQueue = [];
      clone.discardRequired = { 0: 0, 1: 0, 2: 0, 3: 0 };
    } else {
      const kell = clone.players[1];
      if (kell) kell.resources = { wood: 3, brick: 0, sheep: 0, wheat: 0, ore: 2 };
      clone.tradeOffer = {
        id: 'offer-fixture',
        from: 1,
        give: { wood: 2 },
        want: { ore: 1 },
        to: [0],
        createdTurn: clone.turn,
      };
    }
    state = clone;
  }
  if (mode === 'discard') {
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    const you = clone.players[0];
    if (you) {
      you.resources = { wood: 4, brick: 3, sheep: 3, wheat: 2, ore: 1 };
      clone.phase = 'discard';
      clone.discardQueue = [0];
      clone.discardRequired = { 0: 6, 1: 0, 2: 0, 3: 0 };
      clone.dice = { die1: 3, die2: 4, total: 7, gains: { 0: {}, 1: {}, 2: {}, 3: {} }, blockedByRobber: [] };
      state = clone;
    }
  }
  return fixtureFrom(state);
}

function fixtureFrom(initial: GameState): FixtureSession {
  let state = initial;
  return {
    view: viewFor(state, 0),
    apply(action: GameAction): GameView {
      const result = applyAction(state, 0, action);
      if (!result.ok) return viewFor(state, 0);
      state = result.state;
      let guard = 0;
      while (state.currentSeat !== 0 && state.phase !== 'gameOver' && guard < 8) {
        state = playSeatTurn(state, state.currentSeat);
        state = resolveAllDiscards(state);
        guard += 1;
      }
      return viewFor(state, 0);
    },
  };
}
