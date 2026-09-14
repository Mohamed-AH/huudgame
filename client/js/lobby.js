import { LIMITS } from 'shared/protocol.js';
import { cssColor, slotName } from 'shared/palette.js';
import { listGames, getMeta } from './games/registry.js';

const NAME_KEY = 'huud-arcade-name';

/**
 * The non-3D screens: connect, lobby and results. It renders what the server says
 * and sends back what the player clicks - it holds no authority of its own, and it
 * never decides that a round has started.
 */
export class Lobby {
    constructor(net) {
        this.net = net;
        this.room = null;
        this.picked = null;

        this.el = {
            connect:     document.getElementById('screen-connect'),
            lobby:       document.getElementById('screen-lobby'),
            results:     document.getElementById('screen-results'),
            name:        document.getElementById('name-input'),
            code:        document.getElementById('code-input'),
            createBtn:   document.getElementById('create-btn'),
            joinBtn:     document.getElementById('join-btn'),
            status:      document.getElementById('connect-status'),
            roomCode:    document.getElementById('room-code'),
            copyBtn:     document.getElementById('copy-link-btn'),
            leaveBtn:    document.getElementById('leave-btn'),
            roster:      document.getElementById('roster'),
            count:       document.getElementById('player-count'),
            grid:        document.getElementById('game-grid'),
            pickerHint:  document.getElementById('picker-hint'),
            chosen:      document.getElementById('chosen-game'),
            startBtn:    document.getElementById('start-btn'),
            resultsTitle:document.getElementById('results-title'),
            podium:      document.getElementById('podium'),
            resultsList: document.getElementById('results-list'),
            againBtn:    document.getElementById('again-btn'),
            backBtn:     document.getElementById('back-lobby-btn'),
            resultsHint: document.getElementById('results-hint'),
        };

        this.el.name.value = localStorage.getItem(NAME_KEY) ?? '';
        this._prefillCodeFromUrl();
        this._buildGameGrid();
        this._wire();
    }

    // -------------------------------------------------------------- connect

    _prefillCodeFromUrl() {
        const code = new URLSearchParams(location.search).get('room');
        if (code) this.el.code.value = code.toUpperCase().slice(0, LIMITS.ROOM_CODE_LEN);
    }

    /** A shared link should drop a family member straight into the room. */
    get autoJoinCode() {
        return new URLSearchParams(location.search).get('room')?.toUpperCase() ?? null;
    }

    get playerName() {
        return this.el.name.value.trim().slice(0, LIMITS.NAME_MAX) || 'Player';
    }

    _wire() {
        const remember = () => localStorage.setItem(NAME_KEY, this.playerName);

        this.el.createBtn.addEventListener('click', () => {
            remember();
            this.status('Opening a room…');
            this.onConnect?.(this.playerName, null);
        });

        this.el.joinBtn.addEventListener('click', () => {
            const code = this.el.code.value.trim().toUpperCase();
            if (code.length !== LIMITS.ROOM_CODE_LEN) return this.status('Room codes are 4 letters.', true);
            remember();
            this.status(`Joining ${code}…`);
            this.onConnect?.(this.playerName, code);
        });

        this.el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.el.joinBtn.click(); });
        this.el.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.el.createBtn.click(); });

        this.el.leaveBtn.addEventListener('click', () => this.onLeave?.());
        this.el.startBtn.addEventListener('click', () => this.net.startRound());
        this.el.againBtn.addEventListener('click', () => this.net.restartRound());
        this.el.backBtn.addEventListener('click', () => {
            this.hideResults();
            this.showLobby();
        });

        this.el.copyBtn.addEventListener('click', async () => {
            const link = `${location.origin}${location.pathname}?room=${this.room?.code ?? ''}`;
            try {
                await navigator.clipboard.writeText(link);
                this.el.copyBtn.textContent = 'Copied!';
            } catch {
                // Clipboard is blocked on plain http on some phones; showing the link
                // still lets somebody read it out loud, which is how this actually works.
                this.el.copyBtn.textContent = link;
            }
            setTimeout(() => { this.el.copyBtn.textContent = 'Copy link'; }, 2000);
        });
    }

    status(text, isError = false) {
        this.el.status.textContent = text;
        this.el.status.classList.toggle('error', isError);
    }

    // --------------------------------------------------------------- screens

    showConnect() { this._only('connect'); }
    showLobby()   { this._only('lobby'); }
    hideAll()     { this._only(null); }

    _only(which) {
        this.el.connect.hidden = which !== 'connect';
        this.el.lobby.hidden = which !== 'lobby';
    }

    // ----------------------------------------------------------------- lobby

    _buildGameGrid() {
        this.el.grid.replaceChildren(...listGames().map((g) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'game-tile';
            tile.dataset.gameId = g.id;
            tile.setAttribute('aria-pressed', 'false');
            tile.innerHTML = `
                <span class="emoji">${g.emoji}</span>
                <span class="name"></span>
                <span class="blurb"></span>
                <span class="mode"></span>`;
            tile.querySelector('.name').textContent = g.title;
            tile.querySelector('.blurb').textContent = g.blurb;
            tile.addEventListener('click', () => this.net.pick(g.id));
            return tile;
        }));
    }

    onRoom(msg) {
        this.room = msg;
        this.el.roomCode.textContent = msg.code;
        this.renderRoster(msg);
        this.renderPicker(msg);
    }

    renderRoster(msg) {
        const seated = new Map(msg.players.map((p) => [p.slot, p]));
        const rows = [];
        for (let slot = 0; slot < LIMITS.MAX_PLAYERS; slot++) {
            const p = seated.get(slot);
            const li = document.createElement('li');
            li.innerHTML = '<i class="chip"></i><span class="who"></span><span class="tag"></span>';
            li.querySelector('.chip').style.background = cssColor(slot);

            if (p) {
                li.querySelector('.who').textContent = p.name;
                if (p.id === this.net.id) li.classList.add('you');
                const tags = [];
                if (p.id === msg.hostId) tags.push('host');
                if (p.id === this.net.id) tags.push('you');
                if (!p.connected) tags.push('away');
                li.querySelector('.tag').textContent = tags.join(' · ');
            } else {
                li.className = 'empty';
                li.querySelector('.who').textContent = `${slotName(slot)} seat`;
            }
            rows.push(li);
        }
        this.el.roster.replaceChildren(...rows);
        this.el.count.textContent = `${msg.players.length} / ${LIMITS.MAX_PLAYERS}`;
    }

    renderPicker(msg) {
        const isHost = msg.hostId === this.net.id;
        // Available games come from the server's WELCOME, so a game that failed to
        // load server-side never appears as a tile anyone can pick.
        const available = new Set(this.net.games.map((g) => g.id));

        for (const tile of this.el.grid.children) {
            const id = tile.dataset.gameId;
            const live = available.has(id);
            tile.disabled = !isHost || !live;
            tile.setAttribute('aria-pressed', String(msg.gameId === id));
            tile.querySelector('.mode').textContent = live
                ? (this.net.games.find((g) => g.id === id)?.mode === 'coop' ? 'Team' : 'Free-for-all')
                : 'Coming soon';
            tile.style.display = live ? '' : 'none';
        }

        this.el.pickerHint.textContent = isHost
            ? 'You are the host - pick a game, then press Start.'
            : 'The host is choosing a game.';

        const meta = msg.gameId ? getMeta(msg.gameId) : null;
        const controls = meta ? (matchMedia('(pointer: coarse)').matches ? meta.controls.touch : meta.controls.keyboard) : '';
        this.el.chosen.innerHTML = meta
            ? `<strong>${meta.emoji} ${meta.title}</strong> — ${controls}`
            : 'No game picked yet.';

        this.el.startBtn.disabled = !isHost || !msg.gameId;
        this.el.startBtn.textContent = isHost ? 'Start' : 'Host starts';
    }

    // --------------------------------------------------------------- results

    showResults(end, room) {
        const isHost = room?.hostId === this.net.id;
        const meta = room?.gameId ? getMeta(room.gameId) : null;
        const results = end.results ?? [];
        const coop = this.net.games.find((g) => g.id === room?.gameId)?.mode === 'coop';

        this.el.resultsTitle.textContent = coop
            ? (end.familyScore != null ? `Family score: ${end.familyScore}` : 'Time!')
            : `${meta?.emoji ?? '🏆'} ${meta?.title ?? 'Round'} — results`;

        this.el.podium.replaceChildren(...[1, 0, 2]                 // silver, gold, bronze
            .map((i) => results[i])
            .filter(Boolean)
            .map((r) => {
                const li = document.createElement('li');
                li.className = `p${r.place}`;
                li.innerHTML = `
                    <span class="block">${r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : '🥉'}</span>
                    <span class="who"></span><span class="pts"></span>`;
                li.querySelector('.who').textContent = r.name;
                li.querySelector('.pts').textContent = `${Math.round(r.score)} pts`;
                li.querySelector('.block').style.background =
                    `linear-gradient(180deg, ${cssColor(r.slot)}aa, ${cssColor(r.slot)}22)`;
                return li;
            }));

        this.el.resultsList.replaceChildren(...results.map((r) => {
            const li = document.createElement('li');
            if (r.id === this.net.id) li.className = 'you';
            li.innerHTML = '<span class="place"></span><i class="chip"></i><span class="who"></span><span class="pts"></span>';
            li.querySelector('.place').textContent = `${r.place}.`;
            li.querySelector('.chip').style.background = cssColor(r.slot);
            li.querySelector('.who').textContent = r.name + (r.note ? ` — ${r.note}` : '');
            li.querySelector('.pts').textContent = Math.round(r.score);
            return li;
        }));

        this.el.againBtn.hidden = !isHost;
        this.el.backBtn.hidden = !isHost;
        this.el.resultsHint.textContent = isHost
            ? 'Back to the lobby automatically in a moment.'
            : 'Waiting for the host…';
        this.el.results.hidden = false;
    }

    hideResults() { this.el.results.hidden = true; }
}
