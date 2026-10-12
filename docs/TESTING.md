# Testing

All results below were produced on 2026-10-12 on Windows 11, Node 24.19, Google Chrome (system install, used by Playwright via `channel: 'chrome'`). Raw outputs are written to `docs/test-results/` when you run the commands locally; that folder is git-ignored and not part of the repository.

| Check | Command | Result |
|---|---|---|
| Type checking (client, server, scripts) | `npm run typecheck` | **pass** (0 errors) |
| Unit + integration tests | `npm run test` | **153 / 153 passed** in 10 files |
| Production build | `npm run build` | **pass** — client 317 kB JS (100 kB gzip) + ~16 MB sprite atlases, server bundle 74 kB |
| Browser end-to-end tests | `npm run test:e2e` | **36 / 36 passed** (4.0 min): 21 against the production build, 15 against the dev server (React StrictMode) |
| Production server smoke test | `node server/dist/index.js` + curl | `/health` ok, client + atlases served, SPA fallback, path-traversal attempts return `index.html` (no file leak) |
| Dev workflow | `npm run dev` | client on :5173, server on :8787, WebSocket handshake through the Vite proxy verified |

Integration tests open **real WebSocket connections** to a real server instance (`createGameServer` on an ephemeral port; the authoritative simulation runs 4× faster in tests). E2E tests drive the real production build in Chrome using **real key presses**; the online test uses **two separate browser contexts** (separate storage and sockets). No test injects damage or match results. One screenshot test raises Player 1's meter through the debug hook to capture the super banner; it is a visual capture, not an assertion about gameplay.

## Coverage against the requirements

### Unit (`tests/unit`)

| Area | Tests |
|---|---|
| Character registry | exactly the eight roster characters, removed character rejected and absent from assets, id lookup / rejection, every fighter has special + alternate special + super with sane frame data, distinct movesets |
| Sprite metadata | per character: atlas exists and matches metadata size, frame rects in bounds, every animation used by the moveset exists with valid frames/timing/phases, processed atlas contains real transparency |
| Animation timing | phase-tagged animations validated against frame data (roster test) |
| Movement | walk speeds, crouch hurtbox, dash / back-dash, arena bounds + pushbox separation, facing switch |
| Jump physics | apex height vs. formula, airtime, landing; forward jump travel |
| Hitbox collision | facing-relative → world conversion, overlap rules, whiff out of range |
| Attack timing | no hitbox during startup, first active frame equals startup, exact active count, none in recovery |
| Damage | exact damage once per single-hit move, every hit of multi-hit moves, projectiles hit at range, projectile clashes, simultaneous trades |
| Blocking | back-block mid with chip only, lows need crouch-block, overheads need stand-block |
| Hit-stun | stun duration then recovery, push-back, knockdown + invulnerable get-up |
| Combos | LP→HP→special cancel chain with exact scaled damage, combo reset, input buffering |
| Super meter | meter gain on hit/block, super requires and consumes full meter |
| Round & match results | KO → next round, timeout by health %, timer countdown, best-of-three winner, double KO |
| AI decisions | difficulty ordering, approaches, never idles, attacks in range, blocks more on hard than easy, anti-air/blocks jump-ins, uses specials, deterministic per seed, finishes matches on all difficulties |
| Room creation & capacity | code format, two-player capacity, room limit, empty/idle cleanup |
| Player readiness | fighter required, both ready → countdown, un-ready cancels |
| Network message validation | all valid messages accepted, 19 malformed variants rejected, invalid JSON / oversize rejected, name sanitising, snapshots exclude input state |
| Disconnect handling | pause on drop, resume on reconnect, forfeit after grace; stale input → neutral; replayed `seq` ignored |
| Client logic | default key bindings, P1/P2 key sets never overlap, HUD banners (ROUND / FIGHT / K.O. / WINS), combo counter, snapshot interpolation |

### Integration (`tests/integration/multiplayer.test.ts`) — the 13 required online scenarios

1 create room · 2 join with valid code · 3 reject invalid/unknown code · 4 reject third player · 5 both must be ready · 6 movement synchronised (same position on both clients for the same frame) · 7–8 attacks register and health is identical on both clients · 9–10 a full networked round and match (best of three) · 11 disconnect → pause → reconnect with resume token → continue → forfeit after grace · 12 rematch needs both votes and starts match N+1 · 13 malformed messages rejected, hello/version enforced, strike-out after repeated garbage, oversized frames dropped, flood rate-limited. Plus: clients cannot dictate state, leaving mid-match forfeits, empty rooms are removed, health endpoint.

### Controls, opponent selection and initialisation (`tests/e2e/controls.spec.ts`, prod and dev)

| # | Test |
|---|---|
| 1–3 | Picking Rick, Koala and Migo each auto-assigns a different opponent, shown by name and portrait on the VS screen. The match then starts with exactly those fighters, `keyboard-p1,ai` controllers, and reset health, meter, round and wins |
| 4–5 | A and D move immediately at FIGHT; a jump goes airborne and lands; S crouches and releasing returns to idle |
| 6–8 | F, G, V and B start LP, HP, LK and HK; recorded frames show startup, active and recovery, then idle |
| 9–11 | A heavy punch in range deals exactly its damage; the opponent enters hit-stun and is pushed back; a second attack works; an out-of-range attack does no damage |
| block | Holding back blocks a jab (blockstun, no damage) |
| 12 | With no player input, the CPU opponent moves and damages the player |
| 13 | Local P2 is `keyboard-p2`, stays still without input and moves with the arrows |
| 14 | Online: the two-browser test also asserts mode `online` with no AI |
| 15 | Restart keeps the opponent and resets phase, round, health and timer |
| debug | The panel shows correct values on dev and is absent from the production build |

Unit: `tests/unit/opponent.test.ts` (never the same fighter, all 8 others reachable, edge cases) and a dash-attack engine test.

### End-to-end (`tests/e2e`, Playwright + Chrome)

| Test | What it proves |
|---|---|
| main menu, how to play and options all work | title → menu, keyboard navigation, Escape back, move list paging, options toggle |
| character selection shows all eight fighters and starts a CPU match | all eight portraits (and no others) load real art, preview, difficulty, stage select, HUD names/timer/round |
| movement, attacks, health, timer and the pause menu (vs CPU) | key presses move the fighter, attacks reduce health, timer counts down, pause freezes the simulation, resume continues |
| local two-player: both keyboards control their fighter | WASD and arrows move both fighters simultaneously; P2 numpad attack damages P1 |
| knockout, results screen and rematch | two real KOs → results "PLAYER 1 WINS!" 2-0 → rematch resets round, wins and timer |
| online: create, join, ready up and fight | two browser contexts: create → invalid code error → join → ready gating → match on both → server-decided damage identical on both screens → remote movement visible → forfeit shows win screen |
| capture screenshots | renders title, select, match, super and hitbox views (`docs/screenshots/`) |

## Animation smoothness and title screen (measured)

* **Movement judder:** measured in Chrome at ~165 fps while walking. Raw 60 Hz positions stalled on 130 of 196 rendered frames and double-stepped on 56. With render interpolation there were 0 stalls and 0 double steps, and the step-size spread fell from 1.71 px to 0.22 px. Regression test: `tests/e2e/title.spec.ts` › "in-match movement renders smoothly".
* **Sprite position jumps:** sprites were anchored on the centroid of the feet, which move every frame of a run cycle. The body jumped 20–59 sheet px between consecutive run frames. With trunk anchoring, run cycles jump 3–16 px and walk cycles at most 10. Checked with onion-skin overlays and asserted per character in `tests/unit/animation.test.ts`.
* **Frame-rate-dependent effects:** particles, shake and stage lights advanced once per rendered frame (2.4× too fast at 144 Hz). They now advance per simulation frame.
* **Title demo:** `tests/unit/animation.test.ts` runs the director for 2 simulated minutes on three pairings. It asserts the fight never ends, has more than 20 exchanges, more than 20 hits, blocks, knockdowns, specials/supers and at least 6 different beat types, includes pauses but never idles over 3 s, and keeps fighters inside the stage. `tests/e2e/title.spec.ts` checks two different real roster fighters, real hits and blocks, an animating canvas, the logo above the fighters, instant menu input, a single loop across title → menu → mode select, the loop stopping when a match starts, and layout at 640×400, 1600×900 and 900×900.
* Tuning found by testing: the director re-spaced the fighters after almost every exchange, leaving some pairings with only 2 hits per 20 s. With tighter re-spacing rules, the worst of 168 pairing×seed runs has 5 hits per 20 s and the median is 10.

## Bugs found by the tests and fixed

* **Checkerboard visible behind Max Sanchez's flame-ring super.** Glow-tinted checker enclosed by the fire ring survived background removal. It is fixed in the asset pipeline (see ASSET_AUDIT, iteration 6). Regression coverage:
  * `tests/unit/transparency.test.ts` (26 tests):
    * every source sheet is fully opaque, so "it's a PNG" is never taken as proof of transparency;
    * the classifier's decisions match hand-labelled regions: three Max checker pockets and Jeremy's flame checker are removed; Koala's fur heads, Migo's wool and chest, and Rick's beard are kept;
    * in Max's `r3c5`, checker-coloured pixels are fully gone apart from fringe touching flame art, with zero isolated pixels;
    * fur, wool and beard sample points stay opaque;
    * attack frames are cropped whole and in order;
    * every frame's padding border is transparent.
  * `tests/e2e/sprites.spec.ts` (prod and dev): fires Max's super in a real match and counts checker-grey pixels on the game canvas around him on frame `r3c5`. The threshold is 400; the old atlas measured 1284 and the fixed atlas 153.
* **Flaky block test:** tapping forward to walk in could register a dash, and you can't block during a dash. The test now waits for a neutral state; it passed 8 of 8 repeats.

* **Player did not respond under `npm run dev` (critical).** The match runner created its keyboard listeners in its constructor but removed them in `detach()`. React StrictMode (development only) mounts, unmounts and re-mounts effects, so the listeners were removed permanently before play began. The AI kept fighting, so the match looked alive. Production builds were unaffected, which is why the original prod-only e2e suite missed it. Fixed by creating listeners in `attach()` (idempotent), with the same fix in the online runner. A second Playwright project now runs against the dev server.
* **Attacks pressed during a dash were dropped.** Tapping forward to walk in often counts as a double-tap dash, and the 8-frame input buffer expired before the 16-frame dash ended. A controls test caught it, failing 2 of 5 runs. Forward dashes now cancel into attacks from frame 3, and the test passes 6 of 6 repeats.
* **Duplicate WebSocket in dev.** The online lobby opened a second socket when StrictMode re-ran its connect effect. It now waits for the socket that is already opening.

* **Server crash risk:** an oversized WebSocket frame raised an unhandled `error` event on the socket. Fixed by attaching an error handler per socket.
* **Online names ignored:** a name typed after the lobby connected never reached the server. Fixed by sending `name` with `createRoom`/`joinRoom`.
* **AI could not block fast attacks** (reaction slower than startup) — added a proactive guard decision; hard AI now blocks more than easy (asserted).
* Several test races (waiting for a message that had already arrived) — fixed with state-based waits; the suite was run three times consecutively without failures.

## Not covered by automation

* Real internet latency/packet loss (tests run on localhost). The netcode has no client prediction; see README limitations.
* The Docker image was not built or run in this session (the Dockerfile is untested).
* Public deployment has not been performed (no hosting credentials).
* Audio is not asserted (WebAudio output is not observable in headless tests).
* Firefox/Safari were not tested; only Chrome.
