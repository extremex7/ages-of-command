// Religion, unrest, revolts and ages: setup and the clock (docs/RELIGION.md).
// state.society = { ids, rel, conv, unrest, core, since, last, supp, revolts, ver, rver } holds the
// per-province fields (typed arrays) and the revolts; c.soc holds each country's state religion,
// war exhaustion, unrest average, age and stability parts. All of it is created lazily with
// defaults (ensureSociety), so saves from before this system load without a migration.
import { civilFromDays } from './calendar.js';
import { seedProvinces, seedStateReligion, applyScenarioReligion, monthlyConversion, aiReligion, stateRelIdx, policyFx, NO_REL } from './religion.js';
import { monthlyUnrest, monthlyWarExhaustion, monthlyRevolts, dailyRevolts, aiRevolts, aiTolerance, newSoc, heldMask } from './unrest.js';
import { monthlyAges, ageEffect } from './ages.js';
import { setPolicy } from './government.js';

// Creates the society state for a new game (scenario given) or an old save (scenario may be null).
export function initSociety(state, map, rules, scenario = null) {
  const S = rules.society;
  if (!S) return null;
  const N = map.count, year = civilFromDays(state.day).y;
  const rel = seedProvinces(map, S, year);
  state.society = {
    ids: S.list.map((r) => r.id), rel, conv: new Float32Array(N), unrest: new Float32Array(N),
    core: Int16Array.from(state.prov.owner), since: new Int32Array(N).fill(state.day - 365 * 200), last: Int16Array.from(state.prov.owner),
    supp: new Uint8Array(N), revolts: [], ver: 0, rver: 0,
  };
  for (const c of state.countries) c.soc = newSoc(seedStateReligion(state, map, S, c, year, rel));
  applyScenarioReligion(state, map, S, scenario, rel);
  // settle unrest so the first months do not jump
  for (let k = 0; k < 6; k++) monthlyUnrest(state, map, rules);
  for (const c of state.countries) c.soc.parts = stabilityParts(state, rules, c);
  return state.society;
}

// Returns state.society, creating or repairing it (old saves, a grown map, changed religion list).
export function ensureSociety(state, map, rules) {
  const S = rules.society;
  if (!S) return null;
  let so = state.society;
  if (!so || !ArrayBuffer.isView(so.rel)) return initSociety(state, map, rules);
  const N = map.count;
  if (so.rel.length < N) {
    for (const k of ['rel', 'conv', 'unrest', 'core', 'since', 'last', 'supp']) {
      const a = new so[k].constructor(N);
      if (k === 'rel') a.fill(NO_REL);
      if (k === 'core' || k === 'last') a.fill(-1);
      a.set(so[k]); so[k] = a;
    }
  }
  // a changed religion list: map province religions by id
  const ids = S.list.map((r) => r.id);
  if (!Array.isArray(so.ids) || so.ids.length !== ids.length || so.ids.some((id, i) => id !== ids[i])) {
    const from = (so.ids || []).map((id) => S.idx[id] ?? NO_REL);
    for (let i = 0; i < so.rel.length; i++) so.rel[i] = so.rel[i] === NO_REL ? NO_REL : from[so.rel[i]] ?? NO_REL;
    so.ids = ids;
  }
  so.revolts = (so.revolts || []).filter((r) => r.c < state.countries.length && r.p < N && rules.units[r.type]);
  for (const c of state.countries) {
    if (!c.soc) c.soc = newSoc(majority(state, map, rules, c.idx));
    else if (S.idx[c.soc.rel] == null) c.soc.rel = majority(state, map, rules, c.idx);
  }
  return so;
}

function majority(state, map, rules, k) {
  const S = rules.society, so = state.society, n = new Float64Array(S.list.length);
  for (const i of map.ids) if (state.prov.owner[i] === k && so.rel[i] !== NO_REL) n[so.rel[i]] += state.prov.pop[i] + 1;
  let best = -1;
  n.forEach((v, r) => { if (v > 0 && (best < 0 || v > n[best])) best = r; });
  return S.list[best >= 0 ? best : S.idx.animist ?? 0].id;
}

// Stability target contributions (added by economy.js), from religion, unrest, revolts, war
// exhaustion and the current age.
export function stabilityParts(state, rules, c) {
  const S = rules.society, so = state.society;
  if (!S || !so || !c.soc) return null;
  const pf = policyFx(S, c), r2 = (x) => Math.round(x * 100) / 100, out = {};
  const mis = c.soc.misShare || 0;
  let rel = -S.R.stabilityWeight * mis * pf.stability;
  if (c.govt?.policies?.religion === 'state') rel += S.R.unityBonus * Math.max(0, 1 - mis / 0.1);
  if (rel) out.religion = r2(rel);
  const u = -S.U.stabilityWeight * Math.max(0, (c.soc.unrest || 0) - S.U.stabilityFree);
  if (u) out.unrest = r2(u);
  const mine = so.revolts.filter((r) => r.c === c.idx);
  if (mine.length) {
    let held = 0;
    for (const r of mine) for (const p of r.held) held += state.prov.pop[p];
    out.revolts = r2(-S.V.stabilityPerRevolt * mine.length - S.V.heldStability * held / Math.max(1, c.cache?.pop || 1));
  }
  if (c.soc.warEx) out.war = r2(-S.U.warStability * c.soc.warEx);
  const a = ageEffect(rules, c, 'stability');
  if (a) out.age = a;
  return out;
}

// Ownership changes since last month: the new owner holds the province from today; land held
// for integrationYears (or returned to its old owner) becomes the owner's core.
function trackOwners(state, map, rules) {
  const so = state.society, P = state.prov, U = rules.society.U;
  for (const i of map.ids) {
    const o = P.owner[i];
    if (so.last[i] !== o) { so.last[i] = o; so.since[i] = state.day; so.conv[i] = 0; }
    if (o >= 0 && so.core[i] !== o && (so.core[i] < 0 || state.day - so.since[i] >= U.integrationYears * 365)) so.core[i] = o;
  }
}

export function monthlySociety(state, map, rules, warScores) {
  if (!rules.society || !ensureSociety(state, map, rules)) return;
  trackOwners(state, map, rules);
  monthlyWarExhaustion(state, rules, warScores);
  monthlyConversion(state, map, rules);
  monthlyUnrest(state, map, rules);
  monthlyRevolts(state, map, rules);
  monthlyAges(state, map, rules, warScores);
  // armies whose revolt is over return to normal duty
  for (const a of state.armies) if (a.quell && !state.society.revolts.some((r) => r.id === a.quell)) delete a.quell;
  for (const c of state.countries) {
    if (!c.alive || !c.soc) continue;
    if (c.idx !== state.player || c.automate) {
      aiRevolts(state, map, rules, c);
      aiTolerance(state, rules, c, setPolicy);
      aiReligion(state, map, rules, c);
    }
    c.soc.parts = stabilityParts(state, rules, c);
  }
}

export function dailySociety(state, map, rules) {
  if (!rules.society || !state.society?.revolts?.length) return;
  dailyRevolts(state, map, rules);
}

export { heldMask, stateRelIdx };
