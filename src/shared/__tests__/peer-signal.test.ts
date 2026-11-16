import { describe, expect, it } from 'vitest';
import { decodeCode, encodeCode } from '../../client/net/peer/codec';
import { isOffer, joinUrl, readHashCode, trimSdp } from '../../client/net/peer/signaling';
import type { OfferPayload } from '../../client/net/peer/signaling';

const OFFER: OfferPayload = {
  v: 1,
  t: 'offer',
  id: 'p1',
  room: 'ABCD',
  host: 'Tyler',
  seats: 4,
  sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\na=candidate:1 1 udp 1 192.168.1.5 5000 typ host\r\n',
};

describe('peer codes', () => {
  it('round-trips an offer', async () => {
    const code = await encodeCode(OFFER);
    expect(code.length).toBeGreaterThan(20);
    expect(code).not.toMatch(/\s/);
    await expect(decodeCode<OfferPayload>(code)).resolves.toEqual(OFFER);
  });

  it('reads a code out of a pasted link', async () => {
    const code = await encodeCode(OFFER);
    const link = `https://possibly.github.io/days-of-lorac/#join=${code}`;
    await expect(decodeCode<OfferPayload>(link)).resolves.toEqual(OFFER);
  });

  it('tolerates whitespace from a copy that wrapped', async () => {
    const code = await encodeCode(OFFER);
    const wrapped = `${code.slice(0, 10)}\n${code.slice(10)}`;
    await expect(decodeCode<OfferPayload>(wrapped)).resolves.toEqual(OFFER);
  });

  it('rejects junk', async () => {
    await expect(decodeCode('nope')).resolves.toBeNull();
    await expect(decodeCode('z1zzzz')).resolves.toBeNull();
    await expect(decodeCode('')).resolves.toBeNull();
  });
});

describe('signaling', () => {
  it('validates offer payloads', () => {
    expect(isOffer(OFFER)).toBe(true);
    expect(isOffer({ ...OFFER, seats: 5 })).toBe(false);
    expect(isOffer({ ...OFFER, sdp: 1 })).toBe(false);
    expect(isOffer(null)).toBe(false);
  });

  it('puts the join code in the fragment', () => {
    const url = joinUrl('https://example.com/game/?room=ABCD', 'z1code');
    expect(url).toBe('https://example.com/game/?room=ABCD#join=z1code');
    expect(readHashCode(url, 'join')).toBe('z1code');
    expect(readHashCode(url, 'reply')).toBeNull();
  });

  it('keeps usable candidates only', () => {
    const sdp = [
      'v=0',
      'a=candidate:1 1 udp 1 192.168.1.5 5000 typ host',
      'a=candidate:2 1 tcp 1 192.168.1.5 9 typ host tcptype active',
      'a=candidate:3 1 udp 2 203.0.113.7 6000 typ srflx raddr 0.0.0.0 rport 0',
      'a=candidate:4 1 udp 3 198.51.100.9 3478 typ relay raddr 0.0.0.0 rport 0',
    ].join('\r\n');
    const trimmed = trimSdp(sdp);
    expect(trimmed).toContain('typ host');
    expect(trimmed).toContain('typ srflx');
    expect(trimmed).not.toContain('tcp');
    expect(trimmed).not.toContain('relay');
  });
});
