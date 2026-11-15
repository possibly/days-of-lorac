/**
 * Card play and purchases.
 *
 * Effects resolve strictly left to right. `refreshDerived` runs after every
 * atomic effect so a card can win the game mid-resolution (a renown award or a
 * free settlement) and stop the rest of the card. Choice cards fall back to
 * their printed clause when no legal target exists; Provisioner defaults to
 * two wood so a play can never hang waiting for input.
 */
import { RESOURCES } from '../types.js';
import type {
  CardDef,
  CardEffect,
  GameAction,
  GamePhase,
  GameState,
  PartialResources,
  Resource,
  Seat,
} from '../types.js';
import { addLog, describeResources, playerName } from './log.js';
import { boardIndex } from './board.js';
import {
  bestBankRate,
  canAfford,
  gainResources,
  legalRoadEdges,
  legalSettlementVertices,
  payCost,
  robberVictimsByHex,
} from './legal.js';
import { drawCards, failure, findCard, performRobberMove } from './state.js';
import type { EngineFailure } from './state.js';
import { refreshDerived } from './awards.js';

type PlayCardAction = Extract<GameAction, { type: 'playCard' }>;
type BuyCardAction = Extract<GameAction, { type: 'buyCard' }>;

function isResource(value: string): value is Resource {
  return (RESOURCES as readonly string[]).includes(value);
}

function mergeGain(target: PartialResources, extra: PartialResources): void {
  for (const [resource, amount] of Object.entries(extra)) {
    if (!amount) continue;
    const key = resource as Resource;
    target[key] = (target[key] ?? 0) + amount;
  }
}

function validateChoice(
  draft: GameState,
  seat: Seat,
  def: CardDef,
  choice: PlayCardAction['choice'],
): EngineFailure | null {
  if (!def.choice) {
    if (choice) return failure('INVALID_CHOICE', `${def.name} takes no choice.`);
    return null;
  }

  if (def.choice === 'resources') {
    if (!choice) return null; // Provisioner defaults to two wood.
    if (choice.kind !== 'resources') {
      return failure('INVALID_CHOICE', `${def.name} needs two resources.`);
    }
    for (const resource of choice.resources) {
      if (!isResource(resource)) {
        return failure('INVALID_CHOICE', 'Unknown resource in choice.');
      }
    }
    return null;
  }

  if (def.choice === 'road') {
    const options = legalRoadEdges(draft, seat);
    if (!choice) {
      if (options.length > 0) {
        return failure('CHOICE_REQUIRED', `Choose an edge for the free road from ${def.name}.`);
      }
      return null; // no legal road: printed fallback
    }
    if (choice.kind !== 'road') return failure('INVALID_CHOICE', `${def.name} needs a road edge.`);
    if (!options.includes(choice.edge)) {
      return failure('INVALID_CHOICE', 'That edge is not a legal road for you.');
    }
    return null;
  }

  if (def.choice === 'settlement') {
    const options = legalSettlementVertices(draft, seat);
    if (!choice) {
      if (options.length > 0) {
        return failure('CHOICE_REQUIRED', `Choose a vertex for the free settlement from ${def.name}.`);
      }
      return null;
    }
    if (choice.kind !== 'settlement') {
      return failure('INVALID_CHOICE', `${def.name} needs a settlement vertex.`);
    }
    if (!options.includes(choice.vertex)) {
      return failure('INVALID_CHOICE', 'That vertex is not a legal settlement for you.');
    }
    return null;
  }

  // Robber choice: optional by design (Wrecker's Lamp).
  if (!choice) return null;
  if (choice.kind !== 'robber') {
    return failure('INVALID_CHOICE', `${def.name} needs a robber hex, not a resource.`);
  }
  const move = choice.move;
  if (!move) return null;
  const index = boardIndex(draft.board);
  if (!index.hex.has(move.hex)) {
    return failure('INVALID_ROBBER_HEX', `There is no hex ${move.hex}.`);
  }
  if (move.hex === draft.robberHex) {
    return failure('ROBBER_SAME_HEX', 'The robber must move to a different hex.');
  }
  if (move.victimSeat !== undefined) {
    const victims = robberVictimsByHex(draft, seat)[move.hex] ?? [];
    if (!victims.includes(move.victimSeat)) {
      return failure('INVALID_VICTIM', 'That player has no building on the chosen hex.');
    }
  }
  return null;
}

export function playCard(draft: GameState, seat: Seat, action: PlayCardAction): EngineFailure | null {
  if (seat !== draft.currentSeat) return failure('NOT_YOUR_TURN', 'It is not your turn.');
  if (draft.phase !== 'action') {
    return failure('WRONG_PHASE', 'Cards are played in the action phase.');
  }
  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');

  const handIndex = player.hand.findIndex((card) => card.iid === action.iid);
  const card = handIndex >= 0 ? player.hand[handIndex] : undefined;
  if (!card) return failure('NO_CARD', 'That card is not in your hand.');

  const def = findCard(card.defId);
  if (!def) return failure('INTERNAL', `Unknown card definition ${card.defId}.`);

  const choiceProblem = validateChoice(draft, seat, def, action.choice);
  if (choiceProblem) return choiceProblem;

  player.hand.splice(handIndex, 1);
  player.played.push(card);

  const entry = addLog(draft, 'card', `${player.name} plays ${def.name}.`, seat, {
    defId: def.id,
    name: def.name,
  });

  const gained: PartialResources = {};
  let drawn = 0;
  let renownGained = 0;
  const placedRoads: string[] = [];
  const placedSettlements: string[] = [];
  let robberHex: string | null = null;

  const add = (resources: PartialResources): void => {
    gainResources(player, resources);
    mergeGain(gained, resources);
  };

  for (const effect of def.effects as CardEffect[]) {
    switch (effect.kind) {
      case 'gain': {
        add(effect.resources);
        break;
      }
      case 'draw': {
        drawn += drawCards(draft, player, effect.count);
        break;
      }
      case 'renown': {
        player.renown += effect.amount;
        renownGained += effect.amount;
        break;
      }
      case 'chooseResources': {
        const picks: [Resource, Resource] =
          action.choice?.kind === 'resources' ? action.choice.resources : ['wood', 'wood'];
        const picked: PartialResources = {};
        const usable = picks.slice(0, Math.max(0, effect.count)) as Resource[];
        for (const resource of usable) {
          picked[resource] = (picked[resource] ?? 0) + 1;
        }
        add(picked);
        break;
      }
      case 'freeRoad': {
        const target =
          action.choice?.kind === 'road' && legalRoadEdges(draft, seat).includes(action.choice.edge)
            ? action.choice.edge
            : null;
        if (target) {
          draft.roads[target] = seat;
          placedRoads.push(target);
          addLog(draft, 'build', `${player.name} places a free road.`, seat, {
            edge: target,
            free: true,
            card: def.id,
          });
        } else {
          add(effect.fallback);
        }
        break;
      }
      case 'freeSettlement': {
        const target =
          action.choice?.kind === 'settlement' &&
          legalSettlementVertices(draft, seat).includes(action.choice.vertex)
            ? action.choice.vertex
            : null;
        if (target) {
          draft.buildings[target] = { owner: seat, type: 'settlement' };
          placedSettlements.push(target);
          addLog(draft, 'build', `${player.name} places a free settlement.`, seat, {
            vertex: target,
            free: true,
            card: def.id,
          });
        } else {
          add(effect.fallback);
        }
        break;
      }
      case 'optionalRobber': {
        if (action.choice?.kind === 'robber' && action.choice.move) {
          const move = action.choice.move;
          performRobberMove(draft, seat, move.hex, move.victimSeat);
          robberHex = move.hex;
        }
        break;
      }
      default: {
        break;
      }
    }

    refreshDerived(draft);
    // refreshDerived can end the game mid-card; the cast keeps the compiler
    // from narrowing the phase to 'action' across that call.
    if ((draft.phase as GamePhase) === 'gameOver') break;
  }

  entry.data = {
    defId: def.id,
    name: def.name,
    gained,
    drawn,
    renown: renownGained,
    ...(placedRoads.length > 0 ? { roads: placedRoads } : {}),
    ...(placedSettlements.length > 0 ? { settlements: placedSettlements } : {}),
    ...(robberHex ? { robberHex } : {}),
  };

  return null;
}

export function buyCard(draft: GameState, seat: Seat, action: BuyCardAction): EngineFailure | null {
  if (seat !== draft.currentSeat) return failure('NOT_YOUR_TURN', 'It is not your turn.');
  if (draft.phase !== 'action') {
    return failure('WRONG_PHASE', 'Cards are bought in the action phase.');
  }
  if (draft.turnFlags.purchased) {
    return failure('PURCHASE_LIMIT', 'You may buy only one card per turn.');
  }

  const def = findCard(action.defId);
  if (!def || (def.kind !== 'market' && def.kind !== 'charter')) {
    return failure('INVALID_ACTION', 'That card is not for sale.');
  }
  const player = draft.players[seat];
  if (!player) return failure('SEAT_INVALID', 'Unknown seat.');

  const stock = draft.market[def.id] ?? 0;
  if (stock <= 0) return failure('PILE_EMPTY', `${def.name} is sold out.`);
  if (!def.cost) return failure('INVALID_ACTION', `${def.name} has no printed cost.`);
  if (!canAfford(player.resources, def.cost)) {
    return failure('CANNOT_AFFORD', `You cannot afford ${def.name}.`);
  }

  payCost(player, def.cost);
  draft.market[def.id] = stock - 1;

  const instance = { iid: draft.nextCardIid, defId: def.id };
  draft.nextCardIid += 1;
  player.discard.push(instance);
  player.purchases += 1;
  player.bought[def.id] = (player.bought[def.id] ?? 0) + 1;
  if (def.kind === 'charter') {
    player.charters[def.id] = (player.charters[def.id] ?? 0) + 1;
  }
  draft.turnFlags.purchased = true;

  addLog(
    draft,
    'buy',
    `${player.name} buys ${def.name} for ${describeResources(def.cost)}.`,
    seat,
    { defId: def.id, remaining: stock - 1, purchases: player.purchases },
  );

  return null;
}

/** Exported for bots and tests: what the best bank rate would be right now. */
export function bankRate(state: GameState, seat: Seat, give: Resource): number {
  return bestBankRate(state, seat, give);
}
