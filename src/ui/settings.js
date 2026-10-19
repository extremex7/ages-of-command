// Display and game settings: one form, used on the main menu and in the in-game menu, and the
// code that applies each setting at once. Window settings go to the desktop app's window
// through its /api/window endpoint (launcher/), or to the browser's full-screen mode; the
// Android app is always full screen.
import { h } from './dom.js';
import { saveSettings } from './storage.js';

export const UI_SCALES = ['auto', 0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
export const WINDOW_SIZES = [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440]];
export const RESOLUTIONS = ['auto', 0.5, 0.75, 1];
export const FPS_CAPS = [0, 30, 60];

let app = null; // the app's /api/info answer, or null in a browser
export function setAppInfo(info) { app = info; }
// 'native' (desktop app window), 'browser' (desktop app in a browser window, or a plain browser), 'android'
export function platform() {
  if (app?.platform === 'android') return 'android';
  return app?.window === 'native' ? 'native' : 'browser';
}

// The interface scale "auto" fits the interface designed for 1366×768 to the window: larger on
// big screens, smaller (down to 75%) on small ones such as phones.
export function effectiveUiScale(s) {
  if (s.uiScale !== 'auto') return +s.uiScale || 1;
  const f = Math.min(window.innerWidth / 1366, window.innerHeight / 768);
  return Math.round(Math.max(0.75, Math.min(2, f)) * 20) / 20;
}
export function applyUiScale(s) {
  document.documentElement.style.setProperty('--ui-scale', String(effectiveUiScale(s)));
}
let resizeHooked = false;
export function watchAutoScale(getSettings) {
  if (resizeHooked) return;
  resizeHooked = true;
  window.addEventListener('resize', () => { if (getSettings().uiScale === 'auto') applyUiScale(getSettings()); });
}

// Window mode: 'windowed', 'maximized' or 'fullscreen'.
export async function applyWindow(s) {
  const p = platform();
  if (p === 'android') return;
  if (p === 'native') {
    const [width, height] = s.windowSize || [0, 0];
    try {
      await fetch('/api/window', { method: 'POST', body: JSON.stringify({ mode: s.windowMode, width, height }) });
    } catch { /* the window stays as it is */ }
    return;
  }
  // a browser can only switch full screen on, and only straight after a click or key press
  const full = !!document.fullscreenElement;
  try {
    if (s.windowMode === 'fullscreen' && !full) await document.documentElement.requestFullscreen();
    else if (s.windowMode !== 'fullscreen' && full) await document.exitFullscreen();
  } catch { /* refused: not after a user action, or not allowed */ }
}

export function toggleFullscreen(s) {
  if (platform() === 'android') return;
  const full = platform() === 'native' ? s.windowMode === 'fullscreen' : !!document.fullscreenElement;
  if (full) s.windowMode = s.lastWindowMode || 'windowed';
  else {
    if (s.windowMode !== 'fullscreen') s.lastWindowMode = s.windowMode;
    s.windowMode = 'fullscreen';
  }
  saveSettings(s);
  applyWindow(s);
}

function select(value, options, onChange) {
  return h('select', { on: { change: (e) => onChange(e.target.value) } },
    options.map(([v, label]) => h('option', { value: String(v), selected: String(value) === String(v) }, label)));
}
const pct = (v) => Math.round(v * 100) + '%';

// The settings form. `onApply(key)` lets the caller redraw (the map renderer in a game).
export function settingsForm(s, onApply = () => {}) {
  const p = platform();
  const change = (key, v) => { s[key] = v; saveSettings(s); onApply(key); };
  const rows = [];
  const field = (label, control, note) => rows.push(h('div.field', h('label', label), control, note && h('div.muted.small', note)));

  rows.push(h('h4', 'Display'));
  if (p !== 'android') {
    const modes = p === 'native'
      ? [['windowed', 'Windowed'], ['maximized', 'Maximised window'], ['fullscreen', 'Full screen']]
      : [['windowed', 'Windowed'], ['fullscreen', 'Full screen']];
    field('Window mode', select(s.windowMode, modes, (v) => {
      if (v !== 'fullscreen') s.lastWindowMode = v;
      change('windowMode', v); applyWindow(s);
    }), 'F11 switches full screen on and off.');
  }
  if (p === 'native') {
    const cur = (s.windowSize || []).join('x');
    const sizes = [['', 'Keep current size'], ...WINDOW_SIZES.map(([w, hh]) => [`${w}x${hh}`, `${w} × ${hh}`])];
    field('Window size (in windowed mode)', select(cur, sizes, (v) => {
      s.windowSize = v ? v.split('x').map(Number) : null;
      if (s.windowSize && s.windowMode !== 'windowed') s.windowMode = 'windowed';
      change('windowSize', s.windowSize); applyWindow(s);
    }));
  }
  field('Interface scale', select(s.uiScale, UI_SCALES.map((v) => [v, v === 'auto' ? `Auto (fits the window, now ${pct(effectiveUiScale({ uiScale: 'auto' }))})` : pct(v)]), (v) => {
    change('uiScale', v === 'auto' ? 'auto' : +v); applyUiScale(s);
  }), 'Size of text, buttons and panels.');

  rows.push(h('h4', 'Graphics'));
  field('Graphics quality', select(s.profile, [['low', 'Low (for old or slow computers and phones)'], ['balanced', 'Balanced'], ['high', 'High (sharpest map, most labels)']],
    (v) => change('profile', v)), 'Same gameplay at every quality.');
  field('Map resolution', select(s.resolution, RESOLUTIONS.map((v) => [v, v === 'auto' ? 'Auto (set by graphics quality)' : `${pct(v)} of the screen's pixels`]),
    (v) => change('resolution', v === 'auto' ? 'auto' : +v)), 'Lower is faster on high-resolution screens.');
  field('Frame rate limit', select(s.fpsCap, FPS_CAPS.map((v) => [v, v ? `${v} frames per second` : 'None (match the screen)']),
    (v) => change('fpsCap', +v)), 'A limit saves battery and keeps laptops and phones cooler.');

  rows.push(h('h4', 'Interface'));
  field('Tooltips', select(s.tooltips ? '1' : '0', [['1', 'Show'], ['0', 'Hide']], (v) => change('tooltips', v === '1')));
  field('Autosave', select(s.autosaveMonths, [[0, 'Off'], [1, 'Monthly'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Yearly']],
    (v) => change('autosaveMonths', +v)));
  field('Autosaves to keep', select(s.autosaveKeep, [1, 2, 3, 5, 10].map((v) => [v, String(v)]), (v) => change('autosaveKeep', +v)));
  return h('div.settings', rows);
}
