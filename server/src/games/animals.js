/**
 * The animal table. This file lives under `server/` and is deliberately NOT in
 * `shared/`, because `shared/` is served to browsers.
 *
 * The client has to be able to draw the animal in order to reveal it, so it receives
 * the *shape* - a bag of proportions - and never the name. Nothing on the client maps
 * a silhouette back to an answer, which is as close to cheat-proof as a game whose
 * whole point is showing you the answer slowly can get.
 */

export const ANIMALS = [
    {
        name: 'Giraffe', color: 0xe8b04b,
        body: [1.5, 1.4, 2.8], legLen: 2.1, legThick: 0.28,
        neck: [2.6, 0.42], head: [0.55, 0.5, 1.0], snout: [0.3, 0.3],
        ears: 'small', tail: 'thin', horns: 2, mane: false,
    },
    {
        name: 'Elephant', color: 0x9aa3b2,
        body: [2.4, 2.2, 3.4], legLen: 1.5, legThick: 0.6,
        neck: [0.5, 0.9], head: [1.3, 1.2, 1.3], snout: [1.9, 0.32],
        ears: 'huge', tail: 'thin', horns: 0, mane: false,
    },
    {
        name: 'Lion', color: 0xd99b3c,
        body: [1.5, 1.3, 2.4], legLen: 1.0, legThick: 0.34,
        neck: [0.5, 0.6], head: [0.85, 0.8, 0.9], snout: [0.45, 0.4],
        ears: 'round', tail: 'bushy', horns: 0, mane: true,
    },
    {
        name: 'Rabbit', color: 0xe8e1d5,
        body: [0.9, 0.9, 1.2], legLen: 0.42, legThick: 0.22,
        neck: [0.18, 0.42], head: [0.6, 0.6, 0.7], snout: [0.2, 0.3],
        ears: 'long', tail: 'puff', horns: 0, mane: false,
    },
    {
        name: 'Horse', color: 0x7a5230,
        body: [1.3, 1.4, 2.7], legLen: 1.6, legThick: 0.28,
        neck: [1.2, 0.5], head: [0.55, 0.6, 1.1], snout: [0.35, 0.34],
        ears: 'small', tail: 'bushy', horns: 0, mane: true,
    },
    {
        name: 'Cow', color: 0xf0ece6,
        body: [1.6, 1.5, 2.8], legLen: 1.2, legThick: 0.32,
        neck: [0.5, 0.6], head: [0.7, 0.7, 1.0], snout: [0.4, 0.5],
        ears: 'small', tail: 'thin', horns: 2, mane: false,
    },
    {
        name: 'Penguin', color: 0x22262e,
        body: [1.0, 1.9, 0.9], legLen: 0.3, legThick: 0.2,
        neck: [0.1, 0.5], head: [0.7, 0.7, 0.7], snout: [0.45, 0.16],
        ears: 'none', tail: 'none', horns: 0, mane: false,
    },
    {
        name: 'Crocodile', color: 0x4f7a3a,
        body: [1.4, 0.7, 3.6], legLen: 0.32, legThick: 0.26,
        neck: [0.2, 0.5], head: [0.7, 0.4, 1.2], snout: [1.2, 0.34],
        ears: 'none', tail: 'long', horns: 0, mane: false,
    },
    {
        name: 'Monkey', color: 0x6b4a2f,
        body: [0.9, 1.1, 1.0], legLen: 0.7, legThick: 0.2,
        neck: [0.2, 0.38], head: [0.62, 0.6, 0.62], snout: [0.25, 0.3],
        ears: 'round', tail: 'long', horns: 0, mane: false,
    },
    {
        name: 'Owl', color: 0x8d6a4a,
        body: [1.1, 1.3, 0.9], legLen: 0.28, legThick: 0.18,
        neck: [0.05, 0.6], head: [1.0, 0.85, 0.8], snout: [0.22, 0.16],
        ears: 'tuft', tail: 'none', horns: 0, mane: false,
    },
    {
        name: 'Pig', color: 0xf0a8b8,
        body: [1.3, 1.2, 2.0], legLen: 0.6, legThick: 0.28,
        neck: [0.2, 0.6], head: [0.7, 0.65, 0.8], snout: [0.42, 0.42],
        ears: 'flop', tail: 'curl', horns: 0, mane: false,
    },
    {
        name: 'Camel', color: 0xd9b382,
        body: [1.4, 1.6, 2.9], legLen: 1.9, legThick: 0.26,
        neck: [1.5, 0.44], head: [0.5, 0.55, 0.95], snout: [0.35, 0.3],
        ears: 'small', tail: 'thin', horns: 0, mane: false, humps: 2,
    },
];

/** The drawable half of an animal - everything except which animal it is. */
export function shapeOf(animal) {
    const { name, ...shape } = animal;
    return shape;
}
