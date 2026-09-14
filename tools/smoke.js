#!/usr/bin/env node
/**
 * End-to-end smoke test: boots the real server on a scratch port, connects a handful
 * of real WebSocket clients, and drives a full round of every registered game.
 *
 * This is the thing that catches "the lobby is broken" before fourteen people find
 * out at once. Run it before every commit alongside `npm run verify`.
 *
 *   node tools/smoke.js            all registered games
 *   node tools/smoke.js mango-target guess-number
 */

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROTOCOL_VERSION, C2S, S2C, PHASE } from '../shared/protocol.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8099 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const PLAYER_COUNT = 4;
const ROUND_BUDGET_MS = 14000;

let failures = 0;
const fail = (msg) => { failures++; console.error(`  x ${msg}`); };
const ok = (msg) => console.log(`  . ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A scripted client: connects, remembers what it was sent, and replies like a player. */
class Bot {
    constructor(name) {
        this.name = name;
        this.id = null;
        this.room = null;
        this.games = [];
        this.seen = new Map();       // message type -> count
        this.last = new Map();       // message type -> payload
        this.errors = [];
        this.stateTicks = 0;
        this.seq = 0;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
            this.ws.on('error', reject);
            this.ws.on('message', (raw) => this._onMessage(JSON.parse(String(raw))));
            this.ws.on('open', () => {
                this.send({ t: C2S.HELLO, name: this.name, version: PROTOCOL_VERSION });
                const wait = setInterval(() => {
                    if (this.id) { clearInterval(wait); resolve(this); }
                }, 10);
                setTimeout(() => { clearInterval(wait); reject(new Error(`${this.name}: no welcome`)); }, 4000);
            });
        });
    }

    _onMessage(msg) {
        this.seen.set(msg.t, (this.seen.get(msg.t) ?? 0) + 1);
        this.last.set(msg.t, msg);
        if (msg.t === S2C.WELCOME) { this.id = msg.id; this.games = msg.games; }
        if (msg.t === S2C.ROOM) this.room = msg;
        if (msg.t === S2C.STATE) this.stateTicks++;
        if (msg.t === S2C.ERROR) this.errors.push(msg);
    }

    send(obj) { this.ws.send(JSON.stringify(obj)); }
    count(type) { return this.seen.get(type) ?? 0; }
    close() { try { this.ws.close(); } catch { /* already gone */ } }

    /** Waits for a message type to arrive (or to arrive again, past `from`). */
    async await(type, timeoutMs = 6000, from = 0) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.count(type) > from) return this.last.get(type);
            await sleep(15);
        }
        throw new Error(`${this.name}: timed out waiting for "${type}"`);
    }
}

/**
 * Per-game bot behaviour. Without these the smoke test only ever exercises movement,
 * and every scoring path in every game would go untested.
 */
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const ACTIONS = {
    'guess-number': () => ({ a: 'guess', v: Math.ceil(rand(1, 100)) }),
    'mango-target': () => ({ a: 'throw', yaw: rand(-1, 1), pitch: rand(0.2, 1.1), pow: rand(0.3, 1) }),
    'baking-kitchen': () => ({ a: 'use' }),
    'ice-cream': () => {
        const roll = Math.random();
        if (roll < 0.2) return { a: 'flavor', f: Math.floor(rand(0, 4)) };
        if (roll < 0.4) return { a: 'top', tp: Math.floor(rand(0, 4)) };
        if (roll < 0.6) return { a: 'serve' };
        return null;
    },
    'voxel-sandbox': () => (Math.random() < 0.5
        ? { a: 'mine', x: Math.floor(rand(0, 28)), y: Math.floor(rand(1, 8)), z: Math.floor(rand(0, 28)) }
        : { a: 'place', x: Math.floor(rand(0, 28)), y: Math.floor(rand(1, 8)), z: Math.floor(rand(0, 28)), b: Math.ceil(rand(1, 6)) }),
};

// ------------------------------------------------------------------ the server

const child = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ARCADE_MAX_ROUND_SECONDS: '6' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
child.stdout.on('data', (d) => serverLog.push(String(d)));
child.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForServer() {
    for (let i = 0; i < 100; i++) {
        try {
            const res = await fetch(`${BASE}/healthz`);
            if (res.ok) return res.json();
        } catch { /* not up yet */ }
        await sleep(100);
    }
    throw new Error('server never became healthy');
}

function shutdown(code) {
    child.kill('SIGTERM');
    setTimeout(() => { child.kill('SIGKILL'); process.exit(code); }, 300).unref();
}

// --------------------------------------------------------------------- the run

try {
    const health = await waitForServer();
    console.log(`\nsmoke: server up on ${PORT}, ${health.games} games registered`);

    console.log('\nsmoke: static routes');
    for (const [path, needle] of [['/', '<!DOCTYPE html>'], ['/play/', '<'], ['/vendor/three/three.module.js', 'THREE']]) {
        const res = await fetch(BASE + path);
        const body = await res.text();
        if (res.ok && body.includes(needle)) ok(path);
        else fail(`${path} -> ${res.status}`);
    }
    for (const path of ['/../package.json', '/package.json', '/.git/config', '/server/src/index.js', '/nope.js']) {
        const res = await fetch(BASE + path);
        if (res.status === 404) ok(`${path} rejected`);
        else fail(`${path} -> ${res.status}, expected 404`);
    }

    console.log('\nsmoke: lobby');
    const bots = [];
    for (let i = 0; i < PLAYER_COUNT; i++) bots.push(await new Bot(`Bot${i + 1}`).connect());
    const [host, ...guests] = bots;

    host.send({ t: C2S.CREATE });
    const room = await host.await(S2C.ROOM);
    if (room.code?.length === 4) ok(`room ${room.code} opened`);
    else fail('no room code');
    if (room.hostId === host.id) ok('creator is host'); else fail('creator is not host');

    for (const g of guests) g.send({ t: C2S.JOIN, code: room.code });
    await sleep(300);
    const roster = host.last.get(S2C.ROOM);
    if (roster.players.length === PLAYER_COUNT) ok(`${PLAYER_COUNT} players seated`);
    else fail(`roster has ${roster.players.length}, expected ${PLAYER_COUNT}`);
    if (new Set(roster.players.map((p) => p.slot)).size === PLAYER_COUNT) ok('slots unique');
    else fail('duplicate slots');

    guests[0].send({ t: C2S.START });
    await sleep(200);
    if (guests[0].errors.some((e) => e.code === 'not_host')) ok('non-host cannot start');
    else fail('non-host was allowed to start');

    const bad = await new Bot('Lost').connect();
    bad.send({ t: C2S.JOIN, code: 'ZZZZ' });
    await sleep(200);
    if (bad.errors.some((e) => e.code === 'no_room')) ok('bad room code rejected');
    else fail('bad room code was accepted');
    bad.close();

    console.log('\nsmoke: rounds');
    const wanted = process.argv.slice(2);
    const games = host.games.filter((g) => !wanted.length || wanted.includes(g.id));
    if (!games.length && wanted.length) fail(`no registered game matches ${wanted.join(', ')}`);

    for (const game of games) {
        const before = {
            state: host.count(S2C.STATE), end: host.count(S2C.END),
            picked: host.count(S2C.PICKED), start: host.count(S2C.START),
        };
        host.send({ t: C2S.PICK, gameId: game.id });
        await host.await(S2C.PICKED, 3000, before.picked);
        host.send({ t: C2S.START });

        const start = await host.await(S2C.START, 5000, before.start);
        if (!start.full) { fail(`${game.id}: START carried no fullState`); continue; }

        // Flail plausibly so the tick loop actually has work to do, and fire the
        // game's own discrete actions so scoring paths are exercised, not just movement.
        const act = ACTIONS[game.id];
        const flail = setInterval(() => {
            for (const [i, b] of bots.entries()) {
                const p = Date.now() / 700 + i;
                b.send({ t: C2S.INPUT, ax: Math.cos(p), ay: Math.sin(p), b: i % 2, h: Math.sin(p * 3) > 0 ? 1 : 0 });
                const action = act?.(i);
                if (action) b.send({ t: C2S.ACTION, n: ++b.seq, ...action });
            }
        }, 60);

        let ended = null;
        try {
            ended = await host.await(S2C.END, ROUND_BUDGET_MS, before.end);
        } catch {
            fail(`${game.id}: round never ended within ${ROUND_BUDGET_MS}ms`);
        }
        clearInterval(flail);

        const ticks = host.count(S2C.STATE) - before.state;
        if (ended) {
            const places = ended.results.map((r) => r.place);
            const placesOk = places.length === 0 || places.every((p, i) => p === i + 1);
            if (!placesOk) fail(`${game.id}: results places are not 1..n`);
            const phase = host.last.get(S2C.ROOM)?.phase;
            if (phase !== PHASE.RESULTS) fail(`${game.id}: phase is "${phase}" after END`);
            const top = ended.results[0]?.score ?? 0;
            ok(`${game.id}: ${ticks} ticks, ended "${ended.reason}", top score ${top}`);
        }
        if (ticks === 0) fail(`${game.id}: broadcast no state at all`);

        host.send({ t: C2S.PICK, gameId: game.id });   // returns the room to the lobby
        await sleep(120);
    }

    console.log('\nsmoke: teardown');
    const surviving = bots.slice(1);
    host.close();
    await sleep(400);
    const migrated = surviving[0].last.get(S2C.ROOM);
    if (migrated && migrated.hostId === surviving[0].id) ok('host migrated on disconnect');
    else fail('host did not migrate');
    for (const b of surviving) b.close();
    await sleep(200);

    const crashed = serverLog.join('').match(/threw|Unhandled|ERR_/g);
    if (crashed) fail(`server log contains errors:\n${serverLog.join('')}`);
    else ok('server log clean');
} catch (err) {
    fail(err.stack ?? String(err));
    if (serverLog.length) console.error(serverLog.join(''));
}

console.log(failures ? `\nsmoke FAILED (${failures})\n` : '\nsmoke OK\n');
shutdown(failures ? 1 : 0);
