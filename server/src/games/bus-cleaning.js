import { r2 } from '../../../shared/protocol.js';
import {
    BUS, COLS, ROWS, FACES, CELLS_PER_FACE, TOTAL_CELLS,
    SPRAY_RADIUS, castAtBus, cellSize,
} from '../../../shared/bus.js';

export const meta = {
    id: 'bus-cleaning',
    title: 'Bus Cleaning',
    mode: 'coop',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 15,
    roundSeconds: 150,
};

const SPEED = 7.0;
const SPRAY_POWER = 2.6;         // grime removed per second at the centre of the jet

/**
 * Bus Cleaning — one very large, very dirty bus and up to 14 pressure washers.
 *
 * Aim is resolved on the server: the client sends where it is pointing, the server
 * casts that ray at the bus box itself, works out which panel it struck and scrubs
 * the grime cells around the hit. A client can therefore no more clean a panel it is
 * not pointing at than it can score a goal by saying so.
 *
 * Only the cells that actually changed go out each tick, which is what keeps a
 * 396-cell grid affordable at fifteen ticks a second across fourteen sockets.
 */
export function create(room) {
    // Grime strength per cell: 1 is a light film, 2 is caked on. Front and rear panels
    // of each side start dirtiest, because that is where a bus actually gets filthy.
    const grime = new Float32Array(TOTAL_CELLS);
    for (let f = 0; f < FACES.length; f++) {
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                const edge = Math.min(c, COLS - 1 - c) / (COLS / 2);
                const base = 1.15 + (1 - edge) * 0.7 + room.rng.range(-0.15, 0.3);
                grime[f * CELLS_PER_FACE + c * ROWS + r] = Math.max(0.5, Math.min(2, base));
            }
        }
    }
    const initialTotal = grime.reduce((a, b) => a + b, 0);

    const crew = new Map();
    let changes = [];
    let cleanedCells = 0;

    function washerOf(player) {
        let w = crew.get(player.id);
        if (!w) {
            // Spread the family down both sides of the bus rather than in one scrum.
            const side = player.slot % 2 === 0 ? -1 : 1;
            w = {
                slot: player.slot,
                x: -11 + Math.floor(player.slot / 2) * 3.3,
                z: side * 8.5,
                rot: side < 0 ? 0 : Math.PI,
                ax: 0, az: 0,
                yaw: side < 0 ? 0 : Math.PI,
                pitch: 0.15,
                spraying: false,
                cleaned: 0,
            };
            crew.set(player.id, w);
        }
        return w;
    }

    const cleanPct = () => {
        const left = grime.reduce((a, b) => a + b, 0);
        return Math.round((1 - left / initialTotal) * 100);
    };

    /** Scrubs the cells around a hit point and records what changed. */
    function scrub(w, hit, dt, player) {
        const { w: cellW, h: cellH } = cellSize(hit.face);
        const along = hit.hx;
        const across = hit.face === 2 ? hit.hz : hit.hy;
        const acrossBase = hit.face === 2 ? BUS.z0 : BUS.y0;

        const cReach = Math.ceil(SPRAY_RADIUS / cellW);
        const rReach = Math.ceil(SPRAY_RADIUS / cellH);
        const cHit = Math.floor((along - BUS.x0) / cellW);
        const rHit = Math.floor((across - acrossBase) / cellH);

        for (let c = cHit - cReach; c <= cHit + cReach; c++) {
            if (c < 0 || c >= COLS) continue;
            for (let r = rHit - rReach; r <= rHit + rReach; r++) {
                if (r < 0 || r >= ROWS) continue;
                const cx = BUS.x0 + (c + 0.5) * cellW;
                const cy = acrossBase + (r + 0.5) * cellH;
                const d = Math.hypot(cx - along, cy - across);
                if (d > SPRAY_RADIUS) continue;

                const index = hit.face * CELLS_PER_FACE + c * ROWS + r;
                if (grime[index] <= 0) continue;

                // Falls off toward the edge of the jet, so sweeping beats hovering.
                const power = SPRAY_POWER * dt * (1 - (d / SPRAY_RADIUS) * 0.65);
                const before = grime[index];
                grime[index] = Math.max(0, before - power);
                changes.push(index, r2(grime[index]));

                const removed = before - grime[index];
                w.cleaned += removed;
                player.score += removed * 14;
                if (before > 0 && grime[index] === 0) cleanedCells++;
            }
        }
    }

    return {
        start() {
            for (const p of room.players.values()) washerOf(p);
        },

        onInput(player, msg) {
            const w = washerOf(player);
            w.ax = Math.max(-1, Math.min(1, Number(msg.ax) || 0));
            w.az = Math.max(-1, Math.min(1, Number(msg.ay) || 0));
            if (Number.isFinite(msg.yw)) w.yaw = msg.yw;
            if (Number.isFinite(msg.pt)) w.pitch = Math.max(-0.5, Math.min(1.2, msg.pt));
            w.spraying = !!msg.h;
        },

        tick(dt) {
            for (const [id, w] of crew) {
                const len = Math.hypot(w.ax, w.az) || 1;
                const scale = Math.min(1, len);
                w.x += (w.ax / len) * scale * SPEED * dt;
                w.z += (-w.az / len) * scale * SPEED * dt;
                w.x = Math.max(-22, Math.min(22, w.x));
                w.z = Math.max(-14, Math.min(14, w.z));

                // Nobody walks through the bus. Push out along whichever axis is the
                // shallower overlap, which keeps a player hugging the panel they are
                // washing instead of being flung to the far side.
                if (w.x > BUS.x0 - 1 && w.x < BUS.x1 + 1 && w.z > BUS.z0 - 1 && w.z < BUS.z1 + 1) {
                    const dx = w.x < 0 ? BUS.x0 - 1 - w.x : BUS.x1 + 1 - w.x;
                    const dz = w.z < 0 ? BUS.z0 - 1 - w.z : BUS.z1 + 1 - w.z;
                    if (Math.abs(dz) <= Math.abs(dx)) w.z += dz;
                    else w.x += dx;
                }
                if (Math.abs(w.ax) + Math.abs(w.az) > 0.05) w.rot = Math.atan2(w.ax, -w.az);

                if (!w.spraying) continue;
                const player = room.players.get(id);
                if (!player) continue;

                const dx = Math.sin(w.yaw) * Math.cos(w.pitch);
                const dy = Math.sin(w.pitch);
                const dz = Math.cos(w.yaw) * Math.cos(w.pitch);
                const hit = castAtBus(w.x, 1.6, w.z, dx, dy, dz);
                if (hit) scrub(w, hit, dt, player);
            }
        },

        onJoin(player) { washerOf(player); },
        onLeave(player) { crew.delete(player.id); },

        snapshot() {
            const out = {
                tl: r2(room.timeLeft()),
                pct: cleanPct(),
                p: [...room.players.values()].map((p) => {
                    const w = washerOf(p);
                    return [p.slot, r2(w.x), r2(w.z), r2(w.rot), r2(w.yaw), r2(w.pitch), w.spraying ? 1 : 0];
                }),
            };
            if (changes.length) { out.c = changes; changes = []; }
            return out;
        },

        fullState() {
            return {
                bus: BUS, cols: COLS, rows: ROWS, faces: FACES,
                grime: [...grime].map(r2),
                pct: cleanPct(),
            };
        },

        isOver() { return cleanPct() >= 100; },

        familyScore() { return cleanPct(); },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const w = washerOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${Math.round((w.cleaned / initialTotal) * 100)}% of the bus`,
                    };
                });
        },

        dispose() { crew.clear(); changes = []; },
    };
}
