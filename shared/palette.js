/**
 * The 14 family slots. Colors are picked for maximum separation at small sizes on a
 * dark background, and every one of them stays legible next to the site's amber trim.
 */

export const SLOT_COLORS = [
    0xffb703, // 1  amber       (house color)
    0xff5d5d, // 2  coral
    0x4cc9f0, // 3  sky
    0x7bdc6b, // 4  lime
    0xc77dff, // 5  violet
    0xff9f1c, // 6  tangerine
    0x2ec4b6, // 7  teal
    0xf72585, // 8  magenta
    0x8ecae6, // 9  ice
    0xffd166, // 10 butter
    0x9b5de5, // 11 grape
    0x06d6a0, // 12 mint
    0xef476f, // 13 rose
    0xe0e1dd, // 14 pearl
];

export const SLOT_NAMES = [
    'Gold', 'Coral', 'Sky', 'Lime', 'Violet', 'Tangerine', 'Teal',
    'Magenta', 'Ice', 'Butter', 'Grape', 'Mint', 'Rose', 'Pearl',
];

/** `#rrggbb` for DOM/CSS use. */
export const cssColor = (slot) =>
    '#' + SLOT_COLORS[slot % SLOT_COLORS.length].toString(16).padStart(6, '0');

export const slotColor = (slot) => SLOT_COLORS[slot % SLOT_COLORS.length];
export const slotName  = (slot) => SLOT_NAMES[slot % SLOT_NAMES.length];
