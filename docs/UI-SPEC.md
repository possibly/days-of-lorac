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
 '-- #code=CODE --> Join, code prefilled
 '-- otherwise ---> Title

Title --> Solo setup --> Game
Title --> Host a table --> Lobby --> Game
Title --> Join a table --> Lobby --> Game

Game --> Game over --+-- Play again --> same table, new seed
                     '-- Title
any screen --> Rules sheet, closes back where it opened
```

| Screen | Content | Primary button |
| --- | --- | --- |
| Title | wordmark, seal, tagline, solo button, peer buttons when a relay is configured, footer version | "Play vs bots" |
| Solo setup | name, seats 2/3/4, difficulty, island size, land placement, number placement, "Race to N" note | "Start game" |
| Host setup | name, max players 2/3/4, fill difficulty, island size, land placement, number placement | "Open the table" |
| Lobby (host) | seats, island picker (same three rows), join code and QR, table talk | "Start game" |
| Lobby (guest) | seats, island summary line, table talk | "Ready" |
| Join | four-letter code in caps, or scan the host's screen, then name | "Join with code" |
| Game | board, ledger, market, hand, action bar | context button |
| Game over | winner line, VP table, log digest | "Play again" |

Title also gets a text link "Rules". Multiplayer buttons are absent when the
build has no relay URL, so the same page always means solo only in that case.

`#code=CODE` behavior:

1. Open the Join screen with the code filled in.
2. A bad code reads "Codes are four letters" and leaves the field editable.
3. Joining connects to the host's tab through the relay, then seats the guest in
   the room named by the host's offer.

Connection states:

| State | Visual | Input |
| --- | --- | --- |
| channel closed | banner "Connection lost. The table is gone." | disabled |
| `roomClosed` | modal "This room has closed." with "Back to title" | auto-navigate after 4s |
| version mismatch | blocking modal "Server and client versions differ. Reload the page." | blocked |

A peer channel has no reconnect address. The session tears down and returns to
the title screen instead of retrying.

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
| left rail | 248 x 844 | Players drawer, closed |
| center column | 888 x 844 | 1008 x 640 |
| board frame | 872 x 520 inside 8px gutters | 1008 x 388 |
| action bar | 872 x 64 | 1008 x 60 |
| hand dock | 872 x 152 | 1008 x 116 |
| right rail | 304 x 844 | drawer 380 x 716, closed |

Collapses on tablet, in order:

1. Ledger rail hides. The full stat boxes move to the Players tab of the right
   drawer, opened by the Players button in the action bar. The active-player bar
   above the action bar keeps the current seat's five resource counts, route,
   and renown on screen without opening anything.
2. Right rail becomes a drawer over the board with a 42% ink scrim, opened by
   "Buy card", the market, trade, log, or Players tab. Closed by scrim, Esc, or
   the chevron.
3. Hand cards use the compact face from section 5 in a flat scrolling row, 124x70.
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
Resources read by silhouette at 14 to 18px: wood is a split log with end rings, brick
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

Terrain icons sit in a parchment badge of radius `0.2*S`, centred `0.6*S` above
the hex centre on token hexes, so the number token never covers them. The glyph
itself is `0.28*S` tall, single ink color at full opacity. On a tokenless hex the
badge sits at the centre. Built from primitives: wood is two trunk lines with two
canopy triangles, brick three stacked rounded rects at 2:1, sheep one ellipse
body plus a circle head and two leg lines, wheat three vertical lines with leaf
ticks and a band, ore one pentagon with two facet lines, desert one dune arc plus
a circle sun. Six shapes, six silhouettes, no drawing.

Number tokens: numeral at `0.34*S`, sans 700, ink-900, pips `6 - abs(7 - n)`.
Emphasis for 6 and 8: 2px gold-600 outer ring, 1px error inner ring, numeral at
`0.36*S`, error-colored pips. Others are weight 600 with ink-700 pips.

Ports: parchment tag with the resource icon and rate, "2" plus icon or "3:1" in
sans 10px. Owned ports fill parchment-300 with a 2px gold-300 border and a 1px
seat dot. Tooltip: "Wheat port. 2 wheat for 1 of anything. You own this port."
or "You do not own this port."

Robber: hooded marker at `hex.x, hex.y - 0.10*S`. Its hex gets a hatch overlay
`repeating-linear-gradient(45deg, rgba(36,29,18,.30) 0 3px, transparent 3px 7px)`
and its terrain icon dimmed to 45%. Drift `translateY` 0 to -3px, 4s, infinite.

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
| road edge | dark casing, pulsing gold halo, dashed `0.15*S` gold-300, dashoffset 1.4s linear infinite | solid with a 1px parchment core | double outline |
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
| vertex | "Touches Wood 5, Ore 8, Sheep 10. 13 of 36. Too close to Kell's settlement." |
| building | "Maren's city. Pays 2 on Wheat 8 and Ore 4. 15 of 36." |
| edge | "Your road. Route length 6." or "Empty edge. Touches your road at the east end." |

Dice tray: 96x56 parchment slab top left of the board frame, two 22px dice with
drawn pips, total badge in sans 13px.

The board bubble (`.board-talk`, top right of the frame) speaks only when
something must not be missed: "Seven. Discards, then the robber moves." and the
win line. It used to also print "6 + 3 = 9. 1 resources produced." and then echo
the newest log line, which covered the board to repeat what the dice tray,
the floats, and the ship's log already said. When it has nothing to say it is
not rendered at all.

Production must be loud because the robber is easy to miss. Paying hexes flash
their token 180ms gold. Paying buildings float a "+1 wood" token: a fast rise,
then a long readable hold with a slow drift, gone by 4.2 seconds. It used to be
900ms and that was too quick to read a board full of tokens. Floater ids carry
the roll key so the same hex paying twice remounts and replays the animation.
Blocked hexes flash the hatch with a "-" token in error, and the log reads
"The robber moves to the ore 8." Log and notification text never carries an
internal id: not `e51` for an edge, not `c12` for a corner, not `B2` for a hex.
Placements read "Pile places a starting road." and "Mara upgrades a settlement
to a city." The ids stay in the entry's `data` for tests and debugging.

---

## 5. Hand

Hand dock is a parchment shelf with a 1px brass top rule and an 18px ink shadow
cast upward. On desktop the cards fan inside it like filed ledger cards. At
1180px and below the fan is replaced by a flat scrolling row of compact cards,
so nothing tilts out of the dock or into the play strip.

Hand cards are compact slips: name, resource yield, and one short action label.
They are 152x100 on desktop, 124x70 on tablet, and 110x70 on phone, about half
the height of the original card face.

```
+------------------------------+
| Salvage Yard                 |  name 13px serif, ellipsis
+------------------------------+
| +2 [brick]  +1 [ore]         |  15px tabular count plus 15px resource icon
|                              |
+------------------------------+
```

The name is `CardDef.name` verbatim, one line, ellipsis. Gains render as `+N`
plus the resource icon, in the resource color. Non-resource effects become
short parchment labels: `Move robber`, `Free road`, `Free settlement`,
`Draw 2`, `+1 renown`, `Gain 2 resources`. Charters show `1 VP` or `2 VP`.
Price, full rules text, flavor, tag, and stamp are inspector-only. Charters
still score from purchase and still have no play affordance.

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

At 1180px and below the row is always flat and scrolls sideways, and the spread
toggle is hidden. The same summary fits: a two-line name, one gain row, and up
to two effect labels. Tablet cards are 124x70; phone cards are 110x70. Cards of
the same type carry no count marker; the deck and discard counters already say
how many copies exist.

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
  say so on the face: `Move robber`, `Free road`, or `Free settlement`.
- Unplayable cards, meaning charters or any card outside your action phase, get
  `filter: saturate(.4) opacity(.72)` and no bottom edge. Charter tooltip:
  "Deed. Stays in your deck and scores from purchase. Nothing happens when
  played."
- Play with a click, `1` to `9`, or Space on focus. The card animates to the
  play area strip, a 40px row of 96x40 stubs along the dock's top left. Cards
  needing a choice open the targeting flow in section 9 and wait.

At 1024 the compact face runs at 124x70 with a 12px name over two lines, 13px
gains, and 9px effect labels. The inspector keeps the full text, cost, and
flavor.
Nothing renders below 11px.

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
Cards that move the robber add a red "May move the robber." line under the
effect, because the first-clause clamp would otherwise hide that permission.
The confirmation repeats it.

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
marked, not moved. On tablet and phone the rail is hidden; the Players button in
the action bar opens the same panels in the supply drawer. The active-player bar
above the action bar carries that seat's resources, route, and renown, so the
drawer is not needed for turn decisions.

```
+--------------------------------+
|(1) YOU         7/14 [####---]  |
|2 settlements  1 city           |
|1 charter      route +2         |
|W2 B1 S0 H3 O1                  |
|renown 3/3 +2 VP at 3           |
|route  4/6 +2 VP at 6, Kell has 5|
|charters 1                      |
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
7. Two award tracks, one row each, both recomputed every render:
   `renown <n>/<need> +2 VP at <need>` and `route <n>/<need> +2 VP at <need>`.
   The need is `LARGEST_EXPEDITION_MIN` / `LONGEST_ROAD_MIN` while nobody holds
   the award, and the holder's number plus one once someone does, with the
   holder named: `route 4/6 +2 VP at 6 · Kell has 5`. A holder's row shows its
   own number, the pennant, and `+2 VP` in gold. Charter count sits under them.
8. Deck line in mono 10.5px: `deck 6 · discard 3 · hand 5 · play 2`. Tooltip
   "Deck and discard counts are public. Their contents are not."
9. Award pennants: a 14px gold pennant beside the award it belongs to, stamped
   over 240ms on change. The same pennants ride in the active-player strip.

Current turn: the active panel gets a 3px gold-400 left edge, a gold-300 inner
hairline, a 14% warm wash, and a corner pennant. Others drop to 90%. The header
also names the active player, so turn state is never color-only.

Target VP lives in three places, all from `view.targetVp`: the header chip
"Race to 14", each panel's `6/14`, and the game over sheet. Never hardcode.

---

## 8. Action bar

64px strip between board and hand. Left 60% is the prompt, right 40% is a right
aligned button cluster. Primary is the sea gradient, others parchment. Targeting
states keep one Cancel button. The free-action state carries five (Build, Trade,
Buy, End turn, Players), and the Build picker stacks its chips under the prompt
as a second row rather than squeezing the prompt. Players sits at the right
edge in every state and opens the Players tab of the supply drawer.

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
| action, free | none | "Build" "Trade" "Buy" "End turn" |
| action, bought | none | "Build" "Trade" "Buy" "End turn" |
| action, hand out | none | "Build" "Trade" "Buy" "End turn" |
| build picker | "Build what?" | Road, Settlement, City chips with cost pips, plus "Cancel" |
| targeting a paid build | "Choose an edge for the road." | "Cancel build" |
| targeting a road | "Choose an edge for the free road." | "Cancel card" |
| targeting a vertex | "Choose a corner for the free settlement." | "Cancel card" |
| targeting a hex | "Choose a hex for the robber." | "Skip the move" plus "Cancel card" |
| Provisioner open | "Choose 2 resources. Repeats are allowed." | "Gain 2 resources" disabled until 2, plus "Cancel" |
| action, waiting | "Waiting on Kell to end their turn." | none |
| incoming offer | "Kell offers 2 Wood for 1 Ore." | "Accept" "Decline" |
| offer open | "Offer open. Waiting on 2 players." | "Cancel offer" |
| game over | "Maren wins at 14 points." | "See the result" |

Building starts here, not on the board. "Build" opens the picker, the picker
sets the targeting mode, and the board rings the legal edges or corners. The
tap that lands on a ring pays and places; nothing is charged before that, so
"Cancel build" is free. A chip is enabled only when `legal.build.affordable`
says you can pay and the matching `roads`/`settlements`/`cities` list is not
empty, and the disabled chip says which of the two failed.

The free state carries no prompt at all. "Play cards, build, trade, or buy one
card." restated the four buttons sitting next to it and cost a line of the
board on a phone. The subline stays, because "Bank 4:1" and "9 resources held,
discard risk at a 7" are news. Anything with actual state still gets a line:
purchase used, nothing affordable, hand played.

There is no distinct empty state any more. "No affordable build or purchase.
Ending turn." plus a pulsing End turn told the player their turn was over and
took Build, Trade, and Buy away while it did it. The button set is now identical
in every action-phase state, and the player decides when to end their turn.
Never auto-end either way.

No prompt and no subline. The action phase bar is a right-aligned button
cluster and nothing else, 50px on a phone instead of 78. Everything it used to
say lives where the state already shows: the market chip reads "Purchase used",
the trade screen carries the port and bank rates, and the market's resource
strip shows the held total against the 9 limit and turns warm when over it.

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
| Provisioner | modal 360, five minus/plus rows, "2 of 2" counter | lowest owned resource | "Gain 2 resources" | "Cancel" keeps the card in hand | allowed: Esc, the backdrop, the close button, and Cancel all back out |
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
| card drawn | new hand cards slide in from the deck counter, 55ms stagger | 320ms ease-out |
| end of turn | played cards and any charters in hand fly to the discard counter, 42ms stagger; kept cards stay in hand | 380ms ease-out |
| reshuffle | discard counter ticks over, "shuffled" tag for 1.1s, paper riffle cue | 900ms |
| purchase | card flips 180deg into a discard stub | 300ms ease-in-out |
| award change | seal stamps 1.6 to 1 with a 1px shake, panel edge flashes gold | 240ms |
| turn change | pennant slides, active edge grows | 180ms ease-out |
| victory | board dims to 60%, seal stamps, banner rises 24px | 900ms, staged 0 / 240 / 500 |
| toast | slide up 8px and fade | 160ms ease-out |

Deal-in and end-of-turn flights are derived from the view, not from a local
prediction. The dock keeps the last measured box of every hand card and played
stub. When a view arrives with a higher turn number, it launches throwaway
copies from those boxes into the discard counter, then deals any new hand cards
from the deck counter. A reshuffle has no log line, so the client watches the
public pile counts: a discard that falls from a positive number to zero came
back as a deck.

Sound is off until the first gesture. WebAudio only, no files: an 8ms filtered
noise click for buttons, two square blips plus a noise tail for the roll, a
70Hz sine thud for placement, a descending two-note pair for a rejected action,
a bell dyad for awards and wins, and four rising paper ticks for a reshuffle.
Header toggle "Sound on" / "Sound off", persisted at `localStorage.lorac.sound`,
default on.

Never play: tab hidden; bot actions under 120ms apart; the same cue twice within
60ms; a toast from a button the player could see was disabled; before the socket
connects.

Reduced motion: dice snap with a 120ms cross-fade, production tokens fade only,
the robber stops drifting, pulses stop, card slides become 100ms fades, flight
copies and deal delays are dropped, victory becomes one 200ms fade. No
information is carried by motion alone.

---

## 11. Accessibility

Contrast: text on parchment at least 7:1, ink-500 on parchment-200 at 5.1:1 as
the floor, text on sea at least 7:1, icons and piece outlines at 3:1 against
their hex. Brass hairlines are decoration and never the only boundary. Seat
colors are never the only identifier, see the road and building patterns in
section 4.

Resource color-blind plan: distinct silhouettes at 14 to 18px, cost as pips plus icon,
counts as icon plus numeral, terrain icons in every hex, and a "Letter labels"
setting adding W / B / S / H / O at 10px under each icon. The palette also
differs in lightness, not hue alone: wood 32%, brick 36%, sheep 52%, wheat 58%,
ore 38%. The player resource rows tint each icon with its resource color, using
 brighter variants on the dark active-player bar, while the silhouettes stay the
color-blind cue.

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
wheat, 3 ore." Whenever targeting is active the legal targets in the SVG are
focusable buttons in board order, labelled with the same text as the tooltips.

Touch: buttons, steppers, and cards are 44x44 including padding. Board targets
get an invisible `max(22px, 0.30*S)` radius hit circle. Cards hit-test their
whole unclipped face. Every tooltip also opens on tap, so nothing is hover-only.

At 1024: 11px minimum, 3 lines of card text, 20px VP numbers, 13px names, 12px
resource counts. Any label sitting on the sea gets a 1px parchment plate.

---

## 12. Component tree and build order

```
App
├─ Store                 net/store.ts, net/useGame.ts
├─ ScreenRouter          screen state, peer phases
│  ├─ TitleScreen  SoloSetup  PeerHostScreen  PeerJoinScreen  LobbyScreen
│  ├─ GameScreen
│  │  ├─ Header          wordmark, turn chip, target, sound, rules, leave
│  │  ├─ BoardFrame
│  │  │  ├─ DiceTray
│  │  │  ├─ BoardSvg → PortLayer, HexLayer, RoadLayer, RobberLayer,
│  │  │  │             BuildingLayer, TargetLayer
│  │  │  └─ TooltipLayer
│  │  ├─ ActivePlayerBar → resources, route, renown
│  │  ├─ ActionBar → PromptLine, VictimChips, ButtonCluster
│  │  ├─ HandDock → PlayAreaStrip, CardFace x n, DrawCounters
│  │  ├─ LedgerRail → PlayerPanel x n, CardInspector   desktop only
│  │  ├─ SupplyRail → MarketTab, TradeTab, LogTab, PlayersTab
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

1. `net/local.ts` and `useGame.ts`: run the engine in the tab, `quickPlay`,
   hold the `game` view, reconnect the bot loop on each action. Dump raw view
   JSON, no styling.
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
11. Lobby, join by code, peer invite panel, connection banner.
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
  Without it a long player name in the active strip widens the grid and pushes
  the board off the right edge, which is exactly what happened on iOS Safari
  before this fix.
- Header swaps long labels for `T3 · you`, `to 14`, `Aa`, `Snd`, `Rules`,
  `Leave`. Room code is hidden; it stays in the lobby and share link.
- The top seat ribbon is gone. The active-player strip above the action bar
  keeps the current seat's resources, route, and renown on screen, and the
  Players button opens the full stat boxes in the supply drawer.
- Hand becomes a scrolling row of 110x70 cards. The fan needs more width than
  a phone has, and clipped cards were worse than a row. The spread toggle is
  hidden on phones because the row is always on. Card faces keep the name, the
  resource yield, and short effect labels.
- Board frame keeps the full island. At 390px the SVG is 368x490; at 320px it
  is 298 wide. No horizontal scrolling anywhere.
- Short landscape keeps a 32px active-player strip, hides the play-area strip,
  shrinks the hand to 92x68 cards, and gives the board whatever height remains.
  It is playable, not pretty. Portrait is the supported phone orientation.
- `100dvh`, `viewport-fit=cover`, safe-area padding on the header and hand
  dock, `touch-action: manipulation` on controls, `overscroll-behavior: none`.

Measured after the fix: 320x568, 360x800, 375x667, 390x844, 430x932 all report
`document.scrollWidth === window.innerWidth` and a board that ends inside the
viewport.

### Played cards ran into the pile counts (fifth phone test)

`.play-area` and `.hand-counters` were both absolutely positioned, and the strip
carried a fixed `right: 150px` (130 on tablet, 74 on phone) that no longer
matched the counters' real width. Five played cards ran under "deck · discard"
on a phone. Both now sit in one flex header row (`.dock-head`), so the strip
takes the leftover width and the counters keep theirs. The strip scrolls
sideways with an edge fade, and scrolls itself to the newest play.

### Victim chips and card faces on a phone (fourth phone test)

Two more things ran off the right edge of a phone.

The robber victim chips sat inline with "Steal 1" inside `.action-buttons`,
which was `flex: none`, so the cluster grew past the bar instead of wrapping and
the third player and the button were both unreachable. `.action-buttons` now
shrinks (`flex: 0 1 auto; min-width: 0`) so it can never overflow its bar, and
below 760px the victim picker stacks: prompt, then a chip row that scrolls
sideways with a right-edge fade when it overflows, then the commit buttons on
their own line. The button never depends on a scroll.

Hand cards on every screen now carry the name, the resource yield as `+N` plus
an icon, and at most a couple of short effect labels. Price, full text, flavor,
and tag stay in the market or the inspector. Long names wrap to two lines on
the small layouts instead of ellipsing.

### Building had no entry point (found on the phone)

The action bar offered Trade, Buy, and End turn, and nothing else. Roads,
settlements, and cities could only be placed during setup or through a card
that grants one, because no control ever set the client's build targeting
state, even though the board rings, the send path, and the engine moves were
all in place. The bar now carries "Build" and a three-chip picker, so a paid
build works the same way a free card build already did.

Two layout consequences: the free-action cluster is four buttons wide, and the
picker needs a second row. `.center-column` sizes the action-bar row `auto`
instead of a fixed 50 to 56px so a wrapped cluster grows the bar downward and
the board gives up the height, rather than the buttons spilling into the hand.

### The page could still be zoomed on a phone (third phone test)

The drawer was flush in WebKit at every phone size and still looked cut off on
the device, which pointed at the page being zoomed rather than the layout
overflowing. Two iOS behaviours produce that:

- Focusing a text control whose text is under 16px zooms the page in, and the
  zoom survives the keyboard closing and the screen changing. `autoFocus` on
  the join-name field fired it the moment the screen appeared. Every text
  control now has a 16px floor through `--field-text`. The room code stays at
  24px.
- A double tap, which a tap-heavy board invites, zooms into the tapped element.
  `touch-action: manipulation` now sits on `html`, not just on buttons, so the
  whole app drops double-tap zoom while keeping pan, pinch, and scrolling.

When the page is zoomed the layout viewport is still phone wide while the
visible slice is narrower, so a drawer pinned to the layout viewport's right
edge sits past the visible area and the player has to pan sideways. That is the
same symptom as a genuinely too-wide box, which is why the layout measured
clean every time.

`?diag=1` pins an on-device panel with the numbers that separate the cases:
`inner` against `screen` (Safari's aA page zoom), `visualViewport.scale`
(pinch or double-tap), document scroll against client width, the drawer's box,
the safe-area insets, and every visible element past the visible edge. Tap it
to dismiss. Inert without the parameter; `src/client/dev/diagnose.ts` and its
one call in `App.tsx` can be deleted outright.

### Market drawer sat a hair too far right (added after the second phone test)

The rail drawer opened beyond the right edge on iOS, and the page could be
panned sideways to reach the rest of it. Two causes, both fixed:

- The closed drawer was parked at `translateX(102%)`, leaving 2% of a 380px
  panel poking past the viewport. iOS turns that into document scroll width.
  It now parks at exactly `translateX(100%)`: the left edge lands on the
  viewport edge, so there is nothing to scroll to. `visibility: hidden` hides
  it from taps and screen readers while closed, delayed by the transition so
  the slide-out still shows.
- On phones the drawer was `width: 100vw`. That unit ignores the scrollbar and
  rounds against the device pixel grid, which can make a full-bleed panel one
  pixel wider than the screen. It is now pinned with `left: 0; right: 0` and
  `width: auto`.

The rail also takes `env(safe-area-inset-left/right)` padding so a landscape
notch does not sit on the Buy buttons, and `overflow: hidden` moved onto `html`
as well as `body`, since body alone does not always stop the pan on iOS Safari.

### Market resource strip (added after playtesting)

The market and trade panels carry a sticky copy of the viewer's five resource
counts and their total against the 9-resource limit. It pins under the rail
tabs while the list scrolls, turns warm when over the limit, and hides the long
label on phones. The panel no longer depends on the player ledger being on
screen, which matters most on a phone where the rail is a full-width drawer.
Waiting players also get a Market button in the action bar on narrow layouts,
so the drawer can be opened before their turn.

### Notifications and touch tooltips (added after the phone test)

Toasts move to the top of the screen on phones, directly under the header, so
they never sit over the board or the hand. They keep an explicit close button
and still dismiss when the body is tapped. The old bottom placement was above
the dock on paper but landed on the play area once the phone hand row changed
height.

Board tooltips were hover-only. Touch has no pointerleave, so they stuck around
after a tap. On coarse pointers a tooltip now behaves as a hint: it appears on
tap, hides itself after about two seconds, and clears on any other pointerdown
or when the game state changes.
