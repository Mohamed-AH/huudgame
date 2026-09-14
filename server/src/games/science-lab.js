import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'science-lab',
    title: 'Science Game',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 8,
    roundSeconds: 130,
};

export const ELEMENTS = [
    { sym: 'H',  name: 'Hydrogen', color: 0x8ecae6 },
    { sym: 'O',  name: 'Oxygen',   color: 0xffffff },
    { sym: 'C',  name: 'Carbon',   color: 0x4b4b55 },
    { sym: 'Na', name: 'Sodium',   color: 0xffd166 },
    { sym: 'Fe', name: 'Iron',     color: 0xb06a3c },
    { sym: 'S',  name: 'Sulfur',   color: 0xf4e04d },
    { sym: 'N',  name: 'Nitrogen', color: 0x9b5de5 },
    { sym: 'Cl', name: 'Chlorine', color: 0x7bdc6b },
];

/** Every reaction is a multiset of element indices. Key order never matters. */
export const RECIPES = [
    { parts: [0, 1],    name: 'Water Splash',   kind: 'bubbles', color: 0x4cc9f0, pts: 60 },
    { parts: [2, 1],    name: 'Smoke Puff',     kind: 'smoke',   color: 0x9aa3b2, pts: 60 },
    { parts: [3, 7],    name: 'Salt Crystals',  kind: 'glow',    color: 0xf3f4f6, pts: 70 },
    { parts: [5, 4],    name: 'Volcano',        kind: 'volcano', color: 0xef476f, pts: 110 },
    { parts: [6, 0],    name: 'Floaty Bubbles', kind: 'bubbles', color: 0xc77dff, pts: 100 },
    { parts: [4, 1],    name: 'Rust Sparks',    kind: 'sparks',  color: 0xff9f1c, pts: 80 },
    { parts: [7, 1],    name: 'Green Cloud',    kind: 'smoke',   color: 0x7bdc6b, pts: 85 },
    { parts: [3, 0],    name: 'Fizzy Bang',     kind: 'sparks',  color: 0xffd166, pts: 90 },
    { parts: [2, 5, 1], name: 'Rocket Flame',   kind: 'volcano', color: 0xff5d5d, pts: 130 },
    { parts: [0, 0, 1], name: 'Steam Geyser',   kind: 'volcano', color: 0x8ecae6, pts: 120 },
];

const BEAKER_SIZE = 3;
const FIZZLE_MS = 1200;

const keyOf = (parts) => [...parts].sort((a, b) => a - b).join('.');
const RECIPE_BY_KEY = new Map(RECIPES.map((r, i) => [keyOf(r.parts), { ...r, index: i }]));

/**
 * Science Game — fourteen lab benches, one wall of reactions.
 *
 * Everybody has their own bench and their own order card, so nobody queues. Making
 * *your* reaction is worth full marks and making somebody else's is worth half, which
 * means experimenting is always better than standing still - the mistake a chemistry
 * game usually makes is punishing curiosity.
 *
 * Every successful mix fires on the central display for the whole room, so fourteen
 * people working in parallel still feel like one lab.
 */
export function create(room) {
    const benches = new Map();

    function benchOf(player) {
        let b = benches.get(player.id);
        if (!b) {
            b = { slot: player.slot, beaker: [], card: room.rng.int(0, RECIPES.length - 1), fizzleUntil: 0, made: 0, exact: 0 };
            benches.set(player.id, b);
        }
        return b;
    }

    function newCard(b) {
        let next = room.rng.int(0, RECIPES.length - 1);
        if (next === b.card) next = (next + 1) % RECIPES.length;   // never the same twice
        b.card = next;
    }

    return {
        start() {
            for (const p of room.players.values()) benchOf(p);
        },

        onAction(player, msg) {
            const b = benchOf(player);
            const now = Date.now();
            if (now < b.fizzleUntil) return;

            if (msg.a === 'add') {
                const e = msg.e | 0;
                if (e < 0 || e >= ELEMENTS.length) return;
                if (b.beaker.length >= BEAKER_SIZE) return;
                b.beaker.push(e);
                room.emit('add', { by: player.id, slot: b.slot, e });
                return;
            }

            if (msg.a === 'clear') {
                b.beaker = [];
                room.emit('clear', { by: player.id, slot: b.slot });
                return;
            }

            if (msg.a !== 'mix' || b.beaker.length < 2) return;

            const recipe = RECIPE_BY_KEY.get(keyOf(b.beaker));
            b.beaker = [];

            if (!recipe) {
                b.fizzleUntil = now + FIZZLE_MS;
                room.emit('fizzle', { by: player.id, slot: b.slot });
                return;
            }

            const exact = recipe.index === b.card;
            const points = exact ? recipe.pts : Math.round(recipe.pts * 0.5);
            player.score += points;
            b.made++;
            if (exact) { b.exact++; newCard(b); }

            room.emit('react', {
                by: player.id, slot: b.slot,
                r: recipe.index, name: recipe.name, kind: recipe.kind, color: recipe.color,
                pts: points, exact: exact ? 1 : 0,
            });
        },

        tick() { /* nothing ticks here - this game is entirely event-driven */ },

        onJoin(player) { benchOf(player); },
        onLeave(player) { benches.delete(player.id); },

        snapshot() {
            const now = Date.now();
            return {
                tl: r2(room.timeLeft()),
                // [slot, card, fizzling, ...up to three element indices]
                p: [...room.players.values()].map((p) => {
                    const b = benchOf(p);
                    return [p.slot, b.card, now < b.fizzleUntil ? 1 : 0, ...b.beaker];
                }),
            };
        },

        fullState() {
            return {
                elements: ELEMENTS,
                // Recipes travel in full: this is a game about *learning* the table,
                // and hiding it would just mean fourteen people guessing at random.
                recipes: RECIPES.map((r, i) => ({ i, name: r.name, parts: r.parts, kind: r.kind, color: r.color, pts: r.pts })),
                beakerSize: BEAKER_SIZE,
            };
        },

        isOver() { return false; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const b = benchOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${b.made} reactions, ${b.exact} to order`,
                    };
                });
        },

        dispose() { benches.clear(); },
    };
}
