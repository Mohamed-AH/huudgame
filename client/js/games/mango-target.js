/**
 * Mango Target — a tropical orchard, 14 throwers on an arc, and a lot of fruit.
 *
 * Aiming is the whole game, so the client shows a live trajectory arc computed with
 * exactly the constants the server integrates with. What you see the mango do is what
 * the server is about to make it do.
 */

export const meta = { id: 'mango-target' };

const GRAVITY = -17;            // must match server/src/games/mango-target.js
const ARC_STEPS = 26;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const anchorMeshes = new Map();     // anchor id -> mesh
    const anchorPos = new Map();        // anchor id -> fixed world position
    const flying = new Map();           // projectile/falling id -> mesh
    const pool = [];

    let stand = { x: 0, z: 8 };
    let aim = { yaw: 0, pitch: 0.55, pow: 0.7 };
    let arc = null;
    let selfSlot = 0;

    const MANGO_GEO = new THREE.IcosahedronGeometry(0.42, 1);

    // --------------------------------------------------------------- scenery

    function buildTree(x, z, seedIndex) {
        const g = new THREE.Group();
        const trunk = build.cylinder(0.45, 0.7, 4.4, 0x6b4a2f, 7);
        trunk.position.y = 2.2;
        g.add(trunk);

        // Three overlapping blobs read as foliage far more cheaply than a sphere at
        // any detail level that would look deliberate.
        for (let i = 0; i < 3; i++) {
            const blob = build.sphere(2.1 - i * 0.25, i === 1 ? 0x2f7d52 : 0x3f9d5a, 0);
            blob.position.set(
                Math.cos(seedIndex + i * 2.1) * 1.1,
                4.4 + i * 0.85,
                Math.sin(seedIndex + i * 2.1) * 1.1,
            );
            g.add(blob);
        }
        g.position.set(x, 0, z);
        return g;
    }

    function mangoMesh(gold) {
        const mesh = pool.pop() ?? new THREE.Mesh(MANGO_GEO, build.mat(0xffa62b));
        mesh.material = gold
            ? build.mat(0xffd700, { emissive: 0xffb703, emissiveIntensity: 0.9 })
            : build.mat(0xffa62b);
        mesh.scale.setScalar(gold ? 1.25 : 1);
        mesh.visible = true;
        return mesh;
    }

    function release(mesh) {
        mesh.visible = false;
        scene.remove(mesh);
        if (pool.length < 40) pool.push(mesh);
    }

    // ------------------------------------------------------------------ aiming

    /** The same ballistic step the server runs, drawn as a dotted arc. */
    function refreshArc() {
        if (!arc) return;
        const speed = 13 + aim.pow * 17;
        let x = stand.x;
        let y = 1.5;
        let z = stand.z;
        let vx = Math.sin(aim.yaw) * Math.cos(aim.pitch) * speed;
        let vy = Math.sin(aim.pitch) * speed;
        let vz = -Math.cos(aim.yaw) * Math.cos(aim.pitch) * speed;

        const points = arc.geometry.attributes.position.array;
        const dt = 0.07;
        for (let i = 0; i < ARC_STEPS; i++) {
            points[i * 3] = x;
            points[i * 3 + 1] = Math.max(0.1, y);
            points[i * 3 + 2] = z;
            vy += GRAVITY * dt;
            x += vx * dt;
            y += vy * dt;
            z += vz * dt;
        }
        arc.geometry.attributes.position.needsUpdate = true;
        arc.geometry.computeBoundingSphere();
    }

    function aimFromPointer(ndc) {
        aim.yaw = ndc.x * 0.95;
        aim.pitch = interp.clamp(0.3 + (ndc.y + 1) * 0.36, 0.1, 1.25);
        aim.pow = 0.75;
        refreshArc();
    }

    /**
     * Where the finger is pointing decides direction; how far it travelled decides
     * power. Using the drag *delta* for direction instead would mean a short flick
     * could only ever aim slightly off-centre, which is unusable on a phone.
     */
    function aimFromDrag(drag) {
        aim.yaw = interp.clamp((drag.nx ?? 0) * 0.95, -1.15, 1.15);
        aim.pitch = interp.clamp(0.3 + ((drag.ny ?? 0) + 1) * 0.36, 0.1, 1.25);
        aim.pow = interp.clamp(0.3 + drag.power * 0.8, 0.15, 1);
        refreshArc();
    }

    function throwNow() {
        net.action({ a: 'throw', yaw: interp.clamp(aim.yaw, -1.2, 1.2), pitch: aim.pitch, pow: aim.pow });
        sound.tone(420, 0.07, 'square');
    }

    // --------------------------------------------------------------- lifecycle

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;

            scene.add(build.skyDome(0x2a4a63, 0x10222b));      // warm tropical dusk
            const ground = new THREE.Mesh(new THREE.CircleGeometry(110, 40), build.mat(0x3f7d4a));
            ground.rotation.x = -Math.PI / 2;
            scene.add(ground);

            (full.trees ?? []).forEach((t, i) => scene.add(buildTree(t.x, t.z, i * 1.7)));

            for (const [id, x, y, z, state] of full.anchors ?? []) {
                const mesh = mangoMesh(state === 2);
                mesh.position.set(x, y, z);
                mesh.visible = state !== 0;
                if (mesh.visible) scene.add(mesh);
                anchorMeshes.set(id, mesh);
                anchorPos.set(id, new THREE.Vector3(x, y, z));
            }

            const seated = new Map(ctx.players().map((p) => [p.slot, p]));
            for (const [slot, x, z] of full.stands ?? []) {
                const pad = build.cylinder(0.75, 0.85, 0.28, seated.has(slot) ? 0x8d6a4a : 0x243044, 10);
                pad.position.set(x, 0.15, z);
                scene.add(pad);

                const player = seated.get(slot);
                if (!player) continue;
                const who = build.avatar(slot);
                who.position.set(x, 0.3, z);
                who.rotation.y = Math.PI;                       // face the orchard
                if (player.id !== ctx.selfId) {
                    const plate = build.nameplate(player.name, slot);
                    plate.position.y = 2.1;
                    who.add(plate);
                }
                scene.add(who);
                if (slot === selfSlot) stand = { x, z };
            }

            const arcGeo = new THREE.BufferGeometry();
            arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_STEPS * 3), 3));
            arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.75 }));
            arc.frustumCulled = false;
            scene.add(arc);
            refreshArc();

            // High enough behind the throwing line that the whole family is in shot
            // and the orchard fills the middle of the frame.
            // Aimed at the near ground rather than at the trees: a look axis pointed
            // at the orchard puts the throwing line below the bottom of the frame.
            camera.position.set(stand.x * 0.5, 9, stand.z + 12);
            camera.lookAt(stand.x * 0.2, 2.6, -6);

            input.setLayout({ a: true, aLabel: 'THROW' });
            input.onTap = (ndc) => { aimFromPointer(ndc); throwNow(); };
            input.onDragMove = (drag) => aimFromDrag(drag);
            input.onDragEnd = (drag) => { aimFromDrag(drag); throwNow(); };
            hud.setObjective('Drag to aim, release to throw');
        },

        onState(s) {
            buffer.push({ f: s.f ?? [], s: s.s ?? [] });
        },

        onEvent(e) {
            switch (e.e) {
                case 'ripe': {
                    // A gold mango is a different material, so the mesh is swapped
                    // rather than re-coloured. Anchor positions are held separately
                    // because the old mesh may already be back in the pool.
                    const previous = anchorMeshes.get(e.id);
                    if (previous) { scene.remove(previous); release(previous); }
                    const mesh = mangoMesh(!!e.gold);
                    mesh.position.copy(anchorPos.get(e.id) ?? new THREE.Vector3());
                    scene.add(mesh);
                    anchorMeshes.set(e.id, mesh);
                    if (e.gold) hud.toast('A golden mango!', '#ffd700');
                    break;
                }
                case 'gone': {
                    const mesh = anchorMeshes.get(e.id);
                    if (mesh) mesh.visible = false;
                    break;
                }
                case 'detach':
                    hud.toast('A mango is falling!');
                    break;
                case 'splat':
                    particles.burst(e.x, 0.4, e.z, { color: 0xffa62b, count: 8, speed: 3, life: 0.6 });
                    break;
                case 'hit': {
                    particles.burst(e.x, e.y, e.z, {
                        color: e.kind === 'gold' ? 0xffd700 : 0xffa62b,
                        count: e.kind === 'gold' ? 30 : 14,
                        speed: e.kind === 'gold' ? 8 : 5,
                    });
                    const label = e.kind === 'gold' ? 'hit the GOLDEN mango' : e.kind === 'falling' ? 'caught one falling' : 'hit a mango';
                    hud.toastFor(e.by, label, e.pts);
                    if (e.by === ctx.selfId) {
                        if (e.streak >= 3) hud.banner(`STREAK ${e.streak}  x${e.mult}`, 1200);
                        e.kind === 'gold' ? sound.win() : sound.good();
                    }
                    break;
                }
                case 'streakEnd':
                    if (e.by === ctx.selfId && e.at >= 3) hud.toast(`Streak of ${e.at} broken`);
                    break;
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);

            if (frame) {
                const live = new Set();
                for (const group of ['f', 's']) {
                    // Falling fruit is [id,x,y,z]; a thrown mango is [id,slot,x,y,z].
                    const at = group === 'f' ? 1 : 2;
                    for (const row of frame.b[group]) {
                        const id = `${group}${row[0]}`;
                        live.add(id);
                        let mesh = flying.get(id);
                        if (!mesh) {
                            mesh = mangoMesh(false);
                            if (group === 's') mesh.scale.setScalar(0.7);
                            scene.add(mesh);
                            flying.set(id, mesh);
                        }
                        // A mango in flight at 20Hz is visibly steppy without this.
                        const prev = frame.a[group].find((r) => r[0] === row[0]) ?? row;
                        mesh.position.set(
                            interp.lerp(prev[at], row[at], frame.t),
                            interp.lerp(prev[at + 1], row[at + 1], frame.t),
                            interp.lerp(prev[at + 2], row[at + 2], frame.t),
                        );
                        mesh.rotation.x += dt * 6;
                        mesh.rotation.z += dt * 4;
                    }
                }
                for (const [id, mesh] of flying) {
                    if (live.has(id)) continue;
                    release(mesh);
                    flying.delete(id);
                }
            }

            if (input.touchLikely && input.pressed('a')) throwNow();
            if (!input.touchLikely && !input.drag.active) aimFromPointer(input.pointer);
        },

        dispose() {
            input.onTap = input.onDragMove = input.onDragEnd = null;
            MANGO_GEO.dispose();
            arc?.geometry.dispose();
            arc?.material.dispose();
            anchorMeshes.clear();
            anchorPos.clear();
            flying.clear();
            pool.length = 0;
            buffer.clear();
        },
    };
}
