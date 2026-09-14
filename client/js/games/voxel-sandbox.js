import {
    W, H, D, AIR, CELLS, BLOCKS, PALETTE, idx, xOf, yOf, zOf,
    worldX, worldZ, generateWorld,
} from 'shared/voxel.js';

/**
 * Voxel Sandbox — a bounded blocky island 14 people share.
 *
 * The whole world is a single InstancedMesh with per-instance colour, so 3000 blocks
 * cost one draw call. Blocks are added and removed with a swap-remove free list,
 * which makes every mutation O(1) instead of rebuilding geometry mid-round.
 *
 * The terrain itself is generated here from the round seed - identical to the
 * server's - so joining a room costs no world download at all.
 */

export const meta = { id: 'voxel-sandbox' };

const HEADROOM = 1800;        // blocks players may add beyond the generated terrain

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const cells = new Uint8Array(CELLS);
    const buffer = new interp.SnapshotBuffer();
    const avatars = new Map();          // slot -> { group, plate }
    const ghostSlot = new Map();        // cell index -> ghost instance id

    let voxels = null;                  // { mesh, set }
    let ghosts = null;
    let highlight = null;
    let selfSlot = 0;
    let held = PALETTE[0];
    let yaw = 0;
    let pitch = 0.62;
    let progress = 0;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const selfPos = new THREE.Vector3(0, 4, 0);
    let aimAt = null;
    let nextAimAt = 0;

    // ------------------------------------------------------------- voxel mesh

    function makeVoxelMesh(capacity) {
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshLambertMaterial({ flatShading: true }),
            capacity,
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;

        const slotOf = new Int32Array(CELLS).fill(-1);
        const cellAt = new Int32Array(capacity).fill(-1);
        const m = new THREE.Matrix4();
        const color = new THREE.Color();
        let count = 0;

        const place = (slot, cell, type) => {
            m.makeTranslation(worldX(xOf(cell)), yOf(cell) + 0.5, worldZ(zOf(cell)));
            mesh.setMatrixAt(slot, m);
            mesh.setColorAt(slot, color.setHex(BLOCKS[type]?.color ?? 0xff00ff));
            cellAt[slot] = cell;
            slotOf[cell] = slot;
        };

        function set(cell, type) {
            const slot = slotOf[cell];
            if (type === AIR) {
                if (slot < 0) return;
                const last = count - 1;
                if (slot !== last) place(slot, cellAt[last], cells[cellAt[last]]);
                slotOf[cell] = -1;
                cellAt[last] = -1;
                count = last;
                mesh.count = count;
            } else if (slot >= 0) {
                place(slot, cell, type);
            } else {
                if (count >= capacity) return;      // world is full; refuse rather than corrupt
                place(count++, cell, type);
                mesh.count = count;
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }

        return { mesh, set, cellAt, get count() { return count; } };
    }

    function makeGhosts(blueprint) {
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1.02, 1.02, 1.02),
            new THREE.MeshLambertMaterial({
                transparent: true, opacity: 0.38, flatShading: true, depthWrite: false,
                emissive: 0xffffff, emissiveIntensity: 0.25,
            }),
            Math.max(1, blueprint.length),
        );
        mesh.frustumCulled = false;
        const m = new THREE.Matrix4();
        const color = new THREE.Color();

        blueprint.forEach((cell, i) => {
            m.makeTranslation(worldX(cell.x), cell.y + 0.5, worldZ(cell.z));
            mesh.setMatrixAt(i, m);
            mesh.setColorAt(i, color.setHex(BLOCKS[cell.b]?.color ?? 0xffffff));
            ghostSlot.set(idx(cell.x, cell.y, cell.z), i);
        });
        mesh.instanceMatrix.needsUpdate = true;

        const hide = (cell) => {
            const i = ghostSlot.get(cell);
            if (i === undefined) return;
            // A filled cell keeps its instance but shrinks to nothing - cheaper and
            // simpler than compacting the buffer, and it can be restored if mined out.
            m.makeScale(0, 0, 0);
            mesh.setMatrixAt(i, m);
            mesh.instanceMatrix.needsUpdate = true;
        };
        const show = (cell) => {
            const i = ghostSlot.get(cell);
            if (i === undefined) return;
            m.makeTranslation(worldX(xOf(cell)), yOf(cell) + 0.5, worldZ(zOf(cell)));
            mesh.setMatrixAt(i, m);
            mesh.instanceMatrix.needsUpdate = true;
        };
        return { mesh, hide, show };
    }

    // ------------------------------------------------------------------ aiming

    /** What block is under this screen point, and which face of it? */
    function pick(ndcX = 0, ndcY = 0) {
        pointer.set(ndcX, ndcY);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(voxels.mesh, false)[0];
        if (!hit || hit.instanceId === undefined) return null;
        const cell = voxels.cellAt[hit.instanceId];
        if (cell < 0) return null;
        const n = hit.face?.normal ?? { x: 0, y: 1, z: 0 };
        return {
            x: xOf(cell), y: yOf(cell), z: zOf(cell),
            nx: Math.round(n.x), ny: Math.round(n.y), nz: Math.round(n.z),
        };
    }

    function mineAt(ndcX, ndcY) {
        const t = pick(ndcX, ndcY);
        if (t) net.action({ a: 'mine', x: t.x, y: t.y, z: t.z });
    }

    function placeAt(ndcX, ndcY) {
        const t = pick(ndcX, ndcY);
        if (!t) return;
        net.action({ a: 'place', x: t.x + t.nx, y: t.y + t.ny, z: t.z + t.nz, b: held });
    }

    /**
     * How far the camera can pull back before it would end up inside the hillside.
     * Marching our own voxel array beats raycasting the InstancedMesh: exact, and it
     * does not test three thousand boxes every frame.
     */
    function freeDistance(ox, oy, oz, dx, dy, dz, maxDist) {
        const step = 0.35;
        for (let t = step; t <= maxDist; t += step) {
            const gx = Math.floor(ox + dx * t + W / 2);
            const gy = Math.floor(oy + dy * t);
            const gz = Math.floor(oz + dz * t + D / 2);
            if (gy < 0 || gy >= H) continue;
            if (gx < 0 || gx >= W || gz < 0 || gz >= D) continue;
            if (cells[idx(gx, gy, gz)] !== AIR) return Math.max(2, t - step);
        }
        return maxDist;
    }

    function selectBlock(type) {
        held = type;
        for (const btn of hud.panel.querySelectorAll('[data-block]')) {
            btn.setAttribute('aria-pressed', String(Number(btn.dataset.block) === held));
        }
    }

    // --------------------------------------------------------------- lifecycle

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;

            scene.add(build.skyDome(0x16233d, 0x0b0c10));

            const world = generateWorld(ctx.seed);
            cells.set(world.cells);
            // Mutations made before we joined are replayed on top of the generated
            // terrain, which is why a late joiner sees the same island as everyone else.
            for (let i = 0; i < (full.diff?.length ?? 0); i += 2) cells[full.diff[i]] = full.diff[i + 1];

            let solid = 0;
            for (let i = 0; i < CELLS; i++) if (cells[i] !== AIR) solid++;
            voxels = makeVoxelMesh(solid + HEADROOM);
            for (let i = 0; i < CELLS; i++) if (cells[i] !== AIR) voxels.set(i, cells[i]);
            scene.add(voxels.mesh);

            ghosts = makeGhosts(full.bp ?? []);
            scene.add(ghosts.mesh);
            for (const cell of full.filled ?? []) ghosts.hide(cell);
            progress = full.pct ?? 0;

            highlight = new THREE.Mesh(
                new THREE.BoxGeometry(1.06, 1.06, 1.06),
                new THREE.MeshBasicMaterial({ color: 0xffb703, wireframe: true, transparent: true, opacity: 0.85 }),
            );
            highlight.visible = false;
            scene.add(highlight);

            for (const p of ctx.players()) {
                const group = build.avatar(p.slot);
                // No nameplate over your own head: you know who you are, and in third
                // person it would sit right in front of the camera.
                if (p.id !== ctx.selfId) {
                    const plate = build.nameplate(p.name, p.slot);
                    plate.position.y = 2.2;
                    group.add(plate);
                }
                scene.add(group);
                avatars.set(p.slot, { group });
            }

            input.setLayout({ stick: true, a: true, b: true, aLabel: 'JUMP', bLabel: 'PUT' });
            input.onTap = (ndc) => mineAt(ndc.x, ndc.y);
            // Dragging looks around; the yaw goes to the server because movement is
            // camera-relative and the server is the one that moves you.
            input.onDragMove = (drag) => {
                yaw -= drag.dx * 0.006;
                pitch = interp.clamp(pitch + drag.dy * 0.004, 0.18, 1.25);
                drag.sx = drag.x;
                drag.sy = drag.y;
            };
            input.onKey = (key) => {
                const n = Number(key);
                if (n >= 1 && n <= PALETTE.length) selectBlock(PALETTE[n - 1]);
            };

            hud.buildPanel(`
                <div class="meter"><i id="vx-progress" style="width:${progress}%"></i></div>
                <div class="tool-row">${PALETTE.map((b, i) => `
                    <button type="button" data-block="${b}" aria-pressed="${i === 0}">
                        <i style="display:inline-block;width:.8rem;height:.8rem;border-radius:.2rem;background:#${BLOCKS[b].color.toString(16).padStart(6, '0')}"></i>
                        ${BLOCKS[b].name}
                    </button>`).join('')}</div>
            `);
            for (const btn of hud.panel.querySelectorAll('[data-block]')) {
                btn.addEventListener('click', () => selectBlock(Number(btn.dataset.block)));
            }

            hud.setObjective(`Build the ${full.shape} together — ${progress}%`);
            camera.position.set(0, 10, 14);
        },

        onState(s) {
            if (s.c) {
                for (let i = 0; i < s.c.length; i += 2) {
                    const cell = s.c[i];
                    const type = s.c[i + 1];
                    cells[cell] = type;
                    voxels.set(cell, type);
                    if (type === AIR) ghosts.show(cell);
                }
            }
            if (s.pct !== progress) {
                progress = s.pct;
                const bar = document.getElementById('vx-progress');
                if (bar) bar.style.width = `${progress}%`;
            }
            buffer.push(s.p);
        },

        onEvent(e) {
            const worldPos = (x, y, z) => [worldX(x), y + 0.5, worldZ(z)];
            switch (e.e) {
                case 'mine':
                    particles.burst(...worldPos(e.x, e.y, e.z), { color: 0x9aa3b2, count: 6, speed: 3, life: 0.5 });
                    if (e.by === ctx.selfId) sound.tick();
                    break;
                case 'fit':
                    ghosts.hide(idx(e.x, e.y, e.z));
                    particles.burst(...worldPos(e.x, e.y, e.z), { color: 0xffb703, count: 12, speed: 4 });
                    hud.toastFor(e.by, 'fitted a blueprint block', 10);
                    sound.good();
                    break;
                case 'place':
                    if (e.by === ctx.selfId) sound.pickup();
                    break;
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);
            if (frame) {
                for (const row of frame.b) {
                    const [slot, x, y, z, ry] = row;
                    const av = avatars.get(slot);
                    if (!av) continue;
                    const prev = frame.a.find((r) => r[0] === slot) ?? row;
                    av.group.position.set(
                        interp.lerp(prev[1], x, frame.t),
                        interp.lerp(prev[2], y, frame.t),
                        interp.lerp(prev[3], z, frame.t),
                    );
                    av.group.rotation.y = interp.lerpAngle(prev[4], ry, frame.t);
                    if (slot === selfSlot) selfPos.copy(av.group.position);
                }
            }

            // Third-person chase. The camera orbits the player rather than the world,
            // so "forward" always means "away from the camera" on every device, and it
            // pulls in when a hillside would otherwise swallow it.
            const dx = -Math.sin(yaw) * Math.cos(pitch);
            const dy = Math.sin(pitch);
            const dz = -Math.cos(yaw) * Math.cos(pitch);
            const eyeY = selfPos.y + 1.2;
            const dist = freeDistance(selfPos.x, eyeY, selfPos.z, dx, dy, dz, 8.5);
            camera.position.set(selfPos.x + dx * dist, eyeY + dy * dist, selfPos.z + dz * dist);
            camera.lookAt(selfPos.x, selfPos.y + 1.1, selfPos.z);

            // Raycasting an InstancedMesh tests every instance, so the aim highlight
            // is refreshed ten times a second rather than every frame - imperceptible
            // to a player, and thousands of box tests a second cheaper.
            if (now >= nextAimAt) {
                nextAimAt = now + 100;
                // A mouse aims where it points; a thumb aims at the middle of the screen.
                aimAt = input.touchLikely ? pick(0, 0) : pick(input.pointer.x, input.pointer.y);
            }
            highlight.visible = !!aimAt;
            if (aimAt) highlight.position.set(worldX(aimAt.x), aimAt.y + 0.5, worldZ(aimAt.z));

            if (input.pressed('b')) {
                if (input.touchLikely) placeAt(0, 0);
                else placeAt(input.pointer.x, input.pointer.y);
            }

            net.input({ ax: input.axes.x, ay: input.axes.y, yw: yaw, b: input.buttons.a ? 1 : 0 });
        },

        dispose() {
            input.onTap = input.onDragMove = input.onKey = null;
            voxels?.mesh.geometry.dispose();
            voxels?.mesh.material.dispose();
            ghosts?.mesh.geometry.dispose();
            ghosts?.mesh.material.dispose();
            highlight?.geometry.dispose();
            highlight?.material.dispose();
            ghostSlot.clear();
            avatars.clear();
            buffer.clear();
        },
    };
}
