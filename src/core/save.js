// Save format: JSON with typed arrays packed as base64. Saves carry a version number and are
// migrated forward step by step, then validated against the loaded map before use.
import { SAVE_VERSION, refreshCountryCache } from './state.js';
import { touchRelations } from './relations.js';

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

export function serialize(state, meta = {}) {
  const prov = {};
  for (const k in state.prov) prov[k] = { t: state.prov[k].constructor.name, b: toB64(state.prov[k]) };
  // country caches are saved too: AI decisions read them, so a reloaded game must see the
  // same values to continue deterministically
  return JSON.stringify({ ...state, prov, savedAt: meta.savedAt || null, label: meta.label || '' });
}

// Each migration upgrades a save from version v to v+1.
const MIGRATIONS = {
  1: (s) => { s.offers = s.offers || []; s.aiLog = s.aiLog || []; for (const c of s.countries) c.automate = !!c.automate; s.version = 2; return s; },
};

export function deserialize(text, map, rules) {
  let s;
  try { s = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('Save file is not valid JSON'); }
  if (!s || typeof s !== 'object' || !Number.isInteger(s.version)) throw new Error('Not an AOC3 save file');
  if (s.version > SAVE_VERSION) throw new Error(`Save is from a newer game version (${s.version} > ${SAVE_VERSION})`);
  while (s.version < SAVE_VERSION) {
    const m = MIGRATIONS[s.version];
    if (!m) throw new Error(`No migration from save version ${s.version}`);
    s = m(s);
  }
  const prov = {};
  for (const k in s.prov) {
    const { t, b } = s.prov[k];
    if (!TYPED[t]) throw new Error(`Bad province field ${k}`);
    prov[k] = fromB64(t, b);
  }
  s.prov = prov;
  validate(s, map, rules);
  // newer map with extra provinces: extend arrays (new provinces start unowned)
  if (prov.owner.length < map.count) {
    for (const k in prov) {
      const n = new prov[k].constructor(map.count);
      if (k === 'owner' || k === 'controller' || k === 'siegeBy') n.fill(-1);
      n.set(prov[k]);
      prov[k] = n;
    }
  }
  s.mapProvinceCount = map.count;
  touchRelations(s);
  if (s.countries.some((c) => !c.cache)) refreshCountryCache(s, map, rules);
  return s;
}

export function validate(s, map, rules) {
  const req = ['day', 'countries', 'prov', 'armies', 'wars', 'alliances', 'log'];
  for (const k of req) if (s[k] == null) throw new Error(`Save is missing "${k}"`);
  const fields = ['owner', 'controller', 'pop', 'dev', 'fort', 'siege', 'siegeBy'];
  for (const f of fields) if (!s.prov[f]) throw new Error(`Save is missing province field "${f}"`);
  const n = s.prov.owner.length;
  if (n > map.count) throw new Error(`Save has ${n} provinces but the map has ${map.count}`);
  for (const f of fields) if (s.prov[f].length !== n) throw new Error(`Province field "${f}" has wrong length`);
  const C = s.countries.length;
  for (let i = 0; i < n; i++) {
    if (s.prov.owner[i] >= C || s.prov.controller[i] >= C) throw new Error(`Province ${i} references unknown country`);
  }
  s.armies = s.armies.filter((a) => a.loc < map.count && map.exists[a.loc] && a.owner < C && s.countries[a.owner]?.alive !== false);
  for (const a of s.armies) {
    a.path = (a.path || []).filter((p) => p < map.count && map.exists[p]);
    for (const t of Object.keys(a.units)) if (!rules.units[t]) delete a.units[t];
  }
  for (const w of s.wars) if (!Array.isArray(w.attackers) || !Array.isArray(w.defenders)) throw new Error('Malformed war');
}
