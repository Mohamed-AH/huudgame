import { LENGTH, WIDTH, RADIUS, STRAIGHT, pointAt } from 'shared/track.js';

/**
 * Car Race — fourteen low-poly cars on a neon stadium circuit.
 *
 * The tarmac is one ribbon of geometry generated from the same centreline the server
 * drives cars along, so what you can see is exactly what you are allowed to drive on.
 * Everything else on the track - kerbs, barriers, pads - is instanced.
 */

export const meta = { id: 'car-race' };

const RIBBON_STEPS = 180;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const cars = new Map();             // slot -> { group, wheels }
    let selfSlot = 0;
    let laps = 3;
    let shownLap = 0;

    const selfPos = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    const camGoal = new THREE.Vector3();
    let camSpeed = 0;

    // ------------------------------------------------------------------ scenery

    /** One ribbon of triangles swept along the centreline - the whole road, one draw. */
    function tarmac(width, y, color) {
        const positions = [];
        const indices = [];
        for (let i = 0; i <= RIBBON_STEPS; i++) {
            const { x, z, hx, hz } = pointAt((i / RIBBON_STEPS) * LENGTH);
            const nx = -hz;
            const nz = hx;
            positions.push(x + nx * width / 2, y, z + nz * width / 2);
            positions.push(x - nx * width / 2, y, z - nz * width / 2);
            if (i < RIBBON_STEPS) {
                const a = i * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, build.mat(color, { side: THREE.DoubleSide }));
    }

    /** Glowing posts down both edges: the cheap way to read the racing line at speed. */
    function barriers() {
        const count = 120;
        const geo = new THREE.BoxGeometry(0.35, 0.9, 1.6);
        const mesh = new THREE.InstancedMesh(geo, build.emissive(0xf59e0b, 0.6), count * 2);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const pos = new THREE.Vector3();
        const one = new THREE.Vector3(1, 1, 1);

        let i = 0;
        for (let s = 0; s < count; s++) {
            const { x, z, hx, hz } = pointAt((s / count) * LENGTH);
            const nx = -hz;
            const nz = hx;
            e.set(0, Math.atan2(hx, hz), 0);
            q.setFromEuler(e);
            for (const side of [-1, 1]) {
                pos.set(x + nx * side * (WIDTH / 2 + 0.9), 0.45, z + nz * side * (WIDTH / 2 + 0.9));
                m.compose(pos, q, one);
                mesh.setMatrixAt(i++, m);
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
        return mesh;
    }

    function buildPads(pads) {
        const group = new THREE.Group();
        for (const pad of pads) {
            const { x, z, hx, hz } = pointAt(pad.p);
            const nx = -hz;
            const nz = hx;
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(4, 4.5),
                build.mat(pad.kind === 'boost' ? 0x06d6a0 : 0x1a1a22, {
                    emissive: pad.kind === 'boost' ? 0x06d6a0 : 0x000000,
                    emissiveIntensity: pad.kind === 'boost' ? 0.8 : 0,
                    transparent: true,
                    opacity: pad.kind === 'boost' ? 0.85 : 0.92,
                }),
            );
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.z = -Math.atan2(hx, hz);
            mesh.position.set(x + nx * pad.lat, 0.06, z + nz * pad.lat);
            group.add(mesh);
        }
        return group;
    }

    function buildCar(player) {
        const color = ctx.colorOf(player.slot);
        const g = new THREE.Group();

        const body = build.box(1.5, 0.5, 2.9, color);
        body.position.y = 0.55;
        const cabin = build.box(1.15, 0.45, 1.3, 0x11151f);
        cabin.position.set(0, 0.98, -0.15);
        const nose = build.box(1.3, 0.28, 0.5, color);
        nose.position.set(0, 0.42, 1.6);
        const wing = build.box(1.55, 0.32, 0.2, 0x2b3242);
        wing.position.set(0, 0.95, -1.5);
        g.add(body, cabin, nose, wing);

        const wheels = [];
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const w = build.cylinder(0.42, 0.42, 0.3, 0x14171f, 10);
                w.rotation.z = Math.PI / 2;
                w.position.set(sx * 0.82, 0.4, sz * 1.0);
                g.add(w);
                wheels.push(w);
            }
        }

        if (player.id !== ctx.selfId) {
            const plate = build.nameplate(player.name, player.slot);
            plate.position.y = 2.1;
            g.add(plate);
        }

        scene.add(g);
        return { group: g, wheels };
    }

    const findRow = (rows, slot) => rows.find((r) => r[0] === slot);

    // --------------------------------------------------------------- lifecycle

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;
            laps = full.laps ?? 3;

            scene.add(build.skyDome(0x22365e, 0x0b0c10));   // floodlit stadium night

            // A dark infield disc plus an outer apron, so the circuit reads as a
            // stadium rather than a ribbon floating in space.
            const infield = new THREE.Mesh(
                new THREE.CircleGeometry(RADIUS + STRAIGHT / 2 + 34, 48),
                build.mat(0x12331e),
            );
            infield.rotation.x = -Math.PI / 2;
            infield.position.y = -0.08;
            scene.add(infield);

            scene.add(tarmac(WIDTH + 2.4, 0.0, 0xf59e0b));    // kerb
            scene.add(tarmac(WIDTH, 0.02, 0x30343f));         // road
            scene.add(barriers());
            scene.add(buildPads(full.pads ?? []));

            // Start/finish line.
            const line = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, 1.4), build.mat(0xf3f4f6));
            const start = pointAt(0);
            line.rotation.x = -Math.PI / 2;
            line.rotation.z = -Math.atan2(start.hx, start.hz);
            line.position.set(start.x, 0.05, start.z);
            scene.add(line);

            for (const p of ctx.players()) cars.set(p.slot, buildCar(p));

            const me = cars.get(selfSlot);
            if (me) selfPos.copy(me.group.position);
            camera.position.set(selfPos.x, selfPos.y + 6, selfPos.z - 10);

            input.setLayout({ stick: true, a: true, b: true, aLabel: 'GO', bLabel: 'BRK' });
            hud.setObjective(`Lap 1 of ${laps}`);
        },

        onState(s) {
            laps = s.laps ?? laps;
            buffer.push(s.p);
            const mine = findRow(s.p, selfSlot);
            if (mine && mine[5] !== shownLap) {
                shownLap = mine[5];
                hud.setObjective(`Lap ${Math.min(laps, shownLap + 1)} of ${laps}`);
            }
        },

        onEvent(e) {
            switch (e.e) {
                case 'lights':
                    hud.banner('GO!', 1200);
                    sound.win();
                    break;
                case 'lap':
                    if (e.by === ctx.selfId) {
                        hud.banner(`Lap ${e.lap} — ${(e.time / 1000).toFixed(1)}s`, 1600);
                        sound.good();
                    }
                    break;
                case 'finish': {
                    const who = e.by === ctx.selfId ? 'You finished' : `${ctx.nameOf(e.by)} finished`;
                    hud.toast(`${who} — P${e.place}`);
                    if (e.by === ctx.selfId) { hud.banner(`FINISHED P${e.place}`, 2600); sound.win(); }
                    break;
                }
                case 'boost': {
                    const car = cars.get(e.slot);
                    if (car) particles.burst(car.group.position.x, 0.4, car.group.position.z,
                        { color: 0x06d6a0, count: 10, speed: 6, up: 0.4 });
                    if (e.slot === selfSlot) sound.pickup();
                    break;
                }
                case 'oil':
                    if (e.slot === selfSlot) { hud.toast('Oil! Hold on…'); sound.bad(); }
                    break;
                case 'bump':
                    particles.burst(e.x, 0.6, e.z, { color: 0xffd166, count: 6, speed: 4, life: 0.4 });
                    if (e.a === selfSlot || e.b === selfSlot) sound.tick();
                    break;
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);

            if (frame) {
                for (const row of frame.b) {
                    const [slot, x, z, h, v] = row;
                    const car = cars.get(slot);
                    if (!car) continue;
                    // Row layout is [slot, x, z, heading, speed, lap, finished].
                    const prev = findRow(frame.a, slot) ?? row;
                    car.group.position.set(
                        interp.lerp(prev[1], x, frame.t),
                        0,
                        interp.lerp(prev[2], z, frame.t),
                    );
                    car.group.rotation.y = interp.lerpAngle(prev[3], h, frame.t);
                    for (const w of car.wheels) w.rotation.x += v * dt * 2.4;
                    if (slot === selfSlot) { selfPos.copy(car.group.position); camSpeed = v; }
                }
            }

            // Chase camera: it sits further back the faster you go, which is the whole
            // trick behind making 30 units per second feel like speed.
            const me = cars.get(selfSlot);
            const heading = me ? me.group.rotation.y : 0;
            const back = 7.4 + Math.abs(camSpeed) * 0.14;
            camGoal.set(
                selfPos.x - Math.sin(heading) * back,
                3.4 + Math.abs(camSpeed) * 0.03,
                selfPos.z - Math.cos(heading) * back,
            );
            camera.position.lerp(camGoal, 1 - Math.exp(-7 * dt));
            camLook.set(selfPos.x + Math.sin(heading) * 7, 0.9, selfPos.z + Math.cos(heading) * 7);
            camera.lookAt(camLook);

            // The A button is the accelerator on touch; on a keyboard the stick's own
            // forward axis already does it, so the two are simply combined.
            const throttle = interp.clamp(input.axes.y + (input.buttons.a ? 1 : 0) - (input.buttons.b ? 1 : 0), -1, 1);
            net.input({ ax: input.axes.x, ay: throttle });
        },

        dispose() {
            cars.clear();
            buffer.clear();
        },
    };
}
