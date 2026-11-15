# Days of Lorac: cards

Companion to `docs/GAME-DESIGN.md`. That file owns the rules. This file owns
card data: ids, costs, copy counts, exact player-facing text, effect
specification, edge cases, and the bot heuristic for each card.

Cross-checks (see section 7 for the arithmetic): 10 market piles, 58 pile
cards, 2 charter stacks, 13 charter cards, 71 cards in the market, 10 cards in
each starting deck.

---

## 1. Conventions

**Stable ids** are kebab-case and never change once the engine reads them. Card
names can change after playtesting. Ids cannot.

**Cost notation.** Market pile costs are a single resource type. Charter costs
are a fixed multiset. There is no mixed cost inside a pile, and that is
deliberate: single-resource costs make the market readable in one glance and
force the deck layer to care about which numbers your buildings sit on.

**Text conventions.** Player-facing text is written the way it appears on the
card. Effects resolve strictly left to right. Cards never require resources to
play. Every card with a board target has a printed fallback, so no card can
fail to resolve.

**Choice flag.** `choice: yes` means the card needs a modal or a targeting
state. Four cards total, listed in section 8. Everything else resolves with a
single click and no input.

**Renown** is a public counter, not a card in play. It is never spent and never
lost.

---

## 2. Starting deck

10 cards per player. Two of each resource. No choices, no riders, no text that
needs a tooltip.

| id | Name | Copies | Cost | Text |
| --- | --- | --- | --- | --- |
| `start-wood` | Driftwood Crew | 2 | none | Gain 1 Wood. |
| `start-brick` | Ballast Crew | 2 | none | Gain 1 Brick. |
| `start-sheep` | Fleece Runner | 2 | none | Gain 1 Sheep. |
| `start-wheat` | Victualler | 2 | none | Gain 1 Wheat. |
| `start-ore` | Bellows Hand | 2 | none | Gain 1 Ore. |

Effect spec: add 1 of the named resource to the pool. Nothing else. No target,
no optional clause, no interaction with any other card.

Edge cases: none. These cards are the reference implementation of "resolves
cleanly, no state needed".

Bot heuristic: always play. Never hold.

Design note: exactly 2 of each is what makes turn 1 income a flat 5.0 per turn
and what makes the first purchase the first real decision. Do not add variety
here. A five-card opening hand that sometimes has no ore is fine. One that
sometimes has 7 resources is not.

---

## 3. Market manifest

| # | id | Name | Cost | Copies |
| --- | --- | --- | --- | --- |
| 1 | `salvage-yard` | Salvage Yard | 3 Wood | 7 |
| 2 | `rope-walk` | Rope Walk | 3 Wood | 6 |
| 3 | `foundry-quay` | Foundry Quay | 3 Brick | 6 |
| 4 | `guild-mason` | Guild Mason | 3 Brick | 6 |
| 5 | `wool-factor` | Wool Factor | 3 Sheep | 6 |
| 6 | `wreckers-lamp` | Wrecker's Lamp | 3 Sheep | 5 |
| 7 | `provisioner` | Provisioner | 2 Wheat | 6 |
| 8 | `survey-voyage` | Survey Voyage | 3 Wheat | 6 |
| 9 | `bellows-yard` | Bellows Yard | 3 Ore | 6 |
| 10 | `shipwrights-yard` | Shipwright's Yard | 4 Ore | 4 |
| | | **Pile subtotal** | | **58** |
| 11 | `quay-deed` | Quay Deed | 1 of each resource | 9 |
| 12 | `fleet-charter` | Fleet Charter | 3 Ore, 3 Wheat, 3 Brick | 4 |
| | | **Charter subtotal** | | **13** |
| | | **Market total** | | **71** |

Supply check against demand:

- 4 players at the 14-VP target buy roughly 8 to 10 cards each, so 32 to 40
  purchases.
- 3 players at 16 buy roughly 7 to 9 each, so 21 to 27.
- 2 players at 18 buy roughly 6 to 8 each, so 12 to 16.

71 cards covers a 4-player game with margin. Individual piles will empty,
which is the point. The whole market cannot.

Cost total check across all 58 pile cards: 172 resource units, an average of
2.97 per card. By resource, counting every copy: wood 39, brick 36, sheep 33,
wheat 30, ore 34.

The market pulls hardest on wood and ore. Wood is the richest terrain on the
template (14 pips), so the market soaking it up is healthy. Ore is the poorest
terrain (10 pips) and the most expensive thing to buy, which is why the deck
has to cover roughly one ore per turn or nobody can build a city. That is the
single most important balance relationship in the game: the deck exists to make
ore affordable, and the market exists to make you pay for it.

---

## 4. Card details

### 4.1 `salvage-yard`, Salvage Yard

- Cost 3 Wood. Copies 7.
- Text: **Gain 2 Brick and 1 Ore.**
- Effect spec: `gain(brick, 2); gain(ore, 1)`.
- Type: economy, conversion.
- VP: none. Renown: none.
- Choice UI: no.
- Edge cases: none. The most boring card in the game on purpose, because it is
  also the answer to two dead-end situations: you have wood coming out of your
  ears, or the brick and ore hexes are both under the robber.
- Bot heuristic: buy when holding 4 or more wood, or when brick plus ore in the
  pool is under 2 with a settlement within reach. Do not buy after turn 9
  unless the deck is still under 16 cards.
- Why not an auto-buy: it costs 3 wood, and wood is the road resource. A player
  building roads cannot spare it. It is the wrong card for a board rush and
  that is intentional.
- Why not a trap: the two things it makes are the two scarcest terrains.

### 4.2 `rope-walk`, Rope Walk

- Cost 3 Wood. Copies 6.
- Text: **Gain 1 Wood. Draw 2 cards.**
- Effect spec: `gain(wood, 1); draw(2)`.
- Type: cycling.
- VP: none. Renown: none.
- Choice UI: no.
- Edge cases: if the deck and discard are both empty when the second draw
  happens, draw nothing. Played cards are still in the play area, so this can
  happen and is legal. Never reshuffle played cards.
- Bot heuristic: the first two purchases for an economy plan. Buy at any point
  before turn 8 if the deck is under 16 cards. Never buy after turn 10.
- Why not an auto-buy: it does not build anything. Three wood spent here is a
  road and a half not built, and on a 13-card deck it pays back in about three
  turns, which is too late if you buy it on turn 9.
- Why not a trap: it is the only two-draw card in the game. Two of them make a
  15-card deck play like a 10-card deck, which is a visible change in what a
  turn can afford.

### 4.3 `foundry-quay`, Foundry Quay

- Cost 3 Brick. Copies 6.
- Text: **Gain 2 Ore and 1 Wheat.**
- Effect spec: `gain(ore, 2); gain(wheat, 1)`.
- Type: conversion, city fuel.
- VP: none. Renown: none.
- Choice UI: no.
- Edge cases: none.
- Bot heuristic: buy when ore plus wheat in the pool is 2 or less and the bot
  has 2 or fewer cities. Brick over 4 is the trigger.
- Why not an auto-buy: brick is the other road resource. A rushing player is
  spending every brick on roads and cannot afford it.
- Why not a trap: a city costs 2 wheat and 3 ore, and this card is 3 of those 5
  resources in one play. It is the single fastest route to a city upgrade
  without a good ore hex.

### 4.4 `guild-mason`, Guild Mason

- Cost 3 Brick. Copies 6.
- Text: **Place a road for free. If you cannot, gain 1 Wood and 1 Brick. Draw 1
  card.**
- Effect spec: if a legal road edge exists, enter road targeting and place one
  at zero cost, then `draw(1)`. Otherwise `gain(wood,1); gain(brick,1)` then
  `draw(1)`.
- Type: board rush, cycling.
- VP: none. Renown: none.
- Choice UI: yes, board targeting (an edge). Not a modal; reuse the normal road
  placement flow with cost waived.
- Edge cases: no legal edge is possible when every edge touching the bot's
  network is taken or there is no network at all (cannot happen after setup).
  Handle both by taking the fallback. A road placed this way can trigger the
  road award recomputation and it can complete a chain that wins the game, so
  run the post-action hooks exactly as for a paid road.
- Bot heuristic: buy when the bot has a settlement site it wants but is one or
  two roads short, or when the road award is within one road. Choose the edge
  that maximizes new reachable vertices, tie-broken toward the port.
- Why not an auto-buy: it is worth 2 resources of road plus a draw, and a bot
  that does not want a road right now gets only 2 resources back. Value depends
  entirely on whether a placement is actually wanted.
- Why not a trap: the free road ignores cost, so it converts brick, a single
  resource, into the one thing that cannot be bought with resources alone,
  which is board position.

### 4.5 `wool-factor`, Wool Factor

- Cost 3 Sheep. Copies 6.
- Text: **Gain 2 Sheep. Draw 1 card.**
- Effect spec: `gain(sheep, 2); draw(1)`.
- Type: economy, cycling.
- VP: none. Renown: none.
- Choice UI: no.
- Edge cases: same draw exhaustion case as Rope Walk.
- Bot heuristic: buy when sheep is over 4 and the deck is under 16 cards. It is
  the sheep sink, because sheep hexes are the richest on the template (12 pips
  across 4 hexes) and nothing else spends sheep except settlements.
- Why not an auto-buy: sheep is the least useful resource past the opening.
  Converting 3 sheep into 2 sheep plus a card is a wash on count and only pays
  if you wanted the card.
- Why not a trap: it is a cheap way to keep cycling without spending wood or
  brick, which are the resources you actually need for roads. Every deck wants
  one.

### 4.6 `wreckers-lamp`, Wrecker's Lamp

- Cost 3 Sheep. Copies 5.
- Text: **Gain 1 Renown. You may move the robber and steal 1 resource from a
  player with a building on that hex.**
- Effect spec: `gainRenown(1)`, then an optional two-step choice: pick a hex
  other than the robber's current one, move it, then pick a victim among the
  players with a building on that hex and `steal(1, random)` from them.
- Type: disruption, renown.
- VP: 1 renown, which is one third of the Largest Expedition award (+2 VP).
- Choice UI: yes. Two selections in one flow: hex, then victim. Default
  highlights the leader's best-producing hex. Cancellable, and cancelling keeps
  the renown.
- Edge cases: the robber move is optional, the renown is not. If the chosen hex
  has no adjacent buildings, the move happens and the steal is skipped. The
  robber may be sent to the desert. It may not stay where it is. A player
  holding 0 resources may be chosen, which is usually a mistake but is legal.
- Bot heuristic: buy when the bot has 2 renown already (it takes the award), or
  when the leader has a hex worth 4 or more pips and the bot is not the leader.
  Never buy two in the same game purely for renown; the second one is normally
  the award-sealing purchase and should be timed.
- Why not an auto-buy: 3 sheep for 1 renown is poor value unless it is the
  third renown. The robber move is only worth something if the target hex
  matters, which is board-dependent.
- Why not a trap: at 5 copies it is the cheapest route to the Largest
  Expedition award. Two of these plus one Survey Voyage is 3 renown for 9
  resources across 3 purchases, and 2 VP for that is a real rate. It is also
  the only card that lets a losing player hurt the leader without spending
  board position.

### 4.7 `provisioner`, Provisioner

- Cost 2 Wheat. Copies 6.
- Text: **Gain 2 resources of your choice.**
- Effect spec: `chooseResources(count=2, from=all, allowRepeats=true)` then gain
  them.
- Type: flexibility.
- VP: none. Renown: none.
- Choice UI: yes. A five-button picker with counts, plus a confirm. Two clicks
  minimum. Preselect the bot's shortage if a bot is playing.
- Edge cases: repeats are allowed, so wheat plus wheat is legal. If the player
  closes the modal without choosing, resolve as 2 wood so the engine never
  hangs. Time-out default is the resource the player holds least of.
- Bot heuristic: always buy when wheat is over 3 and the deck is under 18. Pick
  the two resources that complete the bot's cheapest available settlement or
  city. If nothing is close, pick ore then wheat.
- Why not an auto-buy: 2 resources for 2 wheat is a wash on count. The whole
  value is the conversion, and a bot with a balanced pool gains nothing.
- Why not a trap: it is the cheapest card in the market and it is the answer to
  the classic Catan dead hand, where you have six of everything except the one
  resource you need.

### 4.8 `survey-voyage`, Survey Voyage

- Cost 3 Wheat. Copies 6.
- Text: **Gain 2 Renown. Draw 1 card.**
- Effect spec: `gainRenown(2); draw(1)`.
- Type: quests, renown, cycling.
- VP: 2 renown. Two of these reach 4 and hold the award alone. One plus one
  Wrecker's Lamp reaches 3 and takes it.
- Choice UI: no.
- Edge cases: none. Renown is capped in practice by the award threshold of 3,
  but the counter keeps climbing and there is no cap in the data model.
- Bot heuristic: the single highest-priority purchase when the bot has 0 renown
  and no award, or when an opponent holds the award and the bot needs 3 to take
  it. Lower priority than a settlement in the first four turns.
- Why not an auto-buy: 3 wheat for 2 renown plus a card is only worth it if the
  award is live. If someone else already has 5 renown, the marginal renown is
  worth nothing.
- Why not a trap: 2 VP for two purchases and 6 wheat is 3 resources per VP,
  which beats a city upgrade. It is the cheapest VP in the game and it is
  capped by the award, so exactly one player gets it.

### 4.9 `bellows-yard`, Bellows Yard

- Cost 3 Ore. Copies 6.
- Text: **Gain 2 Ore and 2 Wheat.**
- Effect spec: `gain(ore, 2); gain(wheat, 2)`.
- Type: economy, city fuel.
- VP: none. Renown: none.
- Choice UI: no.
- Edge cases: none.
- Bot heuristic: buy on the turn the bot reaches 3 ore and still lacks 2 wheat
  for a city. Highest priority purchase for a bot with 2 or more settlements
  and fewer than 2 cities.
- Why not an auto-buy: ore is the scarcest terrain and 3 ore is still a real
  hold. Buying it means not building anything else this turn.
- Why not a trap: it returns 4 resources from a 3-resource cost, so it turns
  one ore into two wheat every cycle. It is the only card that makes cities
  cheap.
- Watched card: after the cut from 4 ore to 3, this is the most efficient pile
  in the market. Simulation gives about 3.7 buys per 4p game, roughly one per
  player, which is lively rather than dominant. If it climbs past 4 buys a game
  or wins an outsized share of games, the next step is a 3 ore, 2 wheat cost or
  a reduced effect; do not go back to 4 ore, which sold zero copies.

### 4.10 `shipwrights-yard`, Shipwright's Yard

- Cost 4 Ore. Copies 4.
- Text: **Gain 1 Renown. Place a settlement for free. If you cannot, gain 2 Ore
  and 2 Wheat.**
- Effect spec: `gainRenown(1)`; if a legal settlement vertex exists, enter
  settlement targeting and place one at zero cost; otherwise `gain(ore,2);
  gain(wheat,2)`. The placement is a normal settlement in every way: it scores
  1 VP, it produces, it can take a port, and it can cut an opponent's road.
- Type: board rush, renown, premium.
- VP: 1 renown plus a settlement's 1 VP.
- Choice UI: yes, board targeting (a vertex).
- Edge cases: no legal vertex is common in the late game. Take the fallback.
  The placement must respect the distance rule and network connectivity, the
  same as a paid settlement. It may trigger a road cutoff against an opponent
  and an award recomputation, so run the post-action hooks. It may win the
  game, so check victory inside the resolution, not after it.
- Bot heuristic: buy only when a good vertex is open, or when the bot is one
  renown short of the award. Never buy with no legal vertex unless the fallback
  is what the bot wants.
- Why not an auto-buy: only 4 copies exist and the placement is often blocked
  by the time a player can afford 4 ore. Most games see 1 or 2 bought.
- Why not a trap: 4 ore buys a settlement, which is otherwise 4 mixed
  resources plus a road, plus a renown. It is the best single purchase in the
  market when it is legal, and dead weight when it is not. That tension is the
  card.

### 4.11 `quay-deed`, Quay Deed

- Cost 1 of each resource (5 total). Copies 9.
- Text: **Worth 1 Victory Point.**
- Effect spec: `vp += 1`. Permanently owned. No play effect.
- Type: scoring.
- VP: 1, permanent, counted whether the card is in the deck, the hand, the
  discard, or the play area.
- Choice UI: no.
- Edge cases: cannot be removed, discarded, or traded. Does nothing when
  played, so the UI must not offer it as a playable card. It dilutes the deck,
  which is the entire cost. Charter counts are public.
- Bot heuristic: buy when the bot is at target minus 3 or closer, or when the
  bot cannot reach any settlement vertex and has a spare 5 resources. Never
  before turn 6.
- Why not an auto-buy: 5 resources for 1 VP is the same rate as a city upgrade,
  but a city also produces. The deed's only edge is that it needs no board
  space. Buying it early is a tempo loss and it clogs your draws.
- Why not a trap: it is the only VP a fully blocked player can buy. Without it,
  a player with no legal settlement vertex would have nothing to spend on and
  the game would stall for them. The ninth copy exists for the same reason: a
  four-player game where the board saturates at 15 cities can otherwise run
  out of charter VP before anyone reaches the target, and the bot simulation
  found exactly that stalemate. The extra deed is bought only in those long
  games; the usual 4p game still sees about 3.7. See `GAME-DESIGN.md` section
  19, risk 5.

### 4.12 `fleet-charter`, Fleet Charter

- Cost 3 Ore, 3 Wheat, 3 Brick (9 total). Copies 4.
- Text: **Worth 2 Victory Points.**
- Effect spec: `vp += 2`. Permanently owned. No play effect.
- Type: scoring, premium.
- VP: 2 permanent.
- Choice UI: no.
- Edge cases: same ownership rules as Quay Deed. The fixed multiset means a
  player holding only wood and sheep cannot buy one at any price, which is
  intentional. 9 resources sit exactly on the 9-resource hand limit, so a
  player can legally hold the whole cost but has no margin: one more resource
  and a seven forces a discard. That is the intended gamble.
- Bot heuristic: highest-priority purchase from the turn the bot can pay, if
  the bot is at target minus 5 or closer. Second priority if two copies remain
  and an opponent is at target minus 3.
- Why not an auto-buy: 4.5 resources per VP is still the best rate in the game,
  which makes it look like an auto-buy, but it is 9 resources in one turn and
  it is a dead card forever. Buying one on turn 6 costs you a city.
- Why not a trap: with only 4 copies it is a contested prize, and the race for
  the last one produces the endgame. Simulation at 9 resources makes it the
  decisive purchase in 32% of 4p games, under the 35% watch line. If that
  climbs again, raise the cost to 10 before touching copies.

---

## 5. Strategy map

Which cards support which plan. A card may serve two plans, and the overlap is
where interesting decks come from.

| Plan | Primary cards | Support | What it needs to work |
| --- | --- | --- | --- |
| Economy / conversion | Salvage Yard, Foundry Quay, Bellows Yard | Wool Factor | Wood and brick income. Buys nothing but resource-shifting for 4 or 5 turns, then dominates the late game. Beats a board rush that stalls. |
| Cycling | Rope Walk, Wool Factor | Guild Mason, Survey Voyage | Any two-draw effect. Turns a 15-card deck into something that plays 7 cards a turn. Loses to the robber on its best hex. |
| Board rush | Guild Mason, Shipwright's Yard | Foundry Quay for cities | Brick income and an open map. Fastest plan to 8 VP and the first to hit the vertex wall. Needs the road award to close. |
| Quests / renown | Survey Voyage, Wrecker's Lamp, Shipwright's Yard | Provisioner for renown fuel | 3 renown at minimum, four piles can supply it. Two purchases buys 2 VP, which is the cheapest VP in the game, so it is always contested. |
| Disruption | Wrecker's Lamp | All of the above, indirectly | Only one card. It is not a plan on its own, it is a lever for a losing player. Do not build a second disruption card in v1. |
| Scoring | Quay Deed, Fleet Charter | Everything else | Resources, no board. The plan of last resort for a blocked player and the finisher for everyone else. |

Which plan should a new player be told to try: economy into scoring. Buy Rope
Walk and Bellows Yard for four turns, then convert into cities and charters. It
is the plan that most looks like a deck builder and it is the one the 14-VP
target was set to make viable.

Which plan is easiest to play badly: board rush. It looks obvious, it wins the
first six turns, and it loses if the roads do not reach a second cluster of
good numbers.

---

## 6. Balance table

### 6.1 The formula

Adding a card of value V to a deck of n cards whose total per-appearance value
is T changes your per-turn resource income by

```
delta = 5 * (n * V - T) / (n * (n + 1))
```

with a hand of 5. With n = 13 and T = 13, that simplifies to
`delta = 0.357 * (V - 1)`.

Payback in turns is `cost / delta`. V is measured in resource-equivalents per
appearance, so a draw effect is worth the average card value in the deck, about
1.3, and one renown is valued at 1.5 to account for the chance it never reaches
the award threshold.

The formula assumes the player plays all five cards. Since unplayed cards now
stay in hand, a player who keeps k cards draws 5-k and plays less, so real
income can sit below the table. Treat the numbers as the value of playing the
card every time you draw it, which is still the right way to price a buy.

The useful reading: a card bought on turn 6 has about 6 to 8 turns to pay back.
Anything paying back in 5 or fewer is a strong buy. Anything over 8 is a trap
at that point in the game, and correct in the first three turns.

### 6.2 Per-card

| Card | Cost | V per appearance | Delta/turn | Payback | Verdict |
| --- | --- | --- | --- | --- | --- |
| Salvage Yard | 3 | 3.2 | +0.79 | 3.8 turns | In band. Held back by costing the road resource. |
| Rope Walk | 3 | 3.6 | +0.93 | 3.2 turns | Strong early, dead after turn 9. |
| Foundry Quay | 3 | 3.3 | +0.82 | 3.7 turns | In band. The city shortcut. |
| Guild Mason | 3 | 3.3 | +0.82 | 3.7 turns | In band only if the road is wanted. Situational. |
| Wool Factor | 3 | 3.3 | +0.82 | 3.7 turns | In band. The sheep sink. |
| Wrecker's Lamp | 3 | 2.5 | +0.54 | 5.6 turns | Weak on economy, strong on the award. |
| Provisioner | 2 | 2.6 | +0.57 | 3.5 turns | In band. Cheapest card, best value for a blocked player. |
| Survey Voyage | 3 | 4.3 | +1.18 | 2.5 turns | Above band on paper. The award cap is what reins it in: renown past 3 is worth nothing. |
| Bellows Yard | 3 | 4.0 | +1.07 | 2.8 turns | Below band on paper. The best raw pile in the market, and the reason the cost is watched at 3 ore. Simulation: about 3.7 buys per 4p game, not an auto-buy. |
| Shipwright's Yard | 4 | 5.5 | +1.60 | 2.5 turns | Above band, gated by needing a legal vertex and 4 copies total. |
| Quay Deed | 5 | 0 resources, 1 VP | n/a | n/a | 5 resources per VP. Same rate as a city, no board needed. |
| Fleet Charter | 9 | 0 resources, 2 VP | n/a | n/a | 4.5 resources per VP, still the best rate in the game, gated by 4 copies and 9 resources in one turn. |

### 6.3 The band

Market cards should land between 3 and 6 turns of payback. Anything under 3 is
an auto-buy and anything over 6 is a trap. Three cards sit below 3
(Bellows Yard, Survey Voyage, Shipwright's Yard). Bellows Yard is the one to
watch after its cost cut; the other two are capped by the award threshold or by
the copy count, which is the intended way to allow a strong card without
letting it dominate. Simulation says Bellows Yard settles at about one buy per
player in 4p, so the payback table overstates it.

No card is a pure trap. The three weakest on raw economics, Wrecker's Lamp,
Guild Mason, and Quay Deed, are all strong in a specific situation. That is
what "situational" should mean: dead in the wrong deck, excellent in the right
one.

### 6.4 Copy counts and scarcity

Copy counts encode how often a plan should appear in a 4-player game:

- 4 copies: Shipwright's Yard, Fleet Charter. One or two will be bought. They
  are prizes.
- 5 copies: Wrecker's Lamp. Enough for one player to take the award or two to
  fight over it.
- 6 copies: the workhorse piles. Two players can both build the same plan,
  which is good, because the interesting games are the ones where two players
  share a plan and one executes better.
- 7 copies: Salvage Yard. The easy card. Slightly over-supplied on purpose so a
  beginner always has something sensible to buy.
- 9 copies: Quay Deed. Enough that a blocked player is never without a sink,
  plus one spare for the rare board-locked game where the charter VP would
  otherwise run out before anyone reaches the target.

---

## 7. Count cross-check

Market piles:

```
7 + 6 + 6 + 6 + 6 + 5 + 6 + 6 + 6 + 4 = 58
```

Charters:

```
9 (Quay Deed) + 4 (Fleet Charter) = 13
```

Market total: 58 + 13 = 71.

Starting deck per player: 2 + 2 + 2 + 2 + 2 = 10.

Deck size at the end of a 4-player game: 10 start + 8 to 10 purchases = 18 to
20 cards, of which 2 to 4 are charters.

VP supply from cards: 9 Quay Deeds at 1 VP plus 4 Fleet Charters at 2 VP = 17
VP available from the market, against roughly 56 VP needed across a 4-player
game. The board and the awards must carry the rest, which is what stops the
charter stacks from becoming the whole game.

Card count by type across the 12 purchasable cards: economy 4 (Salvage Yard,
Foundry Quay, Wool Factor, Bellows Yard), cycling 4 (Rope Walk, Wool Factor,
Guild Mason, Survey Voyage), board 2 (Guild Mason, Shipwright's Yard), renown 3
(Wrecker's Lamp, Survey Voyage, Shipwright's Yard), disruption 1 (Wrecker's
Lamp), flexibility 1 (Provisioner), scoring 2 (Quay Deed, Fleet Charter). That
is 17 type tags over 12 cards, so five cards carry two types each: Wool Factor,
Guild Mason, Wrecker's Lamp, Survey Voyage, Shipwright's Yard. Those five are
where the deck overlap comes from.

---

## 8. Choice and targeting inventory

Four cards need more than one click. Everything else is a single click that
resolves and updates the board.

| Card | What is selected | UI shape | Bot default |
| --- | --- | --- | --- |
| Provisioner | 2 resources, repeats allowed | small modal, five rows with plus and minus, confirm | the two resources that finish the nearest settlement or city |
| Wrecker's Lamp | hex, then victim | board targeting then a player chooser; both cancellable | the leader's highest-pip hex, then the leader |
| Guild Mason | one road edge | reuse the paid road placement flow, cost waived | edge with the most new reachable vertices |
| Shipwright's Yard | one vertex | reuse the paid settlement placement flow, cost waived | highest-pip legal vertex |

Everything else, including all charters, the starting deck, and the eight
market cards not listed above, resolves with no input.

Do not add a fifth card with a choice in v1. Each one costs a modal, a bot
branch, a test, and a source of misclicks.

---

## 9. Deliberately not in v1

Listed so nobody adds them by accident.

- Any card that removes a card from your deck. Deck thinning is a large
  balance lever and this game has none; Rope Walk's cycling is the substitute.
- Any card that grants an extra purchase or extra hand size at upkeep. Both
  break the pacing brakes.
- Any card that lets you reroll or modify the die. Production happens before
  the action phase on purpose.
- Any card that creates a permanent tableau. No buildings in front of you, no
  persistent bonuses, no counters other than renown and VP.
- Any card with a hidden simultaneous decision. There is no card in this design
  that needs one, and it would need a whole subsystem.
- Any card that costs two resource types inside a market pile. Costs stay
  single-type so the market is readable and so the board, not the market,
  decides what you can afford.
- Any second disruption card. One is a lever. Two is a grinding game.
