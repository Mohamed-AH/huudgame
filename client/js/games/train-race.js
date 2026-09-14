/**
 * Train Race — 14 parallel tracks running away into a valley.
 *
 * Everything that repeats is instanced: sleepers, rails, boulders, crystals and the
 * trees down both sides. The whole 720-unit valley is about a dozen draw calls, which
 * is what makes a long track affordable on a phone.
 */

export const meta = { id: 'train-race' };

const SLEEPER_SPACING = 4;

export function create(ctx) {
    const { THREE, scene, camera, build, hud, net, input, particles, sound, interp } = ctx;

    const buffer = new interp.SnapshotBuffer();
    const trains = new Map();
    let obstacleMesh = null;
    let obstacleRows = [];
    let lanes = 14;
    let laneWidth = 4.2;
    let length = 720;
    let selfSlot = 0;
    let finishLine = null;
    let heatBar = null;
    const camGoal = new THREE.Vector3();

    const laneX = (lane) => (lane - (lanes - 1) / 2) * laneWidth;
    const OBSTACLE_GEO = new THREE.IcosahedronGeometry(1.15, 0);

    function buildTrack() {
        // Sleepers: one instanced mesh for every tie on every lane.
        const perLane = Math.floor(length / SLEEPER_SPACING);
        const sleepers = new THREE.InstancedMesh(
            new THREE.BoxGeometry(3.1, 0.22, 0.7),
            build.mat(0x6b4a2f),
            perLane * lanes,
        );
        const m = new THREE.Matrix4();
        let i = 0;
        for (let lane = 0; lane < lanes; lane++) {
            for (let s = 0; s < perLane; s++) {
                m.makeTranslation(laneX(lane), 0.11, s * SLEEPER_SPACING);
                sleepers.setMatrixAt(i++, m);
            }
        }
        sleepers.instanceMatrix.needsUpdate = true;
        sleepers.frustumCulled = false;
        scene.add(sleepers);

        const rails = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.18, 0.18, length),
            build.mat(0x9aa3b2),
            lanes * 2,
        );
        i = 0;
        for (let lane = 0; lane < lanes; lane++) {
            for (const side of [-1, 1]) {
                m.makeTranslation(laneX(lane) + side * 1.1, 0.3, length / 2);
                rails.setMatrixAt(i++, m);
            }
        }
        rails.instanceMatrix.needsUpdate = true;
        rails.frustumCulled = false;
        scene.add(rails);
    }

    function buildScenery() {
        const edge = laneX(lanes - 1) + 7;
        const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.55, 3, 6), build.mat(0x5b3a25), 120);
        const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 4.4, 7), build.mat(0x2f7d52), 120);
        const m = new THREE.Matrix4();
        let i = 0;
        for (let z = 6; z < length && i < 120; z += 13) {
            for (const side of [-1, 1]) {
                if (i >= 120) break;
                const x = side * (edge + ((z * 7) % 11));
                m.makeTranslation(x, 1.5, z + (side > 0 ? 5 : 0));
                trunks.setMatrixAt(i, m);
                m.makeTranslation(x, 4.6, z + (side > 0 ? 5 : 0));
                crowns.setMatrixAt(i, m);
                i++;
            }
        }
        trunks.count = crowns.count = i;
        trunks.instanceMatrix.needsUpdate = true;
        crowns.instanceMatrix.needsUpdate = true;
        trunks.frustumCulled = crowns.frustumCulled = false;
        scene.add(trunks, crowns);
    }

    function buildObstacles(rows) {
        obstacleRows = rows;
        const mesh = new THREE.InstancedMesh(OBSTACLE_GEO, build.mat(0xffffff), Math.max(1, rows.length));
        mesh.frustumCulled = false;
        const m = new THREE.Matrix4();
        const color = new THREE.Color();
        rows.forEach(([id, p, lane, kind, taken], i) => {
            if (taken) m.makeScale(0, 0, 0);
            else {
                m.makeScale(1, kind ? 1.1 : 0.8, 1);
                m.setPosition(laneX(lane), kind ? 1.5 : 1.0, p);
            }
            mesh.setMatrixAt(i, m);
            mesh.setColorAt(i, color.setHex(kind ? 0x4cc9f0 : 0x6f7787));
        });
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
        obstacleMesh = mesh;
    }

    function hideObstacle(id) {
        const index = obstacleRows.findIndex((r) => r[0] === id);
        if (index < 0 || !obstacleMesh) return;
        const m = new THREE.Matrix4().makeScale(0, 0, 0);
        obstacleMesh.setMatrixAt(index, m);
        obstacleMesh.instanceMatrix.needsUpdate = true;
    }

    function buildTrain(player) {
        const g = new THREE.Group();
        const color = ctx.colorOf(player.slot);

        const boiler = build.cylinder(0.85, 0.85, 3.4, color, 10);
        boiler.rotation.x = Math.PI / 2;
        boiler.position.set(0, 1.25, 0.3);
        const cab = build.box(1.9, 1.7, 1.6, color);
        cab.position.set(0, 1.75, -1.6);
        const roof = build.box(2.1, 0.2, 1.8, 0x11151f);
        roof.position.set(0, 2.65, -1.6);
        const stack = build.cylinder(0.34, 0.42, 0.9, 0x2b3242, 8);
        stack.position.set(0, 2.4, 1.4);
        g.add(boiler, cab, roof, stack);

        for (const side of [-1, 1]) {
            for (const z of [-1.5, 0.2, 1.5]) {
                const wheel = build.cylinder(0.55, 0.55, 0.22, 0x14171f, 10);
                wheel.rotation.z = Math.PI / 2;
                wheel.position.set(side * 1.0, 0.55, z);
                g.add(wheel);
            }
        }

        if (player.id !== ctx.selfId) {
            const plate = build.nameplate(player.name, player.slot);
            plate.position.y = 3.4;
            g.add(plate);
        }

        scene.add(g);
        return { group: g, stack };
    }

    const findRow = (rows, slot) => rows.find((r) => r[0] === slot);

    return {
        async build(full) {
            selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;
            lanes = full.lanes ?? 14;
            laneWidth = full.laneWidth ?? 4.2;
            length = full.length ?? 720;

            ctx.engine.setLighting({ hemi: 1.0, sun: 0.65, sky: 0xcfe3ff });
            scene.add(build.skyDome(0x35508a, 0x14203a));
            ctx.engine.scene.fog.near = 60;
            ctx.engine.scene.fog.far = 190;

            const ground = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth * lanes + 70, length + 120), build.mat(0x3d6b43));
            ground.rotation.x = -Math.PI / 2;
            ground.position.set(0, -0.02, length / 2 - 30);
            scene.add(ground);

            buildTrack();
            buildScenery();
            buildObstacles(full.obstacles ?? []);

            finishLine = build.box(laneWidth * lanes, 0.3, 2, 0xffb703);
            finishLine.position.set(0, 0.3, length);
            scene.add(finishLine);

            for (const p of ctx.players()) trains.set(p.slot, buildTrain(p));

            input.setLayout({ stick: true, a: true, aLabel: 'FULL' });
            hud.buildPanel('<div class="meter"><i id="tr-heat" style="width:0%"></i></div>');
            heatBar = document.getElementById('tr-heat');
            hud.setObjective('Flick left and right to switch tracks');
        },

        onState(s) {
            buffer.push(s.p);
            const mine = findRow(s.p, selfSlot);
            if (mine && heatBar) {
                const heat = mine[4];
                heatBar.style.width = `${Math.round(heat * 100)}%`;
                heatBar.style.background = heat > 0.8 ? '#ef476f' : heat > 0.5 ? '#ffd166' : '#06d6a0';
            }
            if (mine) {
                hud.setObjective(`${Math.round((mine[1] / length) * 100)}% — mind the boiler`);
            }
        },

        onEvent(e) {
            switch (e.e) {
                case 'depart':
                    hud.banner('ALL ABOARD!', 1400);
                    sound.win();
                    break;
                case 'crystal':
                    hideObstacle(e.id);
                    if (e.by === ctx.selfId) { hud.toast('Crystal! Boiler cooled'); sound.pickup(); }
                    break;
                case 'boulder': {
                    const train = trains.get(e.slot);
                    if (train) {
                        particles.burst(train.group.position.x, 1.2, train.group.position.z + 2,
                            { color: 0x6f7787, count: 10, speed: 5 });
                    }
                    if (e.by === ctx.selfId) { hud.banner('BOULDER!', 900); sound.bad(); }
                    break;
                }
                case 'overheat':
                    if (e.by === ctx.selfId) { hud.banner('BOILER OVERHEATED', 1600); sound.bad(); }
                    else hud.toastFor(e.by, 'overheated');
                    break;
                case 'arrive': {
                    const who = e.by === ctx.selfId ? 'You arrived' : `${ctx.nameOf(e.by)} arrived`;
                    hud.toast(`${who} — P${e.place}`);
                    if (e.by === ctx.selfId) { hud.banner(`ARRIVED P${e.place}`, 2600); sound.win(); }
                    break;
                }
            }
        },

        update(dt, now) {
            const frame = buffer.sample(now);
            buffer.prune(now);

            let selfZ = 0;
            let selfX = 0;
            let selfSpeed = 0;
            if (frame) {
                for (const row of frame.b) {
                    const [slot, p, lane, v, heat] = row;
                    const train = trains.get(slot);
                    if (!train) continue;
                    const prev = findRow(frame.a, slot) ?? row;
                    const z = interp.lerp(prev[1], p, frame.t);
                    const x = laneX(interp.lerp(prev[2], lane, frame.t));
                    train.group.position.set(x, 0, z);

                    // Smoke from the stack is the speed read-out: idle trains barely
                    // puff, a train at full throttle streams.
                    if (Math.random() < v / 90) {
                        particles.burst(x, 3.0, z + 1.4, {
                            color: heat > 0.8 ? 0xef476f : 0xd8d8e0,
                            count: 1, speed: 1.5, up: 1.4, life: 0.9, spread: 0.3,
                        });
                    }
                    if (slot === selfSlot) { selfZ = z; selfX = x; selfSpeed = v; }
                }
            }

            // Centred exactly on your own train. Biasing the camera toward the middle
            // of the yard shows more of the field but pushes lanes 0 and 13 clean off
            // the screen - and those are the two players who most need to see.
            const back = 16 + selfSpeed * 0.2;
            camGoal.set(selfX, 8.5 + selfSpeed * 0.05, selfZ - back);
            camera.position.lerp(camGoal, 1 - Math.exp(-6 * dt));
            camera.lookAt(selfX, 2.4, selfZ + 20);

            // The A button is full throttle; the stick's forward axis is a fine control.
            const throttle = Math.max(input.axes.y, input.buttons.a ? 1 : 0);
            net.input({ ax: input.axes.x, ay: throttle });
        },

        dispose() {
            OBSTACLE_GEO.dispose();
            trains.clear();
            obstacleRows = [];
            obstacleMesh = null;
            buffer.clear();
        },
    };
}
