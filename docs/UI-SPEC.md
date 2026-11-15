# Days of Lorac: UI spec

Buildable client spec for one engineer. Rules live in `GAME-DESIGN.md`, card
text in `CARDS.md`, shapes in `src/shared/types.ts` and `protocol.ts`. Nothing
here changes a rule. If a state is missing from `GameView` or `LegalMoves`,
report it, do not compute it in the client.

Mood in concrete terms: a guild factor's desk on a wet night. Ink on ruled
paper, brass corners, salt-stained chart, one lamp. Panels are parchment, the
sea is the ground, every border is a brass hairline, nothing is rounded past
8px. No glass, no blur, no cards floating on gradients.

---

## 1. Screen flow

```
boot
 |-- ?room=CODE and token stored --> resume --ok--> lobby | game
 |-- ?room=CODE, no token ---------> Join, code prefilled
 |-- stored token, no code --------> Title with "Resume last game"
 '-- otherwise -------------------> Title

Title --> Solo setup --> Game        Title --> Create room --> Lobby --> Game
Title --> Join by code --> Lobby --> Game

Game --> Game over --+-- Play again --> same room, new seed
                     '-- Change setup --> Title
any screen --> Rules sheet, closes back where it opened
```

| Screen | Content | Primary button |
| --- | --- | --- |
| Title | wordmark, seal, tagline, three buttons, footer version and socket dot | "Play vs bots" |
| Solo setup | name, seats 2/3/4, difficulty, "Race to 18/16/14" note | "Start game" |
| Create room | name, max players 2/3/4, fill difficulty | "Create room" |
| Join | name, 4-letter code in caps, locked when it came from a URL | "Join room" |
| Lobby | code chip, seat grid, ready toggles, host controls, invite link | "Start game" |
| Game | board, ledger, market, hand, action bar | context button |
| Game over | winner line, VP table, log digest | "Play again" |

Title also gets a text link "Rules". A stored session shows a strip above the
buttons: "You have a game in room KRTM." with "Resume" and "Forget".

`?room=CODE` behavior:

1. Uppercase and test `/^[A-Z]{4}$/`. Otherwise toast "Room codes are four
   letters." and strip the param.
2. Token stored for that code: connect and send `resume {code, token}` first.
   `ROOM_NOT_FOUND` falls back to Join with the code filled and toast "That room
   has ended."
3. No token: Join screen, name focused, code in a locked chip with "Change".
4. `ROOM_FULL` reads "That room is full. Ask the host for a seat or start your
   own." `ALREADY_STARTED` reads "That game has already started."
5. Keep the param once seated so a refresh resumes instead of taking a seat.

Reconnect states:

| State | Visual | Input |
| --- | --- | --- |
| socket dropped | banner "Connection lost. Reconnecting..." with a 2px indeterminate bar | disabled, board hover still reads |
| back under 45s | banner clears, toast "Reconnected." | restored |
| past 45s | strip "A bot is playing your seat. Reconnect to take back control." | disabled, tooltip "Bot pilot" |
| `roomClosed` | modal "This room has closed." with "Back to title" | auto-navigate after 4s |
| version mismatch | blocking modal "Server and client versions differ. Reload the page." | blocked |

Hold a pending action in memory across a drop and resend it once, never twice.

---

## 2. Layout

Desktop 1440x900. Below the header everything is a 12px gutter grid. The board
takes 62% of the area and its frame is the brightest surface on screen.

```
+------------------------------------------------------------------------------+
| Days of Lorac   Turn 7, your move     Race to 14   Sound Rules  Leave        |
+-----------+-----------------------------------------------+------------------+
| LEDGER    | +-------------------------------------------+ | MARKET 1 buy/turn|
|           | | [dice]                 [log line]         | | +--------------+ |
| +-------+ | |                                           | | | Fleet     x3 | |
| | YOU 7 | | |            o o o                          | | +--------------+ |
| | /14   | | |          o o o o                          | | +--------------+ |
| +-------+ | |        o o o o o    BOARD SVG             | | | Quay      x8 | |
| +-------+ | |          o o o o      [ports]             | | +--------------+ |
| | Maren | | |            o o o                          | | | Salvage   7  | |
| | 5/14  | | |                                           | | | WWW wood Buy | |
| +-------+ | +-------------------------------------------+ | | Rope      6  | |
| +-------+ | +-------------------------------------------+ | | WWW wood Buy | |
| | Kell  | | | No affordable build or purchase.          | | | Foundry   6  | |
| +-------+ | |           Trade  Buy  End turn            | | | BBB brick Buy| |
| +-------+ | +-------------------------------------------+ | ...              |
| | Bot   | | +-------------------------------------------+ |                  |
| +-------+ | |  [] [] [] [] []   hand fan                | |                  |
|           | +-------------------------------------------+ |                  |
+-----------+-----------------------------------------------+------------------+
```

| Region | 1440x900 | 1024x768 |
| --- | --- | --- |
| header | 1440 x 56 | 1024 x 52 |
| left rail | 248 x 844 | seat ribbon 1024 x 76 |
| center column | 888 x 844 | 1008 x 640 |
| board frame | 872 x 520 inside 8px gutters | 1008 x 388 |
| action bar | 872 x 64 | 1008 x 60 |
| hand dock | 872 x 236 | 1008 x 168 |
| right rail | 304 x 844 | drawer 380 x 716, closed |

Collapses on tablet, in order:

1. Ledger becomes a ribbon of four 236x64 chips under the header, keeping seat
   coin, name, `7/14`, the five resource counts, and one badge slot. Tap
   expands the full panel over the rail slot, tap again closes.
2. Right rail becomes a drawer over the board with a 42% ink scrim, opened by
   "Buy card", the market tab, or the trade tab. Closed by scrim, Esc, or the
   chevron.
3. Hand cards go from 152x212 to 132x184 with the truncation rule in section 5.
4. Port tags drop the ship ornament and keep icon plus rate.
5. Header drops the wordmark text, keeps the seal as a home button, moves
   "Rules" into an overflow menu.
6. Card inspector becomes a 300px sheet at the drawer edge instead of a rail
   takeover.

Never collapse: board, prompt line, VP target chip, your own hand.

---

## 3. Visual language

Palette. Extends the values already in `src/client/styles.css`, do not fork.

```
sea-900 #0b1a15   sea-800 #0f241d   sea-700 #143026   sea-500 #2c6a5a
sea-300 #8fc0a9   parchment-100 #f6edd8   parchment-200 #ece0c4
parchment-300 #ddcda7   ink-900 #241d12   ink-700 #4a3d28   ink-500 #6f6047
gold-300 #e8cf98   gold-400 #c9a75f   gold-600 #a07f3d
wood #3f5d3a   brick #8c4a34   sheep #7d8f56   wheat #b58a3c   ore #5d626b
desert #c9b287   error #9a3f2c   ok #3f7a52
p1 #b8452f guild red   p2 #2f6f8f harbor blue   p3 #c9992f brass
p4 #6b4b8a woad violet
```

Sea is every ground, parchment is every panel and card, ink is text, brass is
every border. Gold-300 is reserved for focus and awards. Resource colors fill
hexes, cost pips, and market row bars. Player colors fill pieces, seat coins,
and panel edges, never text.

Type, system stacks only:

```css
--serif: ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
--sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

Serif for wordmark, panel titles, card names, story copy. Sans for buttons,
numbers, counters, badges, table cells. Mono for room codes and the log. All
numerals `font-variant-numeric: tabular-nums`. Floor is 11px, wordmark excepted.

Texture recipes, CSS only:

| Surface | Recipe |
| --- | --- |
| page | radial `#1f4a3c` at 50% -10% over `linear-gradient(160deg,#0f241d,#0b1a15 60%,#08130f)`, plus 48px chart grid at 16% with a radial mask |
| board mat | `--sea-800` with `repeating-linear-gradient(45deg, rgba(143,192,169,.05) 0 1px, transparent 1px 7px)` |
| parchment | warm radial top, brass radial at 90% 110% at 22%, `linear-gradient(168deg,#f6edd8,#ece0c4 55%,#ddcda7)` |
| ledger ruling | `repeating-linear-gradient(0deg, transparent 0 23px, rgba(74,61,40,.12) 23px 24px)` |
| rope rule | `repeating-linear-gradient(90deg,#a07f3d 0 3px, transparent 3px 7px)` at 40%, 2px tall |
| brass bevel | `inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(74,61,40,.28)` |
| wax seal | 40px circle, `radial-gradient(circle at 35% 30%,#9a3f2c,#6d2a1d)`, 1px `#3a1710` ring |

Borders and shadows: panels get 1px gold-400 at 70% plus a 1px inner hairline
5px inset, radius 4px. Cards get radius 6px, 1px gold-600, inner hairline at
4px inset, `0 10px 20px -12px rgba(0,0,0,.75)`. Buttons get radius 3px, primary
on a sea gradient with a brass border, secondary parchment. No blur over 24px,
no colored glow except focus rings and award seals.

Icons: one 24x24 viewBox, 1.6px stroke, round caps, at most one filled shape.
Resources read by silhouette at 14px: wood is a split log with end rings, brick
a 2:1 block with an offset mortar line, sheep a head-and-back profile with a
curl, wheat three tied stalks, ore a faceted rock with two facets, desert a dune
arc with a sun dot. Costs always render pips plus icon, never a bare numeral.

---

## 4. Board rendering

All geometry comes from `GameView.board`. Hexes carry `x, y, vertices, edges`,
vertices carry `x, y`, edges carry `a, b`, ports carry `x, y`. Do not re-derive
topology.

Pointy-top math, one value per board:

```
S = median over hexes of hypot(vertex.x - hex.x, vertex.y - hex.y)
hexPath(cx, cy): i in 0..5, a = (-90 + 60*i) * PI/180
                 point = (cx + S*cos(a), cy + S*sin(a))
```

Cache `S` in a `useMemo` keyed on `gameId`. Everything else is a multiple of it:

| Element | Size |
| --- | --- |
| hex fill | `S` circumradius, 1.5px gold-400 at 30%, inner shade path at `0.86*S` |
| number token | disc `0.30*S`, parchment-100, 1.2px gold-600 |
| token pips | dots `0.028*S`, one centred row under the numeral |
| road | `a` to `b`, inset `0.05` of the edge at each end, width `0.14*S` |
| settlement | `0.46*S` wide, `0.40*S` tall, base on the vertex |
| city | `0.60*S` wide, `0.52*S` tall, two crenellations |
| robber | `0.52*S` tall hooded marker, 2px parchment eye slit |
| port tag | `0.86*S` x `0.30*S`, centred on `port.x, port.y` |
| hit target | vertex circle `0.30*S`, edge capsule `0.16*S`, minimum 44px |

viewBox: union of every vertex and port-tag box, padded `0.75*S`, rounded to
integers, `preserveAspectRatio="xMidYMid meet"`, recomputed only when the board
object identity changes. The SVG is 100% inside the board frame, no fixed px.

Layer order: sea mat, port tags and rope lines, hex fills, terrain icons, number
tokens, roads, robber, buildings, legal highlights, hover ring, dice tray.

Terrain icons sit at `0.5*S` tall in the hex's lower third, single color at 78%,
raised `0.12*S` when a token is present. Built from primitives: wood is two
1.2px trunk lines with two canopy triangles, brick three stacked rounded rects
at 2:1, sheep one ellipse body plus a circle head and two leg lines, wheat three
vertical lines with leaf ticks and a band, ore one pentagon with two facet lines,
desert one dune arc plus a circle sun. Six shapes, six silhouettes, no drawing.

Number tokens: numeral at `0.34*S`, sans 700, ink-900, pips `6 - abs(7 - n)`.
Emphasis for 6 and 8: 2px gold-600 outer ring, 1px error inner ring, numeral at
`0.36*S`, error-colored pips. Others are weight 600 with ink-700 pips.

Ports: parchment tag with the resource icon and rate, "2" plus icon or "3:1" in
sans 10px. Owned ports fill parchment-300 with a 2px gold-300 border and a 1px
seat dot. Tooltip: "Wheat port. 2 wheat for 1 of anything. You own this port."
or "You do not own this port."

Robber: hooded marker at `hex.x, hex.y - 0.10*S`. Its hex gets a hatch overlay
`repeating-linear-gradient(45deg, rgba(36,29,18,.30) 0 3px, transparent 3px 7px)`
and terrain at 35%. Drift `translateY` 0 to -3px, 4s, infinite.

Roads stroke `--pN` over a 3px ink-900 casing at 45% so they read on any
terrain. Patterns double as the color-blind cue:

| Seat | Road | Building |
| --- | --- | --- |
| 1 | solid | square tower, anchor notch |
| 2 | center stripe `14 4` parchment-100 at 55% | round tower, wave band |
| 3 | double line, 2px parchment gap | octagon, coin dot |
| 4 | center stripe `3 6` | tall tower, diamond notch |

Settlements are a tower silhouette in `--pN`, 1.5px ink outline, 1px parchment
highlight on the left edge. Cities add crenellations and a 1px gold-300 band.
Both carry a 2px `rgba(0,0,0,.35)` shadow.

Legal placement highlights:

| Target | Rest | Hover | Selected |
| --- | --- | --- | --- |
| setup vertex | ring `0.24*S` gold-300 70%, pulse 1.6s | fill 30%, ring 100% | 2.4px ring, 4 corner brackets |
| road edge | dashed `0.13*S` gold-300 60%, dashoffset 1.4s linear infinite | solid with a 1px parchment core | double outline |
| settlement vertex | ring 70% | fill 30% | brackets |
| city vertex | gold chevron over the owned settlement | chevron fills | brackets |
| robber hex | hatch plus 1.6px gold ring on legal hexes | 3px ring, victims show in the bar | 3px p3 ring |

Setup veils the board with 10% ink and lifts only legal vertices above it.
Selection is single everywhere. Esc or a second click clears it.

Tooltips: one shared layer, 120ms delay, 260px max, parchment-100, brass 1px,
6px radius, 12px offset with edge flipping, pointer-events none.

| Target | Text |
| --- | --- |
| hex | "Wood, 5. Pays 4 of 36. You have no buildings here." or "Robber blocks this hex." |
| vertex | "Empty corner. Touches Wood 5, Ore 8, Sheep 10. 13 of 36. Too close to Kell's settlement." |
| building | "Maren's city. Pays 2 on Wheat 8 and Ore 4. 15 of 36." |
| edge | "Your road. Route length 6." or "Empty edge. Touches your road at the east end." |

Dice tray: 96x56 parchment slab top left of the board frame, two 22px dice with
drawn pips, total badge in sans 13px.

Production must be loud because the robber is easy to miss. Paying hexes flash
their token 180ms gold. Paying buildings float a "+1 wood" token, 220ms rise,
400ms fade, 60ms stagger per player. Blocked hexes flash the hatch with a "-"
token in error, and the log reads "The robber blocked C2 (3, ore)."

---

## 5. Hand

Hand dock is a parchment shelf with a 1px brass top rule and an 18px ink shadow
cast upward. Cards fan inside it like filed ledger cards.

Card face, 152x212 desktop, 132x184 tablet:

```
+------------------------------+
| Salvage Yard       W W W     |  name 13.5px serif, ellipsis, cost pips right
+------------------------------+
|          hex icon            |  46px hex plate, resource tint 18%
|  Gain 2 Brick and 1 Ore.     |  11.5px/1.4 ink-700, max 4 lines
|  ~ rope rule ~               |  9.5px italic ink-500, max 2 lines
|  Salt-eaten timber, still    |
|  worth the walk.             |
+------------------------------+
| ECONOMY           seal 2     |  tag 8.5px caps, VP seal if any
+------------------------------+
```

The name is `CardDef.name` verbatim, one line, ellipsis, never wrapped. Cost
shows `n` pips in the resource color plus a 10px icon. Charters show a grouped
multiset in sans 10px. Starting cards show a blank ruled line. The icon plate is
a 46px pointy-top hex at 1.4px gold-600 filled with the card's primary resource
at 18%. Rules text is `CardDef.text` word for word, `text-wrap: pretty`. Flavor
is `CardDef.flavor`; charters use "Counts from the moment you buy it." The
footer shows the first tag in caps at 8.5px with `.14em` tracking, and VP cards
get an 18px wax seal reading "1" or "2".

Fan math, `n` cards, dock width `W`:

```
step = clamp(72, (W - 152) / max(1, n - 1), 132)
x_i  = center + (i - (n-1)/2) * step
rot  = clamp((i - (n-1)/2) * 3.5deg, -10deg, 10deg)
y    = abs(i - (n-1)/2)^1.4 * 5px,  z = 10 + i
```

Five cards at `W=872` use step 132 and span 680px. Draw effects can push the
hand to nine, where the same formula compresses to step 88 and keeps each card's
left 88px clickable. Past nine, a "Spread" toggle switches to a scrolling row.

Interaction:

- Hover unrotates to 0, lifts `-14px`, `scale(1.06)`, z 500, 180ms
  `cubic-bezier(.2,.8,.2,1)`. Neighbors do not move.
- The dock's top edge sits 8px below the board frame's bottom rule with 18px of
  top padding, so a lifted card enters at most 6px of that gap and never covers
  a hex.
- Click or focus pins the card in the left rail inspector at 208x292 with full
  text, flavor, and a "Play card" button. The rail slot swaps from ledger to
  inspector. The board is untouched, always.
- Playable cards get a 2px gold-300 bottom edge, pointer cursor, and
  `aria-label` "Play Salvage Yard, gain 2 Brick and 1 Ore". Cards needing input
  get a 16px gold hex badge reading "?" with tooltip "Pick a target after you
  play this".
- Unplayable cards, meaning charters or any card outside your action phase, get
  `filter: saturate(.4) opacity(.72)` and no bottom edge. Charter tooltip:
  "Deed. Stays in your deck and scores from purchase. Nothing happens when
  played."
- Play with a click, `1` to `9`, or Space on focus. The card animates to the
  play area strip, a 40px row of 96x40 stubs along the dock's top left. Cards
  needing a choice open the targeting flow in section 9 and wait.
- Duplicate `defId` in hand shows an `x2` disc top right in sans 10px.

At 1024: card 132x184, name 12.5px, body 11px over 3 lines, flavor moved to the
inspector, cost pips 12px. Truncation adds the tooltip "Open the inspector for
the full text". Nothing renders below 11px.

---

## 6. Market

Right rail, tab "Market", default. Header shows the title plus a chip:

| State | Chip |
| --- | --- |
| purchase available | "1 purchase per turn" |
| purchase used | "Purchase used" with a filled gold dot |
| not your turn | "Waiting on Maren" |

Charters sit above the piles because they are the VP clock. Two 140x104 tiles
side by side on parchment-300:

```
+----------------+----------------+
| Fleet Charter  | Quay Deed      |
| 2 VP      x3   | 1 VP      x8   |
| 3W 3H 2B       | 1 of each      |
|         [Buy]  |         [Buy]  |
+----------------+----------------+
```

Resource initials appear in diagrams only: W wood, B brick, S sheep, H wheat, O
ore. On screen they are always the icons from section 3.

Pile rows, 92px tall, separated by rope rules:

```
+-----------------------------------------+
| Salvage Yard                    7 left  |  <- 3px bar in the resource color
| WWW wood        Gain 2 Brick, 1 Ore     |  <- cost pips, effect clamped to 2 lines
| [3 wood]                          [Buy] |  <- missing pips hollow with a warning ring
+-----------------------------------------+
```

Name is sans 13px 600 ink-900. Stock reads "6 left" in sans 11px ink-500, and at
one or two copies switches to error weight 700 with a dot. Cost is pips plus
resource name. Effect is the first clause of `CardDef.text`, clamped to 2 lines.

Disabled reasons, as both `title` and an `aria-describedby` line:

| Condition | Button | Reason |
| --- | --- | --- |
| affordable, stocked, unused | enabled | none |
| missing resources | disabled | "Need 1 more Brick." or "Need 2 more Wood and 1 more Brick." |
| stock zero | disabled, row 56px and desaturated | "Sold out. Empty piles stay empty." |
| purchase used | disabled | "One purchase per turn. Yours is spent." |
| wrong phase | disabled | "You can only buy during your action phase." |

Sold-out rows collapse to one struck-through line with "Sold out" at the right,
and stay in place so the market does not jump.

Confirmation is inline under the clicked row, not a modal:

```
Buy Salvage Yard for 3 Wood?
Goes straight to your discard. You cannot play it this turn.
[Buy card]  [Cancel]
```

Charter confirmation adds "Adds 1 victory point to your total right now, and
stays in your deck forever."

After a purchase the stock flips down over 300ms, the card becomes a 96x40 stub
labelled "bought" in the play area strip, the chip flips to "Purchase used",
every Buy disables, and a toast reads "Salvage Yard bought. It goes to your
discard." Emptying a pile appends "That pile is now empty."

Never render a Buy that is absent from `legal.buyable`. If `buyable` is empty
and the purchase is unused, the header shows one line: "Nothing here is
affordable yet. You need 2 resource types within reach."

---

## 7. Player panels

Left rail, seat order top to bottom, 224x168 each with an 8px gap. Your panel is
marked, not moved.

```
+--------------------------------+
|(1) YOU         7/14 [####---]  |
|2 settlements  1 city           |
|1 charter      route +2         |
|W2 B1 S0 H3 O1                  |
|renown 3/3     charters 2       |
|deck 6 dsc 3 hand 5 play 2      |
+--------------------------------+
```

1. Seat coin, 24px circle in `--pN` with the numeral and the seat silhouette
   mark. Your panel adds a 32px "You" tag on the top edge.
2. Name, sans 13px 600, clamped to 12 characters, full name in tooltip.
3. Badges, 16px caps: `BOT` in sea-300, `OFFLINE` in error with a dashed
   border, `BOT PILOT` in p3 dashed, `HOST` in gold-400, lobby only.
4. VP `7/14` at 20px 700 plus a target-segment meter (14 with four players), filled in `--pN`, the target
   segment in gold-300, empty at ink-500 30%. Tooltip "7 of 14 victory points."
5. Breakdown chips, nonzero only, read from `vpBreakdown`: "2 settlements",
   "1 city", "2 charters", "route +2", "expedition +2". Chip tooltip lists all
   five sources with point values. Never recompute VP.
6. Resources: five 40x26 cells, icon plus count in sans 12px tabular. Zero
   renders at 40% icon opacity, never hidden, so the grid does not reflow. Cell
   tooltip "Wood 2. You produce 4 of 36 on wood."
7. Renown `3/3`, the second number from `LARGEST_EXPEDITION_MIN`, with a gold
   left tick at the threshold. Charter count beside it.
8. Deck line in mono 10.5px: `deck 6 · discard 3 · hand 5 · play 2`. Tooltip
   "Deck and discard counts are public. Their contents are not."
9. Award pennants: a 14px gold pennant beside route, a compass beside
   expedition, stamped over 240ms on change.

Current turn: the active panel gets a 3px gold-400 left edge, a gold-300 inner
hairline, a 14% warm wash, and a corner pennant. Others drop to 90%. The header
also names the active player, so turn state is never color-only.

Target VP lives in three places, all from `view.targetVp`: the header chip
"Race to 14", each panel's `6/14`, and the game over sheet. Never hardcode.

---

## 8. Action bar

64px strip between board and hand. Left 60% is the prompt, right 40% is a right
aligned button cluster. Primary is the sea gradient, others parchment. Never
more than three buttons.

| State | Prompt | Buttons |
| --- | --- | --- |
| setup settlement | "Place your first settlement. Pick a corner." | none |
| setup road | "Place a road touching your new settlement." | none |
| roll | "Roll for production." | "Roll 2d6" |
| discard, you owe | "Discard 5 resources before play continues." | "Discard 5" |
| discard, other owes | "Maren is discarding 4 resources." | none |
| robber move | "Move the robber to another hex." | "Move robber", disabled until picked |
| robber steal | "Choose who to steal from." | "Steal 1", plus "Skip steal" when no victims |
| robber, waiting | "Maren is moving the robber." | none |
| action, free | "Play cards, build, trade, or buy one card." | "Trade" "Buy" "End turn" |
| action, bought | "One purchase per turn, and you have used it." | "Trade" "End turn" |
| action, empty | "No affordable build or purchase. Ending turn." | "End turn", pulsing at 800ms |
| action, hand out | "Hand played. Build, trade, or end the turn." | "Trade" "Buy" "End turn" |
| targeting a road | "Choose an edge for the free road." | "Cancel card" |
| targeting a vertex | "Choose a corner for the free settlement." | "Cancel card" |
| targeting a hex | "Choose a hex for the robber." | "Skip the move" plus "Cancel card" |
| Provisioner open | "Choose 2 resources. Repeats are allowed." | "Gain 2 resources", disabled until 2 |
| action, waiting | "Waiting on Kell to end their turn." | none |
| incoming offer | "Kell offers 2 Wood for 1 Ore." | "Accept" "Decline" |
| offer open | "Offer open. Waiting on 2 players." | "Cancel offer" |
| game over | "Maren wins at 14 points." | "See the result" |

The empty state fires exactly when `legal.playable` is empty, `legal.buyable` is
empty, all three `build.affordable` flags are false, and `bankTrades` is empty.
Show the sentence, pulse "End turn" at 800ms, never auto-end. The player owns
the last click.

An 11px ink-500 subline appears only when useful: "Bank 4:1", "Wood port
2:1", or "9 resources held, discard risk at a 7".

Toasts, bottom centre above the dock, 320x48, error left bar, 4s, dismiss on
click, max two at once. One line per code:

```
NOT_YOUR_TURN     Not your turn yet.
WRONG_PHASE       You cannot do that right now.
CANNOT_AFFORD     Not enough resources for that.
PILE_EMPTY        That pile is empty.
PURCHASE_LIMIT    One purchase per turn.
OCCUPIED          Something is already there.
TOO_CLOSE         Too close to another building. Leave one corner between them.
NOT_CONNECTED     Connect it to your own road first.
INVALID_PLACEMENT That spot does not follow the placement rules.
ROBBER_SAME_HEX   The robber has to move somewhere else.
TRADE_STALE       That trade is no longer possible. Nothing was exchanged.
CHOICE_REQUIRED   Pick a target for this card first.
RATE_LIMITED      Slow down a moment.
ROOM_NOT_FOUND    No room with that code.
ROOM_FULL         That room is full.
SERVER_ERROR      The server had a problem. Try that again.
```

---

## 9. Modals and targeting

Two shapes only. A modal is a centred parchment sheet on a 46% sea-900 scrim,
6px radius, max 480px, focus trapped. Board targeting uses the board plus the
action bar, never a modal.

| Flow | Shape | Default focus | Confirm | Esc | Cancel |
| --- | --- | --- | --- | --- | --- |
| Discard half | modal 420, five stepper rows, header "Discard 5" | first nonzero resource | "Discard 5", disabled until exact | shakes the counter 300ms | none, mandatory |
| Robber hex | board rings, hatch on the current hex | leader's top-pip hex | step 2 | clears the pick | not allowed |
| Robber victim, Wrecker's Lamp victim | 44px victim chips in the action bar with names and counts | first victim | "Steal 1" | clears the victim | "Skip steal" only when none qualify |
| Provisioner | modal 360, five minus/plus rows, "2 of 2" counter | lowest owned resource | "Gain 2 resources" | offers "Resolve as 2 Wood?" | fallback as 2 Wood, per the engine |
| Wrecker's Lamp hex | board rings plus "Skip the move" | leader's best hex | step 2 | skips the move, keeps renown | allowed |
| Guild Mason road | board rings, banner "Free road from Guild Mason" | none | click commits | cancels, card stays in hand | allowed before commit |
| Shipwright's Yard | board rings, banner "Free settlement from Shipwright's Yard" | none | click commits | same | allowed before commit |
| Trade builder | rail tab "Trade", replaces the market | give grid | "Offer to all" | closes the tab | "Cancel" |
| Incoming offer | banner across the board plus a Trade tab badge | "Accept" | "Accept" | decline prompt | "Decline" |
| Rules | sheet 720, two columns, section headings | close | none | closes | close |
| Game over | sheet 640 | "Play again" | none | nothing | "Back to title" |

Trade tab: two five-cell grids, "You give" and "You want", each a resource icon
with a stepper. The header shows "Bank rate on wood: 2:1". Footer buttons "Offer
to all" and "Cancel". An open offer replaces the grids with its summary and
"Cancel offer". Bank trades live below under "Bank and ports", one row per
`legal.bankTrades` entry reading "2 wood for 1 [icon]" with a "Trade" button.
Log tab: mono 11px lines from `view.log`, newest first, capped at 40, a seat dot
per entry, and filter chips All / Builds / Cards / Rolls.

Game over sheet: seal, "Maren wins at 14 points", then a table with Place, Name,
VP, Settlements, Cities, Charters, Route, Expedition, non-winners struck. Below
it a three-line digest from `view.log` filtered to `buy`, `award`, `win`. Hosts
get "Play again" and "Change setup", guests get "Waiting for the host".

Keyboard: Esc closes what is cancellable, Tab cycles inside, Enter confirms. In
board targeting, Tab and Shift+Tab cycle legal targets in board order, Enter
commits, Esc cancels, arrow keys nudge between adjacent legal targets.

---

## 10. Motion and sound

Transform, opacity, and filter only. No layout animation, no JS frame loops.
Nothing runs past 900ms and nothing delays input.

| Moment | Animation | Timing |
| --- | --- | --- |
| dice | 3 bounces, 720deg, landing on face | 620ms `cubic-bezier(.2,.8,.2,1)` |
| total badge | scale .8 to 1 with fade | 180ms ease-out |
| production token | rises 18px and fades, 60ms per-player stagger | 400ms ease-out |
| road | `stroke-dashoffset` draw from the source end | 260ms ease-out |
| settlement | scale .7 to 1, 4% overshoot | 200ms `cubic-bezier(.3,1.4,.5,1)` |
| city | cross-fade from settlement, gold band sweeps | 220ms ease-out |
| card played | lift, slide to the play area, shrink to a stub | 240ms ease-out |
| card drawn | stub slides in from the deck counter | 160ms ease-out |
| purchase | card flips 180deg into a discard stub | 300ms ease-in-out |
| award change | seal stamps 1.6 to 1 with a 1px shake, panel edge flashes gold | 240ms |
| turn change | pennant slides, active edge grows | 180ms ease-out |
| victory | board dims to 60%, seal stamps, banner rises 24px | 900ms, staged 0 / 240 / 500 |
| toast | slide up 8px and fade | 160ms ease-out |

Sound is off until the first gesture. WebAudio only, no files: an 8ms filtered
noise click for buttons, two square blips plus a noise tail for the roll, a
70Hz sine thud for placement, a descending two-note pair for a rejected action,
a bell dyad for awards and wins. Header toggle "Sound on" / "Sound off",
persisted at `localStorage.lorac.sound`, default on.

Never play: tab hidden; bot actions under 120ms apart; the same cue twice within
60ms; a toast from a button the player could see was disabled; before the socket
connects.

Reduced motion: dice snap with a 120ms cross-fade, production tokens fade only,
the robber stops drifting, pulses stop, card slides become 100ms fades, victory
becomes one 200ms fade. No information is carried by motion alone.

---

## 11. Accessibility

Contrast: text on parchment at least 7:1, ink-500 on parchment-200 at 5.1:1 as
the floor, text on sea at least 7:1, icons and piece outlines at 3:1 against
their hex. Brass hairlines are decoration and never the only boundary. Seat
colors are never the only identifier, see the road and building patterns in
section 4.

Resource color-blind plan: distinct silhouettes at 14px, cost as pips plus icon,
counts as icon plus numeral, terrain icons in every hex, and a "Letter labels"
setting adding W / B / S / H / O at 10px under each icon. The palette also
differs in lightness, not hue alone: wood 32%, brick 36%, sheep 52%, wheat 58%,
ore 38%.

Focus: 2px gold-300 outline, 2px offset, plus a 1px ink-900 contrast ring, on
both parchment and sea. Focus never moves on its own except into a new modal. A
"Jump to my hand" skip link leads the tab order. Shortcuts:

```
R roll 2d6        E end turn        B buy, opens the drawer on tablet
T trade tab       1-9 play or pin the nth card    Space play or confirm focus
Tab Shift+Tab cycle targets       Esc cancel targeting or close a modal
? rules           M mute            L ship's log
```
All shortcuts are ignored while a text field has focus.

Screen readers: the SVG stays `role="img"` with an `aria-live="polite"` summary
such as "Turn 7. Maren produced 3 resources. You hold 4 wood, 2 brick, 1 sheep, 2
wheat, 3 ore." Whenever targeting is active a "List legal placements" button
renders the legal targets as real buttons in board order, using the same text as
the tooltips. This is the accessible path to placement and ships in v1.

Touch: buttons, steppers, and cards are 44x44 including padding. Board targets
get an invisible `max(22px, 0.30*S)` radius hit circle. Cards hit-test their
whole unclipped face. Every tooltip also opens on tap, so nothing is hover-only.

At 1024: 11px minimum, 3 lines of card text, 20px VP numbers, 13px names, 12px
resource counts. Any label sitting on the sea gets a 1px parchment plate.

---

## 12. Component tree and build order

```
App
├─ SocketProvider        net/socket.ts, net/useGame.ts
├─ ScreenRouter          ?room, stored token, screen state
│  ├─ TitleScreen  SoloSetup  JoinScreen  LobbyScreen
│  ├─ GameScreen
│  │  ├─ Header          wordmark, turn chip, target, sound, rules, leave
│  │  ├─ BoardFrame
│  │  │  ├─ DiceTray
│  │  │  ├─ BoardSvg → PortLayer, HexLayer, RoadLayer, RobberLayer,
│  │  │  │             BuildingLayer, TargetLayer
│  │  │  └─ TooltipLayer
│  │  ├─ ActionBar → PromptLine, VictimChips, ButtonCluster
│  │  ├─ HandDock → PlayAreaStrip, CardFace x n, DrawCounters
│  │  ├─ LedgerRail → PlayerPanel x n, CardInspector
│  │  ├─ SupplyRail → MarketTab, TradeTab, LogTab
│  │  ├─ SeatRibbon  tablet only
│  │  └─ Toasts
│  ├─ GameOverSheet
│  └─ RulesSheet
└─ ui/  Button, Modal, Stepper, SeatCoin, ResourceIcon, Toast, Tooltip
```

Directory split: `App.tsx`, `net/`, `screens/`, `board/`, `hand/`, `market/`,
`trade/`, `players/`, `action/`, `modals/`, `ui/`, `sound/audio.ts`, and
`styles/{tokens,base,board,hand,market,ledger,modals}.css`. One component per
file named in the tree above, plus `board/geometry.ts` for `S`, the hex path,
and the viewBox, and `board/icons.tsx` for terrain, resource, and seat marks.

Build order, playable loop first:

1. `net/socket.ts` and `useGame.ts`: connect, `welcome`, `quickPlay`, hold the
   `game` view, reconnect with `resume`. Dump raw view JSON, no styling.
2. `styles/tokens.css` and `base.css`: palette, type, button, panel, focus ring.
3. `BoardSvg`: hexes, tokens, ports, roads, buildings, robber, viewBox math,
   read only. If the board is wrong nothing else matters.
4. `ActionBar` and `PromptLine` for setup, roll, end turn. Setup placements
   through `TargetLayer`.
5. `HandDock` and `CardFace`, no-choice cards only, play area strip, deck and
   discard counters.
6. `LedgerRail` and `PlayerPanel`.
7. `MarketTab` with purchase confirmation and the purchase-used chip.
8. Robber flow, discard modal, bank trades.
9. Player trade offer and incoming offer.
10. Provisioner, Wrecker's Lamp, Guild Mason, Shipwright's Yard.
11. Lobby, join by code, `?room`, reconnect banners, bot pilot strip.
12. Game over, rematch, rules sheet.
13. Motion pass, sound pass, tablet layout, accessibility list mode.

---

## 13. Do not build

- No card art beyond the hex icon plate. No portraits, no illustrations.
- No drag and drop cards. Click or key to play.
- No deck browsing. Deck order and contents are hidden from everyone, including
  the owner. Showing them breaks the rules.
- No in-game chat. Lobby chat only, 3 lines, no unread badge.
- No spectate, replay, undo, or takebacks.
- No stats, profiles, or history. Persist only the seat token, display name, and
  the sound toggle.
- No counter-offers, no offer to a single player, no trade chat.
- No portrait phone layout. Tablet landscape 1024 is the floor.
- No extra modals. Four choice cards, one rules sheet, one discard sheet, one
  purchase confirm, one game over sheet is the whole budget.
- No auto-play, no auto-end turn, no hints, no confirm on a card play that needs
  no input.
- No particles, parallax, blurred glass, or pill buttons.
- No client-side rules inference. If `legal` does not say it, no button exists.

---

## 14. Phone (added after the first device test)

The desktop and tablet layouts above still hold. Phones get one extra
breakpoint at `max-width: 640px`, plus a short-viewport guard at
`max-height: 520px` for landscape.

- The center column must declare `grid-template-columns: minmax(0, 1fr)`.
  Without it the seat ribbon's max-content width widens the grid and pushes
  the board off the right edge, which is exactly what happened on iOS Safari
  before this fix.
- Header swaps long labels for `T3 · you`, `to 14`, `Aa`, `Snd`, `Rules`,
  `Leave`. Room code is hidden; it stays in the lobby and share link.
- Seat ribbon becomes a horizontal scroll row of 148px chips. Four chips do
  not fit on a 320 to 430px screen, and that is fine.
- Hand becomes a scrolling row of 110x126 cards. The fan needs more width than
  a phone has, and clipped cards were worse than a row. The spread toggle is
  hidden on phones because the row is always on. Card faces keep the name,
  cost, hex plate, rules text, and tag; flavor is hidden.
- Board frame keeps the full island. At 390px the SVG is 368x490; at 320px it
  is 298 wide. No horizontal scrolling anywhere.
- Short landscape hides the seat ribbon and the play-area strip, shrinks the
  hand to 92x104 cards, and gives the board whatever height remains. It is
  playable, not pretty. Portrait is the supported phone orientation.
- `100dvh`, `viewport-fit=cover`, safe-area padding on the header and hand
  dock, `touch-action: manipulation` on controls, `overscroll-behavior: none`.

Measured after the fix: 320x568, 360x800, 375x667, 390x844, 430x932 all report
`document.scrollWidth === window.innerWidth` and a board that ends inside the
viewport.

### Market resource strip (added after playtesting)

The market and trade panels carry a sticky copy of the viewer's five resource
counts and their total against the 9-resource limit. It pins under the rail
tabs while the list scrolls, turns warm when over the limit, and hides the long
label on phones. The panel no longer depends on the player ledger being on
screen, which matters most on a phone where the rail is a full-width drawer.
Waiting players also get a Market button in the action bar on narrow layouts,
so the drawer can be opened before their turn.
