# Days of Lorac

Catan meets a deck builder, in the browser. Two to four players build an outpost
on the island, roll for production, and buy guild cards that turn goods into
victory points. Bots and peer tables run the same shared engine.

## Play

- **Solo:** https://possibly.github.io/days-of-lorac/
  The whole game, bots included, runs in the tab. Refresh starts a new game.
- **With friends:** host a table, share the four-letter code, and guests join
  from any device. The host's tab holds the room; game data goes straight
  between the browsers over WebRTC. The Cloudflare relay only carries the
  handshake.

Multiplayer is off unless the build has a relay URL. Without one the title
screen offers solo play only. The host's tab has to stay open and awake for the
whole game, and a refresh ends the table. See [docs/PEER.md](docs/PEER.md).

Victory target is 14 points with four players, 16 with three, 18 with two.
Settlements score 1, cities 2, each award 2, charters 1 or 2. One market
purchase per turn. A game runs roughly 25 to 35 minutes.

## Quick start

```bash
npm install
npm run dev      # Vite on :5173
```

Build the static site:

```bash
VITE_BASE=/days-of-lorac/ VITE_RELAY_URL=https://…workers.dev npm run build
```

`VITE_BASE` matches the site path: `/<repo>/` for a project page, `/` for a user
page or custom domain. `VITE_RELAY_URL` is optional. Pass `?relay=https://…` per
visit to try a relay without rebuilding; `?relay=off` forces solo.

Deploy the relay once, then set the repository variable `LORAC_RELAY_URL` so the
Pages build picks it up. Until then the deployed game is solo only.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite with hot reload on :5173. |
| `npm run build` | Typecheck and build the client into `dist/client`. |
| `npm test` | Engine, rooms, bots, and protocol tests. |
| `npm run check` | TypeScript only. |
| `npm run sim -- 50` | Headless balance run, 50 games per matchup. |
| `npm run relay:dev` | Signaling relay locally on :8787 (no account). |
| `npm run relay:deploy` | Deploy the relay (free plan, needs `wrangler login`). |
| `npm run relay:check` | Typecheck the relay Worker. |

To try multiplayer locally, start the relay, then open
`http://127.0.0.1:5173/?relay=http://127.0.0.1:8787`.

## Layout

```
src/shared/       types, constants, cards, protocol, pure engine
src/shared/engine board, setup, actions, cards, awards, legal moves, views
src/server/       room manager, message router, bot policy and balance simulator
src/client/       React app, SVG board, hand, market, trade, modals
src/client/net/peer/  WebRTC peer tables: relay signaling, host, session
relay/            Cloudflare Worker and Durable Object for signaling
docs/             rules, card manifest, UI spec, contracts
```

`@shared/*` maps to `src/shared/*`. Shared code is pure: no DOM, no Node imports,
no dates, no `Math.random`. Randomness comes from a seeded PRNG in game state, so
a seed plus an action list replays exactly.

Design docs: `docs/GAME-DESIGN.md` (rules and economy), `docs/CARDS.md` (card
manifest), `docs/UI-SPEC.md` (screens), `docs/CONTRACTS.md` (engine and protocol).
