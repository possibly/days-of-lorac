import { useEffect, useSyncExternalStore } from 'react';
import type { ClientSnapshot } from './store';
import { client } from './store';

/**
 * Subscribe to the active store and make sure it is running. Online that means
 * opening the socket; offline `start()` is a no-op. The effect only starts the
 * client; it never closes it, so StrictMode's mount/unmount/mount cycle cannot
 * create a second seat.
 */
export function useGame(): ClientSnapshot {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    client.start();
  }, []);
  return snapshot;
}

/** True once the welcome check passed, so the UI can trust the socket. */
export function useServerReady(): boolean {
  const snapshot = useGame();
  return snapshot.ready;
}
