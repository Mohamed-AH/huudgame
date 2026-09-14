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
    const client = await import(clientReg);
    const serverIds = server.listGames().map((g) => g.id).sort();
    const clientIds = client.listGames().map((g) => g.id).sort();

    for (const id of serverIds) if (!clientIds.includes(id)) fail(`server has "${id}", client does not`);
    for (const id of clientIds) if (!serverIds.includes(id)) fail(`client has "${id}", server does not`);

    for (const meta of server.listGames()) {
        if (!meta.title) fail(`server game "${meta.id}" has no title`);
        if (!(meta.maxPlayers > 0)) fail(`server game "${meta.id}" has no maxPlayers`);
        if (!(meta.tickRate > 0)) fail(`server game "${meta.id}" has no tickRate`);
    }
    // Every registered game must really load, or the lobby offers a broken tile.
    for (const id of serverIds) {
        try { await server.loadGame(id); } catch (err) { fail(`server module "${id}" fails to import: ${err.message}`); }
    }
    for (const id of clientIds) {
        try { await client.loadGame(id); } catch (err) { fail(`client module "${id}" fails to import: ${err.message}`); }
    }
    if (!failures) ok(`${serverIds.length} games registered on both sides`);
}

console.log(failures ? `\nverify FAILED (${failures})\n` : '\nverify OK\n');
process.exit(failures ? 1 : 0);
