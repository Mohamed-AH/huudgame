import * as THREE from 'three';

/**
 * The rendering half of the client: one renderer, one scene, one camera, reused by
 * every game. Games add their scene graph under `engine.root`, which is what gets
 * torn down - geometry, material and texture included - between rounds.
 *
 * The whole suite shares one lighting rig (see docs/GDD.md §4). Shadow maps are off
 * everywhere: the flat-shaded low-poly look reads from facets, and shadow maps are
 * the single most expensive thing a low-end phone can be asked to do.
 */
export class Engine {
    constructor(canvas) {
        this.canvas = canvas;

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: window.devicePixelRatio < 2,   // needless above 2x, and costly
            powerPreference: 'high-performance',
            alpha: false,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = false;
        this.renderer.setClearColor(0x0b0c10, 1);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x0b0c10, 42, 90);

        this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 220);
        this.camera.position.set(0, 14, 20);
        this.camera.lookAt(0, 0, 0);

        this.hemi = new THREE.HemisphereLight(0xdfe7ff, 0x2a2418, 0.85);
        this.sun = new THREE.DirectionalLight(0xfff3d6, 0.55);
        this.sun.position.set(8, 18, 6);
        this.scene.add(this.hemi, this.sun);

        /** Everything a game builds lives here and nowhere else. */
        this.root = new THREE.Group();
        this.scene.add(this.root);

        this._lastFrameAt = 0;
        this.width = 1;
        this.height = 1;
        this._raf = null;
        this._onFrame = null;
        this._resizeRaf = null;
        this._hidden = false;

        this._boundResize = () => this._queueResize();
        window.addEventListener('resize', this._boundResize);
        window.addEventListener('orientationchange', this._boundResize);

        // A backgrounded tab should not keep burning a phone battery on a scene
        // nobody is looking at; the server keeps running and we catch up on return.
        document.addEventListener('visibilitychange', () => {
            this._hidden = document.hidden;
            this._lastFrameAt = performance.now();   // drop the gap
        });

        this.resize();
    }

    // ------------------------------------------------------------------ sizing

    _queueResize() {
        cancelAnimationFrame(this._resizeRaf);
        this._resizeRaf = requestAnimationFrame(() => this.resize());
    }

    resize() {
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        if (w === this.width && h === this.height) return;
        this.width = w;
        this.height = h;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.onResize?.(w, h);
    }

    // ------------------------------------------------------------------ looping

    start(onFrame) {
        this._onFrame = onFrame;
        if (this._raf) return;
        this._lastFrameAt = performance.now();
        const loop = (now) => {
            this._raf = requestAnimationFrame(loop);
            if (this._hidden) return;
            // Clamped: coming back from a locked phone must not hand a game a 40s step.
            const dt = Math.min(0.1, (now - this._lastFrameAt) / 1000);
            this._lastFrameAt = now;
            this._onFrame?.(dt, now);
            this.renderer.render(this.scene, this.camera);
        };
        this._raf = requestAnimationFrame(loop);
    }

    stop() {
        cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    // ----------------------------------------------------------------- teardown

    /**
     * Empties `root` and releases every GPU resource under it. Without this, thirteen
     * games in one sitting is thirteen scene graphs' worth of leaked VRAM.
     */
    clearRoot() {
        disposeChildren(this.root);
        this.scene.fog.near = 42;
        this.scene.fog.far = 90;
        this.scene.background = null;
        this.camera.fov = 55;
        this.camera.position.set(0, 14, 20);
        this.camera.rotation.set(0, 0, 0);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
    }

    dispose() {
        this.stop();
        window.removeEventListener('resize', this._boundResize);
        window.removeEventListener('orientationchange', this._boundResize);
        this.clearRoot();
        this.renderer.dispose();
    }
}

export function disposeObject(obj) {
    obj.traverse?.((node) => {
        node.geometry?.dispose?.();
        const mat = node.material;
        if (Array.isArray(mat)) mat.forEach(disposeMaterial);
        else if (mat) disposeMaterial(mat);
    });
}

function disposeMaterial(mat) {
    for (const key of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'aoMap', 'lightMap']) {
        mat[key]?.dispose?.();
    }
    mat.dispose?.();
}

export function disposeChildren(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
        const child = group.children[i];
        group.remove(child);
        disposeObject(child);
    }
}
