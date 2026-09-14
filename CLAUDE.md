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
4. `npm run check` — `verify` (parse every file, registries agree) then `smoke`
   (boots the real server, drives 4 bot clients through a full round of every
   registered game). Both must pass before any commit.
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
client/js/lib/          Shared helpers: interpolation, pooling, geometry, audio.
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
    snapshot(),                 // broadcast payload (small, per tick)
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
| `npm run check` | `verify` then `smoke`. This is the pre-commit gate. |

`three` is served by the server at `/vendor/three/` straight out of `node_modules`,
so the client uses a bare `import ... from 'three'` via an importmap. No CDN.

---

## 5. Phase tracker

Status values: `TODO` / `WIP` / `DONE`.

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Foundations: layout, `CLAUDE.md`, GDD, protocol doc, package.json, verify script | DONE | |
| 1 | Server core: rooms, 14 slots, phase machine, tick loop, static serving | DONE | `tools/smoke.js` added alongside |
| 2 | Client core: engine, net, input, HUD, lobby, game loader | TODO | |
| 3 | Game 1 — Guess a Number | TODO | |
| 4 | Game 2 — Voxel Sandbox (Minecraft) | TODO | |
| 5 | Game 3 — Car Race | TODO | |
| 6 | Game 4 — Mango Target | TODO | |
| 7 | Game 5 — Baking Kitchen | TODO | |
| 8 | Game 6 — Ice Cream Inc. | TODO | |
| 9 | Game 7 — Train Race | TODO | |
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
- Comments explain *why*, not *what*. Match the density of surrounding code.
