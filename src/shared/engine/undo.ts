/**
 * One-step takeback for a card play.
 *
 * The engine is pure: `applyAction` clones before mutating and returns a new
 * state. Keeping the pre-play state in a WeakMap keyed by the returned state
 * gives the next action a safe snapshot without putting hidden deck order on
 * the wire or into `GameState`. A later accepted action produces a new state
 * with no entry, so only the last action can be taken back.
 */
import type { GameState, Seat } from '../types.js';

export interface UndoRecord {
  seat: Seat;
  iid: number;
  name: string;
  before: GameState;
}

const records = new WeakMap<GameState, UndoRecord>();

export function setUndo(state: GameState, record: UndoRecord): void {
  records.set(state, record);
}

export function peekUndo(state: GameState): UndoRecord | null {
  return records.get(state) ?? null;
}

export function takeUndo(state: GameState): UndoRecord | null {
  const record = records.get(state) ?? null;
  records.delete(state);
  return record;
}
