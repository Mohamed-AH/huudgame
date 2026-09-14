/**
 * Guess Animal — a spotlit turntable, 14 seat pods, and a shape that fills in.
 *
 * The client never learns which animal it is drawing. The server sends a bag of
 * proportions and a list of four names; the mapping between them exists only on the
 * server, so there is nothing in this file to read the answer out of.
 */

export const meta = { id: 'guess-animal' };

const RING_RADIUS = 11;
const SILHOUETTE = 0x05060a;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, particles, sound, input } = ctx;

    const pods = new Map();
    let turntable = null;
    let model = null;
    let shapeColor = 0xffffff;
    let stage = 0;
    let shownStage = -1;
    let choices = [];
    let locked = false;
    let phase = 'reveal';

    /** Builds one animal from a bag of proportions. Twelve shapes, one function. */
    function buildAnimal(shape) {
        const g = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: SILHOUETTE, flatShading: true });
        const part = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, y, z);
            m.rotation.set(rx, ry, rz);
            g.add(m);
            return m;
        };

        const [bw, bh, bd] = shape.body;
        const legY = shape.legLen;
        part(new THREE.BoxGeometry(bw, bh, bd), 0, legY + bh / 2, 0);

        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                part(new THREE.CylinderGeometry(shape.legThick, shape.legThick * 0.85, legY, 6),
                    sx * (bw / 2 - shape.legThick), legY / 2, sz * (bd / 2 - shape.legThick * 1.4));
            }
        }

        const [neckLen, neckThick] = shape.neck;
        const neckBase = legY + bh * 0.75;
        const neckTop = neckBase + neckLen;
        if (neckLen > 0.12) {
            part(new THREE.CylinderGeometry(neckThick, neckThick * 1.15, neckLen, 7),
                0, neckBase + neckLen / 2, bd / 2 - neckThick);
        }

        const [hw, hh, hd] = shape.head;
        const headZ = bd / 2 + hd / 2 - neckThick;
        const head = part(new THREE.BoxGeometry(hw, hh, hd), 0, neckTop + hh / 2, headZ);

        const [snoutLen, snoutThick] = shape.snout;
        if (snoutLen > 0.05) {
            part(new THREE.CylinderGeometry(snoutThick * 0.7, snoutThick, snoutLen, 7),
                0, head.position.y - hh * 0.1, headZ + hd / 2 + snoutLen / 2, Math.PI / 2);
        }

        const earY = head.position.y + hh / 2;
        const ears = {
            long:  () => new THREE.BoxGeometry(0.22, 1.5, 0.16),
            huge:  () => new THREE.BoxGeometry(0.16, 1.5, 1.5),
            round: () => new THREE.SphereGeometry(0.24, 6, 5),
            small: () => new THREE.ConeGeometry(0.18, 0.4, 5),
            flop:  () => new THREE.BoxGeometry(0.18, 0.5, 0.4),
            tuft:  () => new THREE.ConeGeometry(0.16, 0.45, 4),
            none:  () => null,
        }[shape.ears] ?? (() => null);
        for (const sx of [-1, 1]) {
            const geo = ears();
            if (!geo) break;
            part(geo, sx * (hw / 2 + (shape.ears === 'huge' ? 0.1 : 0.05)), earY + 0.2, headZ - 0.1);
        }

        if (shape.horns === 2) {
            for (const sx of [-1, 1]) {
                part(new THREE.ConeGeometry(0.12, 0.55, 5), sx * hw * 0.35, earY + 0.3, headZ);
            }
        }

        if (shape.mane) {
            part(new THREE.SphereGeometry(Math.max(hw, hh) * 0.95, 8, 7), 0, head.position.y, headZ - hd * 0.35);
        }

        if (shape.humps === 2) {
            for (const sz of [-0.5, 0.5]) {
                part(new THREE.SphereGeometry(bh * 0.45, 7, 6), 0, legY + bh + bh * 0.15, sz * bd * 0.4);
            }
        }

        const tails = {
            thin:  () => ({ geo: new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5), len: 1.0, rot: 0.5 }),
            bushy: () => ({ geo: new THREE.CylinderGeometry(0.2, 0.1, 1.1, 6), len: 1.1, rot: 0.6 }),
            long:  () => ({ geo: new THREE.CylinderGeometry(0.14, 0.05, 2.6, 6), len: 2.6, rot: 1.3 }),
            curl:  () => ({ geo: new THREE.TorusGeometry(0.2, 0.06, 5, 10), len: 0.4, rot: 0 }),
            puff:  () => ({ geo: new THREE.SphereGeometry(0.26, 6, 5), len: 0.3, rot: 0 }),
            none:  () => null,
        }[shape.tail] ?? (() => null);
        const tail = tails();
        if (tail) {
            part(tail.geo, 0, legY + bh * 0.8, -bd / 2 - tail.len * 0.3, tail.rot);
        }

        g.userData.material = mat;
        return g;
    }

    function setStage(next) {
        if (!model || next === shownStage) return;
        shownStage = next;
        const mat = model.userData.material;
        // Stage 0 is a pure silhouette; each stage lerps a third of the way to the
        // animal's real colour, so the reveal is a fade rather than four flat states.
        const k = next / 3;
        mat.color.setHex(SILHOUETTE).lerp(new THREE.Color(shapeColor), k);
        mat.emissive.setHex(0x000000);
        if (next === 3) mat.emissive.setHex(shapeColor).multiplyScalar(0.12);
    }

    function showAnimal(shape) {
        if (model) {
            scene.remove(model);
            model.traverse((n) => n.geometry?.dispose());
            model.userData.material?.dispose();
        }
        if (!shape) { model = null; return; }
        shapeColor = shape.color;
        model = buildAnimal(shape);
        model.position.y = 1.3;
        turntable.add(model);
        shownStage = -1;
        setStage(stage);
    }

    function renderChoices(list, correct = -1) {
        choices = list;
        hud.buildPanel(`<div class="choices">${list.map((name, i) =>
            `<button type="button" data-pick="${i}">${name}</button>`).join('')}</div>`);
        for (const btn of hud.panel.querySelectorAll('[data-pick]')) {
            btn.addEventListener('click', () => lockIn(Number(btn.dataset.pick)));
        }
        if (correct >= 0) markAnswer(correct);
    }

    function lockIn(index) {
        if (locked || phase !== 'reveal') return;
        locked = true;
        net.action({ a: 'answer', i: index });
        for (const btn of hud.panel.querySelectorAll('[data-pick]')) {
            btn.setAttribute('aria-pressed', String(Number(btn.dataset.pick) === index));
            btn.disabled = true;
        }
        sound.tick();
    }

    function markAnswer(correct) {
        for (const btn of hud.panel.querySelectorAll('[data-pick]')) {
            const i = Number(btn.dataset.pick);
            btn.disabled = true;
            if (i === correct) btn.classList.add('right');
            else if (btn.getAttribute('aria-pressed') === 'true') btn.classList.add('wrong');
        }
    }

    function buildPod(slot, player) {
        const { x, z, angle } = build.ringPosition(slot, 14, RING_RADIUS);
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = -angle + Math.PI / 2;

        const base = build.cylinder(0.9, 1.05, 0.5, 0x2b3242, 8);
        base.position.y = 0.25;
        const seat = build.box(1.1, 0.9, 0.9, player ? ctx.colorOf(slot) : 0x39415a);
        seat.position.y = 0.95;
        g.add(base, seat);

        const lamp = new THREE.Mesh(
            new THREE.SphereGeometry(0.26, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0x39415a }),
        );
        lamp.position.set(0, 1.7, 0);
        g.add(lamp);

        if (player) {
            const plate = build.nameplate(player.name, slot, { scale: 1.1 });
            plate.position.y = 2.3;
            g.add(plate);
        }

        scene.add(g);
        pods.set(slot, { group: g, lamp, seated: !!player });
    }

    return {
        async build(full) {
            ctx.engine.setLighting({ hemi: 0.35, sun: 0.25, sky: 0x8899cc, ground: 0x120c1c });
            scene.add(build.skyDome(0x1a1030, 0x07060c));
            scene.add(build.arenaFloor(17, 0x241a33, 0x0a0810));

            // A bright stage disc and a spotlight cone: the animal is the only lit
            // thing in the room, which is exactly what a silhouette needs.
            turntable = new THREE.Group();
            const disc = build.cylinder(3.4, 3.6, 0.5, 0x3a2b52, 28);
            disc.position.y = 0.25;
            turntable.add(disc);
            scene.add(turntable);

            const spot = new THREE.SpotLight(0xfff3d6, 90, 40, 0.45, 0.6, 1.4);
            spot.position.set(0, 16, 4);
            spot.target = turntable;
            scene.add(spot, spot.target);

            // A lit cylinder around the stage, drawn back-side only: the near wall is
            // culled away and the far wall becomes a bright screen behind the animal
            // from every seat at once. A silhouette needs something to be against.
            const backdrop = new THREE.Mesh(
                new THREE.CylinderGeometry(7.5, 7.5, 11, 28, 1, true),
                new THREE.MeshBasicMaterial({ color: 0xb9a7d6, side: THREE.BackSide, fog: false }),
            );
            backdrop.position.y = 5.2;
            scene.add(backdrop);

            const beam = new THREE.Mesh(
                new THREE.ConeGeometry(4.6, 15, 18, 1, true),
                new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.05, side: THREE.DoubleSide }),
            );
            beam.position.set(0, 8.2, 1.4);
            scene.add(beam);

            const seated = new Map(ctx.players().map((p) => [p.slot, p]));
            for (let slot = 0; slot < 14; slot++) buildPod(slot, seated.get(slot) ?? null);

            stage = full.st ?? 0;
            if (full.shape) showAnimal(full.shape);
            renderChoices(full.choices ?? []);

            const me = ctx.playerById(ctx.selfId);
            const seat = build.ringPosition(me?.slot ?? 0, 14, RING_RADIUS + 5);
            // Low and side-on: a silhouette is read from its profile, and looking down
            // on one flattens exactly the outline the player is trying to name.
            camera.position.set(seat.x * 0.82, 4.4, seat.z * 0.82);
            camera.lookAt(0, 2.6, 0);

            input.setLayout({});
            input.onKey = (key) => {
                const n = Number(key);
                if (n >= 1 && n <= 4) lockIn(n - 1);
            };
            hud.setObjective('Guess early — it is worth four times as much');
        },

        onState(s) {
            phase = s.ph;
            if (s.st !== stage) { stage = s.st; setStage(stage); }
            for (const [slot, lockedIn] of (s.p ?? []).map((r) => [r[0], r[1]])) {
                const pod = pods.get(slot);
                if (!pod || !pod.seated) continue;
                pod.lamp.material.color.setHex(lockedIn ? 0x06d6a0 : 0x39415a);
            }
        },

        onEvent(e) {
            switch (e.e) {
                case 'round':
                    locked = false;
                    stage = 0;
                    showAnimal(e.shape);
                    renderChoices(e.choices);
                    hud.banner(`Round ${e.rd} of ${e.of}`, 1300);
                    hud.setObjective('Guess early — it is worth four times as much');
                    break;
                case 'stage':
                    stage = e.stage;
                    setStage(stage);
                    hud.setObjective(`Stage ${e.stage + 1} of 4 — worth less every stage`);
                    sound.tick();
                    break;
                case 'locked':
                    if (e.by !== ctx.selfId) hud.toastFor(e.by, 'locked in');
                    break;
                case 'yours':
                    if (e.right) { hud.banner(`CORRECT  +${e.pts}`, 1600); sound.good(); }
                    else { hud.banner('Locked in…', 900); }
                    break;
                case 'answer':
                    setStage(3);
                    markAnswer(e.correct);
                    hud.banner(`It was a ${e.name}!`, 2200);
                    particles.burst(0, 2.4, 0, { color: shapeColor, count: 22, speed: 6 });
                    break;
            }
        },

        update(dt) {
            if (turntable) turntable.rotation.y += dt * 0.55;
        },

        dispose() {
            input.onKey = null;
            if (model) {
                model.traverse((n) => n.geometry?.dispose());
                model.userData.material?.dispose();
            }
            model = null;
            pods.clear();
        },
    };
}
