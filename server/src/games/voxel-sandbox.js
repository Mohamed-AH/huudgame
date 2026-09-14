import { r2 } from '../../../shared/protocol.js';
import {
    W, H, D, AIR, PALETTE, idx, inBounds,
    worldX, worldZ, gridX, gridZ,
    generateWorld, generateBlueprint,
} from '../../../shared/voxel.js';

export const meta = {
    id: 'voxel-sandbox',
    title: 'Voxel Sandbox',
    mode: 'coop',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 15,
    roundSeconds: 150,
};

const REACH = 6;              // blocks; generous, because aiming on a phone is hard
const SPEED = 5.4;
const GRAVITY = -24;
const JUMP = 8.4;
const HALF = 0.32;            // player half-width
const TALL = 1.72;

/**
 * A bounded blocky world 14 people share. Mining and placing are free-form, but the
 * family has a common goal: a floating blueprint outline that fills in as the right
 * block goes in the right place.
 *
 * The opening world is never sent - both sides generate it from the round seed - so
 * all this module broadcasts is player positions and the blocks somebody changed.
 */
export function create(room) {
    const { cells, heights } = generateWorld(room.seed);
    const blueprint = generateBlueprint(room.seed, heights);

    // Blueprint cells by grid index, so a placement is checked with one lookup.
    const wanted = new Map(blueprint.cells.map((c) => [idx(c.x, c.y, c.z), c.b]));
    const filled = new Set();

    const bodies = new Map();      // playerId -> body
    let changes = [];              // block mutations awaiting the next snapshot

    function spawn(slot) {
        // Spawn on a ring near the blueprint so nobody starts inside a tree.
        const a = (slot / 14) * Math.PI * 2;
        const gx = Math.round(W / 2 + Math.cos(a) * 9);
        const gz = Math.round(D / 2 + Math.sin(a) * 9);
        const col = Math.max(0, Math.min(W - 1, gx)) + Math.max(0, Math.min(D - 1, gz)) * W;
        return {
            slot,
            x: worldX(Math.max(1, Math.min(W - 2, gx))),
            y: (heights[col] ?? 4) + 1.2,
            z: worldZ(Math.max(1, Math.min(D - 2, gz))),
            vy: 0,
            yaw: a + Math.PI,
            ax: 0, az: 0, jump: false,
            grounded: false,
            placed: 0, mined: 0, correct: 0,
        };
    }

    const bodyOf = (player) => {
        let b = bodies.get(player.id);
        if (!b) { b = spawn(player.slot); bodies.set(player.id, b); }
        return b;
    };

    const solidAt = (wx, wy, wz) => {
        const x = gridX(wx);
        const y = Math.floor(wy);
        const z = gridZ(wz);
        if (y < 0) return true;                      // the void is a floor
        if (!inBounds(x, y, z)) return false;
        return cells[idx(x, y, z)] !== AIR;
    };

    /** Does the player's box overlap any solid block at this position? */
    function blocked(x, y, z) {
        for (const dx of [-HALF, HALF]) {
            for (const dz of [-HALF, HALF]) {
                for (const dy of [0.05, TALL * 0.5, TALL - 0.05]) {
                    if (solidAt(x + dx, y + dy, z + dz)) return true;
                }
            }
        }
        return false;
    }

    function setBlock(i, type) {
        cells[i] = type;
        changes.push(i, type);
    }

    /** Nobody may mine or place inside somebody else - including themselves. */
    function occupied(gx, gy, gz) {
        for (const b of bodies.values()) {
            if (gridX(b.x) === gx && gridZ(b.z) === gz) {
                const foot = Math.floor(b.y);
                if (gy === foot || gy === foot + 1) return true;
            }
        }
        return false;
    }

    return {
        start() {
            for (const p of room.players.values()) bodyOf(p);
        },

        onInput(player, msg) {
            const b = bodyOf(player);
            b.ax = Math.max(-1, Math.min(1, Number(msg.ax) || 0));
            b.az = Math.max(-1, Math.min(1, Number(msg.ay) || 0));
            if (Number.isFinite(msg.yw)) b.yaw = msg.yw;
            b.jump = !!msg.b;
        },

        onAction(player, msg) {
            const b = bodyOf(player);
            const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0;
            if (!inBounds(x, y, z)) return;

            // Reach is checked against the block centre, server-side, every time -
            // a client that claims to touch the far side of the map is simply ignored.
            const dist = Math.hypot(worldX(x) - b.x, y + 0.5 - (b.y + TALL * 0.6), worldZ(z) - b.z);
            if (dist > REACH) return;

            const i = idx(x, y, z);

            if (msg.a === 'mine') {
                if (cells[i] === AIR) return;
                if (y === 0) return;                          // bedrock: no digging out of the world
                setBlock(i, AIR);
                b.mined++;
                player.score += 1;
                if (filled.delete(i)) room.emit('progress', { pct: progressPct() });
                room.emit('mine', { by: player.id, x, y, z });
                return;
            }

            if (msg.a === 'place') {
                const type = PALETTE.includes(msg.b | 0) ? msg.b | 0 : PALETTE[0];
                if (cells[i] !== AIR) return;
                if (occupied(x, y, z)) return;
                // A block must touch something, or the world fills with floating cubes.
                const touching = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
                    .some(([dx, dy, dz]) => inBounds(x + dx, y + dy, z + dz) && cells[idx(x + dx, y + dy, z + dz)] !== AIR);
                if (!touching && y > 0) return;

                setBlock(i, type);
                b.placed++;

                if (wanted.get(i) === type && !filled.has(i)) {
                    filled.add(i);
                    b.correct++;
                    player.score += 10;
                    room.emit('fit', { by: player.id, x, y, z, pct: progressPct() });
                } else {
                    player.score += 1;
                }
                room.emit('place', { by: player.id, x, y, z, b: type });
            }
        },

        tick(dt) {
            for (const [id, b] of bodies) {
                // Movement is camera-relative: the client sends its yaw, the server
                // decides where that actually puts you.
                const sin = Math.sin(b.yaw);
                const cos = Math.cos(b.yaw);
                const mx = (b.ax * cos - b.az * sin) * SPEED;
                const mz = (b.ax * sin + b.az * cos) * SPEED;

                if (!blocked(b.x + mx * dt, b.y, b.z)) b.x += mx * dt;
                if (!blocked(b.x, b.y, b.z + mz * dt)) b.z += mz * dt;

                if (b.grounded && b.jump) { b.vy = JUMP; b.grounded = false; }
                b.vy = Math.max(-40, b.vy + GRAVITY * dt);
                const ny = b.y + b.vy * dt;
                if (!blocked(b.x, ny, b.z)) {
                    b.y = ny;
                    b.grounded = false;
                } else if (b.vy <= 0) {
                    b.y = Math.floor(ny) + 1;     // rest on top of whatever stopped us
                    b.vy = 0;
                    b.grounded = true;
                } else {
                    b.vy = 0;                     // clipped a ceiling
                }

                // Clamp inside the island rather than letting anyone walk off the edge.
                b.x = Math.max(worldX(0) - 0.4, Math.min(worldX(W - 1) + 0.4, b.x));
                b.z = Math.max(worldZ(0) - 0.4, Math.min(worldZ(D - 1) + 0.4, b.z));
                if (b.y < -8) bodies.set(id, spawn(b.slot));
            }
        },

        onJoin(player) { bodyOf(player); },
        onLeave(player) { bodies.delete(player.id); },

        snapshot() {
            const out = {
                tl: r2(room.timeLeft()),
                pct: progressPct(),
                p: [...room.players.values()].map((p) => {
                    const b = bodyOf(p);
                    return [p.slot, r2(b.x), r2(b.y), r2(b.z), r2(b.yaw)];
                }),
            };
            // Block changes ride along as a flat [index, type, index, type, ...] list
            // and are cleared once sent; a quiet tick carries none at all.
            if (changes.length) { out.c = changes; changes = []; }
            return out;
        },

        fullState() {
            // The terrain itself is regenerated client-side from the seed. Only the
            // blocks that differ from it travel, which on a fresh round is none.
            const diff = [];
            const { cells: pristine } = generateWorld(room.seed);
            for (let i = 0; i < cells.length; i++) {
                if (cells[i] !== pristine[i]) diff.push(i, cells[i]);
            }
            return {
                shape: blueprint.shape,
                bp: blueprint.cells,
                filled: [...filled],
                diff,
                pct: progressPct(),
            };
        },

        isOver() { return wanted.size > 0 && filled.size >= wanted.size; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const b = bodyOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${b.correct} on the blueprint, ${b.placed} placed, ${b.mined} mined`,
                    };
                });
        },

        familyScore() { return progressPct(); },

        dispose() { bodies.clear(); wanted.clear(); filled.clear(); },
    };

    function progressPct() {
        return wanted.size ? Math.round((filled.size / wanted.size) * 100) : 0;
    }
}
