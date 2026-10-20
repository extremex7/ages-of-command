// Nations: national traits, formable nations, the prestige bonus, and the monthly step that also
// runs advisors (advisors.js) and missions (missions.js). Data: data/rules/traits.json,
// formables.json and nations.json. Rules and formulas: docs/NATIONS.md.
//
// Saved per country, all optional (a save from before this feature gets them lazily):
//   c.traits          trait ids (assigned on the first month from traits.json, or kept)
//   c.formed          ids of the nations this country has formed
//   c.flagId          flag file chosen when forming (null = the drawn pattern in c.flag)
//   c.formSeen        formable ids the player has already been told about
//   c.prestigeBonus   prestige bonus points (fading)
import { log, aiLog, logFor, impFor, isHuman, humanControls } from './state.js';
import { govEffects, govFamily } from './government.js';
import { refreshTech } from './technology.js';
import { overlordOf, addClaim } from './diplomacy.js';
import { NAT_EFFECTS, hashRand } from './natfx.js';
import { monthlyAdvisors } from './advisors.js';
import { monthlyMissions } from './missions.js';

export const REGIONS = ['west_europe', 'north_europe', 'east_europe', 'mena', 'sub_saharan', 'south_asia', 'east_asia', 'southeast_asia', 'steppe', 'north_america', 'latin_america', 'oceania'];

// Validates traits.json, formables.json and nations.json into rules.nations.
export function compileNations(raw, rules) {
  const errs = [];
  const traits = {}, eraIdx = Object.fromEntries((rules.tech?.eras || []).map((e) => [e.id, e.i]));
  const checkFx = (fx, where) => { for (const [k, v] of Object.entries(fx || {})) if (!NAT_EFFECTS.includes(k) || typeof v !== 'number') errs.push(`${where}: unknown effect or not a number "${k}"`); };
  for (const [id, t] of Object.entries(raw?.traits?.traits || {})) {
    if (id.startsWith('_')) continue;
    if (!t.name) errs.push(`trait "${id}": needs a name`);
    checkFx(t.effects, `trait "${id}"`);
    traits[id] = t;
  }
  const tags = {};
  for (const [k, list] of Object.entries(raw?.traits?.tags || {})) {
    if (k.startsWith('_')) continue;
    if (!Array.isArray(list) || !list.length || list.length > 3) errs.push(`traits for ${k}: give 1 to 3 traits`);
    for (const t of list || []) if (!traits[t]) errs.push(`traits for ${k}: unknown trait "${t}"`);
    tags[k] = list;
  }
  const defaults = (raw?.traits?.defaults || []).map((d, i) => {
    for (const t of d.pick || []) if (!traits[t]) errs.push(`default trait rule ${i}: unknown trait "${t}"`);
    const w = d.when || {};
    for (const r of w.region || []) if (!REGIONS.includes(r)) errs.push(`default trait rule ${i}: unknown region "${r}"`);
    const eras = w.eras ? w.eras.map((e) => eraIdx[e]) : null;
    if (eras && eras.some((x) => x == null)) errs.push(`default trait rule ${i}: unknown era`);
    return { ...w, eras, pick: d.pick || [] };
  });
  const formables = {};
  for (const [id, f] of Object.entries(raw?.formables || {})) {
    if (id.startsWith('_')) continue;
    const where = `formable "${id}"`;
    if (!f.name || !Array.isArray(f.region) || !f.region.length) errs.push(`${where}: needs a name and a region`);
    if (!(f.need > 0 && f.need <= 1)) errs.push(`${where}: need must be a share between 0 and 1`);
    if (f.trait && !traits[f.trait]) errs.push(`${where}: unknown trait "${f.trait}"`);
    const eras = (f.eras || [rules.tech?.eras[0]?.id, rules.tech?.eras.at(-1)?.id]).map((e) => eraIdx[e]);
    if (eras.some((x) => x == null)) errs.push(`${where}: unknown era in eras`);
    for (const e of f.flagEras || []) if (eraIdx[e.before] == null) errs.push(`${where}: unknown era "${e.before}" in flagEras`);
    if (f.color && !/^#[0-9a-fA-F]{6}$/.test(f.color)) errs.push(`${where}: color must be #rrggbb`);
    // "TAG@scenario" entries are split once here: [tag, scenario or null]
    const split = (l) => (l || []).map((e) => { const [t, sc] = e.split('@'); return [t, sc || null]; });
    formables[id] = { ...f, id, eras, tags: split(f.tags), is: split(f.is), capitalIn: f.capitalIn || [], flagEras: (f.flagEras || []).map((e) => ({ ...e, i: eraIdx[e.before] })) };
  }
  const cfg = raw?.config || {};
  const A = cfg.advisors;
  if (A) for (const [t, T] of Object.entries(A.types || {})) checkFx(T.perSkill, `advisor "${t}"`);
  if (errs.length) throw new Error('Invalid nations data:\n' + errs.join('\n'));
  return {
    traits, tags, defaults, defaultCount: raw?.traits?.defaultCount ?? 2, formables, formableIds: Object.keys(formables),
    forming: cfg.forming || { minStability: 25, stability: 10, legitimacy: 10, claims: true, aiChance: 0.5 },
    prestige: cfg.prestige || { decayMonth: 0.012 },
    advisors: A || null, advisorTypes: A ? Object.keys(A.types) : [], missions: cfg.missions || null,
  };
}

// Recomputes everything derived from traits and advisors (government effects, technology multipliers).
export function refreshNation(state, rules, c) {
  if (c.govt) c.govt.fx = govEffects(rules, c);
  if (state.tech && c.tfx) refreshTech(state, rules, c);
}

// ---------------------------------------------------------------------------------------------
// traits

// The broad region of a country, from its capital's position.
export function regionOf(map, c) {
  const p = c.capital;
  if (p < 0 || !map.exists[p]) return 'west_europe';
  const lat = map.lat[p], lon = map.lon[p];
  if (lon < -140 || lon > 160 || (lon > 110 && lat < -10)) return 'oceania';
  if (lon < -30) return lat > 31 ? 'north_america' : 'latin_america';
  if (lat > 36 && lon < 40 && !(lon > 26 && lat < 42)) return lat > 54 && lon < 32 ? 'north_europe' : lon < 16 ? 'west_europe' : 'east_europe';
  if ((lat > 40 && lon >= 46 && lon < 90) || (lat > 44 && lon >= 90 && lon < 120)) return 'steppe';
  if (lat >= 15 && lon < 63) return 'mena';
  if (lon < 52) return 'sub_saharan';
  if (lon < 92 && lat < 37) return 'south_asia';
  if (lat < 23 && lon >= 92) return 'southeast_asia';
  return 'east_asia';
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Traits for a country from traits.json: its tag (TAG@scenario first), else the default rules.
export function defaultTraits(state, map, rules, c) {
  const N = rules.nations;
  const listed = N.tags[`${c.tag}@${state.scenarioId}`] || N.tags[c.tag];
  if (listed) return listed.slice();
  let n = 0, coast = 0, mount = 0;
  for (const i of map.ids) {
    if (state.prov.owner[i] !== c.idx) continue;
    n++;
    if (map.coastal[i]) coast++;
    if (map.terrain[i] === 2) mount++;
  }
  const region = regionOf(map, c), era = c.tfx?.era ?? 0, pop = c.cache?.pop || 0, dev = c.cache?.avgDev || 0;
  const out = [];
  N.defaults.forEach((d, ri) => {
    if (out.length >= N.defaultCount || !d.pick.length) return;
    if (d.region && !d.region.includes(region)) return;
    if (d.eras && (era < d.eras[0] || era > d.eras[1])) return;
    if (d.coastal != null && (!n || coast / n < d.coastal)) return;
    if (d.mountains != null && (!n || mount / n < d.mountains)) return;
    if (d.minPop != null && pop < d.minPop) return;
    if (d.minDev != null && dev < d.minDev) return;
    const h = hash(c.tag + ri);
    for (let j = 0; j < d.pick.length; j++) {
      const t = d.pick[(h + j) % d.pick.length];
      if (!out.includes(t)) { out.push(t); return; }
    }
  });
  return out;
}

// Gives every living country without traits its traits (new games, older saves, released
// countries). Returns how many were assigned.
export function assignTraits(state, map, rules) {
  if (!rules.nations) return 0;
  let n = 0;
  for (const c of state.countries) {
    if (c.traits || !c.alive) continue;
    c.traits = defaultTraits(state, map, rules, c);
    refreshNation(state, rules, c);
    n++;
  }
  return n;
}

// New game or loaded save: traits for everyone (saves keep theirs).
export function initNations(state, map, rules) {
  assignTraits(state, map, rules);
}

// ---------------------------------------------------------------------------------------------
// formable nations

const regionCache = new WeakMap();
// Provinces of a formable's region (cached per map).
export function formableRegion(map, rules, id) {
  let m = regionCache.get(map);
  if (!m) { m = new Map(); regionCache.set(map, m); }
  let r = m.get(id);
  if (r) return r;
  const F = rules.nations.formables[id], out = [];
  for (const i of map.ids) {
    for (const rule of F.region) {
      if (rule.iso && !rule.iso.includes(map.iso[i])) continue;
      if (rule.box && !(map.lon[i] >= rule.box[0] && map.lat[i] >= rule.box[1] && map.lon[i] <= rule.box[2] && map.lat[i] <= rule.box[3])) continue;
      if (rule.names && !rule.names.includes(map.name[i])) continue;
      out.push(i);
      break;
    }
  }
  r = Int32Array.from(out);
  m.set(id, r);
  return r;
}

// A [tag, scenario] entry names country c in this game.
function tagIs(state, [t, sc], c) {
  return t === c.tag && (!sc || sc === state.scenarioId);
}

// Whether country k is the kind of country that could form id (by its tag or its capital).
export function mayForm(state, map, rules, k, id) {
  const F = rules.nations.formables[id], c = state.countries[k];
  if (F.is.some((e) => tagIs(state, e, c)) || c.formed?.includes(id)) return false;
  if (F.tags.some((e) => tagIs(state, e, c))) return true;
  return c.capital >= 0 && F.capitalIn.includes(map.iso[c.capital]);
}

// Who already is each nation (an `is` country or one that formed it): formable id → country
// indices. Cached per day, map version (forming bumps it) and number of living countries.
const holderCache = new WeakMap();
function holders(state, rules) {
  let alive = 0;
  for (const c of state.countries) if (c.alive) alive++;
  const key = `${state.day}|${state.mapVersion || 0}|${alive}`;
  const hit = holderCache.get(state);
  if (hit && hit.key === key) return hit.m;
  const N = rules.nations, m = new Map(), add = (id, k) => { const l = m.get(id); if (l) l.push(k); else m.set(id, [k]); };
  for (const c of state.countries) {
    if (!c.alive) continue;
    for (const id of c.formed || []) add(id, c.idx);
    for (const id of N.formableIds) if (N.formables[id].is.some((e) => tagIs(state, e, c))) add(id, c.idx);
  }
  holderCache.set(state, { key, m });
  return m;
}

export function holderOf(state, rules, id, except = -1) {
  for (const k of holders(state, rules).get(id) || []) if (k !== except) return k;
  return -1;
}

// Everything about country k and formable id: { ok, why, own, total, share, need, missing }.
// `missing` (with withMissing) lists the region's provinces k does not own, most populous first.
export function formStatus(state, map, rules, k, id, withMissing = false) {
  const F = rules.nations.formables[id], N = rules.nations, c = state.countries[k];
  const reg = formableRegion(map, rules, id);
  let own = 0;
  const missing = withMissing ? [] : null;
  for (const p of reg) { if (state.prov.owner[p] === k) own++; else if (missing) missing.push(p); }
  if (missing) missing.sort((a, b) => state.prov.pop[b] - state.prov.pop[a]);
  const total = reg.length, share = total ? own / total : 0;
  const res = { ok: false, why: null, own, total, share, need: F.need, missing };
  const era = c.tfx?.era ?? 0, E = rules.tech.eras;
  const h = holderOf(state, rules, id, k);
  if (!c.alive) res.why = 'This country no longer exists';
  else if (!mayForm(state, map, rules, k, id)) res.why = c.formed?.includes(id) ? `Already formed` : `Only for countries based in its region`;
  else if (h >= 0) res.why = `${state.countries[h].name} already is ${F.name}`;
  else if (era < F.eras[0]) res.why = `Needs the ${E[F.eras[0]].name} era`;
  else if (era > F.eras[1]) res.why = `Only up to the ${E[F.eras[1]].name} era`;
  else if (F.families && !F.families.includes(govFamily(rules, c))) res.why = `Needs a government of the ${F.families.map((f) => rules.politics.families[f]?.name.toLowerCase() || f).join(' or ')} family`;
  else if (state.dip && overlordOf(state, k) >= 0) res.why = 'Not while a subject of another country';
  else if (c.stability < N.forming.minStability) res.why = `Needs stability ${N.forming.minStability}`;
  else if (share < F.need) res.why = `Own ${Math.ceil(F.need * total)} of its ${total} provinces (you have ${own})`;
  else res.ok = true;
  return res;
}

// The formables country k could ever form (by tag or capital), with their status.
export function formablesFor(state, map, rules, k) {
  if (!rules.nations) return [];
  return rules.nations.formableIds.filter((id) => mayForm(state, map, rules, k, id)).map((id) => ({ id, F: rules.nations.formables[id], st: formStatus(state, map, rules, k, id) }));
}

// The flag a formed nation flies in the country's current era.
function formedFlag(rules, F, era) {
  for (const e of F.flagEras.slice().sort((a, b) => a.i - b.i)) if (era < e.i) return e.flag;
  return F.flag ?? null;
}

// Forms nation id for country k. Returns an error string or null.
export function formNation(state, map, rules, k, id) {
  if (!rules.nations?.formables[id]) return 'Unknown nation';
  const st = formStatus(state, map, rules, k, id);
  if (!st.ok) return st.why;
  const F = rules.nations.formables[id], N = rules.nations, c = state.countries[k];
  const old = c.name;
  c.name = F.name;
  if (F.color) c.color = F.color;
  c.flagId = formedFlag(rules, F, c.tfx?.era ?? 0);
  if (F.pattern) c.flag = F.pattern;
  (c.formed ||= []).push(id);
  c.traits ||= [];
  if (F.trait && !c.traits.includes(F.trait)) c.traits.push(F.trait);
  c.prestigeBonus = (c.prestigeBonus || 0) + (F.prestige || 0);
  c.stability = Math.min(100, c.stability + N.forming.stability);
  if (c.govt) c.govt.legitimacy = Math.min(100, c.govt.legitimacy + N.forming.legitimacy);
  let claims = 0;
  if (N.forming.claims && state.dip) for (const p of formableRegion(map, rules, id)) { const o = state.prov.owner[p]; if (o >= 0 && o !== k) { addClaim(state, k, p); claims++; } }
  refreshNation(state, rules, c);
  state.mapVersion = (state.mapVersion || 0) + 1;
  log(state, 'world', `${old} has proclaimed ${F.name}${claims ? `, claiming ${claims} more province${claims === 1 ? '' : 's'} of the region` : ''}.`, { important: impFor(state, k), country: k, formed: id });
  if (!isHuman(state, k)) aiLog(state, k, `Formed ${F.name} (owns ${st.own} of ${st.total} provinces of the region).`);
  return null;
}

// Monthly: AI countries form nations they qualify for; the player is told once when one is possible.
function monthlyFormables(state, map, rules) {
  const N = rules.nations, C = state.countries;
  for (const id of N.formableIds) {
    const F = N.formables[id];
    if (holderOf(state, rules, id) >= 0) continue;
    // count owners over the region; only those with the share needed are checked further
    const reg = formableRegion(map, rules, id), count = new Map();
    for (const p of reg) { const o = state.prov.owner[p]; if (o >= 0) count.set(o, (count.get(o) || 0) + 1); }
    for (const [k, n] of count) {
      if (n / reg.length < F.need) continue;
      const c = C[k];
      const ai = !humanControls(state, k);
      if (!ai && c.formSeen?.includes(id)) continue;
      const st = formStatus(state, map, rules, k, id);
      if (!st.ok) continue;
      if (!ai) {
        (c.formSeen ||= []).push(id);
        logFor(state, k, 'politics', `You can now form ${F.name}: see Decisions in the Nation tab.`, { important: true, country: k, decision: id });
      } else if (hashRand(state, 'form', k, id) < N.forming.aiChance) formNation(state, map, rules, k, id);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// the monthly step (sim.js, before the country caches and prestige are refreshed)

export function monthlyNations(state, map, rules) {
  if (!rules.nations) return;
  assignTraits(state, map, rules);
  const P = rules.nations.prestige, D = rules.balance.diplomacy;
  for (const c of state.countries) {
    if (!c.alive) continue;
    if (c.prestigeBonus) { c.prestigeBonus *= 1 - P.decayMonth; if (c.prestigeBonus < 0.05) c.prestigeBonus = 0; else c.prestigeBonus = Math.round(c.prestigeBonus * 1000) / 1000; }
    const inf = c.tfx?.nat?.influence || 0;
    if (inf && c.influence != null) c.influence = Math.min(D.influenceCap, c.influence + inf);
    // a formed nation's flag follows the era (the German Empire's flag gives way to today's)
    if (c.formed?.length) {
      const F = rules.nations.formables[c.formed[c.formed.length - 1]];
      const f = F && formedFlag(rules, F, c.tfx?.era ?? 0);
      if (F && f !== c.flagId) c.flagId = f;
    }
  }
  monthlyAdvisors(state, map, rules);
  monthlyFormables(state, map, rules);
  monthlyMissions(state, map, rules);
}
