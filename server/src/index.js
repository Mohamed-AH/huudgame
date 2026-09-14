import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';

import { C2S, S2C, ERR, PROTOCOL_VERSION, LIMITS } from '../../shared/protocol.js';
import { Player } from './player.js';
import { sanitizeName } from './room.js';
import { createRoom, getRoom, roomCount, listRooms, startReaper } from './rooms.js';
import { listGames } from './games/registry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// ---------------------------------------------------------------- static files

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
    '.webp': 'image/webp',
    '.mp3':  'audio/mpeg',
    '.woff2': 'font/woff2',
};

/**
 * Only three trees are reachable: the arcade client, three.js straight out of
 * node_modules (which is why the client can use a bare `import ... from 'three'`
 * with no CDN and no build step), and shared/ which both sides import verbatim.
 */
const MOUNTS = [
    { prefix: '/vendor/three/', dir: join(ROOT, 'node_modules/three/build') },
    { prefix: '/play/',         dir: join(ROOT, 'client') },
    { prefix: '/shared/',       dir: join(ROOT, 'shared') },
    { prefix: '/assets/',       dir: join(ROOT, 'assets') },
];

// The repo root holds more than a web root should, so the site's own files are named
// one by one rather than mounting the whole directory and hoping.
const SITE_FILES = new Set(['/huud-website.html', '/huud-styles.css']);

function resolveFile(urlPath) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
    } catch {
        return null;
    }
    if (pathname === '/') pathname = '/huud-website.html';
    if (pathname === '/play' || pathname === '/play/') pathname = '/play/index.html';

    if (SITE_FILES.has(pathname)) {
        const full = join(ROOT, pathname.slice(1));
        return existsSync(full) ? full : null;
    }

    for (const mount of MOUNTS) {
        if (!pathname.startsWith(mount.prefix)) continue;
        const rel = normalize(pathname.slice(mount.prefix.length));
        if (rel.startsWith('..')) return null;                 // traversal attempt
        const full = join(mount.dir, rel);
        if (!full.startsWith(mount.dir)) return null;
        if (existsSync(full) && statSync(full).isFile()) return full;
    }
    return null;
}

const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, rooms: roomCount(), games: listGames().length }));
    }
    if (req.url === '/api/rooms') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(listRooms()));
    }

    const file = resolveFile(req.url);
    if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('404 - nothing here');
    }

    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    // No caching during a family session: someone always has yesterday's client.
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
});

// ----------------------------------------------------------------- websockets

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.MSG_BYTES_MAX });

wss.on('connection', (socket) => {
    const player = new Player(socket);
    socket.__missed = 0;

    socket.on('message', (raw) => {
        const msg = player.intake(String(raw));
        if (msg) route(player, msg);
    });

    socket.on('pong', () => { socket.__missed = 0; });

    socket.on('close', () => {
        player.connected = false;
        player.room?.remove(player);
    });

    socket.on('error', () => {
        player.connected = false;
        player.room?.remove(player);
    });
});

function route(player, msg) {
    switch (msg.t) {
        case C2S.HELLO: {
            if (msg.version !== PROTOCOL_VERSION) {
                // A stale cached client on somebody's iPad is the likeliest failure
                // in this whole system; say so plainly rather than desyncing.
                player.error(ERR.BAD_VERSION, 'reload the page to get the latest arcade');
                return player.close('version mismatch');
            }
            player.name = sanitizeName(msg.name) || `Player ${player.id.slice(2, 5)}`;
            player.helloed = true;
            player.send({
                t: S2C.WELCOME,
                id: player.id,
                version: PROTOCOL_VERSION,
                maxPlayers: LIMITS.MAX_PLAYERS,
                games: listGames().map((g) => ({
                    id: g.id, title: g.title, mode: g.mode,
                    minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
                    roundSeconds: g.roundSeconds,
                })),
            });
            return;
        }

        case C2S.PING:
            player.send({ t: S2C.PONG, c: msg.c, s: Date.now() });
            if (typeof msg.rtt === 'number') player.latency = Math.max(0, Math.min(2000, Math.round(msg.rtt)));
            return;

        case C2S.CREATE: {
            if (!player.helloed) return player.error(ERR.MALFORMED, 'say hello first');
            player.room?.remove(player);
            const room = createRoom();
            room.add(player);
            console.log(`[arcade] room ${room.code} opened by ${player.name}`);
            return;
        }

        case C2S.JOIN: {
            if (!player.helloed) return player.error(ERR.MALFORMED, 'say hello first');
            const room = getRoom(msg.code);
            if (!room) return player.error(ERR.NO_ROOM, 'no room with that code');
            if (room.players.size >= LIMITS.MAX_PLAYERS) return player.error(ERR.ROOM_FULL, 'that room has all 14 seats taken');
            player.room?.remove(player);
            if (!room.add(player)) player.error(ERR.ROOM_FULL);
            return;
        }

        case C2S.LEAVE:
            player.room?.remove(player);
            return;

        default:
            if (player.room) player.room.handle(player, msg);
            else player.error(ERR.NO_ROOM, 'join a room first');
    }
}

// A phone that goes to sleep in a pocket never sends a close frame, so the roster
// only stays honest because of this sweep.
const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
        if (socket.readyState !== 1) continue;
        if (socket.__missed >= 2) { socket.terminate(); continue; }
        socket.__missed = (socket.__missed ?? 0) + 1;
        socket.ping();
    }
}, 25000);
heartbeat.unref?.();

startReaper();

server.listen(PORT, HOST, () => {
    const games = listGames().length;
    console.log(`\n  HUUD Family Arcade`);
    console.log(`  site    http://localhost:${PORT}/`);
    console.log(`  arcade  http://localhost:${PORT}/play/`);
    console.log(`  games   ${games} registered, up to ${LIMITS.MAX_PLAYERS} players per room\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log('\nshutting down');
        clearInterval(heartbeat);
        wss.close();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref?.();
    });
}
