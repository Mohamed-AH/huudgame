/**
 * One input layer for phones, iPads and PCs.
 *
 * Games never ask what device they are on. They read `axes`, `buttons`, `pointer`
 * and `drag`, and optionally hand back `onTap` / `onDragEnd`. Which physical control
 * filled those in - a thumb on a virtual stick, WASD, or a mouse - is this file's
 * problem and nobody else's.
 */

const STICK_RADIUS = 52;     // px of travel before the stick reads as fully deflected
const TAP_SLOP = 12;         // px of movement still counted as a tap, not a drag
const TAP_MS = 350;

export class Input {
    constructor(canvas, dom) {
        this.canvas = canvas;
        this.dom = dom;                      // { controls, stick, knob, btnA, btnB }

        this.axes = { x: 0, y: 0 };          // -1..1, y is "forward"
        this.buttons = { a: false, b: false };
        this.pointer = { x: 0, y: 0, nx: 0, ny: 0, down: false };
        this.drag = { active: false, sx: 0, sy: 0, x: 0, y: 0, dx: 0, dy: 0, power: 0 };
        this.keys = new Set();

        this.onTap = null;                   // (ndc {x,y}, ev) => void
        this.onDragStart = null;
        this.onDragMove = null;
        this.onDragEnd = null;               // (drag) => void
        this.onKey = null;                   // (key) => void, for keypad-style games

        this._edges = { a: false, b: false };
        this._stickId = null;
        this._stickOrigin = { x: 0, y: 0 };
        this._dragId = null;
        this._dragStartedAt = 0;
        this._enabled = false;
        this._layout = { stick: false, a: false, b: false };

        this.touchLikely = matchMedia('(hover: none), (pointer: coarse)').matches;

        this._bind();
    }

    // ------------------------------------------------------------------- setup

    /**
     * Games declare which controls they want. Anything not asked for is hidden, so a
     * keypad game does not leave a dead joystick sitting under the player's thumb.
     */
    setLayout({ stick = false, a = false, b = false, aLabel = 'A', bLabel = 'B' } = {}) {
        this._layout = { stick, a, b };
        const { controls, stick: stickEl, btnA, btnB } = this.dom;
        const anyTouch = (stick || a || b) && this.touchLikely;
        controls.hidden = !anyTouch;
        stickEl.hidden = !stick;
        btnA.hidden = !a;
        btnB.hidden = !b;
        btnA.textContent = aLabel;
        btnB.textContent = bLabel;
        this.reset();
    }

    enable() { this._enabled = true; this.reset(); }
    disable() { this._enabled = false; this.reset(); }

    reset() {
        this.axes.x = this.axes.y = 0;
        this.buttons.a = this.buttons.b = false;
        this._edges.a = this._edges.b = false;
        this.drag.active = false;
        this.pointer.down = false;
        this._stickId = this._dragId = null;
        this.keys.clear();
        this._moveKnob(0, 0);
    }

    /** True once per press. Games poll this rather than subscribing. */
    pressed(button) {
        if (!this._edges[button]) return false;
        this._edges[button] = false;
        return true;
    }

    // ------------------------------------------------------------------ binding

    _bind() {
        const { stick, btnA, btnB } = this.dom;

        stick.addEventListener('pointerdown', (e) => this._stickDown(e));
        stick.addEventListener('pointermove', (e) => this._stickMove(e));
        stick.addEventListener('pointerup', (e) => this._stickUp(e));
        stick.addEventListener('pointercancel', (e) => this._stickUp(e));

        this._bindButton(btnA, 'a');
        this._bindButton(btnB, 'b');

        this.canvas.addEventListener('pointerdown', (e) => this._canvasDown(e));
        this.canvas.addEventListener('pointermove', (e) => this._canvasMove(e));
        this.canvas.addEventListener('pointerup', (e) => this._canvasUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this._canvasUp(e, true));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        window.addEventListener('keydown', (e) => this._key(e, true));
        window.addEventListener('keyup', (e) => this._key(e, false));
        // A tab switch mid-press would otherwise leave a key stuck down forever.
        window.addEventListener('blur', () => this.reset());
    }

    _bindButton(el, name) {
        const down = (e) => {
            e.preventDefault();
            if (!this._enabled) return;
            el.setPointerCapture?.(e.pointerId);
            if (!this.buttons[name]) this._edges[name] = true;
            this.buttons[name] = true;
        };
        const up = (e) => {
            e.preventDefault();
            this.buttons[name] = false;
        };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
    }

    // ------------------------------------------------------------------- stick

    _stickDown(e) {
        if (!this._enabled || this._stickId !== null) return;
        e.preventDefault();
        const rect = this.dom.stick.getBoundingClientRect();
        this._stickId = e.pointerId;
        this._stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        this.dom.stick.setPointerCapture(e.pointerId);
        this._stickMove(e);
    }

    _stickMove(e) {
        if (this._stickId !== e.pointerId) return;
        e.preventDefault();
        let dx = e.clientX - this._stickOrigin.x;
        let dy = e.clientY - this._stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        this.axes.x = dx / STICK_RADIUS;
        this.axes.y = -dy / STICK_RADIUS;          // screen-down is world-backward
        this._moveKnob(dx, dy);
    }

    _stickUp(e) {
        if (this._stickId !== e.pointerId) return;
        this._stickId = null;
        this.axes.x = this.axes.y = 0;
        this._moveKnob(0, 0);
    }

    _moveKnob(dx, dy) {
        this.dom.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    }

    // ------------------------------------------------------------------ pointer

    _ndc(e) {
        return {
            x: (e.clientX / window.innerWidth) * 2 - 1,
            y: -(e.clientY / window.innerHeight) * 2 + 1,
        };
    }

    _canvasDown(e) {
        if (!this._enabled) return;
        // Let a second finger work the stick or a button without stealing the aim.
        if (this._dragId !== null) return;
        this.canvas.setPointerCapture?.(e.pointerId);
        this._dragId = e.pointerId;
        this._dragStartedAt = performance.now();

        const ndc = this._ndc(e);
        Object.assign(this.pointer, ndc, { down: true });
        Object.assign(this.drag, {
            active: true,
            sx: e.clientX, sy: e.clientY,
            x: e.clientX, y: e.clientY,
            dx: 0, dy: 0, power: 0,
            nx: ndc.x, ny: ndc.y,
        });
        this.onDragStart?.(this.drag, e);
    }

    _canvasMove(e) {
        if (!this._enabled) return;
        const ndc = this._ndc(e);
        this.pointer.x = ndc.x;
        this.pointer.y = ndc.y;
        if (this._dragId !== e.pointerId) return;

        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.drag.dx = e.clientX - this.drag.sx;
        this.drag.dy = e.clientY - this.drag.sy;
        // Power saturates at a quarter of the short screen edge, so the same flick
        // means the same throw on a phone and on a desktop monitor.
        const reach = Math.min(window.innerWidth, window.innerHeight) * 0.25;
        this.drag.power = Math.min(1, Math.hypot(this.drag.dx, this.drag.dy) / reach);
        this.drag.nx = ndc.x;
        this.drag.ny = ndc.y;
        this.onDragMove?.(this.drag, e);
    }

    _canvasUp(e, cancelled = false) {
        if (this._dragId !== e.pointerId) return;
        this._dragId = null;
        this.pointer.down = false;
        this.drag.active = false;
        if (cancelled) return;

        const moved = Math.hypot(this.drag.dx, this.drag.dy);
        const quick = performance.now() - this._dragStartedAt < TAP_MS;
        if (moved < TAP_SLOP && quick) this.onTap?.(this._ndc(e), e);
        else this.onDragEnd?.(this.drag, e);
    }

    // ----------------------------------------------------------------- keyboard

    _key(e, down) {
        if (!this._enabled) return;
        if (e.target instanceof HTMLInputElement) return;   // typing a name, not playing

        const k = e.key.toLowerCase();
        if (down) this.keys.add(k); else this.keys.delete(k);

        const held = (...names) => names.some((n) => this.keys.has(n));
        this.axes.x = (held('d', 'arrowright') ? 1 : 0) - (held('a', 'arrowleft') ? 1 : 0);
        this.axes.y = (held('w', 'arrowup') ? 1 : 0) - (held('s', 'arrowdown') ? 1 : 0);

        const setBtn = (name, isDown) => {
            if (isDown && !this.buttons[name]) this._edges[name] = true;
            this.buttons[name] = isDown;
        };
        setBtn('a', held(' ', 'enter'));
        setBtn('b', held('e', 'shift'));

        if (down && !e.repeat) this.onKey?.(k, e);
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    }
}
