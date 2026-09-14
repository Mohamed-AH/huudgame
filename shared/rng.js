/**
 * Deterministic RNG. The server seeds a round and ships the seed to every client, so
 * cosmetic randomness (tree placement, idle offsets, confetti angles) matches on all
 * 14 screens without a single extra byte on the wire.
 *
 * mulberry32: 32 bits of state, good enough distribution for scenery, and small
 * enough to read in one sitting.
 */
export function makeRng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));   // inclusive
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.shuffle = (arr) => {
        const out = arr.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(next() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    };
    return next;
}

export const randomSeed = () => (Math.random() * 0xffffffff) >>> 0;
