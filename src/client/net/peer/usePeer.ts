import { useSyncExternalStore } from 'react';
import { peer } from './session';
import type { PeerSnapshot } from './session';

/** Subscribe a screen to the peer session. */
export function usePeer(): PeerSnapshot {
  return useSyncExternalStore(peer.subscribe, peer.getSnapshot, peer.getSnapshot);
}
