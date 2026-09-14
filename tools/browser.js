#!/usr/bin/env node
/**
 * Browser smoke test: boots the server, opens the arcade in real Chromium, and plays
 * a round of every built game with several headless players at once.
 *
 * `tools/smoke.js` proves the server is right; this proves the *client* is right -
 * that the scene builds, that nothing throws mid-round, that WebGL comes up, and that
 * the page still works at phone width. Those are the failures a family would hit.
 *
 *   node tools/browser.js                 all built games
 *   node tools/browser.js mango-target    one game
 *   SHOTS=1 node tools/browser.js         also save screenshots to .shots/
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8500 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const GUESTS = 2;                 // plus the host: three real WebGL contexts is plenty
const SHOTS = process.env.SHOTS === '1';
const SHOT_DIR = join(ROOT, '.shots');

/**
 * This container ships Chromium at a pinned build under PLAYWRIGHT_BROWSERS_PATH that
 * will not always match the npm package's expected revision, and re-downloading is
 * blocked. Find whatever browser is actually on disk and use it.
 */
function findChromium() {
    if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!base || !existsSync(base)) return undefined;
    for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
        const bin = join(base, dir, 'chrome-linux', 'chrome');
        if (existsSync(bin)) return bin;
    }
    return undefined;
}

let failures = 0;
const fail = (msg) => { failures++; console.error(`  x ${msg}`); };
const ok = (msg) => console.log(`  . ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, [join(ROOT, 'server/src/index.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ARCADE_MAX_ROUND_SECONDS: '8' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
child.stdout.on('data', (d) => serverLog.push(String(d)));
child.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForServer() {
    for (let i = 0; i < 120; i++) {
        try {
            const res = await fetch(`${BASE}/healthz`);
            if (res.ok) return res.json();
        } catch { /* not up yet */ }
        await sleep(100);
    }
    throw new Error('server never became healthy');
}

/** One browser page pretending to be one family member. */
async function openPlayer(browser, { name, mobile = false }) {
    const context = await browser.newContext(
        mobile
            ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
                deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }
            : { viewport: { width: 1280, height: 800 } },
    );
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const where = m.location?.().url ?? '';
        errors.push(where ? `${m.text()} @ ${where}` : m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(`${BASE}/play/`, { waitUntil: 'domcontentloaded' });
    await page.fill('#name-input', name);
    return { page, context, errors, name };
}

function report(player, label) {
    // Google Fonts is a progressive enhancement - the CSS names real fallbacks - and
    // it is unreachable from some sandboxes, so its failures are not the client's.
    const real = player.errors.filter((e) => !/favicon|fonts\.(googleapis|gstatic)\.com/.test(e));
    if (real.length) fail(`${label} [${player.name}] console: ${real.slice(0, 4).join(' | ')}`);
    player.errors.length = 0;
    return real.length === 0;
}

let browser;
try {
    const health = await waitForServer();
    console.log(`\nbrowser: server up on ${PORT}, ${health.games} games registered`);
    if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

    browser = await chromium.launch({
        executablePath: findChromium(),
        args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
    });

    console.log('\nbrowser: lobby');
    const host = await openPlayer(browser, { name: 'Huud' });
    await host.page.click('#create-btn');
    await host.page.waitForSelector('#screen-lobby:not([hidden])', { timeout: 15000 });

    const code = (await host.page.textContent('#room-code')).trim();
    if (/^[A-Z0-9]{4}$/.test(code)) ok(`room ${code} opened in the browser`);
    else fail(`room code reads "${code}"`);

    const glOk = await host.page.evaluate(() => !!document.getElementById('stage').getContext('webgl2')
        || !!window.arcade?.engine?.renderer);
    if (glOk) ok('WebGL context is live'); else fail('no WebGL context');

    const guests = [];
    for (let i = 0; i < GUESTS; i++) {
        const g = await openPlayer(browser, { name: `Kid${i + 1}`, mobile: i === 0 });
        await g.page.fill('#code-input', code);
        await g.page.click('#join-btn');
        await g.page.waitForSelector('#screen-lobby:not([hidden])', { timeout: 15000 });
        guests.push(g);
    }
    const seated = await host.page.textContent('#player-count');
    if (seated.startsWith(String(GUESTS + 1))) ok(`roster shows ${seated.trim()}`);
    else fail(`roster shows ${seated.trim()}, expected ${GUESTS + 1}`);

    // The phone-sized guest is the one that catches layout mistakes.
    const overflow = await guests[0].page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow <= 1) ok('no horizontal overflow at 390px'); else fail(`${overflow}px of horizontal overflow at 390px`);

    const everyone = [host, ...guests];
    everyone.forEach((p) => report(p, 'lobby'));
    if (SHOTS) await host.page.screenshot({ path: join(SHOT_DIR, 'lobby.png') });

    console.log('\nbrowser: rounds');
    const wanted = process.argv.slice(2);
    const games = (await host.page.evaluate(() => window.arcade.net.games.map((g) => g.id)))
        .filter((id) => !wanted.length || wanted.includes(id));
    if (!games.length) console.log('  - no built games to play yet');

    for (const id of games) {
        await host.page.click(`.game-tile[data-game-id="${id}"]`);
        await host.page.waitForTimeout(150);
        await host.page.click('#start-btn');

        // Wait for the scene to exist rather than for a fixed delay.
        try {
            await host.page.waitForFunction(() => !!window.arcade.game, null, { timeout: 20000 });
        } catch {
            fail(`${id}: client game never built`);
            everyone.forEach((p) => report(p, id));
            continue;
        }

        // Everyone flails: stick, buttons, taps and drags, on desktop and on phone.
        for (const p of everyone) {
            await p.page.evaluate(() => {
                const canvas = document.getElementById('stage');
                const send = (type, x, y, id = 1) => canvas.dispatchEvent(new PointerEvent(type, {
                    pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true, buttons: 1,
                }));
                window.__flail = setInterval(() => {
                    const x = 120 + Math.random() * (window.innerWidth - 240);
                    const y = 120 + Math.random() * (window.innerHeight - 300);
                    send('pointerdown', x, y);
                    send('pointermove', x + 40, y - 30);
                    send('pointerup', x + 40, y - 30);
                    window.arcade.input.axes.x = Math.cos(Date.now() / 500);
                    window.arcade.input.axes.y = Math.sin(Date.now() / 500);
                    for (const b of document.querySelectorAll('#hud-panel button')) {
                        if (Math.random() < 0.25) b.click();
                    }
                }, 220);
            });
        }

        // Mid-round is the interesting frame; the results screen looks the same for
        // every game and tells us nothing about whether the scene was built well.
        if (SHOTS) {
            await host.page.waitForTimeout(3500);
            await host.page.screenshot({ path: join(SHOT_DIR, `${id}.png`) });
            await guests[0].page.screenshot({ path: join(SHOT_DIR, `${id}-phone.png`) });
        }

        let ended = false;
        try {
            await host.page.waitForSelector('#screen-results:not([hidden])', { timeout: 25000 });
            ended = true;
        } catch {
            fail(`${id}: results screen never appeared`);
        }

        for (const p of everyone) await p.page.evaluate(() => clearInterval(window.__flail));

        const clean = everyone.map((p) => report(p, id)).every(Boolean);
        const drawCalls = await host.page.evaluate(() => window.arcade.engine?.renderer?.info?.render?.calls ?? -1);
        if (ended && clean) ok(`${id}: played, results shown, ${drawCalls} draw calls`);
        if (drawCalls > 220) fail(`${id}: ${drawCalls} draw calls is over the mobile budget`);

        // Returning to the lobby view is local; the room only leaves RESULTS when the
        // host picks again, and that is also what tears the 3D scene down.
        await host.page.click('#back-lobby-btn');
        await host.page.click(`.game-tile[data-game-id="${id}"]`);
        await host.page.waitForFunction(() => window.arcade.room?.phase === 'lobby' && !window.arcade.game,
            null, { timeout: 10000 }).catch(() => fail(`${id}: room never returned to the lobby`));
    }

    console.log('\nbrowser: teardown');
    const leaked = await host.page.evaluate(() => {
        const info = window.arcade.engine.renderer.info.memory;
        return { geometries: info.geometries, textures: info.textures };
    });
    // Back in the lobby only the idle backdrop should be resident. A number in the
    // hundreds here means a game's dispose() is not releasing its scene graph.
    // The idle backdrop alone is 2 geometries and 1 texture; anything much above that
    // means a game's dispose() is not releasing its scene graph.
    if (leaked.geometries <= 12 && leaked.textures <= 6) ok(`memory released (${leaked.geometries} geometries, ${leaked.textures} textures)`);
    else fail(`possible leak: ${leaked.geometries} geometries, ${leaked.textures} textures still resident`);

    for (const p of everyone) await p.context.close();

    if (serverLog.join('').match(/threw|Unhandled/)) fail(`server log:\n${serverLog.join('')}`);
    else ok('server log clean');
} catch (err) {
    fail(err.stack ?? String(err));
    if (serverLog.length) console.error(serverLog.join(''));
}

await browser?.close().catch(() => {});
console.log(failures ? `\nbrowser FAILED (${failures})\n` : '\nbrowser OK\n');
child.kill('SIGTERM');
setTimeout(() => { child.kill('SIGKILL'); process.exit(failures ? 1 : 0); }, 300).unref();
