import { describe, expect, it } from 'vitest';
import { act, actionGame, reject, setResources } from './helpers.js';

describe('player trades', () => {
  it('opens an offer to everyone and logs it', () => {
    let state = actionGame(4, 90);
    state = setResources(state, 0, { wood: 4, brick: 2 });
    const offered = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 2 },
      want: { ore: 1 },
      to: 'all',
    });
    expect(offered.tradeOffer?.from).toBe(0);
    expect(offered.tradeOffer?.to).toEqual([1, 2, 3]);
    expect(offered.tradeOffer?.give).toEqual({ wood: 2 });
    expect(offered.tradeOffer?.want).toEqual({ ore: 1 });
    expect(offered.tradeOffer?.createdTurn).toBe(offered.turn);
    expect(offered.log[offered.log.length - 1]?.kind).toBe('trade');
  });

  it('lets a recipient accept out of turn and swaps the resources', () => {
    let state = actionGame(4, 91);
    state = setResources(state, 0, { wood: 4 });
    state = setResources(state, 2, { ore: 3 });
    state = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 2 },
      want: { ore: 1 },
      to: 'all',
    });
    const offerId = state.tradeOffer?.id as string;
    const accepted = act(state, 2, { type: 'respondTrade', offerId, accept: true });
    expect(accepted.tradeOffer).toBeNull();
    expect(accepted.players[0]?.resources.wood).toBe(2);
    expect(accepted.players[0]?.resources.ore).toBe(1);
    expect(accepted.players[2]?.resources.wood).toBe(2);
    expect(accepted.players[2]?.resources.ore).toBe(2);
    expect(accepted.currentSeat).toBe(0);
  });

  it('rejects a stale accept when the responder cannot pay', () => {
    let state = actionGame(4, 92);
    state = setResources(state, 0, { wood: 4 });
    state = setResources(state, 1, {});
    state = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 2 },
      want: { ore: 1 },
      to: [1],
    });
    const offerId = state.tradeOffer?.id as string;
    const stale = reject(state, 1, { type: 'respondTrade', offerId, accept: true });
    expect(stale.code).toBe('TRADE_STALE');
    expect(state.players[0]?.resources.wood).toBe(4);
    expect(state.tradeOffer).not.toBeNull();
  });

  it('keeps the offer open for others after a decline, then closes it', () => {
    let state = actionGame(4, 93);
    state = setResources(state, 0, { wood: 4 });
    state = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 2 },
      want: { ore: 1 },
      to: 'all',
    });
    const offerId = state.tradeOffer?.id as string;
    const firstDecline = act(state, 1, { type: 'respondTrade', offerId, accept: false });
    expect(firstDecline.tradeOffer?.to).toEqual([2, 3]);
    const secondDecline = act(firstDecline, 2, { type: 'respondTrade', offerId, accept: false });
    expect(secondDecline.tradeOffer?.to).toEqual([3]);
    const thirdDecline = act(secondDecline, 3, { type: 'respondTrade', offerId, accept: false });
    expect(thirdDecline.tradeOffer).toBeNull();
    expect(thirdDecline.log.some((entry) => entry.text.includes('closed with no takers'))).toBe(true);
  });

  it('restricts who may offer, respond and cancel', () => {
    let state = actionGame(4, 94);
    state = setResources(state, 0, { wood: 4 });
    state = setResources(state, 2, { ore: 2 });

    expect(
      reject(state, 1, {
        type: 'offerTrade',
        give: { wood: 1 },
        want: { ore: 1 },
        to: 'all',
      }).code,
    ).toBe('NOT_YOUR_TURN');

    state = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 2 },
      want: { ore: 1 },
      to: [1],
    });
    const offerId = state.tradeOffer?.id as string;

    // A second offer is refused while one is open.
    expect(
      reject(state, 0, {
        type: 'offerTrade',
        give: { wood: 1 },
        want: { ore: 1 },
        to: 'all',
      }).code,
    ).toBe('TRADE_EXISTS');

    expect(reject(state, 0, { type: 'respondTrade', offerId, accept: true }).code).toBe(
      'INVALID_ACTION',
    );
    expect(reject(state, 2, { type: 'respondTrade', offerId, accept: true }).code).toBe(
      'NOT_RECIPIENT',
    );
    expect(reject(state, 1, { type: 'cancelTrade' }).code).toBe('NOT_YOUR_TURN');
    expect(reject(state, 0, { type: 'respondTrade', offerId, accept: false }).code).toBe(
      'INVALID_ACTION',
    );
    // A mismatched id while an offer is still open is a stale acceptance.
    expect(reject(state, 1, { type: 'respondTrade', offerId: 'offer-nope', accept: true }).code).toBe(
      'TRADE_STALE',
    );

    const cancelled = act(state, 0, { type: 'cancelTrade' });
    expect(cancelled.tradeOffer).toBeNull();
    expect(reject(cancelled, 0, { type: 'cancelTrade' }).code).toBe('NO_TRADE');
  });

  it('validates offer contents and affordability', () => {
    let state = actionGame(4, 95);
    state = setResources(state, 0, { wood: 1 });

    expect(
      reject(state, 0, { type: 'offerTrade', give: {}, want: { ore: 1 }, to: 'all' }).code,
    ).toBe('INVALID_TRADE');
    expect(
      reject(state, 0, { type: 'offerTrade', give: { wood: 1 }, want: {}, to: 'all' }).code,
    ).toBe('INVALID_TRADE');
    expect(
      reject(state, 0, {
        type: 'offerTrade',
        give: { ore: 9 },
        want: { wood: 1 },
        to: 'all',
      }).code,
    ).toBe('CANNOT_AFFORD');
    expect(
      reject(state, 0, {
        type: 'offerTrade',
        give: { wood: 1 },
        want: { ore: 1 },
        to: [],
      }).code,
    ).toBe('INVALID_TRADE');

    expect(
      reject(state, 0, {
        type: 'offerTrade',
        give: { wood: 1 },
        want: { ore: 1 },
        to: 'everyone' as never,
      }).code,
    ).toBe('INVALID_TRADE');
    expect(
      reject(state, 0, {
        type: 'offerTrade',
        give: { wood: 1 },
        want: { ore: 1 },
        to: [0],
      }).code,
    ).toBe('INVALID_TRADE');

    const offered = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 1 },
      want: { ore: 1 },
      to: [1, 1, 9],
    });
    expect(offered.tradeOffer?.to).toEqual([1]);
  });

  it('expires any open offer when the turn ends', () => {
    let state = actionGame(4, 96);
    state = setResources(state, 0, { wood: 4 });
    state = act(state, 0, {
      type: 'offerTrade',
      give: { wood: 2 },
      want: { ore: 1 },
      to: 'all',
    });
    const ended = act(state, 0, { type: 'endTurn' });
    expect(ended.tradeOffer).toBeNull();
    expect(reject(ended, 1, { type: 'respondTrade', offerId: 'whatever', accept: true }).code).toBe(
      'NO_TRADE',
    );
  });
});
