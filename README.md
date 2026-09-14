# HUUD Family Arcade

HUUD's website, plus a **14-player, cross-platform 3D party arcade** built from
[`masterplan.md`](masterplan.md): thirteen games, one link, one 4-letter room code.
Phones, iPads and laptops all play at the same time. No installs, no accounts.

```
npm install
npm start
```

| URL | What it is |
|---|---|
| `http://localhost:8080/` | HUUD's site (with the arcade linked from the nav) |
| `http://localhost:8080/play/` | The Family Arcade |

Everyone on the same wifi opens the machine's address (`http://192.168.x.x:8080/play/`),
one person presses **Open a new room**, and reads the 4-letter code out loud. That is
the whole setup.

---

## The games

| | Game | Mode | The idea |
|---|---|---|---|
| 🔢 | Guess a Number | free-for-all | Crack a vault, 1–100. Higher, lower, hotter, colder. |
| 🧱 | Voxel Sandbox | team | Mine and stack a blocky island to match a floating blueprint. |
| 🏎️ | Car Race | free-for-all | Three laps of a stadium circuit with speed pads and oil. |
| 🥭 | Mango Target | free-for-all | Drag, aim, throw. Golden mangoes are worth five. |
| 🧁 | Baking Kitchen | team | A relay of stations; one cook can carry one thing. |
| 🍦 | Ice Cream Inc. | free-for-all | Hold to swirl, stop on the line, add the topping. |
| 🚂 | Train Race | free-for-all | Fourteen tracks. Mind the throttle, mind the boulders. |
| 🧸 | Baby Cleaning | team | Toys in the matching bins, stains scrubbed, against a clock. |
| 🚌 | Bus Cleaning | team | Blast the grime off a very large bus, together. |
| 🪙 | Collecting Car Coins | free-for-all | Grab coins; bump the leader and watch them spill. |
| 🦒 | Guess Animal | free-for-all | A silhouette fills in. Guess early, score four times more. |
| 🧪 | Science Game | free-for-all | Mix elements, hit the recipe, set off the reaction. |
| 💈 | Barber Game | free-for-all | Trim, grow and dye a silly head to match the card. |

---

## How it is built

No bundler, no transpiler, **no build step**. The browser loads the source files
exactly as they are written; `three` is served straight out of `node_modules` through
an importmap, so there is no CDN either.

```
shared/     Code both halves import verbatim: the wire protocol, the 14-slot palette,
            and the geometry each side has to agree on (the race track, the voxel
            world, the bus, the hair rig).
server/     An authoritative WebSocket server. Rooms of 14, a phase machine, and one
            module per game that owns all the truth: RNG, timers, scores, hit tests.
client/     Three.js. Renders interpolated snapshots and sends intent - never a
            position, never a score.
tools/      verify (parse + registry), smoke (real sockets), browser (real Chromium).
docs/       The game design document and the exact wire protocol.
```

The server owns everything that matters. Clients send *intent* - axes, an aim vector,
a button edge - and render what comes back, 100 ms in the past, interpolated between
the two snapshots that straddle that moment. That delay is what makes fourteen players
look smooth over ordinary home wifi.

Performance is budgeted for the worst phone in the house: device pixel ratio capped at
2, no shadow maps anywhere, and anything that repeats is an `InstancedMesh`. A voxel
island of three thousand blocks, a 720-unit railway valley and a bus covered in 396
patches of grime are each about one draw call.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the arcade on port 8080 (`PORT` to override). |
| `npm run dev` | The same, restarting on file changes. |
| `npm run verify` | Parses every source file and checks both game registries agree. |
| `npm run smoke` | Boots the real server and plays every game with bot sockets. |
| `npm run browser` | Opens the arcade in real Chromium with three players, one at phone size, and checks console errors, layout overflow, draw-call budget and released GPU memory. |
| `npm run check` | All three. This is the gate before any commit. |

`SHOTS=1 npm run browser` also writes a mid-round screenshot of every game to `.shots/`.

## Working on it

[`CLAUDE.md`](CLAUDE.md) is the working document: architecture, the module contracts a
new game has to satisfy, the per-game checklist, and the camera and framing lessons
already paid for. Read it before adding a game.
