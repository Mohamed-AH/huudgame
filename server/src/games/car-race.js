import { r2 } from '../../../shared/protocol.js';
import {
    LENGTH, WIDTH, LAPS, CHECKPOINTS,
    pointAt, progressOf, offsetOf, gridSlot, hazards,
} from '../../../shared/track.js';

export const meta = {
    id: 'car-race',
    title: 'Car Race',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 20,           // the fastest-moving game in the suite gets the fastest tick
    roundSeconds: 180,
};

const ACCEL = 26;
const BRAKE = 38;
const MAX_SPEED = 30;
const REVERSE_SPEED = 7;
const DRAG = 0.55;
const TURN = 2.3;
const CAR_RADIUS = 1.15;
const GRASS_GRIP = 0.945;   // per-tick speed retained with two wheels on the grass

/**
 * Fourteen arcade cars, three laps, one stadium circuit.
 *
 * The handling model is deliberately forgiving - there is no spin-out and no damage,
 * because a seven-year-old on a phone should still finish the race. What separates
 * good driving from bad is the racing line: cutting onto the grass is slow, and the
 * checkpoint chain means cutting across the infield does not count as a lap at all.
 */
export function create(room) {
    const pads = hazards(room.rng);
    const cars = new Map();
    let finishedCount = 0;
    let bestLap = { id: null, time: Infinity };

    function makeCar(player) {
        const g = gridSlot(player.slot);
        return {
            slot: player.slot,
            x: g.x, z: g.z, h: g.heading,
            v: 0,
            steer: 0, throttle: 0,
            lap: 0,
            seg: Math.floor((g.p / LENGTH) * CHECKPOINTS) % CHECKPOINTS,
            lapStartedAt: 0,
            bestLap: Infinity,
            finished: false,
            place: 0,
            oiledUntil: 0,
            progress: g.p,
        };
    }

    const carOf = (player) => {
        let c = cars.get(player.id);
        if (!c) { c = makeCar(player); cars.set(player.id, c); }
        return c;
    };

    /** Total distance travelled, used for ranking cars that never finish. */
    const totalProgress = (c) => c.lap * LENGTH + c.progress;

    return {
        start() {
            const now = Date.now();
            for (const p of room.players.values()) carOf(p).lapStartedAt = now;
            room.emit('lights', {});
        },

        onInput(player, msg) {
            const c = carOf(player);
            c.steer = Math.max(-1, Math.min(1, Number(msg.ax) || 0));
            c.throttle = Math.max(-1, Math.min(1, Number(msg.ay) || 0));
        },

        tick(dt, now) {
            const list = [...cars.entries()];

            for (const [id, c] of list) {
                if (c.finished) { c.v *= 0.96; continue; }

                if (c.throttle > 0) c.v += ACCEL * c.throttle * dt;
                else if (c.throttle < 0) c.v += (c.v > 0 ? BRAKE : ACCEL * 0.5) * c.throttle * dt;
                c.v -= c.v * DRAG * dt;
                c.v = Math.max(-REVERSE_SPEED, Math.min(MAX_SPEED, c.v));

                // Steering authority scales with speed: a parked car cannot pirouette,
                // and a fast one still turns enough to take the loops flat out.
                const grip = now < c.oiledUntil ? 0.35 : 1;
                const authority = Math.min(1, Math.abs(c.v) / 6) * Math.sign(c.v || 1);
                c.h += c.steer * TURN * authority * grip * dt;

                c.x += Math.sin(c.h) * c.v * dt;
                c.z += Math.cos(c.h) * c.v * dt;

                // Off the tarmac: bleed speed and get nudged back, never teleported.
                const off = offsetOf(c.x, c.z);
                if (off > WIDTH / 2) {
                    c.v *= GRASS_GRIP;
                    const p = progressOf(c.x, c.z);
                    const { x: cx, z: cz } = pointAt(p);
                    const pull = Math.min(1, (off - WIDTH / 2) / 6) * 14 * dt;
                    c.x += (cx - c.x) * pull / Math.max(1, off);
                    c.z += (cz - c.z) * pull / Math.max(1, off);
                }

                stepHazards(c, now);
                stepLap(id, c, now);
            }

            resolveBumps(list);
        },

        onJoin(player) { carOf(player).lapStartedAt = Date.now(); },
        onLeave(player) { cars.delete(player.id); },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                laps: LAPS,
                p: [...room.players.values()].map((p) => {
                    const c = carOf(p);
                    return [p.slot, r2(c.x), r2(c.z), r2(c.h), r2(c.v), c.lap, c.finished ? 1 : 0];
                }),
            };
        },

        fullState() {
            return { pads, laps: LAPS };
        },

        isOver() {
            const racing = [...room.players.values()].filter((p) => !carOf(p).finished);
            return room.players.size > 0 && racing.length === 0;
        },

        results() {
            const ranked = [...room.players.values()].sort((a, b) => {
                const ca = carOf(a);
                const cb = carOf(b);
                if (ca.finished !== cb.finished) return ca.finished ? -1 : 1;
                if (ca.finished) return ca.place - cb.place;
                return totalProgress(cb) - totalProgress(ca);
            });

            return ranked.map((p, i) => {
                const c = carOf(p);
                // Points are awarded here rather than during the race, because place
                // is only known once everybody has either finished or run out of time.
                let score = Math.max(40, 200 - i * 12);
                if (bestLap.id === p.id) score += 30;
                p.score = score;
                const lap = c.bestLap === Infinity ? null : `best lap ${(c.bestLap / 1000).toFixed(1)}s`;
                return {
                    id: p.id, name: p.name, slot: p.slot,
                    score, place: i + 1,
                    note: c.finished ? lap : `${c.lap + 1} of ${LAPS} laps`,
                };
            });
        },

        dispose() { cars.clear(); },
    };

    // ------------------------------------------------------------------ helpers

    function stepHazards(c, now) {
        const p = progressOf(c.x, c.z);
        for (const pad of pads) {
            let d = Math.abs(p - pad.p);
            d = Math.min(d, LENGTH - d);                 // the track wraps
            if (d > 2.5) continue;
            const { x: cx, z: cz, hx, hz } = pointAt(pad.p);
            const lat = (c.x - cx) * -hz + (c.z - cz) * hx;
            if (Math.abs(lat - pad.lat) > 2.2) continue;

            if (pad.kind === 'boost') {
                if (c.v >= MAX_SPEED * 1.3) continue;         // already flying; no double dip
                c.v = Math.min(MAX_SPEED * 1.45, c.v + 11);
                room.emit('boost', { slot: c.slot });
            } else if (now > c.oiledUntil) {
                c.oiledUntil = now + 1400;
                c.v *= 0.82;
                room.emit('oil', { slot: c.slot });
            }
        }
    }

    function stepLap(id, c, now) {
        c.progress = progressOf(c.x, c.z);
        const seg = Math.floor((c.progress / LENGTH) * CHECKPOINTS) % CHECKPOINTS;
        if (seg === c.seg) return;

        // Only the next checkpoint in sequence counts. Cutting the infield skips one,
        // and a skipped checkpoint means the lap simply does not tick over.
        if (seg !== (c.seg + 1) % CHECKPOINTS) return;
        c.seg = seg;
        if (seg !== 0) return;

        const time = now - c.lapStartedAt;
        c.lapStartedAt = now;
        c.bestLap = Math.min(c.bestLap, time);
        if (time < bestLap.time) bestLap = { id, time };
        c.lap++;

        if (c.lap >= LAPS) {
            c.finished = true;
            c.place = ++finishedCount;
            room.emit('finish', { by: id, place: c.place });
        } else {
            room.emit('lap', { by: id, lap: c.lap + 1, of: LAPS, time: Math.round(time) });
        }
    }

    /** Cars push each other apart and trade a little speed; nobody ever spins out. */
    function resolveBumps(list) {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i][1];
                const b = list[j][1];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const d = Math.hypot(dx, dz);
                if (d >= CAR_RADIUS * 2 || d === 0) continue;

                const overlap = (CAR_RADIUS * 2 - d) / 2;
                const nx = dx / d;
                const nz = dz / d;
                a.x -= nx * overlap; a.z -= nz * overlap;
                b.x += nx * overlap; b.z += nz * overlap;

                const swap = (a.v - b.v) * 0.25;
                a.v -= swap;
                b.v += swap;

                // Fourteen cars in a pack overlap constantly; only a bump with some
                // force behind it is worth a sound and a spark, and only now and then.
                const now = Date.now();
                if (Math.abs(swap) > 1.6 && now > (a.bumpedAt ?? 0) && now > (b.bumpedAt ?? 0)) {
                    a.bumpedAt = b.bumpedAt = now + 350;
                    room.emit('bump', { a: a.slot, b: b.slot, x: r2(a.x + nx * overlap), z: r2(a.z + nz * overlap) });
                }
            }
        }
    }
}
