// Province unrest and local revolts (docs/RELIGION.md). Unrest (0-100 per province, a Float32Array
// in state.society) follows a monthly target built from stability, religion, conquest and
// separatism, war exhaustion, taxes, hunger, civil spending, garrisons and crackdowns. High unrest
// raises rebel bands: a lightweight force (state.society.revolts) that besieges and holds
// provinces of its own country, fights that country's armies standing with it, and wins
// concessions or independence if it is not put down. This complements civilwar.js, which splits a
// whole country into two at war; a revolt never becomes a country unless it is separatist and
// wins, and then only for the land it holds.
import { log, aiLog, logFor, impFor, humanControls, newArmy, pickCapital, refreshCountryCache, armyPower } from './state.js';
import { rand } from './rng.js';
import { touchRelations, isAtWar } from './relations.js';
import { transferProvince } from './war.js';
import { govEffects } from './government.js';
import { bestUnits, orderMove } from './military.js';
import { addCountry } from './civilwar.js';
import { computeLedgers } from './economy.js';
import { tagIndex } from './events.js';
import { civilFromDays } from './calendar.js';
import { NO_REL, mismatch, policyFx, stateRelIdx, relFamily } from './religion.js';
import { ageEffect } from './ages.js';

const KIND_NAMES = { faith: 'religious revolt', separatist: 'separatist revolt', popular: 'popular revolt' };
export function revoltKindName(k) { return KIND_NAMES[k] || 'revolt'; }

// Provinces dormant countries would get when released (state.releases), as province → country
// index (-1 for none); rebuilt when a country is released or dies.
const claimCache = new WeakMap();
export function dormantClaims(state, map) {
  const key = state.countries.map((c) => (c.alive ? 1 : 0)).join('');
  let x = claimCache.get(state);
  if (x && x.key === key) return x.claim;
  const claim = new Int16Array(map.count).fill(-1);
  for (const [tag, ps] of Object.entries(state.releases || {})) {
    const k = tagIndex(state, tag);
    if (k < 0 || state.countries[k].alive) continue;
    for (const p of ps) if (p < map.count) claim[p] = k;
  }
  claimCache.set(state, { key, claim });
  return claim;
}

// Land units of each province's owner standing in it (garrisons), one pass over the armies.
export function garrisons(state, map) {
  const g = new Int32Array(map.count);
  for (const a of state.armies) {
    if (a.sea >= 0 || a.loc >= map.count || state.prov.owner[a.loc] !== a.owner) continue;
    for (const t in a.units) g[a.loc] += a.units[t];
  }
  return g;
}

// The parts of a province's unrest target (each in unrest points). gar = garrison units.
export function unrestParts(state, map, rules, i, gar = 0, claim = null) {
  const S = rules.society, U = S.U, so = state.society, o = state.prov.owner[i];
  if (o < 0) return null;
  const c = state.countries[o], r2 = (x) => Math.round(x * 10) / 10;
  const p = {};
  p.stability = r2((50 - c.stability) * U.stability);
  const s = stateRelIdx(S, c), m = mismatch(S, so.rel[i], s);
  if (m) p.religion = r2(S.R.mismatchUnrest * m * policyFx(S, c).unrest);
  const core = so.core[i];
  if (core !== o) {
    const yrs = (state.day - so.since[i]) / 365;
    p.conquest = r2(U.conquest * Math.max(U.conquestFloor, 1 - yrs / U.integrationYears));
  }
  const cl = (claim || dormantClaims(state, map))[i];
  if (cl >= 0 || (core >= 0 && core !== o && state.countries[core]?.alive)) p.separatism = U.separatism;
  if (c.soc?.warEx) p.war = r2(c.soc.warEx * U.warExhaustion);
  if (c.tax > U.taxFree) p.tax = r2((c.tax - U.taxFree) * U.tax);
  const fs = c.econ?.foodSat ?? 1;
  if (fs < 1) p.food = r2((1 - fs) * U.food);
  p.civil = r2(-(c.civilShare - U.civilRef) * U.civil);
  if (gar) p.garrison = -Math.min(U.garrisonMax, gar * U.garrisonPerUnit);
  if (so.supp[i]) p.suppression = -so.supp[i];
  if (c.capital === i) p.capital = -U.capital;
  const ae = ageEffect(rules, c, 'unrest');
  if (ae) p.age = ae;
  return p;
}

export function unrestTarget(parts) {
  let t = 0;
  for (const k in parts) t += parts[k];
  return Math.max(0, Math.min(100, t));
}

// Share of a province's tax the owner collects (rebel-held land pays nothing).
export function taxFactor(state, rules, i) {
  const so = state.society;
  if (!so || !rules.society) return 1;
  if (heldMask(state)[i]) return 0;
  return Math.max(0, 1 - rules.society.U.taxLoss * so.unrest[i]);
}

// Monthly unrest update, plus per-country averages (people-weighted) into c.soc.
export function monthlyUnrest(state, map, rules) {
  const S = rules.society, so = state.society, C = state.countries, U = S.U;
  const gar = garrisons(state, map), claim = dormantClaims(state, map);
  const n = C.length, sumU = new Float64Array(n), sumP = new Float64Array(n), mis = new Float64Array(n), same = new Float64Array(n);
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) { so.unrest[i] = 0; continue; }
    if (so.supp[i] > 0) so.supp[i] = Math.max(0, so.supp[i] - S.V.suppressDecay);
    const t = unrestTarget(unrestParts(state, map, rules, i, gar[i], claim));
    so.unrest[i] = Math.round((so.unrest[i] + (t - so.unrest[i]) * U.smoothing) * 100) / 100;
    const w = state.prov.pop[i] + 1;
    sumU[o] += so.unrest[i] * w; sumP[o] += w;
    const s = stateRelIdx(S, C[o]);
    mis[o] += w * mismatch(S, so.rel[i], s);
    if (so.rel[i] === s) same[o] += w;
  }
  for (const c of C) {
    if (!c.soc) continue;
    c.soc.unrest = sumP[c.idx] ? Math.round(sumU[c.idx] / sumP[c.idx] * 10) / 10 : 0;
    c.soc.misShare = sumP[c.idx] ? Math.round(mis[c.idx] / sumP[c.idx] * 1000) / 1000 : 0;
    c.soc.faith = sumP[c.idx] ? Math.round(same[c.idx] / sumP[c.idx] * 1000) / 1000 : 1;
  }
}

// War exhaustion: grows while at war (faster when land is occupied or the war is lost), fades in peace.
export function monthlyWarExhaustion(state, rules, warScores) {
  const U = rules.society.U;
  for (const c of state.countries) {
    if (!c.alive || !c.soc) continue;
    let at = false, losing = false;
    for (const w of state.wars) {
      const a = w.attackers.includes(c.idx);
      if (!a && !w.defenders.includes(c.idx)) continue;
      at = true;
      const sc = warScores?.get(w) ?? 0;
      if ((a ? sc : -sc) < -20) losing = true;
    }
    const occ = c.cache?.provinces ? c.cache.occupied / c.cache.provinces : 0;
    const w0 = c.soc.warEx || 0;
    const w1 = at ? w0 + U.warGrowth + U.warOccupied * occ + (losing ? U.warLosing : 0) : w0 * (1 - U.warDecay);
    c.soc.warEx = Math.round(Math.max(0, Math.min(100, w1)) * 100) / 100;
  }
}

// --- revolts

const maskCache = new WeakMap();
// 1 for every province a revolt holds (cached until the revolts change).
export function heldMask(state) {
  const so = state.society, N = state.prov.owner.length;
  let x = maskCache.get(state);
  if (x && x.ver === so.rver && x.m.length === N) return x.m;
  const m = new Uint8Array(N);
  for (const r of so.revolts) for (const p of r.held) m[p] = 1;
  maskCache.set(state, { ver: so.rver, m });
  return m;
}

function touch(state, map) { state.society.rver = (state.society.rver || 0) + 1; state.mapVersion = (state.mapVersion || 0) + 1; }

export function revoltAt(state, p) {
  for (const r of state.society?.revolts || []) if (r.p === p || r.held.includes(p)) return r;
  return null;
}

export function revoltPower(state, rules, r, map = null) {
  const V = rules.society.V, u = rules.units[r.type];
  if (!u) return 0;
  const t = map ? map.terrain[r.p] : 0;
  const ter = t === 1 || t === 2 || t === 3 ? V.rebelTerrain : 1; // hills, mountains, forest
  return r.units * (u.attack + u.defense) * r.str * V.rebelPower * ter;
}

function lineUnit(state, rules, k) {
  const b = state.tech ? bestUnits(state, rules, k, 'land') : {};
  return b.line || Object.keys(rules.units).find((t) => (rules.units[t].domain || 'land') === 'land');
}

// Starts a revolt in province p of its owner. kind: faith | separatist | popular.
export function startRevolt(state, map, rules, p, kind, why = '') {
  const S = rules.society, V = S.V, so = state.society, k = state.prov.owner[p];
  if (k < 0) return null;
  const c = state.countries[k], u = so.unrest[p];
  let tag = null, rel = -1;
  if (kind === 'faith') rel = so.rel[p];
  if (kind === 'separatist') {
    const cl = dormantClaims(state, map)[p], core = so.core[p];
    tag = cl >= 0 ? state.countries[cl].tag : core >= 0 && core !== k && state.countries[core]?.alive ? state.countries[core].tag : null;
  }
  const units = Math.min(V.maxUnits, V.minUnits + state.prov.pop[p] / V.popPerUnit * u / 100);
  const name = kind === 'faith' ? `${S.list[rel]?.name || 'Religious'} uprising in ${map.name[p]}`
    : kind === 'separatist' ? (tag ? `${state.countries[tagIndex(state, tag)].name} separatists in ${map.name[p]}` : `${map.name[p]} separatists`)
      : `Popular revolt in ${map.name[p]}`;
  const r = { id: state.nextId++, c: k, kind, p, units: Math.round(units * 100) / 100, type: lineUnit(state, rules, k), str: 1, prog: 0, held: [], since: -1, start: state.day, rel, tag, name };
  so.revolts.push(r);
  touch(state, map);
  log(state, 'war', `${c.name}: ${name}${why ? ` (${why})` : ''}. ${Math.max(1, Math.round(r.units))} rebel unit(s) have taken up arms.`, { important: impFor(state, k), prov: p, country: k });
  if (!humanControls(state, k)) aiLog(state, k, `Revolt: ${name}, unrest ${Math.round(u)}.`);
  return r;
}

// Which kind of revolt a province's unrest would raise: the largest of its causes.
export function revoltKind(parts) {
  const faith = parts.religion || 0, sep = (parts.conquest || 0) + (parts.separatism || 0);
  const other = Math.max(0, (parts.stability || 0) + (parts.war || 0) + (parts.tax || 0) + (parts.food || 0));
  if (faith >= 8 && faith >= sep && faith >= other * 0.6) return 'faith';
  if (sep >= 10 && sep >= other * 0.6) return 'separatist';
  return 'popular';
}

function endRevolt(state, map, r, unrestDrop = 0) {
  const so = state.society;
  for (const p of [...r.held, r.p]) if (p >= 0 && p < map.count) so.unrest[p] = Math.max(0, so.unrest[p] - unrestDrop);
  so.revolts = so.revolts.filter((x) => x !== r);
  touch(state, map);
}

function crush(state, map, rules, r) {
  const c = state.countries[r.c];
  endRevolt(state, map, r, rules.society.V.crushedUnrest);
  if (c.govt) c.govt.glory = Math.min(1, c.govt.glory + 0.05);
  log(state, 'war', `${c.name} crushed the ${r.name.charAt(0).toLowerCase() + r.name.slice(1)}.`, { important: impFor(state, r.c), prov: r.p, country: r.c });
}

// Daily: battles between rebels and the armies standing with them, rebel sieges, and armies
// taking back rebel-held land. Only runs while revolts exist.
export function dailyRevolts(state, map, rules) {
  const so = state.society;
  if (!so?.revolts.length) return;
  const V = rules.society.V;
  const here = new Map();
  for (const a of state.armies) {
    if (a.sea >= 0 || a.battle || a.path.length) continue;
    const r = revoltAt(state, a.loc);
    if (!r || a.owner !== r.c) continue;
    if (!here.has(a.loc)) here.set(a.loc, []);
    here.get(a.loc).push(a);
  }
  for (const r of [...so.revolts]) {
    // armies retake held provinces the rebels have left
    const freed = r.held.filter((p) => p !== r.p && here.has(p));
    if (freed.length) { r.held = r.held.filter((p) => !freed.includes(p)); if (!r.held.length) r.since = -1; touch(state, map); }
    const armies = here.get(r.p);
    if (armies?.length) {
      let G = 0;
      for (const a of armies) G += armyPower(a, rules);
      const R = revoltPower(state, rules, r, map), share = G / Math.max(1e-9, G + R);
      if (!r.fight) { r.fight = state.day; logFor(state, r.c, 'battle', `Your troops engage the ${r.name.charAt(0).toLowerCase() + r.name.slice(1)}.`, { prov: r.p }); }
      r.str = Math.max(0, r.str - V.rebelDamage * share * (0.75 + 0.5 * rand(state)));
      for (const a of armies) {
        a.str = Math.max(0.05, a.str - V.armyDamage * (1 - share));
        a.org = Math.max(0, a.org - V.armyOrgDamage * (1 - share));
      }
      if (r.str < V.crushedStr) crush(state, map, rules, r);
      continue;
    }
    r.fight = 0;
    const p = r.p;
    if (r.held.includes(p) || state.prov.owner[p] !== r.c || state.prov.controller[p] !== r.c) continue;
    r.prog += 1 / (V.siegeDays + V.siegeFortDays * state.prov.fort[p]);
    if (r.prog >= 1) {
      r.prog = 0;
      r.held.push(p);
      if (r.since < 0) r.since = state.day;
      touch(state, map);
      logFor(state, r.c, 'war', `Rebels have taken ${map.name[p]}.`, { important: true, prov: p });
    }
  }
}

// Monthly: revolts grow, move on, win their demands; new revolts break out.
export function monthlyRevolts(state, map, rules) {
  const S = rules.society, V = S.V, so = state.society, C = state.countries, P = state.prov;
  const months = (d) => (state.day - d) / 30.44;
  const gar = garrisons(state, map), held = heldMask(state);
  for (const r of [...so.revolts]) {
    const c = C[r.c];
    if (!c?.alive || P.owner[r.p] !== r.c) { endRevolt(state, map, r); continue; }
    const before = r.held.length;
    r.held = r.held.filter((p) => P.owner[p] === r.c && P.controller[p] === r.c);
    if (r.held.length !== before) { touch(state, map); if (!r.held.length) r.since = -1; }
    if (!r.fight) r.str = Math.min(1, r.str + 0.05);
    let add = 0;
    for (const p of r.held) add += so.unrest[p] / 100;
    r.units = Math.round(Math.min(V.maxUnits, r.units + V.growth * add) * 100) / 100;
    if (r.held.length && r.since >= 0) {
      if (r.kind === 'separatist' && months(r.since) >= V.independenceMonths) { independence(state, map, rules, r); continue; }
      if (r.kind !== 'separatist' && months(r.since) >= V.demandMonths) { concede(state, map, rules, r); continue; }
    }
    // after taking its province the band moves to the most restless neighbouring one it can take
    if (!r.fight && r.held.includes(r.p)) {
      let best = -1, bs = 25;
      for (let e = map.adjStart[r.p]; e < map.adjStart[r.p + 1]; e++) {
        const j = map.adj[e];
        if (map.adjKind[e] === 2 || P.owner[j] !== r.c || P.controller[j] !== r.c || held[j] || gar[j] || revoltAt(state, j)) continue;
        let s = so.unrest[j];
        if (r.kind === 'faith' && so.rel[j] === r.rel) s += 20;
        if (r.kind === 'separatist' && r.tag && dormantClaims(state, map)[j] === tagIndex(state, r.tag)) s += 20;
        if (s > bs) { bs = s; best = j; }
      }
      if (best >= 0) { r.p = best; r.prog = 0; touch(state, map); }
    }
  }
  // new revolts: at most one per country a month, and maxPerCountry at once
  const count = new Int32Array(C.length), started = new Uint8Array(C.length);
  for (const r of so.revolts) count[r.c]++;
  const claim = dormantClaims(state, map);
  for (const i of map.ids) {
    const u = so.unrest[i];
    if (u < V.unrest) continue;
    const k = P.owner[i];
    if (k < 0 || P.controller[i] !== k || started[k] || count[k] >= V.maxPerCountry || held[i] || revoltAt(state, i)) continue;
    if (rand(state) >= V.chance * (u - V.unrest) / (100 - V.unrest)) continue;
    const parts = unrestParts(state, map, rules, i, gar[i], claim);
    startRevolt(state, map, rules, i, revoltKind(parts), `unrest ${Math.round(u)}`);
    started[k] = 1; count[k]++;
  }
}

// A faith or popular revolt that holds land long enough wins its demands and goes home.
function concede(state, map, rules, r) {
  const c = state.countries[r.c], E = rules.balance.economy;
  let what;
  if (r.kind === 'faith' && c.govt?.policies.religion === 'state') {
    c.govt.policies.religion = 'tolerant';
    c.govt.policyDay = state.day;
    c.govt.fx = govEffects(rules, c);
    what = 'religious tolerance';
  } else if (r.kind === 'popular' && c.tax > E.minTax + 0.01) {
    c.tax = Math.max(E.minTax, Math.round((c.tax - 0.05) * 100) / 100);
    what = 'lower taxes';
  } else what = 'concessions';
  if (c.govt) c.govt.legitimacy = Math.max(0, c.govt.legitimacy - 10);
  c.stability = Math.max(0, c.stability - 4);
  for (const p of r.held) state.society.supp[p] = Math.max(state.society.supp[p], 15);
  endRevolt(state, map, r, 30);
  log(state, 'politics', `${c.name} gave in to the ${r.name.charAt(0).toLowerCase() + r.name.slice(1)}: ${what}. The rebels have gone home.`, { important: true, country: r.c, prov: r.p });
}

// Separatists who hold out declare independence: a dormant country is released, a former owner
// takes its land back, or a new country is formed from the provinces they hold.
export function independence(state, map, rules, r) {
  const C = state.countries, gov = C[r.c], so = state.society, P = state.prov, T = rules.balance.war.truceDays;
  let k = r.tag ? tagIndex(state, r.tag) : -1;
  let ps = r.held.slice();
  let nc = null;
  if (k >= 0 && !C[k].alive) {
    // the released nation also takes its other restless provinces
    for (const p of state.releases?.[r.tag] || []) if (P.owner[p] === r.c && P.controller[p] === r.c && so.unrest[p] >= 40 && !ps.includes(p)) ps.push(p);
    nc = C[k];
  } else if (k >= 0 && C[k].alive && k !== r.c) {
    nc = C[k];
  } else {
    let n = 1;
    while (C.some((c) => c.tag === `SEP${n}`)) n++;
    const y = civilFromDays(state.day).y;
    nc = addCountry(state, map, rules, {
      tag: `SEP${n}`, name: `Free ${map.name[ps[0]]}`, gov: y >= 1776 ? 'republic' : 'abs_monarchy', from: r.c,
      color: shade(gov.color || '#888888'), flag: { pattern: 'v', colors: [shade(gov.color || '#888888'), '#f0f0f0', '#303030'] },
    });
    k = nc.idx;
  }
  const wasAlive = nc.alive && k < C.length && map.ids.some((i) => P.owner[i] === k);
  for (const p of ps) { transferProvince(state, map, p, k); so.since[p] = state.day; so.last[p] = k; }
  nc.alive = true;
  nc.truces = nc.truces || {};
  nc.truces[r.c] = state.day + T; gov.truces[k] = state.day + T;
  if (!nc.soc) nc.soc = newSoc(rules.society.list[so.rel[ps[0]]]?.id || gov.soc.rel);
  if (!wasAlive) {
    nc.capital = pickCapital(state, map, k);
    if (nc.econ) nc.econ.embargo = [];
    for (const p of ps) so.core[p] = k;
  }
  endRevolt(state, map, r);
  touchRelations(state);
  refreshCountryCache(state, map, rules);
  if (state.econ) computeLedgers(state, map, rules);
  if (!wasAlive) {
    nc.treasury = Math.max(nc.treasury, (nc.ledger?.revenue || 0) * 2);
    nc.manpower = (nc.cache?.maxManpower || 0) * 0.5;
    const n = Math.max(1, Math.round(r.units * r.str));
    if (nc.capital >= 0 && r.type) { const a = newArmy(state, k, nc.capital, { [r.type]: n }); state.armies.push(a); }
  }
  gov.stability = Math.max(0, gov.stability - 5);
  log(state, 'war', wasAlive ? `${ps.length} province(s) of ${gov.name} broke away and joined ${nc.name}.` : `${nc.name} has declared independence from ${gov.name} with ${ps.length} province(s).`,
    { important: true, country: r.c, prov: ps[0] });
  return nc;
}

function shade(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return '#' + v.map((x, i) => Math.max(0, Math.min(255, Math.round(x * 0.7 + [60, 30, 10][i]))).toString(16).padStart(2, '0')).join('');
}

export function newSoc(rel) {
  return { rel, relDay: -1e9, warEx: 0, unrest: 0, misShare: 0, age: null, gold: 0, dark: 0, recover: 0, pEma: null, lastGolden: -1e9, lastDark: -1e9, parts: null };
}

// --- the player's (and the AI's) crackdown

export function suppressCost(state, rules, k) {
  const V = rules.society.V, c = state.countries[k];
  return Math.max(V.suppressMin, V.suppressCost * Math.max(0, c.ledger?.taxRevenue || 0));
}

export function canSuppress(state, rules, k, p) {
  const so = state.society;
  if (!so || !rules.society) return 'Unrest is not part of this game';
  if (state.prov.owner[p] !== k || state.prov.controller[p] !== k) return 'You must own and control the province';
  if (so.supp[p] > 10) return 'A crackdown is already in force here';
  if (so.unrest[p] < 5) return 'There is no unrest to suppress';
  if (state.countries[k].treasury < suppressCost(state, rules, k)) return 'Not enough money';
  return null;
}

export function suppress(state, rules, k, p) {
  const why = canSuppress(state, rules, k, p);
  if (why) return why;
  const V = rules.society.V, so = state.society, c = state.countries[k];
  c.treasury -= suppressCost(state, rules, k);
  so.unrest[p] = Math.max(0, so.unrest[p] - V.suppressUnrest);
  so.supp[p] = V.suppressDuration;
  if (c.govt) c.govt.legitimacy = Math.max(0, c.govt.legitimacy - V.suppressLegitimacy);
  return null;
}

// --- AI

// Sends enough idle armies to each revolt in the country (marking them so the war AI leaves them
// there), and orders crackdowns in the most restless provinces it can afford.
export function aiRevolts(state, map, rules, c) {
  const V = rules.society.V, so = state.society;
  const mine = so.revolts.filter((r) => r.c === c.idx);
  for (const r of mine) {
    const need = revoltPower(state, rules, r, map) * V.aiArmyMargin;
    let have = 0;
    for (const a of state.armies) if (a.owner === c.idx && a.quell === r.id) have += armyPower(a, rules);
    if (have >= need) continue;
    const war = isAtWar(state, c.idx);
    const cands = state.armies.filter((a) => a.owner === c.idx && !a.battle && !(a.sea >= 0) && !(a.quell && so.revolts.some((x) => x.id === a.quell)))
      .map((a) => [a, (map.x[a.loc] - map.x[r.p]) ** 2 + (map.y[a.loc] - map.y[r.p]) ** 2]).sort((x, y) => x[1] - y[1]);
    let sent = 0;
    for (const [a, d2] of cands) {
      if (have >= need) break;
      // at war only nearby armies are spared, unless the rebels already hold land
      if (war && !r.held.length && d2 > 400) continue;
      if (orderMove(state, map, rules, a.id, r.p)) continue;
      a.quell = r.id; have += armyPower(a, rules); sent++;
    }
    if (sent) aiLog(state, c.idx, `Sent ${sent} army(ies) against the ${r.name.charAt(0).toLowerCase() + r.name.slice(1)}.`);
  }
  if (!c.ledger || c.ledger.net <= 0 || c.treasury <= 0) return;
  let n = 0;
  const cand = map.ids.filter((i) => state.prov.owner[i] === c.idx && so.unrest[i] >= V.aiSuppressUnrest).sort((a, b) => so.unrest[b] - so.unrest[a]);
  for (const i of cand) {
    if (n >= 2) break;
    if (!suppress(state, rules, c.idx, i)) n++;
  }
  if (n) aiLog(state, c.idx, `Cracked down on unrest in ${n} province(s).`);
}

// AI tolerance: a country whose minorities are restless (or rising) under the state religion
// policy turns tolerant; a tolerant one with almost no minorities and a strong clergy may make
// the faith official again for the unity it brings.
export function aiTolerance(state, rules, c, setPolicy) {
  const S = rules.society, g = c.govt;
  if (!g || (c.idx + civilFromDays(state.day).m) % 6) return;
  if (state.day - g.policyDay < rules.balance.government.policyCooldownDays) return;
  const pol = g.policies.religion, mis = c.soc.misShare || 0;
  const faithRevolt = state.society.revolts.some((r) => r.c === c.idx && r.kind === 'faith');
  let to = null, why = '';
  if (pol === 'state' && (faithRevolt || mis > 0.1) && c.gov !== 'theocracy') { to = 'tolerant'; why = faithRevolt ? 'a religious revolt' : `${Math.round(mis * 100)}% of the people follow other faiths`; }
  else if (pol === 'tolerant' && mis < 0.05 && (g.support.clergy || 0) > 0.12 && relFamily(S, stateRelIdx(S, c)) !== 'secular') { to = 'state'; why = 'nearly everyone shares the state religion'; }
  if (!to || !rules.politics.policies.religion?.options[to]) return;
  if (!setPolicy(state, rules, c.idx, 'religion', to)) {
    c.soc.relPolicyDay = state.day;
    aiLog(state, c.idx, `Adopted ${rules.politics.policies.religion.options[to].name.toLowerCase()}: ${why}.`);
  }
}

export { NO_REL };
