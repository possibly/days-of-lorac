/**
 * Server configuration. Everything here is intentionally dumb and readable:
 * ports, paths, and where the game server can be reached from the tailnet.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_ROOT = fileURLToPath(new URL('.', import.meta.url));
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..', '..');
export const CLIENT_DIST_DIR = path.join(PROJECT_ROOT, 'dist', 'client');

/** Game server port. Vite proxies /api and /ws here during dev. */
export const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 8096;
export const HOST = process.env.HOST ?? '0.0.0.0';

/** WebSocket endpoint path. Must match the client and the Vite proxy. */
export const WS_PATH = '/ws';

/** Tailnet address of this machine. Override with TAILNET_IP when it moves. */
export const TAILNET_IP = process.env.TAILNET_IP ?? detectTailnetIp() ?? '100.69.138.118';

function detectTailnetIp(): string | null {
  try {
    const out = execFileSync('tailscale', ['ip', '-4'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    });
    const first = out.trim().split('\n')[0]?.trim();
    return first && /^\d+\.\d+\.\d+\.\d+$/.test(first) ? first : null;
  } catch {
    return null;
  }
}
