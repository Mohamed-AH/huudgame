import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'train-race',
    title: 'Train Race',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 20,
    roundSeconds: 110,
};

export const LANES = 14;
export const LANE_WIDTH = 4.2;
export const TRACK_LENGTH = 720;

const MAX_SPEED = 34;
const ACCEL = 13;
const COAST_DRAG = 3.2;
const LANE_COOLDOWN_MS = 300;
const HIT_RADIUS = 2.6;

// The throttle is the whole game: flat out is fastest but the boiler overheats, and
// an overheated train is slower than one that was never pushed at all.
const HEAT_GAIN = 0.34;          // per second at full throttle
const HEAT_COOL = 0.42;          // per second when easing off
const OVERHEAT_SECONDS = 3.2;

/**
 * Train Race — 14 parallel tracks through a valley, one lane each, no contact.
 *
 * Trains cannot collide with each other on purpose. With fourteen players a contact
 * racer turns into a pile-up at the first corner and the youngest player never sees
 * the finish line; here the only things in your way are the obstacles, and everyone
 * gets the same ones in the same places.
 */
export function create(room) {
    const obstacles = [];
    for (let p = 60; p < TRACK_LENGTH - 40; p += room.rng.range(9, 17)) {
        // Never block more than half the lanes at one distance, so there is always a
        // clear line through for somebody paying attention.
        const blocked = room.rng.int(2, 6);
        const lanes = room.rng.shuffle([...Array(LANES).keys()]).slice(0, blocked);
        for (const lane of lanes) {
            obstacles.push({
                id: obstacles.length,
                p: r2(p + room.rng.range(-2, 2)),
                lane,
                kind: room.rng() < 0.72 ? 'rock' : 'crystal',
                taken: false,
            });
        }
    }

    const trains = new Map();
    let finishedCount = 0;

    function trainOf(player) {
        let t = trains.get(player.id);
        if (!t) {
            t = {
                slot: player.slot,
                lane: player.slot,
                laneVisual: player.slot,
                p: 0,
                v: 0,
                heat: 0,
                overheatUntil: 0,
                laneAt: 0,
                throttle: 0,
                steer: 0,
                crystals: 0,
                bumps: 0,
                finished: false,
                place: 0,
                finishedAt: 0,
            };
            trains.set(player.id, t);
        }
        return t;
    }

    return {
        start() {
            for (const p of room.players.values()) trainOf(p);
            room.emit('depart', {});
        },

        onInput(player, msg) {
            const t = trainOf(player);
            t.throttle = Math.max(0, Math.min(1, Number(msg.ay) || 0));
            t.steer = Math.max(-1, Math.min(1, Number(msg.ax) || 0));
        },

        tick(dt, now) {
            for (const [id, t] of trains) {
                if (t.finished) { t.v = Math.max(0, t.v - COAST_DRAG * dt * 2); t.p += t.v * dt; continue; }

                // Lane changes are discrete but driven by the same stick every other
                // game uses, with a short cooldown so one flick moves you one track.
                if (Math.abs(t.steer) > 0.5 && now - t.laneAt > LANE_COOLDOWN_MS) {
                    const next = t.lane + Math.sign(t.steer);
                    if (next >= 0 && next < LANES) {
                        t.lane = next;
                        t.laneAt = now;
                        room.emit('switch', { slot: t.slot, lane: next });
                    }
                }
                t.laneVisual += (t.lane - t.laneVisual) * Math.min(1, dt * 9);

                const overheated = now < t.overheatUntil;
                const throttle = overheated ? Math.min(t.throttle, 0.35) : t.throttle;

                if (throttle > 0.75 && !overheated) t.heat = Math.min(1, t.heat + HEAT_GAIN * dt);
                else t.heat = Math.max(0, t.heat - HEAT_COOL * dt);

                if (t.heat >= 1 && !overheated) {
                    t.overheatUntil = now + OVERHEAT_SECONDS * 1000;
                    t.heat = 0.99;
                    t.v *= 0.7;
                    room.emit('overheat', { by: id, slot: t.slot });
                }

                t.v += (ACCEL * throttle - COAST_DRAG * (throttle < 0.05 ? 1.6 : 0.4)) * dt;
                t.v = Math.max(0, Math.min(MAX_SPEED * (overheated ? 0.55 : 1), t.v));
                t.p += t.v * dt;

                resolveObstacles(id, t, now);

                if (t.p >= TRACK_LENGTH) {
                    t.finished = true;
                    t.finishedAt = now;
                    t.place = ++finishedCount;
                    room.emit('arrive', { by: id, place: t.place });
                }
            }
        },

        onJoin(player) {
            const t = trainOf(player);
            // A late arrival starts level with the pack rather than a lap behind.
            const leaders = [...trains.values()].filter((x) => x !== t).map((x) => x.p);
            if (leaders.length) t.p = Math.max(0, Math.min(...leaders) - 10);
        },
        onLeave(player) { trains.delete(player.id); },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                len: TRACK_LENGTH,
                p: [...room.players.values()].map((p) => {
                    const t = trainOf(p);
                    return [p.slot, r2(t.p), r2(t.laneVisual), r2(t.v), r2(t.heat), t.finished ? 1 : 0];
                }),
            };
        },

        fullState() {
            return {
                lanes: LANES,
                laneWidth: LANE_WIDTH,
                length: TRACK_LENGTH,
                obstacles: obstacles.map((o) => [o.id, o.p, o.lane, o.kind === 'rock' ? 0 : 1, o.taken ? 1 : 0]),
            };
        },

        isOver() {
            const running = [...room.players.values()].filter((p) => !trainOf(p).finished);
            return room.players.size > 0 && running.length === 0;
        },

        results() {
            const ranked = [...room.players.values()].sort((a, b) => {
                const ta = trainOf(a);
                const tb = trainOf(b);
                if (ta.finished !== tb.finished) return ta.finished ? -1 : 1;
                if (ta.finished) return ta.place - tb.place;
                return tb.p - ta.p;
            });

            return ranked.map((p, i) => {
                const t = trainOf(p);
                // Placement is the headline, crystals are the consolation: a player who
                // never finishes but collected well still has something on the board.
                const score = Math.max(30, 180 - i * 11) + t.crystals * 15;
                p.score = score;
                return {
                    id: p.id, name: p.name, slot: p.slot,
                    score, place: i + 1,
                    note: t.finished
                        ? `${t.crystals} crystals, ${t.bumps} boulders`
                        : `${Math.round((t.p / TRACK_LENGTH) * 100)}% of the way`,
                };
            });
        },

        dispose() { trains.clear(); obstacles.length = 0; },
    };

    function resolveObstacles(id, t, now) {
        for (const o of obstacles) {
            if (o.taken) continue;
            if (o.lane !== Math.round(t.laneVisual)) continue;
            if (Math.abs(o.p - t.p) > HIT_RADIUS) continue;

            if (o.kind === 'crystal') {
                o.taken = true;
                t.crystals++;
                t.v = Math.min(MAX_SPEED * 1.25, t.v + 8);
                t.heat = Math.max(0, t.heat - 0.25);       // a crystal also cools the boiler
                room.emit('crystal', { by: id, slot: t.slot, id: o.id });
            } else {
                // Boulders are not consumed - the same rock can catch the whole family,
                // which is most of the entertainment - but they only bite once a second.
                if (now - (t.lastHitAt ?? 0) < 900) continue;
                t.lastHitAt = now;
                t.bumps++;
                t.v *= 0.45;
                t.heat = Math.min(1, t.heat + 0.15);
                room.emit('boulder', { by: id, slot: t.slot, id: o.id });
            }
        }
    }
}
