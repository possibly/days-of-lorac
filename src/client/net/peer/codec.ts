/**
 * Signaling codes: JSON, gzipped when the browser allows it, then base64url.
 *
 * A code has to survive being pasted into a chat app or read off a screen, so
 * it is one continuous token with no spaces. The first two characters say how
 * the rest is encoded:
 *
 *   z1...  gzipped (CompressionStream, every current browser)
 *   u1...  raw UTF-8 JSON, base64url, for browsers without CompressionStream
 *
 * `decodeCode` also accepts a full URL that carries the code in `#join=` or
 * `#reply=`, so a pasted link works wherever a pasted code does.
 */

const GZIP = 'z1';
const RAW = 'u1';

export async function encodeCode(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const packed = await gzip(bytes);
  const body = toBase64Url(packed ?? bytes);
  return `${packed ? GZIP : RAW}${body}`;
}

export async function decodeCode<T>(input: string): Promise<T | null> {
  const code = extractCode(input);
  if (!code) return null;
  const prefix = code.slice(0, 2);
  if (prefix !== GZIP && prefix !== RAW) return null;
  const body = fromBase64Url(code.slice(2));
  if (!body) return null;
  const bytes = prefix === GZIP ? await gunzip(body) : body;
  if (!bytes) return null;
  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Pulls the token out of a pasted URL, or returns the trimmed input. */
function extractCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /[#?&](?:join|reply)=([^&\s]+)/.exec(trimmed);
  const raw = match?.[1] ? decodeURIComponent(match[1]) : trimmed;
  const compact = raw.replace(/\s+/g, '');
  return compact.length > 2 ? compact : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large SDP cannot blow the argument limit of String.fromCharCode.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** A plain ArrayBuffer, so Blob accepts it under any TS lib version. */
function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([copyBuffer(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([copyBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}
