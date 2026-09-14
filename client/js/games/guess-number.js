/**
 * Guess a Number — a game-show vault in the middle of a ring of 14 podiums.
 *
 * The scene is deliberately cheap: one floor, one vault, 14 podiums built from shared
 * geometry, and one small canvas texture per podium for the guess readout. All the
 * drama comes from the vault's heat glow and the particle blast when it cracks.
 */

export const meta = { id: 'guess-number' };

const RING_RADIUS = 10.5;
const COLD = 0x4cc9f0;
const HOT = 0xef476f;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const podiums = new Map();          // slot -> { group, panel }
    let vault = null;
    let vaultCore = null;
    let vaultDisplay = null;
    let ring = null;

    let heat = 0;
    let targetHeat = 0;
    let entry = '';
    let lastPhase = null;
    let lastRound = 0;
    let shake = 0;

    // ------------------------------------------------------------------ helpers

    /** A canvas-textured plane that can be repainted without reallocating anything. */
    function makePanel(width, height, pixelW, pixelH) {
        const canvas = document.createElement('canvas');
        canvas.width = pixelW;
        canvas.height = pixelH;
        const c2d = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
        );
        const paint = (text, color = '#ffb703', bg = 'rgba(6,8,14,0.92)') => {
            c2d.clearRect(0, 0, pixelW, pixelH);
            c2d.fillStyle = bg;
            c2d.fillRect(0, 0, pixelW, pixelH);
            c2d.fillStyle = color;
            c2d.textAlign = 'center';
            c2d.textBaseline = 'middle';
            c2d.font = `700 ${Math.floor(pixelH * 0.62)}px Outfit, system-ui, sans-serif`;
            c2d.fillText(String(text), pixelW / 2, pixelH / 2 + 2);
            texture.needsUpdate = true;
        };
        paint('--');
        return { mesh, paint, texture, canvas };
    }

    /**
     * All 14 podiums are built whether or not somebody is standing at them. An empty
     * seat reads as "there is room for you" rather than leaving the family wondering
     * where everyone went - and the ring only looks like a game show at full width.
     */
    function buildPodium(slot, player) {
        const { x, z, angle } = build.ringPosition(slot, 14, RING_RADIUS);
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        group.rotation.y = -angle + Math.PI / 2;    // face the vault

        const base = build.cylinder(0.72, 0.9, 1.1, 0x2e3850, 8);
        base.position.y = 0.55;
        const top = build.cylinder(0.8, 0.8, 0.14, player ? ctx.colorOf(slot) : 0x39415a, 8);
        top.position.y = 1.17;
        group.add(base, top);

        if (!player) {
            group.children.forEach((m) => { m.material = m.material.clone(); m.material.opacity = 0.5; m.material.transparent = true; });
            scene.add(group);
            return;
        }

        const panel = makePanel(1.25, 0.62, 192, 96);
        panel.mesh.position.set(0, 1.72, 0.1);
        group.add(panel.mesh);

        const plate = build.nameplate(player.name, slot);
        plate.position.set(0, 2.35, 0);
        group.add(plate);

        // Your own podium gets a light ring under it so you can find yourself instantly.
        if (player.id === ctx.selfId) {
            const marker = new THREE.Mesh(
                new THREE.RingGeometry(0.95, 1.15, 24),
                new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
            );
            marker.rotation.x = -Math.PI / 2;
            marker.position.y = 0.04;
            group.add(marker);
        }

        scene.add(group);
        podiums.set(slot, { group, panel, id: player.id });
    }

    function setVaultHeat(value) {
        const color = new THREE.Color(COLD).lerp(new THREE.Color(HOT), value);
        vaultCore.material.color.copy(color);
        vaultCore.material.emissive.copy(color);
        vaultCore.material.emissiveIntensity = 0.35 + value * 0.65;
    }

    // -------------------------------------------------------------- HUD controls

    function buildKeypad() {
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⏎'];
        hud.buildPanel(`
            <div class="readout" id="gn-readout">--</div>
            <div class="keypad">${keys.map((k) => `<button type="button" data-key="${k}">${k}</button>`).join('')}</div>
        `);
        hud.panel.querySelectorAll('[data-key]').forEach((btn) => {
            btn.addEventListener('click', () => press(btn.dataset.key));
        });
        paintReadout();
    }

    function paintReadout() {
        const el = document.getElementById('gn-readout');
        if (el) el.textContent = entry === '' ? '--' : entry;
    }

    function press(key) {
        if (key === 'C') entry = '';
        else if (key === '⏎' || key === 'Enter') return submit();
        else if (/^[0-9]$/.test(key)) {
            // The secret is 1-100, so three digits is the most that can ever be valid.
            if (entry.length < 3) entry += key;
            if (Number(entry) > 100) entry = key;
        }
        sound.tick();
        paintReadout();
    }

    function submit() {
        const value = Number(entry);
        if (!entry || !Number.isFinite(value) || value < 1 || value > 100) {
            hud.banner('1 to 100', 900);
            entry = '';
            return paintReadout();
        }
        net.action({ a: 'guess', v: value });
        entry = '';
        paintReadout();
    }

    // --------------------------------------------------------------- lifecycle

    return {
        async build(full) {
            scene.add(build.skyDome(0x241a34, 0x0b0c10));   // a game-show purple night
            scene.add(build.arenaFloor(18));
            ring = build.boundaryRing(15.5, 40, 0xf59e0b, 0.7);
            scene.add(ring);

            vault = new THREE.Group();
            vault.position.y = 3.2;

            vaultCore = build.box(2.6, 2.6, 2.6, COLD, { emissive: COLD, emissiveIntensity: 0.4 });
            // The core needs its own material instance - the shared cache is keyed by
            // color and this one changes every guess.
            vaultCore.material = vaultCore.material.clone();
            vault.add(vaultCore);

            const trim = build.box(2.8, 0.22, 2.8, 0xffb703);
            trim.position.y = -1.3;
            const trimTop = trim.clone();
            trimTop.position.y = 1.3;
            vault.add(trim, trimTop);

            const dial = build.cylinder(0.55, 0.55, 0.2, 0xffb703, 12);
            dial.rotation.x = Math.PI / 2;
            dial.position.z = 1.4;
            vault.add(dial);

            vaultDisplay = makePanel(2.9, 0.95, 512, 172);
            vaultDisplay.mesh.position.set(0, 2.1, 0);
            vault.add(vaultDisplay.mesh);
            vaultDisplay.paint('GUESS!');

            scene.add(vault);

            const seated = new Map(ctx.players().map((p) => [p.slot, p]));
            for (let slot = 0; slot < 14; slot++) buildPodium(slot, seated.get(slot) ?? null);

            // Camera sits behind and above your own podium: your seat frames the
            // bottom of the shot, the vault sits in the middle, and the far podiums
            // stay readable across the ring.
            const me = ctx.playerById(ctx.selfId);
            const seat = build.ringPosition(me?.slot ?? 0, 14, RING_RADIUS + 4.5);
            camera.position.set(seat.x, 8.5, seat.z);
            camera.lookAt(0, 3.2, 0);

            input.setLayout({});            // this game is all DOM keypad
            buildKeypad();
            input.onKey = (key) => press(key === 'enter' ? '⏎' : key === 'c' ? 'C' : key);
            hud.setObjective('Crack the vault — 1 to 100');
        },

        onState(s) {
            if (s.rd !== lastRound) {
                lastRound = s.rd;
                hud.setObjective(`Vault ${s.rd} of ${s.of} — 1 to 100`);
            }

            if (s.ph !== lastPhase) {
                lastPhase = s.ph;
                if (s.ph === 'reveal') {
                    vaultDisplay.paint(s.sec, s.w ? '#06d6a0' : '#ef476f');
                    targetHeat = s.w ? 1 : 0;
                } else {
                    vaultDisplay.paint('GUESS!');
                    targetHeat = 0;
                    for (const { panel } of podiums.values()) panel.paint('--');
                }
            }

            for (const [slot, guess, won] of s.g) {
                const podium = podiums.get(slot);
                if (!podium) continue;
                podium.panel.paint(guess || '--', won ? '#06d6a0' : '#ffb703');
            }
        },

        onEvent(e) {
            switch (e.e) {
                case 'guess':
                    if (e.by !== ctx.selfId) {
                        hud.toastFor(e.by, `guessed ${e.v} — go ${e.dir === 'up' ? 'higher' : 'lower'}`);
                    } else {
                        hud.banner(e.dir === 'up' ? 'HIGHER ↑' : 'LOWER ↓', 1100);
                        sound.tone(e.dir === 'up' ? 520 : 320, 0.1);
                    }
                    break;

                case 'heat':
                    targetHeat = e.heat;
                    if (e.off != null) hud.toast(`Burning — you are ${e.off} away`);
                    break;

                case 'hit': {
                    const who = e.by === ctx.selfId ? 'YOU CRACKED IT!' : `${ctx.nameOf(e.by)} cracked it!`;
                    hud.banner(who, 2400);
                    hud.toastFor(e.by, `opened the vault in ${e.tries}`, e.pts);
                    particles.burst(0, 3.2, 0, { color: 0xffb703, count: 40, speed: 9, spread: 1.2 });
                    shake = 0.5;
                    if (e.by === ctx.selfId) sound.win(); else sound.good();
                    break;
                }

                case 'close':
                    if (e.by === ctx.selfId) hud.toast(`So close — ${e.off} off  +25`);
                    break;

                case 'reveal':
                    if (!e.winner) {
                        hud.banner(`It was ${e.secret}`, 2400);
                        sound.bad();
                    }
                    break;

                case 'round':
                    hud.banner(`Vault ${e.rd} of ${e.of}`, 1400);
                    entry = '';
                    paintReadout();
                    break;
            }
        },

        update(dt, now) {
            heat = interp.damp(heat, targetHeat, 6, dt);
            setVaultHeat(heat);

            vault.rotation.y += dt * (0.35 + heat * 1.2);
            vault.position.y = 3.2 + Math.sin(now / 900) * 0.18;

            if (shake > 0) {
                shake = Math.max(0, shake - dt * 1.6);
                vault.position.x = (Math.random() - 0.5) * shake * 0.8;
                vault.position.z = (Math.random() - 0.5) * shake * 0.8;
            }

            ring.rotation.y -= dt * 0.08;
            // Billboard the podium readouts so they stay legible from any seat.
            for (const { panel } of podiums.values()) panel.mesh.lookAt(camera.position);
            vaultDisplay.mesh.lookAt(camera.position);
        },

        dispose() {
            input.onKey = null;
            // Everything else hangs off `scene` (the engine's root) and is released
            // by engine.clearRoot(); these two own cloned materials and canvas
            // textures that the shared cache never sees.
            vaultCore?.material.dispose();
            vaultDisplay?.texture.dispose();
            for (const { panel } of podiums.values()) panel.texture.dispose();
            podiums.clear();
        },
    };
}
