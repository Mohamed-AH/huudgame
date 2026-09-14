import * as THREE from 'three';
import { S2C, PHASE } from 'shared/protocol.js';
import { slotColor, cssColor, slotName } from 'shared/palette.js';
import { makeRng } from 'shared/rng.js';

import { Net } from './net.js';
import { Engine } from './engine.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Lobby } from './lobby.js';
import { loadGame } from './games/registry.js';
import { Particles, sound } from './lib/fx.js';
import * as build from './lib/build.js';
import * as interp from './lib/interp.js';

const canvas = document.getElementById('stage');

const net = new Net();
const engine = new Engine(canvas);
const input = new Input(canvas, {
    controls: document.getElementById('touch-controls'),
    stick:    document.getElementById('stick'),
    knob:     document.getElementById('stick-knob'),
    btnA:     document.getElementById('btn-a'),
    btnB:     document.getElementById('btn-b'),
});
const lobby = new Lobby(net);

let hud = null;
let game = null;            // the live game module instance
let gameId = null;
let room = null;
let particles = null;
let idleScene = null;

// ---------------------------------------------------------------- idle backdrop

/**
 * The lobby is not a blank page: a slow ring of the 14 slot colors turns behind it,
 * which is also a free confirmation that WebGL works on this device before anyone
 * commits to a round.
 */
function buildIdleScene() {
    const group = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(0.8, 0);
    for (let slot = 0; slot < 14; slot++) {
        const { x, z } = build.ringPosition(slot, 14, 9);
        const m = new THREE.Mesh(geo, build.mat(slotColor(slot), { emissive: slotColor(slot), emissiveIntensity: 0.25 }));
        m.position.set(x, 1.2 + Math.sin(slot * 1.3) * 0.4, z);
        m.userData.phase = slot * 0.45;
        group.add(m);
    }
    group.add(build.arenaFloor(16));
    engine.root.add(group);
    engine.camera.position.set(0, 7.5, 17);
    engine.camera.lookAt(0, 1.5, 0);
    idleScene = group;
}

function animateIdle(dt, now) {
    if (!idleScene) return;
    idleScene.rotation.y += dt * 0.12;
    for (const m of idleScene.children) {
        if (m.userData.phase === undefined) continue;
        m.position.y = 1.4 + Math.sin(now / 700 + m.userData.phase) * 0.35;
        m.rotation.x += dt * 0.4;
        m.rotation.y += dt * 0.6;
    }
}

// -------------------------------------------------------------- game lifecycle

/** Everything a game module is handed. Nothing else is in scope for it. */
function gameContext(startMsg) {
    return {
        THREE,
        engine,
        scene: engine.root,
        camera: engine.camera,
        renderer: engine.renderer,
        net,
        input,
        hud,
        particles,
        sound,
        build,
        interp,
        selfId: net.id,
        seed: startMsg.seed,
        rng: makeRng(startMsg.seed >>> 0),
        players: () => room?.players ?? [],
        playerById: (id) => room?.players.find((p) => p.id === id) ?? null,
        colorOf: (slot) => slotColor(slot),
        cssColorOf: (slot) => cssColor(slot),
        nameOf: (id) => room?.players.find((p) => p.id === id)?.name ?? slotName(0),
    };
}

async function teardownGame() {
    try {
        game?.dispose?.();
    } catch (err) {
        console.error('[arcade] game dispose threw:', err);
    }
    game = null;
    gameId = null;
    engine.onResize = null;
    // clearRoot() takes the idle backdrop with it, so forget it here or the lobby
    // comes back to an empty scene.
    idleScene = null;
    particles?.dispose();
    particles = null;
    engine.clearRoot();
    hud?.clearPanel();
    hud?.setObjective('');
    input.setLayout({});
    input.disable();
}

async function startGame(msg) {
    await teardownGame();
    hud.show();
    hud.veil(null);
    lobby.hideAll();
    lobby.hideResults();

    let mod;
    try {
        mod = await loadGame(msg.gameId);
    } catch (err) {
        console.error('[arcade] failed to load game client:', err);
        hud.banner('That game failed to load');
        lobby.showLobby();
        return;
    }

    particles = new Particles(engine.root);
    gameId = msg.gameId;
    const ctx = gameContext(msg);

    try {
        game = mod.create(ctx);
        await game.build?.(msg.full);
    } catch (err) {
        console.error('[arcade] failed to build game scene:', err);
        hud.banner('That game failed to start');
        await teardownGame();
        lobby.showLobby();
        return;
    }

    engine.onResize = (w, h) => game?.resize?.(w, h);
    game.resize?.(engine.width, engine.height);

    if (msg.startsIn > 0) {
        input.disable();
        hud.countdown(msg.startsIn / 1000);
    } else {
        input.enable();   // joined a round already in progress
        hud.hideCountdown();
    }
}

// ------------------------------------------------------------------- net wiring

net.on(S2C.ROOM, (msg) => {
    const previous = room;
    room = msg;
    hud?.setRoom(msg.code);
    hud?.setPlayers(msg.players);
    lobby.onRoom(msg);

    if (msg.phase !== previous?.phase) onPhase(msg.phase);
});

function onPhase(phase) {
    switch (phase) {
        case PHASE.LOBBY:
            teardownGame().then(() => {
                hud?.hide();
                lobby.hideResults();
                lobby.showLobby();
                if (!idleScene) buildIdleScene();
            });
            break;

        case PHASE.COUNTDOWN:
            lobby.hideAll();
            lobby.hideResults();
            input.disable();
            break;

        case PHASE.PLAYING:
            hud?.hideCountdown();
            input.enable();
            sound.unlock();
            break;

        case PHASE.RESULTS:
            input.disable();
            break;
    }
}

net.on(S2C.PICKED, () => { /* the ROOM broadcast that follows carries the same news */ });

net.on(S2C.START, (msg) => { startGame(msg); });

net.on(S2C.STATE, (msg) => {
    if (typeof msg.tl === 'number') hud?.setTimer(msg.tl);
    game?.onState?.(msg);
});

net.on(S2C.EVENT, (msg) => { game?.onEvent?.(msg); });

net.on(S2C.SCORES, (msg) => { hud?.setScores(msg.b); });

net.on(S2C.END, (msg) => {
    input.disable();
    hud?.setTimer(0);
    game?.onEnd?.(msg);
    lobby.showResults(msg, room);
    if (msg.results?.[0]?.id === net.id) sound.win();
});

net.on(S2C.ERROR, (msg) => {
    console.warn('[arcade] server error:', msg.code, msg.msg);
    if (room) hud?.toast(msg.msg || msg.code);
    else lobby.status(msg.msg || msg.code, true);
});

net.on(S2C.KICKED, (msg) => {
    hud?.veil(msg.reason || 'Disconnected');
});

net.on('latency', (ms) => hud?.setLatency(ms));
net.on('reconnecting', ({ attempt }) => hud?.veil(`Reconnecting… (try ${attempt})`));
net.on('reconnected', () => {
    hud?.veil(null);
    // The socket is new, so the room is gone with it; the lobby is the honest place
    // to land rather than pretending the old round is still ours.
    lobby.showConnect();
    lobby.status('Reconnected — rejoin your room.');
});
net.on('disconnected', () => {
    if (room) hud?.veil('Connection lost…');
});

// ----------------------------------------------------------------- entry points

lobby.onConnect = async (name, code) => {
    try {
        await net.connect(name);
    } catch (err) {
        lobby.status('Could not reach the arcade. Is the server running?', true);
        return;
    }
    hud = new Hud(net.id);
    hud.setLatency(net.latency);
    sound.unlock();

    if (code) net.joinRoom(code);
    else net.createRoom();

    lobby.showLobby();
    if (!idleScene) buildIdleScene();
};

lobby.onLeave = () => {
    net.leaveRoom();
    room = null;
    teardownGame();
    hud?.hide();
    lobby.hideResults();
    lobby.showConnect();
    lobby.status('You left the room.');
};

// ----------------------------------------------------------------- the frame loop

engine.start((dt, now) => {
    animateIdle(dt, now);
    particles?.update(dt);
    try {
        game?.update?.(dt, now);
    } catch (err) {
        // A broken frame must not kill the loop, or the screen freezes for good.
        console.error('[arcade] game update threw:', err);
    }
});

lobby.showConnect();

// Shared links land here with ?room=CODE; one tap on the name field is all that is left.
if (lobby.autoJoinCode) {
    lobby.status(`Ready to join ${lobby.autoJoinCode} — enter your name.`);
    lobby.el.name.focus();
}

// Handy while developing: `window.arcade.room` and friends in the console.
window.arcade = { net, engine, input, get hud() { return hud; }, get game() { return game; }, get room() { return room; }, get gameId() { return gameId; } };
