/**
 * Single source of truth for the game version shown in the client, sent in the
 * WebSocket hello, and reported by /api/health.
 *
 * Keep in sync with package.json `version` (the unit test enforces this).
 * This module must stay pure JS: no DOM, no Node imports.
 */
export const GAME_VERSION = '0.1.3';

/** Short label for UI chrome, e.g. "v0.1.0". */
export const versionLabel = (): string => `v${GAME_VERSION}`;
