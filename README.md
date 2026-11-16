# Days of Lorac

Catan meets a deck builder, in the browser. Two to four players build an outpost
on the island, roll for production, and buy guild cards that turn goods into
victory points. Bots, online rooms, and a fully offline build all run the same
shared engine.

## Play

- **Offline (GitHub Pages):** https://possibly.github.io/days-of-lorac/
  The whole game runs in the tab, bots included. No server, no network calls.
  A refresh starts a new game.
- **Online (own server):** `npm start`, then open `http://localhost:8096`.
  Create a room, share the four-letter code or `?room=CODE` link, add bots to
  open seats. Refresh resumes your seat.
- **Peer table (no server at all):** in the Pages build, choose "Host a table".
  Phones scan the invite QR or open the shared link and reply with a code the
  host scans or pastes. The host's tab runs the room, bots included. See
  [docs/PEER.md](docs/PEER.md).

Peer tables are the only mode that works on a static host with no service
behind it. The trade is that the host's tab has to stay open and awake for the
whole game, and a refresh ends the table.

Victory target is 14 points with four players, 16 with three, 18 with two.
Settlements score 1, cities 2, each award 2, charters 1 or 2. One market
purchase per turn. A game runs roughly 25 to 35 minutes.

## Quick start

```bash
npm install
npm run dev      # Vite on :5173, game server on :8096
```

Production build and server:

```bash
npm run build
npm start        # serves dist/client and /ws on 0.0.0.0:8096
```

Static build for GitHub Pages (no server, offline mode):

```bash
VITE_BASE=/days-of-lorac/ npm run build:offline
```

The offline flag is `VITE_OFFLINE=1`. Add `?offline=1` to any build to test the
offline path without rebuilding. `VITE_BASE` must match the site path: `/<repo>/`
for a project page, `/` for a user page or local server.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Game server plus Vite, hot reload. |
| `npm run build` | Typecheck and build the client into `dist/client`. |
| `npm run build:offline` | Same, with the in-browser store and no WebSocket. |
| `npm start` | Serve the built client and WebSocket on :8096. |
| `npm test` | Engine, rooms, bots, and protocol tests. |
| `npm run check` | TypeScript only. |
| `npm run sim -- 50` | Headless balance run, 50 games per matchup. |

## Layout

```
src/shared/       types, constants, cards, protocol, pure engine
src/shared/engine board, setup, actions, cards, awards, legal moves, views
src/server/       HTTP, rooms, reconnect, bot runner
src/server/bots/  bot policy and balance simulator
src/client/       React app, SVG board, hand, market, trade, modals
src/client/net/peer/  WebRTC peer tables: codec, signaling, host, guest, session
docs/             rules, card manifest, UI spec, contracts
```

`@shared/*` maps to `src/shared/*`. Shared code is pure: no DOM, no Node imports,
no dates, no `Math.random`. Randomness comes from a seeded PRNG in game state, so
a seed plus an action list replays exactly.

Design docs: `docs/GAME-DESIGN.md` (rules and economy), `docs/CARDS.md` (card
manifest), `docs/UI-SPEC.md` (screens), `docs/CONTRACTS.md` (engine and protocol).
