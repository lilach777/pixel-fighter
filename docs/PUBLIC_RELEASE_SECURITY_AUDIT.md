# Public Release Security Audit — Pixel Fighters: Arcade

| | |
|---|---|
| Initial audit | 2026-10-12, on the development repository |
| Remediation | 2026-10-12, in a separate clean release copy, published as a new repository with a single initial commit. A follow-up fix (F13) was found in the final pre-publication review and applied to the same single commit. |
| Status | All findings resolved. One item (F1) was resolved by owner confirmation. See "Remaining risks". |

No secret or credential values appear in this document.

## Summary of findings and resolutions

| # | Severity | Finding | Resolution |
|---|---|---|---|
| F1 | High | Rights to publish the character artwork (names, likenesses and logos) were undocumented | **Resolved by owner confirmation.** The owner confirmed permission for all included character artwork. The README states that the art is not covered by the code licence. |
| F2 | High | A character removed before release still had artwork in the development tree and its history | **Resolved.** The release contains none of its files or references, and the release repository starts with a fresh single commit, so the development history is not included. |
| F3 | Medium | A personal email address was recorded on every development commit | **Resolved for the release repository**, which is committed with the owner's GitHub no-reply address. The development repository's history is unchanged and still contains the old address; it must not be pushed. |
| F4 | Low | Local machine path and personal-folder details in the docs | **Resolved.** Replaced with generic wording. |
| F5 | Low | WebSocket origins open (`*`) by default, including in the deploy blueprint | **Resolved.** Production defaults to `self` and refuses `*`; the blueprint no longer sets `*`. |
| F6 | Low | `?server=` URL parameter could redirect players and their resume tokens | **Resolved.** The parameter works only in development builds; resume tokens are stored per server URL. |
| F7 | Low | No per-IP connection limit; room codes could be guessed | **Resolved.** Per-IP connection cap and per-connection room-attempt rate limit. |
| F8 | Info | Test hooks shipped in production builds | **Resolved.** Compiled in only for development or explicit e2e builds; a release build contains none. |
| F9 | Info | `/health` exposed load figures with an open CORS header | **Resolved.** Returns `{"ok":true,"protocol":1}` only, with no CORS header. |
| F10 | Info | No LICENSE file | **Resolved.** MIT licence for the source code, chosen by the owner. Character art excluded. |
| F11 | Info (functional) | A relative `CLIENT_DIST` made every static request return 403 | **Resolved**, with regression tests. |
| F12 | Info | Local tooling config tracked; docs linked to an ignored folder | **Resolved.** `.claude/` removed and ignored; the docs now say test outputs are generated locally. |
| F13 | Low | With `TRUST_PROXY=true`, the client IP was the **left-most** `X-Forwarded-For` entry, which clients control, so the per-IP cap could be bypassed (found in the final review) | **Resolved.** Explicit client-IP modes (`off` / `cloudflare` / `xff` + `TRUSTED_PROXIES`); the left-most entry is never trusted; the old boolean value is refused at startup. |

The initial audit found **no credentials of any kind**: no API keys, tokens, private keys, passwords, database URLs or `.env` files, in any commit or in the build output. `npm audit` reported 0 vulnerabilities. The release repository was re-scanned; results are below.

## What changed in the release copy

### Removed character (F2)
* Not included: the original sheet from the archive folder, the processed atlas, portraits, metadata and frame previews.
* Removed every textual reference: README, `docs/ASSET_AUDIT.md`, and tests. Tests now use generic unknown ids, plus a test asserting that character assets ship **only** for roster characters.
* Regenerated `docs/screenshots/06-debug-panel.png`. The old image showed the removed character's name and portrait in the HUD; text search alone would not have found it.
* Verified: case-insensitive search of every file in the release for the character's name returns no matches. The eight approved characters' processed assets are unchanged.

### Commit identity (F3)
* The release repository is a new `git init` with one commit. Its repository-local identity is the owner's GitHub no-reply address, supplied by the owner.
* The development repository and its history were **not** modified or deleted. It still contains the old address and must not be pushed or published. Rewriting the release repository does not remove anything from the development repository.

### Documentation (F4, F12)
* `docs/ASSET_AUDIT.md`: the local file path and the list of personal folders were replaced with generic descriptions.
* `docs/TESTING.md` now states that `docs/test-results/` is generated locally and git-ignored.
* All 11 relative links in the 9 Markdown files resolve.

### Server hardening (F5, F7, F9, F11)

| Area | Change | Files |
|---|---|---|
| Origins | `ALLOWED_ORIGINS` supports `self` (page host must equal the request `Host`). Default: `*` in development, `self` in production. `*` in production stops startup with a clear error. | `server/src/security/origin.ts`, `server/src/index.ts`, `render.yaml`, `.env.example`, `docs/DEPLOYMENT.md` |
| Connection limits | `MAX_CONNECTIONS_PER_IP` (default 16, HTTP 429 beyond it). The client IP comes from `server/src/security/clientIp.ts` according to `TRUST_PROXY` (see F13 below); `render.yaml` sets `TRUST_PROXY=cloudflare`. Rejections are logged with the resolved IP. | `server/src/security/clientIp.ts`, `server/src/networking/gameServer.ts`, `server/src/index.ts` |
| Room-code guessing | Create/join attempts: 6 quickly, then 1 every 3 s per connection (`rate_limited`). Together with the per-IP cap, this limits code guessing to a few attempts per second per IP. | `server/src/networking/gameServer.ts`, `docs/PROTOCOL.md` |
| Health | `{"ok":true,"protocol":1}`, `cache-control: no-store`, no CORS header | `server/src/networking/gameServer.ts` |
| Static files | `resolveStaticPath()` resolves relative roots and checks containment with `path.relative`. Traversal attempts, encoded variants and sibling-prefix paths cannot escape the root. Malformed escapes return 403. | `server/src/networking/gameServer.ts`, `server/src/index.ts` |

### Client hardening (F6, F8)
* `?server=` is honoured only when `import.meta.env.DEV` is true (`client/src/multiplayer/netClient.ts`).
* Resume tokens are stored under a key that includes the server URL, so a token is only ever sent to the server that issued it.
* `window.__PF` / `window.__PFDemo` exist only when `TEST_HOOKS` is true, which requires a dev build or `VITE_E2E=true` (`client/src/testHooks.ts`). The e2e configuration builds with that flag; `npm run build` does not.

### Licence and repository hygiene (F10, F12)
* `LICENSE`: MIT, copyright holder given as the owner's GitHub handle. `package.json` has `"license": "MIT"`. The README has a licence section excluding the character art.
* `.gitignore` now also covers `.env.*` (keeping `.env.example`), key and certificate files, `.claude/`, editor folders and OS files.
* `.claude/launch.json` (local tooling) and a stray temporary debug script found in the development tree were left out of the release.

## Verification of the release copy

| Check | Result |
|---|---|
| `npm ci` from lockfile | OK |
| `npm run typecheck` (client, server, scripts) | pass |
| Unit + integration tests (`npm run test`) | **172 / 172 passed** (12 files). Includes the security tests: origin policy, `self` matching and subdomain tricks, relative `CLIENT_DIST`, traversal containment, per-IP cap, origin rejection against a live server, room-attempt rate limit, minimal health, and the client-IP spoofing tests (F13). |
| Browser e2e (`npm run test:e2e`) | **35 / 35 passed** after the F13 fix (production build and dev server: single-player AI, local versus, two-browser online play on both builds, rematch, controls, title scene). The screenshot-capture spec was excluded from this run because it rewrites tracked images; it passed in the earlier full run (36 / 36). |
| Release build (`npm run build`) | pass. Test hooks in bundle: 0. `?server=` handling in bundle: 0. Source maps: 0. |
| Production smoke test (`NODE_ENV=production node server/dist/index.js`) | `ALLOWED_ORIGINS=*` refused at startup (exit 1). Default policy `self`: own origin accepted, foreign origin rejected with 403. `/health` minimal with no CORS header. Relative `CLIENT_DIST` serves the page and atlases (HTTP 200). |
| `npm audit` / `npm audit --omit=dev` | 0 vulnerabilities |
| Licences of installed packages | No GPL/AGPL/SSPL/non-commercial/unlicensed packages; shipped runtime packages are MIT |
| Markdown links | 11 relative links checked, 0 broken |

Repository-level checks (run on the staged tree before committing, and again on the commit):
* secret patterns: AWS, GitHub, OpenAI/Anthropic, Slack, Google, PEM private keys, JWT, credentialed database URLs, bearer tokens, password/secret/key assignments, Stripe, npm;
* personal email addresses and local machine paths;
* the removed character's name;
* `.env` files, `node_modules`, build output and test output.

All returned no matches. The final tracked file list contains only source, tests, docs, approved assets and configuration.

## F13 — Client IP behind a proxy (fixed after the final review)

**Problem.** `TRUST_PROXY=true` made the server use the left-most `X-Forwarded-For` entry as the client IP for the per-IP connection limit. Proxies such as Render's append to a client-supplied `X-Forwarded-For` instead of replacing it, so the left-most entry is chosen by the client. Sending a different forged value on each connection bypassed the 16-connection cap. Other limits (global connection cap, room-attempt rate limit, origin check) were unaffected.

**Why "use the last entry" would also be wrong on Render.** Render's chain is client → Cloudflare → Render load balancer → app. The header observed there was `<spoofed>, <client>, <Cloudflare address>, <internal 10.x address>`. The right-most entry is Render's internal address, and the number of proxy hops is not documented, so neither end of the list and no fixed hop count reliably identifies the client.

**Fix** (`server/src/security/clientIp.ts`). `TRUST_PROXY` is now an explicit mode:

| Mode | Client IP | Trust basis |
|---|---|---|
| `off` (default) | TCP peer address; all forwarding headers ignored | Nothing is trusted. Local development is unchanged. |
| `cloudflare` (Render; set in `render.yaml`) | `CF-Connecting-IP`: exactly one valid IP, otherwise the TCP peer | Written by Cloudflare's edge, which rejects requests that try to supply it. All Render web-service traffic passes through Cloudflare. |
| `xff` + `TRUSTED_PROXIES` | `X-Forwarded-For` read **right-to-left**, skipping listed proxies; the first unlisted address. The header is ignored unless the TCP peer is itself a listed proxy. Malformed entries fail closed. | Only addresses written by proxies you list are trusted; client-prepended entries are never reached. |

`TRUST_PROXY=true` (the old meaning), unknown values, and `xff` without `TRUSTED_PROXIES` stop startup with an explanatory error, so a misconfiguration cannot silently fall back to an unsafe mode. The server logs its client-IP source at startup and logs the resolved IP when the per-IP limit rejects a connection.

**Evidence for the Render behaviour** (external; not re-tested on a live Render deployment in this audit):
* Render (2026 article, "How Render handles DDoS attacks"): all inbound web-service traffic passes through Cloudflare and Render's load balancers.
* A third-party test on Render (github.com/johnbeynon/header-test): a spoofed `CF-Connecting-IP` was rejected by Cloudflare (403, error 1000); a spoofed `True-Client-IP` was overwritten; a spoofed `X-Forwarded-For` was kept with the real IP appended.
* A Render feedback thread reporting that Render appends to, rather than resets, a client-supplied `X-Forwarded-For`.

**Verification:**
* `tests/unit/clientIp.test.ts` (8 tests): mode parsing and refusals, IPv4-mapped normalisation, `off` ignores all headers, `cloudflare` ignores every `X-Forwarded-For` spoof and rejects duplicated or malformed `CF-Connecting-IP`, and `xff` right-to-left resolution (including spoofed trusted-range addresses, untrusted peers, multiple header lines and malformed entries).
* `tests/integration/multiplayer.test.ts`, against a live server with the limit set to 3:
  * Render-shaped headers with a different forged left-most `X-Forwarded-For` each time: the 4th–8th connections get HTTP 429, while a different real client is accepted.
  * The same check in `xff` mode with `TRUSTED_PROXIES`.
  * In `off` mode, forwarding headers are ignored.
* **Regression proof:** with the old left-most logic temporarily restored, both spoofing integration tests **fail**; with the fix they pass. (The source file was restored byte-identical afterwards.)
* **Production binary** (`NODE_ENV=production`, `TRUST_PROXY=cloudflare`): 16 connections from one client, each with a different forged `X-Forwarded-For`, were accepted; the 17th got HTTP 429; a different client was accepted. The log showed the real client IP.

**Recommended post-deploy check:** after deploying to Render, repeat the production-binary check against the live URL (more than 16 connections from one machine, each with a different forged `X-Forwarded-For`). Expect HTTP 429 after 16, and your real IP in the log line. See `docs/DEPLOYMENT.md`, "Client IP behind a proxy".

## Remaining risks and notes

* **Development repository:** it still contains the old commit history, the removed character's files and the personal email address. Keep it private and never push it. Publish only the release repository.
* **Character artwork rights (F1):** resolved on the owner's confirmation. This audit did not independently verify permissions.
* **`TRUST_PROXY=cloudflare` assumes all traffic arrives through Cloudflare.** That is true for Render web services according to Render, and is enforced by the platform rather than by this code. For self-hosting behind Cloudflare, the origin must be firewalled to Cloudflare's IP ranges; otherwise a client could connect directly and set `CF-Connecting-IP` itself. With `xff`, `TRUSTED_PROXIES` must list exactly the proxies you operate.
* **Netcode:** online play is server-authoritative; there are no player accounts and no stored personal data.
* **Copyright line:** the LICENSE names the owner's GitHub handle; change it if a different legal name should appear.

## Limitations

* Secret detection used regular expressions and manual review. It cannot prove the absence of secrets in unusual formats, and binary files were checked only visually and by filename, not for embedded metadata or text.
* No external scanning services were used, and nothing was pushed, so GitHub's own secret scanning has not run yet.
* `npm audit` reflects the advisory database on the audit date.
* A successful build and test run is not proof of security. The hardening above reduces specific risks; it is not a full penetration test of a deployed service.
