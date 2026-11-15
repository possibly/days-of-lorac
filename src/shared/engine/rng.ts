/**
 * Seeded 32-bit PRNG (mulberry32) plus deterministic helpers.
 *
 * The whole engine takes randomness from here. `GameState.rng` is the raw
 * 32-bit state; every helper returns the advanced state next to its result so
 * callers can write it back. No Math.random, no Date, no environment input.
 *
 * Consumption order, for replay determinism (see docs/CONTRACTS.md):
 *   1. board orientation in `createGame`: rotation, then mirror,
 *   2. one shuffle per player, in seat order, for the starting decks,
 *   3. from then on: each die roll (two draws), each discard-pile reshuffle,
 *      each robber steal (one draw) and each shuffle of a starting deck, in the
 *      order actions are applied.
 */

export interface RngStep {
  state: number;
  value: number;
}

/** Advance the generator once. Returns the new state and a float in [0, 1). */
export function nextRandom(state: number): RngStep {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a >>> 0, value };
}

/** Uniform integer in [0, maxExclusive). */
export function randomInt(state: number, maxExclusive: number): RngStep {
  if (maxExclusive <= 1) return { state, value: 0 };
  const step = nextRandom(state);
  return { state: step.state, value: Math.floor(step.value * maxExclusive) };
}

/** Fisher-Yates shuffle. Does not mutate the input array. */
export function shuffleWithRng<T>(items: readonly T[], state: number): { state: number; items: T[] } {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const step = randomInt(s, i + 1);
    s = step.state;
    const j = step.value;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return { state: s, items: out };
}
