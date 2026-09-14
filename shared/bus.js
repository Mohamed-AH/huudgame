/**
 * The bus, as an axis-aligned box, plus the grime grid wrapped over three of its
 * faces. Shared so the server's authoritative spray and the client's aim reticle
 * agree about exactly which panel a jet is pointed at.
 */

export const BUS = { x0: -13, x1: 13, y0: 0.6, y1: 7.0, z0: -3.2, z1: 3.2 };
export const COLS = 22;
export const ROWS = 6;
export const FACES = ['left', 'right', 'roof'];      // face index 0, 1, 2
export const CELLS_PER_FACE = COLS * ROWS;
export const TOTAL_CELLS = CELLS_PER_FACE * FACES.length;

export const SPRAY_RANGE = 16;
export const SPRAY_RADIUS = 1.45;

export const cellIndex = (face, c, r) => face * CELLS_PER_FACE + c * ROWS + r;

/** Width and height of one grime cell on a given face. */
export function cellSize(face) {
    return {
        w: (BUS.x1 - BUS.x0) / COLS,
        h: face === 2 ? (BUS.z1 - BUS.z0) / ROWS : (BUS.y1 - BUS.y0) / ROWS,
    };
}

/** World-space centre of a grime cell, and the face normal it sits on. */
export function cellCenter(face, c, r) {
    const { w, h } = cellSize(face);
    const x = BUS.x0 + (c + 0.5) * w;
    if (face === 2) return { x, y: BUS.y1, z: BUS.z0 + (r + 0.5) * h, nx: 0, ny: 1, nz: 0 };
    const y = BUS.y0 + (r + 0.5) * h;
    return face === 0
        ? { x, y, z: BUS.z0, nx: 0, ny: 0, nz: -1 }
        : { x, y, z: BUS.z1, nx: 0, ny: 0, nz: 1 };
}

/**
 * Slab-method ray/box intersection. Returns the nearest hit and which grime face it
 * landed on, or null when the jet misses the bus or strikes an end cap (which carries
 * no grime).
 */
export function castAtBus(ox, oy, oz, dx, dy, dz, range = SPRAY_RANGE) {
    let tmin = 0;
    let tmax = range;
    const axes = [
        [ox, dx, BUS.x0, BUS.x1],
        [oy, dy, BUS.y0, BUS.y1],
        [oz, dz, BUS.z0, BUS.z1],
    ];
    for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-6) {
            if (o < lo || o > hi) return null;
            continue;
        }
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
    }

    const hx = ox + dx * tmin;
    const hy = oy + dy * tmin;
    const hz = oz + dz * tmin;
    const eps = 0.06;

    if (Math.abs(hz - BUS.z0) < eps) return { face: 0, hx, hy, hz, t: tmin };
    if (Math.abs(hz - BUS.z1) < eps) return { face: 1, hx, hy, hz, t: tmin };
    if (Math.abs(hy - BUS.y1) < eps) return { face: 2, hx, hy, hz, t: tmin };
    return null;
}
