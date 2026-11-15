/**
 * Robber targeting.
 *
 * The robber goes on the leader's most productive hex, never on the bot's only
 * source of a resource unless every alternative is worse, and the steal goes
 * to the leader when they are eligible. Ore and wheat get a tie-break bonus
 * because cities and charters both run through them.
 */
import type { HexId, Hex, Seat } from '../../shared/types.js';
import type { Sense } from './sense.js';
import { RESOURCE_WEIGHT } from './sense.js';
import type { BotWeights } from './weights.js';

/** Scarcity-weighted pips one seat collects from a hex. */
export function pipsFor(sense: Sense, hex: Hex, seat: Seat): number {
  if (hex.terrain === 'desert') return 0;
  let total = 0;
  for (const vertex of hex.vertices) {
    const building = sense.buildingAt(vertex);
    if (!building || building.owner !== seat) continue;
    const multiplier = building.type === 'city' ? 2 : 1;
    total += sense.hexPips(hex) * multiplier * RESOURCE_WEIGHT[hex.terrain];
  }
  return total;
}

/** True when the bot's only production of this hex's resource is here. */
function isOwnOnlySource(sense: Sense, hex: Hex): boolean {
  if (hex.terrain === 'desert') return false;
  if (pipsFor(sense, hex, sense.you) <= 0) return false;
  return sense.sourceCount(hex.terrain) <= 1;
}

export function scoreRobberHex(sense: Sense, hexId: HexId, w: BotWeights): number {
  const hex = sense.hex(hexId);
  if (!hex) return -Infinity;

  const leader = sense.leader();
  const mine = pipsFor(sense, hex, sense.you);
  let score = pipsFor(sense, hex, leader) * w.robberLeader;
  for (const rival of sense.rivals()) {
    if (rival === leader) continue;
    score += pipsFor(sense, hex, rival) * w.robberOther;
  }

  if (mine > 0) {
    score -= mine * w.robberSelf;
    if (isOwnOnlySource(sense, hex)) score -= mine * w.robberSelf;
  }

  if (hex.terrain === 'ore' || hex.terrain === 'wheat') {
    score += w.robberScarcity * RESOURCE_WEIGHT[hex.terrain];
  }

  if (leader !== sense.you && pipsFor(sense, hex, leader) > 0) {
    const leaderView = sense.player(leader);
    const held = leaderView
      ? Object.values(leaderView.resources).reduce((sum, value) => sum + value, 0)
      : 0;
    if (held > 0) score += 1.5;
  }

  if (hex.terrain !== 'desert') {
    let anyone = false;
    for (const player of sense.view.players) {
      if (player.seat === sense.you) continue;
      if (pipsFor(sense, hex, player.seat) > 0) anyone = true;
    }
    if (!anyone) score -= 2;
  }

  return score;
}

/**
 * Victim on a hex: the leader when eligible, otherwise the strongest rival who
 * still has resources to lose.
 */
function chooseVictim(sense: Sense, victims: Seat[] | undefined): Seat | undefined {
  if (!victims || victims.length === 0) return undefined;
  const leader = sense.leader();
  if (victims.includes(leader) && leader !== sense.you) {
    const held = sense.player(leader);
    const total = held ? Object.values(held.resources).reduce((sum, value) => sum + value, 0) : 0;
    if (total > 0) return leader;
  }
  const ranked = sense
    .standings()
    .filter((seat) => seat !== sense.you && victims.includes(seat));
  for (const seat of ranked) {
    const view = sense.player(seat);
    const total = view ? Object.values(view.resources).reduce((sum, value) => sum + value, 0) : 0;
    if (total > 0) return seat;
  }
  return ranked[0] ?? victims[0];
}

export interface RobberTarget {
  hex: HexId;
  victimSeat?: Seat;
}

/** Best move among a candidate list; used by the phase and by Wrecker's Lamp. */
export function bestRobberTarget(
  sense: Sense,
  hexes: readonly HexId[],
  victimsByHex: Record<HexId, Seat[]> | undefined,
  w: BotWeights,
): { target: RobberTarget | null; score: number } {
  let best: RobberTarget | null = null;
  let bestScore = -Infinity;
  for (const hex of hexes) {
    const score = scoreRobberHex(sense, hex, w);
    if (score > bestScore) {
      bestScore = score;
      const victim = chooseVictim(sense, victimsByHex?.[hex]);
      best = victim === undefined ? { hex } : { hex, victimSeat: victim };
    }
  }
  return { target: best, score: bestScore };
}

/**
 * Wrecker's Lamp is optional. Move only when denying the table is worth more
 * than keeping the robber where it is, otherwise play the card for renown and
 * leave the robber alone.
 */
export function chooseLampTarget(
  sense: Sense,
  hexes: readonly HexId[],
  victimsByHex: Record<HexId, Seat[]> | undefined,
  w: BotWeights,
): RobberTarget | undefined {
  if (hexes.length === 0) return undefined;
  const { target, score } = bestRobberTarget(sense, hexes, victimsByHex, w);
  if (!target) return undefined;
  const current = scoreRobberHex(sense, sense.view.robberHex, w);
  // Only if the new hex is better than the one already blocked.
  if (score <= current + 0.25) return undefined;
  if (score <= 0) return undefined;
  return target;
}
