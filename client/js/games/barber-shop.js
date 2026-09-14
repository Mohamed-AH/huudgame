import { STRANDS, HEAD_RADIUS, strandDir } from 'shared/hair.js';

/**
 * Barber Game — a row of cartoon heads, 108 hairs each, and a style card to copy.
 *
 * Each head's hair is one InstancedMesh of 108 strands; a strand's length is its
 * instance scale and its dye is its instance colour, so a whole haircut is two buffer
 * writes per changed hair and one draw call per head.
 *
 * Your target is shown as a ghost head beside your own rather than as words. "Mohawk"
 * means very little to a six-year-old; a head with a mohawk on it does not.
 */

export const meta = { id: 'barber-shop' };

const SPACING = 3.6;
const TOOL_LABELS = ['CLIPPERS', 'SPRAY', 'DYE'];

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const heads = new Map();
    let palette = [];
    let selfSlot = 0;
    let tool = 0;
    let dye = 0;
    let accuracy = 0;
    let lastStrokeAt = 0;

    const STRAND_GEO = new THREE.CylinderGeometry(0.055, 0.085, 1, 5);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();

    function setStrand(hair, i, length, colorIndex) {
        const d = strandDir(i);
        dir.set(d.x, d.y, d.z);
        // Each strand stands along its own normal, so the hair follows the skull.
        quat.setFromUnitVectors(up, dir);
        pos.copy(dir).multiplyScalar(HEAD_RADIUS + length / 2);
        scl.set(1, Math.max(0.001, length), 1);
        matrix.compose(pos, quat, scl);
        hair.setMatrixAt(i, matrix);
        hair.setColorAt(i, color.setHex(palette[colorIndex] ?? 0x3b2417));
    }

    function buildHead(slot, player, { ghost = false, x = 0, scale = 1 } = {}) {
        const g = new THREE.Group();
        g.position.set(x, ghost ? 2.0 : 2.2, ghost ? -1.4 : 0);
        g.scale.setScalar(scale);

        const skull = build.sphere(HEAD_RADIUS, ghost ? 0x6b7280 : 0xf5d0a9, 2);
        const nose = build.cone(0.14, 0.34, ghost ? 0x6b7280 : 0xf5d0a9, 6);
        nose.rotation.x = Math.PI / 2;
        nose.position.set(0, -0.08, HEAD_RADIUS);
        g.add(skull, nose);

        if (!ghost) {
            for (const sx of [-1, 1]) {
                const eye = build.sphere(0.11, 0x14171f, 1);
                eye.position.set(sx * 0.32, 0.12, HEAD_RADIUS * 0.86);
                g.add(eye);
            }
        }

        const hair = new THREE.InstancedMesh(
            STRAND_GEO,
            new THREE.MeshLambertMaterial({ flatShading: true, transparent: ghost, opacity: ghost ? 0.55 : 1 }),
            STRANDS,
        );
        hair.frustumCulled = false;
        g.add(hair);

        if (player && !ghost) {
            const plate = build.nameplate(player.name, slot, { scale: 1.1 });
            plate.position.y = 2.3;
            g.add(plate);
        }
        if (ghost) {
            const label = build.nameplate('COPY THIS', 0, { scale: 1.4 });
            label.position.y = 1.9;
            g.add(label);
        }

        // A barber's chair under every head, so the shop reads as a shop.
        if (!ghost) {
            const chair = build.cylinder(0.7, 1.0, 2.0, player ? ctx.colorOf(slot) : 0x39415a, 10);
            chair.position.set(x, 1.0, 0);
            scene.add(chair);
            const base = build.cylinder(1.0, 1.1, 0.25, 0x2b3242, 12);
            base.position.set(x, 0.12, 0);
            scene.add(base);
        }

        scene.add(g);
        return { group: g, hair };
    }

    /** Where on the scalp is the pointer? Returns a unit direction, or null. */
    function scalpAt(ndcX, ndcY) {
        const mine = heads.get(selfSlot);
        if (!mine) return null;
        pointer.set(ndcX, ndcY);
        raycaster.setFromCamera(pointer, camera);
        const skull = mine.group.children[0];
        const hit = raycaster.intersectObject(skull, false)[0];
        if (!hit) return null;
        return hit.point.clone().sub(mine.group.position).normalize();
    }

    function stroke(ndcX, ndcY) {
        const at = scalpAt(ndcX, ndcY);
        if (!at) return;
        const now = performance.now();
        const dt = Math.min(0.25, (now - lastStrokeAt) / 1000);
        lastStrokeAt = now;
        net.action({ a: 'stroke', x: interp.clamp(at.x, -1, 1), y: interp.clamp(at.y, -1, 1), z: interp.clamp(at.z, -1, 1), dt });

        const mine = heads.get(selfSlot);
        if (mine) {
            particles.burst(
                mine.group.position.x + at.x * 1.2, mine.group.position.y + at.y * 1.2, mine.group.position.z + at.z * 1.2,
                { color: tool === 2 ? (palette[dye] ?? 0xffffff) : 0x9aa3b2, count: 2, speed: 2.2, life: 0.35, up: 0.6 },
            );
        }
    }

    function selectTool(t) {
        tool = t;
        net.action({ a: 'tool', t });
        for (const btn of hud.panel.querySelectorAll('[data-tool]')) {
            btn.setAttribute('aria-pressed', String(Number(btn.dataset.tool) === t));
        }
        sound.tick();
    }

    function selectDye(d) {
        dye = d;
        net.action({ a: 'dye', d });
        for (const btn of hud.panel.querySelectorAll('[data-dye]')) {
            btn.setAttribute('aria-pressed', String(Number(btn.dataset.dye) === d));
        }
        selectTool(2);
    }

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;
            palette = full.colors ?? [0x3b2417];

            ctx.engine.setLighting({ hemi: 1.2, sun: 0.65, sky: 0xfff0f4, ground: 0x3a2a3a });
            scene.add(build.skyDome(0x7a4a63, 0x241825));

            const floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 60), build.mat(0xe9dbe4));
            floor.rotation.x = -Math.PI / 2;
            scene.add(floor);

            // A mirror wall behind the row - just a tinted panel, but it doubles the
            // apparent size of the shop for one draw call.
            const mirror = build.box(120, 9, 0.4, 0xb9c6d6);
            mirror.position.set(0, 4.5, -5.5);
            scene.add(mirror);

            const seated = new Map(ctx.players().map((p) => [p.slot, p]));
            for (let slot = 0; slot < 14; slot++) {
                const x = (slot - 6.5) * SPACING;
                heads.set(slot, buildHead(slot, seated.get(slot) ?? null, { x }));
            }

            for (const head of full.heads ?? []) {
                const entry = heads.get(head.slot);
                if (!entry) continue;
                for (let i = 0; i < STRANDS; i++) setStrand(entry.hair, i, head.lengths[i], head.colors[i]);
                entry.hair.instanceMatrix.needsUpdate = true;
                if (entry.hair.instanceColor) entry.hair.instanceColor.needsUpdate = true;
            }

            const myX = (selfSlot - 6.5) * SPACING;
            if (full.target) {
                const ghost = buildHead(-1, null, { ghost: true, x: myX + 2.6, scale: 0.78 });
                for (let i = 0; i < STRANDS; i++) setStrand(ghost.hair, i, full.target[i], full.targetColor);
                ghost.hair.instanceMatrix.needsUpdate = true;
                if (ghost.hair.instanceColor) ghost.hair.instanceColor.needsUpdate = true;
                heads.set(-1, ghost);
            }

            camera.position.set(myX - 0.4, 3.4, 6.2);
            camera.lookAt(myX + 0.9, 2.3, 0);

            input.setLayout({});
            input.onDragMove = (drag) => stroke(drag.nx ?? 0, drag.ny ?? 0);
            input.onTap = (ndc) => stroke(ndc.x, ndc.y);
            input.onKey = (key) => {
                const n = Number(key);
                if (n >= 1 && n <= 3) selectTool(n - 1);
                else if (n >= 4 && n <= 3 + palette.length) selectDye(n - 4);
            };

            hud.buildPanel(`
                <div class="tool-row">${TOOL_LABELS.map((t, i) => `
                    <button type="button" data-tool="${i}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
                <div class="tool-row">${palette.map((c, i) => `
                    <button type="button" data-dye="${i}" aria-pressed="${i === 0}" aria-label="dye ${i + 1}">
                        <i style="display:inline-block;width:1rem;height:1rem;border-radius:50%;background:#${c.toString(16).padStart(6, '0')}"></i>
                    </button>`).join('')}</div>
            `);
            for (const btn of hud.panel.querySelectorAll('[data-tool]')) {
                btn.addEventListener('click', () => selectTool(Number(btn.dataset.tool)));
            }
            for (const btn of hud.panel.querySelectorAll('[data-dye]')) {
                btn.addEventListener('click', () => selectDye(Number(btn.dataset.dye)));
            }

            hud.setObjective(`Copy the ${full.style ?? 'style'} — drag across the hair`);
        },

        onState(s) {
            if (s.c) {
                const touched = new Set();
                for (let i = 0; i < s.c.length; i += 4) {
                    const entry = heads.get(s.c[i]);
                    if (!entry) continue;
                    setStrand(entry.hair, s.c[i + 1], s.c[i + 2], s.c[i + 3]);
                    touched.add(entry.hair);
                }
                for (const hair of touched) {
                    hair.instanceMatrix.needsUpdate = true;
                    if (hair.instanceColor) hair.instanceColor.needsUpdate = true;
                }
            }
            const mine = (s.p ?? []).find((r) => r[0] === selfSlot);
            if (mine && mine[3] !== accuracy) {
                accuracy = mine[3];
                hud.setObjective(`Match: ${accuracy}%  ·  ${TOOL_LABELS[tool]}`);
            }
        },

        onEvent() { /* everything this game says, it says through the strands */ },

        update(dt, now) {
            // Slow idle turn on every head but yours, so the shop feels alive without
            // ever moving the one thing you are trying to cut.
            for (const [slot, entry] of heads) {
                if (slot === selfSlot || slot === -1) continue;
                entry.group.rotation.y = Math.sin(now / 2600 + slot) * 0.5;
            }
            const ghost = heads.get(-1);
            if (ghost) ghost.group.rotation.y += dt * 0.5;
        },

        dispose() {
            input.onDragMove = input.onTap = input.onKey = null;
            STRAND_GEO.dispose();
            for (const entry of heads.values()) entry.hair.material.dispose();
            heads.clear();
        },
    };
}
