/**
 * Offline mode: the whole game runs in the browser, with bots, and there is no
 * WebSocket. Off for the normal `npm run dev` / `npm start` builds, on for the
 * GitHub Pages build (`VITE_OFFLINE=1`) and for `?offline=1` while developing.
 *
 * Query-string detection is there so a dev can test the static build without
 * rebuilding it with a different flag. It is not a security boundary.
 */
function envFlag(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const flag = env?.VITE_OFFLINE;
  return flag === '1' || flag === 'true' || flag === true;
}

export const OFFLINE_MODE: boolean = (() => {
  if (envFlag()) return true;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('offline') === '1';
})();
