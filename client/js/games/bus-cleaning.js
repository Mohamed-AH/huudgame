import {
    BUS, COLS, ROWS, TOTAL_CELLS, SPRAY_RADIUS,
    cellCenter, castAtBus,
} from 'shared/bus.js';
import { createCrew } from '../lib/crew.js';

/**
 * Bus Cleaning — one enormous dirty bus and up to 14 pressure washers.
 *
 * The grime is a single InstancedMesh of 396 panels laid over three faces of the bus.
 * Each panel's scale and colour carry its remaining strength, so grime "peels away"
 * as it is washed without a texture, a shader or a second draw call.
 *
 * The aim reticle uses the same ray/box cast the server scrubs with, so the ring on
 * the panel is exactly the patch that is about to get clean.
 */

export const meta = { id: 'bus-cleaning' };

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const grime = new Float32Array(TOTAL_CELLS);
    let grimeMesh = null;
    let reticle = null;
    let crew = null;
    let pct = 0;
    let yaw = 0;
    let pitch = 0.15;
    let spraying = false;

    const GRIME_GEO = new THREE.PlaneGeometry(1, 1);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const color = new THREE.Color();
    const camGoal = new THREE.Vector3();

    /** Rotation that lays a plane flat against a given face of the bus. */
    function faceQuaternion(face) {
        const e = new THREE.Euler();
        if (face === 0) e.set(0, Math.PI, 0);          // -z side
        else if (face === 1) e.set(0, 0, 0);           // +z side
        else e.set(-Math.PI / 2, 0, 0);                // roof
        return new THREE.Quaternion().setFromEuler(e);
    }
    const FACE_Q = [faceQuaternion(0), faceQuaternion(1), faceQuaternion(2)];

    function paintCell(index) {
        const face = Math.floor(index / (COLS * ROWS));
        const rest = index % (COLS * ROWS);
        const c = Math.floor(rest / ROWS);
        const r = rest % ROWS;
        const strength = grime[index];

        const centre = cellCenter(face, c, r);
        const cw = (BUS.x1 - BUS.x0) / COLS;
        const ch = face === 2 ? (BUS.z1 - BUS.z0) / ROWS : (BUS.y1 - BUS.y0) / ROWS;

        // Strength drives size as well as colour: a nearly-clean panel is a small
        // faint smear rather than a tile that vanishes all at once.
        const k = Math.max(0, Math.min(1, strength / 2));
        pos.set(centre.x + centre.nx * 0.04, centre.y + centre.ny * 0.04, centre.z + centre.nz * 0.04);
        scl.set(cw * (0.35 + k * 0.72), ch * (0.35 + k * 0.72), 1);
        quat.copy(FACE_Q[face]);
        matrix.compose(pos, quat, k <= 0.01 ? scl.setScalar(0) : scl);
        grimeMesh.setMatrixAt(index, matrix);
        grimeMesh.setColorAt(index, color.setHSL(0.09, 0.35, 0.16 + (1 - k) * 0.22));
    }

    function buildBus() {
        const g = new THREE.Group();
        const len = BUS.x1 - BUS.x0;
        const hgt = BUS.y1 - BUS.y0;
        const wid = BUS.z1 - BUS.z0;

        const body = build.box(len, hgt, wid, 0xf2b705);
        body.position.set(0, (BUS.y0 + BUS.y1) / 2, 0);
        g.add(body);

        const skirt = build.box(len + 0.2, 0.7, wid + 0.2, 0x2b3242);
        skirt.position.y = BUS.y0 + 0.1;
        g.add(skirt);

        // Windows down both sides and a darker upper deck band.
        for (let i = 0; i < 8; i++) {
            for (const side of [-1, 1]) {
                const win = build.box(2.1, 1.5, 0.1, 0x1b2740);
                win.position.set(BUS.x0 + 2.4 + i * 3.0, BUS.y0 + 4.6, side * (wid / 2 + 0.06));
                g.add(win);
            }
        }
        const band = build.box(len + 0.05, 0.3, wid + 0.05, 0xd94f04);
        band.position.y = BUS.y0 + 3.3;
        g.add(band);

        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const wheel = build.cylinder(1.1, 1.1, 0.6, 0x14171f, 12);
                wheel.rotation.x = Math.PI / 2;
                wheel.position.set(sx * (len / 2 - 3), 1.05, sz * (wid / 2 + 0.1));
                g.add(wheel);
            }
        }
        scene.add(g);
    }

    return {
        async build(full) {
            pct = full.pct ?? 0;
            (full.grime ?? []).forEach((v, i) => { grime[i] = v; });

            ctx.engine.setLighting({ hemi: 1.15, sun: 0.7, sky: 0xdfeaff });
            scene.add(build.skyDome(0x3a5578, 0x151d2b));

            const yard = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), build.mat(0x3a3f48));
            yard.rotation.x = -Math.PI / 2;
            scene.add(yard);

            buildBus();

            grimeMesh = new THREE.InstancedMesh(
                GRIME_GEO,
                new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
                TOTAL_CELLS,
            );
            grimeMesh.frustumCulled = false;
            scene.add(grimeMesh);
            for (let i = 0; i < TOTAL_CELLS; i++) paintCell(i);
            grimeMesh.instanceMatrix.needsUpdate = true;

            reticle = new THREE.Mesh(
                new THREE.RingGeometry(SPRAY_RADIUS * 0.8, SPRAY_RADIUS, 20),
                new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
            );
            reticle.visible = false;
            scene.add(reticle);

            crew = createCrew(ctx);
            const side = (ctx.playerById(ctx.selfId)?.slot ?? 0) % 2 === 0 ? -1 : 1;
            yaw = side < 0 ? 0 : Math.PI;

            input.setLayout({ stick: true, a: true, aLabel: 'SPRAY' });
            input.onDragMove = (drag) => {
                yaw -= drag.dx * 0.006;
                pitch = interp.clamp(pitch - drag.dy * 0.004, -0.4, 1.1);
                drag.sx = drag.x;
                drag.sy = drag.y;
            };
            hud.buildPanel(`<div class="meter"><i id="bs-pct" style="width:${pct}%"></i></div>`);
            hud.setObjective('Drag to aim the hose, hold SPRAY');
        },

        onState(s) {
            buffer.push(s.p);
            if (s.c) {
                for (let i = 0; i < s.c.length; i += 2) {
                    grime[s.c[i]] = s.c[i + 1];
                    paintCell(s.c[i]);
                }
                grimeMesh.instanceMatrix.needsUpdate = true;
                if (grimeMesh.instanceColor) grimeMesh.instanceColor.needsUpdate = true;
            }
            if (s.pct !== pct) {
                pct = s.pct;
                const bar = document.getElementById('bs-pct');
                if (bar) bar.style.width = `${pct}%`;
                hud.setObjective(`Clean: ${pct}%`);
                if (pct > 0 && pct % 25 === 0) sound.good();
            }
        },

        onEvent() { /* this game speaks entirely through the grid */ },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);
            crew.apply(frame);

            // Everyone's jet, including yours, drawn from their own nozzle.
            for (const [slot, member] of crew.members) {
                const extra = crew.extra(slot);
                if (!extra || !extra[2]) continue;
                const [theirYaw, theirPitch] = extra;
                const ox = member.group.position.x;
                const oz = member.group.position.z;
                const hit = castAtBus(ox, 1.6, oz,
                    Math.sin(theirYaw) * Math.cos(theirPitch), Math.sin(theirPitch), Math.cos(theirYaw) * Math.cos(theirPitch));
                if (!hit) continue;
                particles.burst(
                    ox + Math.sin(theirYaw) * 0.8, 1.7, oz + Math.cos(theirYaw) * 0.8,
                    { color: 0xbfe6ff, count: 2, speed: 6, up: 0.2, life: 0.28, spread: 0.5 },
                );
                if (Math.random() < 0.4) {
                    particles.burst(hit.hx, hit.hy, hit.hz,
                        { color: 0xe8f4ff, count: 2, speed: 3, up: 0.8, life: 0.4, spread: 0.8 });
                }
            }

            // Your own reticle, cast with the server's own maths.
            const dirX = Math.sin(yaw) * Math.cos(pitch);
            const dirY = Math.sin(pitch);
            const dirZ = Math.cos(yaw) * Math.cos(pitch);
            const mine = castAtBus(crew.selfPos.x, 1.6, crew.selfPos.z, dirX, dirY, dirZ);
            reticle.visible = !!mine;
            if (mine) {
                reticle.position.set(
                    mine.hx + (mine.face === 0 ? -0.1 : mine.face === 1 ? 0.1 : 0),
                    mine.hy + (mine.face === 2 ? 0.1 : 0),
                    mine.hz,
                );
                reticle.quaternion.copy(FACE_Q[mine.face]);
            }

            spraying = input.buttons.a;

            const back = 13;
            camGoal.set(
                crew.selfPos.x - Math.sin(yaw) * back,
                8.5,
                crew.selfPos.z - Math.cos(yaw) * back,
            );
            camera.position.lerp(camGoal, 1 - Math.exp(-5 * dt));
            camera.lookAt(crew.selfPos.x + Math.sin(yaw) * 4, 3.4, crew.selfPos.z + Math.cos(yaw) * 4);

            net.input({ ax: input.axes.x, ay: input.axes.y, yw: yaw, pt: pitch, h: spraying ? 1 : 0 });
        },

        dispose() {
            input.onDragMove = null;
            GRIME_GEO.dispose();
            grimeMesh?.material.dispose();
            reticle?.geometry.dispose();
            reticle?.material.dispose();
            crew?.dispose();
            buffer.clear();
        },
    };
}
