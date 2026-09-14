/**
 * Science Game — fourteen lab benches around a central reaction kiosk.
 *
 * Elements are dragged from a tray into a beaker. The drag is implemented with raw
 * pointer events rather than HTML5 drag-and-drop, because HTML5 drag does not exist
 * on touch and half this family is on an iPad.
 */

export const meta = { id: 'science-lab' };

const BENCH_RADIUS = 9.5;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const benches = new Map();
    let elements = [];
    let recipes = [];
    let beakerSize = 3;
    let selfSlot = 0;
    let myBeaker = [];
    let myCard = 0;
    let lastCard = -1;
    let displayPanel = null;
    let kiosk = null;

    function buildBench(slot, player) {
        const { x, z, angle } = build.ringPosition(slot, 14, BENCH_RADIUS);
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = -angle + Math.PI / 2;

        const top = build.box(2.0, 0.16, 1.2, player ? 0xd8e2ef : 0x39415a);
        top.position.y = 1.05;
        const legs = build.box(1.8, 1.0, 1.0, 0x2b3242);
        legs.position.y = 0.5;
        g.add(top, legs);

        const glass = new THREE.Mesh(
            new THREE.CylinderGeometry(0.34, 0.42, 0.8, 12, 1, true),
            new THREE.MeshLambertMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
        );
        glass.position.y = 1.53;

        const liquid = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.37, 0.5, 12),
            new THREE.MeshLambertMaterial({ color: 0x26304a, emissive: 0x000000 }),
        );
        liquid.position.y = 1.38;
        liquid.scale.y = 0.001;
        g.add(glass, liquid);

        if (player) {
            const plate = build.nameplate(player.name, slot, { scale: 1.0 });
            plate.position.y = 2.4;
            g.add(plate);
        }

        scene.add(g);
        benches.set(slot, { group: g, liquid, glass });
    }

    function setBeaker(slot, parts) {
        const bench = benches.get(slot);
        if (!bench) return;
        const n = parts.length;
        bench.liquid.scale.y = n === 0 ? 0.001 : 0.4 + n * 0.55;
        bench.liquid.position.y = 1.2 + (n === 0 ? 0 : bench.liquid.scale.y * 0.25);
        if (!n) return;
        // The liquid is the average of what is in it, which makes a half-built recipe
        // readable across the room without any labels.
        const mixed = new THREE.Color(0, 0, 0);
        const one = new THREE.Color();
        for (const e of parts) mixed.add(one.setHex(elements[e]?.color ?? 0xffffff));
        mixed.multiplyScalar(1 / n);
        bench.liquid.material.color.copy(mixed);
    }

    // ------------------------------------------------------------ the HUD tray

    function renderPanel() {
        const card = recipes[myCard];
        hud.buildPanel(`
            <div class="lab-card" id="sl-card">
                <b>${card?.name ?? '...'}</b>
                <span>${(card?.parts ?? []).map((e) => elements[e]?.sym ?? '?').join(' + ')} · ${card?.pts ?? 0} pts</span>
            </div>
            <div class="beaker-zone" id="sl-beaker"><span>drag elements here</span></div>
            <div class="tool-row" id="sl-tray">${elements.map((el, i) => `
                <button type="button" data-el="${i}" title="${el.name}">
                    <i style="display:inline-block;width:.75rem;height:.75rem;border-radius:50%;background:#${el.color.toString(16).padStart(6, '0')}"></i>${el.sym}
                </button>`).join('')}</div>
            <div class="tool-row">
                <button type="button" id="sl-mix">MIX</button>
                <button type="button" id="sl-clear">CLEAR</button>
            </div>
        `);

        const zone = document.getElementById('sl-beaker');
        for (const btn of hud.panel.querySelectorAll('[data-el]')) {
            attachDrag(btn, zone, Number(btn.dataset.el));
        }
        document.getElementById('sl-mix').addEventListener('click', mix);
        document.getElementById('sl-clear').addEventListener('click', () => {
            myBeaker = [];
            net.action({ a: 'clear' });
            paintBeaker();
        });
        paintBeaker();
    }

    /** Pointer-based drag with a floating ghost, plus tap-to-add as a shortcut. */
    function attachDrag(button, zone, elementIndex) {
        let ghost = null;
        let dragging = false;

        const move = (e) => {
            if (!ghost) return;
            dragging = true;
            ghost.style.left = `${e.clientX}px`;
            ghost.style.top = `${e.clientY}px`;
            const over = zone.getBoundingClientRect();
            const inside = e.clientX >= over.left && e.clientX <= over.right
                && e.clientY >= over.top && e.clientY <= over.bottom;
            zone.classList.toggle('over', inside);
        };

        const end = (e) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            zone.classList.remove('over');
            const box = zone.getBoundingClientRect();
            const dropped = e.clientX >= box.left && e.clientX <= box.right
                && e.clientY >= box.top && e.clientY <= box.bottom;
            ghost?.remove();
            ghost = null;
            // A tap is a drag that never moved: adding by tapping is faster once you
            // know the table, and dragging is how you find out that you can.
            if (dropped || !dragging) addElement(elementIndex);
            dragging = false;
        };

        button.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            dragging = false;
            ghost = document.createElement('div');
            ghost.className = 'drag-ghost';
            ghost.textContent = elements[elementIndex]?.sym ?? '?';
            ghost.style.background = `#${(elements[elementIndex]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
            ghost.style.left = `${e.clientX}px`;
            ghost.style.top = `${e.clientY}px`;
            document.body.appendChild(ghost);
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', end);
        });
    }

    function addElement(index) {
        if (myBeaker.length >= beakerSize) return;
        myBeaker.push(index);
        net.action({ a: 'add', e: index });
        paintBeaker();
        sound.tick();
    }

    function mix() {
        if (myBeaker.length < 2) return hud.toast('Two elements at least');
        net.action({ a: 'mix' });
        myBeaker = [];
        paintBeaker();
    }

    function paintBeaker() {
        const zone = document.getElementById('sl-beaker');
        if (!zone) return;
        zone.innerHTML = myBeaker.length
            ? myBeaker.map((e) => `<i style="background:#${elements[e].color.toString(16).padStart(6, '0')}">${elements[e].sym}</i>`).join('')
            : '<span>drag elements here</span>';
    }

    function refreshCard() {
        const card = recipes[myCard];
        const el = document.getElementById('sl-card');
        if (!el || !card) return;
        el.innerHTML = `<b>${card.name}</b><span>${card.parts.map((e) => elements[e].sym).join(' + ')} · ${card.pts} pts</span>`;
    }

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;
            elements = full.elements ?? [];
            recipes = full.recipes ?? [];
            beakerSize = full.beakerSize ?? 3;

            ctx.engine.setLighting({ hemi: 1.0, sun: 0.55, sky: 0xd8ecff, ground: 0x1d2436 });
            scene.add(build.skyDome(0x1b2b4a, 0x0b111c));
            scene.add(build.arenaFloor(15, 0x1e2940, 0x0b111c));

            // The reaction board is a four-sided kiosk in the middle of the ring, not a
            // wall: with benches all the way round, any wall is directly in front of
            // somebody's camera and blanks their whole screen.
            const board = build.textPanel(['REACTIONS'], { width: 512, height: 256, bg: '#101a2c', fg: '#8ecae6' });
            displayPanel = board;
            kiosk = new THREE.Group();
            const screenMat = new THREE.MeshBasicMaterial({ map: board.texture });
            for (let side = 0; side < 4; side++) {
                const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), screenMat);
                const a = (side / 4) * Math.PI * 2;
                screen.position.set(Math.sin(a) * 1.76, 0, Math.cos(a) * 1.76);
                screen.rotation.y = a;
                kiosk.add(screen);
            }
            const shell = build.box(3.4, 1.9, 3.4, 0x2b3242);
            kiosk.add(shell);
            kiosk.position.y = 4.4;
            scene.add(kiosk);

            const pole = build.cylinder(0.24, 0.32, 4.4, 0x39415a, 8);
            pole.position.y = 2.2;
            scene.add(pole);

            const seated = new Map(ctx.players().map((p) => [p.slot, p]));
            for (let slot = 0; slot < 14; slot++) buildBench(slot, seated.get(slot) ?? null);

            const seat = build.ringPosition(selfSlot, 14, BENCH_RADIUS + 5.5);
            camera.position.set(seat.x * 0.8, 6.2, seat.z * 0.8);
            camera.lookAt(0, 2.4, 0);

            input.setLayout({});
            input.onKey = (key) => {
                const n = Number(key);
                if (n >= 1 && n <= elements.length) addElement(n - 1);
                else if (key === 'enter') mix();
                else if (key === 'backspace' || key === 'c') { myBeaker = []; net.action({ a: 'clear' }); paintBeaker(); }
            };
            renderPanel();
            hud.setObjective('Make the reaction on your card');
        },

        onState(s) {
            for (const row of s.p ?? []) {
                const [slot, card, fizzling, ...parts] = row;
                setBeaker(slot, parts);
                const bench = benches.get(slot);
                if (bench) bench.liquid.material.emissive.setHex(fizzling ? 0x552222 : 0x000000);
                if (slot === selfSlot) {
                    myCard = card;
                    if (card !== lastCard) { lastCard = card; refreshCard(); }
                }
            }
        },

        onEvent(e) {
            switch (e.e) {
                case 'react': {
                    const bench = benches.get(e.slot);
                    const at = bench?.group.position ?? { x: 0, z: 0 };
                    const opts = {
                        volcano: { count: 34, speed: 11, up: 2.2, spread: 0.4 },
                        sparks:  { count: 26, speed: 9,  up: 1.2, spread: 1.2 },
                        bubbles: { count: 20, speed: 4,  up: 2.6, spread: 0.9 },
                        smoke:   { count: 18, speed: 3,  up: 1.8, spread: 1.4 },
                        glow:    { count: 24, speed: 6,  up: 1.0, spread: 1.0 },
                    }[e.kind] ?? { count: 18, speed: 6 };
                    particles.burst(at.x, 1.9, at.z, { color: e.color, life: 1.3, ...opts });
                    // The wall plays every reaction, whoever made it.
                    particles.burst(0, 5.6, 0, { color: e.color, life: 1.6, count: opts.count, speed: opts.speed * 0.8, up: 2 });
                    repaintBoard(e.name, e.color);

                    if (e.by === ctx.selfId) {
                        hud.banner(`${e.name}  +${e.pts}`, 1400);
                        e.exact ? sound.win() : sound.good();
                        myBeaker = [];
                        paintBeaker();
                    } else {
                        hud.toastFor(e.by, `made ${e.name}`, e.pts);
                    }
                    break;
                }
                case 'fizzle':
                    if (e.by === ctx.selfId) {
                        hud.banner('FIZZLE', 900);
                        sound.bad();
                        myBeaker = [];
                        paintBeaker();
                    }
                    break;
                case 'clear':
                    if (e.by === ctx.selfId) { myBeaker = []; paintBeaker(); }
                    break;
            }
        },

        update(dt, now) {
            for (const [slot, bench] of benches) {
                bench.liquid.rotation.y += dt * (slot === selfSlot ? 1.4 : 0.6);
            }
            if (kiosk) kiosk.rotation.y += dt * 0.25;
        },

        dispose() {
            input.onKey = null;
            document.querySelectorAll('.drag-ghost').forEach((g) => g.remove());
            displayPanel?.texture.dispose();
            for (const bench of benches.values()) {
                bench.liquid.material.dispose();
                bench.glass.material.dispose();
            }
            benches.clear();
        },
    };

    function repaintBoard(name, color) {
        if (!displayPanel) return;
        const { ctx: c2d, canvas, texture } = displayPanel;
        c2d.fillStyle = '#101a2c';
        c2d.fillRect(0, 0, canvas.width, canvas.height);
        c2d.textAlign = 'center';
        c2d.textBaseline = 'middle';
        c2d.fillStyle = '#8ecae6';
        c2d.font = '700 34px Outfit, system-ui, sans-serif';
        c2d.fillText('LATEST REACTION', canvas.width / 2, 70);
        c2d.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        c2d.font = '700 58px Outfit, system-ui, sans-serif';
        c2d.fillText(name, canvas.width / 2, 160);
        texture.needsUpdate = true;
    }
}
