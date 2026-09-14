import { S2C, C2S, PHASE, ERR, LIMITS } from '../../shared/protocol.js';
import { makeRng, randomSeed } from '../../shared/rng.js';
import { loadGame, getMeta } from './games/registry.js';

const SCORE_BROADCAST_MS = 500;

// Rounds are 60-120s by design, which makes an end-to-end test of 13 games take a
// quarter of an hour. The smoke test sets this to a few seconds; it is unset in
// normal operation and must never be set in production.
const ROUND_CAP_SECONDS = Number(process.env.ARCADE_MAX_ROUND_SECONDS || 0);

/**
 * A room is 14 seats, a host, a phase machine, and (while playing) an authoritative
 * game instance ticking at the game's own rate. Everything a game module is allowed
 * to touch on the outside world it reaches through this object.
 */
export class Room {
    constructor(code, onEmpty) {
        this.code = code;
        this.players = new Map();
        this.hostId = null;
        this.phase = PHASE.LOBBY;
        this.gameId = null;
        this.game = null;
        this.meta = null;
        this.seed = randomSeed();
        this.rng = makeRng(this.seed);
        this.lastActivity = Date.now();

        this._onEmpty = onEmpty;
        this._timer = null;         // the playing-phase tick interval
        this._phaseTimeout = null;  // countdown / results transitions
        this._lastTickAt = 0;
        this._lastScoreSent = 0;
        this._tick = 0;
        this._roundEndsAt = 0;
    }

    // ---------------------------------------------------------------- roster

    get isEmpty() {
        return this.players.size === 0;
    }

    freeSlot() {
        const taken = new Set([...this.players.values()].map((p) => p.slot));
        for (let i = 0; i < LIMITS.MAX_PLAYERS; i++) if (!taken.has(i)) return i;
        return -1;
    }

    add(player) {
        const slot = this.freeSlot();
        if (slot < 0) return false;

        player.slot = slot;
        player.room = this;
        player.score = 0;
        player.ready = false;
        this.players.set(player.id, player);
        if (!this.hostId) this.hostId = player.id;
        this.lastActivity = Date.now();

        // A player who arrives mid-round joins the round in progress rather than
        // sitting out - nobody in this family tolerates watching.
        if (this.game && (this.phase === PHASE.PLAYING || this.phase === PHASE.COUNTDOWN)) {
            this.game.onJoin?.(player);
            player.send({
                t: S2C.START,
                gameId: this.gameId,
                seed: this.seed,
                startsIn: this.phase === PHASE.COUNTDOWN ? Math.max(0, this._roundEndsAt - Date.now()) : 0,
                full: this.game.fullState(player),
            });
        }

        this.broadcastRoom();
        return true;
    }

    remove(player) {
        if (!this.players.has(player.id)) return;
        this.game?.onLeave?.(player);
        this.players.delete(player.id);
        player.room = null;
        player.slot = -1;
        this.lastActivity = Date.now();

        if (this.hostId === player.id) {
            // Host migration: the longest-seated remaining player takes over.
            const next = this.players.values().next().value;
            this.hostId = next ? next.id : null;
        }

        if (this.isEmpty) {
            this.endRound('empty', false);
            this._onEmpty?.(this);
            return;
        }
        this.broadcastRoom();
    }

    // ------------------------------------------------------------ broadcasts

    broadcast(obj, except = null) {
        for (const p of this.players.values()) if (p !== except) p.send(obj);
    }

    broadcastRoom() {
        this.broadcast({
            t: S2C.ROOM,
            code: this.code,
            hostId: this.hostId,
            phase: this.phase,
            gameId: this.gameId,
            players: [...this.players.values()].map((p) => p.view()),
        });
    }

    /** Game modules announce one-shot happenings through here. */
    emit(kind, data = {}, except = null) {
        this.broadcast({ t: S2C.EVENT, e: kind, ...data }, except);
    }

    emitTo(player, kind, data = {}) {
        player.send({ t: S2C.EVENT, e: kind, ...data });
    }

    broadcastScores() {
        this.broadcast({
            t: S2C.SCORES,
            b: [...this.players.values()].map((p) => ({ i: p.id, s: Math.round(p.score) })),
        });
    }

    /** Ordered list, used by games that need stable indexing (lanes, podiums, stations). */
    seated() {
        return [...this.players.values()].sort((a, b) => a.slot - b.slot);
    }

    // --------------------------------------------------------------- routing

    handle(player, msg) {
        this.lastActivity = Date.now();
        const isHost = player.id === this.hostId;

        switch (msg.t) {
            case C2S.RENAME:
                player.name = sanitizeName(msg.name) || player.name;
                this.broadcastRoom();
                break;

            case C2S.READY:
                player.ready = !!msg.ready;
                this.broadcastRoom();
                break;

            case C2S.PICK: {
                if (!isHost) return player.error(ERR.NOT_HOST);
                const meta = getMeta(msg.gameId);
                if (!meta) return player.error(ERR.BAD_GAME, String(msg.gameId));
                if (this.phase === PHASE.PLAYING) return player.error(ERR.BAD_PHASE);
                if (this.phase === PHASE.RESULTS) this.toLobby();
                this.gameId = meta.id;
                this.broadcast({ t: S2C.PICKED, gameId: meta.id });
                this.broadcastRoom();
                break;
            }

            case C2S.START:
                if (!isHost) return player.error(ERR.NOT_HOST);
                if (this.phase === PHASE.PLAYING || this.phase === PHASE.COUNTDOWN) return player.error(ERR.BAD_PHASE);
                if (!this.gameId) return player.error(ERR.BAD_GAME, 'pick a game first');
                this.startRound();
                break;

            case C2S.RESTART:
                if (!isHost) return player.error(ERR.NOT_HOST);
                if (this.phase !== PHASE.RESULTS) return player.error(ERR.BAD_PHASE);
                this.startRound();
                break;

            case C2S.INPUT:
                if (this.phase === PHASE.PLAYING) this.game?.onInput?.(player, msg);
                break;

            case C2S.ACTION:
                if (this.phase !== PHASE.PLAYING) break;
                if (!player.acceptSeq(msg.n)) break;
                this.game?.onAction?.(player, msg);
                break;

            case C2S.CHAT: {
                const text = String(msg.text ?? '').slice(0, LIMITS.CHAT_MAX).trim();
                if (text) this.broadcast({ t: S2C.CHAT, id: player.id, name: player.name, text, ts: Date.now() });
                break;
            }

            default:
                player.error(ERR.MALFORMED, msg.t);
        }
    }

    // --------------------------------------------------------- phase machine

    async startRound() {
        this.endRound('restart', false);

        const meta = getMeta(this.gameId);
        if (!meta) return;

        let mod;
        try {
            mod = await loadGame(this.gameId);
        } catch (err) {
            console.error(`[room ${this.code}] game "${this.gameId}" failed to load:`, err);
            this.broadcast({ t: S2C.ERROR, code: ERR.BAD_GAME, msg: 'that game failed to load' });
            return;
        }
        if (this.isEmpty) return;   // everyone left while the module was importing

        this.meta = meta;
        this.seed = randomSeed();
        this.rng = makeRng(this.seed);
        this._tick = 0;
        this._lastScoreSent = 0;
        for (const p of this.players.values()) {
            p.score = 0;
            p.ready = false;
            p.lastSeq = 0;
        }

        this.game = mod.create(this);
        this.phase = PHASE.COUNTDOWN;
        this._roundEndsAt = Date.now() + LIMITS.COUNTDOWN_MS;
        this.broadcastRoom();

        // The scene is built during the countdown so that PLAYING starts on a frame
        // where every device already has its geometry uploaded.
        for (const p of this.players.values()) {
            p.send({
                t: S2C.START,
                gameId: this.gameId,
                seed: this.seed,
                startsIn: LIMITS.COUNTDOWN_MS,
                full: this.game.fullState(p),
            });
        }

        this._phaseTimeout = setTimeout(() => this.beginPlaying(), LIMITS.COUNTDOWN_MS);
    }

    beginPlaying() {
        if (!this.game || this.isEmpty) return;
        this.phase = PHASE.PLAYING;
        const seconds = this.meta.roundSeconds ?? 90;
        this._roundEndsAt = Date.now() + (ROUND_CAP_SECONDS ? Math.min(seconds, ROUND_CAP_SECONDS) : seconds) * 1000;
        this._lastTickAt = Date.now();
        this.game.start?.();
        this.broadcastRoom();

        const interval = Math.max(20, Math.round(1000 / (this.meta.tickRate || 15)));
        this._timer = setInterval(() => this.step(), interval);
    }

    step() {
        if (this.phase !== PHASE.PLAYING || !this.game) return;

        const now = Date.now();
        const dt = Math.min(0.25, (now - this._lastTickAt) / 1000);   // clamp: a stalled
        this._lastTickAt = now;                                       // event loop must
        this._tick++;                                                 // not teleport anyone

        try {
            this.game.tick(dt, now);
        } catch (err) {
            console.error(`[room ${this.code}] tick threw in "${this.gameId}":`, err);
            return this.endRound('error');
        }

        const snap = this.game.snapshot();
        if (snap) this.broadcast({ t: S2C.STATE, k: this._tick, ...snap });

        if (now - this._lastScoreSent >= SCORE_BROADCAST_MS) {
            this._lastScoreSent = now;
            this.broadcastScores();
        }

        if (this.game.isOver?.()) return this.endRound('complete');
        if (now >= this._roundEndsAt) return this.endRound('time');
    }

    /** Seconds left in the current round - games surface this in their snapshots. */
    timeLeft() {
        return Math.max(0, (this._roundEndsAt - Date.now()) / 1000);
    }

    endRound(reason, announce = true) {
        clearInterval(this._timer);
        clearTimeout(this._phaseTimeout);
        this._timer = this._phaseTimeout = null;

        if (!this.game) return;

        let results = [];
        try {
            results = this.game.results?.() ?? [];
        } catch (err) {
            console.error(`[room ${this.code}] results threw:`, err);
        }

        try { this.game.dispose?.(); } catch { /* best effort */ }
        this.game = null;

        if (!announce) {
            this.phase = PHASE.LOBBY;
            return;
        }

        this.phase = PHASE.RESULTS;
        this.broadcastScores();
        this.broadcast({ t: S2C.END, reason, results });
        this.broadcastRoom();

        this._phaseTimeout = setTimeout(() => this.toLobby(), LIMITS.RESULTS_MS);
    }

    toLobby() {
        clearTimeout(this._phaseTimeout);
        this._phaseTimeout = null;
        if (this.phase === PHASE.LOBBY) return;
        this.phase = PHASE.LOBBY;
        for (const p of this.players.values()) p.ready = false;
        this.broadcastRoom();
    }

    destroy() {
        clearInterval(this._timer);
        clearTimeout(this._phaseTimeout);
        try { this.game?.dispose?.(); } catch { /* best effort */ }
        this.game = null;
    }
}

/** Strips control characters, which are the only thing a name field can smuggle. */
export function sanitizeName(raw) {
    return String(raw ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, LIMITS.NAME_MAX);
}
