import { r2 } from '../../../shared/protocol.js';
import {
    STRANDS, MAX_LENGTH, HAIR_COLORS, STYLES,
    strandDir, styleLengths, matchScore,
} from '../../../shared/hair.js';

export const meta = {
    id: 'barber-shop',
    title: 'Barber Game',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 10,
    roundSeconds: 130,
};

const TOOLS = ['clippers', 'spray', 'dye'];
const TRIM_RATE = 1.5;           // length removed per second at the centre of the tool
const GROW_RATE = 1.1;
const TOOL_RADIUS = 0.55;        // in unit-sphere direction space

/**
 * Barber Game — everyone gets a head of 108 hairs and a style to copy.
 *
 * The whole game is one array of lengths per player. The client sends where on the
 * scalp it is working and which tool it is holding; the server decides which strands
 * that touches and by how much, then scores the head against the target style.
 *
 * Only strands that actually changed go out each tick, so a dozen barbers working at
 * once costs a few dozen numbers rather than fourteen full heads.
 */
export function create(room) {
    const chairs = new Map();
    let changes = [];

    function chairOf(player) {
        let c = chairs.get(player.id);
        if (!c) {
            const style = room.rng.pick(STYLES);
            c = {
                slot: player.slot,
                lengths: new Float32Array(STRANDS).fill(0.45),
                colors: new Uint8Array(STRANDS),
                tool: 0,
                dye: 0,
                style,
                target: styleLengths(style),
                targetColor: room.rng.int(0, HAIR_COLORS.length - 1),
                strokes: 0,
            };
            // Everybody starts with the same shaggy mop in a random natural colour, so
            // the first thing anyone has to do is decide what to cut.
            c.colors.fill(room.rng.int(0, 3));
            chairs.set(player.id, c);
        }
        return c;
    }

    const accuracyOf = (c) => matchScore(c.lengths, c.colors, c.target, c.targetColor);

    return {
        start() {
            for (const p of room.players.values()) chairOf(p);
        },

        onAction(player, msg) {
            const c = chairOf(player);

            if (msg.a === 'tool') {
                const t = msg.t | 0;
                if (t >= 0 && t < TOOLS.length) c.tool = t;
                return;
            }
            if (msg.a === 'dye') {
                const d = msg.d | 0;
                if (d >= 0 && d < HAIR_COLORS.length) c.dye = d;
                return;
            }
            if (msg.a !== 'stroke') return;

            // The client sends a point on the unit sphere it is working over. Anything
            // that is not a direction is ignored rather than trusted.
            const x = Number(msg.x);
            const y = Number(msg.y);
            const z = Number(msg.z);
            if (![x, y, z].every(Number.isFinite)) return;
            const len = Math.hypot(x, y, z) || 1;
            const dt = Math.min(0.25, Math.max(0.01, Number(msg.dt) || 0.1));
            c.strokes++;

            for (let i = 0; i < STRANDS; i++) {
                const d = strandDir(i);
                const dist = Math.hypot(d.x - x / len, d.y - y / len, d.z - z / len);
                if (dist > TOOL_RADIUS) continue;

                // Falloff, so the edge of the tool feathers instead of cutting a disc.
                const power = 1 - (dist / TOOL_RADIUS) * 0.7;
                const before = c.lengths[i];
                const beforeColor = c.colors[i];

                if (c.tool === 0) c.lengths[i] = Math.max(0, before - TRIM_RATE * power * dt);
                else if (c.tool === 1) c.lengths[i] = Math.min(MAX_LENGTH, before + GROW_RATE * power * dt);
                else if (dist < TOOL_RADIUS * 0.85) c.colors[i] = c.dye;

                if (c.lengths[i] !== before || c.colors[i] !== beforeColor) {
                    changes.push(c.slot, i, r2(c.lengths[i]), c.colors[i]);
                }
            }

            player.score = Math.round(accuracyOf(c) * 100);
        },

        tick() { /* barbering is entirely driven by strokes */ },

        onJoin(player) { chairOf(player); },
        onLeave(player) { chairs.delete(player.id); },

        snapshot() {
            const out = {
                tl: r2(room.timeLeft()),
                p: [...room.players.values()].map((p) => {
                    const c = chairOf(p);
                    return [p.slot, c.tool, c.dye, Math.round(accuracyOf(c) * 100)];
                }),
            };
            if (changes.length) { out.c = changes; changes = []; }
            return out;
        },

        fullState(player) {
            const mine = player ? chairOf(player) : null;
            return {
                strands: STRANDS,
                colors: HAIR_COLORS,
                tools: TOOLS,
                maxLength: MAX_LENGTH,
                // Every head in the shop, so late joiners see the room as it stands.
                heads: [...room.players.values()].map((p) => {
                    const c = chairOf(p);
                    return { slot: c.slot, lengths: [...c.lengths].map(r2), colors: [...c.colors] };
                }),
                // Your own brief only. Everyone is cutting to a different card.
                style: mine?.style ?? null,
                target: mine ? [...mine.target].map(r2) : null,
                targetColor: mine?.targetColor ?? 0,
            };
        },

        isOver() { return false; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const c = chairOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${Math.round(accuracyOf(c) * 100)}% ${c.style}`,
                    };
                });
        },

        dispose() { chairs.clear(); changes = []; },
    };
}
