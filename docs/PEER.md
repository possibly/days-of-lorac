# Peer tables

A game with no server anywhere: one player's browser runs the room and everyone
else connects to it directly. The Pages build has no service behind it, so this
is how a static host gets real multiplayer.

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

There is no rendezvous service, so the two session descriptions travel by hand:

1. Host creates the room, then one invite per guest. An invite is an offer link
   (`#join=<code>`) and a QR code of that same link. Each guest needs their own
   invite: an offer carries one ICE credential pair and one DTLS fingerprint, so
   one offer cannot seat two phones.
2. Guest opens the link or scans the host's screen, types a name, and gets a
   reply code (`#reply=<code>`), about 640 characters after gzip and base64url.
3. Host pastes the reply code, or scans the guest's screen if both are phones.
   The data channel opens, the guest joins the room over the same wire protocol
   as any other client, and every screen from there on is the normal lobby and
   game.

Codes are JSON, gzipped with `CompressionStream`, then base64url. Plain base64
is the fallback for browsers without compression. TCP and relay candidates are
stripped before encoding: the payload has to fit a QR code that a phone can read,
and there is no TURN server in this build to use relay candidates anyway.

## What can go wrong

- **The host's tab is the server.** Lock the phone, close the tab, or refresh,
  and the table is gone. The host screen asks for a screen wake lock while it
  hosts, and says so on the setup panel.
- **Phones sleep.** Guests who background their browser lose the channel, and a
  lost channel cannot be resumed without a new offer and reply. The seat token
  still exists, but there is no address to reconnect to.
- **No TURN.** Two devices on one home wifi connect over host candidates and
  never touch the internet. Across networks, STUN covers most home routers, but
  symmetric NAT on mobile carriers can fail to connect. The error says to try
  wifi rather than hanging.
- **Some wifi blocks device-to-device traffic.** Guest networks and client
  isolation look connected and then never carry a packet. There is no code fix,
  only a clearer message.
- **Four players means three invites.** Same flow, repeated for each phone.

## Files

- `src/client/net/peer/codec.ts` gzip and base64url for signaling payloads.
- `src/client/net/peer/signaling.ts` payload shapes, the `#join` and `#reply`
  fragments, candidate filtering, ICE gathering wait.
- `src/client/net/peer/socket-like.ts` the transport seam: `SocketLike`, the
  data channel adapter, the loopback pair, and the deferred socket that lets a
  guest attach before the host has answered.
- `src/client/net/peer/host.ts` the in-tab room server and its invites.
- `src/client/net/peer/guest.ts` offer to answer, then wait for the channel.
- `src/client/net/peer/session.ts` the state machine the screens subscribe to,
  including the store swap from the in-browser game to the room client.
- `src/client/screens/PeerHostScreen.tsx`, `PeerJoinScreen.tsx`,
  `PeerInvitePanel.tsx` the screens.
- `src/client/ui/QrCode.tsx`, `QrScan.tsx` QR drawing and camera scanning
  (`jsqr` is fetched only when the scanner opens).

## Adding a server later

`SocketLike` is the seam. A Durable Object or any hosted server would attach a
different transport to the same `GameClient` and reuse the wire protocol, the
engine, and every screen. The peer-specific parts are signaling and the store
swap; nothing in the engine or the protocol knows how messages travel.
