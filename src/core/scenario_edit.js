// Scenario editing: changes made to a scenario definition (the JSON of data/scenarios/), used by
// the in-game scenario editor (src/ui/editor.js). Every function works on the plain scenario
// object, so the result is an ordinary scenario file that the game, the tests and the builders
// all read. tidyScenario() makes an edited scenario consistent before it is saved or played:
// capitals inside the country, forces only where their owner may be, no treaties or wars with
// countries that were deleted. See docs/SCENARIOS.md (Scenario editor).
import { TREATIES } from './diplomacy.js';
import { portZonesOf } from './mapdata.js';

export function cloneScenario(sc) {
  return JSON.parse(JSON.stringify(sc));
}

// A copy of `base` to edit, with its own id; flags still come from the base scenario.
export function startEdit(base, { name, id } = {}) {
  const sc = cloneScenario(base);
  sc.name = name || `${base.name} (custom)`;
  sc.id = id || slug(sc.name);
  sc.flagScenario = base.flagScenario || base.id;
  sc.custom = true;
  return sc;
}

export function slug(text) {
  const s = String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return 'custom_' + (s || 'scenario');
}

export const ownerOf = (sc, p) => sc.provinces[p]?.[0] ?? null;

function record(sc, p) {
  return (sc.provinces[p] ||= [null, 0, 1, 0]);
}

// Gives province p to `tag` (null leaves it unclaimed). Returns true if anything changed.
export function paintProvince(sc, p, tag) {
  const r = record(sc, p);
  if (r[0] === tag) return false;
  r[0] = tag;
  return true;
}

// Gives the whole land-connected region of p's current owner to `tag`; returns the provinces.
export function fillRegion(sc, map, p, tag) {
  const from = ownerOf(sc, p), out = [], seen = new Set([p]), queue = [p];
  while (queue.length) {
    const i = queue.pop();
    out.push(i);
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      const j = map.adj[e];
      if (map.adjKind[e] === 2 || seen.has(j) || !map.exists[j] || ownerOf(sc, j) !== from) continue;
      seen.add(j); queue.push(j);
    }
  }
  for (const i of out) paintProvince(sc, i, tag);
  return out;
}

export function provincesOf(sc, tag) {
  const out = [];
  for (const [id, r] of Object.entries(sc.provinces)) if (r[0] === tag) out.push(+id);
  return out;
}

export function countryOf(sc, tag) {
  return sc.countries.find((c) => c.tag === tag) || null;
}

// A tag for a new country from its name: three letters, made unique with a digit if needed.
export function makeTag(sc, name) {
  const used = new Set(sc.countries.map((c) => c.tag));
  const letters = String(name).toUpperCase().normalize('NFKD').replace(/[^A-Z]/g, '');
  const base = (letters + 'XXX').slice(0, 3);
  if (!used.has(base)) return base;
  for (let i = 1; i < 100; i++) { const t = base.slice(0, 2) + i; if (!used.has(t)) return t; }
  let n = 0;
  while (used.has('C' + n)) n++;
  return 'C' + n;
}

const FLAG_PATTERNS = ['h', 'v', 'cross', 'disc'];

// Adds a country (it owns nothing until provinces are painted for it). Returns it.
export function addCountry(sc, { name, color, gov = 'republic', tag } = {}) {
  name = String(name || 'New Country').trim().slice(0, 40) || 'New Country';
  const t = tag && !countryOf(sc, tag) && /^[A-Z0-9_]{2,8}$/.test(tag) ? tag : makeTag(sc, name);
  const col = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : randomColor(sc.countries.length);
  const c = { tag: t, name, color: col, gov, capital: -1, aggression: 0.3, stability: 60,
    flag: { pattern: FLAG_PATTERNS[sc.countries.length % FLAG_PATTERNS.length], colors: [col, '#f2f2f2', shade(col)] } };
  sc.countries.push(c);
  return c;
}

// Deletes a country: its provinces become unclaimed and its forces, treaties and wars go.
export function removeCountry(sc, tag) {
  sc.countries = sc.countries.filter((c) => c.tag !== tag);
  for (const r of Object.values(sc.provinces)) if (r[0] === tag) r[0] = null;
  dropTag(sc, tag);
}

function dropTag(sc, tag) {
  for (const k of ['armies', 'fleets', 'wings']) if (sc[k]) sc[k] = sc[k].filter((a) => a.owner !== tag);
  const D = sc.diplomacy;
  if (D) {
    if (D.treaties) D.treaties = D.treaties.filter((t) => t.a !== tag && t.b !== tag);
    if (D.rivals) D.rivals = D.rivals.filter((r) => r[0] !== tag && r[1] !== tag);
    if (D.blocs) {
      for (const b of D.blocs) b.members = b.members.filter((m) => m !== tag);
      D.blocs = D.blocs.filter((b) => b.members.length > 1);
    }
  }
  if (sc.wars) {
    for (const w of sc.wars) { w.attackers = w.attackers.filter((t) => t !== tag); w.defenders = w.defenders.filter((t) => t !== tag); }
    sc.wars = sc.wars.filter((w) => w.attackers.length && w.defenders.length);
  }
  if (sc.releases) delete sc.releases[tag];
}

// Country fields the editor may change (and their limits).
export function setCountryField(sc, tag, key, value) {
  const c = countryOf(sc, tag);
  if (!c) return 'No such country';
  if (key === 'name') { const v = String(value).trim().slice(0, 40); if (!v) return 'A country needs a name'; c.name = v; }
  else if (key === 'color') { if (!/^#[0-9a-fA-F]{6}$/.test(value)) return 'Colour must be #rrggbb'; c.color = value; if (c.flag?.colors) c.flag.colors[0] = value; }
  else if (key === 'gov') c.gov = value;
  else if (key === 'stability') c.stability = clamp(+value, 0, 100);
  else if (key === 'aggression') c.aggression = clamp(+value, 0, 1);
  else if (key === 'treasury') c.treasury = Number.isFinite(+value) ? +value : 0;
  else if (key === 'techLag') c.techLag = clamp(Math.round(+value), -100, 500);
  else if (key === 'capital') c.capital = value;
  else return `Unknown field ${key}`;
  return null;
}

// Treaties (diplomacy.treaties, with tags) and wars.
export function addTreaty(sc, type, a, b) {
  if (!TREATIES[type]) return 'Unknown treaty';
  if (a === b) return 'Pick another country';
  const D = (sc.diplomacy ||= { treaties: [] }), list = (D.treaties ||= []);
  const mutual = TREATIES[type].mutual;
  if (list.some((t) => t.type === type && ((t.a === a && t.b === b) || (mutual && t.a === b && t.b === a)))) return 'That treaty already exists';
  if (type === 'subject' && list.some((t) => t.type === 'subject' && t.b === b)) return 'That country already has an overlord';
  list.push({ type, a, b });
  return null;
}

export function removeTreaty(sc, i) {
  sc.diplomacy?.treaties?.splice(i, 1);
}

export function treatiesOf(sc, tag) {
  return (sc.diplomacy?.treaties || []).map((t, i) => ({ ...t, i })).filter((t) => t.a === tag || t.b === tag);
}

export function addWar(sc, a, b, name) {
  if (a === b) return 'Pick another country';
  const wars = (sc.wars ||= []);
  if (wars.some((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)))) return 'They are already at war';
  wars.push({ attackers: [a], defenders: [b], ...(name ? { name } : {}) });
  return null;
}

// Armies: [{ owner, province, units }].
export function addArmy(sc, tag, province, units) {
  (sc.armies ||= []).push({ owner: tag, province, units: { ...units } });
}

export function armiesAt(sc, province) {
  return (sc.armies || []).map((a, i) => ({ ...a, i })).filter((a) => a.province === province);
}

export function removeArmy(sc, i) {
  sc.armies?.splice(i, 1);
}

// Makes the scenario consistent; returns a list of what it changed (for the player to read).
export function tidyScenario(sc, map) {
  const notes = [];
  const tags = new Set(sc.countries.map((c) => c.tag));
  for (const r of Object.values(sc.provinces)) if (r[0] != null && !tags.has(r[0])) r[0] = null;
  const owned = new Map();
  for (const [id, r] of Object.entries(sc.provinces)) if (r[0] != null && map.exists[+id]) {
    if (!owned.has(r[0])) owned.set(r[0], []);
    owned.get(r[0]).push(+id);
  }
  for (const c of sc.countries) {
    const mine = owned.get(c.tag);
    if (!mine) continue;
    if (!mine.includes(c.capital)) {
      const best = mine.reduce((m, i) => ((sc.provinces[i][1] || 0) > (sc.provinces[m][1] || 0) ? i : m), mine[0]);
      if (c.capital >= 0) notes.push(`${c.name}: capital moved to ${map.name[best]}`);
      c.capital = best;
    }
  }
  const capitalOf = (tag) => countryOf(sc, tag)?.capital ?? -1;
  // armies stand in their own country (or are sent home); fleets dock in their own ports
  let moved = 0, dropped = 0;
  sc.armies = (sc.armies || []).filter((a) => {
    if (!tags.has(a.owner) || !owned.has(a.owner)) { dropped++; return false; }
    if (ownerOf(sc, a.province) !== a.owner && !atWarIn(sc, a.owner, ownerOf(sc, a.province))) { a.province = capitalOf(a.owner); moved++; }
    return true;
  });
  sc.fleets = (sc.fleets || []).filter((f) => {
    if (!tags.has(f.owner) || !owned.has(f.owner)) { dropped++; return false; }
    if (f.port != null && ownerOf(sc, f.port) !== f.owner) {
      const port = owned.get(f.owner).find((i) => portZonesOf(map, i).length);
      if (port == null) { dropped++; return false; }
      f.port = port; delete f.zone; moved++;
    }
    return true;
  });
  sc.wings = (sc.wings || []).filter((w) => {
    if (!tags.has(w.owner) || !owned.has(w.owner)) { dropped++; return false; }
    if (ownerOf(sc, w.base) !== w.owner) { w.base = capitalOf(w.owner); moved++; }
    return true;
  });
  if (moved) notes.push(`${moved} armies, fleets or air wings outside their country were moved home`);
  if (dropped) notes.push(`${dropped} forces of countries with no land were removed`);
  // countries listed in "releases" wait to be released; any other landless one starts eliminated
  for (const t of tags) if (!owned.has(t) && !(sc.releases && t in sc.releases)) notes.push(`${countryOf(sc, t).name} owns no land and starts eliminated`);
  const D = sc.diplomacy;
  if (D?.treaties) D.treaties = D.treaties.filter((t) => tags.has(t.a) && tags.has(t.b));
  return notes;
}

function atWarIn(sc, a, b) {
  return (sc.wars || []).some((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)));
}

// The index entry the New Game screen lists.
export function indexEntry(sc) {
  return { id: sc.id, name: sc.name, era: sc.era, startDate: sc.startDate, description: sc.description || '', approximations: sc.approximations || '', custom: true };
}

const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);

function randomColor(n) {
  const hue = (n * 137.508) % 360, s = 0.45, l = 0.55;
  const f = (k) => { const a = s * Math.min(l, 1 - l), x = (k + hue / 30) % 12; return l - a * Math.max(-1, Math.min(x - 3, 9 - x, 1)); };
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.55).toString(16).padStart(2, '0')).join('');
}
