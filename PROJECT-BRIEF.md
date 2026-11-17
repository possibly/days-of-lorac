# Days of Lorac: project brief

Working title. Browser board game: Settlers of Catan meets a deck builder.
2-4 players, bots, and peer tables through a small signaling relay.

This file is the contract between the lead and the subagents. Read it before
starting. If something here is wrong, say so in your report instead of silently
changing it.

## Product goal

A finished, fun, replayable game that a group can open in a browser and play
for 25-35 minutes. One human should be able to start a game against three bots
in two clicks and have a good time. Multiplayer should work across devices
without a game server holding the state.

"Fun" means:
- A real decision every turn: what to build, which card to buy, whether to
  trade, when to spend a big hand.
- Rising power. The deck you bought in the first five turns visibly changes
  what your later turns can do.
- Board tension. Hexes, roads, ports, and the robber matter, so the map is not
  just a resource counter.
- Comeback paths. Cards, ports, and contested awards give a player who is
  behind something to do.
- No dead turns. If a player has nothing to do, the UI should say why and the
  turn should end fast.

## Locked technical decisions

- TypeScript everywhere. One package, one repo.
- Client: React 18 + Vite. No UI framework, no CSS framework, no external
  fonts, no CDN assets. Inline SVG/CSS art only, so the game works offline.
- Rooms: no hosted game server. The host's tab runs the room manager and every
  guest connects to it over a WebRTC data channel. A Cloudflare Worker carries
  signaling only. No database. In-memory rooms.
- Shared engine: pure TypeScript, deterministic, seeded RNG, no DOM and no
  Node imports. The room manager and the balance simulator both use it.
- Tests: vitest for the engine, plus a headless bot simulation that plays full
  games.
- Dev/build:
  - `npm run dev` runs Vite. The game starts in the tab with bots.
  - `npm run build` builds the static client into `dist/client`.
  - `VITE_RELAY_URL` at build time, or `?relay=` at runtime, enables peer
    tables. Without it the build is solo only.
  - `npm test` runs unit tests.
- Production is a static site (GitHub Pages) plus the optional relay.
- File layout:
  - `src/shared/` engine, types, card data, protocol types, view filtering.
  - `src/server/` room manager, message router, bot policy, simulation scripts.
  - `src/client/` React app.
  - `docs/` design docs.
  - `scripts/` dev/smoke/balance helpers.
- Path alias `@shared/*` -> `src/shared/*` in both Vite and tsconfig.

## Mechanics skeleton (design agent owns the final numbers)

This is the starting point. Improve it if you find something clearly more fun,
but keep the shape: Catan board economy plus a Dominion-style personal deck.

### Board

- Standard 19-hex island, 3-4-5-4-3 rows, 54 vertices, 72 edges.
- Terrain: 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert.
- Number tokens: 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12;
  no 7. One balanced layout, randomly rotated/mirrored per game. No 6/8
  adjacent in the base layout.
- 9 ports on the coast: 4 generic 3:1, 5 resource-specific 2:1.
- Robber starts on the desert; a 7 moves it.

### Turn

1. Draw guild cards up to a hand of 5. Reshuffle discard when the deck runs
   out.
2. Roll 2d6. Every hex with that number gives its resource to adjacent
   settlements (1) and cities (2). A 7 triggers the robber: players above the
   resource limit discard half, the roller moves the robber and steals one
   resource.
3. Action phase: play any number of guild cards, trade with the bank/ports or
   other players, build roads/settlements/cities, and buy at most one card
   from the market. Cards bought go to the discard pile.
4. End turn: unplayed cards go to the discard pile, then pass.

### Costs and scoring

Catan base costs: road 1 wood 1 brick; settlement 1 wood 1 brick 1 sheep
1 wheat; city 2 wheat 3 ore. Ports and bank trades as usual. Ten victory
points wins immediately. Settlement 1 VP, city 2 VP. Longest trade route
(5+ continuous roads) +2, largest expedition (3 renown from quest/knight
cards) +2. Some cards score VP directly and become dead draws.

### Deck building

- Personal deck starts at 10 cards (suggested: 5 Forager, 5 Prospector or
  similar). Draw 5 per turn, play them all, discard the rest.
- Market has 8-10 card piles with limited copies, costs in resources, and
  visible text. One purchase per turn. Cards should create distinct
  strategies: production, cycling, board building, quests/renown, disruption,
  scoring.
- Keep individual cards choice-light. Choice effects are allowed, but each one
  needs a clean modal and bot support.
- No permanent tableau in v1. Played cards resolve and go to discard. Engine
  feel comes from card draw, conversion, deck thinning, and powerful
  combinations within a turn.

### Online

- Multiplayer needs a relay URL. Without one the title screen offers solo only.
- Host a table, then share the 4-letter code or its QR link (`#code=CODE`).
- Guests join, take a seat, the host adds bots, everyone readies, host starts.
- The host's tab filters hidden information per player (hand, deck order, other
  players' resources are public in Catan; keep resources public).
- If a guest drops, the host's room manager may let a bot fly the seat. A guest
  whose tab reloads resumes the same seat, as does a host, using a snapshot kept
  in that browser's localStorage. Nothing is uploaded, so another device cannot
  resume and the table stays with the host's browser.
- No account system. Name only.

## Design and code quality bar

- Exact card text and tooltips. A new player should understand every button.
- Legal moves only. The engine rejects illegal actions; the UI disables them
  before the player clicks.
- No infinite loops, no stuck phases, no bot stalls. Every turn must be
  finishable.
- Deterministic and testable. Given a seed and a list of actions, the same
  final state results.
- Engine tests cover board topology, setup, production, robber, trades,
  builds, card effects, scoring, and victory.
- Responsive from 1024px tablet landscape up. Phone landscape is a stretch.
- 60fps animations. Prefer CSS transitions/SVG transforms over a game engine.

## Working rules for agents

- Work only inside `/Users/hienqnguyen/dev/days-of-lorac`. Never touch
  `/Users/hienqnguyen/dev/buildersoflorac` or any other repo.
- Do not run `git commit`, `git checkout`, `git reset`, or `git clean`. The
  lead commits between waves.
- Do not spawn subagents. You are one fresh context; finish your task.
- Stick to the files your task owns. If you need a change in someone else's
  file, say so in your report instead of making a broad rewrite.
- Run the relevant tests/build before you report. A report without a
  verification command is incomplete.
- Report: what you built, files changed, exact commands you ran and their
  results, open questions, and anything the next agent must know.
- Keep scratch files in `/tmp`, not in the repo.
- No placeholder "TODO: implement" in shipped paths. If it is not done, say
  it is not done.

## Waves

1. Design (GAME-DESIGN.md, CARDS.md) + scaffold (package, room layer, client
   shell, build).
2. Contracts: shared types, action list, protocol, file map. Written by the
   lead or an architect agent.
3. Engine, room layer, client shell in parallel against contracts.
4. Bots, integration, full playable loop.
5. Balance simulation, UX polish, QA, screenshots.
6. Final hardening and handoff.

## Current environment

- macOS, Node 24.22.1, npm 11.x.
- Chrome is available for headless screenshots.
- The deployed game is a static site; the relay is the only service.
