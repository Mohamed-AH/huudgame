import { createCrew } from '../lib/crew.js';

/**
 * Baking Kitchen — one shared kitchen, one shared score.
 *
 * The ticket rail lives in the HUD rather than in 3D: an order is a list of station
 * names with a clock on it, and that is far more legible on a phone as DOM than as a
 * floating sign somebody's head is always in front of.
 */

export const meta = { id: 'baking-kitchen' };

const STATION_STYLE = {
    prep:     { color: 0x8d6a4a, label: 'PREP',  h: 1.0 },
    mix:      { color: 0x4cc9f0, label: 'MIX',   h: 1.1 },
    oven:     { color: 0xef476f, label: 'OVEN',  h: 1.6 },
    decorate: { color: 0xc77dff, label: 'ICING', h: 1.1 },
    plate:    { color: 0x06d6a0, label: 'SERVE', h: 0.9 },
    bin:      { color: 0x5b6478, label: 'BIN',   h: 1.0 },
};

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const stations = new Map();          // id -> { group, glow, bar, kind }
    const carried = new Map();           // slot -> cake mesh
    let crew = null;
    let family = 0;
    let orderSignature = '';

    const CAKE_GEO = new THREE.CylinderGeometry(0.28, 0.32, 0.3, 8);

    function cakeMesh(burnt) {
        return new THREE.Mesh(CAKE_GEO, build.mat(burnt ? 0x33261c : 0xf7e3b0));
    }

    function buildStation(id, kind, x, z) {
        const style = STATION_STYLE[kind];
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        const bench = build.box(2.2, style.h, 1.8, 0x2b3242);
        bench.position.y = style.h / 2;
        group.add(bench);

        const top = build.box(2.3, 0.18, 1.9, style.color);
        top.position.y = style.h + 0.09;
        group.add(top);

        if (kind === 'oven') {
            const door = build.box(1.5, 0.9, 0.12, 0x11151f);
            door.position.set(0, 0.7, 0.95);
            group.add(door);
        }

        // A glow puck under the bench is the station's whole status display: dim when
        // idle, bright while working, green when something is ready to collect.
        const glow = new THREE.Mesh(
            new THREE.CircleGeometry(1.5, 20),
            new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.15 }),
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.02;
        group.add(glow);

        const sign = build.nameplate(style.label, 0, { scale: 2.6 });
        sign.position.y = style.h + 1.1;
        group.add(sign);

        const bar = build.box(1.9, 0.12, 0.12, 0xffb703);
        bar.position.set(0, style.h + 0.32, 0.9);
        bar.scale.x = 0.001;
        group.add(bar);

        scene.add(group);
        stations.set(id, { group, glow, bar, kind, style });
    }

    function renderOrders(rows) {
        // Repainting the rail every tick would fight the CSS transitions, so it is
        // only rebuilt when the set of tickets actually changes.
        const signature = rows.map((r) => r[0]).join('|');
        const rebuild = signature !== orderSignature;
        if (rebuild) orderSignature = signature;

        const rail = document.getElementById('bk-rail');
        if (!rail) return;
        if (rebuild) {
            rail.replaceChildren(...rows.map(([id, recipe]) => {
                const li = document.createElement('div');
                li.className = 'ticket';
                li.dataset.order = id;
                li.innerHTML = `<span class="steps">${recipe.split(',').map((k) => STATION_STYLE[k]?.label ?? k).join(' → ')}</span><i class="fuse"></i>`;
                return li;
            }));
        }
        for (const [id, , left] of rows) {
            const fuse = rail.querySelector(`[data-order="${id}"] .fuse`);
            if (fuse) {
                fuse.style.width = `${Math.min(100, (left / 42) * 100)}%`;
                fuse.style.background = left < 10 ? '#ef476f' : left < 20 ? '#ffd166' : '#06d6a0';
            }
        }
    }

    return {
        async build(full) {
            scene.add(build.skyDome(0x2b2338, 0x14101c));

            const [rx, rz] = full.room ?? [15, 10];
            const floor = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2 + 4, rz * 2 + 4), build.mat(0x4c4459));
            floor.rotation.x = -Math.PI / 2;
            scene.add(floor);

            // Chequered accent tiles - cheap, and they give the floor a sense of scale
            // that a flat plane never has.
            const tileGeo = new THREE.PlaneGeometry(2, 2);
            const tiles = new THREE.InstancedMesh(tileGeo, build.mat(0x5b5169), 120);
            const m = new THREE.Matrix4();
            let n = 0;
            for (let x = -rx; x <= rx && n < 120; x += 4) {
                for (let z = -rz; z <= rz && n < 120; z += 4) {
                    m.makeRotationX(-Math.PI / 2);
                    m.setPosition(x, 0.01, z);
                    tiles.setMatrixAt(n++, m);
                }
            }
            tiles.count = n;
            tiles.instanceMatrix.needsUpdate = true;
            scene.add(tiles);

            for (const [id, kind, x, z] of full.stations ?? []) buildStation(id, kind, x, z);

            crew = createCrew(ctx);
            // A fixed overview, not a chase camera: this is a relay, and you cannot
            // plan a hand-off to a station you cannot see.
            camera.position.set(0, 23, 17);
            camera.lookAt(0, 0, -1);

            input.setLayout({ stick: true, a: true, aLabel: 'GRAB' });
            hud.buildPanel('<div class="rail" id="bk-rail"></div>');
            hud.setObjective('Pass the cakes down the line');
        },

        onState(s) {
            family = s.fam ?? family;
            buffer.push(s.p);
            hud.setObjective(`Family score ${family}`);
            renderOrders(s.o ?? []);

            for (const [id, hasItem, progress, ready, burnt] of s.s ?? []) {
                const st = stations.get(id);
                if (!st) continue;
                st.bar.scale.x = Math.max(0.001, progress);
                st.bar.material = build.mat(burnt ? 0x33261c : ready ? 0x06d6a0 : 0xffb703);
                st.glow.material.opacity = hasItem ? (ready ? 0.55 : 0.35) : 0.15;
                st.glow.material.color.setHex(ready ? 0x06d6a0 : burnt ? 0xef476f : st.style.color);
            }
        },

        onEvent(e) {
            switch (e.e) {
                case 'served': {
                    hud.toastFor(e.by, 'served an order', e.pts);
                    const who = crew.get(ctx.playerById(e.by)?.slot ?? -1);
                    const at = who?.group.position;
                    particles.burst(at?.x ?? 0, 1.8, at?.z ?? 0, { color: 0x06d6a0, count: 16, speed: 5 });
                    sound.good();
                    break;
                }
                case 'burnt':
                    hud.toast('Something is burning!', '#ef476f');
                    sound.bad();
                    break;
                case 'spoiled':
                    hud.toast('An order went cold', '#ef476f');
                    sound.bad();
                    break;
                case 'order':
                    sound.tick();
                    break;
                case 'nope':
                    hud.toast(e.why);
                    break;
                case 'ready':
                    if (e.station != null) sound.pickup();
                    break;
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);
            crew.apply(frame);

            // Rows carry [carriedStep, burnt] after the pose, so the cake in someone's
            // hands appears and disappears without a single extra message.
            for (const [slot, member] of crew.members) {
                const extra = crew.extra(slot);
                const holding = extra?.[0] > 0;
                let cake = carried.get(slot);
                if (holding && !cake) {
                    cake = cakeMesh(extra[1] === 1);
                    cake.position.set(0, 1.55, 0.35);
                    member.group.add(cake);
                    carried.set(slot, cake);
                } else if (!holding && cake) {
                    member.group.remove(cake);
                    carried.delete(slot);
                } else if (cake) {
                    cake.material = build.mat(extra[1] === 1 ? 0x33261c : 0xf7e3b0);
                }
            }

            if (input.pressed('a')) net.action({ a: 'use' });
            net.input({ ax: input.axes.x, ay: input.axes.y });
        },

        dispose() {
            CAKE_GEO.dispose();
            stations.clear();
            carried.clear();
            crew?.dispose();
            buffer.clear();
        },
    };
}
