/**
 * One policy, three weight sets.
 *
 * Deckhand (easy), Factor (normal) and Guildmaster (hard) run the same code
 * path. Only these numbers change: how much noise the setup picks get, how
 * picky the build and purchase thresholds are, how hard the robber squeezes,
 * how eagerly the awards are contested, and whether the purchase and build
 * choice project one turn ahead.
 *
 * `discipline` is the odd one out and deliberately so: at 1 every candidate is
 * scored and the best wins; at 0 the policy keeps whichever legal candidate it
 * saw first, which is exactly the Deckhand's "first legal action wins" rule
 * without a second code path.
 */
export interface BotWeights {
  /** 0 = take the first legal candidate, 1 = take the best scored one. */
  discipline: number;
  /** Same knob for the setup draft; kept at 1 because a blind draft is unfair. */
  setupDiscipline: number;
  /** Amplitude of the stable per-candidate noise in setup placement. */
  setupNoise: number;
  /** Points for a resource type the bot's earlier settlement does not cover. */
  setupDiversity: number;
  /** Extra points per weighted pip of ore and brick on a setup vertex. */
  oreBonus: number;
  brickBonus: number;
  /** Port bonuses when scoring a settlement site. */
  specificPortBonus: number;
  genericPortBonus: number;
  /** Penalty for a site crowded by opponents' buildings. */
  crowdPenalty: number;
  /** A city is preferred over a fresh settlement when its pip value clears this. */
  cityPipMin: number;
  /** Minimum site score a paid settlement must clear to be worth building. */
  settlementMin: number;
  /** Minimum reach score a paid road must clear. */
  roadBuildMin: number;
  /** Points for taking or defending the road award. */
  roadAwardFocus: number;
  /** Multiplier on the value of contesting either award's 2 VP. */
  awardFocus: number;
  /** Purchase must beat `cost * purchaseRatio` in resource-equivalent value. */
  purchaseRatio: number;
  /** Resource-equivalents one victory point is worth when buying a charter. */
  vpToResources: number;
  /** First turn charters are considered. */
  charterTurn: number;
  /** Charters only once the bot is within this many VP of the target. */
  charterVpWindow: number;
  /** Resource-equivalents written off per charter for the dead draws. */
  charterDilution: number;
  /** Accept a player trade only when receive >= ratio * pay. */
  tradeAcceptRatio: number;
  /** Propose trades to fix a single shortage. */
  tradeProposals: boolean;
  /** Weights in the robber scoring. */
  robberSelf: number;
  robberLeader: number;
  robberOther: number;
  robberScarcity: number;
  /** One-ply projection weight for purchases and builds; 0 for no lookahead. */
  lookahead: number;
  /** Buy a charter stack out from under an opponent about to win. */
  denyCharters: number;
}

const BASE: BotWeights = {
  discipline: 1,
  setupDiscipline: 1,
  setupNoise: 0.5,
  setupDiversity: 2.2,
  oreBonus: 0.16,
  brickBonus: 0.1,
  specificPortBonus: 3.4,
  genericPortBonus: 1.6,
  crowdPenalty: 0.9,
  cityPipMin: 3.5,
  settlementMin: 3.2,
  roadBuildMin: 6.5,
  roadAwardFocus: 1,
  awardFocus: 1,
  purchaseRatio: 0.85,
  vpToResources: 4.4,
  charterTurn: 6,
  charterVpWindow: 5,
  charterDilution: 1.4,
  tradeAcceptRatio: 0.68,
  tradeProposals: true,
  robberSelf: 2.2,
  robberLeader: 3,
  robberOther: 1,
  robberScarcity: 1.1,
  lookahead: 0,
  denyCharters: 0,
};

export const BOT_WEIGHTS: Record<'easy' | 'normal' | 'hard', BotWeights> = {
  // Deckhand: noisy opening, first legal build, buys whatever is cheap, never
  // trades with players, robber on the leader's best hex. `robberSelf` is near
  // zero, so the hard `selfHarmTier` rule in robber.ts is what keeps it off its
  // own hexes. Still finishes every game.
  easy: {
    ...BASE,
    discipline: 0,
    setupNoise: 2.4,
    setupDiversity: 0.6,
    purchaseRatio: 1.6,
    tradeAcceptRatio: 1.8,
    tradeProposals: false,
    awardFocus: 0.85,
    charterTurn: 8,
    charterVpWindow: 3,
    robberSelf: 0.2,
    robberLeader: 3,
    robberOther: 0.2,
    lookahead: 0,
  },
  // Factor: the default. Full greedy evaluation, correct phase ordering,
  // real trade threshold, charters once the target is close.
  normal: {
    ...BASE,
  },
  // Guildmaster: tighter noise, less picky on cities, better denial, and one
  // turn of projection on purchases and builds.
  hard: {
    ...BASE,
    setupNoise: 0.15,
    cityPipMin: 2.6,
    settlementMin: 2.6,
    roadBuildMin: 5.4,
    purchaseRatio: 0.8,
    charterTurn: 5,
    charterVpWindow: 6,
    tradeAcceptRatio: 0.62,
    awardFocus: 1.4,
    robberSelf: 3.2,
    robberLeader: 3.4,
    robberOther: 1.4,
    robberScarcity: 1.4,
    lookahead: 1,
    denyCharters: 1,
  },
};

export function weightsFor(difficulty: 'easy' | 'normal' | 'hard'): BotWeights {
  return BOT_WEIGHTS[difficulty] ?? BOT_WEIGHTS.normal;
}
