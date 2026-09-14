import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'baby-cleaning',
    title: 'Baby Cleaning',
    mode: 'coop',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 15,
    roundSeconds: 140,
};

const ROOM_X = 13;
const ROOM_Z = 9;
const SPEED = 6.6;
const REACH = 1.7;
const BIN_REACH = 2.4;
const TOYS = 56;
const STAINS = 12;
const SCRUB_RATE = 0.55;         // stain progress per second, per scrubbing player

export const CATEGORIES = ['blocks', 'bears', 'balls', 'books'];

/**
 * Baby Cleaning — a messy nursery and a clock.
 *
 * The whole family is scored as one number, and the two jobs - carrying toys and
 * scrubbing stains - deliberately need different things. Carrying rewards knowing
 * where the bins are; scrubbing is faster the more people stand on the same stain,
 * so the room naturally sorts itself into runners and scrubbers without anyone being
 * told to.
 *
 * Putting a toy in the wrong bin still clears the floor - it simply scores nothing.
 * A four-year-old is never punished for helping.
 */
export function create(room) {
    const toys = [];
    for (let i = 0; i < TOYS; i++) {
        toys.push({
            id: i,
            cat: i % CATEGORIES.length,
            x: r2(room.rng.range(-ROOM_X + 1.5, ROOM_X - 1.5)),
            z: r2(room.rng.range(-ROOM_Z + 1.5, ROOM_Z - 1.5)),
            state: 0,                // 0 floor, 1 carried, 2 binned
            by: null,
        });
    }

    const stains = [];
    for (let i = 0; i < STAINS; i++) {
        stains.push({
            id: i,
            x: r2(room.rng.range(-ROOM_X + 2, ROOM_X - 2)),
            z: r2(room.rng.range(-ROOM_Z + 2, ROOM_Z - 2)),
            progress: 0,
        });
    }

    const bins = CATEGORIES.map((cat, i) => ({
        cat: i,
        x: i % 2 === 0 ? -ROOM_X + 1.6 : ROOM_X - 1.6,
        z: i < 2 ? -ROOM_Z + 1.6 : ROOM_Z - 1.6,
    }));

    const kids = new Map();
    let binnedRight = 0;
    let binnedWrong = 0;

    function kidOf(player) {
        let k = kids.get(player.id);
        if (!k) {
            k = {
                slot: player.slot,
                x: (player.slot % 7) * 2 - 6,
                z: player.slot < 7 ? -1 : 1,
                rot: 0, ax: 0, az: 0, scrub: false,
                carrying: null,
                tidied: 0, scrubbed: 0,
            };
            kids.set(player.id, k);
        }
        return k;
    }

    const tidiness = () => {
        const toyPart = toys.filter((t) => t.state === 2).length / TOYS;
        const stainPart = stains.reduce((sum, s) => sum + Math.min(1, s.progress), 0) / STAINS;
        // Toys and stains weigh the same, so neither job can be ignored.
        return Math.round(((toyPart + stainPart) / 2) * 100);
    };

    return {
        start() {
            for (const p of room.players.values()) kidOf(p);
        },

        onInput(player, msg) {
            const k = kidOf(player);
            k.ax = Math.max(-1, Math.min(1, Number(msg.ax) || 0));
            k.az = Math.max(-1, Math.min(1, Number(msg.ay) || 0));
            k.scrub = !!msg.b;
        },

        onAction(player, msg) {
            if (msg.a !== 'use') return;
            const k = kidOf(player);

            if (k.carrying) {
                const toy = k.carrying;
                const bin = bins.find((b) => Math.hypot(b.x - k.x, b.z - k.z) < BIN_REACH);
                if (!bin) {
                    toy.state = 0;
                    toy.x = r2(k.x);
                    toy.z = r2(k.z);
                    toy.by = null;
                    k.carrying = null;
                    room.emit('drop', { id: toy.id, x: toy.x, z: toy.z });
                    return;
                }

                toy.state = 2;
                toy.by = null;
                k.carrying = null;
                const right = bin.cat === toy.cat;
                if (right) { binnedRight++; player.score += 15; k.tidied++; }
                else { binnedWrong++; player.score += 2; }
                room.emit('bin', { id: toy.id, by: player.id, cat: bin.cat, ok: right ? 1 : 0, pct: tidiness() });
                return;
            }

            let best = null;
            let bestD = REACH;
            for (const toy of toys) {
                if (toy.state !== 0) continue;
                const d = Math.hypot(toy.x - k.x, toy.z - k.z);
                if (d < bestD) { bestD = d; best = toy; }
            }
            if (!best) return;
            best.state = 1;
            best.by = player.id;
            k.carrying = best;
            room.emit('pick', { id: best.id, by: player.id, cat: best.cat });
        },

        tick(dt) {
            for (const [id, k] of kids) {
                const len = Math.hypot(k.ax, k.az) || 1;
                const scale = Math.min(1, len);
                k.x += (k.ax / len) * scale * SPEED * dt;
                k.z += (-k.az / len) * scale * SPEED * dt;
                k.x = Math.max(-ROOM_X, Math.min(ROOM_X, k.x));
                k.z = Math.max(-ROOM_Z, Math.min(ROOM_Z, k.z));
                if (Math.abs(k.ax) + Math.abs(k.az) > 0.05) k.rot = Math.atan2(k.ax, -k.az);

                if (!k.scrub || k.carrying) continue;
                for (const stain of stains) {
                    if (stain.progress >= 1) continue;
                    if (Math.hypot(stain.x - k.x, stain.z - k.z) > 1.6) continue;
                    // Progress is per scrubber, so a stain everybody piles onto really
                    // does come up faster. That is the whole reason to work together.
                    stain.progress = Math.min(1, stain.progress + SCRUB_RATE * dt);
                    k.scrubbed += SCRUB_RATE * dt;
                    const player = room.players.get(id);
                    if (player) player.score += SCRUB_RATE * dt * 12;
                    if (stain.progress >= 1) room.emit('clean', { id: stain.id, pct: tidiness() });
                    break;
                }
            }
        },

        onJoin(player) { kidOf(player); },
        onLeave(player) {
            const k = kids.get(player.id);
            // A dropped toy stays where its carrier stood rather than vanishing.
            if (k?.carrying) { k.carrying.state = 0; k.carrying.x = r2(k.x); k.carrying.z = r2(k.z); }
            kids.delete(player.id);
        },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                pct: tidiness(),
                p: [...room.players.values()].map((p) => {
                    const k = kidOf(p);
                    return [p.slot, r2(k.x), r2(k.z), r2(k.rot), k.carrying ? k.carrying.cat + 1 : 0];
                }),
                // Twelve stains is cheap enough to send whole, and it means a late
                // joiner's scrub bar is right without any reconciliation.
                st: stains.map((s) => r2(s.progress)),
            };
        },

        fullState() {
            return {
                room: [ROOM_X, ROOM_Z],
                categories: CATEGORIES,
                bins: bins.map((b) => [b.cat, b.x, b.z]),
                toys: toys.map((t) => [t.id, t.x, t.z, t.cat, t.state]),
                stains: stains.map((s) => [s.id, s.x, s.z, r2(s.progress)]),
                pct: tidiness(),
            };
        },

        isOver() { return tidiness() >= 100; },

        familyScore() { return tidiness(); },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const k = kidOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${k.tidied} toys sorted, ${Math.round(k.scrubbed * 100) / 100} stains scrubbed`,
                    };
                });
        },

        dispose() { kids.clear(); toys.length = 0; stains.length = 0; },
    };
}
