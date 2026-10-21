// Technology, research and eras (Milestone 5). Rules: data/rules/technologies.json and the
// `research` section of balance.json; docs/TECHNOLOGY.md explains every formula.
//
// Known technologies are one byte per country and technology in state.tech.known (saved with
// the list of ids, so a changed tech file remaps by id). Everything a country's technologies
// imply (unlocked goods, buildings, units and government types, the normalised effect
// multipliers and the era) lives in c.tfx, which is derived and rebuilt on load.
import { ageMult } from './ages.js';
import { log, aiLog, refreshCountryCache, logFor, isHuman, humanControls, impFor } from './state.js';
import { parseDate, civilFromDays } from './calendar.js';
import { countryNeighbours } from './geo.js';
import { isAtWar } from './relations.js';
import { nationalFx } from './natfx.js';

export const TECH_EFFECTS = ['farm', 'mine', 'industry', 'research', 'popGrowth', 'combat', 'movement', 'siege', 'devGrowth', 'tax', 'construction'];
const REF_YEAR = 2020;

// ---------------------------------------------------------------------------------------------
// rules

export function compileTech(json, rules) {
  const errs = [];
  const eras = (json.eras || []).map((e, i) => ({ ...e, i }));
  const eraIdx = Object.fromEntries(eras.map((e) => [e.id, e.i]));
  const fields = json.fields || {};
  const list = Object.entries(json.techs || {}).map(([id, t], i) => ({ id, i, ...t }));
  const idx = Object.fromEntries(list.map((t) => [t.id, t.i]));
  const X = rules.econ, P = rules.politics;
  const goodTech = new Int16Array(X.G).fill(-1), bldTech = new Int16Array(X.B).fill(-1);
  const unitTech = {}, govTech = {};
  for (const t of list) {
    const w = `technology "${t.id}"`;
    if (!(t.era in eraIdx)) errs.push(`${w}: unknown era "${t.era}"`);
    if (!(t.field in fields)) errs.push(`${w}: unknown field "${t.field}"`);
    if (!Number.isFinite(t.year)) errs.push(`${w}: year must be a number`);
    if (!(t.cost > 0)) errs.push(`${w}: cost must be positive`);
    t.eraI = eraIdx[t.era] ?? 0;
    t.reqI = (t.req || []).map((r) => { if (!(r in idx)) errs.push(`${w}: unknown prerequisite "${r}"`); return idx[r]; }).filter((x) => x != null);
    t.effects = t.effects || {};
    for (const [k, v] of Object.entries(t.effects)) {
      if (!TECH_EFFECTS.includes(k)) errs.push(`${w}: unknown effect "${k}"`);
      else if (typeof v !== 'number') errs.push(`${w}: effect "${k}" must be a number`);
    }
    const u = t.unlocks || {};
    for (const g of u.goods || []) { if (!(g in X.gi)) errs.push(`${w}: unknown good "${g}"`); else goodTech[X.gi[g]] = t.i; }
    for (const b of u.buildings || []) { if (!(b in X.bi)) errs.push(`${w}: unknown building "${b}"`); else bldTech[X.bi[b]] = t.i; }
    for (const un of u.units || []) { if (!rules.units[un]) errs.push(`${w}: unknown unit "${un}"`); else unitTech[un] = t.i; }
    for (const g of u.govTypes || []) { if (!P.types[g]) errs.push(`${w}: unknown government type "${g}"`); else govTech[g] = t.i; }
  }
  // units name their technology too (units.json "tech"); both directions must agree
  for (const [un, U] of Object.entries(rules.units)) {
    if (!U.tech) continue;
    if (!(U.tech in idx)) errs.push(`unit "${un}": unknown technology "${U.tech}"`);
    else unitTech[un] = idx[U.tech];
  }
  // prerequisites must not form cycles
  const state = new Uint8Array(list.length);
  const visit = (t) => {
    if (state[t.i] === 1) { errs.push(`technology "${t.id}": prerequisite cycle`); return; }
    if (state[t.i] === 2) return;
    state[t.i] = 1;
    for (const r of t.reqI) visit(list[r]);
    state[t.i] = 2;
  };
  list.forEach(visit);
  if (errs.length) throw new Error('Invalid technologies:\n' + errs.slice(0, 30).join('\n'));
  // the modern baseline: sums of every effect over real technologies up to REF_YEAR
  const ref = Object.fromEntries(TECH_EFFECTS.map((k) => [k, 0]));
  for (const t of list) if (!t.fictional && t.year <= REF_YEAR) for (const [k, v] of Object.entries(t.effects)) ref[k] += v;
  const byEra = eras.map((e) => list.filter((t) => t.eraI === e.i).map((t) => t.i));
  return { eras, eraIdx, fields, list, idx, T: list.length, goodTech, bldTech, unitTech, govTech, ref, byEra };
}

// ---------------------------------------------------------------------------------------------
// state

export function knows(state, k, t) {
  return t < 0 || state.tech.known[k * state.tech.T + t] === 1;
}

export function knowsId(state, rules, k, id) {
  const t = rules.tech.idx[id];
  return t != null && knows(state, k, t);
}

function yearOf(day) { return civilFromDays(day).y; }

// Installs starting technologies: everything first used up to the scenario's tech year minus
// the country's lag (plus prerequisites), and any listed explicitly. Fictional technologies
// are only given at start in scenarios marked "fictional" (the future scenarios).
export function initTechnology(state, map, rules, scenario) {
  const R = rules.tech, C = state.countries.length, T = R.T;
  state.tech = { ids: R.list.map((t) => t.id), T, known: new Uint8Array(C * T), ver: 0 };
  const startYear = yearOf(parseDate(scenario.startDate));
  const byTag = new Map((scenario.countries || []).map((c) => [c.tag, c]));
  for (const c of state.countries) {
    const sc = byTag.get(c.tag) || {};
    const year = (sc.techYear ?? scenario.techYear ?? startYear) - (sc.techLag ?? 0);
    for (const t of R.list) if ((!t.fictional || scenario.fictional) && t.year <= year) grantClosure(state, rules, c.idx, t.i);
    for (const id of sc.techs || []) if (id in R.idx) grantClosure(state, rules, c.idx, R.idx[id]);
    c.research = newResearch(rules, sc);
  }
  for (const c of state.countries) refreshTech(state, rules, c);
}

export function newResearch(rules, sc = {}) {
  return { current: null, progress: 0, queue: [], share: sc.researchShare ?? rules.balance.research.defaultShare, bank: 0, notified: false };
}

function grantClosure(state, rules, k, t) {
  if (knows(state, k, t)) return;
  state.tech.known[k * state.tech.T + t] = 1;
  for (const r of rules.tech.list[t].reqI) grantClosure(state, rules, k, r);
}

// Derived per-country technology data (c.tfx).
export function refreshTech(state, rules, c) {
  const R = rules.tech, X = rules.econ, k = c.idx;
  const sum = Object.fromEntries(TECH_EFFECTS.map((e) => [e, 0]));
  let n = 0;
  for (const t of R.list) {
    if (!knows(state, k, t.i)) continue;
    n++;
    for (const e in t.effects) sum[e] += t.effects[e];
  }
  const mult = {};
  for (const e of TECH_EFFECTS) mult[e] = e === 'construction' ? (1 + R.ref[e]) / (1 + sum[e]) : (1 + sum[e]) / (1 + R.ref[e]);
  // national traits and advisors (docs/NATIONS.md); naval and trade are read from tfx.nat, and the
  // industry bonus is applied per building below (not to power plants and refineries, where a
  // national edge only upsets the world energy market)
  const nat = nationalFx(rules, c);
  mult.research *= 1 + nat.research; mult.combat *= 1 + nat.combat; mult.farm *= 1 + nat.farm;
  mult.popGrowth *= 1 + nat.growth; mult.movement *= 1 + nat.movement; mult.siege *= 1 + nat.siege;
  const goods = new Uint8Array(X.G), bld = new Uint8Array(X.B), bm = new Float64Array(X.B);
  for (let g = 0; g < X.G; g++) goods[g] = knows(state, k, R.goodTech[g]) ? 1 : 0;
  for (const b of X.buildings) {
    bld[b.i] = knows(state, k, R.bldTech[b.i]) ? 1 : 0;
    bm[b.i] = b.fertility ? mult.farm : b.dep >= 0 ? mult.mine : mult.industry * (b.out.some(([g]) => X.goods[g].id === 'energy' || X.goods[g].id === 'fuel') ? 1 : 1 + nat.industry);
  }
  // inputs a country has no technology for are not required (pre-industrial methods)
  const inp = X.buildings.map((b) => b.inp.filter(([g]) => goods[g]));
  // era: the latest era in an unbroken run in which the country knows at least half
  let era = 0;
  for (const e of R.eras) {
    const ts = R.byEra[e.i];
    if (!ts.length) continue;
    let kn = 0;
    for (const t of ts) if (knows(state, k, t)) kn++;
    if (kn / ts.length >= 0.5) era = e.i; else break;
  }
  c.tfx = { mult, goods, bld, bm, inp, era, known: n, nat };
  return c.tfx;
}

export function refreshAllTech(state, rules) {
  for (const c of state.countries) refreshTech(state, rules, c);
}

export function canUseUnit(state, rules, k, type) {
  const t = rules.tech.unitTech[type];
  return t == null || knows(state, k, t);
}

export function canUseGov(state, rules, k, type) {
  const t = rules.tech.govTech[type];
  return t == null || knows(state, k, t);
}

export function techName(rules, t) { return t < 0 ? '' : rules.tech.list[t].name; }

// Grants technology t to country k. Returns false if it was already known.
export function grantTech(state, map, rules, k, t, why = '') {
  if (knows(state, k, t)) return false;
  state.tech.known[k * state.tech.T + t] = 1;
  state.tech.ver++;
  const c = state.countries[k], T = rules.tech.list[t];
  const before = c.tfx?.era ?? 0;
  refreshTech(state, rules, c);
  if (c.research.current === T.id) { c.research.current = null; c.research.progress = 0; }
  c.research.queue = c.research.queue.filter((id) => id !== T.id);
  logFor(state, k, 'research', `${T.name} ${why || 'researched'}.`, { important: true });
  if (c.tfx.era > before) {
    const E = rules.tech.eras[c.tfx.era];
    log(state, 'research', `${c.name} enters the ${E.name} era.`, { important: impFor(state, k) });
  }
  if (map) refreshCountryCache(state, map, rules);
  return true;
}

// ---------------------------------------------------------------------------------------------
// research

// World spread of each technology: share of world GDP held by countries that know it.
// Recomputed when the day or the known set changes, so it never depends on unsaved history.
const spreadCache = new WeakMap();
export function techSpread(state, rules) {
  const hit = spreadCache.get(state);
  if (hit && hit.day === state.day && hit.ver === state.tech.ver) return hit.share;
  const T = rules.tech.T, share = new Float64Array(T);
  let tot = 0;
  for (const c of state.countries) {
    if (!c.alive || !c.cache) continue;
    const g = c.cache.gdp;
    tot += g;
    const off = c.idx * T;
    for (let t = 0; t < T; t++) if (state.tech.known[off + t]) share[t] += g;
  }
  if (tot > 0) for (let t = 0; t < T; t++) share[t] /= tot;
  spreadCache.set(state, { day: state.day, ver: state.tech.ver, share });
  return share;
}

export function available(state, rules, k, t) {
  if (knows(state, k, t)) return false;
  for (const r of rules.tech.list[t].reqI) if (!knows(state, k, r)) return false;
  return true;
}

// Research points needed for t, with the diffusion discount explained.
export function techCost(state, map, rules, k, t, parts = null) {
  const Rb = rules.balance.research, T = rules.tech.list[t];
  const base = (Rb.eraCost[T.era] ?? 150) * T.cost;
  const nbs = countryNeighbours(state, map).sets[k];
  let nk = 0, nn = 0;
  for (const j of nbs) { if (!state.countries[j].alive) continue; nn++; if (knows(state, j, t)) nk++; }
  const nShare = nn ? nk / nn : 0;
  const wShare = techSpread(state, rules)[t];
  const disc = Rb.maxDiscount * (Rb.neighbourWeight * nShare + (1 - Rb.neighbourWeight) * wShare);
  if (parts) Object.assign(parts, { base, neighbours: nShare, world: wShare, discount: disc });
  return base * (1 - disc);
}

// Research points per month: sqrt of real research spending, times education and the
// research multiplier from known technologies.
export function researchPoints(state, rules, c, parts = null) {
  const Rb = rules.balance.research;
  if (!c.alive || !c.ledger || !c.cache) return 0;
  const spend = Math.max(0, c.ledger.research || 0);
  const real = spend / Math.max(0.1, c.cache.priceLevel);
  const edu = Rb.eduMin + (1 - Rb.eduMin) * Math.min(1.25, c.cache.avgDev / rules.balance.economy.refDev);
  // orbital stations and off-world settlements add research; network disruption cuts it
  const st = c.strat;
  const space = st ? (1 + 0.03 * st.stations + 0.06 * st.colonies) * (st.disrupted > 0 ? 0.8 : 1) : 1;
  // a golden age speeds research, a dark age slows it (ages.js)
  const mult = (c.tfx?.mult.research ?? 1) * space * ageMult(rules, c, 'research');
  const rp = Rb.rpScale * Math.sqrt(real) * edu * mult;
  if (parts) Object.assign(parts, { spend, real, edu, mult, rp });
  return rp;
}

export function canResearch(state, rules, k, id) {
  const t = rules.tech.idx[id];
  if (t == null) return 'Unknown technology';
  if (knows(state, k, t)) return 'Already known';
  const miss = rules.tech.list[t].reqI.filter((r) => !knows(state, k, r)).map((r) => rules.tech.list[r].name);
  if (miss.length) return `Needs ${miss.join(', ')}`;
  return null;
}

// Starts researching id now (progress on the previous project is kept as banked points).
export function setResearch(state, rules, k, id) {
  const why = canResearch(state, rules, k, id);
  if (why) return why;
  const r = state.countries[k].research;
  if (r.current && r.current !== id) r.bank += r.progress * rules.balance.research.switchKeep;
  r.current = id; r.progress = 0;
  r.queue = r.queue.filter((x) => x !== id);
  r.notified = false;
  return null;
}

// Adds id (and missing prerequisites, in order) to the queue.
export function queueResearch(state, rules, k, id) {
  const R = rules.tech, t0 = R.idx[id];
  if (t0 == null) return 'Unknown technology';
  if (knows(state, k, t0)) return 'Already known';
  const r = state.countries[k].research;
  const order = [];
  const add = (t) => {
    if (knows(state, k, t) || order.includes(t)) return;
    for (const q of R.list[t].reqI) add(q);
    order.push(t);
  };
  add(t0);
  for (const t of order) { const tid = R.list[t].id; if (tid !== r.current && !r.queue.includes(tid)) r.queue.push(tid); }
  if (r.queue.length > rules.balance.research.maxQueue) { r.queue.length = rules.balance.research.maxQueue; return `The queue holds ${rules.balance.research.maxQueue} projects`; }
  if (!r.current) startNext(state, rules, k);
  return null;
}

function startNext(state, rules, k) {
  const r = state.countries[k].research;
  while (r.queue.length) {
    const id = r.queue.shift();
    if (!canResearch(state, rules, k, id)) { r.current = id; r.progress = 0; return true; }
  }
  return false;
}

export function setResearchShare(state, rules, k, share) {
  const Rb = rules.balance.research;
  if (!(share >= 0 && share <= Rb.maxShare)) return `Research spending must be 0–${Math.round(Rb.maxShare * 100)}% of tax revenue`;
  state.countries[k].research.share = Math.round(share * 1000) / 1000;
  return null;
}

// Monthly: every country adds its research points to its project; finished projects grant the
// technology. AI countries (and automated players) choose their next project.
export function monthlyResearch(state, map, rules) {
  const Rb = rules.balance.research;
  techSpread(state, rules);
  for (const c of state.countries) {
    if (!c.alive || !c.research) continue;
    const k = c.idx, r = c.research;
    const rp = researchPoints(state, rules, c);
    const ai = !humanControls(state, k);
    if (!r.current && !startNext(state, rules, k) && ai) chooseResearch(state, map, rules, c);
    if (!r.current) {
      r.bank = Math.min(rp * Rb.bankMonths, r.bank + rp);
      if (isHuman(state, k) && !r.notified && anyAvailable(state, rules, k)) {
        r.notified = true;
        logFor(state, k, 'research', 'Choose a research project: points are being banked (Research tab).', { important: true });
      }
      continue;
    }
    const t = rules.tech.idx[r.current];
    if (t == null || knows(state, k, t)) { r.current = null; r.progress = 0; continue; }
    const use = Math.min(r.bank, rp);
    r.bank -= use;
    r.progress = Math.round((r.progress + rp + use) * 1000) / 1000;
    const cost = techCost(state, map, rules, k, t);
    if (r.progress >= cost) {
      const over = r.progress - cost;
      grantTech(state, null, rules, k, t);
      r.bank = Math.min(rp * Rb.bankMonths, r.bank + over);
      if (!startNext(state, rules, k) && ai) chooseResearch(state, map, rules, c);
    }
  }
  refreshCountryCache(state, map, rules);
}

function anyAvailable(state, rules, k) {
  for (const t of rules.tech.list) if (available(state, rules, k, t.i)) return true;
  return false;
}

// AI: pick the available technology with the best value for its cost, weighted by what the
// country needs now (armies at war, food when hungry, administration when unstable…).
export function chooseResearch(state, map, rules, c) {
  const k = c.idx, R = rules.tech;
  const war = isAtWar(state, k);
  const e = c.econ;
  const want = {
    army: war ? 2.2 : 1.1, doctrine: war ? 1.8 : 1, agriculture: e && e.foodSat < 0.95 ? 2 : 1, administration: c.stability < 40 ? 1.8 : 1,
    economy: 1.3, energy: e && e.gdpMult < 0.97 ? 1.8 : 1.1, medicine: 1, education: 1.4, transport: 1.1, communications: 1, navy: 0.6, air: war ? 1.2 : 0.8, space: 0.6,
  };
  let best = null, bv = -1, why = '';
  for (const t of R.list) {
    if (!available(state, rules, k, t.i)) continue;
    const u = t.unlocks || {};
    let v = 1 + Object.values(t.effects).reduce((s, x) => s + x, 0) * 4;
    v += (u.buildings?.length || 0) * 1.5 + (u.goods?.length || 0) + (u.units?.length || 0) * (war ? 2.5 : 1.2);
    v *= want[t.field] ?? 1;
    if (t.fictional) v *= 0.8;
    const cost = techCost(state, map, rules, k, t.i);
    const score = v / cost;
    if (score > bv) { bv = score; best = t; why = `${R.fields[t.field] || t.field}, cost ${Math.round(cost)}`; }
  }
  if (!best) return null;
  c.research.current = best.id; c.research.progress = 0;
  aiLog(state, k, `Researching ${best.name} (${why}).`);
  return best.id;
}

// Era-dependent share of the population that can be mobilised (doctrine and social structure).
export function manpowerShare(rules, c) {
  const e = rules.tech?.eras[c.tfx?.era ?? -1];
  return e?.manpowerShare ?? rules.balance.population.manpowerShare;
}

export function eraOf(rules, c) {
  return rules.tech.eras[c.tfx?.era ?? 0];
}
