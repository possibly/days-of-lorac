/**
 * WebRTC settings shared by the relay's host and guest sides.
 *
 * There is no TURN server in this build. STUN covers most home networks, and
 * two devices on one wifi connect without it at all.
 */

/** STUN only. Both peers on one network connect without it at all. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** Drops candidates that this build cannot use: no TURN, no TCP. */
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
 * local description. The relay forwards one complete description per side, so
 * gather before sending.
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
