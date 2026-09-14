import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'ice-cream',
    title: 'Ice Cream Inc.',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 15,
    roundSeconds: 120,
};

export const FLAVORS = ['vanilla', 'strawberry', 'mint', 'chocolate'];
export const TOPPINGS = ['none', 'sprinkles', 'cherry', 'sauce'];

const FILL_RATE = 0.62;          // units of swirl per second
const COLLAPSE_AT = 1.18;        // overfill past this and the cone goes over
const MAX_HOLD_MS = 5000;        // a dropped "stop" must not dispense forever

/**
 * Ice Cream Inc. — fourteen dispensers, fourteen queues, one leaderboard.
 *
 * Everyone works their own machine, so nobody waits for a turn and a room of fourteen
 * is exactly as busy as a room of two. The skill is stopping on the line: the swirl
 * keeps growing while you hold, and holding a moment too long tips the whole cone.
 */
export function create(room) {
    const desks = new Map();

    function deskOf(player) {
        let d = desks.get(player.id);
        if (!d) {
            d = {
                slot: player.slot,
                height: 0,
                flavor: 0,
                topping: 0,
                holding: false,
                holdStartedAt: 0,
                served: 0,
                dropped: 0,
                bestAccuracy: 0,
                order: null,
            };
            newOrder(d);
            desks.set(player.id, d);
        }
        return d;
    }

    function newOrder(desk) {
        desk.order = {
            flavor: room.rng.int(0, FLAVORS.length - 1),
            // Never ask for a full cone: the interesting decision is where to stop,
            // and a target at the very top removes it.
            height: r2(room.rng.range(0.35, 0.92)),
            topping: room.rng.int(0, TOPPINGS.length - 1),
        };
        desk.height = 0;
        desk.topping = 0;
        desk.holding = false;
    }

    return {
        start() {
            for (const p of room.players.values()) deskOf(p);
        },

        onInput(player, msg) {
            const d = deskOf(player);
            // Hold state rides on the input stream rather than on discrete actions, so
            // a dropped "stop" corrects itself on the very next frame.
            const wants = !!msg.h;
            if (wants && !d.holding) d.holdStartedAt = Date.now();
            d.holding = wants;
        },

        onAction(player, msg) {
            const d = deskOf(player);
            if (msg.a === 'flavor') {
                const f = msg.f | 0;
                if (f >= 0 && f < FLAVORS.length && d.height === 0) d.flavor = f;
                return;
            }
            if (msg.a === 'top') {
                const t = msg.tp | 0;
                if (t >= 0 && t < TOPPINGS.length && d.height > 0) d.topping = t;
                return;
            }
            if (msg.a !== 'serve' || d.height <= 0) return;

            const order = d.order;
            // Accuracy falls off over a window of one third of the cone, so being a
            // little over or under still scores and being wild does not.
            const miss = Math.abs(d.height - order.height);
            const accuracy = Math.max(0, 1 - miss / 0.33);
            const flavorOk = d.flavor === order.flavor;
            const toppingOk = d.topping === order.topping;

            let points = Math.round(100 * accuracy * (flavorOk ? 1 : 0.35));
            if (toppingOk) points += 30;
            points = Math.max(5, points);

            player.score += points;
            d.served++;
            d.bestAccuracy = Math.max(d.bestAccuracy, accuracy);
            room.emit('serve', {
                by: player.id, slot: d.slot, pts: points,
                acc: r2(accuracy), flavorOk: flavorOk ? 1 : 0, toppingOk: toppingOk ? 1 : 0,
            });
            newOrder(d);
        },

        tick(dt, now) {
            for (const [id, d] of desks) {
                if (!d.holding) continue;
                if (now - d.holdStartedAt > MAX_HOLD_MS) { d.holding = false; continue; }

                d.height = r2(d.height + FILL_RATE * dt);
                if (d.height >= COLLAPSE_AT) {
                    d.dropped++;
                    const player = room.players.get(id);
                    if (player) player.score = Math.max(0, player.score - 10);
                    room.emit('collapse', { by: id, slot: d.slot });
                    newOrder(d);
                }
            }
        },

        onJoin(player) { deskOf(player); },
        onLeave(player) { desks.delete(player.id); },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                // [slot, height, flavor, topping, order flavor, order height, order topping]
                p: [...room.players.values()].map((p) => {
                    const d = deskOf(p);
                    return [p.slot, d.height, d.flavor, d.topping, d.order.flavor, d.order.height, d.order.topping];
                }),
            };
        },

        fullState() {
            return { flavors: FLAVORS, toppings: TOPPINGS, collapseAt: COLLAPSE_AT };
        },

        isOver() { return false; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const d = deskOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${d.served} served, ${d.dropped} tipped over`,
                    };
                });
        },

        dispose() { desks.clear(); },
    };
}
