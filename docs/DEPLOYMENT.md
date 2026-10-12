# Deployment Guide

> **Status:** the game has been built and tested locally (see `docs/TESTING.md`). It has **not been deployed** to a public host yet, because no hosting credentials were available. The steps below are what remains for you to do.

The game server is a long-running Node.js process that holds **persistent WebSocket connections**. It therefore needs a host that runs Node and supports WebSockets (Render web services, Railway, Fly.io, a VPS, …). A purely static host (GitHub Pages, Netlify/Vercel static) can host the **frontend only** — never the game server.

Two supported layouts:

| Layout | When to use | URLs |
|---|---|---|
| **A. Single service (recommended)** — the game server also serves the built frontend | Simplest; one URL, no CORS/origin juggling | `https://game.example.com` (page) and `wss://game.example.com/ws` |
| **B. Split** — static frontend + separate game server | You already host static sites elsewhere | `https://play.example.com` + `wss://api.example.com/ws` |

## Build and start commands

```bash
npm ci --include=dev   # dev dependencies are needed to build
npm run build          # client -> client/dist, server -> server/dist/index.js
npm start              # node server/dist/index.js
```

`npm start` serves `client/dist` automatically when `NODE_ENV=production` and the folder exists (or force with `SERVE_CLIENT=true`). Health check: `GET /health` → `{"ok":true,...}`.

## Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | 8787 | Listen port (most hosts inject it). |
| `HOST` | server | 0.0.0.0 | Bind address. |
| `ALLOWED_ORIGINS` | server | dev: `*`, production: `self` | Comma-separated exact origins allowed to open WebSockets. `self` = the page's own host (single-service deployments). For split hosting set your frontend origin, e.g. `https://game.example.com`. `*` is refused when `NODE_ENV=production`. |
| `TRUST_PROXY` | server | `off` | Where the per-IP limit gets the client IP: `off` (TCP peer), `cloudflare` (`CF-Connecting-IP`; Render), or `xff` (`X-Forwarded-For` via `TRUSTED_PROXIES` only). See *Client IP behind a proxy*. Any other value stops startup. |
| `TRUSTED_PROXIES` | server | — | Required with `TRUST_PROXY=xff`: comma-separated IPs/CIDRs your reverse proxy connects from. |
| `MAX_CONNECTIONS_PER_IP` | server | 16 | Simultaneous WebSocket connections per client IP (extra ones get HTTP 429). |
| `CLIENT_DIST` | server | `client/dist` | Built client folder; absolute or relative to the working directory. |
| `NODE_ENV` | server | — | `production` enables serving `client/dist`. |
| `SERVE_CLIENT` | server | auto | `true`/`false` to force static serving on/off. |
| `SNAPSHOT_HZ` | server | 30 | Snapshot rate to clients (simulation is always 60 Hz). |
| `RECONNECT_GRACE_MS` | server | 20000 | Seat hold time after a drop during a match. |
| `COUNTDOWN_MS`, `ROOM_IDLE_MS`, `MAX_ROOMS`, `MAX_CONNECTIONS`, `ROUND_SECONDS`, `ROUNDS_TO_WIN` | server | see `.env.example` | Room/match tuning and limits. |
| `VITE_WS_URL` | **client build time** | empty | Full WebSocket URL of the game server for layout B, e.g. `wss://api.example.com/ws`. Leave empty for layout A (same-origin `/ws`). |

No secrets are required. `.env.example` lists everything with safe placeholders; a local `.env` is read by the server in development and by Vite at build time.

## HTTPS / WSS

Browsers block `ws://` from an `https://` page, so production must use **`wss://`**. All the hosts below terminate TLS for you, so the Node process listens on plain HTTP and the public URL is HTTPS/WSS automatically. In layout A the client derives the URL from the page (`https:` → `wss://<same host>/ws`), so nothing needs configuring. The client **never** hard-codes `localhost` for production; it uses `VITE_WS_URL` or the page origin.

## Client IP behind a proxy

The server limits simultaneous connections per client IP (`MAX_CONNECTIONS_PER_IP`, default 16). Behind a proxy, the TCP peer is the proxy itself, so the server must be told which header it can trust. **A header is only trustworthy if it was written by a proxy you control or trust.**

| Hosting | Setting | Why |
|---|---|---|
| Local development, or exposed directly | `TRUST_PROXY=off` (default) | No proxy; forwarding headers are ignored, because anyone could send them. |
| **Render** (blueprint) | `TRUST_PROXY=cloudflare` | Every request to a Render web service passes through Cloudflare. Cloudflare sets `CF-Connecting-IP` to the real client IP and rejects requests that try to supply it. Render's `X-Forwarded-For` keeps client-supplied entries (for example `<spoofed>, <client>, <Cloudflare>, <internal>`), so neither its first nor its last entry is the client. |
| Self-hosted behind Cloudflare | `TRUST_PROXY=cloudflare` | Only if the origin accepts connections **only** from Cloudflare's IP ranges (firewall). Otherwise a client can bypass Cloudflare and send the header directly. |
| nginx / load balancer / other proxy | `TRUST_PROXY=xff`, `TRUSTED_PROXIES=<proxy IPs/CIDRs>` | `X-Forwarded-For` is used only when the connection comes from a listed proxy. It is read right-to-left, skipping listed proxies; the first unlisted address is the client. Addresses a client prepends are never reached. List every proxy hop you operate, and check your host's documentation for the addresses its proxy uses. |

The server logs its client-IP source at startup and logs `per-IP connection limit reached for <ip>` when it rejects a connection.

**Verify after deploying:** open more than 16 connections from one machine while sending a different forged `X-Forwarded-For` value on each (for example with a small `ws` script). Connections beyond the limit must be rejected with HTTP 429, and the log line must show your real IP, not a forged one.

## Option 1 — Render (layout A, blueprint included)

1. Push this repository to GitHub/GitLab.
2. Render dashboard → **New → Blueprint** → select the repo. `render.yaml` creates a Node web service with:
   * build: `npm ci --include=dev && npm run build`
   * start: `npm start`
   * health check: `/health`
   * env: `NODE_ENV=production`, `SERVE_CLIENT=true`, `NODE_VERSION=22`, `TRUST_PROXY=cloudflare` (origins default to `self`)
3. No origin setting is needed: in production the server only accepts WebSockets from its own host (`self`).
4. Note: Render's free plan sleeps after ~15 minutes idle; the first visit then takes up to a minute while it wakes. Use a paid instance for always-on play.

## Option 2 — Any Docker host (Fly.io, Railway, VPS, …)

```bash
docker build -t pixel-fighters .
docker run -p 8787:8787 pixel-fighters   # behind a reverse proxy: -e TRUST_PROXY=xff -e TRUSTED_PROXIES=<proxy IPs/CIDRs>
```

The `Dockerfile` builds the client and server, then runs `node server/dist/index.js` with `SERVE_CLIENT=true` and a `/health` health check. On Fly.io: `fly launch` (detects the Dockerfile), set `internal_port = 8787`, `fly secrets set ALLOWED_ORIGINS=https://<app>.fly.dev`, `fly deploy`. *(The Dockerfile was written but not built or run in this session. Test it with the command above before relying on it.)*

## Option 3 — Split hosting (layout B)

1. Deploy the **game server** with Option 1 or 2 (it can skip the client: `SERVE_CLIENT=false`). Note its URL, e.g. `https://pf-server.onrender.com`.
2. Build the **frontend** with the server URL baked in:
   ```bash
   VITE_WS_URL=wss://pf-server.onrender.com/ws npm run build:client
   ```
   Upload `client/dist/` to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3+CloudFront). It is a single-page app; no rewrites are required because routing is in-app.
3. On the server set `ALLOWED_ORIGINS=https://<your-frontend-domain>` and redeploy.

Tip: during development (`npm run dev`) the client can be pointed at another server with `?server=wss://host/ws`. Production builds ignore this parameter.

## Verifying the deployment from two computers

1. `curl https://<your-host>/health` → `{"ok":true,"protocol":1}`.
2. Computer 1: open the game URL → **PLAY → ONLINE VERSUS** → status must read `ONLINE`. **CREATE ROOM**, note the 5-character code.
3. Computer 2 (different network if possible, e.g. a phone hotspot): open the same URL → **ONLINE VERSUS → JOIN ROOM** → enter the code.
4. Both pick a fighter and press **READY** → 3-second countdown → the match starts on both screens.
5. Check: movement and hits appear on both screens; health bars, timer and round results match; the latency badge shows the round-trip time.
6. Disconnect test: on computer 2 turn Wi-Fi off for a few seconds mid-match → computer 1 shows *OPPONENT DISCONNECTED* with a countdown; when the network returns, computer 2 reconnects automatically and the match resumes. Alternatively **reload** computer 2's tab and go to **ONLINE VERSUS** within 20 s — the resume token kept in the tab's sessionStorage reclaims the seat. (Closing the tab discards the token; then the opponent wins by forfeit after 20 s.)
7. After the match, both press **REMATCH** to play again.

If the lobby says *SERVER UNAVAILABLE*: check the health URL, that the page is HTTPS and the socket WSS, and that `ALLOWED_ORIGINS` contains the exact page origin (scheme + host, no trailing slash). Server logs show `rejected origin ...` when the origin is the problem.
