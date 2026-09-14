/**
 * Snapshot interpolation.
 *
 * The server ticks at 10-20Hz; screens refresh at 60-120Hz. Rendering the newest
 * snapshot directly makes 14 players stutter, so instead the client renders a fixed
 * delay in the past and blends between the two snapshots that straddle that moment.
 * The cost is `DEFAULT_DELAY_MS` of added latency; the gain is that everyone else's
 * car, cook or train moves smoothly over ordinary home wifi.
 */

const DEFAULT_DELAY_MS = 100;
const MAX_BUFFERED = 24;

export class SnapshotBuffer {
    constructor(delayMs = DEFAULT_DELAY_MS) {
        this.delayMs = delayMs;
        this.frames = [];          // [{ at, data }], oldest first
    }

    push(data) {
        this.frames.push({ at: performance.now(), data });
        if (this.frames.length > MAX_BUFFERED) this.frames.shift();
    }

    get latest() {
        return this.frames.length ? this.frames[this.frames.length - 1].data : null;
    }

    clear() { this.frames.length = 0; }

    /**
     * Returns `{ a, b, t }` - the snapshots either side of the render time and the
     * blend factor between them - or null while the buffer is still filling.
     * When the stream stalls, `a === b` and the scene simply holds its last pose
     * rather than extrapolating players into walls.
     */
    sample(now = performance.now()) {
        if (!this.frames.length) return null;
        const target = now - this.delayMs;

        if (this.frames.length === 1 || target <= this.frames[0].at) {
            const only = this.frames[0].data;
            return { a: only, b: only, t: 0 };
        }

        for (let i = this.frames.length - 1; i > 0; i--) {
            const b = this.frames[i];
            const a = this.frames[i - 1];
            if (target >= a.at && target <= b.at) {
                const span = b.at - a.at;
                return { a: a.data, b: b.data, t: span > 0 ? (target - a.at) / span : 1 };
            }
        }

        const newest = this.frames[this.frames.length - 1].data;
        return { a: newest, b: newest, t: 1 };
    }

    /** Drops frames older than the render window so a long round does not grow memory. */
    prune(now = performance.now()) {
        const cutoff = now - this.delayMs - 500;
        while (this.frames.length > 2 && this.frames[0].at < cutoff) this.frames.shift();
    }
}

export const lerp = (a, b, t) => a + (b - a) * t;

/** Angle-aware lerp - without it a car crossing PI spins the long way round. */
export function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

/** Frame-rate independent smoothing: `rate` is roughly "fraction closed per second". */
export const damp = (current, target, rate, dt) =>
    current + (target - current) * (1 - Math.exp(-rate * dt));

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
