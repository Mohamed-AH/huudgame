/**
 * The authoritative game catalogue.
 *
 * Every module here is imported once at boot so the lobby can list real metadata,
 * and so a broken game announces itself in the server log instead of at the moment
 * fourteen people are waiting for a round to start. A module that throws is skipped
 * rather than taking the arcade down with it.
 *
 * To add a game: write `<id>.js` next to this file exporting `meta` and `create`,
 * then add its id to GAME_IDS. Add the matching client module in the same commit -
 * `npm run verify` fails if the two registries disagree.
 */

const GAME_IDS = [
    'guess-number',
    'voxel-sandbox',
    'car-race',
    'mango-target',
    'baking-kitchen',
    'ice-cream',
    'train-race',
    'baby-cleaning',
    'bus-cleaning',
    'coin-cars',
    'guess-animal',
    'science-lab',
    'barber-shop',
];

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const modules = new Map();
const metas = [];

for (const id of GAME_IDS) {
    if (!existsSync(join(HERE, `${id}.js`))) continue;   // listed but not built yet
    try {
        const mod = await import(`./${id}.js`);
        if (!mod.meta || !mod.create) throw new Error('module must export `meta` and `create`');
        if (mod.meta.id !== id) throw new Error(`meta.id "${mod.meta.id}" does not match filename "${id}"`);
        modules.set(id, mod);
        metas.push(mod.meta);
    } catch (err) {
        console.error(`[registry] skipping game "${id}": ${err.message}`);
    }
}

export function listGames() {
    return metas;
}

export function getMeta(id) {
    return modules.get(id)?.meta ?? null;
}

export async function loadGame(id) {
    const mod = modules.get(id);
    if (!mod) throw new Error(`unknown game "${id}"`);
    return mod;
}
