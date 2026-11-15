/**
 * Log helpers. Every entry is public-safe: no deck order, no hand contents.
 * State keeps every entry; `viewFor` trims to the last 120 for the wire.
 */
import type { GameState, LogKind, Seat } from '../types.js';

export function playerName(state: GameState, seat: Seat | null): string {
  if (seat === null) return 'The island';
  return state.players[seat]?.name ?? `Seat ${seat}`;
}

export function addLog(
  draft: GameState,
  kind: LogKind,
  text: string,
  seat: Seat | null = null,
  data?: Record<string, unknown>,
): GameState['log'][number] {
  const entry: GameState['log'][number] = {
    id: draft.nextLogId,
    turn: draft.turn,
    seat,
    kind,
    text,
  };
  if (data !== undefined) entry.data = data;
  draft.nextLogId += 1;
  draft.log.push(entry);
  return entry;
}

/** "wood, brick" -> "2 wood, 1 brick"; empty map -> "nothing". */
export function describeResources(resources: Partial<Record<string, number>>): string {
  const parts: string[] = [];
  for (const [resource, count] of Object.entries(resources)) {
    if (!count || count <= 0) continue;
    parts.push(`${count} ${resource}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}
