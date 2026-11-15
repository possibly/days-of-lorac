import { describe, expect, it } from 'vitest';
import type { EdgeId, GameState, VertexId } from '../../types.js';
import { CARD_BY_ID, CHARTER_CARDS } from '../../cards.js';
import { legalMoves, scorePlayer } from '../index.js';
import {
  act,
  actionGame,
  extendToSettlement,
  patch,
  reject,
  setHand,
  setResources,
} from './helpers.js';

function handIid(state: GameState, seat = 0): number {
  const iid = state.players[seat]?.hand[0]?.iid;
  if (iid === undefined) throw new Error('no card in hand');
  return iid;
}

describe('starting cards', () => {
  it('starts with two of each resource card and gains one on play', () => {
    const state = actionGame(4, 200);
    const counts: Record<string, number> = {};
    for (const card of state.players[0]?.hand ?? []) counts[card.defId] = (counts[card.defId] ?? 0) + 1;
    for (const card of state.players[0]?.deck ?? []) counts[card.defId] = (counts[card.defId] ?? 0) + 1;
    expect(counts).toEqual({
      'start-wood': 2,
      'start-brick': 2,
      'start-sheep': 2,
      'start-wheat': 2,
      'start-ore': 2,
    });

    for (const [defId, resource] of [
      ['start-wood', 'wood'],
      ['start-brick', 'brick'],
      ['start-sheep', 'sheep'],
      ['start-wheat', 'wheat'],
      ['start-ore', 'ore'],
    ] as const) {
      const withCard = setHand(state, 0, [defId]);
      const after = act(withCard, 0, { type: 'playCard', iid: handIid(withCard) });
      expect(after.players[0]?.resources[resource]).toBe(
        withCard.players[0]!.resources[resource] + 1,
      );
      expect(after.players[0]?.played).toHaveLength(1);
      expect(after.players[0]?.hand).toHaveLength(0);
    }
  });
});

describe('market piles', () => {
  it('Salvage Yard gains 2 brick and 1 ore', () => {
    const state = setHand(actionGame(4, 201), 0, ['salvage-yard']);
    const before = { ...state.players[0]!.resources };
    const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(after.players[0]?.resources.brick).toBe(before.brick + 2);
    expect(after.players[0]?.resources.ore).toBe(before.ore + 1);
    expect(after.players[0]?.resources.wood).toBe(before.wood);
  });

  it('Rope Walk gains 1 wood and draws 2', () => {
    const state = setHand(actionGame(4, 202), 0, ['rope-walk']);
    const before = state.players[0]!.resources.wood;
    const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(after.players[0]?.resources.wood).toBe(before + 1);
    expect(after.players[0]?.hand).toHaveLength(2);
    expect(after.players[0]?.played).toHaveLength(1);
  });

  it('draws nothing when the deck and discard are both empty', () => {
    let state = setHand(actionGame(4, 203), 0, ['rope-walk']);
    state = patch(state, (draft) => {
      draft.players[0]!.deck = [];
      draft.players[0]!.discard = [];
    });
    const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(after.players[0]?.hand).toHaveLength(0);
    expect(after.players[0]?.deck).toHaveLength(0);
  });

  it('reshuffles the discard pile to keep drawing', () => {
    let state = setHand(actionGame(4, 204), 0, ['rope-walk']);
    state = patch(state, (draft) => {
      draft.players[0]!.deck = [];
      draft.players[0]!.discard = [
        { iid: 800001, defId: 'start-ore' },
        { iid: 800002, defId: 'start-wheat' },
      ];
    });
    const iid = handIid(state);
    const after = act(state, 0, { type: 'playCard', iid });
    expect(after.players[0]?.hand).toHaveLength(2);
    expect(after.players[0]?.deck).toHaveLength(0);
    expect(after.players[0]?.discard).toHaveLength(0);
    const handDefs = (after.players[0]?.hand ?? []).map((card) => card.defId).sort();
    expect(handDefs).toEqual(['start-ore', 'start-wheat']);
  });

  it('Foundry Quay, Wool Factor and Bellows Yard add their printed resources', () => {
    for (const [defId, expected] of [
      ['foundry-quay', { ore: 2, wheat: 1 }],
      ['wool-factor', { sheep: 2 }],
      ['bellows-yard', { ore: 2, wheat: 2 }],
    ] as const) {
      const state = setHand(actionGame(4, 205), 0, [defId]);
      const before = { ...state.players[0]!.resources };
      const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
      for (const [resource, amount] of Object.entries(expected)) {
        expect(after.players[0]?.resources[resource as 'ore']).toBe(
          before[resource as 'ore'] + amount,
        );
      }
    }
  });
});

describe('Guild Mason', () => {
  it('places a free road with a choice, spends no resources, and draws 1', () => {
    let state = setHand(actionGame(4, 210), 0, ['guild-mason']);
    state = setResources(state, 0, {});
    const edge = legalMoves(state, 0).build.roads[0] as EdgeId;
    const after = act(state, 0, {
      type: 'playCard',
      iid: handIid(state),
      choice: { kind: 'road', edge },
    });
    expect(after.roads[edge]).toBe(0);
    expect(after.players[0]?.resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
    expect(after.players[0]?.hand).toHaveLength(1);
  });

  it('requires a road choice when a legal road exists', () => {
    const state = setHand(actionGame(4, 211), 0, ['guild-mason']);
    expect(reject(state, 0, { type: 'playCard', iid: handIid(state) }).code).toBe('CHOICE_REQUIRED');
    expect(
      reject(state, 0, {
        type: 'playCard',
        iid: handIid(state),
        choice: { kind: 'road', edge: 'e900' },
      }).code,
    ).toBe('INVALID_CHOICE');
  });

  it('falls back to 1 wood, 1 brick and a draw when it cannot place a road', () => {
    let state = setHand(actionGame(4, 212), 0, ['guild-mason']);
    state = patch(state, (draft) => {
      draft.roads = {};
      draft.buildings = {};
    });
    const before = { ...state.players[0]!.resources };
    const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(after.players[0]?.resources.wood).toBe(before.wood + 1);
    expect(after.players[0]?.resources.brick).toBe(before.brick + 1);
    expect(after.players[0]?.hand).toHaveLength(1);
  });
});

describe("Shipwright's Yard", () => {
  it('gains renown and places a free settlement with a choice', () => {
    let state = actionGame(4, 220);
    const extended = extendToSettlement(state, 0);
    state = setHand(extended.state, 0, ["shipwrights-yard"]);
    const before = scorePlayer(state, 0);
    const after = act(state, 0, {
      type: 'playCard',
      iid: handIid(state),
      choice: { kind: 'settlement', vertex: extended.vertex as VertexId },
    });
    expect(after.buildings[extended.vertex]?.owner).toBe(0);
    expect(after.players[0]?.renown).toBe(1);
    const score = scorePlayer(after, 0);
    expect(score.settlements).toBe(before.settlements + 1);
    expect(score.largestExpedition).toBe(0);
  });

  it('requires a settlement choice when a legal vertex exists', () => {
    let state = actionGame(4, 221);
    const extended = extendToSettlement(state, 0);
    state = setHand(extended.state, 0, ["shipwrights-yard"]);
    expect(reject(state, 0, { type: 'playCard', iid: handIid(state) }).code).toBe('CHOICE_REQUIRED');
  });

  it('falls back to 2 ore and 2 wheat when no vertex is legal, keeping the renown', () => {
    let state = setHand(actionGame(4, 222), 0, ["shipwrights-yard"]);
    state = patch(state, (draft) => {
      draft.roads = {};
      draft.buildings = {};
    });
    const before = { ...state.players[0]!.resources };
    const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(after.players[0]?.resources.ore).toBe(before.ore + 2);
    expect(after.players[0]?.resources.wheat).toBe(before.wheat + 2);
    expect(after.players[0]?.renown).toBe(1);
  });
});

describe('Provisioner', () => {
  it('gains two chosen resources, repeats allowed', () => {
    const state = setHand(actionGame(4, 230), 0, ['provisioner']);
    const before = { ...state.players[0]!.resources };
    const after = act(state, 0, {
      type: 'playCard',
      iid: handIid(state),
      choice: { kind: 'resources', resources: ['ore', 'ore'] },
    });
    expect(after.players[0]?.resources.ore).toBe(before.ore + 2);
  });

  it('accepts two different resources', () => {
    const state = setHand(actionGame(4, 231), 0, ['provisioner']);
    const before = { ...state.players[0]!.resources };
    const after = act(state, 0, {
      type: 'playCard',
      iid: handIid(state),
      choice: { kind: 'resources', resources: ['wheat', 'sheep'] },
    });
    expect(after.players[0]?.resources.wheat).toBe(before.wheat + 1);
    expect(after.players[0]?.resources.sheep).toBe(before.sheep + 1);
  });

  it('defaults to two wood with no choice and never asks for input', () => {
    const state = setHand(actionGame(4, 232), 0, ['provisioner']);
    const before = state.players[0]!.resources.wood;
    const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(after.players[0]?.resources.wood).toBe(before + 2);
    const wrongChoice = reject(state, 0, {
      type: 'playCard',
      iid: handIid(state),
      choice: { kind: 'road', edge: 'e1' },
    });
    expect(wrongChoice.code).toBe('INVALID_CHOICE');
  });
});

describe("Wrecker's Lamp", () => {
  it('always gains the renown, even when the robber is not moved', () => {
    const state = setHand(actionGame(4, 240), 0, ['wreckers-lamp']);
    const after = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(after.players[0]?.renown).toBe(1);
    expect(after.robberHex).toBe(state.robberHex);
  });

  it('moves the robber and steals when given a move', () => {
    let state = setHand(actionGame(4, 241), 0, ['wreckers-lamp']);
    state = setResources(state, 1, { ore: 3 });
    const target = state.board.hexes.find(
      (hex) =>
        hex.id !== state.robberHex &&
        hex.vertices.some((vertex) => state.buildings[vertex]?.owner === 1),
    );
    expect(target).toBeDefined();
    const before = state.players[0]!.resources.ore + state.players[0]!.resources.wood;
    const after = act(state, 0, {
      type: 'playCard',
      iid: handIid(state),
      choice: {
        kind: 'robber',
        move: { hex: target?.id as string, victimSeat: 1 },
      },
    });
    expect(after.robberHex).toBe(target?.id);
    expect(after.players[0]?.renown).toBe(1);
    expect(after.players[0]!.resources.ore + after.players[0]!.resources.wood).toBe(before + 1);
    expect(after.log.some((entry) => entry.kind === 'steal')).toBe(true);
  });

  it('rejects a move to the current hex or to a non-eligible victim', () => {
    const state = setHand(actionGame(4, 242), 0, ['wreckers-lamp']);
    expect(
      reject(state, 0, {
        type: 'playCard',
        iid: handIid(state),
        choice: { kind: 'robber', move: { hex: state.robberHex } },
      }).code,
    ).toBe('ROBBER_SAME_HEX');

    const emptyHex = state.board.hexes.find(
      (hex) =>
        hex.id !== state.robberHex &&
        !hex.vertices.some((vertex) => state.buildings[vertex] !== undefined),
    );
    expect(
      reject(state, 0, {
        type: 'playCard',
        iid: handIid(state),
        choice: { kind: 'robber', move: { hex: emptyHex?.id as string, victimSeat: 1 } },
      }).code,
    ).toBe('INVALID_VICTIM');
  });
});

describe('Survey Voyage and renown', () => {
  it('gains 2 renown and draws, and two of them hold the expedition award', () => {
    let state = setHand(actionGame(4, 250), 0, ['survey-voyage']);
    state = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(state.players[0]?.renown).toBe(2);
    expect(state.players[0]?.hand).toHaveLength(1);
    expect(state.awards.largestExpedition).toBeNull();

    state = setHand(state, 0, ['survey-voyage']);
    state = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(state.players[0]?.renown).toBe(4);
    expect(state.awards.largestExpedition).toBe(0);
    expect(scorePlayer(state, 0).largestExpedition).toBe(2);
  });
});

describe('charters and purchases', () => {
  it('tolerates playing a charter but does nothing and is not offered as playable', () => {
    let state = setHand(actionGame(4, 260), 0, ['quay-deed']);
    const before = { ...state.players[0]!.resources };
    const renownBefore = state.players[0]!.renown;
    state = act(state, 0, { type: 'playCard', iid: handIid(state) });
    expect(state.players[0]?.resources).toEqual(before);
    expect(state.players[0]?.renown).toBe(renownBefore);
    expect(state.players[0]?.played).toHaveLength(1);
    expect(legalMoves(state, 0).playable).toHaveLength(0);
  });

  it('buys a market card into the discard and enforces one purchase per turn', () => {
    let state = setResources(actionGame(4, 261), 0, { wood: 6, brick: 2, sheep: 1, wheat: 1, ore: 1 });
    const stockBefore = state.market['salvage-yard'] as number;
    state = act(state, 0, { type: 'buyCard', defId: 'salvage-yard' });
    expect(state.market['salvage-yard']).toBe(stockBefore - 1);
    expect(state.players[0]?.resources.wood).toBe(3);
    expect(state.players[0]?.discard).toHaveLength(1);
    expect(state.players[0]?.hand.some((card) => card.defId === 'salvage-yard')).toBe(false);
    expect(state.players[0]?.purchases).toBe(1);
    expect(state.turnFlags.purchased).toBe(true);

    const second = reject(state, 0, { type: 'buyCard', defId: 'provisioner' });
    expect(second.code).toBe('PURCHASE_LIMIT');

    // The bought card cannot be played this turn.
    const bought = state.players[0]?.discard[0]?.iid as number;
    expect(reject(state, 0, { type: 'playCard', iid: bought }).code).toBe('NO_CARD');
  });

  it('rejects unaffordable purchases, empty piles and unknown cards', () => {
    let state = actionGame(4, 262);
    state = setResources(state, 0, {});
    expect(reject(state, 0, { type: 'buyCard', defId: 'salvage-yard' }).code).toBe('CANNOT_AFFORD');
    expect(reject(state, 0, { type: 'buyCard', defId: 'nope' }).code).toBe('INVALID_ACTION');

    const stocked = setResources(state, 0, { wood: 6, brick: 2, sheep: 1, wheat: 1, ore: 1 });
    const empty = patch(stocked, (draft) => {
      draft.market['salvage-yard'] = 0;
    });
    expect(reject(empty, 0, { type: 'buyCard', defId: 'salvage-yard' }).code).toBe('PILE_EMPTY');

    const outOfTurn = reject(stocked, 1, { type: 'buyCard', defId: 'salvage-yard' });
    expect(outOfTurn.code).toBe('NOT_YOUR_TURN');
  });

  it('adds charter VP immediately and counts charters wherever they sit', () => {
    let state = setResources(actionGame(4, 263), 0, { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 });
    const before = scorePlayer(state, 0).charters;
    state = act(state, 0, { type: 'buyCard', defId: 'quay-deed' });
    expect(state.players[0]?.charters['quay-deed']).toBe(1);
    expect(scorePlayer(state, 0).charters).toBe(before + 1);
    expect(state.players[0]?.vp).toBe(scorePlayer(state, 0).total);
  });

  it('lists every charter and pile exactly once with printed copy counts', () => {
    const state = actionGame(4, 264);
    // Piles equal printed copies, summed. Deriving the total keeps the test
    // honest through balancing passes that change a copy count.
    const printed = Object.keys(state.market).reduce(
      (sum, id) => sum + (CARD_BY_ID.get(id)?.copies ?? 0),
      0,
    );
    const counts = Object.values(state.market).reduce((sum, count) => sum + count, 0);
    expect(counts).toBe(printed);
    for (const card of CHARTER_CARDS) expect(state.market[card.id]).toBe(card.copies);
    expect(CARD_BY_ID.get('quay-deed')?.vp).toBe(1);
    expect(CARD_BY_ID.get('fleet-charter')?.vp).toBe(2);
  });
});
