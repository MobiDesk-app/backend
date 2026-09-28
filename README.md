# Home Relay — Backend

Signaling server for the "control my home PC from my phone, over any
network" project. This is **Phase 1** of the plan: the backbone that the PC
agent (Electron) and the phone app (React Native) will both connect to next.

## What this server does — and doesn't do

It only ever handles small JSON handshake messages over WebSocket:

- authenticates every connecting client
- stores the list of LAN devices your PC agent reports (for the "what's on
  my WiFi" view)
- relays WebRTC offer/answer/ICE messages between a specific phone and a
  specific PC so they can open a **direct peer-to-peer** connection

It never sees screen video or mouse/keyboard input — once a phone and PC
finish the handshake here, they talk to each other directly. That's why this
server stays cheap and low-latency to run.

## What's been built so far

| Piece | File | Purpose |
|---|---|---|
| Config | [`src/config/env.ts`](src/config/env.ts) | Loads and validates env vars once, at startup, instead of scattering `process.env` reads everywhere |
| Wire protocol | [`src/types/messages.ts`](src/types/messages.ts) | Every message a client can send is a `zod` schema — untrusted input off a WebSocket is parsed and validated at runtime, not just cast with `as` |
| Domain types | [`src/types/device.ts`](src/types/device.ts) | Plain TS types for `LanDevice`, `PcRecord`, `PcSummary` |
| Auth | [`src/auth/token.ts`](src/auth/token.ts) | Shared-secret check (MVP — see "Not done yet") |
| Registry | [`src/registry/deviceRegistry.ts`](src/registry/deviceRegistry.ts), [`fileDeviceRegistry.ts`](src/registry/fileDeviceRegistry.ts) | `DeviceRegistry` is an interface; `FileDeviceRegistry` is the current flat-JSON-file implementation. Handlers depend on the interface, so swapping in Postgres later touches one file, not the whole codebase |
| Connection tracking | [`src/ws/connectionHub.ts`](src/ws/connectionHub.ts) | In-memory map of who currently has a socket open, so a message can be routed to a specific device by id |
| Message handlers | [`src/ws/handlers/*.ts`](src/ws/handlers) | One file per message type (`report_lan_devices`, `get_devices`, `signal`, `ping`). Each is a small pure-ish function of `(context, message) => void` |
| Dispatcher | [`src/ws/handlers/dispatch.ts`](src/ws/handlers/dispatch.ts) | Routes a validated message to its handler; TypeScript's exhaustiveness check (`never`) means forgetting to handle a new message type is a compile error, not a runtime surprise |
| Socket wiring | [`src/ws/socketServer.ts`](src/ws/socketServer.ts) | Enforces the protocol: first message must be a valid `auth`, everything after is schema-validated then dispatched |
| HTTP | [`src/http/app.ts`](src/http/app.ts) | Just `/health` for now |
| Entrypoint | [`src/server.ts`](src/server.ts) | Wires config + registry + HTTP + WebSocket together and starts listening |
| Smoke test | [`scripts/smoke-test.ts`](scripts/smoke-test.ts) | Simulates a PC and a phone connecting, reporting devices, listing them, and relaying a signal message — this is how the flow below was verified |

### Why it's structured this way

- **Handlers don't import a global hub/registry** — they receive a
  `HandlerContext` with everything they need. That makes each handler testable
  in isolation and makes the dependency graph explicit instead of hidden
  behind module-level singletons.
- **The registry is an interface**, not a concrete file-storage class, so
  moving from a JSON file to a real database later is a one-file change.
- **Messages are validated with `zod`, not just typed.** TypeScript types
  disappear at runtime — anything arriving over the WebSocket is attacker- or
  bug-controlled bytes until it's actually checked. `clientMessageSchema` is
  the one place that happens.
- **"Online" is never stored** — it's computed on demand from
  `ConnectionHub`, which only knows about sockets that are open *right now*.
  This avoids an entire category of bugs where a stale "online: true" survives
  a crash or ungraceful disconnect.

## Verified so far

Ran the compiled server and `scripts/smoke-test.ts` together and confirmed:

1. A simulated PC agent authenticates and gets `auth_ok`.
2. A simulated phone app authenticates and gets `auth_ok`.
3. The PC reports LAN devices; they're persisted to `data/devices.json`.
4. The phone asks for the device list and receives the PC (marked online)
   with its reported LAN devices attached.
5. The phone sends a `signal` message targeting the PC; the PC receives it
   relayed with the sender's id attached.

## Run it

```bash
npm install
cp .env.example .env   # defaults work for local dev
npm run dev            # runs src/server.ts directly, restarts on change
npm run e2e-test       # (server running) checks accounts, linking, routing and attack cases
```

Health check: `GET http://localhost:8080/health`

Production build:
```bash
npm run build   # tsc -> dist/
npm start       # node dist/server.js
```

Type-check only (no emit): `npm run typecheck`

## Protocol (WebSocket, JSON messages)

Every connection must send this first, before anything else:

```json
{ "type": "auth", "token": "...", "deviceId": "pc-1", "role": "pc", "name": "Hazem-Desktop" }
```

`role` is `"pc"` or `"app"`. Server replies `{"type":"auth_ok",...}` or closes
the socket (invalid auth, unknown type, or auth not sent within 10s).

**PC agent -> server**, periodically:
```json
{ "type": "report_lan_devices", "devices": [{ "ip": "...", "mac": "...", "name": "..." }] }
```

**App -> server**, to list PCs and their last-known LAN devices:
```json
{ "type": "get_devices" }
```

**Either side**, to relay a WebRTC signaling message to the other:
```json
{ "type": "signal", "target": "pc-1", "payload": { "kind": "offer", "sdp": "..." } }
```
The recipient gets `{ "type": "signal", "from": "<senderId>", "payload": {...} }`.

## Try it yourself

```bash
npm run dev
# in another terminal:
npm run smoke-test
```

## Not done yet (later phases)

- Per-device auth tokens instead of one shared secret across every client
- Persistent storage beyond a flat JSON file (Postgres/SQLite) once this is
  more than single-user
- TURN server (`coturn`) config for the NAT-traversal fallback
- Rate limiting and TLS termination (put this behind nginx, Caddy, or a
  platform that terminates TLS for you before exposing it publicly)
- The PC agent (Electron) and the React Native app itself — this server has
  nothing to talk to yet

## Accounts and PC linking

There is no shared token any more. Instead:

- **People sign in with email + password** (web or phone app). Passwords are
  hashed with scrypt; each sign-in gets its own random session token
  (`POST /api/auth/login`), stored hashed, revocable with
  `POST /api/auth/logout`, and valid for 60 days after last use.
- **PCs are linked with a 6-digit code.** The agent calls
  `POST /api/pairing/start` and shows the code; the signed-in user enters it
  (`POST /api/pairing/claim`); the agent's `POST /api/pairing/poll` then
  receives a permanent device id + 256-bit secret. Codes last 10 minutes and
  are single-use.
- **Routing is per account.** The WebSocket relay only passes signals
  between a PC and apps signed in to the account that owns it, and the
  device list only shows your own PCs. `DELETE /api/pcs/:id` unlinks a PC
  and disconnects it.
- **Rate limits:** 8 wrong passwords per email / 30 per IP per 15 minutes,
  5 wrong link codes per user / 20 per IP per 15 minutes.

## Database

Set `DATABASE_URL` (PostgreSQL, e.g. Neon) and the server stores everything
there — tables `users`, `sessions` and `pcs` are created automatically on
startup (`src/store/pgStore.ts`). Without it, it falls back to a local JSON
file (`DATA_FILE`, default `data/store.json`) for quick local testing.
Passwords and secrets are only ever stored as hashes.

To copy accounts from an old JSON file into Postgres (safe to run twice):
```bash
npm run import-json
```

Link codes and login rate limits are kept in memory, so run a single
instance of the server (fine for this app's scale).
