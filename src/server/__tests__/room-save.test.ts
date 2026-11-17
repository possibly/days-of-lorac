/**
 * Room snapshots: what the host tab parks in localStorage so a reload does not
 * end the table.
 *
 * The happy path matters less than the rejection paths. A snapshot is editable
 * with devtools and can outlive a deploy, so a bad one has to be ignored rather
 * than half-applied.
 */
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@shared/protocol';
import { GAME_VERSION } from '@shared/version';
import { RoomManager } from '../room-manager.js';
import { serializeRoom, parseRoomSave, SAVE_LOG_LIMIT, SAVE_VERSION } from '../room-save.js';
import type { ClientConnection, Clock, Room, TimerHandle } from '../rooms.js';

class FakeClock implements Clock {
  private nowMs = 1_700_000_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void, ms: number): TimerHandle {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.nowMs + Math.max(0, ms), callback });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }
}

class Recorder implements ClientConnection {
  readonly id: string;
  messages: ServerMessage[] = [];

  constructor(id: string) {
    this.id = id;
  }

  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | null {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index];
      if (message?.type === type) return message as Extract<ServerMessage, { type: T }>;
    }
    return null;
  }
}

function startGameWithBots(manager: RoomManager, host: Recorder): { code: string; room: Room } {
  manager.createRoom(host, { name: 'Tyler', maxPlayers: 2, difficulty: 'normal' });
  const lobby = host.last('lobby');
  if (!lobby) throw new Error('no lobby');
  const code = lobby.room.code;
  manager.addBotToRoom(host, 'normal');
  manager.startGame(host);
  const room = manager.getRoom(code);
  if (!room || !room.state) throw new Error('no game');
  return { code, room };
}

function parseAndTamper(raw: string, patch: (value: Record<string, unknown>) => void): string {
  const value = JSON.parse(raw) as Record<string, unknown>;
  patch(value);
  return JSON.stringify(value);
}

describe('room snapshots', () => {
  it('round-trips a started game with seats and tokens intact', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code, room } = startGameWithBots(manager, host);
    clock.advance(5000);

    const raw = manager.exportRoom(code);
    expect(raw).toBeTruthy();
    const save = parseRoomSave(raw ?? '');
    expect(save).not.toBeNull();
    expect(save?.v).toBe(SAVE_VERSION);
    expect(save?.gameVersion).toBe(GAME_VERSION);
    expect(save?.status).toBe('playing');
    expect(save?.state?.version).toBe(room.state?.version);
    expect(save?.seats[0]?.token).toBe(room.seats[0]?.token);
    expect(save?.seats[1]?.isBot).toBe(true);
    expect(save?.seats[1]?.token).toBeNull();

    const restored = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const back = restored.restoreRoom(raw ?? '');
    expect(back).not.toBeNull();
    expect(back?.code).toBe(code);
    expect(back?.status).toBe('playing');
    expect(back?.state?.version).toBe(room.state?.version);
    // Every seat starts disconnected: reconnecting is the normal resume path.
    expect(back?.seats[0]?.connected).toBe(false);
    expect(back?.seats[0]?.connection).toBeNull();
    expect(back?.seats[1]?.isBot).toBe(true);
  });

  it('puts the host back in its seat through the saved token', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code } = startGameWithBots(manager, host);
    const token = host.last('game')?.token ?? '';
    expect(token).toBeTruthy();
    const raw = manager.exportRoom(code) ?? '';

    const restored = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    expect(restored.restoreRoom(raw)).not.toBeNull();

    const back = new Recorder('h2');
    restored.resume(back, { code, token });
    const game = back.last('game');
    expect(game).not.toBeNull();
    expect(game?.you).toBe(0);
    expect(game?.roomCode).toBe(code);
  });

  it('trims the log without touching the live room', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code, room } = startGameWithBots(manager, host);
    const base = room.state?.log[0];
    room.state?.log.push(
      ...Array.from({ length: SAVE_LOG_LIMIT + 100 }, (_, index) => ({
        id: 10_000 + index,
        turn: 1,
        seat: null,
        kind: 'info' as const,
        text: `line ${index}`,
      })),
    );
    const total = room.state?.log.length ?? 0;

    const save = parseRoomSave(manager.exportRoom(code) ?? '');
    expect(save?.state?.log.length).toBe(SAVE_LOG_LIMIT);
    expect(save?.state?.log.at(-1)?.text).toBe(`line ${SAVE_LOG_LIMIT + 99}`);
    expect(room.state?.log.length).toBe(total);
    expect(base).toBeDefined();
  });

  it('rejects a snapshot from another build or version', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code } = startGameWithBots(manager, host);
    const raw = manager.exportRoom(code) ?? '';

    expect(parseRoomSave(parseAndTamper(raw, (value) => { value.v = 99; }))).toBeNull();
    expect(parseRoomSave(parseAndTamper(raw, (value) => { value.gameVersion = '0.0.1'; }))).toBeNull();
    expect(parseRoomSave('not json')).toBeNull();
    expect(parseRoomSave('')).toBeNull();
  });

  it('rejects seats with bad names, seats, or tokens', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code } = startGameWithBots(manager, host);
    const raw = manager.exportRoom(code) ?? '';

    expect(
      parseRoomSave(
        parseAndTamper(raw, (value) => {
          const seats = value.seats as ({ token: string } | null)[];
          if (seats[0]) seats[0].token = '<script>';
        }),
      ),
    ).toBeNull();

    expect(
      parseRoomSave(
        parseAndTamper(raw, (value) => {
          const seats = value.seats as ({ seat: number } | null)[];
          if (seats[0]) seats[0].seat = 9;
        }),
      ),
    ).toBeNull();

    expect(
      parseRoomSave(
        parseAndTamper(raw, (value) => {
          const seats = value.seats as ({ name: string } | null)[];
          if (seats[0]) seats[0].name = '   ';
        }),
      ),
    ).toBeNull();
  });

  it('cleans names and chat on the way back in', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code } = startGameWithBots(manager, host);
    const raw = manager.exportRoom(code) ?? '';

    const tampered = parseAndTamper(raw, (value) => {
      const seats = value.seats as ({ name: string } | null)[];
      if (seats[0]) seats[0].name = '<b>Tyler</b>';
      value.chat = [
        { id: 1, seat: 0, name: '<i>Ann</i>', text: '<script>alert(1)</script>hello', at: 1 },
        { id: 'nope', seat: 0, name: 'Ann', text: 'dropped' },
        { id: 2, seat: 2, name: 'Ann', text: 'x'.repeat(500), at: 2 },
      ];
    });
    const save = parseRoomSave(tampered);
    expect(save).not.toBeNull();
    // Stored names go through the same sanitiser as a live join.
    expect(save?.seats[0]?.name).toBe('bTyler/b');
    expect(save?.chat[0]?.name).toBe('iAnn/i');
    expect(save?.chat[0]?.text).toBe('alert(1) hello');
    expect(save?.chat).toHaveLength(2);
    expect(save?.chat[1]?.text.length).toBeLessThanOrEqual(200);
  });

  it('refuses a game state whose player list does not match the seats', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code } = startGameWithBots(manager, host);
    const raw = manager.exportRoom(code) ?? '';

    expect(
      parseRoomSave(
        parseAndTamper(raw, (value) => {
          const state = value.state as { players: unknown[] };
          state.players = state.players.slice(0, 1);
        }),
      ),
    ).toBeNull();

    expect(
      parseRoomSave(
        parseAndTamper(raw, (value) => {
          const state = value.state as { phase: string };
          state.phase = 'nonsense';
        }),
      ),
    ).toBeNull();
  });

  it('will not save a room that is gone', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    const { code } = startGameWithBots(manager, host);
    manager.closeAll('test over');
    expect(manager.exportRoom(code)).toBeNull();
  });

  it('serializes a lobby and restores it as one', () => {
    const clock = new FakeClock();
    const manager = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const host = new Recorder('h');
    manager.createRoom(host, { name: 'Tyler', maxPlayers: 3, difficulty: 'hard' });
    const code = host.last('lobby')?.room.code ?? '';
    const raw = serializeRoom(manager.getRoom(code) as Room, clock.now());

    const restored = new RoomManager({ clock, log: () => {}, botDelayMs: [0, 0] });
    const back = restored.restoreRoom(raw);
    expect(back?.status).toBe('lobby');
    expect(back?.state).toBeNull();
    expect(back?.config.maxPlayers).toBe(3);
    expect(back?.config.difficulty).toBe('hard');
  });
});
