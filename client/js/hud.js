import { cssColor } from 'shared/palette.js';

/**
 * Everything on top of the canvas that is not a game's own controls: room code,
 * latency, round timer, the 14-row scoreboard, banners, toasts and the reconnect
 * veil. Games get a `panel` element to hang their own buttons in and are expected
 * to leave it as they found it.
 */
export class Hud {
    constructor(selfId) {
        this.selfId = selfId;
        this.players = new Map();

        this.el = {
            hud:       document.getElementById('hud'),
            room:      document.getElementById('hud-room'),
            latency:   document.getElementById('hud-latency'),
            timer:     document.getElementById('hud-timer'),
            banner:    document.getElementById('hud-banner'),
            objective: document.getElementById('hud-objective'),
            toasts:    document.getElementById('hud-toasts'),
            panel:     document.getElementById('hud-panel'),
            scorepad:  document.getElementById('scorepad'),
            scoreList: document.getElementById('scorepad-list'),
            scoresBtn: document.getElementById('hud-scores-btn'),
            countdown: document.getElementById('countdown'),
            veil:      document.getElementById('veil'),
            veilText:  document.getElementById('veil-text'),
        };

        this.panel = this.el.panel;
        this._bannerTimer = null;
        this._countdownTimer = null;
        this._scores = new Map();

        this.el.scoresBtn.addEventListener('click', () => this.toggleScores());
        // On a phone the scorepad covers a third of the play area, so it starts
        // closed there and open on the roomier screens.
        this._scoresOpen = window.innerWidth > 900;
        this._renderScoresVisibility();
    }

    show() { this.el.hud.hidden = false; }

    hide() {
        this.el.hud.hidden = true;
        this.clearPanel();
        this.setObjective('');
        this.hideCountdown();
    }

    // ------------------------------------------------------------------ top bar

    setRoom(code) { this.el.room.textContent = code ?? '----'; }

    setLatency(ms) {
        const dot = this.el.latency.querySelector('.dot');
        const label = this.el.latency.querySelector('span');
        label.textContent = `${ms}ms`;
        dot.classList.toggle('warn', ms >= 80 && ms < 180);
        dot.classList.toggle('bad', ms >= 180);
    }

    setTimer(seconds) {
        const s = Math.max(0, Math.ceil(seconds));
        const m = Math.floor(s / 60);
        this.el.timer.textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
        this.el.timer.classList.toggle('urgent', s <= 10);
    }

    setObjective(text) { this.el.objective.textContent = text ?? ''; }

    // ----------------------------------------------------------------- messages

    banner(text, ms = 1800) {
        this.el.banner.textContent = text;
        this.el.banner.classList.add('show');
        clearTimeout(this._bannerTimer);
        this._bannerTimer = setTimeout(() => this.el.banner.classList.remove('show'), ms);
    }

    toast(text, color = null) {
        const li = document.createElement('div');
        li.className = 'toast';
        li.textContent = text;
        if (color) li.style.borderLeftColor = color;
        this.el.toasts.appendChild(li);
        setTimeout(() => li.remove(), 1700);
        // Four is all that fits above the thumb controls on a phone.
        while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    }

    /** Convenience for the most common toast: "<who> did a thing (+n)". */
    toastFor(playerId, text, points = null) {
        const p = this.players.get(playerId);
        const who = playerId === this.selfId ? 'You' : (p?.name ?? 'Someone');
        const suffix = points != null ? `  +${points}` : '';
        this.toast(`${who} ${text}${suffix}`, p ? cssColor(p.slot) : null);
    }

    countdown(seconds) {
        clearInterval(this._countdownTimer);
        const box = this.el.countdown;
        const span = box.querySelector('span');
        box.hidden = false;
        let left = Math.ceil(seconds);

        const paint = () => {
            if (left <= 0) {
                span.textContent = 'GO!';
                setTimeout(() => this.hideCountdown(), 500);
                clearInterval(this._countdownTimer);
                return;
            }
            // Re-adding the node restarts the pop animation; a class toggle would not.
            span.textContent = String(left);
            span.style.animation = 'none';
            void span.offsetWidth;
            span.style.animation = '';
            left--;
        };
        paint();
        this._countdownTimer = setInterval(paint, 1000);
    }

    hideCountdown() {
        clearInterval(this._countdownTimer);
        this.el.countdown.hidden = true;
    }

    veil(text) {
        this.el.veil.hidden = !text;
        if (text) this.el.veilText.textContent = text;
    }

    // --------------------------------------------------------------- scoreboard

    setPlayers(players) {
        this.players = new Map(players.map((p) => [p.id, p]));
        this.renderScores();
    }

    setScores(board) {
        for (const row of board) this._scores.set(row.i, row.s);
        this.renderScores();
    }

    scoreOf(id) { return this._scores.get(id) ?? 0; }

    renderScores() {
        const rows = [...this.players.values()]
            .map((p) => ({ ...p, score: this._scores.get(p.id) ?? p.score ?? 0 }))
            .sort((a, b) => b.score - a.score || a.slot - b.slot);

        const list = this.el.scoreList;
        list.replaceChildren(...rows.map((p) => {
            const li = document.createElement('li');
            if (p.id === this.selfId) li.className = 'you';
            if (!p.connected) li.classList.add('gone');
            li.innerHTML = '<i class="chip"></i><span class="who"></span><span class="pts"></span>';
            li.querySelector('.chip').style.background = cssColor(p.slot);
            li.querySelector('.who').textContent = p.name;
            li.querySelector('.pts').textContent = Math.round(p.score);
            return li;
        }));
    }

    toggleScores() {
        this._scoresOpen = !this._scoresOpen;
        this._renderScoresVisibility();
    }

    _renderScoresVisibility() {
        this.el.scorepad.hidden = !this._scoresOpen;
        this.el.scoresBtn.setAttribute('aria-expanded', String(this._scoresOpen));
    }

    // -------------------------------------------------------------- game panels

    clearPanel() { this.el.panel.replaceChildren(); }

    /** Builds a DOM control panel from a small description, so games stay 3D-focused. */
    buildPanel(html) {
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        this.el.panel.replaceChildren(...wrap.children);
        return this.el.panel;
    }
}
