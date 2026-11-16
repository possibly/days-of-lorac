# Signaling relay

A four-letter code needs somewhere to meet. This Worker is that somewhere: one
Durable Object per code, pairing a host with up to three guests and forwarding
WebRTC session descriptions. Game traffic never touches it.

## What it costs

Nothing, if you stay on the Workers Free plan, and the free plan cannot bill you
by accident:

- Workers Free is the default plan. No payment method is needed.
- Durable Objects are available on Workers Free (SQLite-backed classes only,
  which is what this config uses).
- Free limits: 100,000 Worker requests/day, 100,000 Durable Object requests/day,
  13,000 GB-s/day of duration. When a limit is hit, further operations fail with
  an error. There is no overage invoice on Free.
- The relay keeps no storage, sets no alarms, and uses WebSocket Hibernation, so
  an idle lobby bills no duration.
- WebSocket connections count as one request. Signaling is about ten messages per
  player per game, so the caps are far away.

Do not upgrade the account to Workers Paid, and do not add other Cloudflare
products, unless you decide to. Nothing in this directory does that.

## Run it locally

No account needed:

```bash
npm run relay:dev          # wrangler dev, http://127.0.0.1:8787
```

Point the game at it:

```
http://127.0.0.1:5173/?offline=1&relay=http://127.0.0.1:8787
```

`?relay=` is a runtime override. `VITE_RELAY_URL` is the build-time default.
With neither, the game uses direct invite links and reply codes.

Health check: `curl http://127.0.0.1:8787/health`.

## Deploy it

Create a Cloudflare account when you're ready (email and password, no card). Then:

```bash
npx wrangler login         # opens the browser, approve the OAuth prompt
npm run relay:deploy       # first deploy asks for a workers.dev subdomain
```

The first deploy prints the URL, like
`https://days-of-lorac-relay.<your-subdomain>.workers.dev`.

Then either:

- set the GitHub repository variable `LORAC_RELAY_URL` to that URL and re-run the
  Pages workflow, so the deployed site uses codes by default, or
- pass it per visit: `?relay=https://…workers.dev`.

Without a relay URL the Pages build still works, with direct invites.

## Protocol

Client to relay:

```json
{ "t": "offer", "to": "g1", "sdp": "...", "room": "ABCD" }
{ "t": "answer", "sdp": "..." }
{ "t": "bye" }
```

Relay to client:

```json
{ "t": "welcome", "role": "host", "code": "ABCD", "id": "host" }
{ "t": "join", "from": "g1" }
{ "t": "offer", "from": "host", "sdp": "...", "room": "ABCD" }
{ "t": "answer", "from": "g1", "sdp": "..." }
{ "t": "gone", "from": "g1" }
{ "t": "error", "code": "ROOM_TAKEN", "message": "..." }
```

Close codes: `4009` code taken, `4004` no host, `4013` table full, `4001` host
left.

The host picks the code and retries on `4009`; the DO never assigns codes, which
keeps it from needing a registry. A second host is refused. A guest is refused
when no host is connected, or when three guests are already in.

Limits: text frames only, 24 KB, strict field checks in
`src/shared/relay.ts`. No storage, no logs of message contents.

## Files

- `wrangler.toml` the Worker, the DO binding, and the SQLite migration.
- `src/index.ts` the fetch router and the `Room` Durable Object.
- `../src/shared/relay.ts` wire types and validation, shared with the browser.
