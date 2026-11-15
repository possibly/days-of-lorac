# Days of Lorac

A browser board game: the island economy of Settlers of Catan with a personal
deck of guild cards layered on top. Two to four players, bots at three
difficulties, online rooms over a tailnet, one Node process with in-memory
state.

Build an outpost on good numbers, roll for production, spend resources on roads
and cities, and buy cards that turn your economy into victory points. The board
gives you goods. The deck decides what those goods become.

## Quick start

```bash
npm install
npm run build
npm start
```

Open:

- Local: http://localhost:8096
- Tailnet: http://100.69.138.118:8096

The server binds `0.0.0.0:8096`, so another device on the tailnet can join with
the second URL. If macOS asks whether Node may accept incoming connections,
allow it.

For development with hot reload:

```bash
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` and `/ws` to the game server on
8096.

## Play

- **Play vs bots**: two clicks from the title. Four seats, normal bots.
- **Create room**: a four-letter room code and an invite link. Add bots to open
  seats, or wait for friends.
- **Join with code**: paste the code or open the shared `?room=CODE` link.
- **Reconnect**: refresh the page. The browser stores a per-room token and
  resumes your seat. If you are gone for 45 seconds in a game, a bot takes over
  until you return.

A game runs about 25-35 minutes. Victory target is 14 points with four players,
16 with three, 18 with two. Settlements score 1, cities 2, the two awards 2
each, and charters 1 or 2. One market purchase per turn. The robber still
matters.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Game server plus Vite, hot reload on :5173. |
| `npm run build` | Typecheck, then build the client into `dist/client`. |
| `npm start` | Serve the built client and WebSocket on `0.0.0.0:8096`. |
| `npm test` | Engine, rooms, bots, and protocol tests. |
| `npm run check` | TypeScript only. |
| `npm run sim -- 50` | Headless bot balance run: 50 games per matchup. |
| `npm run sim -- 100 --players 4 --difficulty all` | Full balance sweep. |
| `npm run preview` | Build, then start. |

Other useful health checks:

```bash
curl -s localhost:8096/api/health
curl -s localhost:8096/api/rooms/ABCD
```

The server keeps rooms in memory. Restarting it ends every open game. That is
deliberate for a tailnet game with no database.

## Bots

- **Deckhand** (easy): loose play, weaker purchases, still finishes.
- **Factor** (normal): the default. Scores builds, plays its deck, trades,
  uses ports, and races the endgame.
- **Guildmaster** (hard): stronger purchase lookahead, better denial, tighter
  charter timing.

All three use the same policy with different weights. A full game is simulated
in `npm run sim`; the report includes win rates, game length, VP split, and
which market piles actually sell.

## Layout

```
src/shared/       types, constants, card data, protocol, pure engine
src/shared/engine board graph, setup, actions, cards, awards, legal moves, view
src/server/       HTTP, WebSocket rooms, reconnect, bot runner
src/server/bots/  bot policy and balance simulator
src/client/       React app, SVG board, hand, market, trade, modals
docs/             game design, card manifest, UI spec, implementation contracts
scripts/          balance CLI
```

`@shared/*` maps to `src/shared/*` in TypeScript, Vite, and Vitest. Shared code
is pure: no DOM, no Node imports, no dates, no `Math.random`. Randomness comes
from a seeded PRNG stored in the game state, so a seed plus an action list
replays exactly.

## Tests and balance

```bash
npm test
npm run check
npm run sim -- 50
```

The test suite covers the board graph, setup snake, production, the seven,
robber, every card and fallback, trades, ports, awards and ties, victory
mid-card, hidden-information filtering, room lifecycle, reconnect, and full
bot games. The simulator rejects any illegal action and fails on a stall.

Design docs:

- `docs/GAME-DESIGN.md`: rules and economy.
- `docs/CARDS.md`: card manifest and balance arithmetic.
- `docs/UI-SPEC.md`: screen layout and interaction spec.
- `docs/CONTRACTS.md`: engine, protocol, and file-ownership contract.
