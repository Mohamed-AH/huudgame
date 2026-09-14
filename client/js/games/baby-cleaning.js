import { createCrew } from '../lib/crew.js';

/**
 * Baby Cleaning — a bright nursery, 56 toys, 12 stains and a clock.
 *
 * The toys are one InstancedMesh with per-instance colour and a swap-free "hide by
 * scaling to zero" rule: a toy picked up is scaled away and the carrier grows one in
 * their hands, so 56 objects cost a single draw call however chaotic the room gets.
 */

export const meta = { id: 'baby-cleaning' };

const CATEGORY_COLORS = [0xff5d5d, 0xffb703, 0x4cc9f0, 0x7bdc6b];

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const carried = new Map();        // slot -> toy mesh in hands
    const stainMeshes = [];
    let crew = null;
    let toyMesh = null;
    let toyRows = [];
    let categories = [];
    let pct = 0;

    const TOY_GEO = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const matrix = new THREE.Matrix4();

    function setToyVisible(index, visible, x = 0, z = 0) {
        if (!toyMesh) return;
        if (visible) {
            matrix.makeRotationY(index * 1.7);
            matrix.setPosition(x, 0.28, z);
        } else {
            matrix.makeScale(0, 0, 0);
        }
        toyMesh.setMatrixAt(index, matrix);
        toyMesh.instanceMatrix.needsUpdate = true;
    }

    function buildToys(rows) {
        toyRows = rows;
        const mesh = new THREE.InstancedMesh(TOY_GEO, build.mat(0xffffff), Math.max(1, rows.length));
        mesh.frustumCulled = false;
        const color = new THREE.Color();
        rows.forEach(([id, x, z, cat, state], i) => {
            if (state === 0) { matrix.makeRotationY(i * 1.7); matrix.setPosition(x, 0.28, z); }
            else matrix.makeScale(0, 0, 0);
            mesh.setMatrixAt(i, matrix);
            mesh.setColorAt(i, color.setHex(CATEGORY_COLORS[cat]));
        });
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
        toyMesh = mesh;
    }

    function buildStains(rows) {
        for (const [id, x, z, progress] of rows) {
            const stain = new THREE.Mesh(
                new THREE.CircleGeometry(1.5, 16),
                new THREE.MeshBasicMaterial({ color: 0x6b5a3a, transparent: true, opacity: 0.75 }),
            );
            stain.rotation.x = -Math.PI / 2;
            stain.position.set(x, 0.03, z);
            stain.scale.setScalar(1 - progress);
            scene.add(stain);
            stainMeshes[id] = stain;
        }
    }

    function buildBins(rows) {
        for (const [cat, x, z] of rows) {
            const g = new THREE.Group();
            g.position.set(x, 0, z);
            const body = build.box(2.2, 1.3, 2.2, CATEGORY_COLORS[cat]);
            body.position.y = 0.65;
            const lip = build.box(2.4, 0.18, 2.4, 0xffffff);
            lip.position.y = 1.36;
            const label = build.nameplate((categories[cat] ?? '').toUpperCase(), 0, { scale: 2.6 });
            label.position.y = 2.2;
            g.add(body, lip, label);
            scene.add(g);
        }
    }

    return {
        async build(full) {
            categories = full.categories ?? ['toys'];
            pct = full.pct ?? 0;

            ctx.engine.setLighting({ hemi: 1.3, sun: 0.6, sky: 0xfff2e0, ground: 0x6b5f52 });
            scene.add(build.skyDome(0x6d5a7a, 0x2b2233));

            const [rx, rz] = full.room ?? [13, 9];
            const rug = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2 + 3, rz * 2 + 3), build.mat(0xf6e3c8));
            rug.rotation.x = -Math.PI / 2;
            scene.add(rug);

            // Low walls so the nursery reads as a room rather than a mat in the void.
            for (const [w, d, x, z] of [[rx * 2 + 3, 0.6, 0, -rz - 1.5], [rx * 2 + 3, 0.6, 0, rz + 1.5],
                [0.6, rz * 2 + 3, -rx - 1.5, 0], [0.6, rz * 2 + 3, rx + 1.5, 0]]) {
                const wall = build.box(w, 1.4, d, 0xd9bfa3);
                wall.position.set(x, 0.7, z);
                scene.add(wall);
            }

            buildBins(full.bins ?? []);
            buildStains(full.stains ?? []);
            buildToys(full.toys ?? []);

            crew = createCrew(ctx);

            // A fixed overview: this is a search task, and you cannot plan a route to
            // a bin you cannot see.
            camera.position.set(0, 17, 13.5);
            camera.lookAt(0, 0, 0);

            input.setLayout({ stick: true, a: true, b: true, aLabel: 'GRAB', bLabel: 'SCRUB' });
            hud.buildPanel(`<div class="meter"><i id="bc-pct" style="width:${pct}%"></i></div>`);
            hud.setObjective('Toys in the matching bin, stains scrubbed');
        },

        onState(s) {
            buffer.push(s.p);
            if (s.pct !== pct) {
                pct = s.pct;
                const bar = document.getElementById('bc-pct');
                if (bar) bar.style.width = `${pct}%`;
                hud.setObjective(`Tidy: ${pct}%`);
            }
            (s.st ?? []).forEach((progress, id) => {
                const stain = stainMeshes[id];
                if (!stain) return;
                stain.scale.setScalar(Math.max(0.001, 1 - progress));
                stain.material.opacity = 0.75 * (1 - progress);
                stain.visible = progress < 1;
            });
        },

        onEvent(e) {
            const index = toyRows.findIndex((r) => r[0] === e.id);
            switch (e.e) {
                case 'pick':
                    setToyVisible(index, false);
                    if (e.by === ctx.selfId) sound.pickup();
                    break;
                case 'drop':
                    setToyVisible(index, true, e.x, e.z);
                    break;
                case 'bin':
                    setToyVisible(index, false);
                    if (e.by === ctx.selfId) {
                        e.ok ? sound.good() : sound.tick();
                        if (!e.ok) hud.toast('Wrong bin — still tidier though');
                    } else if (e.ok) {
                        hud.toastFor(e.by, 'sorted a toy', 15);
                    }
                    break;
                case 'clean': {
                    const stain = stainMeshes[e.id];
                    if (stain) particles.burst(stain.position.x, 0.3, stain.position.z,
                        { color: 0x9be3b8, count: 12, speed: 3.5, life: 0.7 });
                    hud.toast('Stain gone!', '#06d6a0');
                    sound.good();
                    break;
                }
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);
            crew.apply(frame);

            for (const [slot, member] of crew.members) {
                const cat = crew.extra(slot)?.[0] ?? 0;
                let held = carried.get(slot);
                if (cat > 0 && !held) {
                    held = new THREE.Mesh(TOY_GEO, build.mat(CATEGORY_COLORS[cat - 1]));
                    held.position.set(0, 1.5, 0.42);
                    member.group.add(held);
                    carried.set(slot, held);
                } else if (cat === 0 && held) {
                    member.group.remove(held);
                    carried.delete(slot);
                } else if (held) {
                    held.material = build.mat(CATEGORY_COLORS[cat - 1]);
                    held.rotation.y += dt * 2;
                }
            }

            if (input.pressed('a')) net.action({ a: 'use' });
            net.input({ ax: input.axes.x, ay: input.axes.y, b: input.buttons.b ? 1 : 0 });
        },

        dispose() {
            TOY_GEO.dispose();
            for (const stain of stainMeshes) { stain?.geometry.dispose(); stain?.material.dispose(); }
            stainMeshes.length = 0;
            carried.clear();
            toyRows = [];
            toyMesh = null;
            crew?.dispose();
            buffer.clear();
        },
    };
}
