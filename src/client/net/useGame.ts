import { useEffect, useSyncExternalStore } from 'react';
import type { ClientSnapshot } from './store';
import { client } from './store';

/**
 * Subscribe to the active store and make sure it is running. The in-tab bot
 * game has nothing to open; a peer table connects over its transport. The
 * effect only starts the client, never closes it, so StrictMode's
 * mount/unmount/mount cycle cannot create a second seat.
 */
export function useGame(): ClientSnapshot {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    client.start();
  }, []);
  return snapshot;
}
