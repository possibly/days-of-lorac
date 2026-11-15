/**
 * Deterministic pseudo-randomness for the bot.
 *
 * The bot must not call Math.random: two games with the same seed have to
 * replay identically, and the same `chooseBotAction(view)` call has to return
 * the same action every time it is asked. Everything here is a pure function
 * of its arguments, so a tie-break keyed on (gameId, turn, seat, candidate)
 * gives stable noise that differs between games and between candidates.
 */

/** FNV-1a over the string form of every part, with a separator mix between. */
export function hashParts(...parts: Array<string | number>): number {
  let hash = 2166136261 >>> 0;
  for (const part of parts) {
    const value = String(part);
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= 0x9e3779b9;
    hash = Math.imul(hash, 2246822519) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  return hash >>> 0;
}

/** Uniform value in [0, 1) from a 32-bit seed. */
export function unitFromSeed(seed: number): number {
  let x = seed >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Stable uniform value in [0, 1) for a tuple of parts. */
export function seededUnit(...parts: Array<string | number>): number {
  return unitFromSeed(hashParts(...parts));
}

/** Stable value in [-1, 1) for a tuple of parts. */
export function seededSigned(...parts: Array<string | number>): number {
  return seededUnit(...parts) * 2 - 1;
}
