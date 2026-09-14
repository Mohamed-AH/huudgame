import { C2S, S2C, PROTOCOL_VERSION } from 'shared/protocol.js';

const INPUT_HZ = 20;          // intent is sampled every frame but sent at most this often
const PING_MS = 2000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

/**
 * The client half of the wire. Owns the socket, the reconnect ladder, the latency
 * estimate, and the input throttle. Everything above it subscribes to message types
 * and never sees a raw frame.
 */
export class Net {
    constructor() {
        this.ws = null;
        this.id = null;
        this.name = 'Player';
        this.latency = 0;
        this.connected = false;
        this.games = [];
        this.maxPlayers = 14;

        this._handlers = new Map();
        this._attempt = 0;
        this._seq = 0;
        this._lastInputAt = 0;
        this._pendingInput = null;
        this._closedByUs = false;
        this._pingTimer = null;
        this._reconnectTimer = null;
    }

    get url() {
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${scheme}//${location.host}/ws`;
    }

    // ------------------------------------------------------------ subscription

    /** Returns an unsubscribe function so screens can clean up after themselves. */
    on(type, fn) {
        if (!this._handlers.has(type)) this._handlers.set(type, new Set());
        this._handlers.get(type).add(fn);
        return () => this._handlers.get(type)?.delete(fn);
    }

    _fire(type, payload) {
        for (const fn of this._handlers.get(type) ?? []) {
            try {
                fn(payload);
            } catch (err) {
                // One screen's bad handler must not stop the rest of the room from updating.
                console.error(`[net] handler for "${type}" threw:`, err);
            }
        }
    }

    // -------------------------------------------------------------- connection

    connect(name) {
        if (name) this.name = name;
        this._closedByUs = false;
        clearTimeout(this._reconnectTimer);

        return new Promise((resolve, reject) => {
            let settled = false;
            const ws = new WebSocket(this.url);
            this.ws = ws;

            ws.onopen = () => {
                this.connected = true;
                this._attempt = 0;
                this.send({ t: C2S.HELLO, name: this.name, version: PROTOCOL_VERSION });
                this._startPing();
            };

            ws.onmessage = (ev) => {
                let msg;
                try {
                    msg = JSON.parse(ev.data);
                } catch {
                    return;
                }

                if (msg.t === S2C.WELCOME) {
                    this.id = msg.id;
                    this.games = msg.games ?? [];
                    this.maxPlayers = msg.maxPlayers ?? 14;
                    if (!settled) { settled = true; resolve(msg); }
                }
                if (msg.t === S2C.PONG) {
                    this.latency = Math.round((Date.now() - msg.c) / 2);
                    this._fire('latency', this.latency);
                    return;
                }
                this._fire(msg.t, msg);
                this._fire('*', msg);
            };

            ws.onerror = () => {
                if (!settled) { settled = true; reject(new Error('could not reach the arcade')); }
            };

            ws.onclose = () => {
                this.connected = false;
                clearInterval(this._pingTimer);
                this._fire('disconnected', {});
                if (!settled) { settled = true; reject(new Error('connection closed')); }
                if (!this._closedByUs) this._scheduleReconnect();
            };
        });
    }

    _scheduleReconnect() {
        const delay = BACKOFF_MS[Math.min(this._attempt++, BACKOFF_MS.length - 1)];
        this._fire('reconnecting', { delay, attempt: this._attempt });
        this._reconnectTimer = setTimeout(() => {
            this.connect().then(
                () => this._fire('reconnected', {}),
                () => { /* onclose schedules the next rung of the ladder */ },
            );
        }, delay);
    }

    _startPing() {
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => {
            this.send({ t: C2S.PING, c: Date.now(), rtt: this.latency * 2 });
        }, PING_MS);
        this.send({ t: C2S.PING, c: Date.now() });
    }

    close() {
        this._closedByUs = true;
        clearInterval(this._pingTimer);
        clearTimeout(this._reconnectTimer);
        this.ws?.close();
    }

    // ----------------------------------------------------------------- sending

    send(obj) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
    }

    /**
     * Continuous intent. Called every frame by games; coalesced to INPUT_HZ so a
     * 120Hz iPad does not flood the room's tick loop with six times the data it reads.
     */
    input(payload) {
        this._pendingInput = payload;
        const now = performance.now();
        if (now - this._lastInputAt < 1000 / INPUT_HZ) return;
        this._lastInputAt = now;
        // `t` and `n` are spread LAST on purpose. They are the protocol's reserved
        // keys, and a game payload that happens to use one of them must not be able
        // to overwrite the message type - that failure is silent and baffling.
        this.send({ ...this._pendingInput, t: C2S.INPUT });
        this._pendingInput = null;
    }

    /** Discrete intent. Sequenced, so a frame replayed after a reconnect is ignored. */
    action(payload) {
        this.send({ ...payload, t: C2S.ACTION, n: ++this._seq });
    }

    // ------------------------------------------------------------ room commands

    createRoom() { this.send({ t: C2S.CREATE }); }
    joinRoom(code) { this.send({ t: C2S.JOIN, code: String(code).toUpperCase().trim() }); }
    leaveRoom() { this.send({ t: C2S.LEAVE }); }
    setName(name) { this.name = name; this.send({ t: C2S.RENAME, name }); }
    setReady(ready) { this.send({ t: C2S.READY, ready }); }
    pick(gameId) { this.send({ t: C2S.PICK, gameId }); }
    startRound() { this.send({ t: C2S.START }); }
    restartRound() { this.send({ t: C2S.RESTART }); }
}
