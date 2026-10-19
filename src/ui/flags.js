// Country flags. Real flags come from data/flags/ (see data/flags/index.json): present-day flags
// from flag-icons, and historical flags drawn by tools/build_flags.py for the older scenarios.
// A country with no flag file (a mod's new country, or a tag mapped to null) gets a stylised
// flag drawn from its pattern spec ({pattern, colors}). Flags are 4:3.
const W = 27, H = 20, BW = 48, BH = 36;
const SHARP = 2; // canvas pixels per CSS pixel, so flags stay crisp at larger interface scales

let index = null;      // data/flags/index.json, once loaded
let scenario = null;   // scenario id of the game being shown
const images = new Map();  // flag file → { img, ready, waiting: [canvas] }
const patterns = new Map(); // tag → pattern flag canvas

export function loadFlagIndex() {
  return fetch('data/flags/index.json').then((r) => (r.ok ? r.json() : null)).then((j) => { index = j; }, () => {});
}

// Called when a game starts; starts loading that scenario's flags in the background.
export function setFlagScenario(id, countries = []) {
  scenario = id;
  for (const c of countries) { const f = flagFile(c.tag); if (f) image(f); }
}

function flagFile(tag) {
  if (!index) return null;
  const sc = index.scenarios?.[scenario];
  if (sc && tag in sc) return sc[tag];
  return index.default?.[tag] ?? null;
}

function image(file) {
  let e = images.get(file);
  if (!e) {
    e = { img: new Image(), ready: false, failed: false, waiting: [] };
    e.img.onload = () => { e.ready = true; for (const c of e.waiting) paint(c, e.img); e.waiting = []; };
    e.img.onerror = () => { e.failed = true; e.waiting = []; };
    e.img.src = `data/flags/${file}.svg`;
    images.set(file, e);
  }
  return e;
}

function paint(c, img) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
}

export function flagCanvas(country, big = false) {
  const c = document.createElement('canvas');
  c.className = big ? 'flag big' : 'flag';
  c.width = (big ? BW : W) * SHARP; c.height = (big ? BH : H) * SHARP;
  const file = flagFile(country.tag);
  const e = file && image(file);
  if (e && e.ready) { paint(c, e.img); return c; }
  // the pattern flag shows until the real one has loaded (or for good, when there is none)
  c.getContext('2d').drawImage(patternFlag(country), 0, 0, c.width, c.height);
  if (e && !e.failed) e.waiting.push(c);
  return c;
}

function patternFlag(country) {
  const cached = patterns.get(country.tag);
  if (cached) return cached;
  const c = document.createElement('canvas');
  const w = BW * SHARP, hh = BH * SHARP;
  c.width = w; c.height = hh;
  const g = c.getContext('2d');
  const f = country.flag || { pattern: 'h', colors: [country.color, '#ffffff'] };
  const cols = f.colors && f.colors.length ? f.colors : [country.color];
  g.fillStyle = cols[0]; g.fillRect(0, 0, w, hh);
  if (f.pattern === 'h') cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (hh * i) / cols.length, w, hh / cols.length + 1); });
  else if (f.pattern === 'v') cols.forEach((col, i) => { g.fillStyle = col; g.fillRect((w * i) / cols.length, 0, w / cols.length + 1, hh); });
  else if (f.pattern === 'disc') { g.fillStyle = cols[1] || '#fff'; g.beginPath(); g.arc(w / 2, hh / 2, hh * 0.3, 0, Math.PI * 2); g.fill(); }
  else if (f.pattern === 'cross') {
    g.fillStyle = cols[1] || '#fff'; g.fillRect(w * 0.3, 0, w * 0.16, hh); g.fillRect(0, hh * 0.4, w, hh * 0.2);
    if (cols[2]) { g.fillStyle = cols[2]; g.fillRect(w * 0.34, 0, w * 0.08, hh); g.fillRect(0, hh * 0.45, w, hh * 0.1); }
  }
  patterns.set(country.tag, c);
  return c;
}
