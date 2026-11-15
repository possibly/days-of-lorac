import { describe, expect, it } from 'vitest';
import { legalMoves } from '@shared/engine/index';
import { RoomManager } from '../../room-manager.js';
import type { ServerMessage } from '@shared/protocol';
import type { ClientConnection, Clock, TimerHandle } from '../../rooms.js';

class FakeClock implements Clock {
  private nowMs = 1_700_000_000_000;
  private nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();
  now() { return this.nowMs; }
  setTimeout(cb: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + Math.max(0, ms), callback: cb });
    return id as unknown as TimerHandle;
  }
  clearTimeout(h: TimerHandle) { this.timers.delete(h as unknown as number); }
  get pending() { return this.timers.size; }
  advance(ms: number) {
    const target = this.nowMs + ms;
    for (let g = 0; g < 10000; g++) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at > target) continue;
        if (t.at < nextAt) { nextId = id; nextAt = t.at; }
      }
      if (nextId === null) break;
      const t = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.nowMs = t.at;
      t.callback();
    }
    this.nowMs = target;
  }
}

class FakeConn implements ClientConnection {
  readonly id = 'c';
  messages: ServerMessage[] = [];
  send(m: ServerMessage) { this.messages.push(m); }
}

describe('dbg', () => {
  it('shows setup progress', () => {
    const clock = new FakeClock();
    let seedN = 2000;
    const manager = new RoomManager({ clock, botDelayMs: [500,500], log: () => {}, seed: () => ++seedN, code: () => 'ABCD' });
    const host = new FakeConn();
    manager.quickPlay(host, { name: 'Ada', seats: 4, difficulty: 'normal' });
    const code = 'ABCD';
    for (let i = 0; i < 8; i++) {
      const st = manager.getRoom(code)!.state!;
      console.log(i, 'seat', st.currentSeat, 'step', st.setup?.step, 'idx', st.setup?.index, 'phase', st.phase, 'pending', clock.pending);
      if (st.currentSeat === 0 && st.setup) break;
      clock.advance(600);
    }
    const st = manager.getRoom(code)!.state!;
    const open = legalMoves(st, 0);
    console.log('settlements', open.setupSettlements.length, 'roads', open.setupRoads.length, 'firstSeat', st.firstSeat, 'order', st.setup?.order);
    const v = open.setupSettlements[0]!;
    manager.action(host, { type: 'setupSettlement', vertex: v });
    console.log('after settlement pending', clock.pending, 'seat', manager.getRoom(code)!.state!.currentSeat, 'idx', manager.getRoom(code)!.state!.setup?.index);
    const road = legalMoves(manager.getRoom(code)!.state!, 0).setupRoads[0]!;
    manager.action(host, { type: 'setupRoad', edge: road });
    console.log('after road pending', clock.pending, 'seat', manager.getRoom(code)!.state!.currentSeat, 'idx', manager.getRoom(code)!.state!.setup?.index);
    console.log('last errors', host.messages.filter(m => m.type === 'error'));
  });
});
