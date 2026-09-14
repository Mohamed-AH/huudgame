# Master Game Development Prompt Blueprint (14-Player Three.js + WebSockets)

This blueprint contains a comprehensive prompt framework designed to generate multi-player, cross-platform (Mobile, iPad, PC) Three.js games with WebSockets, tailored for a 14-player family experience.

---

## 1. Master Framework Prompt

```text
Role: Principal 3D Web Game Architect & Senior Full-Stack Developer

Objective:
Generate a complete game design plan (Phase 1) and subsequent executable code (Phase 2) for a 14-player cross-platform networked game based on the specified title.

Technical Requirements:
1. Engine & Rendering: Three.js. Responsive canvas filling 100% viewport. Native DPR capped at Math.min(window.devicePixelRatio, 2) for mobile GPU stability. Efficient geometries, low draw calls, and optimized lighting.
2. Cross-Platform Controls: Unified input supporting touch, pointer, and keyboard. On Mobile/iPad: touch-action: none with virtual joysticks (e.g. nipplejs or custom canvas overlays) and tap gestures. On PC: WASD / Arrow keys + Mouse pointer lock or click events.
3. Network Architecture: Real-time WebSockets (Node.js + Socket.io or ws). Authoritative server managing game loop, room state, player connections (up to 14 slots), hit/collision validation, scoring, and state broadcasting. Thin client handling rendering, local input emission, and linear entity interpolation.
4. Aesthetics & Art Direction: Distinct, cohesive visual style (e.g., low-poly stylized, cartoon cel-shaded, or glowing arcade) optimized for performance across low-end mobile devices and high-end PCs.
5. Optimization Constraints: Frustum culling, instanced rendering (InstancedMesh) where applicable, object pooling for frequent spawns, lightmap baking or shadow-free ambient rendering, and strict memory cleanup (.dispose()).

Process:
Phase 1: Detailed Game Design Document (GDD)
Before writing any code, provide a complete GDD detailing:
- Core Gameplay Loop (14-player mechanics, team vs free-for-all)
- Control Mapping (Touch gestures & Keyboard/Mouse bindings)
- Visual Style & Color Palette
- UI / HUD layout (Scoreboard for 14 players, connection statuses)
- WebSocket Messaging Protocol (Client-to-Server and Server-to-Client payloads)
- Level/Arena Design scaled for 14 concurrent entities

Do not write any code until Phase 1 (GDD) is explicitly approved.
```

---

## 2. Individual Game Prompts for Huud's List

---

### Game 1: Guess a Number Game
```text
Use the Master Framework Prompt to plan and generate code for "Guess a Number Game".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player interactive guessing room:
- Concept: 14 player avatars gather in a 3D arena surrounding a central mystery vault or podium. In each round, players input secret numbers while dynamic 3D clues reveal themselves on stage.
- Visual Style: Bright game-show stage aesthetic with 14 podiums, glowing numerical indicators, and particle celebration effects for winners.
- Controls: Touch-screen numeric keypad overlay for mobile/iPad; physical keyboard number entry / mouse clicks for PC.
- Network Architecture: Authoritative Node.js server managing secret number generation, guess evaluation, round timers, dynamic hint delivery, and real-time 14-player score leaderboards.

Do not generate code until the GDD is approved.
```

---

### Game 2: Minecraft (14-Player Voxel Sandbox)
```text
Use the Master Framework Prompt to plan and generate code for "Minecraft".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player lightweight voxel building arena:
- Concept: A bounded blocky 3D sandbox where 14 players can mine, stack, and build together in real time using InstancedMesh or custom chunk buffer geometries.
- Visual Style: Low-poly pixel-textured voxel aesthetic with distinct color-coded blocky player avatars.
- Controls: Virtual joystick + tap to mine / long-press to place for mobile; WASD + Space (jump) + Mouse click to mine/place for PC.
- Network Architecture: Server manages voxel grid mutation matrix, player spatial coords, block interaction validation, and chunk syncing across 14 clients.

Do not generate code until the GDD is approved.
```

---

### Game 3: Car Race
```text
Use the Master Framework Prompt to plan and generate code for "Car Race".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player circuit racing game:
- Concept: 14 mini cars race across a wide multi-lane circuit complete with speed pads, obstacles, and lap counters.
- Visual Style: Low-poly arcade racing circuit with neon borders and 14 distinct car models/colors.
- Controls: Touch steering wheel / virtual D-pad + gas button for mobile; WASD / Arrow keys for PC.
- Network Architecture: Authoritative server managing vehicle position/rotation interpolation, lap timing, collision detection, and placement rankings.

Do not generate code until the GDD is approved.
```

---

### Game 4: Mango Target
```text
Use the Master Framework Prompt to plan and generate code for "Mango Target".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player competitive target-throwing mini-game:
- Concept: 14 players stand in a semi-circle around a 3D orchard. Mangoes spawn on trees or drop from above; players aim and throw projectiles to hit targets for points.
- Visual Style: Vibrant low-poly tropical orchard with stylized tree foliage and dynamic target highlights.
- Controls: Touch drag-to-aim and release to throw (mobile/iPad); mouse aim + left-click to throw (PC).
- Network Architecture: Authoritative server tracking target hit validation, score counters, player angles, and active target sync across 14 clients.

Do not generate code until the GDD is approved.
```

---

### Game 5: Baking Kitchen
```text
Use the Master Framework Prompt to plan and generate code for "Baking Kitchen".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player cooperative kitchen challenge:
- Concept: 14 players work in a high-tempo 3D kitchen, sharing stations (mixing, oven, decorating, plating) to complete recipe orders before time runs out.
- Visual Style: Charming cartoon low-poly kitchen with colorful ingredients, mixing bowls, and ovens.
- Controls: Virtual move joystick + tap-to-interact/pick up for mobile; WASD + E/Spacebar for PC.
- Network Architecture: Server syncs recipe order queues, station progress counters, item pickup states, and overall family score.

Do not generate code until the GDD is approved.
```

---

### Game 6: Ice Cream Inc.
```text
Use the Master Framework Prompt to plan and generate code for "Ice Cream Inc.".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player fast-paced ice cream crafting competition:
- Concept: An arcade setup where 14 players operate soft-serve machines to match incoming customer order cards (flavors, swirls, toppings).
- Visual Style: Pastel aesthetic with clean 3D models of cones, dispensers, dynamic mesh swirls, and toppings.
- Controls: Hold-to-dispense touch buttons and swipe gestures for mobile; number keys / mouse clicks for PC.
- Network Architecture: Server manages dynamic order queues, player scoring, timer synchronization, and multiplayer leaderboard state.

Do not generate code until the GDD is approved.
```

---

### Game 7: Train Race
```text
Use the Master Framework Prompt to plan and generate code for "Train Race".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player multi-track train racing game:
- Concept: 14 parallel train tracks running through a stylized landscape. Players control train speed, switch tracks to dodge obstacles, and collect boost power-ups.
- Visual Style: Low-poly toy train aesthetic with distinct train colors/numbers for all 14 family members.
- Controls: Virtual throttle slider + left/right lane-switch buttons on mobile; Up/Down throttle + Left/Right arrows on PC.
- Network Architecture: Server handles continuous track position interpolation, collision with obstacles, power-up pickups, and final finish-line placement.

Do not generate code until the GDD is approved.
```

---

### Game 8: Baby Cleaning Game
```text
Use the Master Framework Prompt to plan and generate code for "Baby Cleaning Game".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player cooperative playroom cleanup challenge:
- Concept: A messy 3D nursery/playroom where 14 players work together against a timer to pick up toys, scrub floor stains, and put items into designated bins.
- Visual Style: Soft, child-friendly 3D isometric room with clear visual highlights on dirty objects and targets.
- Controls: Touch-to-move virtual joystick with action button (mobile); WASD + Spacebar/E key to interact (PC).
- Network Architecture: Server tracks full interactive room state (toy locations, stain cleanliness percentage, bin contents) and syncs player positions in real time.

Do not generate code until the GDD is approved.
```

---

### Game 9: Bus Cleaning Game
```text
Use the Master Framework Prompt to plan and generate code for "Bus Cleaning Game".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player cooperative large-scale cleaning game:
- Concept: 14 players surround and enter a giant 3D school bus or double-decker bus. Players wash the exterior with pressure washers and clean trash inside before time runs out.
- Visual Style: Cartoonish, vibrant vehicle models with satisfying dirt/foam shaders or alpha-mask textures that peel away as players clean.
- Controls: Dual-touch (move camera + aim hose/sponge) on mobile; WASD + mouse look/click on PC.
- Network Architecture: Server syncs grid-based dirt removal coverage percentage across all 14 clients along with player locations.

Do not generate code until the GDD is approved.
```

---

### Game 10: Collecting Car Coins
```text
Use the Master Framework Prompt to plan and generate code for "Collecting Car Coins".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player arena coin-grab game:
- Concept: 14 bumper cars or mini cars drive around a bounded 3D arena where coins, multipliers, and power-ups continuously spawn. Players bump into each other to steal coins.
- Visual Style: Arcade-style neon or low-poly arena with glowing coins and dynamic particle effects on coin collection.
- Controls: Touch steering wheel or virtual joystick (mobile); WASD / Arrow keys (PC).
- Network Architecture: Authoritative server managing coin spawn grid, player positions, vehicle-to-vehicle bump physics, and instant coin balance updates.

Do not generate code until the GDD is approved.
```

---

### Game 11: Guess Animal
```text
Use the Master Framework Prompt to plan and generate code for "Guess Animal".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player 3D trivia and silhouette guessing game:
- Concept: A central 3D stage displays a rotating, shrouded silhouette or a slowly revealing low-poly 3D animal model. 14 players select the correct animal from visual choices or type their guess.
- Visual Style: Stage-show / safari theme with 14 seated avatar pods around a central spotlight.
- Controls: Tap-to-select multiple choice UI (mobile/iPad); keyboard shortcuts / mouse click (PC).
- Network Architecture: Server handles round state machine (reveal stage, countdown timer, answer evaluation, points distribution, final podium rendering).

Do not generate code until the GDD is approved.
```

---

### Game 12: Science Game
```text
Use the Master Framework Prompt to plan and generate code for "Science Game".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player interactive science lab mini-game:
- Concept: 14 players work in a futuristic lab mixing colored chemical beakers, matching element combinations, or building simple circuits to trigger safe, fun 3D reactions (volcanoes, sparks, anti-gravity bubbles).
- Visual Style: Bright, futuristic lab environment with glowing liquids, particle reactions, and clear color coding.
- Controls: Drag-and-drop mechanics for touchscreens; mouse click-and-drag for PC.
- Network Architecture: Server validates chemical/circuit combinations, triggers synchronized particle events on all clients, and tracks player scores.

Do not generate code until the GDD is approved.
```

---

### Game 13: Barber Game
```text
Use the Master Framework Prompt to plan and generate code for "Barber Game".

Phase 1: Game Design Document (GDD)
Create a GDD for a 14-player silly haircut & styling competition:
- Concept: 14 players each get a funny 3D character head (or work in teams) with dynamic hair meshes. Players use clippers, dyes, and hair growth spray to match a target haircut style shown on a card.
- Visual Style: Whimsical cartoon 3D character heads with deformable or segment-based hair meshes and expressive animations.
- Controls: Touch drag to trim/paint hair on mobile; mouse click and drag on PC.
- Network Architecture: Server manages style match accuracy scoring algorithm, timer, round transitions, and final showcase for all 14 players.

Do not generate code until the GDD is approved.
```
