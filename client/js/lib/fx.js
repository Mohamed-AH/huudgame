import * as THREE from 'three';

/**
 * Pooled particle bursts. One `InstancedMesh` serves every explosion, splash and
 * celebration in a game - a fixed budget of instances recycled oldest-first, so a
 * fourteen-player scoring frenzy costs exactly one draw call and zero allocations.
 */
export class Particles {
    constructor(parent, { count = 320, size = 0.16, gravity = -9 } = {}) {
        this.count = count;
        this.gravity = gravity;

        const geo = new THREE.IcosahedronGeometry(size, 0);
        const mat = new THREE.MeshLambertMaterial({ flatShading: true, transparent: true });
        this.mesh = new THREE.InstancedMesh(geo, mat, count);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = count;
        parent.add(this.mesh);

        this.pos = new Float32Array(count * 3);
        this.vel = new Float32Array(count * 3);
        this.life = new Float32Array(count);
        this.maxLife = new Float32Array(count);
        this.spin = new Float32Array(count);
        this.next = 0;

        this._m = new THREE.Matrix4();
        this._q = new THREE.Quaternion();
        this._e = new THREE.Euler();
        this._v = new THREE.Vector3();
        this._s = new THREE.Vector3();
        this._color = new THREE.Color();

        // Park every instance at zero scale; `update` is the only thing that revives one.
        this._m.makeScale(0, 0, 0);
        for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, this._m);
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    burst(x, y, z, {
        color = 0xffb703, count = 14, speed = 5, spread = 1, up = 1, life = 0.9,
    } = {}) {
        for (let n = 0; n < count; n++) {
            const i = this.next;
            this.next = (this.next + 1) % this.count;

            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * spread;
            this.pos[i * 3] = x + Math.cos(a) * r * 0.3;
            this.pos[i * 3 + 1] = y + Math.random() * 0.2;
            this.pos[i * 3 + 2] = z + Math.sin(a) * r * 0.3;

            const v = speed * (0.5 + Math.random() * 0.7);
            this.vel[i * 3] = Math.cos(a) * v * spread;
            this.vel[i * 3 + 1] = v * up * (0.6 + Math.random() * 0.8);
            this.vel[i * 3 + 2] = Math.sin(a) * v * spread;

            this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
            this.spin[i] = (Math.random() - 0.5) * 12;
            this.mesh.setColorAt(i, this._color.setHex(color));
        }
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    update(dt) {
        let live = false;
        for (let i = 0; i < this.count; i++) {
            if (this.life[i] <= 0) continue;
            live = true;

            this.life[i] -= dt;
            this.vel[i * 3 + 1] += this.gravity * dt;
            this.pos[i * 3] += this.vel[i * 3] * dt;
            this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
            this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;

            // Bounce once off the floor so debris settles instead of sinking.
            if (this.pos[i * 3 + 1] < 0.05 && this.vel[i * 3 + 1] < 0) {
                this.pos[i * 3 + 1] = 0.05;
                this.vel[i * 3 + 1] *= -0.35;
                this.vel[i * 3] *= 0.6;
                this.vel[i * 3 + 2] *= 0.6;
            }

            const t = Math.max(0, this.life[i] / this.maxLife[i]);
            const scale = this.life[i] > 0 ? 0.4 + t * 0.8 : 0;
            this._e.set(this.life[i] * this.spin[i], this.life[i] * this.spin[i] * 0.7, 0);
            this._q.setFromEuler(this._e);
            this._v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
            this._s.setScalar(scale);
            this._m.compose(this._v, this._q, this._s);
            this.mesh.setMatrixAt(i, this._m);

            if (this.life[i] <= 0) {
                this._m.makeScale(0, 0, 0);
                this.mesh.setMatrixAt(i, this._m);
            }
        }
        if (live) this.mesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.mesh.parent?.remove(this.mesh);
    }
}

/**
 * Small synthesized sounds. No audio files to load, no licensing, and the whole
 * thing stays silent until the first user gesture - which is also the only moment a
 * browser will let an AudioContext start.
 */
export class Sound {
    constructor() {
        this.ctx = null;
        this.enabled = localStorage.getItem('huud-arcade-sound') !== 'off';
    }

    unlock() {
        if (this.ctx) return;
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.18;
        this.master.connect(this.ctx.destination);
    }

    setEnabled(on) {
        this.enabled = on;
        localStorage.setItem('huud-arcade-sound', on ? 'on' : 'off');
    }

    tone(freq, duration = 0.12, type = 'triangle', when = 0) {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime + when;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(1, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain).connect(this.master);
        osc.start(t);
        osc.stop(t + duration + 0.02);
    }

    good()  { this.tone(660, 0.1); this.tone(880, 0.12, 'triangle', 0.08); }
    bad()   { this.tone(180, 0.18, 'sawtooth'); }
    tick()  { this.tone(440, 0.05, 'square'); }
    pickup(){ this.tone(1046, 0.07, 'square'); }
    win()   { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', i * 0.1)); }
}

export const sound = new Sound();
