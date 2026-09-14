import { Room } from './room.js';
import { LIMITS } from '../../shared/protocol.js';

// No vowels and no 0/O/1/I: a room code gets read aloud across a living room, so it
// must survive both bad handwriting and accidental words.
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';

const rooms = new Map();

function newCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
        let code = '';
        for (let i = 0; i < LIMITS.ROOM_CODE_LEN; i++) {
            code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        }
        if (!rooms.has(code)) return code;
    }
    // 29^4 is half a million codes; exhausting 200 draws means the server is already
    // far outside family scale and a collision-free fallback is the honest answer.
    return `R${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

export function createRoom() {
    const code = newCode();
    const room = new Room(code, (r) => scheduleReap(r));
    rooms.set(code, room);
    return room;
}

export function getRoom(code) {
    return rooms.get(String(code ?? '').toUpperCase().trim()) ?? null;
}

export function roomCount() {
    return rooms.size;
}

export function listRooms() {
    return [...rooms.values()].map((r) => ({
        code: r.code,
        players: r.players.size,
        phase: r.phase,
        gameId: r.gameId,
    }));
}

/**
 * An empty room lingers briefly so that a host who reloads the page - the most common
 * thing that happens to a room - gets their code back instead of a "no such room".
 */
const REAP_GRACE_MS = 60 * 1000;

function scheduleReap(room) {
    setTimeout(() => {
        if (room.isEmpty && rooms.get(room.code) === room) {
            room.destroy();
            rooms.delete(room.code);
        }
    }, REAP_GRACE_MS).unref?.();
}

/** Sweeps rooms nobody has touched in ten minutes, empty or not. */
export function startReaper() {
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [code, room] of rooms) {
            if (now - room.lastActivity > LIMITS.IDLE_ROOM_MS) {
                for (const p of [...room.players.values()]) p.close('room closed after 10 idle minutes');
                room.destroy();
                rooms.delete(code);
            }
        }
    }, 30 * 1000);
    timer.unref?.();
    return timer;
}
