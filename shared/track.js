/**
 * The stadium circuit, shared by the server (which decides where cars are) and the
 * client (which builds the tarmac mesh). One definition, so the road you can see is
 * exactly the road you are allowed to drive on.
 *
 * The centreline is two straights at z = ±R joined by semicircles of radius R centred
 * at (±L/2, 0). Lap progress `p` runs from 0 at the start/finish line on the top
 * straight, clockwise when viewed from above.
 *
 *              p=0 ──────────────▶ p=L
 *        ┌───────────────────────────────┐
 *      ╭─┤                               ├─╮
 *      │ │            (0,0)              │ │   R
 *      ╰─┤                               ├─╯
 *        └───────────────────────────────┘
 *              p=2L+πR ◀────────── p=L+πR
 */

export const STRAIGHT = 46;        // L: length of each straight
export const RADIUS = 17;          // R: radius of each end loop
export const WIDTH = 13;           // full tarmac width - four generous lanes
export const LANES = 4;
export const LAPS = 3;
export const CHECKPOINTS = 8;      // crossed in order, or the lap does not count

export const LENGTH = 2 * STRAIGHT + 2 * Math.PI * RADIUS;   // P: one lap of centreline

const HALF_L = STRAIGHT / 2;
const ARC = Math.PI * RADIUS;

/** Centreline point and heading at lap progress `p` (wraps automatically). */
export function pointAt(p) {
    let t = ((p % LENGTH) + LENGTH) % LENGTH;

    if (t < STRAIGHT) {                                   // top straight, heading +x
        return { x: -HALF_L + t, z: RADIUS, hx: 1, hz: 0 };
    }
    t -= STRAIGHT;

    if (t < ARC) {                                        // right loop
        const a = Math.PI / 2 - t / RADIUS;
        return {
            x: HALF_L + Math.cos(a) * RADIUS,
            z: Math.sin(a) * RADIUS,
            hx: Math.sin(a), hz: -Math.cos(a),
        };
    }
    t -= ARC;

    if (t < STRAIGHT) {                                   // bottom straight, heading -x
        return { x: HALF_L - t, z: -RADIUS, hx: -1, hz: 0 };
    }
    t -= STRAIGHT;

    const a = -Math.PI / 2 - t / RADIUS;                   // left loop
    return {
        x: -HALF_L + Math.cos(a) * RADIUS,
        z: Math.sin(a) * RADIUS,
        hx: Math.sin(a), hz: -Math.cos(a),
    };
}

/** Lap progress of a world position, in the same units as `pointAt`. */
export function progressOf(x, z) {
    if (Math.abs(x) <= HALF_L) {
        return z >= 0
            ? x + HALF_L                                        // top straight
            : STRAIGHT + ARC + (HALF_L - x);                    // bottom straight
    }
    if (x > HALF_L) {
        const a = Math.atan2(z, x - HALF_L);                    // in [-pi/2, pi/2]
        return STRAIGHT + (Math.PI / 2 - a) * RADIUS;
    }
    let a = Math.atan2(z, x + HALF_L);                          // left loop
    if (a < 0) a += Math.PI * 2;                                // -> [pi/2, 3pi/2]
    return 2 * STRAIGHT + ARC + (Math.PI * 1.5 - a) * RADIUS;
}

/** How far off the centreline a position is. Beyond WIDTH/2 is off the tarmac. */
export function offsetOf(x, z) {
    if (Math.abs(x) <= HALF_L) return Math.abs(Math.abs(z) - RADIUS);
    const cx = x > 0 ? HALF_L : -HALF_L;
    return Math.abs(Math.hypot(x - cx, z) - RADIUS);
}

/** Starting grid: 14 cars in staggered rows behind the line, none of them touching. */
export function gridSlot(slot, count = 14) {
    const row = Math.floor(slot / 2);
    const side = slot % 2 === 0 ? -1 : 1;
    const p = LENGTH - 6 - row * 5.5;                         // behind the start line
    const point = pointAt(p);
    const nx = -point.hz;                                     // left-hand normal
    const nz = point.hx;
    const lateral = side * 3.2;
    return {
        x: point.x + nx * lateral,
        z: point.z + nz * lateral,
        heading: Math.atan2(point.hx, point.hz),
        p,
    };
}

/** Speed pads and oil slicks, placed identically on every client from the seed. */
export function hazards(rng) {
    const out = [];
    for (let i = 0; i < 9; i++) {
        const p = rng.range(8, LENGTH - 8);
        out.push({
            kind: rng() < 0.55 ? 'boost' : 'oil',
            p,
            lat: rng.range(-WIDTH / 2 + 2, WIDTH / 2 - 2),
        });
    }
    return out;
}
