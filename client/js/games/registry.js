/**
 * The client catalogue: everything the lobby needs to draw a tile, plus a lazy loader
 * for the game module itself.
 *
 * This file holds *presentation* metadata (blurb, emoji, controls text) while the
 * server registry holds *rules* metadata (tick rate, round length, player counts).
 * They are genuinely different data; `npm run verify` keeps the id lists in step.
 *
 * Nothing here imports a game module at load time - the lobby must paint on a phone
 * before a megabyte of scene-building code is fetched.
 */

export const GAMES = [
    {
        id: 'guess-number', title: 'Guess a Number', emoji: '🔢',
        blurb: 'Crack the vault. Higher, lower, hotter, colder.',
        controls: { touch: 'Tap the keypad', keyboard: 'Type digits, Enter to guess' },
    },
    {
        id: 'voxel-sandbox', title: 'Voxel Sandbox', emoji: '🧱',
        blurb: 'Mine and stack blocks together to match the build.',
        controls: { touch: 'Stick to move, tap to mine, hold to place', keyboard: 'WASD, Space, click' },
    },
    {
        id: 'car-race', title: 'Car Race', emoji: '🏎️',
        blurb: 'Three laps, four lanes, speed pads and oil.',
        controls: { touch: 'D-pad and gas', keyboard: 'WASD or arrows' },
    },
    {
        id: 'mango-target', title: 'Mango Target', emoji: '🥭',
        blurb: 'Drag, aim, throw. Golden mangoes are worth five.',
        controls: { touch: 'Drag to aim, release to throw', keyboard: 'Aim with the mouse, click' },
    },
    {
        id: 'baking-kitchen', title: 'Baking Kitchen', emoji: '🧁',
        blurb: 'Pass ingredients down the line before the orders burn.',
        controls: { touch: 'Stick to move, A to grab', keyboard: 'WASD and E' },
    },
    {
        id: 'ice-cream', title: 'Ice Cream Inc.', emoji: '🍦',
        blurb: 'Hold to swirl, stop on the line, add the topping.',
        controls: { touch: 'Hold the dispense button', keyboard: 'Hold Space, 1-4 for toppings' },
    },
    {
        id: 'train-race', title: 'Train Race', emoji: '🚂',
        blurb: 'Fourteen tracks. Mind the throttle, mind the boulders.',
        controls: { touch: 'Throttle and lane buttons', keyboard: 'Up/Down, Left/Right' },
    },
    {
        id: 'baby-cleaning', title: 'Baby Cleaning', emoji: '🧸',
        blurb: 'Toys in the right bins, stains off the floor, together.',
        controls: { touch: 'Stick to move, A to grab or scrub', keyboard: 'WASD and E' },
    },
    {
        id: 'bus-cleaning', title: 'Bus Cleaning', emoji: '🚌',
        blurb: 'Blast the grime off a very large bus. Everyone at once.',
        controls: { touch: 'Stick to move, drag to aim the hose', keyboard: 'WASD, mouse to aim, hold click' },
    },
    {
        id: 'coin-cars', title: 'Collecting Car Coins', emoji: '🪙',
        blurb: 'Grab coins. Bump the leader and watch them spill.',
        controls: { touch: 'Stick to steer', keyboard: 'WASD or arrows' },
    },
    {
        id: 'guess-animal', title: 'Guess Animal', emoji: '🦒',
        blurb: 'The silhouette fills in. Guess early, score more.',
        controls: { touch: 'Tap your answer', keyboard: 'Keys 1-4' },
    },
    {
        id: 'science-lab', title: 'Science Game', emoji: '🧪',
        blurb: 'Mix elements, hit the recipe, set off the reaction.',
        controls: { touch: 'Drag elements into the beaker', keyboard: 'Click and drag' },
    },
    {
        id: 'barber-shop', title: 'Barber Game', emoji: '💈',
        blurb: 'Trim, grow and dye a very silly head to match the card.',
        controls: { touch: 'Pick a tool, drag over the hair', keyboard: 'Pick a tool, drag with the mouse' },
    },
];

const byId = new Map(GAMES.map((g) => [g.id, g]));
const loaded = new Map();

export function listGames() {
    return GAMES;
}

export function getMeta(id) {
    return byId.get(id) ?? null;
}

export async function loadGame(id) {
    if (!byId.has(id)) throw new Error(`unknown game "${id}"`);
    if (!loaded.has(id)) loaded.set(id, import(`./${id}.js`));
    return loaded.get(id);
}
