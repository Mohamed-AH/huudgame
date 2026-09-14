/**
 * Wire protocol shared verbatim by the server and the browser client.
 *
 * Every frame is JSON: `{ t: <type>, ...payload }`. Keys inside per-tick payloads
 * are deliberately terse because `STATE` goes out to 14 sockets many times a second.
 */

export const PROTOCOL_VERSION = 1;

/** Client -> Server */
export const C2S = {
    HELLO:   'hello',    // { name, version }                first frame after connect
    CREATE:  'create',   // { }                              open a new room, become host
    JOIN:    'join',     // { code }                         join an existing room
    LEAVE:   'leave',    // { }
    RENAME:  'rename',   // { name }
    READY:   'ready',    // { ready:bool }
    PICK:    'pick',     // { gameId }                       host only
    START:   'start',    // { }                              host only
    RESTART: 'restart',  // { }                              host only, from the results screen
    INPUT:   'input',    // { ...game-specific continuous intent }
    ACTION:  'action',   // { ...game-specific discrete intent }
    CHAT:    'chat',     // { text }
    PING:    'ping',     // { c }                            c = client timestamp
};

/** Server -> Client */
export const S2C = {
    WELCOME: 'welcome',  // { id, version, games:[meta] }
    ROOM:    'room',     // { code, hostId, phase, gameId, players:[PlayerView] }
    PICKED:  'picked',   // { gameId }
    START:   'start',    // { gameId, seed, full:<game fullState> }
    STATE:   'state',    // { k:tick, ...game snapshot }
    EVENT:   'event',    // { e:<kind>, ... }                one-shot game event
    SCORES:  'scores',   // { b:[{i:id, s:score}] }
    END:     'end',      // { results:[{id,name,score,place}], reason }
    CHAT:    'chat',     // { id, name, text, ts }
    PONG:    'pong',     // { c, s }                         c echoed, s = server time
    ERROR:   'error',    // { code, msg }
    KICKED:  'kicked',   // { reason }
};

/** Room lifecycle. */
export const PHASE = {
    LOBBY:     'lobby',      // gathering players, host is picking a game
    COUNTDOWN: 'countdown',  // 3..2..1 before a round
    PLAYING:   'playing',
    RESULTS:   'results',    // podium; host may restart or return to lobby
};

export const ERR = {
    BAD_VERSION:  'bad_version',
    NO_ROOM:      'no_room',
    ROOM_FULL:    'room_full',
    NOT_HOST:     'not_host',
    BAD_GAME:     'bad_game',
    BAD_PHASE:    'bad_phase',
    RATE_LIMIT:   'rate_limit',
    MALFORMED:    'malformed',
};

export const LIMITS = {
    MAX_PLAYERS:     14,
    ROOM_CODE_LEN:   4,
    NAME_MAX:        14,
    CHAT_MAX:        140,
    MSG_BYTES_MAX:   4096,   // a single frame larger than this is dropped
    MSG_PER_SECOND:  90,     // per-socket flood guard (60fps input + slack)
    IDLE_ROOM_MS:    10 * 60 * 1000,
    COUNTDOWN_MS:    3200,
    RESULTS_MS:      20000,
};

/** Rounded to 2 decimals — every number that crosses the wire goes through this. */
export const r2 = (n) => Math.round(n * 100) / 100;

export const encode = (obj) => JSON.stringify(obj);

export function decode(raw) {
    try {
        const msg = JSON.parse(raw);
        return msg && typeof msg === 'object' && typeof msg.t === 'string' ? msg : null;
    } catch {
        return null;
    }
}
