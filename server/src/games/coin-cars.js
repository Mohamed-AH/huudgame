import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'coin-cars',
    title: 'Collecting Car Coins',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 20,
    roundSeconds: 120,
};

export const ARENA_RADIUS = 20;

const ACCEL = 22;
const MAX_SPEED = 17;
const DRAG = 1.1;
const TURN = 2.9;
const CAR_RADIUS = 1.2;
const PICKUP_RADIUS = 1.5;
const SHIELD_MS = 6000;
const MAX_PICKUPS = 42;

const VALUE = { coin: 1, gem: 5 };

/**
 * Collecting Car Coins — a neon bowl, fourteen bumper cars, and a floor full of coins.
 *
 * The bumping is what makes this a party game rather than a vacuuming simulator: ram
 * someone and a share of their coins spills onto the floor for anybody to collect.
 * The leader is therefore the most attractive thing in the arena, which keeps a
 * runaway win from happening and keeps the last player interested to the final second.
 */
export function create(room) {
    const cars = new Map();
    const pickups = new Map();
    let nextPickupId = 1;
    let nextSpawnAt = 0;

    function carOf(player) {
        let c = cars.get(player.id);
        if (!c) {
            const a = (player.slot / 14) * Math.PI * 2;
            c = {
                slot: player.slot,
                x: Math.cos(a) * (ARENA_RADIUS - 4),
                z: Math.sin(a) * (ARENA_RADIUS - 4),
                h: a + Math.PI,
                v: 0,
                steer: 0, throttle: 0,
                coins: 0,
                shieldUntil: 0,
                bumps: 0, stolen: 0, lost: 0,
                bumpedAt: 0,
            };
            cars.set(player.id, c);
        }
        return c;
    }

    function spawnPickup(kind, x, z) {
        if (pickups.size >= MAX_PICKUPS) return null;
        const id = nextPickupId++;
        const p = { id, kind, x: r2(x), z: r2(z) };
        pickups.set(id, p);
        room.emit('spawn', { id, kind, x: p.x, z: p.z });
        return p;
    }

    function randomSpot() {
        const a = room.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(room.rng()) * (ARENA_RADIUS - 2.5);   // even area coverage
        return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }

    return {
        start() {
            for (const p of room.players.values()) carOf(p);
            for (let i = 0; i < 26; i++) {
                const spot = randomSpot();
                spawnPickup(room.rng() < 0.18 ? 'gem' : 'coin', spot.x, spot.z);
            }
            // A shield is always available somewhere, so a player being picked on has
            // something to drive toward rather than just a worse afternoon.
            const spot = randomSpot();
            spawnPickup('shield', spot.x, spot.z);
            nextSpawnAt = Date.now() + 1200;
        },

        onInput(player, msg) {
            const c = carOf(player);
            c.steer = Math.max(-1, Math.min(1, Number(msg.ax) || 0));
            c.throttle = Math.max(-1, Math.min(1, Number(msg.ay) || 0));
        },

        tick(dt, now) {
            for (const c of cars.values()) {
                c.v += ACCEL * c.throttle * dt;
                c.v -= c.v * DRAG * dt;
                c.v = Math.max(-MAX_SPEED * 0.45, Math.min(MAX_SPEED, c.v));
                c.h += c.steer * TURN * Math.min(1, Math.abs(c.v) / 4) * Math.sign(c.v || 1) * dt;

                c.x += Math.sin(c.h) * c.v * dt;
                c.z += Math.cos(c.h) * c.v * dt;

                // The wall of the bowl is springy: you bounce, you do not stop dead.
                const r = Math.hypot(c.x, c.z);
                if (r > ARENA_RADIUS - CAR_RADIUS) {
                    const scale = (ARENA_RADIUS - CAR_RADIUS) / r;
                    c.x *= scale;
                    c.z *= scale;
                    c.v *= 0.6;
                }
            }

            collectPickups(now);
            resolveBumps(now);

            if (now >= nextSpawnAt && pickups.size < MAX_PICKUPS) {
                nextSpawnAt = now + Math.max(500, 2200 - room.players.size * 110);
                const spot = randomSpot();
                const roll = room.rng();
                spawnPickup(roll < 0.08 ? 'shield' : roll < 0.25 ? 'gem' : 'coin', spot.x, spot.z);
            }
        },

        onJoin(player) { carOf(player); },
        onLeave(player) { cars.delete(player.id); },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                p: [...room.players.values()].map((p) => {
                    const c = carOf(p);
                    return [p.slot, r2(c.x), r2(c.z), r2(c.h), c.coins, Date.now() < c.shieldUntil ? 1 : 0];
                }),
            };
        },

        fullState() {
            return {
                radius: ARENA_RADIUS,
                pickups: [...pickups.values()].map((p) => [p.id, p.kind, p.x, p.z]),
            };
        },

        isOver() { return false; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const c = carOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${c.bumps} bumps, ${c.stolen} knocked loose, ${c.lost} dropped`,
                    };
                });
        },

        dispose() { cars.clear(); pickups.clear(); },
    };

    function collectPickups(now) {
        for (const [id, c] of cars) {
            const player = room.players.get(id);
            if (!player) continue;
            for (const [pid, p] of pickups) {
                if (Math.hypot(p.x - c.x, p.z - c.z) > PICKUP_RADIUS) continue;
                pickups.delete(pid);

                if (p.kind === 'shield') {
                    c.shieldUntil = now + SHIELD_MS;
                    room.emit('grab', { id: pid, by: id, slot: c.slot, kind: 'shield' });
                    continue;
                }
                const value = VALUE[p.kind];
                c.coins += value;
                player.score = c.coins;
                room.emit('grab', { id: pid, by: id, slot: c.slot, kind: p.kind, v: value });
            }
        }
    }

    function resolveBumps(now) {
        const list = [...cars.entries()];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const [idA, a] = list[i];
                const [idB, b] = list[j];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const d = Math.hypot(dx, dz);
                if (d >= CAR_RADIUS * 2 || d === 0) continue;

                const overlap = (CAR_RADIUS * 2 - d) / 2;
                const nx = dx / d;
                const nz = dz / d;
                a.x -= nx * overlap; a.z -= nz * overlap;
                b.x += nx * overlap; b.z += nz * overlap;

                const closing = Math.abs(a.v - b.v);
                const swap = (a.v - b.v) * 0.6;
                a.v -= swap;
                b.v += swap;

                if (closing < 5 || now < a.bumpedAt || now < b.bumpedAt) continue;
                a.bumpedAt = b.bumpedAt = now + 600;
                a.bumps++;
                b.bumps++;

                // Whoever was going faster is the rammer; the other one spills.
                const rammer = Math.abs(a.v) > Math.abs(b.v) ? a : b;
                const victim = rammer === a ? b : a;
                const victimId = rammer === a ? idB : idA;
                room.emit('bump', { x: r2((a.x + b.x) / 2), z: r2((a.z + b.z) / 2), a: a.slot, b: b.slot });

                if (now < victim.shieldUntil) {
                    room.emit('blocked', { slot: victim.slot });
                    continue;
                }

                const spill = Math.min(4, Math.floor(victim.coins / 4));
                if (spill <= 0) continue;
                victim.coins -= spill;
                victim.lost += spill;
                rammer.stolen += spill;
                const victimPlayer = room.players.get(victimId);
                if (victimPlayer) victimPlayer.score = victim.coins;

                // Spilled coins land on the floor for anybody, not in the rammer's
                // pocket - so a bump is an opportunity for the whole arena.
                for (let n = 0; n < spill; n++) {
                    const a2 = room.rng.range(0, Math.PI * 2);
                    const r2d = room.rng.range(1.6, 3.4);
                    const sx = Math.max(-ARENA_RADIUS + 2, Math.min(ARENA_RADIUS - 2, victim.x + Math.cos(a2) * r2d));
                    const sz = Math.max(-ARENA_RADIUS + 2, Math.min(ARENA_RADIUS - 2, victim.z + Math.sin(a2) * r2d));
                    spawnPickup('coin', sx, sz);
                }
                room.emit('spill', { slot: victim.slot, n: spill });
            }
        }
    }
}
