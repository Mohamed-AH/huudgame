#!/usr/bin/env node
/**
 * Pre-commit sanity net. No build step means nothing else would catch a typo before
 * it reaches a browser, so this parses every source file and cross-checks that the
 * server and client game registries describe the same set of games.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'vendor']);

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.js')) out.push(full);
    }
    return out;
}

console.log('\nverify: parsing sources');
const files = walk(ROOT);
for (const file of files) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
        fail(`${relative(ROOT, file)}\n${String(err.stderr || err.message).trim()}`);
    }
}
if (!failures) ok(`${files.length} JS files parse`);

console.log('\nverify: game registries');
const serverReg = join(ROOT, 'server/src/games/registry.js');
const clientReg = join(ROOT, 'client/js/games/registry.js');

if (!existsSync(serverReg) || !existsSync(clientReg)) {
    console.log('  - registries not built yet, skipping');
} else {
    const server = await import(serverReg);
    // The client registry is deliberately import-free so it can be read here; the
    // game modules themselves cannot be (they import 'three' and browser globals),
    // so their presence is checked on disk instead.
    const client = await import(clientReg);
    const clientIds = new Set(client.listGames().map((g) => g.id));

    for (const meta of server.listGames()) {
        if (!clientIds.has(meta.id)) fail(`server registers "${meta.id}" but the client catalogue does not list it`);
        if (!existsSync(join(ROOT, `client/js/games/${meta.id}.js`))) fail(`server registers "${meta.id}" but client/js/games/${meta.id}.js is missing`);
        if (!meta.title) fail(`server game "${meta.id}" has no title`);
        if (!(meta.maxPlayers > 0)) fail(`server game "${meta.id}" has no maxPlayers`);
        if (!(meta.tickRate > 0)) fail(`server game "${meta.id}" has no tickRate`);
        if (!(meta.roundSeconds > 0)) fail(`server game "${meta.id}" has no roundSeconds`);
        if (!['ffa', 'coop'].includes(meta.mode)) fail(`server game "${meta.id}" has mode "${meta.mode}"`);
    }

    // A client module with no server counterpart would be dead code the lobby can
    // never reach - usually a half-finished game left behind by an interrupted session.
    for (const meta of client.listGames()) {
        const hasFile = existsSync(join(ROOT, `client/js/games/${meta.id}.js`));
        const hasServer = !!server.getMeta(meta.id);
        if (hasFile && !hasServer) fail(`client/js/games/${meta.id}.js exists but the server has no such game`);
        for (const key of ['title', 'emoji', 'blurb']) {
            if (!meta[key]) fail(`client game "${meta.id}" is missing ${key}`);
        }
        if (!meta.controls?.touch || !meta.controls?.keyboard) fail(`client game "${meta.id}" is missing control hints`);
    }

    const built = server.listGames().length;
    if (!failures) ok(`${built} of ${client.listGames().length} games built and agreed on both sides`);
}

console.log(failures ? `\nverify FAILED (${failures})\n` : '\nverify OK\n');
process.exit(failures ? 1 : 0);
