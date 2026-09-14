import { r2 } from '../../../shared/protocol.js';
import { ANIMALS, shapeOf } from './animals.js';

export const meta = {
    id: 'guess-animal',
    title: 'Guess Animal',
    mode: 'ffa',
    minPlayers: 1,
    maxPlayers: 14,
    tickRate: 5,
    roundSeconds: 170,
};

const ROUNDS = 8;
const STAGES = 4;
const STAGE_MS = 3400;
const REVEAL_MS = 3000;
const STAGE_POINTS = [100, 75, 50, 25];
const SPEED_BONUS = 25;

/**
 * Guess Animal — a spotlit turntable that fills a silhouette in over four stages.
 *
 * Guessing early is worth four times guessing late, which is the whole tension: the
 * shape at stage one is usually enough if you are willing to commit. Everyone locks in
 * at most once a round, and a wrong answer simply scores nothing - there is no penalty,
 * because a penalty would stop the youngest player guessing at all.
 */
export function create(room) {
    const order = room.rng.shuffle([...ANIMALS.keys()]);
    const answers = new Map();          // playerId -> { pick, stage, correct }
    const tallies = new Map();          // playerId -> { right, fastest }

    let roundIndex = -1;
    let animal = null;
    let choices = [];
    let correctIndex = 0;
    let stage = 0;
    let phase = 'reveal';               // 'reveal' (guessing) | 'answer' (showing)
    let phaseEndsAt = 0;
    let firstCorrect = null;
    let over = false;

    const tallyOf = (player) => {
        let t = tallies.get(player.id);
        if (!t) { t = { right: 0, fastest: 0 }; tallies.set(player.id, t); }
        return t;
    };

    function beginRound(now) {
        roundIndex++;
        if (roundIndex >= ROUNDS) { over = true; return; }

        animal = ANIMALS[order[roundIndex % order.length]];
        const decoys = room.rng
            .shuffle(ANIMALS.filter((a) => a !== animal))
            .slice(0, 3)
            .map((a) => a.name);
        choices = room.rng.shuffle([animal.name, ...decoys]);
        correctIndex = choices.indexOf(animal.name);

        stage = 0;
        phase = 'reveal';
        phaseEndsAt = now + STAGE_MS;
        firstCorrect = null;
        answers.clear();

        // The shape goes out; the name does not. See server/src/games/animals.js.
        room.emit('round', {
            rd: roundIndex + 1, of: ROUNDS,
            shape: shapeOf(animal),
            choices,
        });
    }

    function finishRound(now) {
        phase = 'answer';
        phaseEndsAt = now + REVEAL_MS;
        room.emit('answer', { correct: correctIndex, name: animal.name });
    }

    return {
        start() { beginRound(Date.now()); },

        onAction(player, msg) {
            if (msg.a !== 'answer' || phase !== 'reveal') return;
            if (answers.has(player.id)) return;                 // one lock-in per round

            const pick = msg.i | 0;
            if (pick < 0 || pick >= choices.length) return;

            const right = pick === correctIndex;
            answers.set(player.id, { pick, stage, correct: right });

            let points = 0;
            if (right) {
                points = STAGE_POINTS[Math.min(stage, STAGE_POINTS.length - 1)];
                const t = tallyOf(player);
                t.right++;
                if (!firstCorrect) {
                    firstCorrect = player.id;
                    t.fastest++;
                    points += SPEED_BONUS;
                }
                player.score += points;
            }

            // Everyone sees that you locked in, and at what stage; nobody sees what
            // you picked until the reveal. Watching the pods light up is half the fun.
            room.emit('locked', { by: player.id, stage, n: answers.size });
            room.emitTo(player, 'yours', { right: right ? 1 : 0, pts: points });

            if (answers.size >= room.players.size) finishRound(Date.now());
        },

        tick(dt, now) {
            if (over || now < phaseEndsAt) return;

            if (phase === 'answer') return beginRound(now);

            if (stage < STAGES - 1) {
                stage++;
                phaseEndsAt = now + STAGE_MS;
                room.emit('stage', { stage });
            } else {
                finishRound(now);
            }
        },

        onJoin(player) { tallyOf(player); },
        onLeave(player) { answers.delete(player.id); tallies.delete(player.id); },

        snapshot() {
            return {
                tl: r2(room.timeLeft()),
                rd: roundIndex + 1,
                of: ROUNDS,
                st: stage,
                ph: phase,
                // [slot, locked, revealed pick] - the pick stays -1 until the reveal.
                p: [...room.players.values()].map((p) => {
                    const a = answers.get(p.id);
                    return [p.slot, a ? 1 : 0, phase === 'answer' && a ? a.pick : -1];
                }),
            };
        },

        fullState() {
            return {
                of: ROUNDS,
                stages: STAGES,
                points: STAGE_POINTS,
                rd: roundIndex + 1,
                st: stage,
                // A late joiner gets the animal currently on the turntable.
                shape: animal ? shapeOf(animal) : null,
                choices,
            };
        },

        isOver() { return over; },

        results() {
            return [...room.players.values()]
                .sort((a, b) => b.score - a.score || a.slot - b.slot)
                .map((p, i) => {
                    const t = tallyOf(p);
                    return {
                        id: p.id, name: p.name, slot: p.slot,
                        score: Math.round(p.score), place: i + 1,
                        note: `${t.right}/${ROUNDS} right, ${t.fastest} fastest`,
                    };
                });
        },

        dispose() { answers.clear(); tallies.clear(); },
    };
}
