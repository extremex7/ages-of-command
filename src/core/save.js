// Save format: JSON in which every typed array (province fields, per-country stockpiles,
// building levels…) is packed as base64. Saves carry a version number and are migrated
// forward step by step, then validated against the loaded map before use.
import { SAVE_VERSION, refreshCountryCache } from './state.js';
import { touchRelations } from './relations.js';
import { initEconomy } from './industry.js';

const TYPED = { Int16Array, Uint8Array, Float32Array, Float64Array, Int32Array, Uint32Array };

function toB64(ta) {
  const bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(type, b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TYPED[type](bytes.buffer);
}

function replacer(key, v) {
  if (ArrayBuffer.isView(v) && TYPED[v.constructor.name]) return { $ta: v.constructor.name, b: toB64(v) };
  return v;
}

function reviver(key, v) {
  if (v && typeof v === 'object' && typeof v.$ta === 'string' && typeof v.b === 'string') {
    if (!TYPED[v.$ta]) throw new Error(`Bad array type ${v.$ta}`);
    return fromB64(v.$ta, v.b);
  }
  return v;
}

export function serialize(state, meta = {}) {
  // country caches and ledgers are saved too: AI decisions read them, so a reloaded game
  // must see the same values to continue deterministically
  return JSON.stringify({ ...state, savedAt: meta.savedAt || null, label: meta.label || '' }, replacer);
}

// Each migration upgrades a save from version v to v+1. ctx = { map, rules, scenario }.
const MIGRATIONS = {
  1: (s) => { s.offers = s.offers || []; s.aiLog = s.aiLog || []; for (const c of s.countries) c.automate = !!c.automate; s.version = 2; return s; },
  // v2 → v3 (Milestone 3): province fields used the old {t, b} packing; the economy did not
  // exist, so the scenario's starting industry is installed and calibrated to the save's GDP.
  2: (s, ctx) => {
    for (const k in s.prov) {
      const f = s.prov[k];
      if (f && typeof f.t === 'string' && typeof f.b === 'string') {
        if (!TYPED[f.t]) throw new Error(`Bad province field ${k}`);
        s.prov[k] = fromB64(f.t, f.b);
      }
    }
    const n = s.prov.owner.length;
    s.prov.infra = new Uint8Array(n);
    for (let i = 0; i < n; i++) s.prov.infra[i] = Math.max(0, Math.min(10, Math.round(s.prov.dev[i] / 11)));
    s.construction = [];
    s.needsEconomy = true;
    s.version = 3;
    return s;
  },
};

export function deserialize(text, map, rules, scenario = null) {
  let s;
  try { s = typeof text === 'string' ? JSON.parse(text, reviver) : text; } catch (e) { throw new Error('Save file is not valid JSON'); }
  if (!s || typeof s !== 'object' || !Number.isInteger(s.version)) throw new Error('Not an AOC3 save file');
  if (s.version > SAVE_VERSION) throw new Error(`Save is from a newer game version (${s.version} > ${SAVE_VERSION})`);
  while (s.version < SAVE_VERSION) {
    const m = MIGRATIONS[s.version];
    if (!m) throw new Error(`No migration from save version ${s.version}`);
    s = m(s, { map, rules, scenario });
  }
  validate(s, map, rules);
  // newer map with extra provinces: extend arrays (new provinces start unowned)
  const prov = s.prov;
  if (prov.owner.length < map.count) {
    const old = prov.owner.length;
    for (const k in prov) {
      const n = new prov[k].constructor(map.count);
      if (k === 'owner' || k === 'controller' || k === 'siegeBy') n.fill(-1);
      n.set(prov[k]);
      prov[k] = n;
    }
    if (s.econ) {
      for (const k of ['bld', 'dep']) {
        const per = s.econ[k].length / old;
        const n = new Uint8Array(map.count * per); n.set(s.econ[k]); s.econ[k] = n;
      }
      for (const k of ['sf', 'va', 'iw']) { const n = new Float32Array(map.count).fill(k === 'sf' ? 1 : 0); n.set(s.econ[k]); s.econ[k] = n; }
    }
  }
  s.mapProvinceCount = map.count;
  touchRelations(s);
  if (s.countries.some((c) => !c.cache)) refreshCountryCache(s, map, rules);
  if (s.needsEconomy) {
    if (!scenario) throw new Error('This save predates the economy; loading it needs its scenario');
    delete s.needsEconomy;
    initEconomy(s, map, rules, scenario);
  }
  return s;
}

export function validate(s, map, rules) {
  const req = ['day', 'countries', 'prov', 'armies', 'wars', 'alliances', 'log'];
  for (const k of req) if (s[k] == null) throw new Error(`Save is missing "${k}"`);
  const fields = ['owner', 'controller', 'pop', 'dev', 'fort', 'siege', 'siegeBy', 'infra'];
  for (const f of fields) if (!ArrayBuffer.isView(s.prov[f])) throw new Error(`Save is missing province field "${f}"`);
  const n = s.prov.owner.length;
  if (n > map.count) throw new Error(`Save has ${n} provinces but the map has ${map.count}`);
  for (const f of fields) if (s.prov[f].length !== n) throw new Error(`Province field "${f}" has wrong length`);
  const C = s.countries.length;
  for (let i = 0; i < n; i++) {
    if (s.prov.owner[i] >= C || s.prov.controller[i] >= C) throw new Error(`Province ${i} references unknown country`);
  }
  if (!s.needsEconomy) {
    const X = rules.econ;
    if (!s.econ) throw new Error('Save is missing the economy');
    if (s.econ.bld?.length !== n * X.B) throw new Error(`Save has building data for ${s.econ.bld?.length / n} building types; the rules define ${X.B}`);
    if (s.econ.dep?.length !== n * X.R) throw new Error('Save has deposit data that does not match the rules');
    if (s.econ.prices?.length !== X.G) throw new Error('Save has market data that does not match the goods list');
    for (const c of s.countries) if (!c.econ || c.econ.stock?.length !== X.G || c.econ.buildUse?.length !== X.G) throw new Error(`Country ${c.tag} has no valid economy`);
    s.construction = (s.construction || []).filter((p) => p.prov < n && p.owner < C && (p.kind === 'infra' || X.buildings[p.b]));
  }
  s.armies = s.armies.filter((a) => a.loc < map.count && map.exists[a.loc] && a.owner < C && s.countries[a.owner]?.alive !== false);
  for (const a of s.armies) {
    a.path = (a.path || []).filter((p) => p < map.count && map.exists[p]);
    for (const t of Object.keys(a.units)) if (!rules.units[t]) delete a.units[t];
  }
  for (const w of s.wars) if (!Array.isArray(w.attackers) || !Array.isArray(w.defenders)) throw new Error('Malformed war');
}
