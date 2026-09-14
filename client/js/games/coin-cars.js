/**
 * Collecting Car Coins — a neon bowl, fourteen bumper cars, a floor full of coins.
 *
 * Pickups are a pooled InstancedMesh keyed by id: coins spawn and vanish constantly
 * (every bump scatters more), so allocating a mesh per coin would churn the heap all
 * round. A freed slot is scaled to zero and handed back out on the next spawn.
 */

export const meta = { id: 'coin-cars' };

const PICKUP_STYLE = {
    coin:   { color: 0xffd166, scale: 1.0, y: 0.55 },
    gem:    { color: 0xc77dff, scale: 1.4, y: 0.75 },
    shield: { color: 0x4cc9f0, scale: 1.5, y: 0.8 },
};
const MAX_PICKUPS = 96;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const cars = new Map();
    const slotOfId = new Map();        // pickup id -> instance slot
    const freeSlots = [];
    let pickupMesh = null;
    let radius = 20;
    let selfSlot = 0;
    let spin = 0;

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const euler = new THREE.Euler();
    const color = new THREE.Color();
    const camGoal = new THREE.Vector3();

    function addPickup(id, kind, x, z) {
        if (slotOfId.has(id)) return;
        const slot = freeSlots.pop();
        if (slot === undefined) return;              // arena is saturated; skip the visual
        slotOfId.set(id, { slot, kind, x, z });
        color.setHex(PICKUP_STYLE[kind]?.color ?? 0xffd166);
        pickupMesh.setColorAt(slot, color);
        drawPickup(slot, kind, x, z, 0);
        if (pickupMesh.instanceColor) pickupMesh.instanceColor.needsUpdate = true;
    }

    function removePickup(id) {
        const entry = slotOfId.get(id);
        if (!entry) return null;
        slotOfId.delete(id);
        matrix.makeScale(0, 0, 0);
        pickupMesh.setMatrixAt(entry.slot, matrix);
        pickupMesh.instanceMatrix.needsUpdate = true;
        freeSlots.push(entry.slot);
        return entry;
    }

    function drawPickup(slot, kind, x, z, phase) {
        const style = PICKUP_STYLE[kind] ?? PICKUP_STYLE.coin;
        pos.set(x, style.y + Math.sin(phase) * 0.15, z);
        euler.set(kind === 'coin' ? Math.PI / 2 : 0, phase, 0);
        quat.setFromEuler(euler);
        scl.setScalar(style.scale);
        matrix.compose(pos, quat, scl);
        pickupMesh.setMatrixAt(slot, matrix);
    }

    function buildCar(player) {
        const g = new THREE.Group();
        const paint = ctx.colorOf(player.slot);

        const body = build.cylinder(1.15, 1.25, 0.7, paint, 12);
        body.position.y = 0.5;
        const bumper = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.22, 6, 16), build.mat(0x2b3242));
        bumper.rotation.x = Math.PI / 2;
        bumper.position.y = 0.45;
        const seat = build.box(0.9, 0.55, 0.9, 0x11151f);
        seat.position.set(0, 1.05, -0.2);
        const pole = build.cylinder(0.07, 0.07, 1.6, 0x9aa3b2, 6);
        pole.position.set(0, 1.9, -0.4);
        g.add(body, bumper, seat, pole);

        const driver = build.sphere(0.34, 0xf5d0a9, 0);
        driver.position.set(0, 1.55, -0.2);
        g.add(driver);

        const shield = new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.7, 1),
            new THREE.MeshBasicMaterial({ color: 0x4cc9f0, wireframe: true, transparent: true, opacity: 0.55 }),
        );
        shield.position.y = 0.9;
        shield.visible = false;
        g.add(shield);

        if (player.id !== ctx.selfId) {
            const plate = build.nameplate(player.name, player.slot);
            plate.position.y = 2.9;
            g.add(plate);
        } else {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(1.45, 1.7, 24),
                new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.05;
            g.add(ring);
        }

        scene.add(g);
        return { group: g, shield };
    }

    const findRow = (rows, slot) => rows.find((r) => r[0] === slot);

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;
            radius = full.radius ?? 20;

            ctx.engine.setLighting({ hemi: 0.75, sun: 0.4, sky: 0xa9c6ff, ground: 0x241a3a });
            scene.add(build.skyDome(0x2a1a4a, 0x0b0c14));

            const floor = build.arenaFloor(radius, 0x241b3d, 0x120c21);
            scene.add(floor);

            // The bowl wall: a ring of glowing posts plus a low lip, so the edge of the
            // arena is unmistakable at speed.
            scene.add(build.boundaryRing(radius, 56, 0xc77dff, 1.6));
            const lip = new THREE.Mesh(
                new THREE.TorusGeometry(radius, 0.35, 8, 48),
                build.emissive(0x9b5de5, 0.7),
            );
            lip.rotation.x = Math.PI / 2;
            lip.position.y = 0.3;
            scene.add(lip);

            pickupMesh = new THREE.InstancedMesh(
                new THREE.CylinderGeometry(0.38, 0.38, 0.12, 10),
                build.mat(0xffffff, { emissive: 0x444444, emissiveIntensity: 0.5 }),
                MAX_PICKUPS,
            );
            pickupMesh.frustumCulled = false;
            scene.add(pickupMesh);
            for (let i = MAX_PICKUPS - 1; i >= 0; i--) {
                matrix.makeScale(0, 0, 0);
                pickupMesh.setMatrixAt(i, matrix);
                freeSlots.push(i);
            }
            pickupMesh.instanceMatrix.needsUpdate = true;

            for (const [id, kind, x, z] of full.pickups ?? []) addPickup(id, kind, x, z);
            for (const p of ctx.players()) cars.set(p.slot, buildCar(p));

            input.setLayout({ stick: true, a: true, b: true, aLabel: 'GO', bLabel: 'BRK' });
            hud.setObjective('Grab coins — bump the leader and they spill');
        },

        onState(s) {
            buffer.push(s.p);
            const mine = findRow(s.p, selfSlot);
            if (mine) hud.setObjective(`${mine[4]} coins`);
        },

        onEvent(e) {
            switch (e.e) {
                case 'spawn':
                    addPickup(e.id, e.kind, e.x, e.z);
                    break;
                case 'grab': {
                    const entry = removePickup(e.id);
                    if (entry) {
                        particles.burst(entry.x, 0.6, entry.z, {
                            color: PICKUP_STYLE[entry.kind]?.color ?? 0xffd166,
                            count: e.kind === 'gem' ? 14 : 6, speed: 4, life: 0.5,
                        });
                    }
                    if (e.by === ctx.selfId) {
                        if (e.kind === 'shield') { hud.banner('SHIELD UP', 1100); sound.win(); }
                        else if (e.kind === 'gem') { hud.toast(`Gem! +${e.v}`); sound.good(); }
                        else sound.pickup();
                    }
                    break;
                }
                case 'bump':
                    particles.burst(e.x, 0.8, e.z, { color: 0xffd166, count: 10, speed: 6, life: 0.5 });
                    if (e.a === selfSlot || e.b === selfSlot) sound.tick();
                    break;
                case 'blocked':
                    if (e.slot === selfSlot) hud.toast('Shield held!', '#4cc9f0');
                    break;
                case 'spill':
                    if (e.slot === selfSlot) { hud.banner(`YOU DROPPED ${e.n}!`, 1100); sound.bad(); }
                    else hud.toast(`${ctx.nameOf(ctx.players().find((p) => p.slot === e.slot)?.id)} spilled ${e.n}`);
                    break;
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);

            let selfX = 0;
            let selfZ = 0;
            let heading = 0;
            if (frame) {
                for (const row of frame.b) {
                    const [slot, x, z, h, , shielded] = row;
                    const car = cars.get(slot);
                    if (!car) continue;
                    const prev = findRow(frame.a, slot) ?? row;
                    car.group.position.set(
                        interp.lerp(prev[1], x, frame.t),
                        0,
                        interp.lerp(prev[2], z, frame.t),
                    );
                    car.group.rotation.y = interp.lerpAngle(prev[3], h, frame.t);
                    car.shield.visible = !!shielded;
                    if (car.shield.visible) car.shield.rotation.y += dt * 1.8;
                    if (slot === selfSlot) {
                        selfX = car.group.position.x;
                        selfZ = car.group.position.z;
                        heading = car.group.rotation.y;
                    }
                }
            }

            spin += dt * 2.4;
            for (const entry of slotOfId.values()) drawPickup(entry.slot, entry.kind, entry.x, entry.z, spin);
            pickupMesh.instanceMatrix.needsUpdate = true;

            camGoal.set(selfX - Math.sin(heading) * 11, 9.5, selfZ - Math.cos(heading) * 11);
            camera.position.lerp(camGoal, 1 - Math.exp(-5 * dt));
            camera.lookAt(selfX + Math.sin(heading) * 4, 1, selfZ + Math.cos(heading) * 4);

            const throttle = interp.clamp(input.axes.y + (input.buttons.a ? 1 : 0) - (input.buttons.b ? 1 : 0), -1, 1);
            net.input({ ax: input.axes.x, ay: throttle });
        },

        dispose() {
            pickupMesh?.geometry.dispose();
            slotOfId.clear();
            freeSlots.length = 0;
            cars.clear();
            buffer.clear();
        },
    };
}
