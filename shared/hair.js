/**
 * The hair rig, shared so that strand N on the server is strand N on every client.
 *
 * Strands are placed with a Fibonacci distribution over the upper half of a sphere:
 * even coverage, no polar clumping, and - crucially - the same order every time from
 * nothing but an index, so the wire only ever has to carry lengths and colours.
 */

export const STRANDS = 108;
export const MAX_LENGTH = 1.0;
export const HEAD_RADIUS = 1.0;

export const HAIR_COLORS = [
    0x3b2417,   // 0 brown
    0x15120f,   // 1 black
    0xe6c35c,   // 2 blonde
    0xc0522d,   // 3 ginger
    0x4cc9f0,   // 4 blue
    0xf72585,   // 5 pink
    0x7bdc6b,   // 6 green
];

export const STYLES = ['buzz', 'bowl', 'mohawk', 'spikes', 'side part', 'afro'];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Direction of strand `i` on the unit sphere, restricted to the top of the head. */
export function strandDir(i) {
    // Map i into the upper 62% of the sphere, so no hair sprouts from the chin.
    const t = (i + 0.5) / STRANDS;
    const y = 1 - t * 0.62;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = GOLDEN * i;
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
}

/** The length style `name` wants at strand `i`, in 0..MAX_LENGTH. */
export function styleLength(name, i) {
    const d = strandDir(i);
    switch (name) {
        case 'buzz':      return 0.14;
        case 'bowl':      return d.y > 0.72 ? 0.62 : 0.30;
        case 'mohawk':    return Math.abs(d.x) < 0.26 ? 0.95 : 0.06;
        case 'spikes':    return i % 2 === 0 ? 0.82 : 0.18;
        case 'side part': return d.x > 0 ? 0.72 : 0.34;
        case 'afro':      return 0.78;
        default:          return 0.4;
    }
}

export function styleLengths(name) {
    const out = new Float32Array(STRANDS);
    for (let i = 0; i < STRANDS; i++) out[i] = styleLength(name, i);
    return out;
}

/**
 * How well a head matches a target, 0..1. Length is most of it; colour is a fifth,
 * because a perfect cut in the wrong colour is still recognisably the right haircut.
 */
export function matchScore(lengths, colors, targetLengths, targetColor) {
    let lengthError = 0;
    let colorHits = 0;
    for (let i = 0; i < STRANDS; i++) {
        lengthError += Math.abs(lengths[i] - targetLengths[i]);
        if (colors[i] === targetColor) colorHits++;
    }
    const lengthPart = Math.max(0, 1 - (lengthError / STRANDS) / 0.38);
    const colorPart = colorHits / STRANDS;
    return lengthPart * 0.8 + colorPart * 0.2;
}
