import { makeRng } from './rng.js';

/**
 * The voxel world, shared verbatim by the server and the client.
 *
 * Both sides generate the *same* terrain from the round seed, so the opening world
 * costs zero bytes on the wire - only the blocks players actually change are ever
 * sent. That is what makes a 9408-cell world affordable on a phone over home wifi.
 *
 * Any change to the generator changes it on both sides at once, which is exactly why
 * it lives here and not in either half.
 */

export const W = 28;    // x
export const H = 12;    // y
export const D = 28;    // z
export const CELLS = W * H * D;

export const AIR = 0;

/** Block palette. Index is the wire value; the client reads `color` and nothing else. */
export const BLOCKS = [
    { id: 0, name: 'air',   color: 0x000000 },
    { id: 1, name: 'grass', color: 0x4f9d4a },
    { id: 2, name: 'dirt',  color: 0x8d6a4a },
    { id: 3, name: 'stone', color: 0x7a8291 },
    { id: 4, name: 'wood',  color: 0xb07a3c },
    { id: 5, name: 'leaf',  color: 0x2f7d52 },
    { id: 6, name: 'gold',  color: 0xffb703 },
];

/** The six types a player can hold. Air is not one of them - mining is how you remove. */
export const PALETTE = [1, 2, 3, 4, 5, 6];

export const idx = (x, y, z) => (y * D + z) * W + x;
export const xOf = (i) => i % W;
export const yOf = (i) => Math.floor(i / (W * D));
export const zOf = (i) => Math.floor(i / W) % D;

export const inBounds = (x, y, z) =>
    x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D;

/** World coordinates put the grid's centre at the origin, so the camera rig is simple. */
export const worldX = (x) => x - W / 2 + 0.5;
export const worldZ = (z) => z - D / 2 + 0.5;
export const gridX = (wx) => Math.floor(wx + W / 2);
export const gridZ = (wz) => Math.floor(wz + D / 2);

export function generateWorld(seed) {
    const rng = makeRng(seed);
    const cells = new Uint8Array(CELLS);

    // A gently rolling three-layer island. Deterministic trig plus one seeded jitter
    // per column - enough variety that no two rounds look identical, cheap enough that
    // a phone can run the same loop without anybody noticing.
    const heights = new Uint8Array(W * D);
    for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
            const roll = Math.sin(x * 0.34) * Math.cos(z * 0.29) * 1.6
                       + Math.sin((x + z) * 0.17) * 0.9;
            const jitter = rng() < 0.12 ? 1 : 0;
            heights[z * W + x] = Math.max(2, Math.min(6, Math.round(3 + roll + jitter)));
        }
    }

    for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
            const top = heights[z * W + x];
            for (let y = 0; y <= top; y++) {
                cells[idx(x, y, z)] = y === top ? 1 : y >= top - 1 ? 2 : 3;
            }
        }
    }

    // A handful of trees for scale and for something to mine that is not the floor.
    for (let n = 0; n < 10; n++) {
        const x = rng.int(3, W - 4);
        const z = rng.int(3, D - 4);
        const base = heights[z * W + x] + 1;
        if (base + 4 >= H) continue;
        for (let y = base; y < base + 3; y++) cells[idx(x, y, z)] = 4;
        for (let dy = 2; dy <= 3; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const ly = base + dy;
                    if (!inBounds(x + dx, ly, z + dz) || (dx === 0 && dz === 0 && dy === 2)) continue;
                    if (cells[idx(x + dx, ly, z + dz)] === AIR) cells[idx(x + dx, ly, z + dz)] = 5;
                }
            }
        }
    }

    return { cells, heights };
}

/**
 * The family's build target: a floating outline everyone fills in together. Three
 * shapes keep the round from feeling like the same chore twice.
 */
export function generateBlueprint(seed, heights) {
    const rng = makeRng(seed ^ 0x5bd1e995);
    const shape = rng.pick(['tower', 'house', 'arch']);
    const cx = Math.floor(W / 2);
    const cz = Math.floor(D / 2);
    const baseY = Math.min(H - 6, (heights?.[cz * W + cx] ?? 4) + 1);
    const cells = [];
    const add = (x, y, z, b) => { if (inBounds(x, y, z)) cells.push({ x, y, z, b }); };

    if (shape === 'tower') {
        for (let y = 0; y < 5; y++) {
            const r = y < 4 ? 2 : 1;
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    const edge = Math.abs(dx) === r || Math.abs(dz) === r;
                    if (edge) add(cx + dx, baseY + y, cz + dz, y === 4 ? 6 : 3);
                }
            }
        }
    } else if (shape === 'house') {
        for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) {
                const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
                const doorway = dz === 3 && Math.abs(dx) <= 1;
                for (let y = 0; y < 3; y++) {
                    if (edge && !(doorway && y < 2)) add(cx + dx, baseY + y, cz + dz, 4);
                }
                add(cx + dx, baseY + 3, cz + dz, Math.abs(dx) + Math.abs(dz) <= 2 ? 6 : 5);
            }
        }
    } else {
        for (let y = 0; y < 5; y++) {
            for (const side of [-3, 3]) {
                if (y < 4) { add(cx + side, baseY + y, cz, 3); add(cx + side, baseY + y, cz + 1, 3); }
            }
        }
        for (let dx = -3; dx <= 3; dx++) {
            add(cx + dx, baseY + 4, cz, 6);
            add(cx + dx, baseY + 4, cz + 1, 6);
        }
    }

    return { shape, cells, baseY };
}
