import { describe, expect, it } from 'vitest';
import {
  RELAY_CODE_ALPHABET,
  isRelayCode,
  parseRelayClientMessage,
  randomRelayCode,
  relayServerMessage,
} from '@shared/relay';

describe('relay codes', () => {
  it('accepts four letters without I or O', () => {
    expect(isRelayCode('ABCD')).toBe(true);
    expect(isRelayCode('WXYZ')).toBe(true);
    expect(isRelayCode('ABCI')).toBe(false);
    expect(isRelayCode('ABCO')).toBe(false);
    expect(isRelayCode('ABC')).toBe(false);
    expect(isRelayCode('ABCDE')).toBe(false);
    expect(isRelayCode('abcd')).toBe(false);
    expect(isRelayCode(1234)).toBe(false);
  });

  it('never generates an ambiguous letter', () => {
    expect(RELAY_CODE_ALPHABET).not.toContain('I');
    expect(RELAY_CODE_ALPHABET).not.toContain('O');
    for (let index = 0; index < 200; index += 1) {
      expect(isRelayCode(randomRelayCode())).toBe(true);
    }
  });

  it('is deterministic when given a random source', () => {
    expect(randomRelayCode(() => 0)).toBe('AAAA');
    expect(randomRelayCode(() => 0.999999)).toBe('ZZZZ');
  });
});

describe('relay messages', () => {
  it('passes a well formed offer', () => {
    const message = parseRelayClientMessage(JSON.stringify({ t: 'offer', to: 'g1', sdp: 'v=0', room: 'ABCD' }));
    expect(message).toEqual({ t: 'offer', to: 'g1', sdp: 'v=0', room: 'ABCD' });
  });

  it('passes an answer and a bye', () => {
    expect(parseRelayClientMessage(JSON.stringify({ t: 'answer', sdp: 'v=0' }))).toEqual({
      t: 'answer',
      sdp: 'v=0',
    });
    expect(parseRelayClientMessage(JSON.stringify({ t: 'bye' }))).toEqual({ t: 'bye' });
  });

  it('drops anything the relay should not forward', () => {
    expect(parseRelayClientMessage('')).toBeNull();
    expect(parseRelayClientMessage('not json')).toBeNull();
    expect(parseRelayClientMessage(JSON.stringify({ t: 'chat', text: 'hi' }))).toBeNull();
    expect(parseRelayClientMessage(JSON.stringify({ t: 'offer', to: 'g1', sdp: '', room: 'ABCD' }))).toBeNull();
    expect(parseRelayClientMessage(JSON.stringify({ t: 'offer', to: 'g1', sdp: 'v=0', room: 'AB' }))).toBeNull();
    expect(parseRelayClientMessage(JSON.stringify({ t: 'answer' }))).toBeNull();
    expect(parseRelayClientMessage(JSON.stringify([]))).toBeNull();
    expect(parseRelayClientMessage('x'.repeat(30_000))).toBeNull();
  });

  it('reads server frames defensively', () => {
    expect(relayServerMessage(JSON.stringify({ t: 'welcome' }))?.t).toBe('welcome');
    expect(relayServerMessage('nope')).toBeNull();
    expect(relayServerMessage(JSON.stringify({ nope: true }))).toBeNull();
  });
});
