import * as THREE from 'three';
import { slotColor, cssColor } from 'shared/palette.js';

/**
 * Scene-building blocks shared by all 13 games, so the suite looks like one product
 * and so no game has to reinvent a ground plane or a nameplate.
 *
 * Everything here is flat-shaded low-poly with `MeshLambertMaterial` - cheap, mobile
 * safe, and impossible to make look broken at low resolution (docs/GDD.md §4).
 */

export const COLORS = {
    night: 0x0b0c10,
    deep:  0x131722,
    floor: 0x1b2030,
    gold:  0xffb703,
    amber: 0xf59e0b,
    cream: 0xf3f4f6,
    good:  0x06d6a0,
    bad:   0xef476f,
    wood:  0x8d6a4a,
    grass: 0x3f7d4a,
    sky:   0x1d2b4a,
};

/** Materials are shared aggressively: fewer uploads, fewer state changes, fewer draws. */
const matCache = new Map();

export function mat(color, opts = {}) {
    const key = `${color}|${JSON.stringify(opts)}`;
    let m = matCache.get(key);
    if (!m) {
        m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
        matCache.set(key, m);
    }
    return m;
}

export function emissive(color, intensity = 0.6) {
    return mat(color, { emissive: color, emissiveIntensity: intensity });
}

/**
 * Cached materials outlive a round on purpose - they are reused by the next game.
 * `clearMaterialCache` exists for the teardown path so a long session does not hold
 * every material any game ever asked for.
 */
export function clearMaterialCache() {
    for (const m of matCache.values()) m.dispose();
    matCache.clear();
}

// ------------------------------------------------------------------- primitives

export function box(w, h, d, color, opts) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
}

export function cylinder(rTop, rBottom, h, color, segments = 10, opts) {
    return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat(color, opts));
}

export function sphere(r, color, detail = 1, opts) {
    return new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat(color, opts));
}

export function cone(r, h, color, segments = 8, opts) {
    return new THREE.Mesh(new THREE.ConeGeometry(r, h, segments), mat(color, opts));
}

// ------------------------------------------------------------------- environment

/**
 * The standard arena floor: a dark disc with a subtle radial gradient baked into a
 * small canvas texture. It reads as depth without a single shadow-map sample.
 */
export function arenaFloor(radius = 22, inner = COLORS.floor, outer = COLORS.night) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#' + inner.toString(16).padStart(6, '0'));
    grad.addColorStop(1, '#' + outer.toString(16).padStart(6, '0'));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 48),
        new THREE.MeshLambertMaterial({ map: tex }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = false;
    return mesh;
}

/**
 * A gradient dome behind everything. Without it the upper half of most shots is flat
 * black, which reads as "unfinished" rather than "night". One sphere, one 2x256
 * texture, drawn back-side with lighting off - essentially free.
 */
export function skyDome(top = 0x1b2440, bottom = 0x0b0c10, radius = 95) {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
    grad.addColorStop(0.62, '#' + bottom.toString(16).padStart(6, '0'));
    grad.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 16, 12),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    dome.renderOrder = -1;
    return dome;
}

export function gridFloor(size = 40, divisions = 20, color = 0x2a3550) {
    const grid = new THREE.GridHelper(size, divisions, color, color);
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    return grid;
}

/** A ring of low posts - the cheap way to say "the arena ends here". */
export function boundaryRing(radius, count = 36, color = COLORS.amber, height = 0.9) {
    const geo = new THREE.CylinderGeometry(0.12, 0.16, height, 6);
    const mesh = new THREE.InstancedMesh(geo, emissive(color, 0.5), count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        m.makeTranslation(Math.cos(a) * radius, height / 2, Math.sin(a) * radius);
        mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
}

// ----------------------------------------------------------------------- avatars

/**
 * The family avatar: a rounded blocky body in the player's slot color with a visor
 * that makes facing direction readable from across the arena. ~5 draw calls before
 * the group is flattened by the renderer's own batching, and small enough that 14 of
 * them are not the reason a phone drops frames.
 */
export function avatar(slot, { scale = 1, hat = null } = {}) {
    const color = slotColor(slot);
    const g = new THREE.Group();

    const body = box(0.72, 0.86, 0.52, color);
    body.position.y = 0.63;
    g.add(body);

    const head = box(0.52, 0.44, 0.46, 0xf5d0a9);
    head.position.y = 1.3;
    g.add(head);

    const visor = box(0.4, 0.12, 0.04, 0x11151f);
    visor.position.set(0, 1.33, 0.24);
    g.add(visor);

    for (const side of [-1, 1]) {
        const arm = box(0.16, 0.6, 0.16, color);
        arm.position.set(side * 0.46, 0.68, 0);
        g.add(arm);
        const leg = box(0.22, 0.42, 0.24, 0x2b3242);
        leg.position.set(side * 0.17, 0.2, 0);
        g.add(leg);
    }

    if (hat) {
        const brim = cylinder(0.38, 0.38, 0.04, hat, 10);
        brim.position.y = 1.53;
        const crown = cylinder(0.24, 0.26, 0.22, hat, 10);
        crown.position.y = 1.64;
        g.add(brim, crown);
    }

    g.scale.setScalar(scale);
    g.userData.slot = slot;
    return g;
}

/** Marks whose avatar is whose at a glance; games call this on their own mesh too. */
export function nameplate(name, slot, { scale = 1 } = {}) {
    const pad = 12;
    const font = 44;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `700 ${font}px Outfit, system-ui, sans-serif`;
    const width = Math.ceil(ctx.measureText(name).width) + pad * 2;

    canvas.width = Math.max(64, width);
    canvas.height = font + pad * 2;
    const c = canvas.getContext('2d');
    c.font = `700 ${font}px Outfit, system-ui, sans-serif`;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(c, 0, 0, canvas.width, canvas.height, 14);
    c.fill();
    c.fillStyle = cssColor(slot);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(name, canvas.width / 2, canvas.height / 2 + 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(0.42 * aspect * scale, 0.42 * scale, 1);
    sprite.renderOrder = 10;
    return sprite;
}

/** Canvas text on a plane - used for signs, order tickets and score boards. */
export function textPanel(lines, { width = 512, height = 256, bg = '#0d1119', fg = '#ffb703', size = 56 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d');
    c.fillStyle = bg;
    c.fillRect(0, 0, width, height);
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    const rows = Array.isArray(lines) ? lines : [lines];
    rows.forEach((line, i) => {
        c.font = `700 ${i === 0 ? size : size * 0.62}px Outfit, system-ui, sans-serif`;
        c.fillText(String(line), width / 2, (height / (rows.length + 1)) * (i + 1));
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { texture: tex, canvas, ctx: c };
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ------------------------------------------------------------------------ layout

/** The 14 standard positions on a ring, slot 0 nearest the camera and going clockwise. */
export function ringPosition(slot, count = 14, radius = 11) {
    const a = (slot / count) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * radius, z: Math.sin(a) * radius, angle: a };
}

/** The 14 standard positions on an arc facing -Z, for workstation games. */
export function arcPosition(slot, count = 14, radius = 9, spread = Math.PI * 0.75) {
    const t = count === 1 ? 0.5 : slot / (count - 1);
    const a = -spread / 2 + t * spread;
    return { x: Math.sin(a) * radius, z: Math.cos(a) * radius, angle: a };
}
