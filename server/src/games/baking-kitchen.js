import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'baking-kitchen',
    title: 'Baking Kitchen',
    mode: 'coop',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 15,
    roundSeconds: 150,
};

const ROOM_X = 15;               // half-width of the kitchen floor
const ROOM_Z = 10;
const SPEED = 6.2;
const REACH = 2.2;
const ORDER_SECONDS = 42;
const MAX_ORDERS = 6;
const BURN_SECONDS = 9;

/** Station work times, in seconds. The oven is slow on purpose: it forces hand-offs. */
const WORK = { mix: 2.4, oven: 4.2, decorate: 2.6, plate: 0.6 };

const STATION_LAYOUT = [
    ['prep', -12, -7], ['prep', -12, 0], ['prep', -12, 7],
    ['mix', -5, -7.5], ['mix', -5, 0], ['mix', -5, 7.5],
    ['oven', 3, -7.5], ['oven', 3, 0], ['oven', 3, 7.5],
    ['decorate', 9, -6], ['decorate', 9, 6],
    ['plate', 13, -3], ['plate', 13, 3],
    ['bin', 0, -9.5],
];

/**
 * Baking Kitchen — one shared kitchen, one shared score.
 *
 * The design problem with 14 cooks is that most co-op kitchens only have work for
 * three. This one solves it by making every recipe a chain of stations and letting a
 * cook carry exactly one thing: the fast way to clear the ticket rail is a relay, not
 * fourteen people each doing a whole cake.
 */
export function create(room) {
    const stations = STATION_LAYOUT.map(([kind, x, z], id) => ({
        id, kind, x, z,
        item: null,          // the item sitting in this station
        doneAt: 0,           // when the current work finishes
        burnAt: 0,           // ovens only
    }));

    const cooks = new Map();
    const orders = new Map();
    const items = new Map();
    let nextOrderId = 1;
    let nextItemId = 1;
    let family = 0;
    let completed = 0;
    let spoiled = 0;
    let burned = 0;
    let nextOrderAt = 0;

    const RECIPES = [
        ['mix', 'oven', 'plate'],
        ['mix', 'decorate', 'plate'],
        ['oven', 'decorate', 'plate'],
        ['mix', 'oven', 'decorate', 'plate'],
    ];

    function cookOf(player) {
        let c = cooks.get(player.id);
        if (!c) {
            // Spread the family across the back of the kitchen rather than stacking
            // everyone on the door.
            c = {
                slot: player.slot,
                x: -13 + (player.slot % 4) * 1.6,
                z: -8 + Math.floor(player.slot / 4) * 5,
                rot: 0, ax: 0, az: 0,
                carrying: null,
                steps: 0, plated: 0,
            };
            cooks.set(player.id, c);
        }
        return c;
    }

    function newOrder(now) {
        const recipe = room.rng.pick(RECIPES);
        const order = {
            id: nextOrderId++,
            recipe,
            expiresAt: now + ORDER_SECONDS * 1000,
            claimed: false,
        };
        orders.set(order.id, order);
        room.emit('order', { id: order.id, recipe });
        return order;
    }

    const nearestStation = (c, predicate) => {
        let best = null;
        let bestD = REACH;
        for (const s of stations) {
            if (predicate && !predicate(s)) continue;
            const d = Math.hypot(s.x - c.x, s.z - c.z);
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    };

    /** The station kind an item needs next, or null when it is finished. */
    const nextKind = (item) => {
        const order = orders.get(item.orderId);
        return order ? order.recipe[item.step] ?? null : null;
    };

    function completeOrder(order, player, c, now) {
        const left = Math.max(0, order.expiresAt - now) / (ORDER_SECONDS * 1000);
        // Freshness is most of the value, so a rail full of stale tickets really hurts
        // and a snappy relay really pays.
        const points = Math.round(60 + 90 * left);
        family += points;
        completed++;
        player.score += 50;
        c.plated++;
        orders.delete(order.id);
        room.emit('served', { by: player.id, id: order.id, pts: points, fam: family });
    }

    return {
        start() {
            const now = Date.now();
            for (const p of room.players.values()) cookOf(p);
            // Start with a few tickets already up so the first ten seconds are not spent
            // watching an empty rail.
            for (let i = 0; i < 3; i++) newOrder(now + i * 1500);
            nextOrderAt = now + 6000;
        },

        onInput(player, msg) {
            const c = cookOf(player);
            c.ax = Math.max(-1, Math.min(1, Number(msg.ax) || 0));
            c.az = Math.max(-1, Math.min(1, Number(msg.ay) || 0));
        },

        onAction(player, msg) {
            if (msg.a !== 'use') return;
            const c = cookOf(player);
            const now = Date.now();

            if (c.carrying) return dropOff(player, c, now);
            return pickUp(player, c, now);
        },

        tick(dt, now) {
            for (const c of cooks.values()) {
                const len = Math.hypot(c.ax, c.az) || 1;
                const scale = Math.min(1, len);
                c.x += (c.ax / len) * scale * SPEED * dt;
                c.z += (-c.az / len) * scale * SPEED * dt;     // screen-up is into the room
                c.x = Math.max(-ROOM_X, Math.min(ROOM_X, c.x));
                c.z = Math.max(-ROOM_Z, Math.min(ROOM_Z, c.z));
                if (Math.abs(c.ax) + Math.abs(c.az) > 0.05) c.rot = Math.atan2(c.ax, -c.az);
            }

            for (const s of stations) {
                if (!s.item || !s.doneAt || now < s.doneAt) continue;
                const item = s.item;
                if (!item.ready) {
                    item.ready = true;
                    // The oven is the only station that can ruin a cake; everywhere
                    // else a forgotten item just sits there.
                    if (s.kind === 'oven') s.burnAt = now + BURN_SECONDS * 1000;
                    room.emit('ready', { station: s.id, item: item.id });
                }
                if (s.kind === 'oven' && !item.burnt && s.burnAt && now >= s.burnAt) {
                    item.burnt = true;
                    burned++;
                    family = Math.max(0, family - 20);
                    room.emit('burnt', { station: s.id, item: item.id, fam: family });
                }
            }

            for (const [id, order] of orders) {
                if (now < order.expiresAt) continue;
                orders.delete(id);
                spoiled++;
                family = Math.max(0, family - 30);
                room.emit('spoiled', { id, fam: family });
            }

            if (now >= nextOrderAt && orders.size < MAX_ORDERS) {
                // More cooks, more tickets - otherwise fourteen people fight over three.
                const pace = Math.max(2600, 9000 - room.players.size * 450);
                nextOrderAt = now + pace;
                newOrder(now);
            }
        },

        onJoin(player) { cookOf(player); },
        onLeave(player) {
            const c = cooks.get(player.id);
            if (c?.carrying) items.delete(c.carrying.id);      // whatever they held is lost
            cooks.delete(player.id);
        },

        snapshot() {
            const now = Date.now();
            return {
                tl: r2(room.timeLeft()),
                fam: family,
                p: [...room.players.values()].map((p) => {
                    const c = cookOf(p);
                    return [p.slot, r2(c.x), r2(c.z), r2(c.rot), c.carrying ? c.carrying.step + 1 : 0, c.carrying?.burnt ? 1 : 0];
                }),
                // [station, has item, working 0..1, item ready, burnt]
                s: stations.map((s) => [
                    s.id,
                    s.item ? 1 : 0,
                    s.item && s.doneAt && !s.item.ready
                        ? r2(1 - Math.max(0, s.doneAt - now) / (WORK[s.kind] * 1000))
                        : (s.item?.ready ? 1 : 0),
                    s.item?.ready ? 1 : 0,
                    s.item?.burnt ? 1 : 0,
                ]),
                o: [...orders.values()].slice(0, MAX_ORDERS).map((o) => [
                    o.id, o.recipe.join(','), r2(Math.max(0, (o.expiresAt - now) / 1000)),
                ]),
            };
        },

        fullState() {
            return { stations: stations.map((s) => [s.id, s.kind, s.x, s.z]), room: [ROOM_X, ROOM_Z] };
        },

        isOver() { return false; },

        familyScore() { return family; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const c = cookOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${c.steps} steps, ${c.plated} plated`,
                    };
                });
        },

        dispose() { cooks.clear(); orders.clear(); items.clear(); },
    };

    // ------------------------------------------------------------------ actions

    function pickUp(player, c, now) {
        const station = nearestStation(c);
        if (!station) return;

        // An empty prep bench starts a new cake for the oldest unclaimed ticket.
        if (station.kind === 'prep' && !station.item) {
            const order = [...orders.values()].find((o) => !o.claimed);
            if (!order) return room.emitTo(player, 'nope', { why: 'no tickets waiting' });
            order.claimed = true;
            const item = { id: nextItemId++, orderId: order.id, step: 0, ready: false, burnt: false };
            items.set(item.id, item);
            c.carrying = item;
            c.steps++;
            player.score += 10;
            room.emit('take', { by: player.id, station: station.id, item: item.id });
            return;
        }

        if (!station.item || !station.item.ready) return;
        c.carrying = station.item;
        station.item = null;
        station.doneAt = 0;
        station.burnAt = 0;
        room.emit('take', { by: player.id, station: station.id, item: c.carrying.id });
    }

    function dropOff(player, c, now) {
        const item = c.carrying;
        const station = nearestStation(c, (s) => !s.item);
        if (!station) return;

        if (item.burnt) {
            if (station.kind !== 'bin') return room.emitTo(player, 'nope', { why: 'that one is ruined - bin it' });
            c.carrying = null;
            items.delete(item.id);
            room.emit('binned', { by: player.id, station: station.id });
            return;
        }

        if (station.kind === 'bin') {                         // deliberately thrown away
            c.carrying = null;
            items.delete(item.id);
            // The ticket goes back on the rail so somebody else can start it over.
            const order = orders.get(item.orderId);
            if (order) order.claimed = false;
            room.emit('binned', { by: player.id, station: station.id });
            return;
        }

        const wanted = nextKind(item);
        if (!wanted) {                                        // its ticket expired underneath it
            c.carrying = null;
            items.delete(item.id);
            return room.emitTo(player, 'nope', { why: 'that ticket is gone' });
        }
        if (station.kind !== wanted) {
            return room.emitTo(player, 'nope', { why: `that cake needs the ${wanted}` });
        }

        c.carrying = null;
        c.steps++;
        player.score += 10;
        item.step++;
        item.ready = false;

        if (station.kind === 'plate') {
            const order = orders.get(item.orderId);
            items.delete(item.id);
            if (order) completeOrder(order, player, c, now);
            return;
        }

        station.item = item;
        station.doneAt = now + WORK[station.kind] * 1000;
        room.emit('put', { by: player.id, station: station.id, item: item.id, kind: station.kind });
    }
}
