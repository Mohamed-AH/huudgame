# CLAUDE.md — HUUD Family Arcade

Working notes for any Claude Code session on this repo. **Read this file first.**
It is the single source of truth for *what is done*, *what is next*, and *how to resume safely*.

---

## 1. What this repo is

Two things live here:

1. **`huud-website.html` + `huud-styles.css`** — HUUD's existing static fan-site
   (gold/amber theme, Tailwind pre-compiled into `huud-styles.css`, a 2D coin-catcher
   mini-game embedded inline). Do not restructure it; only additive edits.
2. **HUUD Family Arcade** — a 14-player, cross-platform (mobile / iPad / PC)
   networked game suite built from `masterplan.md`: Three.js clients + an
   authoritative Node.js WebSocket server, hosting 13 party games.

`masterplan.md` is the original brief. It is a *specification*, not code, and is
never edited — treat it as read-only requirements.

---

## 2. Resume-safe protocol (READ BEFORE DOING ANYTHING)

This build is long. A session may be interrupted at any point. To restart safely:

1. `git log --oneline -15` — every completed unit of work is its own commit.
2. Read **§5 Phase tracker** below. The first phase not marked `DONE` is the next task.
3. `npm install` (root) if `node_modules/` is missing.
4. `npm run check` — `verify` (parse every file, registries agree), `smoke`
   (real server, 4 bot sockets, a full round of every registered game), then
   `browser` (real Chromium, three players, every game played on desktop and at
   phone width). All three must pass before any commit.
5. `npm start` then open `http://localhost:8080/play/` to sanity-check the lobby.
6. Continue from the first non-`DONE` phase. Update §5 **in the same commit** that
   completes the work, so the tracker and the tree never disagree.

**Rules that keep restarts cheap:**

- One phase (or one game) per commit. Never leave a half-written game committed —
  if a game is partially done, mark it `WIP` in §5 with a note on exactly what remains.
- Never break the lobby. `npm run check` must pass before every commit.
- A game is `DONE` only when: server module + client module exist, it is listed in
  both registries, `npm run check` passes with that game exercised, and it has an
  entry in `docs/GDD.md`.
- Additive edits only to `huud-website.html`; never reformat it wholesale.

---

## 3. Architecture

```
shared/protocol.js      Message types + constants shared verbatim by both sides (ESM).
shared/palette.js       The 14 player colors / slot names.

server/src/index.js     HTTP static server + WebSocket upgrade. Entry point.
server/src/room.js      Room: 14 slots, host, phase machine, tick loop, broadcast.
server/src/rooms.js     Room registry (create / join by code / reap empty).
server/src/player.js    Connected player + per-socket send helpers.
server/src/games/       One authoritative module per game + registry.js.
                        registry.js imports every game once at boot; a game that
                        throws is skipped and logged, never fatal.

tools/verify.js         Parse + registry cross-check.
tools/smoke.js          Real server, real sockets, one full round per game.

client/index.html       Arcade shell: lobby UI, HUD chrome, <canvas>, importmap.
client/js/main.js       Boot: net -> lobby -> load game module -> run loop.
client/js/net.js        WebSocket client, reconnect, latency, message routing.
client/js/engine.js     Three.js renderer/scene/camera, DPR cap, resize, dispose.
client/js/input.js      Unified touch + pointer + keyboard; virtual joystick.
client/js/hud.js        Scoreboard (14), timer, banners, toasts, connection state.
client/js/lobby.js      Join screen, room code, roster, game picker, ready-up.
client/js/lib/build.js  Shared low-poly primitives, avatars, nameplates, arena floors.
client/js/lib/interp.js SnapshotBuffer (renders 100ms in the past), damp, lerpAngle.
client/js/lib/fx.js     Pooled InstancedMesh particles + synthesized sound.
client/js/lib/crew.js   One avatar per player, interpolated from [slot,x,z,rot,...]
                        rows, plus the shared chase camera. Used by every game where
                        people walk or drive.
client/js/games/        One client module per game + registry.js.
```

### Authority model
The server owns all truth: RNG, timers, scores, hit validation, collisions.
Clients send intent (`input` / `action`) and render interpolated snapshots.
Never compute a score or a winner on the client.

### Server game module contract (`server/src/games/<id>.js`)
```js
export const meta = { id, title, minPlayers, maxPlayers, tickRate, roundSeconds, mode };
export function create(room) {
  return {
    start(),                    // called once when phase -> playing
    tick(dt, now),              // authoritative step; return void
    onInput(player, msg),       // continuous intent (movement axes, aim)
    onAction(player, msg),      // discrete intent (throw, place, guess)
    onJoin(player), onLeave(player),
    snapshot(),                 // broadcast payload (small, per tick).
                                // MUST include `tl` (seconds left) - the HUD timer
                                // on every client is driven by it and nothing else.
    fullState(player),          // one-shot payload on join / on start
    isOver(), results(),        // [{id, score, ...}] sorted desc
    dispose(),
  };
}
```

### Client game module contract (`client/js/games/<id>.js`)
```js
export const meta = { id, title, blurb, emoji, controls: {touch, keyboard} };
export function create(ctx) {           // ctx = {THREE, scene, camera, renderer, net, input, hud, selfId, players, lib}
  return {
    async build(fullState),   // construct scene graph
    onState(s), onEvent(e),   // server pushes
    update(dt, now),          // per-frame: interpolate + animate only
    resize(w, h),
    dispose(),                // MUST dispose geometries/materials/textures
  };
}
```

### Non-negotiable technical constraints (from `masterplan.md`)
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`.
- `touch-action: none` on the canvas; unified pointer events.
- Low draw calls: `InstancedMesh` for repeated props, shared materials, object pools.
- No shadow maps on the mobile path; ambient + hemisphere + one directional light.
- Every `dispose()` must release geometry, material, and texture GPU memory.
- Support up to 14 concurrent players per room.

---

## 4. Commands

| Command | What it does |
|---|---|
| `npm install` | Installs `ws` (server) and `three` (served to the client from `node_modules`). |
| `npm start` | Runs the arcade on `http://localhost:8080` (override with `PORT`). |
| `npm run verify` | Syntax-parses every JS file and checks both game registries agree. |
| `npm run smoke` | Boots the server on a scratch port and plays every registered game with bot clients. Pass game ids to narrow it: `node tools/smoke.js mango-target`. |
| `npm run browser` | Opens the arcade in real Chromium with three players, plays every built game, and checks for console errors, phone-width overflow, draw-call budget and GPU leaks. |
| `npm run check` | `verify`, `smoke`, then `browser`. This is the pre-commit gate. |

`three` is served by the server at `/vendor/three/` straight out of `node_modules`,
so the client uses a bare `import ... from 'three'` via an importmap. No CDN.

---

## 5. Phase tracker

Status values: `TODO` / `WIP` / `DONE`.

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Foundations: layout, `CLAUDE.md`, GDD, protocol doc, package.json, verify script | DONE | |
| 1 | Server core: rooms, 14 slots, phase machine, tick loop, static serving | DONE | `tools/smoke.js` added alongside |
| 2 | Client core: engine, net, input, HUD, lobby, game loader | DONE | `tools/browser.js` added alongside |
| 3 | Game 1 — Guess a Number | DONE | |
| 4 | Game 2 — Voxel Sandbox (Minecraft) | DONE | Terrain is generated from the seed on both sides; only mutations cross the wire |
| 5 | Game 3 — Car Race | DONE | Track geometry lives in `shared/track.js` so the road you see is the road you may drive on |
| 6 | Game 4 — Mango Target | DONE | |
| 7 | Game 5 — Baking Kitchen | DONE | `client/js/lib/crew.js` added here and reused by every walking game |
| 8 | Game 6 — Ice Cream Inc. | DONE | Found the reserved-wire-key bug; see docs/PROTOCOL.md |
| 9 | Game 7 — Train Race | DONE | |
| 10 | Game 8 — Baby Cleaning | TODO | |
| 11 | Game 9 — Bus Cleaning | TODO | |
| 12 | Game 10 — Collecting Car Coins | TODO | |
| 13 | Game 11 — Guess Animal | TODO | |
| 14 | Game 12 — Science Game | TODO | |
| 15 | Game 13 — Barber Game | TODO | |
| 16 | Integration: link the Arcade from `huud-website.html`, README, final polish | TODO | |

---

## 6. Conventions

- ESM everywhere (`"type": "module"`), Node 22, **zero build step** — the browser
  loads the source files as written. No bundler, no transpiler, no TypeScript.
- 4-space indent in `.js`, single quotes, semicolons.
- Game ids are kebab-case and identical on both sides (`guess-number`, `mango-target`).
- Keep per-tick payloads small: short keys, numbers rounded to 2 decimals.
- **`t` and `n` are reserved wire keys.** Never name a game payload field `t` (message
  type) or `n` (action sequence). Doing so used to rewrite the message type silently;
  `net.js` now sets them last so it cannot, but the field is still lost.
- Comments explain *why*, not *what*. Match the density of surrounding code.

### Per-game checklist (follow this for every game)

1. `server/src/games/<id>.js` — rules, scoring, and a `snapshot()` carrying `tl`.
2. `client/js/games/<id>.js` — scene, controls, and a `dispose()` that releases every
   cloned material and canvas texture the shared cache never saw.
3. Add a bot script for the game in `ACTIONS` in `tools/smoke.js`, or its scoring path
   is never exercised by any test.
4. `node tools/verify.js && node tools/smoke.js <id> && SHOTS=1 node tools/browser.js <id>`.
5. **Look at `.shots/<id>.png`.** Every game so far has needed camera framing fixed
   after seeing the first real frame; the tests pass long before the shot looks right.
6. Mark the phase DONE in §5 and commit.

### Framing lessons already paid for (do not relearn these)

- **Aim the camera at the near ground, not at the scenery.** Pointing the look axis
  at the interesting thing in the distance flattens the pitch and pushes the players
  off the bottom of the frame. Look at a point a few units in front of the near edge
  of the action instead.
- **Space 14 entities at least 1.9 units apart.** Any arc tight enough to frame
  nicely puts a full room shoulder to shoulder, and adjacent floor pads merge into a
  single dark band.
- **Always add `build.skyDome()`.** A scene without one is half flat black.
- **Tint the rig per game** with `ctx.engine.setLighting({hemi, sun, sky, ground})`.
  A pastel parlour and a night race cannot share one exposure; `clearRoot()` restores
  the defaults so a game never has to undo it.
- **Build all 14 seats/podiums/pads, occupied or not.** A family of four should see a
  game show with room to spare, not an empty ring.
- **No nameplate over your own head** - in third person it sits on the lens.
- **Only send what moves.** Fixed scenery goes in `fullState()`; state changes to it
  are events. Per-tick snapshots carry moving things and nothing else.
