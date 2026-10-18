// Game state construction and shared helpers. The state is plain data (typed arrays for
// per-province fields) so it can be saved, validated and replayed deterministically.
import { parseDate } from './calendar.js';
import { seedState } from './rng.js';
import { portZonesOf } from './mapdata.js';
import { newFleet, fleetPower } from './naval.js';
import { newWing, wingStat } from './air.js';

export const SAVE_VERSION = 6;

export function createState({ map, scenario, rules, playerTag = null, seed = 'aoc3', settings = {} }) {
  const N = map.count;
  const tags = scenario.countries.map((c) => c.tag);
  const tagIndex = new Map(tags.map((t, i) => [t, i]));
  const state = {
    version: SAVE_VERSION,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    mapProvinceCount: N,
    seed: String(seed),
    rng: seedState(seed),
    day: parseDate(scenario.startDate),
    startDay: parseDate(scenario.startDate),
    player: playerTag == null ? -1 : (tagIndex.has(playerTag) ? tagIndex.get(playerTag) : -1),
    settings: { difficulty: 'normal', aiAggression: 1, autosaveMonths: 6, autosaveKeep: 3, ...settings },
    countries: [],
    prov: {
      owner: new Int16Array(N).fill(-1),
      controller: new Int16Array(N).fill(-1),
      pop: new Float64Array(N),
      dev: new Float32Array(N),
      fort: new Uint8Array(N),
      siege: new Float32Array(N),
      siegeBy: new Int16Array(N).fill(-1),
      infra: new Uint8Array(N),
    },
    armies: [],
    battles: [],
    fleets: [],
    wings: [],
    navalBattles: [],
    wars: [],
    alliances: [],
    offers: [],
    pendingEvents: [],
    eventQueue: [],
    fired: {},
    releases: scenario.releases || {},
    dip: { treaties: [], mods: [], refused: {}, modVer: 0 },
    recruit: [],
    construction: [],
    log: [],
    reports: [],
    aiLog: [],
    nextId: 1,
    stats: { ticks: 0 },
  };
  for (const c of scenario.countries) {
    state.countries.push({
      idx: state.countries.length, tag: c.tag, name: c.name, color: c.color, gov: c.gov || 'republic',
      capital: c.capital ?? -1, treasury: c.treasury ?? 0, tax: c.tax ?? rules.balance.economy.defaultTax,
      civilShare: c.civilShare ?? rules.balance.economy.civilShare, stability: c.stability ?? 60,
      manpower: c.manpower ?? 0, aggression: c.aggression ?? 0.5, flag: c.flag || null,
      alive: true, truces: {}, ledger: null, cache: null, automate: false, startPolicies: c.policies || null,
    });
  }
  const P = scenario.provinces;
  for (const i of map.ids) {
    const rec = P[i];
    if (!rec) continue;
    const o = rec[0] == null ? -1 : tagIndex.get(rec[0]);
    if (o === undefined) throw new Error(`Scenario ${scenario.id}: province ${i} has unknown owner ${rec[0]}`);
    state.prov.owner[i] = o;
    state.prov.controller[i] = o;
    state.prov.pop[i] = rec[1] || 0;
    state.prov.dev[i] = rec[2] || 1;
    state.prov.fort[i] = rec[3] || 0;
    state.prov.infra[i] = rec[4] ?? Math.max(0, Math.min(10, Math.round((rec[2] || 1) / 11)));
  }
  for (const a of scenario.alliances || []) {
    state.alliances.push({ id: state.nextId++, name: a.name, members: a.members.map((t) => tagIndex.get(t)).filter((x) => x != null) });
  }
  for (const a of scenario.armies || []) {
    const owner = tagIndex.get(a.owner);
    if (owner == null || !map.exists[a.province]) continue;
    state.armies.push(newArmy(state, owner, a.province, a.units));
  }
  for (const c of state.countries) {
    if (c.capital < 0 || state.prov.owner[c.capital] !== c.idx) c.capital = pickCapital(state, map, c.idx);
  }
  // fleets dock in a port province (or sail in a named zone); wings sit at a base province
  for (const f of scenario.fleets || []) {
    const owner = tagIndex.get(f.owner);
    if (owner == null) continue;
    const port = f.port != null && map.exists[f.port] ? f.port : -1;
    const zone = f.zone ?? (port >= 0 ? portZonesOf(map, port)[0] : undefined);
    if (zone == null || zone < 0 || zone >= map.sea.Z) continue;
    const fl = newFleet(state, owner, zone, port, f.units);
    if (f.name) fl.name = f.name;
    state.fleets.push(fl);
  }
  for (const w of scenario.wings || []) {
    const owner = tagIndex.get(w.owner);
    if (owner == null || !map.exists[w.base]) continue;
    const wg = newWing(state, owner, w.base, w.units, w.mission);
    if (w.name) wg.name = w.name;
    state.wings.push(wg);
  }
  refreshCountryCache(state, map, rules);
  for (const c of state.countries) if (!c.manpower) c.manpower = c.cache.maxManpower * 0.6;
  return state;
}

export function newArmy(state, owner, loc, units) {
  const id = state.nextId++;
  return {
    id, owner, loc, name: `${ordinal(countArmies(state, owner) + 1)} Army`,
    units: Object.fromEntries(Object.entries(units || {}).filter(([, n]) => n > 0)),
    str: 1, org: 1, exp: 0, path: [], prog: 0, battle: 0, arrived: state.day, stance: 'hold', sea: -1,
  };
}

function countArmies(state, owner) {
  let n = 0;
  for (const a of state.armies) if (a.owner === owner) n++;
  return n;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function pickCapital(state, map, c) {
  let best = -1, bv = -1;
  for (const i of map.ids) {
    if (state.prov.owner[i] !== c) continue;
    const v = state.prov.pop[i] * (1 + state.prov.dev[i] / 50);
    if (v > bv) { bv = v; best = i; }
  }
  return best;
}

export function unitCount(a) {
  let n = 0;
  for (const t in a.units) n += a.units[t];
  return n;
}

// Per-country aggregates recomputed when ownership changes or monthly; consumers read cache
// instead of scanning all provinces.
export function refreshCountryCache(state, map, rules) {
  const E = rules.balance.economy;
  const C = state.countries.length;
  const n = new Int32Array(C), pop = new Float64Array(C), gdp = new Float64Array(C), devw = new Float64Array(C);
  const occupied = new Int32Array(C);
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) continue;
    n[o]++;
    const p = state.prov.pop[i];
    pop[o] += p;
    gdp[o] += provinceGdp(state, i, E);
    devw[o] += p * state.prov.dev[i];
    if (state.prov.controller[i] !== o) occupied[o]++;
  }
  const armyStr = new Float64Array(C), navy = new Float64Array(C), air = new Float64Array(C), ports = new Int32Array(C);
  for (const a of state.armies) armyStr[a.owner] += armyPower(a, rules);
  for (const f of state.fleets || []) navy[f.owner] += fleetPower(f, rules);
  for (const w of state.wings || []) air[w.owner] += wingStat(w, rules, 'air') + wingStat(w, rules, 'attack');
  if (map.sea) for (const i of map.ids) { const o = state.prov.owner[i]; if (o >= 0 && state.prov.controller[i] === o && map.sea.portStart[i + 1] > map.sea.portStart[i]) ports[o]++; }
  const refProd = E.devBase * Math.pow(E.devGrowth, E.refDev);
  for (const c of state.countries) {
    const k = c.idx;
    const avgDev = pop[k] > 0 ? devw[k] / pop[k] : 1;
    const prod = E.devBase * Math.pow(E.devGrowth, avgDev);
    c.cache = {
      provinces: n[k], pop: pop[k], gdp: gdp[k], avgDev, occupied: occupied[k],
      priceLevel: (0.35 + 0.65 * Math.min(1.5, prod / refProd)) * (c.econ ? Math.max(0.5, Math.min(3, c.econ.cpi)) : 1),
      // the mobilisable share depends on the era (see docs/TECHNOLOGY.md)
      maxManpower: pop[k] * (rules.tech?.eras[c.tfx?.era ?? -1]?.manpowerShare ?? rules.balance.population.manpowerShare) * (c.govt?.fx?.manpower ?? 1),
      armyPower: armyStr[k], navyPower: navy[k], airPower: air[k], ports: ports[k],
    };
    if (n[k] === 0 && c.alive) c.alive = false;
  }
}

// Annual GDP of a province in billions: services (population × productivity from
// development, calibrated per province, minus the workforce employed in industry, scaled by
// national energy/fuel supply) plus industrial value added. See docs/ECONOMY.md.
export function provinceGdp(state, i, E) {
  const base = (state.prov.pop[i] * E.devBase * Math.pow(E.devGrowth, state.prov.dev[i])) / 1e9;
  const ec = state.econ;
  if (!ec) return base;
  const o = state.prov.owner[i];
  const m = o >= 0 ? state.countries[o].econ.gdpMult : 1;
  return base * ec.sf[i] * (1 - ec.iw[i]) * m + ec.va[i] * 12;
}

// The parts of provinceGdp, for tooltips.
export function provinceGdpParts(state, i, E) {
  const base = (state.prov.pop[i] * E.devBase * Math.pow(E.devGrowth, state.prov.dev[i])) / 1e9;
  const ec = state.econ, o = state.prov.owner[i];
  const m = o >= 0 ? state.countries[o].econ.gdpMult : 1;
  return { base, factor: ec.sf[i], industryShare: ec.iw[i], supply: m, services: base * ec.sf[i] * (1 - ec.iw[i]) * m, industry: ec.va[i] * 12 };
}

export function armyPower(a, rules) {
  const U = rules.units;
  let p = 0;
  for (const t in a.units) p += a.units[t] * (U[t].attack + U[t].defense);
  return p * a.str * (0.4 + 0.6 * a.org);
}

export function log(state, type, text, extra = {}) {
  state.logSeq = (state.logSeq || 0) + 1;
  state.log.push({ seq: state.logSeq, day: state.day, type, text, ...extra });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

export function aiLog(state, country, text) {
  state.aiLog.push({ day: state.day, c: country, text });
  if (state.aiLog.length > 300) state.aiLog.splice(0, state.aiLog.length - 300);
}
