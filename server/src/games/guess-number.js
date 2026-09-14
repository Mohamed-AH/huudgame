import { r2 } from '../../../shared/protocol.js';

export const meta = {
    id: 'guess-number',
    title: 'Guess a Number',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 5,            // a typing game needs no more than five updates a second
    roundSeconds: 160,
};

const ROUNDS = 5;
const SUBROUND_SECONDS = 24;
const REVEAL_MS = 3200;
const LO = 1;
const HI = 100;
const CLOSE_ENOUGH = 5;     // a guess this near the secret still earns a consolation

/**
 * Five vault rounds. Everyone guesses at once, the vault answers higher or lower and
 * glows by how close you are, and the first correct guess takes the round.
 *
 * Nobody is ever eliminated: a wrong guess costs four points off the potential win
 * and nothing else, so the youngest player at the table is still guessing at the end.
 */
export function create(room) {
    let roundIndex = 0;
    let secret = 0;
    let phase = 'play';               // 'play' | 'reveal'
    let phaseEndsAt = 0;
    let winnerId = null;
    let over = false;

    /** Per-player state for the current sub-round, keyed by player id. */
    const board = new Map();

    const stateFor = (player) => {
        let s = board.get(player.id);
        if (!s) {
            s = { guesses: 0, last: null, heat: 0, best: Infinity, wins: 0, totalGuesses: 0 };
            board.set(player.id, s);
        }
        return s;
    };

    function beginSubround(now) {
        roundIndex++;
        secret = room.rng.int(LO, HI);
        phase = 'play';
        winnerId = null;
        phaseEndsAt = now + SUBROUND_SECONDS * 1000;
        for (const p of room.players.values()) {
            const s = stateFor(p);
            s.guesses = 0;
            s.last = null;
            s.heat = 0;
            s.best = Infinity;
        }
        room.emit('round', { rd: roundIndex, of: ROUNDS });
    }

    function endSubround(now) {
        phase = 'reveal';
        phaseEndsAt = now + REVEAL_MS;

        // Consolation for anyone who was circling the answer when time ran out.
        for (const p of room.players.values()) {
            const s = stateFor(p);
            if (p.id !== winnerId && s.best <= CLOSE_ENOUGH) {
                p.score += 25;
                room.emit('close', { by: p.id, off: s.best });
            }
        }
        room.emit('reveal', { secret, winner: winnerId });
    }

    return {
        start() {
            beginSubround(Date.now());
        },

        onAction(player, msg) {
            if (phase !== 'play' || msg.a !== 'guess') return;

            const value = Math.round(Number(msg.v));
            if (!Number.isFinite(value) || value < LO || value > HI) return;

            const s = stateFor(player);
            s.guesses++;
            s.totalGuesses++;
            s.last = value;

            const off = Math.abs(value - secret);
            s.best = Math.min(s.best, off);
            // Heat is a normalized closeness, and it is what the vault's glow reads
            // from - it says "warmer" without leaking the number itself.
            s.heat = r2(Math.max(0, 1 - off / 40));

            if (off === 0) {
                if (winnerId) return;                       // somebody beat them to it
                winnerId = player.id;
                s.wins++;
                const points = Math.max(40, 100 - 4 * (s.guesses - 1));
                player.score += points;
                room.emit('hit', { by: player.id, v: value, pts: points, tries: s.guesses });
                endSubround(Date.now());
                return;
            }

            // The direction hint is public - watching everyone else narrow the range
            // is most of the fun - but only the guesser is told how hot they are.
            room.emit('guess', { by: player.id, v: value, dir: value < secret ? 'up' : 'down' });
            room.emitTo(player, 'heat', { heat: s.heat, off: off <= CLOSE_ENOUGH ? off : null });
        },

        tick(dt, now) {
            if (now < phaseEndsAt) return;

            if (phase === 'play') {
                endSubround(now);
            } else if (roundIndex >= ROUNDS) {
                over = true;
            } else {
                beginSubround(now);
            }
        },

        onJoin(player) { stateFor(player); },
        onLeave(player) { board.delete(player.id); },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                rd: roundIndex,
                of: ROUNDS,
                ph: phase,
                sec: phase === 'reveal' ? secret : null,
                w: winnerId,
                // [slot, last guess, heat] - enough to light 14 podiums without
                // telling anyone else how close their sibling actually is.
                g: [...room.players.values()].map((p) => {
                    const s = stateFor(p);
                    return [p.slot, s.last ?? 0, p.id === winnerId ? 1 : 0];
                }),
            };
        },

        fullState(player) {
            const s = stateFor(player);
            return { lo: LO, hi: HI, of: ROUNDS, rd: roundIndex, ph: phase, yourGuesses: s.guesses };
        },

        isOver() { return over; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const s = stateFor(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: s.wins ? `${s.wins} vault${s.wins > 1 ? 's' : ''} cracked` : null,
                    };
                });
        },

        dispose() { board.clear(); },
    };
}
