# Peer tables

A game with no server holding the state: one player's browser runs the room and
everyone else connects to it directly. The Pages build has no service behind it,
so this is how a static host gets real multiplayer.

Guests arrive in one of two ways.

**Relay (default when a relay URL is configured).** The host gets a four-letter
code. Guests type it, or scan it. A small Cloudflare Worker carries the WebRTC
handshake and then gets out of the way. Signaling only: no game action, chat, or
hand ever reaches Cloudflare.

**Direct (no service anywhere).** An invite link or QR goes out, a reply code or
QR comes back, and the host pastes or scans it. Slower to set up, impossible to
shut down from outside. This is the fallback when no relay is configured, and the
button in the invite panel switches to it at any time.

## What runs where

The host tab runs the actual server modules, not a copy. `RoomManager`, the wire
router in `src/server/message-router.ts`, and the bot policy are shared with
`npm start`. The transport is the only difference: one `RTCDataChannel` per
guest instead of a WebSocket, plus a loopback pair for the host's own seat, so
the host is an ordinary client of their own table.

The host's browser therefore holds the game state and every hand. That is the
same trust model as sitting next to someone and peeking, and it is the only
model that keeps hidden information hidden without a server: in a full mesh
every browser would need the full state to compute its own view.

## Connecting

Relay mode:

1. Host opens a table; the tab asks the relay for a free code (retrying on
   collisions) and shows it with a QR of the join link.
2. Guest types the code or scans the link. The relay assigns a seat and tells
   the host.
3. Host creates one offer per guest, sends it through the relay, guest answers
   through the relay, and the data channel opens. The relay socket then only
   stays open for the host's lobby, so later guests can still join.
4. The guest joins the room over the normal wire protocol and every screen after
   that is the usual lobby and game.

Direct mode:

1. Host creates one invite per guest: an offer link (`#join=<code>`) and a QR of
   the same link. One offer cannot seat two phones, because it carries one ICE
   credential pair and one DTLS fingerprint.
2. Guest opens the link or scans the host's screen, types a name, and gets a
   reply code (`#reply=<code>`), about 640 characters after gzip and base64url.
3. Host pastes the reply, or scans the guest's screen. The channel opens.

In both modes the room code inside the host tab travels with the offer, so the
guest does not have to type it separately.

## What can go wrong

- **The host's tab is the server.** Lock the phone, close the tab, or refresh,
  and the table is gone. The host screen asks for a screen wake lock while it
  hosts and says so on the setup panel.
- **No TURN.** Two devices on one home wifi connect over host candidates and
  never touch the internet. Across networks, STUN covers most home routers, but
  symmetric NAT on mobile carriers can fail to connect. The error says to try
  wifi rather than hanging.
- **Some wifi blocks device-to-device traffic.** Guest networks and client
  isolation look connected and then never carry a packet. There is no code fix,
  only a clearer message.
- **The relay can be down or unreachable.** The host falls back to direct
  invites after roughly eight seconds, with a note in the invite panel. A guest
  who mistypes a code, or picks one whose host has left, gets a plain message.
- **Four players means three guests.** A relay room caps at one host plus three
  guests, matching the largest table.

## Deploying the relay

See `relay/README.md`. Short version: free Cloudflare account, no card,
`npx wrangler login`, `npm run relay:deploy`, then set the repository variable
`LORAC_RELAY_URL`. Until then, direct invites work with no deploy at all.

## Files

- `src/client/net/peer/relay.ts` relay signaling, host and guest side.
- `src/client/net/peer/session.ts` the state machine the screens subscribe to,
  including the store swap from the in-browser game to the room client.
- `src/client/net/peer/codec.ts` gzip and base64url for direct-mode payloads.
- `src/client/net/peer/signaling.ts` direct payload shapes, fragments, candidate
  filtering, ICE gathering wait.
- `src/client/net/peer/socket-like.ts` the transport seam: `SocketLike`, the data
  channel adapter, the loopback pair, and the deferred socket that lets a guest
  attach before the host has answered.
- `src/client/net/peer/host.ts` the in-tab room server, channel wiring, direct
  invites.
- `src/client/net/peer/guest.ts` direct invite to answer, then wait for the
  channel.
- `src/client/screens/PeerHostScreen.tsx`, `PeerJoinScreen.tsx`,
  `PeerInvitePanel.tsx` the screens.
- `src/client/ui/QrCode.tsx`, `QrScan.tsx` QR drawing and camera scanning
  (`jsqr` is fetched only when the scanner opens).
- `relay/` the Cloudflare Worker and Durable Object.

## Adding a server later

`SocketLike` is the seam. A Durable Object or any hosted server would attach a
different transport to the same `GameClient` and reuse the wire protocol, the
engine, and every screen. The peer-specific parts are signaling and the store
swap; nothing in the engine or the protocol knows how messages travel.
