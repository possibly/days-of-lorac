/**
 * Peer signaling payloads and the small amount of SDP surgery they need.
 *
 * There is no rendezvous server, so an offer travels by URL (or QR code) and an
 * answer comes back as a pasted code. Both payloads are plain objects that
 * `codec.ts` compresses.
 *
 * Candidate filtering exists for the QR path: a phone screen can only show so
 * many modules, so TCP and relay candidates are dropped before encoding. There
 * is no TURN server in this build, so relay candidates would be unusable
 * anyway.
 */

export const SIGNAL_VERSION = 1;

export interface OfferPayload {
  v: typeof SIGNAL_VERSION;
  t: 'offer';
  /** Matches the host's pending peer connection. */
  id: string;
  /** Room the guest should join once the channel is open. */
  room: string;
  host: string;
  seats: 2 | 3 | 4;
  sdp: string;
}

export interface AnswerPayload {
  v: typeof SIGNAL_VERSION;
  t: 'answer';
  id: string;
  sdp: string;
}

export type SignalPayload = OfferPayload | AnswerPayload;

export const HASH_KEY = 'join';
export const REPLY_HASH_KEY = 'reply';

/** STUN only. Both peers on one network connect without it at all. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export function isOffer(value: unknown): value is OfferPayload {
  if (!isRecord(value)) return false;
  return (
    value.v === SIGNAL_VERSION &&
    value.t === 'offer' &&
    typeof value.id === 'string' &&
    typeof value.room === 'string' &&
    typeof value.host === 'string' &&
    (value.seats === 2 || value.seats === 3 || value.seats === 4) &&
    typeof value.sdp === 'string'
  );
}

export function isAnswer(value: unknown): value is AnswerPayload {
  if (!isRecord(value)) return false;
  return (
    value.v === SIGNAL_VERSION &&
    value.t === 'answer' &&
    typeof value.id === 'string' &&
    typeof value.sdp === 'string'
  );
}

/** `?room=` links stay untouched; the join code goes in the fragment. */
export function joinUrl(currentHref: string, code: string): string {
  const url = new URL(currentHref);
  url.hash = `${HASH_KEY}=${code}`;
  return url.toString();
}

/** Same idea for the guest's reply, under its own fragment key. */
export function replyUrl(currentHref: string, code: string): string {
  const url = new URL(currentHref);
  url.hash = `${REPLY_HASH_KEY}=${code}`;
  return url.toString();
}

export function readHashCode(href: string, key: string): string | null {
  const hash = new URL(href).hash.replace(/^#/, '');
  if (!hash) return null;
  const value = new URLSearchParams(hash).get(key);
  return value ? value : null;
}

/** Drops candidates that a manual handshake cannot use. */
export function trimSdp(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter((line) => {
      if (!line.startsWith('a=candidate:')) return true;
      if (/\stcp\s/i.test(line)) return false;
      const type = /\styp\s+(\S+)/.exec(line)?.[1];
      return type === 'host' || type === 'srflx';
    })
    .join('\r\n');
}

/**
 * Waits until ICE gathering finishes, or until `timeoutMs`, then returns the
 * local description. Manual signaling has no trickle channel, so the SDP has to
 * be complete before it is encoded.
 */
export function gatheredDescription(pc: RTCPeerConnection, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (pc.iceGatheringState === 'complete') {
      resolve(pc.localDescription?.sdp ?? '');
      return;
    }
    const finish = (): void => {
      window.clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      const sdp = pc.localDescription?.sdp ?? '';
      if (!sdp) reject(new Error('The browser produced no session description.'));
      else resolve(sdp);
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    // Long enough for a STUN round trip, short enough that nobody stares at a
    // spinner on a network where STUN is filtered.
    const timer = window.setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
