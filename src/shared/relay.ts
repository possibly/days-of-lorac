/**
 * Signaling protocol for the peer relay.
 *
 * Shared by the Cloudflare Worker that relays and by the browser that speaks to
 * it. The relay only ever sees session descriptions, never a game action, so
 * these types deliberately have no room state in them beyond the room code the
 * guest needs to join once the data channel is open.
 */

/** Same alphabet as the game's room codes: no I, no O. */
export const RELAY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const RELAY_CODE_LENGTH = 4;
export const RELAY_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/;

/** Largest signaling frame we accept, in characters. An SDP is about 2 KB. */
export const RELAY_MAX_MESSAGE = 24_000;

/** One host plus three guests, matching the largest table. */
export const RELAY_MAX_GUESTS = 3;

export type RelayRole = 'host' | 'guest';

export type RelayClientMessage =
  /** Host only. The guest it is for, the SDP, and the game room to join. */
  | { t: 'offer'; to: string; sdp: string; room: string }
  /** Guest only. */
  | { t: 'answer'; sdp: string }
  | { t: 'bye' };

export type RelayServerMessage =
  | { t: 'welcome'; role: RelayRole; code: string; id: string }
  /** Host only: a guest took a seat in the relay room. */
  | { t: 'join'; from: string }
  /** Guest only. */
  | { t: 'offer'; from: string; sdp: string; room: string }
  /** Host only. */
  | { t: 'answer'; from: string; sdp: string }
  | { t: 'gone'; from: string }
  | { t: 'error'; code: string; message: string };

export function isRelayCode(value: unknown): value is string {
  return typeof value === 'string' && RELAY_CODE_PATTERN.test(value);
}

export function randomRelayCode(random: () => number = Math.random): string {
  let code = '';
  for (let index = 0; index < RELAY_CODE_LENGTH; index += 1) {
    const pick = Math.min(
      RELAY_CODE_ALPHABET.length - 1,
      Math.floor(random() * RELAY_CODE_ALPHABET.length),
    );
    code += RELAY_CODE_ALPHABET.charAt(pick);
  }
  return code;
}

/** Strict enough that the relay never forwards a surprise. */
export function parseRelayClientMessage(raw: string): RelayClientMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > RELAY_MAX_MESSAGE) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.t === 'offer') {
    if (typeof message.to !== 'string' || message.to.length > 16) return null;
    if (typeof message.sdp !== 'string' || message.sdp.length === 0) return null;
    if (typeof message.room !== 'string' || !isRelayCode(message.room)) return null;
    return { t: 'offer', to: message.to, sdp: message.sdp, room: message.room };
  }
  if (message.t === 'answer') {
    if (typeof message.sdp !== 'string' || message.sdp.length === 0) return null;
    return { t: 'answer', sdp: message.sdp };
  }
  if (message.t === 'bye') return { t: 'bye' };
  return null;
}

export function relayServerMessage(raw: string): RelayServerMessage | null {
  if (!raw || raw.length > RELAY_MAX_MESSAGE) return null;
  try {
    const value = JSON.parse(raw) as RelayServerMessage;
    if (typeof value === 'object' && value !== null && typeof value.t === 'string') return value;
    return null;
  } catch {
    return null;
  }
}
