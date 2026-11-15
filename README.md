# Days of Lorac

Browser board game: a Catan-style island economy plus a Dominion-style personal deck. 2-4
players, bots, online rooms over Tailscale, one Node process with in-memory state.

This repo is at the scaffold stage. What works today: the build, the static server, the health
endpoint, the WebSocket handshake, and a title screen with a live connection indicator. The
engine, rooms, and actual gameplay are next.

Design docs live in `docs/`. Read `PROJECT-BRIEF.md` before changing anything structural.

## Requirements

- Node 24 (`node -v` must print v24.x)
- npm 11+

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Runs the game server (`tsx watch`) and Vite together. Open http://localhost:5173. |
| `npm run build` | `tsc --noEmit` then Vite build to `dist/client`. |
| `npm start` | Runs the game server against `dist/client` on `0.0.0.0:8096`. Run `npm run build` first. |
| `npm test` | `vitest run`. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run check` | Typecheck only (`tsc --noEmit`). |
| `npm run preview` | Build then start, for checking the production bundle. |

## Ports and URLs

- Game server: `0.0.0.0:8096` (`PORT` overrides). Tailnet: **http://100.69.138.118:8096**
- Vite dev server: `localhost:5173`, proxying `/api` and `/ws` to `127.0.0.1:8096`.
- WebSocket endpoint: `/ws`.
- Health check: `GET /api/health` returns JSON with version, uptime, socket count, and whether
  `dist/client` exists.

`TAILNET_IP` and `HOST` are read at startup. The server tries `tailscale ip -4` for the tailnet
address and falls back to the known IP. Do not use ports 8080, 8787, or 8090; other projects own
them.

## Layout

```
src/shared/     engine, types, card data, protocol types, view filtering (pure TS, no DOM/Node)
src/shared/version.ts        GAME_VERSION, the single version source
src/shared/__tests__/        vitest specs for shared code
src/server/     index.ts (http + routes), static.ts, ws.ts, config.ts
src/client/     index.html, main.tsx, App.tsx, styles.css
dist/client/    build output (gitignored)
```

## Importing shared code

`@shared/*` maps to `src/shared/*` and works in all three places that matter, with no extra
loader:

- `tsconfig.json` `paths` (typecheck, and tsx reads it at runtime for the server),
- `vite.config.ts` `resolve.alias` (client bundling),
- `vitest.config.ts` `resolve.alias` (tests).

Rules:

- Import shared code as `@shared/version`, `@shared/engine`, etc. Never as `../../shared/...`.
  It keeps the server, client, and tests on one specifier, and Vite chunking stays predictable.
- Relative imports inside a layer are fine (`./ws.js`). Server-relative imports use the `.js`
  extension, node ESM style; TS maps that to the `.ts` file under `moduleResolution: Bundler`.
- `src/shared/` must stay pure: no `node:` imports, no DOM, no `process`. The server, the client,
  and the headless balance simulator all import it.

## Verify a checkout

```bash
npm install
npm run check          # typecheck
npm test               # unit tests
npm run build          # writes dist/client
npm start &            # binds 0.0.0.0:8096
curl -s localhost:8096/api/health   # {"ok":true,"version":"0.1.0",...}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8096/     # 200
kill %1
```

Dev flow: `npm run dev`, open http://localhost:5173. The footer should read "Server connected".
If it says "Server offline", the game server is not up on 8096 and the Vite proxy has nowhere to
send `/ws`.

Without `dist/client`, the server still starts and answers `/` with a page telling you to run
`npm run build` or `npm run dev`. That is intentional: dev and production share the process.

## Notes for the next agents

- Room codes, seats, the bot runner, and the game loop go in `src/server/rooms.ts` and friends.
  `src/server/index.ts` and `src/server/ws.ts` each carry a TODO block with the intended shape.
- The WebSocket layer currently only greets, pings, and rejects unknown message types. It knows
  nothing about rooms. Put protocol types in `src/shared/protocol.ts` before wiring rooms so the
  client and server share one definition.
- Bump the version in exactly one place, `src/shared/version.ts`, and a test fails if it drifts
  from `package.json`.
- Keep `GAME_VERSION` in the WebSocket hello. The client already warns when server and client
  versions disagree, which saves you from stale-tab bugs during multiplayer testing.
