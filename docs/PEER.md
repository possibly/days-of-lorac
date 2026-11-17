# Peer tables

A game with no server holding the state: one player's browser runs the room and
everyone else connects to it directly. The static site has no service behind it,
so this is how it gets real multiplayer.

A host gets a four-letter code. Guests type it, or scan it. A small Cloudflare
Worker carries the WebRTC handshake and then gets out of the way. Signaling
only: no game action, chat, or hand ever reaches Cloudflare.

Without a relay URL the build has no way to introduce a host and a guest, so it
offers solo play only. `?relay=` overrides the configured URL for one visit;
`?relay=off` disables multiplayer even when the build has one.

## What runs where

The host tab runs the actual room modules, not a copy. `RoomManager`, the wire
router in `src/server/message-router.ts`, and the bot policy are shared with the
offline bot game. The transport is the only difference: one `RTCDataChannel` per
guest instead of a WebSocket, plus a loopback pair for the host's own seat, so
the host is an ordinary client of their own table.

The host's browser therefore holds the game state and every hand. That is the
same trust model as sitting next to someone and peeking, and it is the only
model that keeps hidden information hidden without a server: in a full mesh
every browser would need the full state to compute its own view.

## Connecting

1. Host opens a table; the tab asks the relay for a free code (retrying on
   collisions) and shows it with a QR of the join link.
2. Guest types the code or scans the link. The relay assigns a seat and tells
   the host.
3. Host creates one offer per guest, sends it through the relay, guest answers
   through the relay, and the data channel opens. The relay socket then only
   stays open for the host's lobby, so later guests can still join.
4. The guest joins the room over the normal wire protocol and every screen after
   that is the usual lobby and game.

The room code inside the host tab travels with the offer, so the guest does not
have to type it separately. It is an internal id and never appears in the UI.
The four-letter code on the lobby header, the invite card, and the game header
is the relay code, which is the one guests type.

## Refresh and resume

A refresh does not end the table, as long as the same browser comes back.

- The host tab writes the room to `localStorage` as it changes: throttled to at
  most once a second, plus a final write on `pagehide` and when the tab is
  hidden. A snapshot is 20 KB at setup and around 80 KB mid-game; the log is
  trimmed to the last 400 lines first, and the UI only shows 120.
- A guest saves the relay code, the room code, its seat number, and its seat
  token. That token is the same secret the room already hands out for a dropped
  socket, so a refresh takes the existing `resume` path instead of inventing a
  second one.
- On load, a save younger than 45 seconds reopens without asking. That is the
  reload case. A save younger than two hours asks on the title screen with a
  resume strip. Older than that, the save is deleted.
- The host reclaims its published relay code. Guests retry the relay for up to
  90 seconds while the host tab reloads, then resume their seats.
- If the host's relay code was taken during the gap, which needs someone else to
  guess it inside a second or two, the host falls back to a fresh code and the
  invite card shows it.

What this does not do: the table still lives in the host's browser. Closing the
laptop, signing out of the browser profile, or clearing site data ends it for
everyone. Another device cannot resume either, because nothing is uploaded. The
snapshot holds every seat token and every hand, which is the same thing the open
host tab already holds in memory.

## What can go wrong

- **The host's tab is the server.** A refresh, a crash, or a locked phone that
  discards the tab comes back: the room is saved in this browser and the host
  resumes its own seat. Closing the browser for good, using another device, or
  clearing site data still ends the table. The host screen asks for a screen
  wake lock while it hosts and says so on the setup panel.
- **A resumed table can lose the last second of play.** Saves are throttled to
  once a second. Reloads and tab switches flush first and lose nothing; a browser
  that is killed outright skips that flush, so the newest actions can be gone.
- **No TURN.** Two devices on one home wifi connect over host candidates and
  never touch the internet. Across networks, STUN covers most home routers, but
  symmetric NAT on mobile carriers can fail to connect. The error says to try
  wifi rather than hanging.
- **Some wifi blocks device-to-device traffic.** Guest networks and client
  isolation look connected and then never carry a packet. There is no code fix,
  only a clearer message.
- **The relay can be down or unreachable.** The host gets a plain error and
  returns to the title screen. A guest who mistypes a code, or picks one whose
  host has left, gets a plain message too.
- **Four players means three guests.** A relay room caps at one host plus three
  guests, matching the largest table.

## Deploying the relay

See `relay/README.md`. Short version: free Cloudflare account, no card,
`npx wrangler login`, `npm run relay:deploy`, then set the repository variable
`LORAC_RELAY_URL` and re-run the Pages workflow.

## Files

- `src/client/net/peer/relay.ts` relay signaling, host and guest side.
- `src/client/net/peer/session.ts` the state machine the screens subscribe to,
  including the store swap from the in-tab bot game to the room client and the
  resume paths in both directions.
- `src/client/net/peer/session-save.ts` what a browser remembers about a table:
  relay code, seat token, and the host's room snapshot, with the two-hour window.
- `src/server/room-save.ts` room to JSON and back, with validation. A snapshot
  from another build, or one edited by hand, is ignored instead of half-applied.
- `src/client/net/peer/signaling.ts` ICE settings, candidate filtering, ICE
  gathering wait.
- `src/client/net/peer/socket-like.ts` the transport seam: `SocketLike`, the data
  channel adapter, the loopback pair, and the deferred socket that lets a guest
  attach before the host has answered.
- `src/client/net/peer/host.ts` the in-tab room server and channel wiring.
- `src/client/screens/PeerHostScreen.tsx`, `PeerJoinScreen.tsx`,
  `PeerInvitePanel.tsx` the screens.
- `src/client/ui/QrCode.tsx`, `QrScan.tsx` QR drawing and camera scanning
  (`jsqr` is fetched only when the scanner opens).
- `relay/` the Cloudflare Worker and Durable Object.

## Changing the transport later

`SocketLike` is the seam. A Durable Object or any hosted server would attach a
different transport to the same `GameClient` and reuse the wire protocol, the
engine, and every screen. The peer-specific parts are signaling and the store
swap; nothing in the engine or the protocol knows how messages travel.
