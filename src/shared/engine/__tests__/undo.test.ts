import { describe, expect, it } from 'vitest';
import { viewFor } from '../index.js';
import { act, actionGame, reject, setHand } from './helpers.js';

describe('card takeback', () => {
  it('restores the hand, resources, and deck from before the play', () => {
    const state = setHand(actionGame(4, 300), 0, ['rope-walk']);
    const iid = state.players[0]!.hand[0]!.iid;

    expect(viewFor(state, 0).unplayableIid).toBeNull();

    const after = act(state, 0, { type: 'playCard', iid });
    expect(after.players[0]!.played.map((card) => card.iid)).toEqual([iid]);
    expect(viewFor(after, 0).unplayableIid).toBe(iid);
    expect(viewFor(after, 1).unplayableIid).toBeNull();

    const back = act(after, 0, { type: 'unplayCard', iid });
    expect(back.players[0]!.hand.map((card) => card.iid)).toEqual([iid]);
    expect(back.players[0]!.played).toHaveLength(0);
    expect(back.players[0]!.resources).toEqual(state.players[0]!.resources);
    expect(back.players[0]!.deck.map((card) => card.iid)).toEqual(state.players[0]!.deck.map((card) => card.iid));
    expect(back.version).toBe(after.version + 1);
    expect(viewFor(back, 0).unplayableIid).toBeNull();
  });

  it('only takes back the most recent play, and only before another action', () => {
    const state = setHand(actionGame(4, 301), 0, ['start-wood', 'start-wood']);
    const [first, second] = state.players[0]!.hand;
    const one = act(state, 0, { type: 'playCard', iid: first!.iid });
    const two = act(one, 0, { type: 'playCard', iid: second!.iid });

    expect(viewFor(two, 0).unplayableIid).toBe(second!.iid);
    expect(reject(two, 0, { type: 'unplayCard', iid: first!.iid }).code).toBe('NO_UNDO');

    const back = act(two, 0, { type: 'unplayCard', iid: second!.iid });
    expect(viewFor(back, 0).unplayableIid).toBeNull();

    const ended = act(two, 0, { type: 'endTurn' });
    expect(viewFor(ended, 0).unplayableIid).toBeNull();
    expect(reject(ended, 0, { type: 'unplayCard', iid: second!.iid }).code).toBe('NO_UNDO');
  });
});
