/**
 * Public engine surface. Everything the server, bots, and client need goes
 * through this barrel; the shapes come from src/shared/types.ts.
 */
export { createGame } from './state.js';
export { applyAction } from './actions.js';
export { legalMoves } from './legal.js';
/** Design-doc spelling of `legalMoves`; same function, kept for bot authors. */
export { legalMoves as legalActions } from './legal.js';
export { viewFor } from './view.js';
export { scorePlayer, longestRoadLength, refreshDerived } from './awards.js';
export { bestBankRate } from './legal.js';

// Lower-level helpers that bots, tests, and the balance simulator find useful.
// They are still pure and deterministic; none of them mutate their input.
export { canAfford, legalCityVertices, legalRoadEdges, legalSettlementVertices } from './legal.js';
export { cloneState, drawCards } from './state.js';
export { buildBoard } from './board.js';
export { nextRandom, randomInt, shuffleWithRng } from './rng.js';
