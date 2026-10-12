# Online Protocol (v1)

Source of truth: `shared/src/protocol.ts` (types + validators shared by client and server).

* Transport: WebSocket, path **`/ws`**, JSON text frames. Binary frames are rejected.
* Version: `PROTOCOL_VERSION = 1`. The client sends it in `hello`; a mismatch returns `version_mismatch` and the socket is closed. Bump the version for any incompatible change.
* Limits: max frame **2048 bytes** (validated) — the socket hard limit is 4096 bytes; token-bucket rate limit **150 burst / 100 msgs per second**; **20 invalid messages** close the socket with code 1008. Unknown fields are rejected.
* Connection limits: at most 16 simultaneous connections per client IP (HTTP 429 beyond that; `MAX_CONNECTIONS_PER_IP`), and room create/join attempts are limited to 6 quickly then 1 every 3 s per connection (`rate_limited` error), so room codes cannot be brute-forced.
* Origins: browsers must connect from an allowed origin (`ALLOWED_ORIGINS`; production default `self`).
* Authority: the server runs the shared engine (`shared/src/engine/sim.ts`) at a fixed 60 Hz. Clients send **only inputs**. Positions, hits, damage, blocking, health, meters, combos, timer, rounds and the winner are decided by the server.

## Client → server

| `t` | Fields | Notes |
|---|---|---|
| `hello` | `v`, `name?` (≤64, sanitised to 16), `resume?` | Must be first. `resume` = token from a previous `welcome` to reclaim a seat after a drop. |
| `createRoom` | `name?` | Creates a room and seats you in slot 0. |
| `joinRoom` | `code` (normalised to upper-case), `name?` | Errors: `room_not_found`, `room_full`. |
| `selectCharacter` | `char` (one of the 9 ids) | Lobby only, while not ready. In `finished` it returns the room to the lobby. |
| `ready` | `ready: boolean` | Needs a fighter. In `finished`, `ready:false` returns to the lobby ("change fighter"). |
| `input` | `seq` (int, strictly increasing), `bits` (10-bit mask) | Playing only. Older/replayed `seq` values are ignored. Sent on change + heartbeat every ~10 frames. Inputs older than 600 ms are treated as neutral. |
| `rematch` | `vote: boolean` | Finished only; both votes start a new match with the same fighters. |
| `leaveRoom` | — | During a match this forfeits. |
| `ping` | `ts` | Answered with `pong` (RTT shown in the client). |

Input bits (`shared/src/input.ts`): `UP=1, DOWN=2, LEFT=4, RIGHT=8, LP=16, HP=32, LK=64, HK=128, SP=256, SU=512` (directions are screen-absolute).

## Server → client

| `t` | Fields |
|---|---|
| `welcome` | `v`, `playerId`, `resume` (store in sessionStorage), `serverTime` |
| `error` | `code` (`bad_message`, `version_mismatch`, `room_not_found`, `room_full`, `not_in_room`, `invalid_state`, `rate_limited`, `server_full`), `message` |
| `room` | `you` (slot), `room: { code, phase, players[{slot,name,char,ready,connected,rematch}], deadline }` |
| `left` | You are no longer in a room. |
| `matchStart` | `matchId`, `chars: [p1, p2]`, `you` |
| `snapshot` | `matchId`, `frame`, `ack` (your last processed input seq), `state` (full match state without input buffers), `events` (hits, blocks, KOs, round changes since the previous snapshot) |
| `matchEnd` | `matchId`, `winner` (0, 1 or `"draw"`), `reason` (`ko`, `timeout`, `doubleKo`, `forfeit`) |
| `opponentStatus` | `connected`, `graceMs` |
| `pong` | `ts`, `serverTime` |

## Room lifecycle

```
lobby ──(2 players, both chose + ready)──▶ countdown (3 s) ──▶ playing ──(match over)──▶ finished
  ▲            (un-ready / leave / drop cancels)                │   ▲                      │
  │                                                     drop    ▼   │ reconnect            ├─ both vote rematch ─▶ playing (matchId+1)
  │                                                          paused ─(grace expires)─▶ finished (forfeit)
  └──────────────── change fighter (ready:false / selectCharacter) ◀───────────────────────┘
```

* **Disconnect during a match:** the simulation pauses, the opponent gets `opponentStatus{connected:false}` and the room shows `paused` with a `deadline`. Reconnecting with the resume token restores the seat (`matchStart` + snapshot are re-sent) and play continues. If the grace period (default 20 s) expires, the absent player forfeits.
* **Disconnect outside a match:** the seat is released after ≤10 s if the player does not return.
* **Leaving** mid-match forfeits immediately.
* **Cleanup:** empty rooms are deleted immediately; idle lobbies after 15 min.

## Synchronisation model

* Server: fixed 60 Hz drift-corrected loop for all rooms; snapshots every 2 frames (30 Hz, `SNAPSHOT_HZ`).
* Client: renders **4 frames (~67 ms) behind** the estimated server frame and linearly interpolates fighter/projectile positions between bracketing snapshots; discrete state (health, action, animation frame) comes from the older snapshot. Effects/sounds are triggered from snapshot events.
* There is no client-side prediction or rollback, so input latency ≈ RTT/2 + interpolation delay. This keeps the client strictly non-authoritative; see the README's limitations section.
