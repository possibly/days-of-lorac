# Days of Lorac: game design

Version 1 design spec. Owns the rules, the numbers, and the rulings. Card data
lives in `docs/CARDS.md`. If the two disagree, `CARDS.md` wins on card text and
this file wins on rules.

Everything here is meant to be implemented without asking a question. Where a
number is a guess that needs simulation, it says so and gives the tuning lever.

---

## 1. Changes from the brief's skeleton

The brief invited changes if something was clearly more fun, and asked me to
flag locked rules I moved. Here is the full list of deviations.

| Brief says | This design | Why |
| --- | --- | --- |
| Ten victory points wins | 14 (4p), 16 (3p), 18 (2p) | At 10 the game ends around player turn 8, about 18 minutes. Fourteen puts the 4p median at round 11 in 500 simulated games. The arithmetic is in section 12. |
| Discard down to 7 on a 7 | Discard down to 9 | Charter purchases need you to hold 5 to 9 resources. A limit of 7 makes Fleet Charter (9 resources) impossible to assemble. |
| Second settlement gives starting resources | No starting resources | The 10-card starting deck already hands you 5 resources on turn 1. Adding 3 more makes a road plus settlement on turn 1 routine. |
| Anyone may trade on anyone's turn | Only the active player opens trade offers | Every other player would need to answer out of turn, which stalls the round. Others still accept or decline. |
| No permanent tableau | Kept. Renown and charters are counters, not cards in front of you | Renown is a public number. Charter VP is permanent and tracked per player. |
| Market of 8 to 10 piles | 10 strategy piles plus 2 always-stocked charter stacks | Charters are the VP clock, like Provinces. Holding them out of the pile budget means the market never spends a strategy slot on plain VP, and a player with no board options always has a VP sink. |
| Card costs in resources | Card costs are one resource type for piles, fixed multisets for charters | Single-type costs make the market readable at a glance and tie deck buying to which numbers you landed on. |
| Piece limits implied | No piece limits | The board's 54 vertices limit you. Piece counters are bookkeeping nobody wants. |

Nothing else in the skeleton changed. Terrain mix, token set, hex geometry,
port counts, Catan build costs, draw-to-5, one purchase per turn, and "ten
victory points wins immediately" (now fourteen in 4p) all survive.

The one rule that moved back toward the brief: unplayed cards stay in hand
instead of being discarded. Charters are the exception, because a card that
cannot be played would clog the hand forever. Section 9.2 has the exact rule.

---

## 2. Pitch

Lorac is a wet rock in a cold sea, and its wealth is other people's cargo. You
are a guild factor with two holdings on the tide line, a crew of ten, and a
market full of schemes. Each turn the island pays you what your buildings are
worth, your crew turns up with whatever they could carry, and then you decide
whether to spend it on ground, on a ship, or on the kind of paperwork that lets
a guild claim a harbour. The board gives you raw goods. The deck decides what
those goods become.

## 3. Emotional arc

Minutes 0 to 5: everyone is poor and the map is the whole game. You are picking
a second settlement and counting pips, and you are slightly nervous that you
picked wrong. Turns are short and mostly obvious, which is correct. Nobody
should feel lost on turn 1.

Minutes 5 to 20: the engines separate. One player has a rope walk and is
drawing through their deck twice as fast as anyone. Another has three roads and
is eating the map. Someone buys a Fleet Charter and the table notices. Your
played cards visibly change what your turn can afford, and you start planning
two turns ahead. The robber lands on the hex you needed and you swear at the
screen. This is the longest stretch and it needs to keep moving.

Minutes 20 to 32: the race. Charters are running out, the good vertices are
gone, and the award swing matters. There is a moment where two players are one
turn from winning and the third player can still move the robber or buy the
last Fleet Charter. The last two turns should feel tight, not inevitable. If
the leader is unbeatable at minute 22, the design failed.

---

## 4. Components

### 4.1 Board

The host picks the island before the start. Three sizes, three land
placements, three number placements.

| Size | Hexes | Shape | Seats | Victory target |
| --- | --- | --- | --- | --- |
| Compact | 7 | radius-1 hexagon | 2 | 14 (2 players) |
| Standard | 19 | radius-2 hexagon, 3-4-5-4-3 | 2-4 | 18 / 16 / 14 |
| Grand | 37 | radius-3 hexagon | 2-4 | 22 / 20 / 18 |

Land and numbers each offer three modes:

- **Fixed.** The designed table below, identical every game. Other sizes use one
  deterministic generated map per size.
- **Balanced.** No two touching hexes share a terrain, no two touching hexes
  share a number, and no 6 touches an 8.
- **Wild.** One plain shuffle.

The island is still rotated by 60 degree steps and independently mirrored, so
even a fixed map has twelve orientations. Hex ids come from the row and column
(see below), so the desert on a standard island is always `C3`.

The rest of this section describes the standard island.

19 hexes arranged 3-4-5-4-3. 54 vertices, 72 edges, 30 coastal edges.

Terrain: 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert.

Number tokens: 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12.
No token on the desert.

One fixed layout, generated once, then randomly rotated by 60 degree steps
(6 orientations) and independently mirrored (2 states). 12 variants. No
6 next to an 8 in the template, and rotation and mirror preserve that.

Hex ids are `A1..A3`, `B1..B4`, `C1..C5`, `D1..D4`, `E1..E3`. Adjacency is
the standard offset layout: row A sits between the hexes of row B, row C hangs
one step left of row B, and so on. The engine derives the graph; the table
below is the source of truth for terrain, tokens, and nothing else.

| id | terrain | token | pips |
| --- | --- | --- | --- |
| A1 | wood | 5 | 4 |
| A2 | wheat | 11 | 2 |
| A3 | sheep | 6 | 5 |
| B1 | brick | 6 | 5 |
| B2 | ore | 4 | 3 |
| B3 | wood | 9 | 4 |
| B4 | sheep | 10 | 3 |
| C1 | wheat | 11 | 2 |
| C2 | ore | 3 | 2 |
| C3 | desert | none | 0 |
| C4 | brick | 4 | 3 |
| C5 | wood | 3 | 2 |
| D1 | sheep | 2 | 1 |
| D2 | wheat | 12 | 1 |
| D3 | ore | 8 | 5 |
| D4 | wood | 5 | 4 |
| E1 | brick | 9 | 4 |
| E2 | wheat | 8 | 5 |
| E3 | sheep | 10 | 3 |

Totals by pips: wood 14, sheep 12, wheat 10, brick 12, ore 10. Sum 58.

The two contested hotspots are D3 (ore on an 8) and E2 (wheat on an 8). Both
sit in the same corner of the island, which makes the south-east a knife
fight and keeps ore and wheat, the two city resources, genuinely scarce. The
deck covers ore at roughly 1 per turn, so no one is ever locked out of a city.
That is deliberate: the deck is the variance insurance, the board is the prize.

### 4.2 Ports

Exactly 9 ports on the 30 coastal edges, spaced 3 or 4 edges apart around the
ring. Fixed order from the top-left coastal edge, rotating with the board:
`ore 2:1, generic 3:1, wheat 2:1, generic 3:1, brick 2:1, generic 3:1,
sheep 2:1, generic 3:1, wood 2:1`.

A port serves a player who has a settlement or city on one of its two coastal
vertices.

### 4.3 Resource tokens

Five resources: wood, brick, sheep, wheat, ore. Physical tokens, no bank
limits. The bank never runs out.

### 4.4 Market

10 piles with printed copy counts, plus 2 charter stacks that are always
available. 70 cards total. Full text, effect specs, and bot heuristics are in
`docs/CARDS.md`. This is the summary the UI and engine both need.

| Pile | Cost | Copies | One-line effect |
| --- | --- | --- | --- |
| Salvage Yard | 3 wood | 7 | Gain 2 brick, 1 ore |
| Rope Walk | 3 wood | 6 | Gain 1 wood, draw 2 |
| Foundry Quay | 3 brick | 6 | Gain 2 ore, 1 wheat |
| Guild Mason | 3 brick | 6 | Free road (fallback: 1 wood 1 brick), draw 1 |
| Wool Factor | 3 sheep | 6 | Gain 2 sheep, draw 1 |
| Wrecker's Lamp | 3 sheep | 5 | 1 renown, optional robber move and steal |
| Provisioner | 2 wheat | 6 | Gain 2 resources of your choice |
| Survey Voyage | 3 wheat | 6 | Gain 2 renown, draw 1 |
| Bellows Yard | 3 ore | 6 | Gain 2 ore, 2 wheat |
| Shipwright's Yard | 4 ore | 4 | 1 renown, free settlement (fallback: 2 ore 2 wheat) |
| Quay Deed | 1 of each | 9 | 1 VP, dead draw forever |
| Fleet Charter | 3 ore 3 wheat 3 brick | 4 | 2 VP, dead draw forever |

Pile subtotal 58. Charter subtotal 13. Grand total 71.

When a pile is empty it stays empty for the rest of the game. Charters are
stacks, not piles: they never restock and there are only 9 and 4 of them.

### 4.5 Personal decks

Each player has a deck, a hand, a discard pile, and a play area. Starting deck
is 10 cards. See section 9.

### 4.6 Public and hidden information

Public: board state, all buildings and roads, every player's resource counts,
renown, number of charters owned, market pile contents, deck and discard sizes,
who holds which award.

Hidden: the order and contents of your deck, your hand.

Charter counts are public on purpose. The endgame race is not readable
otherwise.

---

## 5. Setup

1. Shuffle the terrain/token template into one of its 12 orientations. Ports
   rotate with it.
2. Place the robber on C3, the desert.
3. Stock the market and both charter stacks to their printed counts.
4. Draw the first seat from the seeded RNG. Seats are numbered 0 to n-1, and
   play runs clockwise from the first seat.
5. Snake draft for starting settlements, each placement taking one settlement
   and one road that must touch that settlement. The snake starts at the drawn
   first seat S and runs clockwise:
   - 4 players: S, S+1, S+2, S+3, S+3, S+2, S+1, S
   - 3 players: S, S+1, S+2, S+2, S+1, S
   - 2 players: S, S+1, S+1, S
6. No starting resources.
7. Each player shuffles their 10-card starting deck and draws 5. The game
   begins with the first seat's first turn, and turns pass clockwise from there.

The snake gives the last picker two adjacent picks, which is the standard
compensation for picking last. The first seat also plays first, so it gets the
first pick and the first turn. Drawing that seat from the game seed spreads
both advantages across seats from game to game; a fixed seat 0 wins visibly
more often across a batch of games.

---

## 6. Turn structure

Four phases, always in this order. No phase is skippable except the action
phase (you may always just end the turn).

### Phase 1: Upkeep

Draw until your hand has 5 cards. If your deck is empty partway through,
shuffle your discard pile into a new deck and continue. If both deck and
discard are empty, you draw nothing and stop. There is no penalty and no
loop.

Upkeep is draw-to-five, not draw-five. Cards you kept last turn are already
in hand, so you draw only the difference. Keeping all five is legal and means
a turn with no fresh cards, which is almost always wrong.

### Phase 2: Production

Roll 2d6.

If the roll is not 7: every hex carrying that number gives resources to the
buildings around it. A settlement takes 1, a city takes 2. The robber's hex
gives nothing. Ports give nothing.

If the roll is 7, in this order:

1. Every player holding more than 9 resources discards half, rounded down.
   Holding 10 or 11 means discarding 5. Holding 12 discards 6.
2. The roller must move the robber to any other hex. It may not stay put.
3. The roller steals 1 random resource from one player of their choice who has
   a building on the robber's new hex. If nobody has a building there, no
   steal happens. The roller chooses the victim; the stolen resource is chosen
   at random from that player's pool.

The 7 is checked before your deck pays out. Hoarding for a Fleet Charter is
therefore a real gamble.

### Phase 3: Action

Free-form. In any order, any number of times, until you end the turn:

- Play a card from your hand. It resolves immediately and completely.
- Trade with the bank, a port, or another player.
- Build a road, settlement, or city.
- Buy 1 card from the market or a charter stack. One purchase per turn, total,
  across all piles.

The one-purchase limit is the game's main pacing brake. Do not add cards that
grant extra purchases.

### Phase 4: End

Played cards and any charters left in hand go to your discard pile. Everything
else in hand stays there. Then the turn passes clockwise. You keep your
resources.

---

## 7. Costs, building, and limits

| Build | Cost | VP |
| --- | --- | --- |
| Road | 1 wood, 1 brick | 0 |
| Settlement | 1 wood, 1 brick, 1 sheep, 1 wheat | 1 |
| City (upgrade one of your settlements) | 2 wheat, 3 ore | 2 (replaces the settlement's 1) |

Placement rules, all standard:

- A road must touch one of your roads, settlements, or cities at one end, and
  may not cross another road.
- A settlement must sit on an empty vertex connected by your own road to your
  network, except during setup.
- A settlement may not be placed on a vertex adjacent to any existing building,
  yours or anyone else's. Minimum two edges apart from every building.
- A city replaces one of your own settlements, keeping all its roads and port
  access.
- A vertex may hold at most one building.
- No piece limits. The board runs out before your pieces do.

Resource limit is 9, checked only at the 7 step. Resources are otherwise
unlimited and are never lost except to the robber or a card cost.

---

## 8. Trading

### 8.1 Bank and ports

Give N identical resources, receive 1 of any resource:

| Rate | Who |
| --- | --- |
| 4:1 | anyone |
| 3:1 | anyone with a settlement or city on a generic port |
| 2:1 | anyone with a settlement or city on a port showing that resource |

Best available rate applies. A player with a wood 2:1 port and a generic port
trades 2 wood for 1 anything, and 3 of anything else for 1 anything. Trades
with the bank and ports are unlimited per turn.

### 8.2 Player trades

Only the active player may open an offer, during their action phase.

An offer is a give-set and a want-set, each a multiset of resources. The
active player chooses "offer to everyone" or a single opponent. Recipients may
accept or decline. There is no counter-offer in v1. The first accept that
reaches the server executes the trade and closes the offer. The offerer may
cancel at any time.

An open offer expires automatically when the active player's turn ends. Only
one offer may be open at a time.

Both sides must be able to pay at the moment of acceptance. The engine
revalidates on accept and rejects a stale accept with `TRADE_STALE`.

Trades cannot include cards, VP, promises, or future considerations. Resources
only.

---

## 9. The deck

### 9.1 Starting deck

10 cards, 2 of each resource, all identical in shape and free of choices:

| id | Name | Count | Text |
| --- | --- | --- | --- |
| `start-wood` | Driftwood Crew | 2 | Gain 1 Wood. |
| `start-brick` | Ballast Crew | 2 | Gain 1 Brick. |
| `start-sheep` | Fleece Runner | 2 | Gain 1 Sheep. |
| `start-wheat` | Victualler | 2 | Gain 1 Wheat. |
| `start-ore` | Bellows Hand | 2 | Gain 1 Ore. |

Exactly 2 of each is deliberate. It makes turn 1 decision-free for a new
player, it caps early income at a predictable 5 per turn, and it means the
first purchase is the first interesting deck decision. No choices in the
starting deck, ever.

### 9.2 Hand size, cycling, reshuffle

- Hand size 5. Draw up to 5 at upkeep.
- Unplayed cards stay in your hand. Next upkeep you draw only up to five, so
  every kept card costs you one draw, and the card does not reach the discard
  until you play it. Keeping is a real choice: the card dodges the next seven
  and the resource limit, and buys you a resource for a later build.
- Charters in hand are discarded at end of turn. A card that cannot be played
  would otherwise sit in hand for the rest of the game, shrinking every draw.
- Played cards sit in a play area until end of turn, then go to your discard
  with the rest.
- When you must draw and the deck is empty, shuffle the discard pile to form a
  new deck, then continue drawing.
- Played cards are not in the discard during the turn. A draw effect can
  therefore run out of cards even mid-combo. That is intentional and it
  guarantees no infinite draw loops.
- Shuffles use the game's seeded RNG in a fixed order, so replays are exact.

A 10-card deck drawn at 5 per turn cycles every 2 turns. This makes the
opening extremely consistent. That is fine. The consistency is what makes the
first purchases feel like a real change.

### 9.3 Playing cards

- Cards are played only in your action phase.
- A card resolves completely, in the order its text is written, before the next
  card, trade, or purchase.
- There are no interrupts, no reactions, no fast effects, and no cards that
  modify a die roll. If a card says "you may", the player chooses at
  resolution.
- Playing a card is free. Cards never cost resources to play. Their cost is
  paid once, at purchase.
- A card that cannot do its thing falls back to its printed fallback clause and
  then is done. No card can fail to resolve.
- Played cards go to your discard at end of turn. They never return to your
  hand.

### 9.4 Drawing

A draw takes the top card of your deck into your hand. Drawn cards can be
played the same turn if they are not charters. Charters do nothing when drawn
and are simply discarded at end of turn.

### 9.5 Buying

- One purchase per turn, during your action phase, at any point.
- Pay the printed cost, take the card, put it directly into your discard pile.
- It cannot be played this turn.
- A purchase is not a card play. It does not interact with cards that care
  about what you played.
- Buying is legal only if the pile has stock and you can afford the printed cost.
- After purchase, VP is checked immediately (charters).

### 9.6 VP cards (charters)

Quay Deed and Fleet Charter are permanently owned. Their VP is live from the
instant of purchase. They stay in your deck forever and do nothing when drawn,
so they are real dead draws. You cannot remove them and they do not count as
cards in play.

Buying charters barely changes your resource income, but it dilutes it. This
is the deck-builder's central squeeze and the reason a charter-only strategy
starves itself at roughly 4 or 5 deeds.

---

## 10. Awards

Two awards, each worth 2 VP, each with at most one holder.

**Longest trade route.** The longest continuous chain of your own roads. The
holder needs at least 5 roads. A chain is broken by an opponent's settlement or
city sitting on a vertex along it. Your own buildings never break your chain,
and a chain may pass through your own settlements and cities.

**Largest expedition.** The most renown. The holder needs at least 3 renown.
Renown comes from cards, is gained permanently, and is never spent or lost.

Resolution rules for both:

- Recompute after every state change: road built, settlement placed, card
  resolved, renown gained.
- A challenger needs strictly more than the current holder. Ties favor the
  holder, who keeps the award.
- If no one holds the award and two players tie for the top qualifying value,
  nobody holds it.
- The award is lost the moment another player strictly exceeds the holder.
  It is never voluntarily given up.

Renown above 3 still counts for Largest Expedition and still matters as
insurance, but has no other effect. That mirrors Catan's largest army and needs
no extra rules.

---

## 11. Victory

Target depends on player count:

| Players | Target |
| --- | --- |
| 4 | 14 |
| 3 | 16 |
| 2 | 18 |

VP = 1 per settlement, 2 per city, +1 or +2 per charter owned, +2 for each award.

Check after every state change that could change VP. The game ends the instant
any player's total reaches the target. There is no final round and no
simultaneous check; the first player to cross wins, including mid-turn.

Reaching the target during your own action phase is the normal case. The only
other route is a stolen award, which cannot happen outside a road build, a
settlement placement, or a card resolution, all of which are on someone's turn.

Show the target in the header at all times, and show every player's VP without
revealing hidden information.

---

## 12. Economy sanity check

This section is the important one. If simulation contradicts it, the numbers
below are what to move.

### 12.1 Assumptions

- Pip value of a token = its share of 36 outcomes. A settlement on three hexes
  with pips p1+p2+p3 produces (p1+p2+p3)/36 resources per turn.
- Snake draft in a 4-player game gives each player about 20 to 22 pips from two
  settlements, so board income starts near 0.6 per turn. Measured against the
  template in section 4.1: the eight highest legal intersections after the
  distance rule total roughly 80 to 88 pips, so 20 to 22 per player.
- Each added settlement or city upgrade adds about 0.3 per turn.
- The deck produces exactly 5.0 per turn at the start, because you draw 5 of 10
  cards with 2 of each resource. This assumes you play all five. A player who
  keeps k cards draws 5-k next turn, so income scales with cards played, not
  cards held.
- Bought cards add roughly 0.3 to 0.9 per turn each early and less later, since
  drawing 5 of a bigger deck dilutes each card. Formula in `CARDS.md`.

### 12.2 Expected income per turn

| Turns | Deck | Board | Total | Notes |
| --- | --- | --- | --- | --- |
| 1 to 3 | 5.0 | 0.6 to 0.9 | 5.6 to 5.9 | No starting resources. First settlement lands turn 2 or 3. |
| 5 to 8 | 5.2 | 1.2 to 1.5 | 6.4 to 6.7 | Two or three new buildings up. One or two engine cards bought, roughly break-even on raw count. |
| 10+ | 5.6 | 1.8 to 2.4 | 7.4 to 8.0 | Six or seven vertices, two upgraded. Two dead charters shave about 0.4 off the deck number. |

Cumulative resources across 12 turns: about 5.75 + 6.2 + 6.6 + 7.0 averaged
over the span, call it 6.6 per turn, so about 79 resources for a 12-turn
player. A 14-VP 4p winner spends about 85 to 95 resources including purchases,
which is into the 13th turn if it had to come from raw income alone; the board
and the charter endgame shorten that.

Board income is roughly 12% of income on turn 1 and about 28% by turn 12. The
deck carries the early game and the board compounds into the late game. This is
the main reason the two strategies converge instead of one trivially winning.

### 12.3 Why the game cannot end on turn 6

The best possible VP rate is a city upgrade: 5 resources for +1 VP. A player
starts with 2 VP from setup. To reach 14 VP in 4p they need 12 more, which at
the best possible rate costs 60 resources. Maximum early income is about 7 per
turn, and that assumes a perfect board and perfect rolls. 60/7 is 8.6 turns.

The hard floor is player turn 9. Turn 6 is arithmetically impossible. Real
games land at turn 10 to 13 because nobody has a perfect board and because
roads, not settlements, are the actual bottleneck: the distance rule means each
new settlement needs two fresh roads, so a marginal settlement costs 8, not 4.

### 12.4 Expected game length

| Players | Target | Turns per player | Rounds | Wall clock at 32s/turn plus 2 min draft |
| --- | --- | --- | --- | --- |
| 4 | 14 | 11 to 13 | 11 to 13 | 25 to 31 min |
| 3 | 16 | 11 to 13 | 11 to 13 | 19 to 25 min |
| 2 | 18 | 12 to 14 | 12 to 14 | 15 to 21 min |

The wall clock column already includes the draft and one minute of end-of-game
scoring. 4 players is the flagship and the one to tune against. 2 and 3 players
run shorter because fewer seats means less wall clock per round; that is
unavoidable without a different ruleset, and they are documented as quicker
modes rather than the headline.

Simulated medians over 500 4p games, 300 3p games and 300 2p games at Factor
difficulty: 11 rounds in 4p, 11 in 3p, 12 in 2p. If simulation shows 4p games
ending before round 10, the lever order is:

1. Raise the 4p target to 15. Each point is worth about 0.9 of a turn.
2. Cut one copy from the two cheapest piles.
3. Reduce the starting deck to 8 cards, 2 each of wood, brick, sheep, wheat,
   and remove the two ore cards. That is a 20% income cut and a much bigger
   change; try it last.

---

## 13. Scoring math

### 13.1 Where VP comes from

| Source | Total available | Typical take for the winner |
| --- | --- | --- |
| Setup settlements | 2 per player | 2 |
| New settlements | 1 each, board-limited | 1 to 2 |
| City upgrades | +1 each, board-limited | 5 to 6 |
| Longest trade route | +2, one holder | 2 |
| Largest expedition | +2, one holder | 0 or 2 |
| Quay Deed | 1 VP, 9 copies | 1 to 3 |
| Fleet Charter | 2 VP, 4 copies | 0 or 2 |
| Total | | 14 to 15 |

The winner typically has 4 or 5 occupied vertices, nearly all upgraded to
cities, one award, and 3 to 4 charter VP. That is a real board presence and a
real deck investment. Neither layer alone gets you there.

### 13.2 Why 14 and not 10

A 14-VP target needs about 85 to 95 resources of income and spending, which at
the income curve above is 11 to 13 turns. A 10-VP target needs about 62 and
lands at turn 8 to 10, which is 18 to 22 minutes in 4p. The brief wants 25 to
35. Fourteen is the number that makes the 4p clock right.

Fourteen also matters for a structural reason: at 10, a player who spends the
first five turns buying cards is simply behind and the deck layer is a trap. At
14, the engine has time to pay back and the board rush runs out of good
vertices first. The deck becomes correct play instead of a hobby.

### 13.3 The two clocks

This is the design's spine, so it is stated plainly.

The board is front-loaded. It pays off fast, it costs 8 resources per marginal
VP once roads are counted, and it hits a wall when the good intersections are
taken. In a 4-player game that wall arrives around the time the 15th building
lands, roughly turn 9; by then most settlements have been upgraded to cities
and no legal settlement vertex is left.

The deck is back-loaded. It costs tempo for five or six turns, then it pays
about 1.5 to 3 extra resources per turn and, more importantly, its income does
not depend on the board at all. A deck player at turn 12 is buying a Fleet
Charter roughly every second turn.

Board rush finishes around turn 9 or 10 in a clean game. Deck build finishes
around turn 12. But the board rush cannot be clean in a 4-player game, because
three other players are taking the same intersections and moving the robber.
The two curves cross somewhere around turn 10, and which one is ahead there
depends on the table. That crossing point is the game.

If playtesting shows the board rush winning consistently, the fix is not to
nerf settlements. It is to raise the target by one, which moves the crossing
point later and favors the deck.

### 13.4 Comeback paths

A player behind has four things to do, which is enough:

- Charters do not need board space. A blocked player can convert raw resources
  straight into VP.
- A port converts a lopsided board into usable resources.
- Both awards are contestable by anyone, and Largest Expedition only costs two
  purchases.
- The robber is a free way to slow the leader, and the last Fleet Charter is a
  2 VP swing that anyone can take.

There is no catch-up mechanic that hands out free VP. Comebacks are earned.

---

## 14. Player counts

**4 players.** The designed game. Eight setup settlements means the map is
contested from turn 1, the robber has real targets, and the market depletes
visibly. Target 14.

**3 players.** Same rules, target 16. Six setup settlements. Each player gets
better numbers than in 4p, so each player's income is about 0.3 higher, which
is why the target rises. Ports are less contested and long roads are easier, so
expect the route award to matter more here.

**2 players.** Same rules, target 18. Four setup settlements, so both players
get excellent land and lots of empty space. Expect a fast, high-income,
low-interaction game where the robber is close to a targeted attack and player
trades are cheap. It runs 15 to 21 minutes. Workable, not the headline.

No count-specific card or rule exceptions. The only thing that changes is the
target. Keeping it that way is worth real money in testing time.

---

## 15. Bots

### 15.1 What a competent bot values

1. VP per purchase, first. Convert everything to "expected VP by turn 12".
2. Resource spread. A settlement costs four different resources, so a bot
   sitting on 6 wood is not rich, it is stuck.
3. Pip density at a vertex, weighted by which resource it is. Ore and brick
   hexes are worth about 1.15x their pips because those terrains are scarce
   (3 hexes each) and cities need ore.
4. Deck throughput, measured as cards played per turn. Draw effects are worth
   more than their resource yield.
5. Blocking. The leader's lowest-cost path to their next VP is the target of
   the robber and of road placements.
6. Dead-draw cost. Every charter bought reduces future income by about 0.2 per
   turn. A bot must not buy its fourth charter while still trying to build.

### 15.2 Difficulty levels

**Deckhand (easy).** No lookahead. Priority list, first legal action wins.
Buys the cheapest affordable card. Places roads toward the nearest empty
vertex, not the best one. Robber goes on the leader's most productive hex.
Never trades with players. Still finishes every game and still scores 8 to 11
VP, so a beginner can beat it. Target: a new player beats it about 70% of the
time.

**Factor (normal).** Full greedy evaluation with correct ordering. Scores each
candidate action by VP-per-resource, evaluates all 10 piles with the value
function from `CARDS.md`, uses ports, upgrades cities before sprawling when
both are legal, holds the robber for the leader's ore hex, responds to trade
offers with a real threshold, and buys charters in the last four turns.
Target: an experienced player beats it about 45% of the time.

**Guildmaster (hard).** One-ply lookahead over the next three turns: simulate
"if I buy this now, what can I afford on turns t+1 and t+2". Plans two city
upgrades before the second sprawl. Denies a market pile the leader needs when
the denial costs less than 0.4 VP. Times the charter purchase so the VP lands
on the turn that wins. Uses trade offers to fix a single-resource shortage
rather than taking a bad 4:1. Target: an experienced player beats it about 40%
of the time.

Bots must reach every difficulty through one policy interface with a different
valuation function. Do not fork the bot logic three ways.

### 15.3 Bot behaviour by phase

**Setup.** Score each legal settlement vertex as pips, plus 0.6 per resource
type it covers that the bot's other settlement misses, plus 1.5 if it touches a
port whose resource the vertex already produces, minus 1.0 if it is adjacent to
an opponent's likely expansion. Pick the best of the top three with a small
noise term seeded from the game RNG, so two games with the same seed match and
two different seeds do not.

**Trading.** Bots value a trade at the resource it unblocks. Accept a player
offer if the give-set is at or below 60% of the want-set's marginal value to
the bot. Never offer more than a 1:1 rate to a human unless it is the last
turn. Always use a port before a 4:1 bank trade.

**Card purchases.** One purchase per turn is a cap, not a quota. Skip the
purchase when no card clears the threshold. The threshold is "expected extra
resources before the game ends exceeds the cost", computed with the formula in
`CARDS.md`.

**Robber.** Never random. Priority: the leader's highest-pip non-blocked hex,
then the hex that most hurts the second-place player, then deny ore. No hex
that costs the bot at least as much production as it denies: candidates are
tiered by `selfHarmTier` before any weighting, so the rule holds at every
difficulty rather than relying on a self-penalty weight. When every legal hex
hurts the bot, it takes the smallest own loss. Skip the steal target only if
there is no one adjacent. Wrecker's Lamp rates the move optional: if the only
gain would come off the bot's own hex, play the card for renown and leave the
robber where it is.

**Endgame.** When the bot is at target minus 2 or less, recalculate every turn
and prefer the action that wins this turn or next. When a specific opponent is
one turn from winning, take any action that denies them: buy the last Fleet
Charter even if inefficiently, move the robber onto their number, or take the
award they need.

**Never stall.** The engine must expose `legalActions()` and the bot must
always find a non-empty set, at minimum `endTurn`. A bot that cannot act ends
the turn.

---

## 16. Edge cases and rulings

Numbered so tests can reference them.

**Awards**

1. Tied longest route, current holder exists: holder keeps the award.
2. Tied longest route, no holder, two players equal at the top with 5 or more:
   nobody holds it.
3. Road cutoff: an opponent places a settlement on a vertex in the middle of
   your chain. Recompute immediately in the same action. Both halves are
   counted separately and the longer one is your route. If this drops you below
   5, you lose the award in the same state change, and the new holder is
   determined in the same pass.
4. Your own settlement on your own route never breaks it.
5. A route that touches the coast and stops is fine. No requirement to make a
   loop.
6. Renown is never lost, so Largest Expedition can only change hands upward. If
   the holder reaches 3 and a challenger reaches 3, holder keeps. A challenger
   at 4 takes it.

**Robber**

7. The robber may be placed on the desert. It blocks nothing there, and there
   are no buildings adjacent, so no steal.
8. A 7 must move the robber. Moving it to its current hex is illegal
   (`ROBBER_SAME_HEX`).
9. If no player has a building adjacent to the robber's destination, the steal
   is skipped silently. The move still happens.
10. The victim is chosen by the roller, the resource is chosen at random.
11. A player with 0 resources can be chosen as a victim and nothing happens.
12. Discard on a 7 is floor(count/2). Exactly 9 or fewer means no discard.
13. Discards happen before the robber moves, so a player cannot spend their way
    out of a discard.

**Ports and trading**

14. Port access requires a settlement or city on one of the port's two
    vertices. A ship or road is irrelevant; there are no ships.
15. Best rate only. A 2:1 port does not also give you 3:1 on everything.
16. Bank trades are unlimited per turn.
17. Only the active player may open a player trade.
18. An offer expires at end of turn. A player who never answers counts as a
    decline.
19. Two recipients accepting at once: the first accept processed wins, the
    second is rejected with `TRADE_STALE`.
20. An accept fails if either side can no longer pay. Nothing is exchanged.
21. Never exchange cards, VP, or future promises. Resources only.

**Cards and deck**

22. Deck empty on draw: shuffle the discard and continue. If both are empty,
    draw nothing.
23. Played cards are not in the discard while the turn runs, so a draw effect
    can run dry mid-combo. That is legal and it is the loop guard.
24. A card whose target does not exist resolves its fallback clause. Every card
    with a board target has one.
25. Guild Mason with no legal road: gain 1 wood and 1 brick, draw 1.
26. Shipwright's Yard with no legal vertex: gain 2 ore and 2 wheat.
27. Wrecker's Lamp: the robber move is optional. If the player declines, the
    renown is still gained. If nobody has a building on the chosen hex, the
    move happens and the steal is skipped.
28. Provisioner: choose 2 resources, repeats allowed. The client sends nothing
    until the player confirms, so cancelling the picker leaves the card in
    hand. A play that arrives with no choice resolves as 2 wood: the engine
    must never hang waiting, but a player is never forced to spend the card.
29. Purchased cards go to discard, not to hand, and are not playable that turn.
30. A second purchase in the same turn is rejected with `PURCHASE_LIMIT`.
31. Buying from an empty pile is rejected with `PILE_EMPTY`.
32. Charters do nothing when played. Playing one is legal and pointless; the UI
    should not offer it.
33. Charters cannot be discarded or removed. They count for VP whether they are
    in the deck, the hand, the discard, or the play area.

**Turn structure**

34. A player may end their turn at any point in the action phase, even with
    cards in hand and legal actions available. Unplayed cards stay in hand.
35. There is no "must play all cards" requirement. Keeping a card is a real
    choice: the card stays out of the pool and safe from the next seven, at the
    cost of one draw next upkeep.
36. Production happens before the action phase. A card cannot change the roll.
37. A player with no legal build, no legal purchase, and no useful card still
    ends their turn. The UI must say why the turn was empty: "No affordable
    build or purchase. Ending turn." Never a silent dead turn.

**Players and connection**

38. A disconnected human is replaced by a Factor-level bot after 45 seconds.
    Control returns at the start of their next turn if they reconnected, or
    immediately if it is currently their turn and the bot has not yet acted.
39. A player who disconnects during their own turn: the bot finishes the turn
    using the same policy and the turn then passes normally.
40. No player may be skipped. If a player is gone entirely, the bot plays them
    out and they can still win.

**Illegal actions**

41. Every rejected action returns a code and a human-readable reason. Nothing
    is silently ignored.
42. The server never trusts the client. The same validation runs in engine
    tests and in the server.
43. Determinism: given a seed plus an ordered action list, the final state must
    be identical. Randomness comes only from the seeded RNG, consumed in a
    fixed order: board orientation (rotation then mirror), first seat, shuffle
    per player in seat order, then robber steals and discard choices.

---

## 17. First game walkthrough

Three turns for player 1, 4-player game, template in its base orientation. This
exists to expose bad numbers.

**Setup.** P1 takes (D3, E2, E3): ore on 8, wheat on 8, sheep on 10. Pips
5 + 5 + 3 = 13. Second pick, P1 takes (A2, B2, B3): wheat on 11, ore on 4, wood
on 9. Pips 2 + 3 + 4 = 9. Total 22 pips, so 0.61 resources per turn from the
board. Both roads point inland. No starting resources.

**Turn 1.**

Upkeep: draw 5 cards. The shuffle gives 2 wood, 2 brick, 1 wheat.

Production: roll 8. D3 and E2 both fire. P1's 13-pip settlement collects 1 ore
and 1 wheat. The 9-pip settlement touches neither.

Pool: 2 wood, 2 brick, 2 wheat, 1 ore. Seven resources, and no sheep.

Action: a settlement needs wood, brick, sheep, and wheat, and P1 has no sheep.
Two roads cost wood + brick twice, which P1 does have. P1 builds two roads
inland from the 13-pip settlement, reaching a legal vertex two edges out.

Pool after: 0 wood, 0 brick, 2 wheat, 1 ore.

This is a normal opening and it is not a dead turn. That is the point of the
5-a-turn deck: you always have something. It also shows the deck is not a
firehose, because one turn of income buys exactly two roads and nothing else.

**Turn 2.**

Upkeep: draw the other 5 cards. The shuffle gives 1 wood, 1 brick, 2 sheep,
1 ore.

Production: roll 4. B2 and C4 fire. P1's 9-pip settlement touches B2 for 1 ore.
The 13-pip settlement touches neither.

Pool: 1 wood, 1 brick, 2 sheep, 2 wheat, 2 ore. Eight resources.

Action: the vertex reached by turn 1's roads is legal. A settlement costs
wood + brick + sheep + wheat. P1 pays and is at 3 VP with 1 sheep, 1 wheat,
and 2 ore left.

The other play is buying a card. Foundry Quay costs 3 brick and P1 has 1.
Rope Walk costs 3 wood and P1 has 1. Provisioner costs 2 wheat and P1 has 2,
so the market is live, but 2 wheat buys 2 resources and the settlement buys a
victory point and a producing hex. The settlement is correct here. That is the
comparison the game wants players making on turn 2.

**Turn 3.**

Upkeep: the deck is empty, so the 10-card discard is shuffled. Draw 5:
2 wood, 1 brick, 1 sheep, 1 ore.

Production: roll 11. A2 and C1 fire. The 9-pip settlement touches A2 for
1 wheat.

Pool: 2 wood, 1 brick, 2 sheep, 2 wheat, 3 ore. Ten resources.

Action: Bellows Yard costs 3 ore and P1 has 3, so it is affordable and would
keep the ore engine running. P1 buys Provisioner for 2 wheat instead, the first
choice card of the game, and takes 1 wheat and 1 ore. Then P1 builds one road
for wood + brick, heading for the coast and a generic port.

Pool after: 1 wood, 2 sheep, 1 wheat, 4 ore. That is one resource short of a
city, which is exactly the kind of two-turn plan the design wants players
holding.

End of turn: all five played cards go to discard, along with the Provisioner
bought this turn.

**What this exposes.** By end of turn 3 P1 has 3 VP, 5 roads (2 from setup,
2 on turn 1, 1 on turn 3), a longest unbroken chain of 4 so no road award yet,
one purchase, and 4 ore banked. That matches the design: turns 1 to 3 are
board turns, the deck turn starts around turn 4 or 5, and a player who buys on
turn 1 is trading a settlement for an engine that pays back around turn 5.
Both lines are defensible, which is what the opening needs.

It also shows where the 7 bites. P1 peaked at 10 resources mid-turn and ends
turn 3 holding 8, one under the limit, so no discard risk. Had P1 skipped the
road to save for a city they would be sitting on 9 with one ore to go, and a 7
would cost them 4. The 7 punishes saving, not spending, which is the pressure
the turn order was chosen for.

The thing to watch in the simulator: if the "buy on turn 1" line is
consistently 2 or more turns faster, the engine cards are underpriced and the
market needs work, not the board.

---

## 18. MVP versus stretch

The whole design is implementable. This split assumes a small team and a
deadline.

**MVP, ship this.**

- 19-hex board, fixed template, 12 orientations, ports.
- 4-player and 3-player, target 14 and 16. 2-player supported at target 18 but
  not tuned.
- Full turn cycle, robber, discards, steals.
- All Catan building, all bank and port trades.
- Deck: 10 starting cards, hand 5, keep unplayed cards, discard played cards,
  draw and reshuffle.
- All 10 market piles and both charter stacks, one purchase per turn.
- Both awards.
- Player-to-player trades, offer to all, accept or decline, no counter-offer.
- Bots at Factor difficulty only.
- Legal action list exposed to the client so the UI never shows a dead button.
- Seed plus action log determinism, and a headless bot-vs-bot simulation script.

**Stretch, do these in order if there is time.**

1. Guildmaster bot. It is the difference between "the bots are practice" and
   "the bots are an opponent".
2. Deckhand bot, for a gentle first game. Cheap once Guildmaster exists.
3. Counter-offers in player trades.
4. "Offer to one player" as well as "offer to all".
5. Turn timer with an auto-end for humans.
6. A second board template and random token placement, so the map is not
   memorised after five games.
7. Reconnect handback polish, animated productions, and the endgame VP
   breakdown screen.

**Cut without regret.**

- Piece limits.
- Roads on ships, or any sea expansion.
- Card upgrades or a card that removes cards from your deck.
- Any card costing more than one resource type inside the market piles.
- Any hidden simultaneous decision. Nothing in this design needs one.
- Art assets of any kind. Everything is inline SVG built from the palette in
  the client.
- Achievements, profiles, stats, accounts.

---

## 19. Design risks

Ranked by how likely it is to break the game, with what to watch.

**1. The deck is either too weak or too strong relative to the board.** This is
the whole design in one number. Watch the ratio of board VP to total VP for the
winner across 500 simulated 4p games. Target 50% to 65%. Above 70% the deck is a
hobby. Below 45% the map is decoration and the robber is pointless. Fixes, in
order: add or remove one copy of Rope Walk, adjust the target by one, change the
charter costs.

**2. Card purchases are quietly dominant and the market is the real game.**
Because one purchase per turn is a cap rather than a quota, a rich player buys
every turn and a poor player cannot. Watch the resource gap between first and
last at turn 8. If it exceeds 6 resources, the engine cards compound too hard.
The lever is the draw effects: Rope Walk and Wool Factor are the only two
throughput cards on purpose.

**3. The robber is toothless.** The 7 arrives in the production phase, before
the deck pays out, so it can never take your card income. It only blocks board
production, which is 12% to 28% of income. Watch whether players bother moving
it somewhere meaningful. If not, tell the UI team to make the production
animation very loud about what the robber blocked; perception carries a lot
here. If it still does not land, the rules lever is to let the robber block a
market pile, but that is a big change and should not be in v1.

**4. Turns get long.** Five cards plus targets plus trades plus a purchase is a
lot of clicking. Watch median turn time in human playtests. If the median
exceeds 45 seconds in 4p, the fix is UI: auto-resolve the obvious cards, batch
"play all producers", and never make someone click a resource token one at a
time.

**5. The charter stacks define the endgame too much.** If the last Fleet
Charter is always the winning move, the game ends on a purchase rather than a
board read. Watch the percentage of games decided by a charter purchase versus
a settlement or an award. In 500 simulated 4p games at target 14, 32% of games
ended on a Fleet Charter and none stalled; any charter, usually a Quay Deed,
ended 90% of games. That last number is structural rather than a tuning miss:
the board saturates at about 15 buildings, almost all of them cities, so the
last point or two usually has to come from a charter. Levers if it feels bad:
raise the target by one, or make cities cost one more resource so the board
supports more settlements late. Do not remove charters; a blocked player needs
the sink.

**6. Provisioner and Wrecker's Lamp are the only two cards that need a real
modal.** The other two choice cards, Guild Mason and Shipwright's Yard, just
reuse the board placement flow the game already has, so they cost almost
nothing. If playtesting shows the two modals cause misclicks or bot weirdness,
the fallback is to replace Provisioner with a fixed "gain 1 ore and 1 sheep" and
Wrecker's Lamp with "gain 1 renown, the robber returns to the desert, steal
nothing". Both keep the strategy alive with zero UI cost. Do not add a third
modal card.

**7. 2-player is an afterthought and plays thin.** It is supported and it will
be someone's first game. Watch for robber-spam and for trades being trivially
one-sided with only one buyer. Mitigation if it is bad: raise the 2p target to
18 and accept it as a variant, or disable player trades in 2p.

**8. The market runs dry in high-purchase games.** 58 pile cards plus 13
charters against about 36 purchases in a 4p game leaves margin, but the good
piles will empty. Watch for a late game where the only cards left are ones
nobody wants. That is acceptable scarcity as long as the school of thought is
not deleted before turn 4.

### Playtest watchlist, in reading order

Watch these numbers rather than vibes:

- Turn index of the winning VP for each seat. Median and 10th percentile.
- Winner's VP split: board, charters, awards.
- Number of purchases per player and which piles emptied first.
- How often the 7 fires and how much it actually costs someone.
- How often a player ends a turn with zero legal builds and zero purchases.
- Award holders over time. If one player holds both awards from turn 6 to the
  end, both thresholds are too cheap.
- Cards kept per turn and how often a kept hand was cashed for a charter. A
  player can bank a five-card hand out of reach of the seven, so watch whether
  Fleet Charter stops being the intended gamble. The lever is a keep cap of two
  or three, not a charter cost change.
- Human turn duration, median and 90th percentile.

---

## 20. Notes for the engine and clients

Not rules, but the rules above imply these.

- An action list of about 25 action types covers everything: `placeSetup`,
  `rollDie`, `discard`, `moveRobber`, `steal`, `playCard`, `buildRoad`,
  `buildSettlement`, `buildCity`, `bankTrade`, `offerTrade`, `respondTrade`,
  `cancelTrade`, `buyCard`, `endTurn`, plus a small set of targeting
  sub-actions. Keep targeting inside the action payload, not as a separate
  state machine, so a bot can build a complete action in one object.
- The engine needs `legalActions(state, seat)` returning everything the UI
  should enable. Any button the UI shows must exist in that list.
- Award recomputation and victory checking belong in one function that runs
  after every mutation. Never compute them twice, and never let the client
  compute them.
- Resource counts are public, so the view filter only has to hide deck order,
  hand contents, and the identity of stolen cards.

---

## 21. Open questions

Answered by simulation or playtest, not by more design:

1. Is 14/16/18 the right target ladder, or does 4p want 15?
2. Is Bellows Yard at 3 ore too strong, given it is the only card that turns
   ore into wheat at scale? Simulation says about 3.7 buys per 4p game, about
   one per player, which is lively rather than dominant.
3. Does the 9-resource limit ever bind in a real game, or should it go back to
   7? A Fleet Charter at 9 resources now sits exactly on the limit, so holding
   the full cost with no margin is the intended gamble.
4. Is one purchase per turn enough at the 3p target of 16, or do 3p games feel
   starved of deck decisions?

Owner of this file is the design agent. Card numbers live in `CARDS.md`.
