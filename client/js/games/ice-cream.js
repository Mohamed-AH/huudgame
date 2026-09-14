/**
 * Ice Cream Inc. — fourteen dispensers in a row, each player working their own.
 *
 * The interesting frame is your own machine, so the camera sits close to your desk
 * with everybody else's swirl visible along the counter. The target height is drawn
 * as a physical line across the cone: stopping on it is the entire game, and a number
 * in the HUD would make that a maths problem instead of a reflex.
 */

export const meta = { id: 'ice-cream' };

const FLAVOR_COLORS = [0xfdf3d0, 0xff8fa3, 0x9be3b8, 0x7a5230];
const TOPPING_COLORS = [0x000000, 0xff5d5d, 0xef476f, 0x8d5524];
const SWIRL_MAX = 1.5;           // world height of a completely full cone
const DESK_SPACING = 3.4;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const desks = new Map();          // slot -> parts
    let selfSlot = 0;
    let flavors = [];
    let toppings = [];
    let holding = false;

    const SWIRL_GEO = new THREE.CylinderGeometry(0.16, 0.42, 1, 10);

    function buildDesk(slot, player) {
        const g = new THREE.Group();
        g.position.set((slot - 6.5) * DESK_SPACING, 0, 0);

        const counter = build.box(2.6, 1.3, 2.0, player ? 0xfff6fb : 0x6b6479);
        counter.position.y = 0.65;
        g.add(counter);

        // The machine stands well back of the cone: put it any closer and it hides
        // the one thing the player is actually looking at.
        const machine = build.box(1.5, 2.2, 1.0, 0xd9c7e0);
        machine.position.set(0, 2.6, -1.15);
        const nozzle = build.cylinder(0.18, 0.3, 0.5, 0x8e8799, 8);
        nozzle.position.set(0, 4.55, 0.35);
        g.add(machine, nozzle);

        const cone = build.cone(0.5, 1.3, 0xd79a52, 10);
        cone.rotation.x = Math.PI;         // point down
        cone.position.set(0, 2.15, 0.35);

        const swirl = new THREE.Mesh(SWIRL_GEO, build.mat(FLAVOR_COLORS[0]));
        swirl.position.set(0, 2.75, 0.35);
        swirl.scale.y = 0.001;

        const topping = build.sphere(0.2, 0xff5d5d, 0);
        topping.visible = false;

        // The target line is a physical ring around the cone. Players read "stop here"
        // from it instantly; a percentage in the HUD would not be read at all.
        const target = new THREE.Mesh(
            new THREE.TorusGeometry(0.5, 0.05, 6, 16),
            new THREE.MeshBasicMaterial({ color: 0x06d6a0 }),
        );
        target.rotation.x = Math.PI / 2;
        target.position.set(0, 2.75, 0.35);

        g.add(cone, swirl, topping, target);

        if (player) {
            const plate = build.nameplate(player.name, slot, { scale: 0.9 });
            plate.position.set(0, 5.2, 0.3);
            g.add(plate);
        }

        scene.add(g);
        desks.set(slot, { group: g, swirl, topping, target, cone });
    }

    function buildPanel() {
        hud.buildPanel(`
            <div class="tool-row" id="ic-flavors">${flavors.map((f, i) => `
                <button type="button" data-flavor="${i}" aria-pressed="${i === 0}">
                    <i style="display:inline-block;width:.8rem;height:.8rem;border-radius:50%;background:#${FLAVOR_COLORS[i].toString(16).padStart(6, '0')}"></i>${f}
                </button>`).join('')}</div>
            <div class="tool-row" id="ic-toppings">${toppings.map((t, i) => `
                <button type="button" data-top="${i}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
            <div class="tool-row">
                <button type="button" id="ic-hold" class="hold-btn">HOLD TO FILL</button>
                <button type="button" id="ic-serve">SERVE</button>
            </div>
        `);

        for (const btn of hud.panel.querySelectorAll('[data-flavor]')) {
            btn.addEventListener('click', () => pickFlavor(Number(btn.dataset.flavor)));
        }
        for (const btn of hud.panel.querySelectorAll('[data-top]')) {
            btn.addEventListener('click', () => pickTopping(Number(btn.dataset.top)));
        }

        const hold = document.getElementById('ic-hold');
        const down = (e) => { e.preventDefault(); holding = true; hold.setAttribute('aria-pressed', 'true'); };
        const up = (e) => { e.preventDefault(); holding = false; hold.setAttribute('aria-pressed', 'false'); };
        hold.addEventListener('pointerdown', down);
        hold.addEventListener('pointerup', up);
        hold.addEventListener('pointercancel', up);
        hold.addEventListener('pointerleave', up);

        document.getElementById('ic-serve').addEventListener('click', serve);
    }

    function pickFlavor(i) {
        net.action({ a: 'flavor', f: i });
        for (const btn of hud.panel.querySelectorAll('[data-flavor]')) {
            btn.setAttribute('aria-pressed', String(Number(btn.dataset.flavor) === i));
        }
        sound.tick();
    }

    function pickTopping(i) {
        net.action({ a: 'top', tp: i });
        for (const btn of hud.panel.querySelectorAll('[data-top]')) {
            btn.setAttribute('aria-pressed', String(Number(btn.dataset.top) === i));
        }
        sound.tick();
    }

    function serve() {
        net.action({ a: 'serve' });
        holding = false;
    }

    const findRow = (rows, slot) => rows.find((r) => r[0] === slot);

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;
            flavors = full.flavors ?? ['vanilla'];
            toppings = full.toppings ?? ['none'];

            // A pastel parlour needs a brighter rig than a night race; the engine
            // restores the default when the round ends.
            ctx.engine.setLighting({ hemi: 1.25, sun: 0.7, sky: 0xffeef6, ground: 0x6b5a72 });
            scene.add(build.skyDome(0x7b5f86, 0x2a2136));
            const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 40), build.mat(0xf3e3ee));
            floor.rotation.x = -Math.PI / 2;
            floor.position.z = 2;
            scene.add(floor);

            const seated = new Map(ctx.players().map((p) => [p.slot, p]));
            for (let slot = 0; slot < 14; slot++) buildDesk(slot, seated.get(slot) ?? null);

            const mine = desks.get(selfSlot);
            const x = mine ? mine.group.position.x : 0;
            camera.position.set(x, 5.4, 9.2);
            camera.lookAt(x, 3.0, 0);

            input.setLayout({ a: true, aLabel: 'FILL' });
            buildPanel();
            input.onKey = (key) => {
                const n = Number(key);
                if (n >= 1 && n <= flavors.length) pickFlavor(n - 1);
                else if (n >= 5 && n <= 4 + toppings.length) pickTopping(n - 5);
                else if (key === 'enter') serve();
            };
            hud.setObjective('Hold to fill — stop on the green line');
        },

        onState(s) {
            buffer.push(s.p);
            const mine = findRow(s.p, selfSlot);
            if (mine) {
                const [, , , , wantFlavor, wantHeight, wantTopping] = mine;
                hud.setObjective(
                    `Order: ${flavors[wantFlavor]} · ${Math.round(wantHeight * 100)}% · ${toppings[wantTopping]}`,
                );
            }
        },

        onEvent(e) {
            switch (e.e) {
                case 'serve': {
                    const desk = desks.get(e.slot);
                    if (desk) {
                        particles.burst(desk.group.position.x, 3.2, 0.4, {
                            color: e.acc > 0.8 ? 0x06d6a0 : 0xffd166, count: e.acc > 0.8 ? 18 : 8, speed: 4,
                        });
                    }
                    if (e.by === ctx.selfId) {
                        const grade = e.acc > 0.9 ? 'PERFECT!' : e.acc > 0.65 ? 'Nice one' : 'Close enough';
                        hud.banner(`${grade}  +${e.pts}`, 1100);
                        e.acc > 0.9 ? sound.win() : sound.good();
                    } else {
                        hud.toastFor(e.by, 'served a cone', e.pts);
                    }
                    break;
                }
                case 'collapse': {
                    const desk = desks.get(e.slot);
                    if (desk) particles.burst(desk.group.position.x, 2.6, 0.4, { color: 0xfdf3d0, count: 14, speed: 4 });
                    if (e.by === ctx.selfId) { hud.banner('TOO MUCH!', 1200); sound.bad(); }
                    else hud.toastFor(e.by, 'tipped a cone over');
                    break;
                }
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);

            if (frame) {
                for (const row of frame.b) {
                    const [slot, height, flavor, topping, , wantHeight] = row;
                    const desk = desks.get(slot);
                    if (!desk) continue;
                    const prev = findRow(frame.a, slot) ?? row;

                    const h = interp.lerp(prev[1], height, frame.t) * SWIRL_MAX;
                    desk.swirl.scale.y = Math.max(0.001, h);
                    desk.swirl.position.y = 2.75 + h / 2;
                    desk.swirl.material = build.mat(FLAVOR_COLORS[flavor] ?? FLAVOR_COLORS[0]);

                    // The topping is a sibling of the swirl rather than its child: the
                    // swirl is scaled to the fill level and would squash anything on it.
                    desk.topping.visible = topping > 0 && h > 0.05;
                    desk.topping.position.set(0, 2.75 + h + 0.18, 0.35);
                    desk.topping.material = build.mat(TOPPING_COLORS[topping] ?? 0xff5d5d);

                    desk.target.position.y = 2.75 + wantHeight * SWIRL_MAX;
                    desk.target.material.color.setHex(
                        Math.abs(height - wantHeight) < 0.06 ? 0x06d6a0 : height > wantHeight ? 0xef476f : 0xffd166,
                    );
                }
            }

            const wantHold = holding || input.buttons.a;
            net.input({ h: wantHold ? 1 : 0 });
        },

        dispose() {
            input.onKey = null;
            SWIRL_GEO.dispose();
            for (const desk of desks.values()) desk.target.material.dispose();
            desks.clear();
            buffer.clear();
        },
    };
}
