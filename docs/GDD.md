# HUUD Family Arcade — Game Design Document

Phase 1 deliverable for `masterplan.md`. This document is the contract the code in
`server/src/games/` and `client/js/games/` implements, and it is kept in step with
what actually shipped - where a number here disagreed with the code, the number here
was the one that was wrong and has been corrected. Sections 1–6 are the shared
framework; section 7 covers each of the 13 games.

---

## 1. Product

A single web address the whole family opens at once — phones, iPads, laptops — that
drops everyone into a shared room and lets one person (the host) pick from 13 party
games. Up to **14 players** per room. No installs, no accounts, no build step.

Design pillars, in priority order:

1. **Everyone can join in 10 seconds.** Open the link, type a name, enter a 4-letter
   room code. Nothing else.
2. **Nobody is ever stuck watching.** Every game seats all 14 simultaneously; late
   joiners are folded into the running round rather than queued.
3. **Works on the worst phone in the house.** 60fps is a goal, 30fps is the floor,
   and the floor is what the art direction is budgeted against.
4. **Rounds are short.** 60–120 seconds, then a podium, then straight into the next
   pick. A family loses interest faster than it loses a match.

---

## 2. Core loop

```
    LOBBY  ──host picks a game──▶  COUNTDOWN (3.2s)  ──▶  PLAYING (60–120s)
      ▲                                                        │
      └──────────── RESULTS (podium, 20s) ◀────────────────────┘
                         │
                    host: restart (same game) or back to lobby
```

- **Lobby.** Roster of the 14 slots, each with its color and ready state. The host
  browses a grid of game tiles; picking one previews its blurb and controls to everyone.
- **Countdown.** The scene is already built and lit; the countdown exists to let
  clients finish loading geometry and to let players get their thumbs in position.
- **Playing.** Server-authoritative. Clients send intent, render interpolated state.
- **Results.** Podium for the top three, full 14-row table underneath, confetti.

Two competitive shapes are used, chosen per game:

| Mode | Meaning | Games |
|---|---|---|
| `ffa` | Free-for-all; individual scores ranked | 1, 3, 4, 6, 7, 10, 11, 12, 13 |
| `coop` | One shared family score vs. the clock; everyone wins or nobody does | 2, 5, 8, 9 |

Co-op games still track per-player contribution so the podium has something to show,
but the headline number is the family's.

---

## 3. Controls

One input layer serves all three device classes. It normalizes everything to:

```
axes    { x, y }        -1..1   movement / steering / aim
look    { dx, dy }      delta   camera or cursor
buttons { a, b, ... }   bool    edge-detected, with `pressed`/`released` events
pointer { x, y, down }  0..1    normalized viewport position for tap/drag games
```

| Device | Movement | Primary action | Secondary |
|---|---|---|---|
| Phone / iPad | Left-thumb virtual joystick (canvas overlay, appears where you touch) | Right-thumb A button, or tap the world | Long-press, or the B button |
| PC keyboard | `WASD` / arrow keys | `Space` | `E` / `Shift` |
| PC mouse | — | Left click | Right click |

`touch-action: none` on the canvas kills iOS scroll-bounce and double-tap zoom.
Games that are pure UI (Guess a Number, Guess Animal) hide the joystick and show a
DOM control panel instead; games that aim (Mango Target, Bus Cleaning) use drag-to-aim
on touch and pointer position on desktop. Nothing requires two hands on a phone
except the drag-to-aim games, which are explicitly one-thumb-friendly by using a
short drag rather than a sustained hold.

---

## 4. Art direction

One cohesive look across all 13 games so the suite reads as a single product:
**low-poly, flat-shaded, saturated, no textures.** Everything is built from box,
cylinder, sphere, cone and lathe primitives with `MeshLambertMaterial` — cheap,
mobile-safe, and impossible to make look broken at low resolution.

Shared palette:

| Role | Hex | Use |
|---|---|---|
| Night | `#0b0c10` | Background / fog |
| Deep | `#131722` | Ground planes, far geometry |
| Gold | `#ffb703` | House accent, UI trim, the winner |
| Amber | `#f59e0b` | Buttons, highlights |
| Cream | `#f3f4f6` | Text |
| Player slots | see `shared/palette.js` | 14 maximally-separated hues |

Lighting is fixed for every game: `HemisphereLight(sky, ground, 0.85)` +
one `DirectionalLight` at 0.55 with **shadows off**. Depth reads from the flat-shaded
facets and from a baked-looking radial ground gradient, not from shadow maps.
Celebration is carried by particles (pooled `InstancedMesh` sprites) and by the
site's existing `canvas-confetti` on the results screen.

---

## 5. HUD

```
┌────────────────────────────────────────────────────────────┐
│ ROOM WXYZ   ◈ 48ms          ⏱ 1:04            [ ≡ scores ] │  top bar
│                                                            │
│                    « the 3D scene »                        │
│                                                            │
│  ┌─ banner ─────────────────┐                              │
│  │  ROUND 2 — GUESS AGAIN   │   ← transient, 2s, center    │
│  └──────────────────────────┘                              │
│                                                            │
│ ╭─────────╮                                      ╭───────╮ │
│ │ joystick│                                      │   A   │ │  touch only
│ ╰─────────╯                                      ╰───────╯ │
└────────────────────────────────────────────────────────────┘
```

- **Top bar** — room code, live latency dot (green <80ms, amber <180ms, red above),
  round timer, and a scoreboard toggle.
- **Scoreboard** — all 14 rows always present. Empty slots are dimmed placeholders so
  the family can see who has not joined yet. Each row: color chip, name, score,
  connection state. Sorted by score during play, by slot in the lobby.
- **Toasts** — bottom-center, stacked, 1.6s: "Dad hit a mango! +50".
- **Connection** — a full-screen amber veil with "Reconnecting…" on socket loss; the
  client keeps rendering the last state underneath so it never goes black.

---

## 6. Network

See `docs/PROTOCOL.md` for exact payloads. Summary:

- Transport: raw WebSocket (`ws`), JSON frames, no dependencies on the client side.
- The server runs each game at its own tick rate (5–20Hz) and broadcasts a snapshot
  per tick. Clients buffer two snapshots and render 100ms in the past, linearly
  interpolating position and rotation — which is what makes 14 players look smooth
  over home wifi.
- Client input is sent at most 20Hz and is *intent only* (axes, aim vector, a button
  edge). The server never trusts a client-supplied position, score, or hit result.
- Discrete actions are idempotent and carry a sequence number, so a duplicate frame
  after a reconnect cannot double-score.
- Late joiners get `START` with a `fullState` payload and slot into the live round.
- Flood guard: 90 frames/sec/socket and 4KB/frame, both enforced in `server/src/player.js`.

---

## 7. The games

Each entry gives concept, the loop, scoring, controls, and what the server owns.

### 7.1 Guess a Number — `guess-number` · ffa
14 podiums in a ring around a floating mystery vault. Each round the server rolls a
secret number in `1..100`. Players type a guess on a numeric keypad; the vault
answers with HIGHER / LOWER / and a heat glow (cold blue → hot red) scaled to the
distance. First correct guess wins the round and detonates the vault in particles.
Everyone keeps guessing until the round timer ends so nobody is eliminated.
**Score:** 100 for the win, minus 4 per guess taken; 25 consolation for anyone within
5 of the answer. Best of 5 rounds. **Server owns:** secret, guess evaluation, hint
text, round state machine. **Controls:** on-screen keypad (all devices), physical
digits + Enter on PC.

### 7.2 Voxel Sandbox — `voxel-sandbox` · coop
A 28×12×28 bounded blocky world rendered as a single `InstancedMesh` with per-instance
colour — the whole island in one draw call. 14 players mine and place from a 6-block palette. A
build target (a silhouette shown on a board) gives the family a goal; matching voxels
light up. **Score:** shared completion percentage of the target, plus a personal
"blocks placed correctly" tally. **Server owns:** the voxel grid, reach validation
(6 blocks), grid mutations, player positions. The terrain itself never crosses the
wire: both sides generate it from the round seed. **Controls:** joystick + tap to mine /
long-press to place; WASD + Space + left/right click on PC.

### 7.3 Car Race — `car-race` · ffa
A wide 4-lane oval with speed pads, oil slicks and cone clusters. 14 low-poly cars,
3 laps. Server integrates a simple arcade car model (throttle, steering, grip, drag)
and validates lap checkpoints so nobody can cut the infield. **Score:** 200 for P1
scaling to 40 for P14, plus a fastest-lap bonus. **Server owns:** physics, collisions,
checkpoints, lap times, placement. **Controls:** touch D-pad + gas; arrows/WASD on PC.

### 7.4 Mango Target — `mango-target` · ffa
Players stand in a semi-circle facing an orchard. Mangoes ripen on branches and
occasionally drop; players drag to aim and release to throw. Projectiles are pooled.
A golden mango worth 5× appears every ~20s. **Score:** ripe 10, dropping 25, golden
100, and a 3-hit streak multiplier. **Server owns:** target spawn/ripen table,
ballistic resolution (the client sends an aim vector and power, the server simulates),
hit validation, streaks. **Controls:** drag-to-aim + release; mouse aim + click on PC.

### 7.5 Baking Kitchen — `baking-kitchen` · coop
A shared kitchen with 5 station types (prep, mix, oven, decorate, plate). Orders
queue on a ticket rail; each order is a chain of station steps. Players carry one
item at a time and must hand off between stations, which is what makes 14 cooks
funny rather than redundant. **Score:** family total from completed orders, minus
burnt items; per-player "steps completed". **Server owns:** order queue, station
occupancy and progress timers, item states, the burn timer. **Controls:** joystick +
tap-to-interact; WASD + E on PC.

### 7.6 Ice Cream Inc. — `ice-cream` · ffa
Each player owns a dispenser. Customer cards fly in: flavor, swirl height, topping.
Hold to dispense (swirl mesh grows in real time), release, tap a topping, serve.
Overfill and the cone collapses. **Score:** accuracy percentage × speed bonus.
**Server owns:** order generation, the authoritative fill level while held, accuracy
scoring, timers. **Controls:** hold-to-dispense button + topping taps; number keys
1–4 and hold `Space` on PC.

### 7.7 Train Race — `train-race` · ffa
14 parallel tracks through a stylized valley. Continuous forward motion; players
manage a throttle (overheat if held at max) and hop lanes to dodge boulders and grab
boost crystals. **Score:** finish placement plus crystals collected. **Server owns:**
position integration, lane occupancy, obstacle table (seeded, identical for all),
collision, finish order. **Controls:** throttle slider + lane buttons; up/down +
left/right on PC.

### 7.8 Baby Cleaning — `baby-cleaning` · coop
A nursery with 56 scattered toys in 4 categories and 12 floor stains. Carry toys to
the matching bin; stand on a stain and hold to scrub. Sorting into the *wrong* bin
still clears the floor but scores nothing, which keeps small children in the game.
**Score:** family tidiness percentage against a 120s clock. **Server owns:** toy
positions and carry state, bin contents, per-stain scrub progress. **Controls:**
joystick + action button; WASD + E on PC.

### 7.9 Bus Cleaning — `bus-cleaning` · coop
A giant double-decker covered in a 22×6 grime grid on each of three faces — 396 cells
in one `InstancedMesh`, each tile shrinking and fading as it is washed. Players aim a pressure washer;
the server clears grid cells within the spray cone. Interior trash spawns too.
**Score:** shared clean percentage; per-player cells cleared. **Server owns:** the
dirt grid, spray cone resolution, trash pickup. **Controls:** joystick to move +
drag to aim the hose; WASD + mouse look/hold on PC.

### 7.10 Collecting Car Coins — `coin-cars` · ffa
A neon bowl arena. Coins, multipliers and shields spawn on a grid. Bumper physics:
ramming a player with coins knocks a few loose for anyone to grab. Shields make you
immune for 6s. **Score:** coin balance at time-up. **Server owns:** spawn grid,
vehicle physics, bump impulses and coin theft, balances. **Controls:** joystick /
steering; WASD on PC.

### 7.11 Guess Animal — `guess-animal` · ffa
A spotlit turntable reveals a low-poly animal in stages: silhouette → outline →
partial color → full. Four choices appear; guessing early is worth more. 14 seat pods
around the stage light up as their occupants lock in. **Score:** 100 at stage 1
falling to 25 at stage 4; a speed bonus for the first correct answer. 8 rounds. The client is sent the animal's *shape* and four names, never the mapping
between them — the table lives only on the server.
**Server owns:** the animal sequence (seeded), reveal state machine, answer
evaluation, scoring. **Controls:** tap a choice; keys 1–4 on PC.

### 7.12 Science Game — `science-lab` · ffa
A lab bench per player. A recipe card asks for a target color/reaction; players drag
element tiles into a beaker. Correct combinations trigger a synchronized 3D reaction
(volcano, sparks, anti-gravity bubbles) that everyone in the room sees on the central
display. **Score:** correct combinations, with a bonus for the rarer recipes.
**Server owns:** the recipe table, combination validation, the broadcast reaction
events, scoring. **Controls:** drag-and-drop (touch and mouse identical).

### 7.13 Barber Game — `barber-shop` · ffa
Each player gets a cartoon head whose hair is 108 instanced strands with per-strand
length and colour. A target style card shows the goal profile. Clippers shorten strands, spray
grows them, dye recolors them. At time-up every head is scored against the target and
paraded on a turntable. **Score:** match accuracy percentage. **Server owns:** the
strand length/color arrays, tool application, the accuracy algorithm, the showcase
order. **Controls:** drag to trim/grow/paint with a tool selector; mouse drag on PC.

---

## 8. Arena scale for 14

Every arena is sized so that 14 entities are visible and distinguishable at once:

- Movement games use a play field of roughly **30×20** to **40×40** units with spawn
  points spread on a ring or a line, at least 1.9 units apart — any tighter and a full
  room stands shoulder to shoulder and the floor markers merge into one dark band.
- Station games (kitchen, lab, barber) use a **per-player workstation** on an arc,
  with the camera framed on your own station and the others visible in the background.
- Stage games (guess a number, guess animal) use a **ring of 14 pods** at radius 11
  with the camera behind and above your own pod.
- Racing games use **14 lanes**; the camera chases your own vehicle.

Nameplates are `Sprite`s with a canvas texture, always facing the camera, scaled by
distance and culled beyond 30 units so a crowded arena does not turn into text soup.
