// A running game session: owns the renderer, the simulation loop, input and the HUD.
// The loop only works when something changes: paused and idle, it schedules no frames.
import { h, mount } from './dom.js';
import { MapRenderer } from '../map/renderer.js';
import { buildIndex, pickProvince } from '../map/picking.js';
import { MAP_MODES, MODE_LEGENDS } from '../map/modes.js';
import { eraOf, researchPoints, techCost } from '../core/technology.js';
import { TREATIES } from '../core/diplomacy.js';

const TREATY_NAMES = Object.fromEntries(Object.entries(TREATIES).map(([k, t]) => [k, t.name.toLowerCase()]));
import { tick } from '../core/sim.js';
import { formatDate, civilFromDays, dateString } from '../core/calendar.js';
import { saveGame } from '../core/game.js';
import { orderMove } from '../core/military.js';
import { orderFleet, canDockAt, zoneController } from '../core/naval.js';
import { rebaseWing } from '../core/air.js';
import { zoneAt, portZonesOf } from '../core/mapdata.js';
import { computeLedgers } from '../core/economy.js';
import { isAtWar } from '../core/relations.js';
import { flagCanvas, setFlagScenario } from './flags.js';
import { sfx, setMood, moodFor } from './audio.js';
import { toggleConsole } from './cheats.js';
import { leaderboardDialog, starBadge } from './leaderboard.js';
import { startTutorial, offerTutorial } from './tutorial.js';
import { money, signedMoney, people, pct } from './format.js';
import { writeSave, rotateAutosaves } from './storage.js';
import { renderPanel, renderProvince, TABS } from './panels.js';
import { icon } from './icons.js';
import { saveDialog, peaceDialog, menuDialog, reportDialog, separatePeaceDialog, eventDialog } from './dialogs.js';

export const SPEEDS = [0, 1, 3, 8, 20, 0]; // days per second; 5 = as fast as the frame budget allows

// Sound for a notification: [name, priority].
function soundFor(l) {
  const t = l.text;
  if (/nuclear/i.test(t) && /destroyed|strike/.test(t)) return ['explosion', 9];
  if (l.type === 'war' && /declared war/.test(t)) return ['war', 8];
  if (l.type === 'peace') return ['peace', 7];
  if (l.type === 'battle' && / won/.test(t)) return ['victory', 5];
  if (l.type === 'battle' && / lost/.test(t)) return ['defeat', 5];
  if (l.type === 'research' && /researched|era/.test(t)) return ['research', 4];
  return ['notify', 1];
}

export class Client {
  constructor(root, data, game, opts) {
    this.root = root; this.data = data; this.game = game; this.opts = opts;
    this.mode = opts.mode; // 'pick' | 'play'
    this.view = { hover: -1, selected: -1, selectedCountry: -1, selectedArmies: new Set(), selectedFleets: new Set(), selectedWings: new Set(), highlight: null };
    this.speed = 0; this.acc = 0; this.lastFrame = 0;
    this.tab = 'country';
    this.logSeen = game.state.logSeq || 0;
    this.uiDirty = true; this.lastUi = 0;
    this.index = buildIndex(game.map);
    setFlagScenario(game.state.scenarioId, game.state.countries);
    this.updateMood();
    this.build();
    this.renderer = new MapRenderer(this.canvas, game.map);
    this.renderer.rules = game.rules;
    this.renderer.setProfile(data.settings.profile, data.settings.resolution);
    this.renderer.fit();
    if (game.state.player >= 0) this.focusCountry(game.state.player, false);
    this.bind();
    this.toggleSidebar(true);
    this.lastMapVersion = game.state.mapVersion || 0;
    this.lastRel = game.state.relVersion || 0;
    this.lastMonth = civilFromDays(game.state.day).m;
    this.frameReq = 0;
    this.perf = { frames: 0, frameTimes: [], tickMs: 0, ticks: 0 };
    this.requestFrame();
  }

  get state() { return this.game.state; }

  destroy() {
    cancelAnimationFrame(this.frameReq);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerup', this.onRelease, true);
    window.removeEventListener('pointercancel', this.onRelease, true);
    document.removeEventListener('visibilitychange', this.onHide);
    this.root.innerHTML = '';
  }

  // ------------------------------------------------------------------ layout
  build() {
    this.canvas = h('canvas.map-canvas');
    this.topbar = h('div.topbar');
    this.tabsEl = h('div.tabs');
    this.panelEl = h('div.panel');
    this.sidebar = h('div.sidebar', this.tabsEl, this.panelEl);
    this.sideToggle = h('button.side-toggle', { on: { click: () => this.toggleSidebar() } });
    this.provEl = h('div.prov-panel.hidden');
    this.modesEl = h('div.modes');
    this.legendEl = h('div.legend', { style: { display: 'none' } });
    this.toastsEl = h('div.toasts');
    this.hoverEl = h('div.hover-info', { style: { display: 'none' } });
    this.bannerEl = h('div.pick-banner', { style: { display: 'none' } });
    this.tooltip = h('div.tooltip', { style: { display: 'none' } });
    this.el = h('div.game', this.canvas, this.topbar, this.sidebar, this.sideToggle, this.modesEl, this.legendEl, this.provEl, this.hoverEl, this.bannerEl, this.toastsEl, this.tooltip);
    mount(this.root, this.el);
    this.renderModes();
    // The interface is rebuilt several times a second while time runs. A rebuild between pointer
    // down and up replaces the button under the pointer, and the browser then delivers the click
    // to nothing, so presses failed at random. Rebuilds wait while a button is held (released
    // after 1.5 s in case the pointer-up is lost) and while a list or text box has the focus.
    this.holdAt = 0;
    this.el.addEventListener('pointerdown', (e) => { if (e.target !== this.canvas) this.holdAt = performance.now(); }, true);
    // after a press, show its result on the next frame instead of waiting for the redraw slot
    this.onRelease = () => { if (this.holdAt) { this.holdAt = 0; this.lastUi = 0; this.requestFrame(); } };
    window.addEventListener('pointerup', this.onRelease, true);
    window.addEventListener('pointercancel', this.onRelease, true);
    // a chosen list entry should not keep the list focused (and the panel frozen)
    this.el.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.blur(); });
  }

  uiHeld() {
    if (this.holdAt && performance.now() - this.holdAt < 1500) return true;
    const a = document.activeElement;
    return !!a && this.el.contains(a) && (a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(a.type)));
  }

  renderModes() {
    // icon buttons, with the current mode's name after them (tooltips name the others)
    const cur = this.renderer?.mode || 'political';
    mount(this.modesEl, MAP_MODES.map((m) => h('button' + (cur === m.id ? '.on' : ''),
      { tip: `${m.name} map\n${m.tip}\nShortcut: ${m.key.toUpperCase()}`, 'aria-label': m.name, on: { click: () => this.setMapMode(m.id) } }, icon(m.id))),
    h('span.mode-name', MAP_MODES.find((m) => m.id === cur)?.name || ''));
    const L = MODE_LEGENDS[this.renderer?.mode];
    if (L) {
      this.legendEl.style.display = '';
      mount(this.legendEl, L.map(([n, c]) => h('div', h('i', { style: { background: c } }), n)));
      // the mode bar wraps onto two rows on narrow screens; keep the legend above it
      requestAnimationFrame(() => { this.legendEl.style.bottom = `calc(${this.modesEl.offsetHeight}px + 1.1em)`; });
    } else this.legendEl.style.display = 'none';
  }

  setMapMode(id) {
    this.renderer.mode = id;
    this.renderer.invalidate();
    this.renderModes();
    this.requestFrame();
  }

  // ------------------------------------------------------------------ input
  bind() {
    const cv = this.canvas;
    // Mouse: drag pans, left click selects, right click orders. Touch: one finger drags or taps
    // (a tap selects), two fingers pan and pinch-zoom, and a long press orders like a right click.
    let down = null;
    const touches = new Map(); // pointerId -> { x, y } for touch pointers
    let pinch = null; // { d, x, y } distance and midpoint of the two touches
    const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pinchState = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { // second finger: no tap or long press, start pinching
          if (down) { clearTimeout(down.timer); down.drag = true; }
          pinch = pinchState();
          return;
        }
        if (touches.size > 2) return;
      }
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, button: e.button, drag: false, shift: e.shiftKey, id: e.pointerId };
      if (e.pointerType === 'touch') {
        down.timer = setTimeout(() => {
          if (!down || down.drag) return;
          const [sx, sy] = local(e);
          down.done = true;
          if (navigator.vibrate) navigator.vibrate(15);
          this.rightClick(sx, sy);
          this.requestFrame();
        }, 500);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const [sx, sy] = local(e);
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touches.size === 2) {
          const p = pinchState(), r = cv.getBoundingClientRect();
          this.renderer.pan(p.x - pinch.x, p.y - pinch.y);
          this.renderer.zoomAt(p.x - r.left, p.y - r.top, p.d / pinch.d);
          pinch = p;
          this.requestFrame();
          return;
        }
      }
      if (down && down.id === e.pointerId) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.drag && Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 10 : 4)) { down.drag = true; clearTimeout(down.timer); }
        if (down.drag) {
          this.renderer.pan(e.clientX - down.lx, e.clientY - down.ly);
          down.lx = e.clientX; down.ly = e.clientY;
          cv.style.cursor = 'grabbing';
          this.requestFrame();
          return;
        }
      }
      if (e.pointerType !== 'touch') this.hoverAt(sx, sy);
    });
    const up = (e) => {
      const [sx, sy] = local(e);
      cv.style.cursor = 'default';
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
      }
      if (down && down.id === e.pointerId) {
        clearTimeout(down.timer);
        if (!down.drag && !down.done && e.type === 'pointerup') {
          if (down.button === 0) this.click(sx, sy, e.shiftKey);
          else if (down.button === 2) this.rightClick(sx, sy);
        }
        down = null;
      }
      this.requestFrame();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.view.hover = -1; this.hoverEl.style.display = 'none'; this.requestFrame(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0015, -e.deltaY));
      this.requestFrame();
    }, { passive: false });
    this.onResize = () => { this.renderer.resize(); this.requestFrame(); };
    window.addEventListener('resize', this.onResize);
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    // pause when the window is hidden (minimised, or the Android app sent to the background)
    this.onHide = () => { if (document.hidden && this.speed) this.togglePause(); };
    document.addEventListener('visibilitychange', this.onHide);
    // tooltips for any element with data-tip
    this.el.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t || !this.data.settings.tooltips) { this.tooltip.style.display = 'none'; return; }
      this.tooltip.textContent = t.dataset.tip;
      this.tooltip.style.display = '';
      const r = t.getBoundingClientRect();
      const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
      let x = r.left, y = r.bottom + 6;
      if (x + tw > window.innerWidth - 4) x = window.innerWidth - tw - 4;
      if (y + th > window.innerHeight - 4) y = r.top - th - 6;
      this.tooltip.style.left = x + 'px'; this.tooltip.style.top = y + 'px';
    });
    this.el.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) this.tooltip.style.display = 'none'; });
  }

  key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || document.querySelector('.dialog-wrap')) {
      if (e.key === 'Escape') document.querySelector('.dialog-wrap')?.remove();
      return;
    }
    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); this.togglePause(); }
    else if (/^[1-5]$/.test(e.key)) this.setSpeed(+e.key);
    else if (e.key === 'Escape') { this.clearSelection(); }
    else if (e.key === '+' || e.key === '=') { this.renderer.zoomAt(this.renderer.vw / 2, this.renderer.vh / 2, 1.25); }
    else if (e.key === '-') { this.renderer.zoomAt(this.renderer.vw / 2, this.renderer.vh / 2, 0.8); }
    else if (e.key.startsWith('Arrow')) {
      const d = 80;
      this.renderer.pan(e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
    } else if (e.ctrlKey && k === 's') { e.preventDefault(); this.quickSave(); }
    else if ((e.key === '`' || e.code === 'Backquote') && this.data.settings.cheats) { e.preventDefault(); toggleConsole(this); }
    else if (e.key === 'Tab') { e.preventDefault(); this.toggleSidebar(); }
    else if (k === 'h') { this.renderer.fit(); }
    else if (k === 'c' && this.state.player >= 0) this.focusCountry(this.state.player);
    else {
      const m = MAP_MODES.find((x) => x.key === k);
      if (m && !e.ctrlKey && !e.metaKey) this.setMapMode(m.id);
      const t = TABS.find((x) => x.key === k);
      if (t && !e.ctrlKey && !e.metaKey && this.mode === 'play') this.setTab(t.id);
    }
    this.requestFrame();
  }

  hoverAt(sx, sy) {
    const [wx, wy] = this.renderer.screenToWorld(sx, sy);
    const p = pickProvince(this.game.map, this.index, wx, wy);
    if (p !== this.view.hover) {
      this.view.hover = p;
      if (p >= 0) {
        const s = this.state, own = s.prov.owner[p], ctl = s.prov.controller[p];
        const C = s.countries;
        this.hoverEl.textContent = `${this.game.map.name[p]} — ${C[own]?.name ?? 'Unclaimed'}` + (ctl !== own && ctl >= 0 ? ` (occupied by ${C[ctl].name})` : '');
        this.hoverEl.style.display = '';
      } else this.hoverEl.style.display = 'none';
      this.requestFrame();
    }
    // over the sea: the zone's name and who holds it
    if (p < 0) {
      const z = zoneAt(this.game.map, wx, wy);
      if (z !== this.hoverZone) {
        this.hoverZone = z;
        if (z >= 0) {
          const k = zoneController(this.state, this.game.map, this.game.rules, z);
          this.hoverEl.textContent = this.game.map.sea.zones[z].name + (k >= 0 ? ` — controlled by ${this.state.countries[k].name}` : '');
          this.hoverEl.style.display = '';
        } else this.hoverEl.style.display = 'none';
      }
    } else this.hoverZone = -1;
  }

  click(sx, sy, shift) {
    const hit = this.mode === 'play' ? this.renderer.unitAt(sx, sy) : null;
    if (hit) {
      const v = this.view, s = this.state;
      const sets = { army: v.selectedArmies, fleet: v.selectedFleets, wing: v.selectedWings };
      const set = sets[hit.kind];
      // one kind of force is selected at a time
      if (!shift) for (const k in sets) sets[k].clear();
      else for (const k in sets) if (k !== hit.kind) sets[k].clear();
      const ids = hit.ids || [hit.id]; // a wing mark stands for every wing of that country at the base
      if (set.has(hit.id) && shift) for (const id of ids) set.delete(id); else for (const id of ids) set.add(id);
      const x = hit.kind === 'army' ? s.armies.find((a) => a.id === hit.id) : hit.kind === 'fleet' ? s.fleets.find((f) => f.id === hit.id) : s.wings.find((w) => w.id === hit.id);
      if (x.owner === s.player) this.setTab('military');
      if (hit.kind === 'army' && !(x.sea >= 0)) v.selected = x.loc;
      else if (hit.kind === 'fleet' && x.port >= 0) v.selected = x.port;
      else if (hit.kind === 'wing') v.selected = x.base;
      this.uiDirty = true;
      return;
    }
    const [wx, wy] = this.renderer.screenToWorld(sx, sy);
    const p = pickProvince(this.game.map, this.index, wx, wy);
    if (p < 0) { this.clearSelection(); return; }
    // in the military tab, clicking a province with your forces selected keeps them selected
    if (!shift) { this.view.selectedArmies.clear(); this.view.selectedFleets.clear(); this.view.selectedWings.clear(); this.view.highlight = null; }
    this.selectProvince(p);
  }

  // Right-click orders the selected forces: armies march (by sea if needed), fleets sail to the
  // clicked sea zone or dock in the clicked port, air wings rebase to the clicked province.
  rightClick(sx, sy) {
    const v = this.view;
    if (this.mode !== 'play' || !(v.selectedArmies.size || v.selectedFleets.size || v.selectedWings.size)) return;
    const s = this.state, map = this.game.map, R = this.game.rules;
    const [wx, wy] = this.renderer.screenToWorld(sx, sy);
    const p = pickProvince(map, this.index, wx, wy);
    const errs = [];
    for (const id of v.selectedArmies) {
      const a = s.armies.find((x) => x.id === id);
      if (!a || a.owner !== s.player || p < 0) continue;
      const err = orderMove(s, map, R, id, p);
      if (err) errs.push(`${a.name}: ${err}`);
    }
    for (const id of v.selectedFleets) {
      const f = s.fleets.find((x) => x.id === id);
      if (!f || f.owner !== s.player) continue;
      let err;
      if (p >= 0) err = portZonesOf(map, p).length && canDockAt(s, map, f.owner, p) ? orderFleet(s, map, R, id, { prov: p }) : 'Fleets can only enter friendly ports; right-click the sea to sail';
      else { const z = zoneAt(map, wx, wy); err = z >= 0 ? orderFleet(s, map, R, id, { zone: z }) : 'Right-click a sea zone'; }
      if (err) errs.push(`${f.name}: ${err}`);
    }
    for (const id of v.selectedWings) {
      const w = s.wings.find((x) => x.id === id);
      if (!w || w.owner !== s.player || p < 0) continue;
      const err = rebaseWing(s, map, R, id, p);
      if (err) errs.push(`${w.name}: ${err}`);
    }
    if (errs.length) this.toast(errs[0], true);
    this.uiDirty = true;
  }

  selectProvince(p) {
    this.view.selected = p;
    this.view.selectedCountry = this.state.prov.owner[p];
    if (this.renderer.mode === 'diplomacy') { this.renderer.focus = this.view.selectedCountry; this.renderer.invalidate(); }
    this.uiDirty = true;
    this.requestFrame();
  }

  clearSelection() {
    this.view.selected = -1; this.view.selectedCountry = -1; this.view.selectedArmies.clear(); this.view.selectedFleets.clear(); this.view.selectedWings.clear(); this.view.highlight = null;
    if (this.renderer.mode === 'diplomacy') { this.renderer.focus = this.state.player; this.renderer.invalidate(); }
    this.uiDirty = true;
  }

  focusCountry(c, select = true) {
    const cap = this.state.countries[c].capital;
    if (cap >= 0) this.renderer.centerOn(this.game.map.x[cap], this.game.map.y[cap], Math.max(this.renderer.cam.z, 1.1));
    if (select && cap >= 0) this.selectProvince(cap);
    this.requestFrame();
  }

  focusProvince(p) {
    this.renderer.centerOn(this.game.map.x[p], this.game.map.y[p], Math.max(this.renderer.cam.z, 1.6));
    this.selectProvince(p);
  }

  setTab(id) { this.tab = id; if (this.sidebar.classList.contains('hidden')) this.toggleSidebar(); this.uiDirty = true; this.requestFrame(); }

  // hides or shows the side panel (tabs and their contents) to see more of the map
  toggleSidebar(show = this.sidebar.classList.contains('hidden')) {
    this.sidebar.classList.toggle('hidden', !show);
    mount(this.sideToggle, icon(show ? 'collapse' : 'expand'));
    this.sideToggle.dataset.tip = (show ? 'Hide the side panel to see more of the map' : 'Show the side panel') + ' (Tab)';
    this.sideToggle.setAttribute('aria-label', show ? 'Hide the side panel' : 'Show the side panel');
    this.requestFrame();
  }

  // ------------------------------------------------------------------ simulation control
  setSpeed(n) {
    if (this.mode !== 'play' || this.state.gameOver) return;
    this.resumeSpeed = 0; // the player chose a speed: no automatic resume
    this.speed = n; this.acc = 0; this.uiDirty = true; this.requestFrame();
  }
  // An event that needs a decision pauses the game; once it is decided the game resumes at the
  // speed it had (unless the player changed the speed meanwhile, or turned this off in Settings).
  autoPause() {
    if (!this.speed) return;
    const was = this.speed;
    this.setSpeed(0);
    this.resumeSpeed = was;
  }
  autoResume() {
    const s = this.state;
    const next = s.pendingEvents.find((p) => p.c === s.player && !p.shown);
    if (next) { next.shown = true; this.openEvent(next); return; } // decide the next one first
    if (this.resumeSpeed && this.data.settings.resumeAfterEvents !== false && !this.el.querySelector('.dialog-wrap')) {
      const n = this.resumeSpeed;
      this.setSpeed(n);
    }
  }
  togglePause() {
    if (this.speed) { this.pausedSpeed = this.speed; this.setSpeed(0); } else this.setSpeed(this.pausedSpeed || 2);
  }

  startPlaying(countryIdx) {
    const s = this.state, newGame = this.mode === 'pick';
    s.player = countryIdx;
    this.mode = 'play';
    this.bannerEl.style.display = 'none';
    this.updateMood();
    this.renderer.focus = countryIdx;
    this.renderer.invalidate();
    if (countryIdx >= 0) this.focusCountry(countryIdx);
    this.tab = 'country';
    computeLedgers(s, this.game.map, this.game.rules);
    this.uiDirty = true;
    this.toast(countryIdx >= 0 ? `You lead ${s.countries[countryIdx].name}. Press Space to start time.` : 'Observer mode: the AI runs every country. Press Space to start time.');
    // a new game: offer the tutorial once the screen has been drawn
    if (newGame && countryIdx >= 0) setTimeout(() => offerTutorial(this), 300);
  }

  // a setting changed in the settings dialog
  applySetting(key) {
    const s = this.data.settings;
    if (key === 'profile' || key === 'resolution') this.renderer.setProfile(s.profile, s.resolution);
    if (key === 'tooltips' && !s.tooltips) this.tooltip.style.display = 'none';
    if (key === 'uiScale') this.renderer.resize();
    this.renderer.invalidate();
    this.uiDirty = true;
    this.requestFrame();
  }

  requestFrame() {
    if (!this.frameReq) this.frameReq = requestAnimationFrame((t) => { this.frameReq = 0; this.frame(t); });
  }

  frame(now) {
    // frame rate limit: skip this display frame if the last drawn one was too recent
    const cap = this.data.settings.fpsCap;
    if (cap && this.lastFrame && now - this.lastFrame < 1000 / cap - 2) { this.requestFrame(); return; }
    const dt = this.lastFrame ? Math.min(0.25, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    let ticked = 0;
    if (this.speed > 0 && !this.state.gameOver) {
      const t0 = performance.now();
      const budget = this.data.settings.profile === 'low' ? 10 : 14;
      if (this.speed === 5) {
        while (performance.now() - t0 < budget) { this.doTick(); ticked++; }
      } else {
        this.acc += dt * SPEEDS[this.speed];
        while (this.acc >= 1 && performance.now() - t0 < budget) { this.acc -= 1; this.doTick(); ticked++; }
        if (this.acc > 3) this.acc = 3; // drop backlog rather than spiral
      }
      if (ticked) {
        const ms = performance.now() - t0;
        this.perf.tickMs = ms / ticked; this.perf.ticks += ticked;
      }
    }
    if (ticked) this.afterTicks();
    const s = this.state;
    // treaties change often once the AI does diplomacy; only the modes that colour by relations repaint for them
    const relChanged = (s.relVersion || 0) !== this.lastRel && (this.renderer.mode === 'diplomacy' || this.renderer.mode === 'military');
    if ((s.mapVersion || 0) !== this.lastMapVersion || relChanged) {
      this.lastMapVersion = s.mapVersion || 0; this.lastRel = s.relVersion || 0;
      this.renderer.invalidate();
    }
    if (this.renderer.mode === 'diplomacy' && this.renderer.focus < 0) this.renderer.focus = s.player;
    if (['military', 'naval', 'supply'].includes(this.renderer.mode) && this.renderer.focus !== s.player) { this.renderer.focus = s.player; this.renderer.invalidate(); }
    const tr = performance.now();
    this.renderer.draw(s, this.view);
    this.perf.frames++;
    this.perf.frameTimes.push(performance.now() - tr);
    if (this.perf.frameTimes.length > 120) this.perf.frameTimes.shift();
    if (this.uiDirty && !this.uiHeld() && performance.now() - this.lastUi > (ticked ? this.renderer.profile.uiMs : 0)) {
      this.renderUi(); this.uiDirty = false; this.lastUi = performance.now();
    }
    // keep animating while time runs, the camera is settling, or UI waits for its slot
    const settling = this.renderer.cacheCam && (this.renderer.cacheCam.z !== this.renderer.cam.z || this.renderer.cacheCam.cx !== this.renderer.cam.cx || this.renderer.cacheCam.cy !== this.renderer.cam.cy);
    if (this.speed > 0 || settling || this.uiDirty) this.requestFrame();
    else this.lastFrame = 0;
  }

  doTick() {
    const { monthly } = tick(this.game);
    if (monthly) {
      const s = this.state;
      const m = civilFromDays(s.day).m;
      if (this.renderer.mode !== 'political') this.renderer.invalidate();
      const every = s.settings.autosaveMonths;
      if (every > 0 && this.mode === 'play' && (m - 1) % every === 0 && m !== this.lastMonth) this.autosave();
      this.lastMonth = m;
    } else if ((this.renderer.mode === 'military' || this.renderer.mode === 'naval' || this.renderer.mode === 'supply') && this.state.day % 5 === 0) this.renderer.invalidate();
  }

  afterTicks() {
    const s = this.state;
    this.uiDirty = true;
    // toasts for important new notifications concerning the player
    let sound = null, rank = 0;
    for (const l of s.log) {
      if (l.seq <= this.logSeen) continue;
      if (l.important || (l.type === 'battle' && l.report)) {
        this.toast(l.text, l.important, l.prov);
        // the most significant new notification gets a sound
        const [name, r] = soundFor(l);
        if (r > rank) { sound = name; rank = r; }
      }
    }
    if (sound) sfx(sound);
    if (s.day - (this.moodDay ?? -99) >= 15) this.updateMood();
    this.logSeen = s.logSeq || 0;
    if (s.offers.some((o) => o.to === s.player && !o.notified)) {
      for (const o of s.offers) {
        if (o.to !== s.player || o.notified) continue;
        o.notified = true;
        const who = s.countries[o.from].name;
        const what = { treaty: `proposes a ${TREATY_NAMES[o.type] || 'treaty'}`, call: 'calls you to arms', separate: 'asks for a separate peace' }[o.kind] || 'offers peace';
        this.toast(`${who} ${what}. See the Diplomacy tab.`, o.kind !== 'treaty');
        sfx('notify');
        if (this.speed && o.kind !== 'treaty') this.setSpeed(0);
      }
    }
    // a domestic event waits for the player's decision
    const ev = s.pendingEvents.find((p) => p.c === s.player && !p.shown);
    if (ev && this.mode === 'play') { ev.shown = true; this.autoPause(); this.openEvent(ev); }
    if (s.gameOver && !this.gameOverShown) {
      this.gameOverShown = true; this.speed = 0;
      this.toast(`Game over: ${s.gameOver.reason}`, true);
    }
    // drop selections of armies that no longer exist
    for (const id of [...this.view.selectedArmies]) if (!s.armies.some((a) => a.id === id)) this.view.selectedArmies.delete(id);
    for (const id of [...this.view.selectedFleets]) if (!s.fleets.some((f) => f.id === id)) this.view.selectedFleets.delete(id);
    for (const id of [...this.view.selectedWings]) if (!s.wings.some((w) => w.id === id)) this.view.selectedWings.delete(id);
  }

  async autosave() {
    const s = this.state;
    const name = `autosave-${dateString(s.day)}`;
    const err = await writeSave(name, saveGame(this.game, { savedAt: Date.now(), label: name }), this.slotInfo());
    if (err) this.toast(err, true);
    rotateAutosaves(s.settings.autosaveKeep ?? 3);
  }

  slotInfo() {
    const s = this.state;
    return { savedAt: Date.now(), date: formatDate(s.day), country: s.player >= 0 ? s.countries[s.player].name : 'Observer', scenario: s.scenarioName };
  }

  async quickSave() {
    const err = await writeSave('quicksave', saveGame(this.game, { savedAt: Date.now() }), this.slotInfo());
    this.toast(err || 'Game saved to slot "quicksave".', !!err);
  }

  toast(text, bad = false, prov) {
    const t = h('div.toast' + (bad ? '.bad' : ''), { on: { click: () => { if (prov != null && prov >= 0) this.focusProvince(prov); t.remove(); } } }, text);
    this.toastsEl.append(t);
    while (this.toastsEl.children.length > 5) this.toastsEl.firstChild.remove();
    setTimeout(() => t.remove(), bad ? 9000 : 5000);
  }

  // ------------------------------------------------------------------ UI
  renderUi() {
    this.renderTop();
    if (this.mode === 'pick') this.renderPick();
    else {
      mount(this.tabsEl, TABS.map((t) => h('button' + (this.tab === t.id ? '.on' : ''), { tip: `${t.tip}\nShortcut: ${t.key.toUpperCase()}`, on: { click: () => this.setTab(t.id) } }, icon(t.id), h('span', t.name))));
      renderPanel(this, this.panelEl);
    }
    renderProvince(this, this.provEl);
  }

  renderTop() {
    const s = this.state, C = s.countries;
    const me = s.player >= 0 ? C[s.player] : null;
    const L = me?.ledger;
    const speedBtns = [1, 2, 3, 4, 5].map((n) => h('button' + (this.speed === n ? '.on' : ''),
      { tip: `Speed ${n}: ${n === 5 ? 'as fast as possible' : SPEEDS[n] + ' days/second'} (key ${n})`, on: { click: () => this.setSpeed(n) }, disabled: this.mode !== 'play' }, '›'.repeat(Math.min(n, 3)) + (n > 3 ? n : '')));
    const wars = me ? s.wars.filter((w) => w.attackers.includes(me.idx) || w.defenders.includes(me.idx)).length : s.wars.length;
    const ledgerTip = L ? [
      `Monthly budget for ${me.name}`,
      `GDP this month: ${money(L.gdpMonth)}${L.gdpLost > 0 ? ` (${money(L.gdpLost)} in occupied provinces, not taxable)` : ''}`,
      `Tax revenue: ${money(L.taxRevenue)} = taxable GDP × tax ${pct(me.tax)} × efficiency ${pct(L.efficiency)}`,
      L.requisition ? `Requisitions from occupied land: ${money(L.requisition)}` : null,
      `Civil spending: −${money(L.civil)} (${pct(me.civilShare)} of tax revenue)`,
      `Military upkeep: −${money(L.military)}`,
      L.interest ? `Debt interest: −${money(L.interest)}` : null,
      `Net: ${signedMoney(L.net)}`,
    ].filter(Boolean).join('\n') : '';
    mount(this.topbar,
      me ? h('div.nation', { on: { click: () => { this.setTab('country'); this.focusCountry(me.idx); } }, tip: 'Your country. Click to centre on the capital (key C).' }, flagCanvas(me), me.name)
        : h('div.nation', h('span.muted', this.mode === 'pick' ? 'Choose a country' : 'Observer')),
      me && s.prestige?.rank?.[me.idx] && h('button.rank-btn', { tip: 'Your world rank by prestige. Click for the leaderboard.', on: { click: () => leaderboardDialog(this) } }, starBadge(s.prestige.rank[me.idx], true)),
      h('div.row', h('button.play', { tip: 'Pause / resume (Space)', 'aria-label': this.speed ? 'Pause' : 'Play', on: { click: () => this.togglePause() }, disabled: this.mode !== 'play' }, icon(this.speed ? 'pause' : 'play')),
        h('div.date', formatDate(s.day), this.speed ? '' : h('div.paused-flag', 'PAUSED')), h('div.speed', speedBtns)),
      me && h('div.stat', { tip: 'Treasury. Negative means debt, which costs interest and lowers stability.' }, h('b', { className: me.treasury < 0 ? 'bad' : '' }, icon('treasury'), money(me.treasury)), h('span', 'Treasury')),
      L && h('div.stat', { tip: ledgerTip }, h('b', { className: L.net < 0 ? 'bad' : 'good' }, icon('monthly'), signedMoney(L.net)), h('span', 'Monthly')),
      me && h('div.stat', { tip: 'Stability 0–100: affects tax efficiency. Lowered by high taxes, low public spending, debt, war and occupation.' }, h('b', icon('stability'), Math.round(me.stability)), h('span', 'Stability')),
      me && h('div.stat.opt', { tip: `Available manpower for recruiting and reinforcement. Cap ${people(me.cache.maxManpower)}, regenerates monthly.` }, h('b', icon('manpower'), people(me.manpower)), h('span', 'Manpower')),
      me && h('div.stat.opt', { tip: 'Population' }, h('b', icon('population'), people(me.cache.pop)), h('span', 'Population')),
      me && h('div.stat', { tip: this.influenceTip(me), on: { click: () => this.setTab('diplomacy') } }, h('b', icon('influence'), Math.floor(me.influence ?? 0)), h('span', 'Influence')),
      me && me.research && h('div.stat', { tip: this.researchTip(me), on: { click: () => this.setTab('research') } },
        h('b', { className: me.research.current ? '' : 'warn' }, icon('research_points'), '+' + researchPoints(s, this.game.rules, me).toFixed(1)), h('span', 'Research')),
      me && me.tfx && h('div.stat.opt.wide-only', { tip: `Era: ${me.tfx.known} technologies known${me.research?.current ? `, researching ${this.game.rules.tech.list[this.game.rules.tech.idx[me.research.current]].name}` : ', no research project'}. Click for the Research tab.`, on: { click: () => this.setTab('research') } }, h('b', icon('era'), eraOf(this.game.rules, me).name), h('span', 'Era')),
      h('div.stat' + (wars ? '.bad' : ''), { tip: me ? 'Wars you are part of' : 'Wars in the world' }, h('b', icon('wars'), wars), h('span', 'Wars')),
      h('div.spacer'),
      this.searchBox(),
      h('button.icon-btn', { tip: 'World leaderboard: every country ranked by prestige', 'aria-label': 'Leaderboard', on: { click: () => leaderboardDialog(this) } }, icon('leaderboard')),
      this.data.settings.cheats && h('button.icon-btn', { tip: 'Cheat console (`)', 'aria-label': 'Cheat console', on: { click: () => toggleConsole(this) } }, icon('console')),
      h('button', { tip: 'Save the game (Ctrl+S quick-saves)', 'aria-label': 'Save', on: { click: () => saveDialog(this) }, disabled: this.mode !== 'play' }, icon('save'), h('span.lbl', 'Save')),
      h('button', { tip: 'Menu: settings, controls, tutorial, save and exit', 'aria-label': 'Menu', on: { click: () => menuDialog(this) } }, icon('menu'), h('span.lbl', 'Menu')));
  }

  influenceTip(c) {
    const D = this.game.rules.balance.diplomacy;
    return `Influence (diplomatic points): ${Math.floor(c.influence ?? 0)} of at most ${D.influenceCap}.\n`
      + `Gained every month (${D.influenceBase} + more for larger economies). Spent in the Diplomacy tab, `
      + `for example ${D.improveCost} to improve relations with a country. Click for the Diplomacy tab.`;
  }

  researchTip(c) {
    const s = this.state, R = this.game.rules, T = R.tech, r = c.research;
    const rp = researchPoints(s, R, c);
    const lines = [`Research points: ${rp.toFixed(1)} a month (from research spending, education and technologies).`];
    if (r.current && T.idx[r.current] != null) {
      const t = T.idx[r.current], cost = techCost(s, this.game.map, R, c.idx, t);
      lines.push(`Researching ${T.list[t].name}: ${Math.round(r.progress)} of ${Math.round(cost)} points (${Math.round(100 * r.progress / Math.max(1, cost))}%).`);
    } else lines.push('No research project: points are being banked. Pick one in the Research tab.');
    if (r.bank >= 1) lines.push(`Banked: ${Math.round(r.bank)} points.`);
    lines.push('Click for the Research tab.');
    return lines.join('\n');
  }

  searchBox() {
    if (this._search) return this._search;
    const map = this.game.map;
    const results = h('div.results', { style: { display: 'none' } });
    const input = h('input', { placeholder: 'Search country or province…', on: {
      input: () => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { results.style.display = 'none'; return; }
        const C = this.state.countries;
        const cs = C.filter((c) => c.alive && c.name.toLowerCase().includes(q)).slice(0, 8);
        const ps = map.ids.filter((i) => map.name[i].toLowerCase().includes(q)).slice(0, 12);
        mount(results,
          cs.map((c) => h('div', { on: { mousedown: () => { this.focusCountry(c.idx); results.style.display = 'none'; } } }, flagCanvas(c), ' ', h('b', c.name), h('span.muted', ' · country'))),
          ps.map((i) => h('div', { on: { mousedown: () => { this.focusProvince(i); results.style.display = 'none'; } } }, map.name[i], h('span.muted', ` · ${C[this.state.prov.owner[i]]?.name ?? ''}`))),
          !cs.length && !ps.length && h('div.muted', 'No matches'));
        results.style.display = '';
      },
      blur: () => setTimeout(() => (results.style.display = 'none'), 150),
      keydown: (e) => { if (e.key === 'Enter') results.querySelector('div')?.dispatchEvent(new Event('mousedown')); },
    } });
    this._search = h('div.search', input, results);
    return this._search;
  }

  renderPick() {
    const s = this.state, C = s.countries;
    const sel = this.view.selectedCountry;
    this.bannerEl.style.display = '';
    if (sel >= 0) {
      const c = C[sel];
      mount(this.bannerEl, flagCanvas(c, true), h('div', h('b', c.name), h('div.muted', `${people(c.cache.pop)} people · GDP ${money(c.cache.gdp)}/yr · ${c.cache.provinces} provinces`)),
        h('button.primary', { on: { click: () => this.startPlaying(sel) } }, `Play as ${c.name}`),
        h('button', { on: { click: () => this.startPlaying(-1) }, tip: 'Watch the AI play every country.' }, 'Observe'));
    } else {
      mount(this.bannerEl, h('span', 'Click a country on the map or choose from the list.'),
        h('button', { on: { click: () => this.startPlaying(-1) }, tip: 'Watch the AI play every country.' }, 'Observe'),
        h('button', { on: { click: () => this.opts.onExit() } }, 'Back'));
    }
    mount(this.tabsEl, h('button.on', 'Choose your country'));
    if (!this._pickList) {
      const q = h('input', { placeholder: 'Filter…', style: { width: '100%', marginBottom: '0.5em' }, on: { input: () => draw() } });
      const box = h('div');
      const sorted = [...C].filter((c) => c.alive).sort((a, b) => b.cache.gdp - a.cache.gdp);
      const draw = () => {
        const f = q.value.trim().toLowerCase();
        mount(box, h('table.t', h('tr', h('th', 'Country'), h('th.n', 'GDP/yr'), h('th.n', 'Pop.')),
          sorted.filter((c) => !f || c.name.toLowerCase().includes(f)).map((c) => h('tr.click', { on: { click: () => this.focusCountry(c.idx) } },
            h('td', flagCanvas(c), ' ', c.name), h('td.n', money(c.cache.gdp)), h('td.n', people(c.cache.pop))))));
      };
      draw();
      this._pickList = h('div', h('p.muted', `${this.state.scenarioName}. Every country is playable.`), q, box);
    }
    mount(this.panelEl, this._pickList);
  }

  openPeace(war) { peaceDialog(this, war); }
  openSeparatePeace(war) { separatePeaceDialog(this, war); }
  openEvent(p) { sfx('event'); eventDialog(this, p); }

  startTutorial(from = 0) { return startTutorial(this, from); }

  // background music follows the player's country (the AI-run world in observer mode)
  updateMood() {
    this.moodDay = this.state.day;
    setMood(this.mode === 'play' ? moodFor(this.state, this.state.player) : 'peace');
  }
  openReport(id) { reportDialog(this, id); }
  isAtWar() { return isAtWar(this.state, this.state.player); }
}
