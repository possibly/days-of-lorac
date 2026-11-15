/**
 * Setup draft.
 *
 * Settlement: score every legal vertex (scarcity-weighted pips, resource
 * diversity against the bot's earlier holdings, ore and brick premium, port
 * match, crowding, seeded noise). Road: place it toward the best future
 * settlement site rather than the first open edge, because the vertex next to
 * your own building is dead to the distance rule and the value is two edges
 * out.
 */
import type { EdgeId, VertexId } from '../../shared/types.js';
import { bestRoadEdge, bestSettlementVertex } from './placement.js';
import type { Sense } from './sense.js';
import type { BotWeights } from './weights.js';

export function chooseSetupSettlement(sense: Sense, w: BotWeights): VertexId | null {
  const options = sense.view.legal.setupSettlements;
  if (options.length === 0) return null;
  // Setup is always scored, even on Deckhand: a bot that opens on two pips is
  // not a beginner-friendly opponent, it is a broken one. Deckhand's weakness
  // is the noise amplitude and the first-legal choices later in the turn.
  return bestSettlementVertex(sense, options, w, {
    noiseSalt: `setup-${sense.view.setup?.index ?? 0}`,
    noise: w.setupNoise,
    diversity: true,
    discipline: w.setupDiscipline,
  });
}

export function chooseSetupRoad(sense: Sense, w: BotWeights): EdgeId | null {
  const options = sense.view.legal.setupRoads;
  if (options.length === 0) return null;
  return bestRoadEdge(sense, options, w);
}
