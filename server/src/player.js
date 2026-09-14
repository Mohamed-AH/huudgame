import { encode, decode, LIMITS, S2C, ERR } from '../../shared/protocol.js';

let nextId = 0;

/**
 * One connected socket. Owns identity, the per-socket flood guard, and the only
 * place in the server that touches `ws.send`.
 */
export class Player {
    constructor(socket) {
        this.socket = socket;
        this.id = `p_${(++nextId).toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
        this.name = 'Player';
        this.slot = -1;
        this.room = null;
        this.ready = false;
        this.connected = true;
        this.score = 0;
        this.latency = 0;
        this.lastSeq = 0;         // highest `n` seen on an action; anything lower is a replay
        this.helloed = false;

        this._windowStart = Date.now();
        this._windowCount = 0;
    }

    send(obj) {
        if (!this.connected || this.socket.readyState !== 1) return;
        this.socket.send(encode(obj));
    }

    error(code, msg = '') {
        this.send({ t: S2C.ERROR, code, msg });
    }

    /**
     * Returns the parsed message, or null if the frame should be ignored.
     * Oversized or too-frequent frames are a bug or a script, not a family member,
     * so the socket is closed after one warning.
     */
    intake(raw) {
        if (raw.length > LIMITS.MSG_BYTES_MAX) {
            this.error(ERR.MALFORMED, 'frame too large');
            return null;
        }

        const now = Date.now();
        if (now - this._windowStart >= 1000) {
            this._windowStart = now;
            this._windowCount = 0;
        }
        if (++this._windowCount > LIMITS.MSG_PER_SECOND) {
            this.error(ERR.RATE_LIMIT, 'slow down');
            this.close();
            return null;
        }

        const msg = decode(raw);
        if (!msg) this.error(ERR.MALFORMED, 'not a protocol frame');
        return msg;
    }

    /** Discrete actions carry a sequence number so a reconnect replay cannot double-score. */
    acceptSeq(n) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return true;  // unsequenced action
        if (n <= this.lastSeq) return false;
        this.lastSeq = n;
        return true;
    }

    view() {
        return {
            id: this.id,
            name: this.name,
            slot: this.slot,
            ready: this.ready,
            connected: this.connected,
            score: this.score,
            latency: this.latency,
        };
    }

    close(reason = '') {
        this.connected = false;
        try {
            if (reason) this.send({ t: S2C.KICKED, reason });
            this.socket.close();
        } catch { /* socket already gone */ }
    }
}
