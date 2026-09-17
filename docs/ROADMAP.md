# HUUD Family Arcade — improvement roadmap

Findings from a full review of the site, the arcade shell and all 13 games, consolidated
and ordered. Every claim marked **verified** was reproduced against the code or at
runtime, not taken on trust.

The product test throughout: *fourteen people aged roughly 5 to 50, in one house, on
whatever devices they own, want to play together in under a minute and keep playing.*

---

## Why this order

The build was tested by three cooperative bots on a desktop viewport. Almost everything
below follows from that one fact, so the phases are ordered by **how far the truth is
from the test**, not by how interesting the work is:

1. **Phase 17 first, and it is tiny.** The harness cannot currently catch the worst bug
   class in the codebase. Fix the harness before fixing anything it should have caught,
   or the same bugs come back.
2. **Phases 18–19 are things that are broken right now** — features that have never
   worked, and the paths a real family hits in the first ten minutes.
3. **Phase 20 is the 14-player cliff.** Nothing in the suite scales its content to the
   roster; at fourteen, games are either over in a fifth of their round or starved.
4. **Phase 21 is portrait.** One fix in `engine.js` improves all thirteen games at once.
5. **Phases 22–24** are what turn thirteen rounds into an evening.

---

## Phase 17 — Make the harness able to see (do this first, ~half a day)

### 17.1 Unify frame construction, then enforce it
**Verified.** Three different spread orders exist for the same reserved-key hazard:

| Site | Order | Consequence |
|---|---|---|
| `client/js/net.js:157,163` | payload first, `t`/`n` last | safe |
| `server/src/room.js:121,125` | `t` first, `...data` last | a game emitting `t:` rewrites the message type |
| `tools/smoke.js:222` | `t`/`n` first, `...action` last | **bots send a different frame shape than the client** |

Because of row 3, a bot sending `{a:'tool', t:2}` produces `{"t":2,"n":1,"a":"tool"}` and
the server reads the tool correctly — while the real client produces
`{"a":"tool","t":"action","n":1}` and the server reads `'action'|0 === 0`. The harness is
blind in precisely the direction the client fails.

- Make `smoke.js` spread in the same order as `net.js`.
- Flip `room.emit`/`emitTo` to `{ ...data, t: S2C.EVENT, e: kind }` so the server has the
  same guarantee the client does.
- Add a rule to `tools/verify.js`: fail on a `net.action`/`net.input`/`room.emit` payload
  literal containing a bare or shorthand `t` / `n` key. **It must catch shorthand** —
  `{ a: 'tool', t }` is how the live bug is written, and a `t:` regex misses it.

### 17.2 Raise the bot count to 14
`tools/smoke.js:23` is `PLAYER_COUNT = 4`; `tools/browser.js:25` is `GUESTS = 2`. The
product's headline constraint has never been exercised. Bots are cheap — raise smoke to
14 and assert per-tick payload size while you are there (`docs/PROTOCOL.md` claims ~420
bytes for 14 players; make that a test, not a claim).

### 17.3 Assert the HUD layers do not overlap at phone width
Both reviewers found the same fault independently, and it is visible in committed
screenshots while `npm run check` passes. Mid-round, on the mobile guest, take
`getBoundingClientRect()` for `#hud-panel`, `#hud-toasts`, `#stick`, `#action-buttons`,
`#scorepad` and fail on any intersection between the panel/toast group and the control
group. A dozen lines against a whole class of bug.

### 17.4 Cover join, drop and rejoin
Neither tool ever joins mid-round, drops a socket, or fills a room past 14. Three of the
Phase 18 bugs survived exactly because of that gap. Add: a bot joining during `PLAYING`;
a bot that closes and reconnects; 14 bots plus a 15th expecting `room_full`; and a browser
page that joins with a wrong code and asserts a visible error.

---

## Phase 18 — Features that have never worked

### 18.1 Barber Game: SPRAY and DYE are dead — **verified at runtime**
`client/js/games/barber-shop.js:136` sends `net.action({ a: 'tool', t })`. The reserved
`t` is overwritten with `'action'`, and `'action'|0 === 0`, so **the tool is pinned to
clippers permanently**. `selectDye()` ends in `selectTool(2)`, so dye is dead too. Every
head starts at `lengths.fill(0.45)` and clippers only shorten, so of the six target
styles only `buzz` (0.14) is reachable — `bowl`, `side part`, `afro`, `spikes` and
`mohawk` are mathematically impossible.
**Fix:** rename the field on both sides (`k`), server `const k = msg.k | 0`. One line each.

### 18.2 Guess Animal: every animal stays on the turntable
`client/js/games/guess-animal.js:139` does `turntable.add(model)`; line 131 removes it
with `scene.remove(model)` — the parent is the turntable, so the removal is a no-op, and
the geometries are then disposed *while still being rendered*. By round three the
silhouette is a heap. The browser test never saw it because `ARCADE_MAX_ROUND_SECONDS`
keeps the smoke round inside round 1.
**Fix:** `model.parent?.remove(model)` before disposing.

### 18.3 Bus Cleaning: the camera parks on the roof
`client/js/games/bus-cleaning.js:206-213` hard-codes `y = 8.5`; the bus roof is at
`BUS.y1 = 7`. Stand on the `+z` side and turn toward the bus and the camera goal is
inside the footprint, 1.5 units above the roof. That is what `.shots/bus-cleaning.png`
actually shows — and the per-game checklist accepted it.
**Fix:** de-penetrate the camera goal against the bus footprint, the same way `tick()`
already de-penetrates the player server-side; raise the base height and look at the
panel being aimed at.

### 18.4 Science Game: a fizzle leaves the player in a dead UI
`server/src/games/science-lab.js:77` drops every action for 1200 ms after a fizzle, but
the client keeps pushing to its local `myBeaker` and painting chips. The player then
presses MIX with three chips showing, the server sees `length < 2`, and **nothing happens
at all** — no reaction, no message — until they find CLEAR. The authoritative beaker is
already on the wire and simply ignored for `selfSlot`.
**Fix:** in `onState`, reconcile `myBeaker` from the server rows for your own slot, and
disable the tray while `fizzling`.

### 18.5 Baby Cleaning: a leaver leaves an invisible, uncollectable toy
`server/src/games/baby-cleaning.js:186-190` resets the toy's position but never sets
`toy.by = null` or emits `drop`. The client scaled that instance to zero on `pick` and
never scales it back. Since `isOver()` needs 100 % tidiness, one disconnect can make the
round uncompletable.
**Fix:** mirror the voluntary-drop path at line 118 exactly.

---

## Phase 19 — Joining, and staying joined

### 19.1 Enter on the name field opens a **new** room — **verified**
`client/js/lobby.js:84` binds Enter to `createBtn`. Someone following a shared
`?room=ABCD` link gets the code pre-filled, is told "Ready to join ABCD — enter your
name", types it, presses Enter — and lands alone in a fresh empty room. `main.js:275`
focuses that exact field for that exact flow.
**Fix:** branch on whether the code field holds 4 characters.

### 19.2 A bad room code drops you into a fake, dead lobby — **verified by the reviewer**
`main.js:258-268` calls `showLobby()` before the server has answered. On a mistyped code
the `no_room` error is written into `#connect-status`, which is inside the now-hidden
connect screen. Measured: `lobbyHidden=false, roomCode="----", rosterRows=0`, error
invisible. With 14 people typing a code read aloud, someone *will* mistype it.
**Fix:** stay on connect until the first `ROOM` broadcast; surface errors there; add a
"no answer from the arcade" timeout.

### 19.3 A phone that sleeps loses its seat, its score and its screen
The reconnect ladder mints a **new** player id, so the room, slot, colour and score are
gone. Worse, the observed state is connect screen visible, `#hud` still visible on top of
it, and the 3D game still rendering underneath.
**Fix (two steps):** *(a)* as a stopgap, have `reconnected` call `teardownGame()` +
`hud.hide()` and pre-fill the code field. *(b)* properly: keep the player in the room for
~90 s on socket close with `connected = false` (the roster already renders that as
"away"), issue a `resumeKey`, persist `{code,id,key}` in `sessionStorage`, and accept a
`resume` on `hello`. This is the single most common event in a 14-person session.

### 19.4 Close the old socket before opening a new one
`net.js:57-63` assigns a new `WebSocket` without touching the old one or its handlers.
After a Leave-then-rejoin, two sockets are live; when the orphan closes it fires
`_scheduleReconnect()` and replaces `this.ws` with a socket in no room — ejecting a
player mid-game with no error.

### 19.5 The idle reaper closes rooms full of people — **verified**
`rooms.js:67` reaps on `lastActivity`, which is only bumped in `Room.handle()`
(`room.js:28,61,86,143`). `C2S.PING` is answered in `index.js` and never reaches the room.
Fourteen people sitting in the lobby for ten minutes — dinner, an argument about which
game — all get disconnected and the code dies.
**Fix:** skip any room with a connected player; the empty-room grace reap already handles
the real case.

### 19.6 Two smaller ones
- **Double-tapped Start leaks a tick interval per tap.** `room.js:196-243` is `async` and
  the phase is still `LOBBY` across the `await`, so the guard does not reject. Each
  continuation overwrites `this._timer`; the orphans tick forever. Add a `_starting` flag.
- **Mid-round joiners get `start` before `room`.** `crew.js:20` builds avatars from
  `ctx.players()`, which is empty until the `room` frame lands. It works today only
  because the dynamic `import()` is slower than the next frame — cache the module and the
  crew builds empty. Move `broadcastRoom()` above the `START` send in `room.js:add()`.

---

## Phase 20 — Fairness: the exploits and the score curves

Every one of these lets one family member spoil a round for the other thirteen.

| Game | Exploit | Fix |
|---|---|---|
| Voxel Sandbox | Mine-then-place one blueprint cell = **+11 per cycle, no cooldown** (`filled.delete` on mine, `!filled.has` on place) ≈ 380 pts/s | A `credited` Set a cell enters once and never leaves; 120 ms action cooldown |
| Guess a Number | No guess cooldown — type 1–100 in ~1.2 s and take every vault for a guaranteed 40 | 900 ms cooldown; reject guesses outside the player's own narrowed bracket |
| Ice Cream Inc. | `points += 30` for the topping is unconditional; spam-serving at ~75 pts/s beats a perfect cone at ~72 | `+= Math.round(30 * accuracy)`; reject serves under 0.15 height |
| Train Race | Crystals are consumed globally (`o.taken`), so only the leader collects the thing that exists as the *trailing* player's consolation | Per-train `got` Set |
| Barber Game | The client supplies `dt`, i.e. **the rate of work** — the server accepts a result, not an intent | Measure `dt` server-side from the last stroke time |
| Coin Cars | Spilled coins land under the rammer's wheels with no cooldown, so farming the slowest child pays as well as bumping the leader | 2.5 s victim shield; 1.5 s pickup lock on the rammer; make spill proportional (`15 %`) so ramming the leader is what pays |

And two score curves that leave children on zero:

- **Guess a Number:** at most 5 of 14 players ever score across 5 vaults. Add a sliding
  proximity prize (`30 × (1 − best/25)`) so a five-year-old guessing "50, 20, 90" finishes
  with a number on the board.
- **Guess Animal:** one lock-in per round, no retry, `[100,75,50,25]`. A child who guesses
  wrong eight times finishes on a literal zero while an adult banks 1000. Allow one
  re-guess at the current stage's value, soften to `[100,85,70,55]`, and give 10 points
  for locking in at all.
- **Baking Kitchen:** every step pays 10, plating pays 50 — so camping the SERVE counter
  beats the relay the game is built around. Split a 90-point bonus across everyone who
  touched the cake and cut plating to 15.
- **Baby Cleaning:** scrubbing pays 6.6 pts/s for holding a button; carrying pays ~3 pts/s
  for the navigational job. Invert it (correct bin 25, scrub multiplier 12→7).

---

## Phase 21 — The 14-player cliff

`create(room)` is handed the full roster and **nothing uses it** except one line in the
kitchen. Every content constant was tuned against three bots:

| Game | At 14 players today | Target |
|---|---|---|
| Baby Cleaning | 56 toys = 4 each; 12 stains evaporate in ~1.6 s. A 140 s round is ~25 s of game | `TOYS = 18 + 9n`, `STAINS = 1.6n` |
| Bus Cleaning | The whole bus is clean in **~5 s** of a 150 s round | Respawn grime every `2500/n` ms; stop in the last 25 s so 100 % is reachable |
| Coin Cars | ~1.5 pickups/s shared by 14 cars ≈ 13 coins each — a 14-way tie at 30 points | Initial `12+3.5n`, cap `18+6n`, interval `2000/n` |
| Mango Target | 28 targets stripped in ~10 s; 14 throwers then throw at bare branches | `ANCHORS_PER_TREE` 4→6; respawn `4000 − 220n` |
| Baking Kitchen | Pace scales but the 6-order **ceiling** does not, so 8 cooks are idle | `maxOrders = 3 + ceil(n/1.5)`; add a third decorate and plate bench |
| Voxel Sandbox | Blueprints are 30/72/115 cells — an arch round ends in ~20 s | Normalise to 70–90; add a second copy above 8 players |

Worth a shared helper (`server/src/games/scale.js`) so the intent is explicit and
three-player rounds stay exactly as they are.

**Also in this phase:** both racing games end only when the *last* player finishes.
A confident adult finishes Car Race in ~60 s and then watches a static camera for two
minutes; Train Race is worse at ~25 s of a 110 s round. End 35 s / 22 s after the first
finisher. And both assign `p.score` only inside `results()`, so the 14-row scoreboard
reads 0 for the entire race — write a provisional score each second and add a live
position to the objective line.

---

## Phase 22 — Portrait (one fix, thirteen games)

`client/js/engine.js` holds `camera.fov = 55` **vertical** and lets the horizontal shrink
with the aspect. At 390×844 the horizontal half-FOV collapses to ~13.5° against ~39° on
desktop, so a phone sees roughly a third of the width. Every `-phone.png` shows it: the
nursery bins, the bus, the science bench and the barber's reference head are all simply
outside the frustum.

```js
// Engine.resize(): hold the HORIZONTAL fov constant below a reference aspect
const REF = 16 / 9, a = w / h;
camera.fov = a >= REF ? 55
  : Math.min(85, 2 * Math.atan(Math.tan(55 * Math.PI / 360) * REF / a) * 180 / Math.PI);
```

Per-game `resize()` handlers then only fine-tune distance. Then, in the same phase:

- **The game panel sits under the joystick.** `.hud-bottom` and `.stick` /
  `.action-buttons` are pinned to the same band (`arcade.css:276` vs `:344`). In
  `.shots/baking-kitchen-phone.png` the knob covers the first order ticket and GRAB covers
  "SERVE". Inset `.hud-bottom` between the controls when `setLayout` turns them on.
- **Bus Cleaning needs three thumbs** — move, spray *and* drag-to-aim. Drop the A button
  and make the canvas drag *be* the hose (drag start = spray on). Two thumbs, and it feels
  like a pressure washer.
- **Ice Cream's FILL button sits on top of the "sauce" topping.** The DOM HOLD button
  already is the fill control; drop `setLayout({a:true})` entirely.
- **Tap targets**: `.hud-chip` ≈ 26 px, `.btn-sm` ≈ 28 px, `.tool-row button` ≈ 30 px —
  all well under 44 px, and they are the primary controls for Science and Barber.

---

## Phase 23 — Making it an evening, not thirteen rounds

- **A running total.** `startRound()` zeroes every score and nothing accumulates, so
  thirteen games produce thirteen unrelated podiums and no answer to "who's winning?".
  Keep `totals` on the room, ship it in `end` and `room`, show a "Tonight" column on the
  results screen and a strip in the lobby. This is the cheapest retention mechanism
  available and it makes the *next* round matter.
- **The co-op podium contradicts the design.** Team games still show 🥇🥈🥉 against a GDD
  that says "everyone wins or nobody does". For `mode === 'coop'`, show the family score
  against a target and label the table "contribution".
- **A QR code in the lobby.** Reading `http://192.168.1.37:8080/play/` aloud to a
  seven-year-old with an iPad is the worst step in the product. Also
  `history.replaceState` the room code into the address bar so the host's URL *is* the
  join link.
- **Non-hosts can do nothing.** `C2S.READY`, `C2S.RENAME` and `C2S.CHAT` are fully
  implemented server-side with **no client UI at all**. A ready-up toggle alone tells the
  host whether the kids upstairs actually have the game open before starting a round into
  an empty room.
- **There is no mute.** `Sound.setEnabled()` persists to `localStorage` and nothing ever
  calls it. Fourteen devices beeping in one living room needs an off switch.
- **Depth, cheapest first:** Guess Animal has 12 animals for 8 rounds (add ~12 more rows —
  `buildAnimal` is fully generic — and pick 2 of 3 decoys as nearest neighbours in
  proportion space). Science has 10 recipes (grow to ~20; the client renders entirely from
  `full.recipes`). Barber is one haircut then 100 idle seconds — make it a customer queue
  like Science's card, which also kills the colour lottery and gives a child a visible
  "customers served" count.

---

## Phase 24 — Accessibility

- **Player identity is colour-only** — roster chip, scoreboard chip, podium block, results
  row and the 3D avatar. Under deuteranopia slots 2/13/8 and 4/12/7 are mutually
  indistinguishable. In a 14-person family this is close to a certainty. `SLOT_NAMES`
  already exists and is used only for *empty* seats: put the name or a glyph inside the
  chip, and emboss the glyph on the avatar.
- **No `prefers-reduced-motion` in `arcade.css`** — while the fan-site handles it properly.
  The urgent-timer pulse, countdown pop, veil spinner, toasts and the rotating lobby ring
  all ignore it.
- **`user-scalable=no`** blocks pinch-zoom on the connect form, the 14-row roster and the
  results table. The canvas already has `touch-action: none`, which is what actually
  prevents gameplay scroll — the viewport flags buy nothing.
- **The results screen never announces itself.** Move focus to `#results-title` and give
  the section `role="dialog"`.

---

## The fan-site

Smaller, and mostly already in good shape — safe-area insets, `scroll-padding-top`,
`prefers-reduced-motion`, focus-visible styles and the coin-catcher's keyboard/ARIA
handling were all checked and are fine.

- **The gold CTA is dead when the server is down**, and the npm note reads as build
  instructions on a child's fan-site. `fetch('healthz')` on load; on 200 hide the note and
  say "Arcade is live"; on failure dim the button. (`text-red-400` / `text-emerald-400` are
  **not** in the compiled CSS — use `text-amber-300` / `text-gray-500`.)
- **The section sells games, not the mechanic.** Add a three-step strip — one person opens
  a room / everyone types the 4-letter code / up to 14 play at once — and drop in one of
  the `.shots/*.png` frames as a lazy `<img>`.
- **Two render-blocking third-party scripts in `<head>`**, one of them `lucide@latest`
  unpinned. The arcade's deployment model is a LAN with no WAN — there, the page is blank
  until each request times out. Add `defer`, pin the version, and make the arcade's font
  stylesheet non-blocking. Note `tools/browser.js:95` deliberately filters Google Fonts
  errors out of its report, so the harness will never tell you about this.
- **`three.module.js` (662 KB) is re-downloaded on every load** — `cache-control: no-cache`
  with no `ETag` to revalidate against, and no gzip. Fourteen devices, each reloading after
  every phone sleep, on home wifi.

---

## Per-game index

| Game | State | First thing to fix |
|---|---|---|
| Guess a Number | Fairest premise; one spammer wins every vault | Guess cooldown + proximity prize |
| Voxel Sandbox | Best toy here; infinite score loop | The `credited` Set |
| Car Race | Drives well; winner spectates for two minutes | End 35 s after the first finisher |
| Mango Target | Best aiming feel; fast throws pass through fruit | Swept (segment) hit test, not point-sampled |
| Baking Kitchen | Right idea; work for ~6 of 14 | Scale the ticket ceiling; split the serve bonus |
| Ice Cream Inc. | Best solo mechanic; spam beats skill | Gate the topping bonus on accuracy |
| Train Race | Great shape for mixed ages; overheat is bypassable | Per-player crystals; continuous heat |
| Baby Cleaning | Kind-hearted; 25 s of game in a 140 s round | Scale toys and stains to the roster |
| Bus Cleaning | Best idea, worst execution | Camera de-penetration; drag *is* the hose |
| Coin Cars | Bumper loop is genuinely good; economy starves | Scale the spawn economy |
| Guess Animal | Best-framed on desktop; animals stack up | `model.parent.remove()` |
| Science Game | Friendliest; a tapping contest with the bench behind you | Camera over your own shoulder; beaker reconciliation |
| Barber Game | **Two of three tools have never worked** | The `t` shorthand |

---

## Suggested first commit

If only one thing gets done: **Phase 17.1** (unify the three spread orders and add the
`verify.js` rule) **plus Phase 18.1** (the barber rename). That is under an hour, it
restores a whole game, and it makes the bug class that produced it impossible to
reintroduce — including by whoever wrote the rule down in the first place.
