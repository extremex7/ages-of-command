// Armies: recruitment, orders, daily movement, sieges/occupation, reinforcement.
import { newArmy, unitCount, log, refreshCountryCache } from './state.js';
import { canEnter, atWar, friendly } from './relations.js';
import { findPath, stepDays, edgeIndex } from './pathfind.js';
import { canUseUnit } from './technology.js';

// Slowest unit's speed, times the country's movement technology; armies with fuel-using units
// (armour) slow down when the country is short of fuel.
export function armySpeed(a, rules, state = null) {
  let s = Infinity, fuel = false;
  for (const t in a.units) if (a.units[t] > 0) { s = Math.min(s, rules.units[t].speed); if (rules.units[t].fuel) fuel = true; }
  if (s === Infinity) return 20;
  const c = state?.countries[a.owner];
  if (c?.econ && fuel) s *= 0.7 + 0.3 * c.econ.supplyFuel;
  if (c?.tfx) s *= c.tfx.mult.movement;
  return s;
}

export function armyMen(a, rules) {
  let m = 0;
  for (const t in a.units) m += a.units[t] * rules.units[t].men;
  return m * a.str;
}

// The newest unit type of each role the country can field ("newest" = latest unlocking
// technology; types without a technology are the oldest).
// cached per country until the technology version changes (the AI asks often)
const bestCache = new WeakMap();
export function bestUnits(state, rules, k) {
  let cache = bestCache.get(state);
  const ver = state.tech?.ver ?? 0;
  if (!cache || cache.ver !== ver || cache.rules !== rules) { cache = { ver, rules, by: new Map() }; bestCache.set(state, cache); }
  let v = cache.by.get(k);
  if (!v) { v = computeBestUnits(state, rules, k); cache.by.set(k, v); }
  return v;
}

function computeBestUnits(state, rules, k) {
  const best = {};
  for (const [id, u] of Object.entries(rules.units)) {
    if (!canUseUnit(state, rules, k, id)) continue;
    const t = rules.tech.unitTech[id];
    const yr = t == null ? -1e9 : rules.tech.list[t].year;
    const role = u.role || 'line';
    if (!best[role] || yr > best[role].yr) best[role] = { id, yr };
  }
  return Object.fromEntries(Object.entries(best).map(([r, v]) => [r, v.id]));
}

// Converting an army's outdated units to the newest type of the same role: pays the price
// difference (and extra men), and the retrained units lose organisation.
export function modernizeCost(state, rules, a) {
  const U = rules.units, best = bestUnits(state, rules, a.owner), c = state.countries[a.owner];
  let money = 0, men = 0, n = 0;
  const plan = [];
  for (const t in a.units) {
    const k = a.units[t], to = best[U[t].role || 'line'];
    if (!k || !to || to === t) continue;
    const ty = rules.tech.unitTech[to], tf = rules.tech.unitTech[t];
    if ((ty == null ? -1e9 : rules.tech.list[ty].year) <= (tf == null ? -1e9 : rules.tech.list[tf].year)) continue;
    money += k * Math.max(U[to].cost * 0.6, U[to].cost - U[t].cost) * c.cache.priceLevel;
    men += k * Math.max(0, U[to].men - U[t].men);
    n += k;
    plan.push([t, to, k]);
  }
  return { money, men, units: n, plan };
}

export function modernizeArmy(state, rules, id) {
  const a = state.armies.find((x) => x.id === id);
  if (!a) return 'No such army';
  if (a.battle) return 'Army is in battle';
  const c = state.countries[a.owner];
  const m = modernizeCost(state, rules, a);
  if (!m.units) return 'The army already has the newest equipment you can field';
  if (c.treasury < m.money) return `Costs ${m.money.toFixed(2)}B; treasury has ${c.treasury.toFixed(1)}B`;
  if (c.manpower < m.men) return `Needs ${Math.round(m.men).toLocaleString()} more men`;
  c.treasury -= m.money; c.manpower -= m.men;
  for (const [t, to, k] of m.plan) { delete a.units[t]; a.units[to] = (a.units[to] || 0) + k; }
  a.org = Math.min(a.org, 0.3);
  return null;
}

export function recruitCost(state, rules, country, type, count = 1) {
  const c = state.countries[country], u = rules.units[type];
  if (!u) return null;
  return { money: u.cost * count * c.cache.priceLevel, men: u.men * count, days: u.days };
}

// Returns null on success or a human-readable reason it is not possible.
export function canRecruit(state, map, rules, country, prov, type, count = 1) {
  const c = state.countries[country];
  if (!c || !c.alive) return 'Country does not exist';
  if (!rules.units[type]) return `Unknown unit type ${type}`;
  if (state.tech && !canUseUnit(state, rules, country, type)) return `Needs the technology ${rules.tech.list[rules.tech.unitTech[type]].name}`;
  if (!Number.isInteger(count) || count < 1 || count > 20) return 'Invalid amount';
  if (!map.exists[prov]) return 'Invalid province';
  if (state.prov.owner[prov] !== country || state.prov.controller[prov] !== country) return 'You must own and control the province';
  for (const a of state.armies) if (a.loc === prov && atWar(state, a.owner, country)) return 'Enemy troops are present';
  const cost = recruitCost(state, rules, country, type, count);
  if (c.treasury < cost.money) return `Not enough money (need ${cost.money.toFixed(1)}B)`;
  if (c.manpower < cost.men) return `Not enough manpower (need ${Math.round(cost.men).toLocaleString()})`;
  return null;
}

export function recruit(state, map, rules, country, prov, type, count = 1) {
  const why = canRecruit(state, map, rules, country, prov, type, count);
  if (why) return why;
  const c = state.countries[country];
  const cost = recruitCost(state, rules, country, type, count);
  c.treasury -= cost.money;
  c.manpower -= cost.men;
  for (let i = 0; i < count; i++) state.recruit.push({ id: state.nextId++, owner: country, prov, type, days: cost.days });
  return null;
}

export function processRecruitment(state, map, rules) {
  if (!state.recruit.length) return;
  const keep = [];
  for (const r of state.recruit) {
    if (--r.days > 0) { keep.push(r); continue; }
    if (state.prov.controller[r.prov] !== r.owner) {
      // training site lost: the unit is lost too
      if (r.owner === state.player) log(state, 'military', `Recruitment in ${map.name[r.prov]} was lost to occupation.`);
      continue;
    }
    let army = state.armies.find((a) => a.owner === r.owner && a.loc === r.prov && !a.path.length && !a.battle);
    if (army) {
      const n = unitCount(army);
      army.str = (army.str * n + 1) / (n + 1);
      army.org = (army.org * n + 0.6) / (n + 1);
      army.units[r.type] = (army.units[r.type] || 0) + 1;
    } else {
      army = newArmy(state, r.owner, r.prov, { [r.type]: 1 });
      army.org = 0.6;
      state.armies.push(army);
    }
    if (r.owner === state.player) log(state, 'military', `${rules.units[r.type].name} ready in ${map.name[r.prov]}.`, { prov: r.prov });
  }
  state.recruit = keep;
}

// Orders an army to move. Returns null or a reason.
export function orderMove(state, map, rules, armyId, dest) {
  const a = state.armies.find((x) => x.id === armyId);
  if (!a) return 'No such army';
  if (!map.exists[dest]) return 'Invalid destination';
  if (a.battle) return 'Army is in battle';
  if (dest === a.loc) { a.path = []; a.prog = 0; return null; }
  if (!canEnter(state, a.owner, dest)) return 'No military access to that province';
  const path = findPath(map, state, a.owner, a.loc, dest, armySpeed(a, rules, state));
  if (!path) return 'No route to that province';
  if (a.path.length && a.path[0] !== path[0]) a.prog = 0;
  a.path = path;
  return null;
}

export function processMovement(state, map, rules) {
  for (const a of state.armies) {
    if (!a.path.length || a.battle) continue;
    const next = a.path[0];
    if (!canEnter(state, a.owner, next)) {
      a.path = []; a.prog = 0;
      if (a.owner === state.player) log(state, 'military', `${a.name} halted: no access to ${map.name[next]}.`);
      continue;
    }
    const e = edgeIndex(map, a.loc, next);
    if (e < 0) { a.path = []; a.prog = 0; continue; }
    const need = stepDays(map, state, a.loc, e, armySpeed(a, rules, state));
    a.prog += 1 / Math.max(1, need);
    if (a.prog >= 1) {
      a.prog = 0;
      a.loc = next;
      a.arrived = state.day;
      a.path.shift();
      a.lastEdgeKind = map.adjKind[e];
    }
  }
}

export function siegeDays(state, rules, p) {
  const S = rules.balance.siege;
  return S.baseDays + state.prov.fort[p] * S.fortDays + state.prov.dev[p] * S.devDays;
}

// Occupation and liberation of provinces held by armies with no opposition present.
export function processSieges(state, map, rules) {
  const byProv = new Map();
  for (const a of state.armies) {
    if (a.battle || a.path.length && a.prog > 0) continue;
    let arr = byProv.get(a.loc);
    if (!arr) byProv.set(a.loc, (arr = []));
    arr.push(a);
  }
  const touched = new Set();
  let changed = false;
  for (const [p, armies] of byProv) {
    const ctl = state.prov.controller[p], own = state.prov.owner[p];
    // group by the side that would take control
    let besieger = -1, power = 0;
    for (const a of armies) {
      if (!atWar(state, a.owner, ctl)) continue;
      if (besieger < 0) besieger = a.owner;
      if (!friendly(state, a.owner, besieger)) continue;
      // siege engines and artillery count more ("siege" in units.json), times siege technology
      let w = 0;
      for (const t in a.units) w += a.units[t] * (rules.units[t].siege ?? 1);
      power += w * a.str * (state.countries[a.owner].tfx?.mult.siege ?? 1);
    }
    if (besieger < 0) continue;
    // hostile armies still present -> combat handles it
    if (armies.some((a) => atWar(state, a.owner, besieger))) continue;
    const newCtl = friendly(state, besieger, own) && atWar(state, besieger, ctl) ? own : besieger;
    const liberation = newCtl === own ? 2 : 1;
    if (state.prov.siegeBy[p] !== besieger) { state.prov.siegeBy[p] = besieger; state.prov.siege[p] = 0; }
    state.prov.siege[p] += (Math.sqrt(Math.max(0.25, power)) * liberation) / siegeDays(state, rules, p);
    touched.add(p);
    if (state.prov.siege[p] >= 1) {
      setController(state, map, p, newCtl);
      changed = true;
    }
  }
  // sieges decay where the besiegers left
  for (const i of map.ids) {
    if (state.prov.siege[i] > 0 && !touched.has(i)) {
      state.prov.siege[i] = Math.max(0, state.prov.siege[i] - 0.05);
      if (state.prov.siege[i] === 0) state.prov.siegeBy[i] = -1;
    }
  }
  if (changed) refreshCountryCache(state, map, rules);
}

export function setController(state, map, p, c) {
  const prev = state.prov.controller[p];
  state.prov.controller[p] = c;
  state.prov.siege[p] = 0;
  state.prov.siegeBy[p] = -1;
  state.mapVersion = (state.mapVersion || 0) + 1;
  const own = state.prov.owner[p];
  const C = state.countries;
  if (c === own) {
    if (own === state.player || prev === state.player) log(state, 'war', `${map.name[p]} liberated by ${C[c].name}.`, { prov: p });
  } else if (c === state.player || own === state.player) {
    log(state, 'war', `${C[c].name} occupied ${map.name[p]} (${C[own].name}).`, { prov: p, important: own === state.player });
  }
  if (C[own] && C[own].capital === p && c !== own) C[own].stability = Math.max(0, C[own].stability - 8);
}

export function monthlyMilitary(state, map, rules) {
  const R = rules.balance.combat;
  for (const a of state.armies) {
    if (a.battle || a.str >= 1) continue;
    const ctl = state.prov.controller[a.loc];
    if (!friendly(state, a.owner, ctl)) continue;
    const c = state.countries[a.owner];
    const men = armyMenFull(a, rules);
    const want = Math.min(R.reinforceMonth, 1 - a.str) * men;
    const got = Math.min(want, c.manpower);
    c.manpower -= got;
    a.str += got / men;
  }
}

function armyMenFull(a, rules) {
  let m = 0;
  for (const t in a.units) m += a.units[t] * rules.units[t].men;
  return Math.max(1, m);
}

export function dailyRecovery(state, rules) {
  const R = rules.balance.combat;
  for (const a of state.armies) {
    if (a.battle) continue;
    const home = friendly(state, a.owner, state.prov.controller[a.loc]);
    a.org = Math.min(1, a.org + R.orgRecoveryDay * (home ? 1 : 0.5));
  }
}

export function mergeArmies(state, ids) {
  const list = ids.map((id) => state.armies.find((a) => a.id === id)).filter(Boolean);
  if (list.length < 2) return 'Select at least two armies';
  const base = list[0];
  if (list.some((a) => a.loc !== base.loc || a.owner !== base.owner || a.battle)) return 'Armies must be together, idle and of one country';
  let n0 = unitCount(base);
  for (const a of list.slice(1)) {
    const n1 = unitCount(a);
    base.str = (base.str * n0 + a.str * n1) / (n0 + n1);
    base.org = (base.org * n0 + a.org * n1) / (n0 + n1);
    for (const t in a.units) base.units[t] = (base.units[t] || 0) + a.units[t];
    n0 += n1;
    state.armies.splice(state.armies.indexOf(a), 1);
  }
  base.path = []; base.prog = 0;
  return null;
}

export function splitArmy(state, id) {
  const a = state.armies.find((x) => x.id === id);
  if (!a) return 'No such army';
  if (a.battle) return 'Army is in battle';
  if (unitCount(a) < 2) return 'Army is too small to split';
  const half = {};
  for (const t in a.units) { half[t] = Math.floor(a.units[t] / 2); a.units[t] -= half[t]; }
  if (!unitCount({ units: half })) { for (const t in a.units) if (a.units[t] > 1 || (a.units[t] === 1 && unitCount(a) > 1)) { a.units[t]--; half[t] = 1; break; } }
  const b = newArmy(state, a.owner, a.loc, half);
  b.str = a.str; b.org = a.org;
  state.armies.push(b);
  return null;
}
