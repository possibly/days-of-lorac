import { describe, expect, it } from 'vitest';
import type { EdgeId, GameState, VertexId } from '../../types.js';
import { applyAction, bestBankRate, legalMoves } from '../index.js';
import {
  act,
  actionGame,
  extendToSettlement,
  newGame,
  patch,
  reject,
  setHand,
  setNextRoll,
  setResources,
  setupGame,
} from './helpers.js';

function expectAccepted(state: GameState, seat: number, action: Parameters<typeof applyAction>[2]): void {
  const result = applyAction(state, seat, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.code} - ${result.message}`);
}

describe('legalMoves matches the engine', () => {
  it('offers exactly the setup settlements and roads the engine accepts', () => {
    let state = newGame(3, 500);
    const settlements = legalMoves(state, 0).setupSettlements;
    expect(settlements.length).toBeGreaterThan(0);
    for (const vertex of settlements) expectAccepted(state, 0, { type: 'setupSettlement', vertex });
    // A non-listed vertex that is empty but too close must be rejected.
    expect(legalMoves(state, 1).setupSettlements).toEqual([]);

    const vertex = settlements[0] as VertexId;
    state = act(state, 0, { type: 'setupSettlement', vertex });
    const roads = legalMoves(state, 0).setupRoads;
    expect(roads.length).toBeGreaterThan(0);
    for (const edge of roads) expectAccepted(state, 0, { type: 'setupRoad', edge });
  });

  it('offers only buildable, affordable and legal placements', () => {
    let state = actionGame(4, 501);
    state = setResources(state, 0, { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 });
    const legal = legalMoves(state, 0);
    expect(legal.build.roads.length).toBeGreaterThan(0);
    expect(legal.build.affordable).toEqual({ road: true, settlement: true, city: true });
    for (const edge of legal.build.roads) expectAccepted(state, 0, { type: 'buildRoad', edge });
    for (const vertex of legal.build.cities) expectAccepted(state, 0, { type: 'buildCity', vertex });

    const extended = extendToSettlement(state, 0);
    const funded = setResources(extended.state, 0, { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 });
    const withSpot = legalMoves(funded, 0);
    expect(withSpot.build.settlements).toContain(extended.vertex);
    for (const vertex of withSpot.build.settlements) {
      expectAccepted(funded, 0, { type: 'buildSettlement', vertex });
    }

    const broke = setResources(state, 0, {});
    const poor = legalMoves(broke, 0);
    expect(poor.build.affordable).toEqual({ road: false, settlement: false, city: false });
    expect(poor.build.roads.length).toBeGreaterThan(0);
  });

  it('offers the best-rate bank trades and rejects everything else', () => {
    let state = actionGame(4, 502);
    state = setResources(state, 0, { wood: 4, brick: 1, sheep: 0, wheat: 0, ore: 0 });
    const legal = legalMoves(state, 0);
    expect(legal.bankTrades).toHaveLength(4); // wood -> the four other resources
    for (const option of legal.bankTrades) {
      expect(option.count).toBe(bestBankRate(state, 0, option.give));
      expectAccepted(state, 0, {
        type: 'bankTrade',
        give: option.give,
        receive: option.receive,
        count: option.count,
      });
    }
    expect(
      legal.bankTrades.some(
        (option) => option.give === 'wood' && option.receive === 'ore' && option.count === 4,
      ),
    ).toBe(true);
    expect(legal.bankTrades.every((option) => option.give !== option.receive)).toBe(true);
  });

  it('offers only in-stock, affordable cards, and drops them after one purchase', () => {
    let state = actionGame(4, 503);
    state = setResources(state, 0, { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 });
    const legal = legalMoves(state, 0);
    expect(legal.buyable.length).toBeGreaterThan(10);
    for (const defId of legal.buyable) expectAccepted(state, 0, { type: 'buyCard', defId });

    const bought = act(state, 0, { type: 'buyCard', defId: 'provisioner' });
    expect(legalMoves(bought, 0).buyable).toEqual([]);
  });

  it('reports playable cards with their legal targets', () => {
    let state = actionGame(4, 504);
    state = setResources(state, 0, {});
    state = setHand(state, 0, [
    'guild-mason',
    'shipwrights-yard',
    'wreckers-lamp',
    'provisioner',
    'quay-deed',
  ]);
    const legal = legalMoves(state, 0);
    expect(legal.playable.map((card) => card.defId)).toEqual([
      'guild-mason',
      'shipwrights-yard',
      'wreckers-lamp',
      'provisioner',
    ]);
    const mason = legal.playable[0];
    expect(mason?.choice).toBe('road');
    expect(mason?.roadOptions).toEqual(legalMoves(state, 0).build.roads);
    for (const edge of mason?.roadOptions ?? []) {
      expectAccepted(state, 0, {
        type: 'playCard',
        iid: mason?.iid as number,
        choice: { kind: 'road', edge: edge as EdgeId },
      });
    }

    const lamp = legal.playable[2];
    expect(lamp?.choice).toBe('robber');
    expect(lamp?.choiceOptional).toBe(true);
    expect(lamp?.robberHexes).not.toContain(state.robberHex);
    expect(Object.keys(lamp?.robberVictims ?? {})).toHaveLength(19);
    for (const [hex, victims] of Object.entries(lamp?.robberVictims ?? {})) {
      for (const victim of victims) {
        expect(victim).not.toBe(0);
        expect(
          (state.board.hexes.find((item) => item.id === hex)?.vertices ?? []).some(
            (vertex) => state.buildings[vertex]?.owner === victim,
          ),
        ).toBe(true);
      }
    }
  });

  it('marks a targeting card optional only when it has no legal target', () => {
    let state = actionGame(4, 508);
    state = setHand(state, 0, ['guild-mason', 'shipwrights-yard']);
    const withTargets = legalMoves(state, 0).playable;
    expect(withTargets[0]?.choiceOptional).toBe(false); // Guild Mason has roads
    expect(withTargets[1]?.choiceOptional).toBe(true); // no legal settlement yet

    const extended = extendToSettlement(state, 0);
    const withSpot = legalMoves(extended.state, 0).playable;
    expect(withSpot[1]?.choiceOptional).toBe(false);
    expect((withSpot[1]?.settlementOptions ?? []).length).toBeGreaterThan(0);

    const alone = patch(state, (draft) => {
      draft.roads = {};
      draft.buildings = {};
    });
    const withoutTargets = legalMoves(alone, 0).playable;
    expect(withoutTargets[0]?.choiceOptional).toBe(true);
    expect(withoutTargets[1]?.choiceOptional).toBe(true);
    expect(withoutTargets[0]?.roadOptions).toEqual([]);
    expect(withoutTargets[1]?.settlementOptions).toEqual([]);
    for (const card of withoutTargets) {
      expectAccepted(alone, 0, { type: 'playCard', iid: card.iid });
    }
  });

  it('is empty outside the action phase and never undefined', () => {
    const rolling = setupGame(4, 505);
    const legal = legalMoves(rolling, 0);
    expect(legal.phase).toBe('roll');
    expect(legal.canRoll).toBe(true);
    expect(legal.canEndTurn).toBe(false);
    expect(legal.build.roads).toEqual([]);
    expect(legal.build.settlements).toEqual([]);
    expect(legal.build.cities).toEqual([]);
    expect(legal.playable).toEqual([]);
    expect(legal.bankTrades).toEqual([]);
    expect(legal.buyable).toEqual([]);
    expect(legal.discard).toBeNull();
    expect(legal.robber).toBeNull();
    expect(legal.setupSettlements).toEqual([]);
    expect(legal.setupRoads).toEqual([]);

    const outOfTurn = legalMoves(rolling, 2);
    expect(outOfTurn.isTurn).toBe(false);
    expect(outOfTurn.canRoll).toBe(false);
  });

  it('reports required discards and robber targets for the queued player', () => {
    let state = setupGame(4, 506);
    state = setResources(state, 0, { wood: 12 });
    state = setResources(state, 2, { ore: 14 });
    state = setNextRoll(state, 7);
    state = act(state, 0, { type: 'roll' });

    expect(legalMoves(state, 0).discard).toEqual({ required: 6 });
    expect(legalMoves(state, 2).discard).toEqual({ required: 7 });
    expect(legalMoves(state, 1).discard).toBeNull();
    expect(legalMoves(state, 0).robber).toBeNull();

    state = act(state, 0, { type: 'discard', resources: { wood: 6 } });
    state = act(state, 2, { type: 'discard', resources: { ore: 7 } });
    expect(state.phase).toBe('robber');
    const robber = legalMoves(state, 0).robber;
    expect(robber).not.toBeNull();
    expect(robber?.hexes).not.toContain(state.robberHex);
    expect(legalMoves(state, 1).robber).toBeNull();
    for (const hex of robber?.hexes ?? []) {
      expectAccepted(state, 0, { type: 'moveRobber', hex });
    }
  });

  it('tracks trade offer permissions for each viewer', () => {
    let state = actionGame(4, 507);
    state = setResources(state, 0, { wood: 4 });
    state = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 1 },
      want: { ore: 1 },
      to: [1, 2],
    });
    expect(legalMoves(state, 0).canCancelTrade).toBe(true);
    expect(legalMoves(state, 1).canRespondToTrade).toBe(true);
    expect(legalMoves(state, 2).canRespondToTrade).toBe(true);
    expect(legalMoves(state, 3).canRespondToTrade).toBe(false);
    expect(legalMoves(state, 1).canCancelTrade).toBe(false);
    const offerId = state.tradeOffer?.id as string;
    expect(reject(state, 3, { type: 'respondTrade', offerId, accept: true }).code).toBe(
      'NOT_RECIPIENT',
    );
  });
});
