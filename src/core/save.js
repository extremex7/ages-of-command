// Save format: JSON in which every typed array (province fields, per-country stockpiles,
// building levels…) is packed as base64. Saves carry a version number and are migrated
// forward step by step, then validated against the loaded map before use.
import { SAVE_VERSION, refreshCountryCache } from './state.js';
import { touchRelations } from './relations.js';
import { initEconomy } from './industry.js';
import { initGovernment, newGovt, govEffects } from './government.js';
import { initDiplomacy, TREATIES } from './diplomacy.js';
import { initTechnology, refreshAllTech, newResearch } from './technology.js';
import { newStrat, newStrategicWorld, SAT_KINDS } from './strategic.js';

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

// Keys of derived data that is rebuilt on load instead of saved.
const DERIVED = new Set(['fx', 'tfx']);

function replacer(key, v) {
  if (DERIVED.has(key)) return undefined;
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
  // v3 → v4 (Milestone 4): governments, factions, treaties and events did not exist. They are
  // installed from each country's government type and the scenario's diplomacy section.
  3: (s) => {
    s.pendingEvents = [];
    s.dip = { treaties: [], mods: [], refused: {}, modVer: 0 };
    for (const o of s.offers || []) o.kind = o.kind || 'peace';
    for (const a of s.alliances || []) a.kind = a.kind || 'defense';
    for (const c of s.countries) { if (c.econ) c.econ.partnerShare = 0; delete c.govt; }
    s.needsPolitics = true;
    s.version = 4;
    return s;
  },
  // v4 → v5 (Milestone 5): technologies did not exist. Countries get the scenario's starting
  // technologies (for the Modern World: everything up to its start year).
  4: (s) => {
    s.needsTech = true;
    s.version = 5;
    return s;
  },
  // v5 → v6 (Milestone 6): navies, air forces and strategic capabilities did not exist. Old games
  // continue with none; countries can build them from now on.
  5: (s) => {
    s.fleets = []; s.wings = []; s.navalBattles = [];
    s.strategic = newStrategicWorld();
    for (const c of s.countries) { c.strat = newStrat(); c.depots = []; }
    for (const a of s.armies) a.sea = -1;
    s.version = 6;
    return s;
  },
};

export function deserialize(text, map, rules, scenario = null) {
  let s;
  try { s = typeof text === 'string' ? JSON.parse(text, reviver) : text; } catch (e) { throw new Error('Save file is not valid JSON'); }
  if (!s || typeof s !== 'object' || !Number.isInteger(s.version)) throw new Error('Not an AOC3 save file');
  if (s.version > SAVE_VERSION) throw new Error(`Save is from a newer game version (${s.version} > ${SAVE_VERSION})`);
  // the saved country caches are kept (the AI reads them; a mid-month rebuild would differ from
  // the running game's) unless the save was migrated, the map grew or the technologies changed
  let staleCache = s.version < SAVE_VERSION;
  while (s.version < SAVE_VERSION) {
    const m = MIGRATIONS[s.version];
    if (!m) throw new Error(`No migration from save version ${s.version}`);
    s = m(s, { map, rules, scenario });
  }
  if (s.econ && !s.needsEconomy && remapEconomy(s, rules)) staleCache = true;
  validate(s, map, rules);
  // newer map with extra provinces: extend arrays (new provinces start unowned)
  const prov = s.prov;
  if (prov.owner.length < map.count) {
    staleCache = true;
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
  // saved supply maps stay valid across the relations rebuild below (see supply.js)
  const sc = s.supplyCache;
  const keepSupply = sc && typeof sc === 'object' && sc.maps && Object.values(sc.maps).every((q) => q instanceof Uint8Array && q.length === map.count) && sc.rv === (s.relVersion || 0);
  touchRelations(s);
  if (keepSupply) sc.rv = s.relVersion; else delete s.supplyCache;
  if (s.countries.some((c) => !c.cache)) refreshCountryCache(s, map, rules);
  if (s.econ?.newResources) {
    // geology is the same in every scenario: new resources take their deposits from it
    const X = rules.econ;
    for (const [id, rec] of Object.entries(scenario?.economy?.deposits || {})) {
      const i = +id;
      if (!(i < map.count)) continue;
      for (const r of s.econ.newResources) if (rec[r]) s.econ.dep[i * X.R + X.resources.indexOf(r)] = Math.min(255, rec[r]);
    }
    delete s.econ.newResources;
  }
  if (s.needsEconomy) {
    if (!scenario) throw new Error('This save predates the economy; loading it needs its scenario');
    delete s.needsEconomy;
    initEconomy(s, map, rules, scenario);
  }
  if (s.needsPolitics) {
    delete s.needsPolitics;
    initGovernment(s, map, rules);
    initDiplomacy(s, map, rules, scenario);
    refreshCountryCache(s, map, rules);
  }
  if (s.needsTech) {
    if (!scenario) throw new Error('This save predates technology; loading it needs its scenario');
    delete s.needsTech;
    initTechnology(s, map, rules, scenario);
  } else if (remapTech(s, rules)) staleCache = true;
  refreshAllTech(s, rules);
  if (staleCache) refreshCountryCache(s, map, rules);
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
    // path nodes at or above map.count are sea zones (armies at sea); validateForces checks them
    a.path = (a.path || []).filter((p) => p >= map.count || map.exists[p]);
    for (const t of Object.keys(a.units)) if (!rules.units[t]) delete a.units[t];
  }
  for (const w of s.wars) if (!Array.isArray(w.attackers) || !Array.isArray(w.defenders)) throw new Error('Malformed war');
  validateForces(s, map, rules);
  if (!s.needsPolitics) validatePolitics(s, rules);
}

// Fleets, wings and strategic data are checked against the map and rules; anything a mod removed
// (a unit type, a sea zone) is dropped rather than rejected.
function validateForces(s, map, rules) {
  const C = s.countries.length, N = map.count, Z = map.sea.Z;
  const ok = (t, d) => rules.units[t] && (rules.units[t].domain || 'land') === d;
  for (const a of s.armies) { for (const t of Object.keys(a.units)) if (!ok(t, 'land')) delete a.units[t]; if (!(a.sea < Z)) a.sea = -1; a.path = a.path.filter((p) => p < N + Z); }
  s.fleets = (s.fleets || []).filter((f) => f.owner < C && f.zone >= 0 && f.zone < Z);
  for (const f of s.fleets) {
    for (const t of Object.keys(f.units)) if (!ok(t, 'sea')) delete f.units[t];
    if (!(f.port < N) || (f.port >= 0 && !map.exists[f.port])) f.port = -1;
    f.path = (f.path || []).filter((z) => z >= 0 && z < Z);
    if (!(f.dock < N)) f.dock = -1;
  }
  s.fleets = s.fleets.filter((f) => Object.keys(f.units).length);
  s.wings = (s.wings || []).filter((w) => w.owner < C && w.base >= 0 && w.base < N && map.exists[w.base]);
  for (const w of s.wings) for (const t of Object.keys(w.units)) if (!ok(t, 'air')) delete w.units[t];
  s.wings = s.wings.filter((w) => Object.keys(w.units).length);
  s.navalBattles = (s.navalBattles || []).filter((b) => b.zone < Z);
  s.strategic = { ...newStrategicWorld(), ...(s.strategic || {}) };
  for (const c of s.countries) {
    c.strat = { ...newStrat(), ...(c.strat || {}) };
    c.strat.sats = { ...newStrat().sats, ...(c.strat.sats || {}) };
    for (const k of Object.keys(c.strat.sats)) if (!SAT_KINDS.includes(k)) delete c.strat.sats[k];
    c.depots = (c.depots || []).filter((p) => p < N);
  }
}

// Governments and treaties are checked against the loaded rules; anything a mod removed is
// reset rather than rejected, so saves survive rule changes.
function validatePolitics(s, rules) {
  const P = rules.politics, C = s.countries.length;
  if (!s.dip || !Array.isArray(s.dip.treaties)) throw new Error('Save is missing diplomacy');
  s.dip.treaties = s.dip.treaties.filter((t) => TREATIES[t.type] && t.a < C && t.b < C && t.a >= 0 && t.b >= 0);
  s.dip.mods = (s.dip.mods || []).filter((m) => m.a < C && m.b < C);
  s.dip.refused = s.dip.refused || {};
  const evIds = new Set(rules.events.map((e) => e.id));
  s.pendingEvents = (s.pendingEvents || []).filter((p) => evIds.has(p.ev) && p.c < C);
  for (const c of s.countries) {
    if (!P.types[c.gov]) { c.gov = 'republic'; c.govt = null; }
    if (!c.govt) { c.govt = newGovt(s, rules, c); }
    const g = c.govt;
    for (const f of P.factionIds) { if (g.support[f] == null) g.support[f] = 0.02; if (g.approval[f] == null) g.approval[f] = 50; }
    for (const f of Object.keys(g.support)) if (!P.factions[f]) { delete g.support[f]; delete g.approval[f]; }
    if (!P.factions[g.ruling]) g.ruling = P.factionIds.find((f) => P.factions[f].electable) || P.factionIds[0];
    for (const grp of Object.keys(g.policies)) if (!P.policies[grp]) delete g.policies[grp];
    for (const grp of P.policyIds) if (!P.policies[grp].options[g.policies[grp]]) g.policies[grp] = Object.keys(P.policies[grp].options)[0];
    g.mods = g.mods || [];
    g.evDay = g.evDay || {};
    g.fx = govEffects(rules, c);
    c.claims = (c.claims || []).filter((x) => x.p < s.prov.owner.length);
    c.influence = c.influence ?? 0; c.reputation = c.reputation ?? 0; c.rival = c.rival < C ? c.rival ?? -1 : -1;
  }
}

// Goods, buildings and resources before the economy saved its ids (Session 11 added gas, hydro,
// gas, wind and solar).
const OLD_GOODS = ['food', 'timber', 'coal', 'oil', 'iron', 'uranium', 'rare_earths', 'steel', 'energy', 'fuel', 'consumer_goods', 'electronics', 'machinery', 'munitions'];
const OLD_BUILDINGS = ['farm', 'lumber_camp', 'coal_mine', 'iron_mine', 'oil_well', 'uranium_mine', 'rare_earth_mine', 'coal_power', 'nuclear_power', 'refinery', 'steel_mill', 'factory', 'electronics_plant', 'machine_works', 'arms_factory'];

// The economy is saved with the ids of its goods, buildings and resources; changed rules (new
// goods or buildings, or a mod) map every per-good, per-building and per-resource array by id.
// New goods start empty at their base price; dropped ones are discarded.
function remapEconomy(s, rules) {
  const X = rules.econ, ec = s.econ;
  const gIds = ec.goodIds || OLD_GOODS, bIds = ec.buildingIds || OLD_BUILDINGS, rIds = ec.resources || [];
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const gSame = same(gIds, X.goods.map((g) => g.id)), bSame = same(bIds, X.buildings.map((b) => b.id)), rSame = same(rIds, X.resources);
  if (gSame && bSame && rSame) { ec.goodIds = gIds; ec.buildingIds = bIds; return false; }
  const n = s.prov.owner.length;
  const per = (arr, oldIds, newIds, rows, fill = 0) => {
    const O = oldIds.length, Nn = newIds.length, out = new arr.constructor(rows * Nn);
    if (fill) out.fill(fill);
    if (arr.length !== rows * O) throw new Error('Save has economy data that does not match its own lists');
    const from = newIds.map((id) => oldIds.indexOf(id));
    for (let r = 0; r < rows; r++) for (let j = 0; j < Nn; j++) if (from[j] >= 0) out[r * Nn + j] = arr[r * O + from[j]];
    return out;
  };
  const gNew = X.goods.map((g) => g.id), bNew = X.buildings.map((b) => b.id);
  if (!gSame) {
    const prices = per(ec.prices, gIds, gNew, 1);
    X.goods.forEach((g, j) => { if (!gIds.includes(g.id)) prices[j] = g.price; });
    ec.prices = prices;
    ec.ratio0 = per(ec.ratio0, gIds, gNew, 1);
    for (const c of s.countries) {
      if (!c.econ) continue;
      for (const k of ['stock', 'prod', 'need', 'imp', 'exp', 'sat', 'inSat', 'buildUse']) if (ArrayBuffer.isView(c.econ[k])) c.econ[k] = per(c.econ[k], gIds, gNew, 1);
    }
  }
  if (!bSame) {
    ec.bld = per(ec.bld, bIds, bNew, n);
    const bi = Object.fromEntries(bNew.map((id, i) => [id, i]));
    s.construction = (s.construction || []).filter((p) => p.kind !== 'building' || bi[bIds[p.b]] != null);
    for (const p of s.construction) if (p.kind === 'building') p.b = bi[bIds[p.b]];
    ec.buildingCount = X.B;
  }
  if (!rSame) {
    ec.dep = per(ec.dep, rIds, X.resources, n);
    // deposits a new resource adds come from the scenario when it is available (see deserialize)
    ec.newResources = X.resources.filter((r) => !rIds.includes(r));
    ec.resources = [...X.resources];
  }
  ec.goodIds = gNew; ec.buildingIds = bNew;
  return true;
}

// Technologies are saved with their ids; a changed technology file maps known flags by id and
// drops research projects that no longer exist.
function remapTech(s, rules) {
  const R = rules.tech, C = s.countries.length;
  const t = s.tech;
  if (!t || !Array.isArray(t.ids) || !ArrayBuffer.isView(t.known)) throw new Error('Save is missing technology data');
  if (t.known.length !== C * t.ids.length) throw new Error('Save has malformed technology data');
  const same = t.ids.length === R.T && t.ids.every((id, i) => R.list[i].id === id);
  if (!same) {
    const known = new Uint8Array(C * R.T);
    t.ids.forEach((id, j) => {
      const i = R.idx[id];
      if (i == null) return;
      for (let k = 0; k < C; k++) known[k * R.T + i] = t.known[k * t.ids.length + j];
    });
    s.tech = { ids: R.list.map((x) => x.id), T: R.T, known, ver: (t.ver || 0) + 1 };
  }
  s.tech.T = R.T;
  for (const c of s.countries) {
    const r = c.research || (c.research = newResearch(rules));
    if (r.current && !(r.current in R.idx)) { r.current = null; r.progress = 0; }
    r.queue = (r.queue || []).filter((id) => id in R.idx);
    if (!(r.share >= 0)) r.share = rules.balance.research.defaultShare;
    r.bank = r.bank || 0;
  }
  return !same;
}
