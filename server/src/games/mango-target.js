import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'mango-target',
    title: 'Mango Target',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 20,
    roundSeconds: 120,
};

const GRAVITY = -17;
const THROW_COOLDOWN_MS = 340;
const PROJECTILE_LIFE = 4;
const HIT_RADIUS = 0.85;
const ANCHORS_PER_TREE = 4;
const TREES = 7;

const POINTS = { ripe: 10, gold: 100, falling: 25 };

/**
 * Mango Target — 14 players in a semi-circle throwing at an orchard.
 *
 * Only moving things go out every tick. The orchard's anchor points are fixed and
 * travel once in fullState; after that a mango appearing, detaching or being knocked
 * down is a single event, which keeps a 24-target scene down to a few hundred bytes
 * a second instead of a few hundred thousand.
 */
export function create(room) {
    const anchors = [];
    for (let t = 0; t < TREES; t++) {
        // Trees sit on an arc in front of the throwing line, near ones low and wide,
        // far ones high - so every player has both an easy and a greedy option.
        const a = -0.95 + (t / (TREES - 1)) * 1.9;
        const dist = 17 + Math.abs(a) * 4;
        const tx = Math.sin(a) * dist;
        const tz = -Math.cos(a) * dist;
        for (let i = 0; i < ANCHORS_PER_TREE; i++) {
            const spin = (i / ANCHORS_PER_TREE) * Math.PI * 2 + t;
            anchors.push({
                id: anchors.length,
                tree: t,
                x: r2(tx + Math.cos(spin) * 1.5),
                y: r2(3.4 + Math.sin(spin) * 1.1),
                z: r2(tz + Math.sin(spin) * 1.2),
                state: 0,            // 0 empty, 1 ripe, 2 golden
                readyAt: 0,
            });
        }
    }

    const trees = anchors.reduce((acc, a) => {
        if (!acc[a.tree]) {
            const sample = anchors.find((n) => n.tree === a.tree);
            acc[a.tree] = { x: r2(sample.x), z: r2(sample.z) };
        }
        return acc;
    }, []);

    const falling = new Map();       // id -> { id, x, y, z, vy, from }
    const shots = new Map();         // id -> projectile
    const stats = new Map();         // playerId -> { hits, streak, best, throws }
    let nextId = 1;
    let nextDetachAt = 0;
    let nextGoldAt = 0;

    const statOf = (player) => {
        let s = stats.get(player.id);
        if (!s) { s = { hits: 0, streak: 0, best: 0, throws: 0, cooldown: 0 }; stats.set(player.id, s); }
        return s;
    };

    /**
     * Where a player stands. Evenly spaced rather than swept round an arc: at 14
     * players an arc tight enough to frame nicely puts everyone shoulder to shoulder.
     */
    function standPosition(slot) {
        const offset = slot - 6.5;
        return { x: offset * 1.95, z: 8 + Math.abs(offset) * 0.32, y: 0 };
    }

    function ripen(anchor, golden) {
        anchor.state = golden ? 2 : 1;
        anchor.readyAt = 0;
        room.emit('ripe', { id: anchor.id, gold: golden ? 1 : 0 });
    }

    function clearAnchor(anchor, now, delay = 5000) {
        anchor.state = 0;
        anchor.readyAt = now + delay + room.rng.range(0, 3000);
        room.emit('gone', { id: anchor.id });
    }

    function award(player, kind, multiplier) {
        const base = POINTS[kind];
        const points = Math.round(base * multiplier);
        player.score += points;
        return points;
    }

    return {
        start() {
            const now = Date.now();
            // Half the orchard starts ripe so nobody stands around waiting on tick one.
            for (const anchor of anchors) {
                if (room.rng() < 0.55) ripen(anchor, false);
                else anchor.readyAt = now + room.rng.range(1000, 6000);
            }
            nextDetachAt = now + 4000;
            nextGoldAt = now + 12000;
        },

        onAction(player, msg) {
            if (msg.a !== 'throw') return;
            const s = statOf(player);
            const now = Date.now();
            if (now < s.cooldown) return;                      // server-side rate limit
            s.cooldown = now + THROW_COOLDOWN_MS;
            s.throws++;

            // The client sends where it is aiming, never where the mango went.
            const yaw = Math.max(-1.2, Math.min(1.2, Number(msg.yaw) || 0));
            const pitch = Math.max(0.05, Math.min(1.3, Number(msg.pitch) || 0.5));
            const power = Math.max(0.15, Math.min(1, Number(msg.pow) || 0.5));

            const stand = standPosition(player.slot);
            const speed = 13 + power * 17;
            const id = nextId++;
            shots.set(id, {
                id,
                owner: player.id,
                slot: player.slot,
                x: stand.x, y: 1.5, z: stand.z,
                vx: Math.sin(yaw) * Math.cos(pitch) * speed,
                vy: Math.sin(pitch) * speed,
                vz: -Math.cos(yaw) * Math.cos(pitch) * speed,
                life: PROJECTILE_LIFE,
            });
            room.emit('throw', { by: player.id, slot: player.slot });
        },

        tick(dt, now) {
            // Ripening
            for (const anchor of anchors) {
                if (anchor.state === 0 && anchor.readyAt && now >= anchor.readyAt) ripen(anchor, false);
            }

            // A mango occasionally lets go by itself - a moving target is worth more,
            // and it gives the orchard something happening between throws.
            if (now >= nextDetachAt) {
                nextDetachAt = now + 4200 + room.rng.range(0, 2600);
                const ripeOnes = anchors.filter((a) => a.state === 1);
                if (ripeOnes.length) {
                    const anchor = room.rng.pick(ripeOnes);
                    const id = nextId++;
                    falling.set(id, { id, x: anchor.x, y: anchor.y, z: anchor.z, vy: 0, from: anchor.id });
                    clearAnchor(anchor, now, 3000);
                    room.emit('detach', { id, from: anchor.id, x: anchor.x, y: anchor.y, z: anchor.z });
                }
            }

            if (now >= nextGoldAt) {
                nextGoldAt = now + 19000 + room.rng.range(0, 5000);
                const empty = anchors.filter((a) => a.state === 0);
                if (empty.length) ripen(room.rng.pick(empty), true);
            }

            for (const [id, m] of falling) {
                m.vy += GRAVITY * 0.45 * dt;                    // lazy, catchable fall
                m.y += m.vy * dt;
                if (m.y <= 0.4) {
                    falling.delete(id);
                    room.emit('splat', { id, x: m.x, z: m.z });
                }
            }

            for (const [id, p] of shots) {
                p.life -= dt;
                p.vy += GRAVITY * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.z += p.vz * dt;

                const player = room.players.get(p.owner);
                const hit = player ? resolveHit(p, player, now) : true;
                if (hit || p.life <= 0 || p.y < 0.2 || Math.abs(p.x) > 60 || p.z < -60 || p.z > 30) {
                    if (!hit && player) {
                        // A miss ends the streak. That is the only thing streaks cost.
                        const s = statOf(player);
                        if (s.streak > 1) room.emit('streakEnd', { by: player.id, at: s.streak });
                        s.streak = 0;
                    }
                    if (!hit) room.emit('miss', { id, x: r2(p.x), z: r2(p.z) });
                    shots.delete(id);
                }
            }
        },

        onJoin(player) { statOf(player); },
        onLeave(player) { stats.delete(player.id); },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                // Only what moves: falling fruit and mangoes in flight.
                f: [...falling.values()].map((m) => [m.id, r2(m.x), r2(m.y), r2(m.z)]),
                s: [...shots.values()].map((p) => [p.id, p.slot, r2(p.x), r2(p.y), r2(p.z)]),
            };
        },

        fullState() {
            return {
                trees,
                anchors: anchors.map((a) => [a.id, a.x, a.y, a.z, a.state]),
                stands: [...Array(14)].map((_, slot) => {
                    const s = standPosition(slot);
                    return [slot, r2(s.x), r2(s.z)];
                }),
                falling: [...falling.values()].map((m) => [m.id, r2(m.x), r2(m.y), r2(m.z)]),
            };
        },

        isOver() { return false; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const s = statOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${s.hits}/${s.throws} on target, best streak ${s.best}`,
                    };
                });
        },

        dispose() { falling.clear(); shots.clear(); stats.clear(); },
    };

    /** Returns true if this projectile struck something and should be retired. */
    function resolveHit(p, player, now) {
        const s = statOf(player);

        for (const [id, m] of falling) {
            if (Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z) > HIT_RADIUS + 0.25) continue;
            falling.delete(id);
            return score(p, player, s, 'falling', m.x, m.y, m.z, id);
        }

        for (const anchor of anchors) {
            if (anchor.state === 0) continue;
            if (Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z) > HIT_RADIUS) continue;
            const kind = anchor.state === 2 ? 'gold' : 'ripe';
            clearAnchor(anchor, now, kind === 'gold' ? 9000 : 4000);
            return score(p, player, s, kind, anchor.x, anchor.y, anchor.z, anchor.id);
        }

        return false;
    }

    function score(p, player, s, kind, x, y, z, targetId) {
        s.hits++;
        s.streak++;
        s.best = Math.max(s.best, s.streak);
        // Three hits in a row is where the multiplier starts to bite, and it caps at
        // triple so one hot streak cannot decide the whole round.
        const multiplier = Math.min(3, 1 + Math.max(0, s.streak - 2) * 0.25);
        const points = award(player, kind, multiplier);
        room.emit('hit', {
            by: player.id, slot: p.slot, kind, pts: points,
            streak: s.streak, mult: r2(multiplier),
            x: r2(x), y: r2(y), z: r2(z), target: targetId,
        });
        return true;
    }
}
