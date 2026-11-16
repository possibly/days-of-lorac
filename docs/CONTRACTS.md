# Implementation contracts

This file is the handoff between the engine, room layer, bot, and client teams. The
design docs own the rules. `src/shared/types.ts`, `constants.ts`, `cards.ts`,
`board-template.ts`, and `protocol.ts` own the shapes. When a shape here is not
enough, add to those files; do not create a parallel type.

## File ownership

| Area | Files | Owner |
| --- | --- | --- |
| Shared contracts | `src/shared/types.ts`, `constants.ts`, `cards.ts`, `board-template.ts`, `protocol.ts` | lead |
| Engine | `src/shared/engine/**`, engine tests | engine agent |
| Room layer | `src/server/**` | room agent |
| Bots | `src/server/bots/**`, `scripts/balance.ts` | bot agent |
| Client | `src/client/**` | client agent |
| Docs | `docs/**` | design agent / lead |

Do not edit another owner's files. If a contract is wrong, report it and work
around it locally.

## Engine API

Create `src/shared/engine/index.ts` exporting:

```ts
createGame(options: CreateGameOptions): GameState
applyAction(state: GameState, seat: Seat, action: GameAction): ActionResult
legalMoves(state: GameState, seat: Seat): LegalMoves
viewFor(state: GameState, seat: Seat, connected?: Partial<Record<Seat, boolean>>): GameView
scorePlayer(state: GameState, seat: Seat): VpBreakdown
longestRoadLength(state: GameState, seat: Seat): number
bestBankRate(state: GameState, seat: Seat, give: Resource): number
```

`createGame`:
- Validates 2-4 players, target from `targetVpFor`.
- Draws a board orientation from the seed (rotation 0-5, mirror 0-1), then the
  map layout for `options.map` (defaults to the classic fixed standard island),
  then builds the full graph, ports, terrain, and tokens. Fixed land and fixed
  numbers consume no randomness; other modes draw from the same RNG.
- Resolves the card market for `options.cards` (defaults to the standard pool at
  printed prices). The result is `state.market` (stock by defId) and
  `state.cardCosts` (price by defId). Standard at printed prices consumes no
  randomness, so default games replay exactly as before the feature. The mode
  goes on the public config as `config.cards`.
- Refuses a player count the island cannot seat (`compact` holds two).
- Draws a seeded `firstSeat` after the board draws, before the deck shuffles.
  `setup.order[0]`, `firstSeat`, and the first play turn all agree.
- Puts the robber on the desert (the first desert in id order when a map has
  two).
- Builds the snake setup order for the player count, rotated to start at
  `firstSeat` and run clockwise.
- Creates each player's 10-card starting deck, shuffles it with the game RNG,
  and draws 5. Do this after the board and first-seat draw so RNG order is
  stable.
- `log` has a setup entry per placement, not a per-card entry.
- The market stocks only the cards this game deals. `def.cost` is the printed
  price; `state.cardCosts[defId]` is the price this game charges. `buyCard`,
  `legalMoves().buyable`, and the bots read the latter.
- `version = 0`, `turn = 0` until setup ends. When the last setup road lands:
  `setup = null`, `phase = 'roll'`, `turn = 1`, `currentSeat = firstSeat`, and
  append a turn-start log entry.
- No starting resources. Setup settlements score 1 VP each, so refresh VP, but
  the target cannot be reached during setup.

`applyAction`:
- Never mutates the input. Clone the state, apply to the clone, return the new
  state. On any error return `{ ok: false, code, message }` and leave the input
  untouched.
- `seat` is the acting player, injected by the room layer. Never trust a seat in
  the action payload; actions do not carry one.
- Normal actions require `seat === state.currentSeat` and the right phase.
- Two out-of-turn actions are legal:
  - `discard` by any seat in `discardQueue` while `phase === 'discard'`.
  - `respondTrade` by a recipient of `state.tradeOffer` during another player's
    action phase.
- `respondTrade` with `accept: false` removes that viewer from the offer's
  recipient list and logs the decline. The offer closes when no recipients
  remain. A decline by one player does not cancel the offer for the others.
- After every mutation, call one `refreshDerived(draft)` that recomputes
  longest-road values, awards, VP, and `winner`. Call it inside card resolution
  too, after each atomic effect, and stop resolving the card if someone has won.
- Every accepted action increments `version`, appends log entries, and sets
  `winner` if the target is reached. `phase` becomes `gameOver` when won.
- Buying a charter can win immediately; check it before returning.
- A play that removes a road or settlement does not exist in v1, but award
  recomputation must still handle a road cutoff caused by an opponent's new
  settlement in the same action.

`legalMoves`:
- Must match the engine exactly. Any action the UI offers must be in this list.
- Empty arrays, not undefined, outside the relevant phase.
- `build.roads/settlements/cities` are legal placements regardless of
  affordability. `affordable` says whether the player can pay right now.
- `playable` includes every non-charter card in hand. Charters are not
  playable in the UI even though the engine tolerates it.
- For cards with targets, include every legal target in the option arrays.
  Guild Mason/Shipwright's Yard are playable with no target only when no legal
  target exists (their fallback); otherwise the UI must send a target.
- `bankTrades`: best rate only, one entry per (give, receive) pair the player can
  afford. `count` is the rate (4, 3, or 2).
- `buyable`: affordable, in-stock card ids, and only when `!turnFlags.purchased`.
- `purchaseUsed` mirrors `turnFlags.purchased`, including for out-of-turn
  viewers. The client uses this instead of diffing `market` across views.
- `discard.required` is `floor(totalResources / 2)` when the viewer is in the
  queue. Exactly that many resources must be returned.
- `canRespondToTrade` is true when the offer's recipient list contains the
  viewer and the viewer is not the offerer.

`viewFor`:
- Copies the public state and replaces each other player's `hand` with `null`.
  Keeps counts for hand, deck, discard, and played.
- The viewer's own hand is included. Deck order and discard contents never are.
- `played` is public for everyone.
- `connected` defaults to true; the room layer passes its live map.
- `legal` is for the viewer, not the current player. `isTurn` tells the UI
  whether to show action controls.
- `log` is the last 120 entries. State keeps all of them.
- The view must be JSON-serializable and contain no `undefined` in arrays.
- `firstSeat` is public so the UI can label the setup order and the first turn.

`scorePlayer` and `longestRoadLength` are public helpers for bots, tests, and
the UI. They must agree with `legalMoves` and `refreshDerived`.

## Rules the engine must not get wrong

- **Setup snake.** Start at `firstSeat`, run clockwise. 4p: S, S+1, S+2, S+3,
  S+3, S+2, S+1, S. 3p: S, S+1, S+2, S+2, S+1, S. 2p: S, S+1, S+1, S.
  Settlement then road, repeatedly. A setup road must touch the settlement just
  placed. The distance rule applies to settlements, not roads. The first play
  turn belongs to `firstSeat`, and turns continue clockwise from there.
- **Production.** Roll 2d6. Each hex with the total gives 1 per settlement, 2
  per city to its owner. Robber blocks. Desert has no token. No bank limits.
  Log gains by player. A roll with zero production still advances to action.
- **Seven.** Compute discards first: every player with more than 9 resources
  owes `floor(total/2)`, chosen by that player. If anyone owes, `phase =
  'discard'` and `discardQueue` holds them. When empty, `phase = 'robber'`.
  The roller must move the robber to a different hex and may choose one
  eligible victim (a player with a building on the new hex). Steal one random
  resource from the victim. If no eligible victim, skip. The roller chooses the
  victim; the engine chooses the resource with the RNG.
- **Trade offer.** Only the active player opens one. Recipients are derived
  from `to`; `'all'` means every other player. One offer at a time. Accepting
  revalidates both sides, executes, logs, and closes. The first accept wins.
  Expire the offer at end of turn. A decline closes the offer.
- **Bank/port trade.** Give `count` identical resources for one of another
  type. Rate is the best port the player owns: specific 2:1, generic 3:1, else
  4:1. `count` must equal that rate. Unlimited per turn. No trading a resource
  for itself.
- **Builds.** Road must connect to the player's network at one end and not
  already exist. Settlement must be connected by the player's own road (except
  setup) and respect the two-edge distance rule. City upgrades an owned
  settlement. Pay exact costs.
- **Deck.** Draw to 5 at turn start. Reshuffle discard when the deck is empty.
  Played cards are in `played`, not `discard`, during the turn, so a draw can
  run dry. At end of turn move `hand` and `played` into `discard`, then pass.
  Purchases go to `discard` and cannot be played that turn.
- **Cards.** Play cost is zero. Resolve effects left to right. `gain` adds,
  `draw` draws, `renown` adds, `chooseResources` uses the card's
  `choice.resources`, `freeRoad` uses `choice.edge` or falls back, `freeSettlement`
  uses `choice.vertex` or falls back, `optionalRobber` optionally moves and
  steals. Charter cards have no play effect. A card that needs a choice and has
  a legal target but no choice is `CHOICE_REQUIRED`; if no target exists, use
  the fallback. Provisioner with no choice defaults to 2 wood.
- **Awards.** Longest road: longest simple path of owned edges, blocked by
  opponent buildings; minimum 5. Largest expedition: most renown, minimum 3.
  Ties favor the current holder. With no holder, a tie at the top means nobody
  holds it. Each award is +2 VP. Recompute after every mutation.
- **Victory.** Target 18/16/14 for 2/3/4 players. First to reach wins, including
  mid-card and mid-purchase. Set `phase = 'gameOver'`, `winner`, and log it.

## Room layer

`src/server/rooms.ts` or `room-manager.ts` owns:
- Room codes: 4 uppercase letters, no ambiguous characters (no I/O/0/1 maybe).
- `Map<code, Room>` and cleanup.
- Seat, token, socket, name, isBot, connected, ready.
- Lobby snapshot and broadcast.
- Action routing: look up the sender's seat and room, call `applyAction`, then
  broadcast the new view to every human (each with its own `viewFor`).
- Bot scheduling: after every state change, if the current seat is a bot (or a
  disconnected human past the takeover timeout), schedule one bot action after
  400-900ms. Clear timers on room close and after each action. Never overlap
  bot turns. Bots also answer trade offers.
- Rematch and room teardown.
- Resume: a `resume` with the seat token attaches a new connection to the
  existing seat. Peer clients do not use it: a closed data channel has no
  address to reconnect to. On close, mark disconnected and let the bot take
  over after 45s.
- Rate limit: max ~20 messages/sec/connection and 64KB payload. The peer host
  applies the counter per data channel.
- Never send another player's hand or token.

`src/client/net/peer/host.ts` routes parsed messages from each data channel into
the room manager. The same router serves the host's own loopback seat.

## Client

- Title flow: name, play vs bots, and peer host/join when a relay URL exists.
- One store hook that handles `welcome`, `lobby`, `game`, `error`, `chat`, and
  `roomClosed`. Peer connections attach a transport; there is no origin socket
  and no automatic reconnect.
- Render from `GameView` only. Never compute legality yourself beyond what
  `legal` exposes. Use `legal.build` and `legal.playable` for highlighting.
- Board is inline SVG. Use the board coordinates from the view. Support build
  targeting for setup, paid roads/settlements/cities, and free card placements.
- Required flows: setup, roll, discard modal, robber move with victim choice,
  hand play, Provisioner choice, Guild Mason road choice, Shipwright's Yard
  settlement choice, Wrecker's Lamp hex + victim choice, market purchase,
  bank/port trade, player trade offer and response, end turn, game over.
- Card text comes from `CARD_DEFS`. Do not duplicate card rules in UI strings.
- Responsive desktop/tablet. No external fonts or assets.

## Protocol sequence

Solo:

```
client -> quickPlay { name, seats: 4, difficulty: 'normal' }
room   -> game { roomCode, you: 0, token, view }   // bots already seated
```

Online host:

```
client -> createRoom { name, maxPlayers: 4, difficulty: 'normal' }
room   -> lobby { room, you: 0, token }
other  -> joinRoom { code, name }
room   -> lobby ...                                 // broadcast to both
host   -> addBot / startGame
room   -> game ...                                  // unicast per human
```

Every mutation is one `action` message. The room replies to all humans with a
fresh `game` view. Errors are unicast `{ type: 'error', code, message, seq }`.

## Testing bar

- Engine: board counts (19 hexes, 54 vertices, 72 edges, 9 ports, 30 coastal
  edges), port distribution, distance rule, setup snake and random first seat,
  production, 7 flow, discards, robber, bank/port rates, every build, every
  card effect and fallback, awards and ties, victory mid-card, determinism.
- Room layer: create/join/fill bots/start, resume, action routing, bot turn
  does not stall, view filtering hides hands.
- Bots: full simulated games for 2/3/4 players, no illegal actions, no stalls,
  median length in range, winner VP split report.
- Client: `npm run build` and a browser smoke test of a full game against bots.
