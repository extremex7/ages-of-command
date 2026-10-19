// Navies (Milestone 6): fleets that sail between sea zones (data/map/seas.json), docked fleets
// that repair in port, daily naval battles, sea control, blockades and commerce raiding,
// chokepoints and canals, and armies carried by sea. Constants: the `naval` section of
// balance.json; formulas: docs/NAVY_AIR.md.
//
// A fleet is { id, owner, name, zone, port, units, str, org, exp, path, prog, battle, dock }:
// `port` is the province it is docked in (-1 at sea), `path` a list of zones to sail through
// and `dock` the province to enter at the end of the path (-1 = stay at sea).
import { log, ordinal } from './state.js';
import { atWar, friendly, canEnter, warBetween } from './relations.js';
import { portZonesOf } from './mapdata.js';
import { rand, randRange } from './rng.js';
import { civilFromDays } from './calendar.js';
import { bump as recordBump } from './record.js';

export const SUB_ROLES = new Set(['sub', 'nsub', 'ssbn']);

export function isNaval(rules, type) { return rules.units[type]?.domain === 'sea'; }

export function newFleet(state, owner, zone, port, units) {
  const n = state.fleets.reduce((k, f) => k + (f.owner === owner), 0);
  return {
    id: state.nextId++, owner, name: `${ordinal(n + 1)} Fleet`, zone, port,
    units: Object.fromEntries(Object.entries(units || {}).filter(([, k]) => k > 0)),
    str: 1, org: 1, exp: 0, path: [], prog: 0, battle: 0, dock: -1,
  };
}

export function shipCount(f) {
  let n = 0;
  for (const t in f.units) n += f.units[t];
  return n;
}

// Strength of a fleet's surface force (submarines excluded: they cannot hold a sea zone).
export function fleetPower(f, rules) {
  const U = rules.units;
  let p = 0;
  for (const t in f.units) { const u = U[t]; if (!SUB_ROLES.has(u.role)) p += f.units[t] * (u.attack + u.defense + (u.air || 0) * 0.5); }
  return p * f.str * (0.4 + 0.6 * f.org);
}

function fleetStat(f, rules, key) {
  let p = 0;
  for (const t in f.units) p += f.units[t] * (rules.units[t][key] || 0);
  return p * f.str;
}

export function fleetSpeed(f, rules, state = null) {
  let s = Infinity, fuel = false;
  for (const t in f.units) if (f.units[t] > 0) { s = Math.min(s, rules.units[t].speed); if (rules.units[t].fuel) fuel = true; }
  if (s === Infinity) return 300;
  const c = state?.countries[f.owner];
  if (c?.econ && fuel) s *= 0.6 + 0.4 * c.econ.supplyFuel;
  if (c?.tfx) s *= c.tfx.mult.movement;
  return s;
}

// ---------------------------------------------------------------------------------------------
// sea presence and control (derived each day, never saved)

const presenceCache = new WeakMap();

// Per zone: the fleets at sea there as [owner, surface power, raid power, asw]. Docked fleets do
// not count: they are in harbour.
export function seaPresence(state, map, rules) {
  let c = presenceCache.get(state);
  const ver = state.fleetVer || 0;
  if (c && c.day === state.day && c.ver === ver && c.n === state.fleets.length) return c.zones;
  const zones = Array.from({ length: map.sea.Z }, () => []);
  for (const f of state.fleets) {
    if (f.port >= 0 || f.zone < 0) continue;
    const list = zones[f.zone];
    let e = list.find((x) => x[0] === f.owner);
    if (!e) list.push((e = [f.owner, 0, 0, 0]));
    e[1] += fleetPower(f, rules);
    e[2] += fleetStat(f, rules, 'raid');
    e[3] += fleetStat(f, rules, 'asw');
  }
  presenceCache.set(state, { day: state.day, ver, n: state.fleets.length, zones });
  return zones;
}

// Surface power at sea in zone z on country k's side and on its enemies' side.
export function zoneBalance(state, map, rules, k, z) {
  let own = 0, enemy = 0, raid = 0, asw = 0;
  for (const [o, p, r, a] of seaPresence(state, map, rules)[z] || []) {
    if (friendly(state, o, k)) { own += p; asw += a; }
    else if (atWar(state, o, k)) { enemy += p; raid += r; }
  }
  return { own, enemy, raid, asw };
}

// Whether enemies of k hold zone z: more surface power at sea there than k's side.
export function hostileSea(state, map, rules, k, z) {
  if (z < 0) return false;
  const b = zoneBalance(state, map, rules, k, z);
  return b.enemy > 0 && b.enemy > b.own;
}

// The country holding zone z (largest surface force at sea, if it outguns its enemies there).
export function zoneController(state, map, rules, z) {
  const list = seaPresence(state, map, rules)[z] || [];
  if (!list.length) return -1;
  let best = list[0];
  for (const e of list) if (e[1] > best[1]) best = e;
  if (best[1] <= 0) return -1;
  return hostileSea(state, map, rules, best[0], z) ? -1 : best[0];
}

// Canals open in their year; a chokepoint is closed to anyone at war with the country
// controlling one of its provinces.
export function linkOpen(state, map, k, li) {
  const L = map.sea.links[li];
  if (L.opens != null && civilFromDays(state.day).y < L.opens) return false;
  if (L.choke) for (const p of L.choke) { const c = state.prov.controller[p]; if (c >= 0 && atWar(state, c, k)) return false; }
  return true;
}

// Whether k can carry troops across the strait or sea lane on province-graph edge e.
export function laneOpen(state, map, rules, k, e) {
  const z = map.sea.laneZone[e];
  return z < 0 || !hostileSea(state, map, rules, k, z);
}

// ---------------------------------------------------------------------------------------------
// orders

// Shortest sailing route between zones (Dijkstra over zone links; the graph is ~100 zones).
export function seaRoute(state, map, k, from, to) {
  if (from === to) return [];
  const S = map.sea, Z = S.Z;
  const d = new Float64Array(Z).fill(Infinity), prev = new Int16Array(Z).fill(-1), done = new Uint8Array(Z);
  d[from] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let z = 0; z < Z; z++) if (!done[z] && d[z] < best) { best = d[z]; u = z; }
    if (u < 0 || u === to) break;
    done[u] = 1;
    for (let e = S.start[u]; e < S.start[u + 1]; e++) {
      const v = S.adj[e];
      if (done[v] || !linkOpen(state, map, k, S.link[e])) continue;
      const nd = d[u] + S.km[e];
      if (nd < d[v]) { d[v] = nd; prev[v] = u; }
    }
  }
  if (prev[to] < 0) return null;
  const path = [];
  for (let z = to; z !== from; z = prev[z]) path.push(z);
  return path.reverse();
}

export function canDockAt(state, map, k, p) {
  return p >= 0 && map.exists[p] && portZonesOf(map, p).length > 0 && friendly(state, k, state.prov.controller[p]) && canEnter(state, k, p);
}

// Orders a fleet to a sea zone, or into a port when `prov` is given. Returns null or a reason.
export function orderFleet(state, map, rules, id, { zone = -1, prov = -1 } = {}) {
  const f = state.fleets.find((x) => x.id === id);
  if (!f) return 'No such fleet';
  if (f.battle) return 'Fleet is in battle';
  let target = zone, dock = -1;
  if (prov >= 0) {
    if (!canDockAt(state, map, f.owner, prov)) return 'Fleets can only enter friendly ports';
    if (f.port === prov) { f.path = []; f.dock = -1; return null; }
    let best = null;
    for (const z of portZonesOf(map, prov)) {
      const r = seaRoute(state, map, f.owner, f.zone, z);
      if (r && (!best || r.length < best.length)) { best = r; target = z; }
    }
    if (!best) return 'No sea route to that port';
    dock = prov;
  }
  if (target < 0 || target >= map.sea.Z) return 'Invalid sea zone';
  const route = seaRoute(state, map, f.owner, f.zone, target);
  if (!route) return 'No sea route (a canal or strait is closed)';
  f.path = route; f.prog = 0; f.dock = dock;
  if (!route.length && dock >= 0) { f.port = dock; f.dock = -1; }
  else if (!route.length && dock < 0 && f.port >= 0) { f.port = -1; }
  bump(state);
  return null;
}

function bump(state) { state.fleetVer = (state.fleetVer || 0) + 1; }

export function mergeFleets(state, ids) {
  const list = ids.map((id) => state.fleets.find((f) => f.id === id)).filter(Boolean);
  if (list.length < 2) return 'Select at least two fleets';
  const base = list[0];
  if (list.some((f) => f.zone !== base.zone || f.port !== base.port || f.owner !== base.owner || f.battle)) return 'Fleets must be together, idle and of one country';
  let n0 = shipCount(base);
  for (const f of list.slice(1)) {
    const n1 = shipCount(f);
    base.str = (base.str * n0 + f.str * n1) / (n0 + n1);
    base.org = (base.org * n0 + f.org * n1) / (n0 + n1);
    for (const t in f.units) base.units[t] = (base.units[t] || 0) + f.units[t];
    n0 += n1;
    state.fleets.splice(state.fleets.indexOf(f), 1);
  }
  base.path = []; base.prog = 0;
  bump(state);
  return null;
}

export function splitFleet(state, id) {
  const f = state.fleets.find((x) => x.id === id);
  if (!f) return 'No such fleet';
  if (f.battle) return 'Fleet is in battle';
  if (shipCount(f) < 2) return 'Fleet is too small to split';
  const half = {};
  for (const t in f.units) { half[t] = Math.floor(f.units[t] / 2); f.units[t] -= half[t]; if (!f.units[t]) delete f.units[t]; }
  if (!Object.values(half).some((v) => v > 0)) {
    const t = Object.keys(f.units).find((x) => f.units[x] > 0 && shipCount(f) > 1);
    f.units[t]--; if (!f.units[t]) delete f.units[t]; half[t] = 1;
  }
  const g = newFleet(state, f.owner, f.zone, f.port, half);
  g.str = f.str; g.org = f.org; g.exp = f.exp;
  state.fleets.push(g);
  bump(state);
  return null;
}

// A newly built ship joins the idle fleet docked in its port, or forms a new fleet there.
export function commissionShip(state, map, rules, owner, prov, type) {
  let f = state.fleets.find((x) => x.owner === owner && x.port === prov && !x.path.length && !x.battle);
  if (f) {
    const n = shipCount(f);
    f.str = (f.str * n + 1) / (n + 1);
    f.org = (f.org * n + 0.6) / (n + 1);
    f.units[type] = (f.units[type] || 0) + 1;
  } else {
    const z = portZonesOf(map, prov)[0];
    f = newFleet(state, owner, z ?? -1, prov, { [type]: 1 });
    f.org = 0.6;
    state.fleets.push(f);
  }
  bump(state);
  return f;
}

// ---------------------------------------------------------------------------------------------
// daily systems

export function processFleets(state, map, rules) {
  if (!state.fleets.length) return;
  const N = rules.balance.naval, S = map.sea;
  if (state.fleets.some((f) => !state.countries[f.owner].alive)) { state.fleets = state.fleets.filter((f) => state.countries[f.owner].alive); bump(state); }
  for (const f of state.fleets) {
    // a docked fleet whose port was lost puts to sea
    if (f.port >= 0 && !friendly(state, f.owner, state.prov.controller[f.port])) { f.port = -1; bump(state); }
    if (f.battle) continue;
    if (f.path.length) {
      if (f.port >= 0) { f.port = -1; bump(state); continue; } // a day to leave harbour
      const next = f.path[0];
      let e = -1;
      for (let k = S.start[f.zone]; k < S.start[f.zone + 1]; k++) if (S.adj[k] === next) { e = k; break; }
      if (e < 0 || !linkOpen(state, map, f.owner, S.link[e])) {
        f.path = []; f.prog = 0; f.dock = -1;
        if (f.owner === state.player) log(state, 'military', `${f.name} halted: the way to the ${S.zones[next].name} is closed.`);
        continue;
      }
      f.prog += fleetSpeed(f, rules, state) / Math.max(50, S.km[e]);
      if (f.prog >= 1) {
        f.prog = 0; f.zone = next; f.path.shift(); f.arrived = state.day; bump(state);
        if (!f.path.length && f.dock >= 0) {
          if (canDockAt(state, map, f.owner, f.dock) && portZonesOf(map, f.dock).includes(f.zone)) f.port = f.dock;
          f.dock = -1;
        }
      }
    } else if (f.dock >= 0) {
      if (canDockAt(state, map, f.owner, f.dock) && portZonesOf(map, f.dock).includes(f.zone)) { f.port = f.dock; bump(state); }
      f.dock = -1;
    }
    // repairs in port, organisation recovers (slowly at sea)
    if (f.port >= 0) { f.str = Math.min(1, f.str + N.repairDay); f.org = Math.min(1, f.org + N.orgRecoveryDay); }
    else f.org = Math.min(1, f.org + N.orgRecoveryDay * 0.4);
  }
}

function fleetById(state, id) { return state.fleets.find((f) => f.id === id); }

export function detectNavalBattles(state, map, rules) {
  if (state.fleets.length < 2) return;
  const byZone = new Map();
  for (const f of state.fleets) {
    if (f.port >= 0 || f.zone < 0) continue;
    let arr = byZone.get(f.zone);
    if (!arr) byZone.set(f.zone, (arr = []));
    arr.push(f);
  }
  for (const [z, list] of byZone) {
    if (list.length < 2) continue;
    let b = state.navalBattles.find((x) => x.zone === z);
    if (b) {
      for (const f of list) {
        if (f.battle) continue;
        const side = b.att.some((id) => { const g = fleetById(state, id); return g && friendly(state, g.owner, f.owner); }) ? 'att'
          : b.def.some((id) => { const g = fleetById(state, id); return g && friendly(state, g.owner, f.owner); }) ? 'def' : null;
        if (side && !stealthy(state, rules, f, side === 'att' ? b.def : b.att)) { b[side].push(f.id); f.battle = b.id; f.path = []; }
      }
      continue;
    }
    // defenders: whoever arrived first; attackers: fleets at war with them
    const first = list.reduce((m, f) => ((f.arrived ?? 0) < (m.arrived ?? 0) ? f : m), list[0]);
    const def = list.filter((f) => friendly(state, f.owner, first.owner));
    const att = list.filter((f) => atWar(state, f.owner, first.owner) && !def.includes(f));
    if (!att.length) continue;
    // submarine-only fleets slip away unless the other side finds them
    const attIn = att.filter((f) => !stealthy(state, rules, f, def.map((g) => g.id)));
    const defIn = def.filter((f) => !stealthy(state, rules, f, att.map((g) => g.id)));
    if (!attIn.length || !defIn.length) continue;
    const war = warBetween(state, attIn[0].owner, defIn[0].owner);
    b = { id: state.nextId++, zone: z, war: war ? war.id : 0, start: state.day, days: 0, att: attIn.map((f) => f.id), def: defIn.map((f) => f.id), sunk: [0, 0], lost: [0, 0] };
    for (const f of [...attIn, ...defIn]) { f.battle = b.id; f.path = []; f.prog = 0; }
    state.navalBattles.push(b);
    if ([...attIn, ...defIn].some((f) => f.owner === state.player)) log(state, 'battle', `Naval battle in the ${map.sea.zones[z].name} has begun.`, { zone: z });
  }
}

// A fleet made only of submarines avoids battle unless the enemy's anti-submarine forces find it
// (a daily roll against detection = asw ÷ (asw + stealth)).
function stealthy(state, rules, f, enemyIds) {
  let stealth = 0, any = false;
  for (const t in f.units) {
    const u = rules.units[t];
    if (!SUB_ROLES.has(u.role)) return false;
    stealth += f.units[t] * (u.stealth || 0) * 3; any = true;
  }
  if (!any) return false;
  let asw = 0;
  for (const id of enemyIds) { const g = fleetById(state, id); if (g) asw += fleetStat(g, rules, 'asw'); }
  return rand(state) > detection(asw, stealth);
}

function detection(asw, stealth) {
  return stealth > 0 ? Math.max(0.1, Math.min(1, asw / (asw + stealth))) : 1;
}

export function navalSide(state, rules, ids, enemyIds) {
  const U = rules.units;
  const fleets = ids.map((id) => fleetById(state, id)).filter(Boolean);
  const enemies = enemyIds.map((id) => fleetById(state, id)).filter(Boolean);
  let enemyAsw = 0, enemyAa = 0;
  for (const g of enemies) { enemyAsw += fleetStat(g, rules, 'asw'); enemyAa += fleetStat(g, rules, 'aa'); }
  let stealth = 0, air = 0;
  for (const f of fleets) for (const t in f.units) { const u = U[t]; if (SUB_ROLES.has(u.role)) stealth += f.units[t] * (u.stealth || 0) * 3; air += f.units[t] * (u.air || 0) * f.str; }
  const detect = detection(enemyAsw, stealth);
  // carrier aviation is blunted by the enemy's anti-air screen
  const airEff = air > 0 ? air / (air + enemyAa * 2) : 0;
  let fire = 0, tough = 0, ships = 0, org = 0;
  for (const f of fleets) {
    const c = state.countries[f.owner];
    const tech = c.tfx?.mult.combat ?? 1;
    const mun = c.econ ? 0.6 + 0.4 * c.econ.supplyMun : 1;
    const of = (0.35 + 0.65 * f.org) * (1 + f.exp * 0.25) * tech * mun * f.str;
    for (const t in f.units) {
      const n = f.units[t], u = U[t];
      if (!n) continue;
      const sub = SUB_ROLES.has(u.role);
      fire += n * of * (u.attack * (sub ? 1 + 0.5 * (1 - detect) : 1) + (u.air || 0) * airEff);
      tough += n * u.toughness * (sub ? detect : 1);
      ships += n; org += f.org * n;
    }
  }
  return { fleets, fire, tough: Math.max(0.5, tough), ships, org: ships ? org / ships : 0, detect };
}

export function resolveNavalBattles(state, map, rules) {
  if (!state.navalBattles.length) return;
  const N = rules.balance.naval;
  const done = [];
  for (const b of state.navalBattles) {
    b.att = b.att.filter((id) => fleetById(state, id));
    b.def = b.def.filter((id) => fleetById(state, id));
    if (!b.att.length || !b.def.length) { done.push([b, b.att.length ? 'att' : 'def']); continue; }
    const A = navalSide(state, rules, b.att, b.def), D = navalSide(state, rules, b.def, b.att);
    const aF = A.fire * randRange(state, 0.85, 1.15), dF = D.fire * randRange(state, 0.85, 1.15);
    damageSide(state, rules, D, (aF * N.damage) / D.tough, (aF * N.orgDamage) / Math.max(1, D.ships), b, 1);
    damageSide(state, rules, A, (dF * N.damage) / A.tough, (dF * N.orgDamage) / Math.max(1, A.ships), b, 0);
    b.days++;
    b.lastA = { fire: A.fire, ships: A.ships, org: A.org, detect: A.detect };
    b.lastD = { fire: D.fire, ships: D.ships, org: D.org, detect: D.detect };
    const alive = (S) => S.fleets.filter((f) => state.fleets.includes(f));
    const aOrg = avgOrg(alive(A)), dOrg = avgOrg(alive(D));
    const aGone = !alive(A).length || aOrg < N.breakOrg, dGone = !alive(D).length || dOrg < N.breakOrg;
    if (aGone || dGone || b.days > 20) done.push([b, dGone && !aGone ? 'att' : aGone && !dGone ? 'def' : (aOrg >= dOrg ? 'att' : 'def')]);
  }
  for (const [b, w] of done) endNavalBattle(state, map, rules, b, w);
}

function avgOrg(fleets) {
  let o = 0, n = 0;
  for (const f of fleets) { const k = shipCount(f); o += f.org * k; n += k; }
  return n ? o / n : 0;
}

// Hull damage lowers each fleet's strength; ships sink in proportion to the damage (submarines
// only as far as they have been found).
function damageSide(state, rules, S, strLoss, orgLoss, b, idx) {
  const N = rules.balance.naval, U = rules.units;
  for (const f of S.fleets) {
    if (!state.fleets.includes(f)) continue;
    const loss = Math.min(f.str, strLoss * (0.7 + 0.3 * (1 - f.org)));
    f.str = Math.max(0, f.str - loss);
    f.org = Math.max(0, f.org - orgLoss);
    for (const t of Object.keys(f.units)) {
      const n = f.units[t], u = U[t];
      const exp = n * loss * N.sinkRate * (SUB_ROLES.has(u.role) ? S.detect : 1) / Math.max(0.5, u.toughness / 4);
      let k = Math.floor(exp);
      if (rand(state) < exp - k) k++;
      k = Math.min(n, k);
      if (!k) continue;
      f.units[t] -= k;
      if (!f.units[t]) delete f.units[t];
      b.sunk[idx] += k; b.lost[idx] += k * u.cost;
      b.men = (b.men || [0, 0]); b.men[idx] += k * u.men;
    }
    if (!shipCount(f) || f.str <= 0.02) { b.sunk[idx] += shipCount(f); state.fleets.splice(state.fleets.indexOf(f), 1); bump(state); }
  }
}

function endNavalBattle(state, map, rules, b, winner) {
  state.navalBattles.splice(state.navalBattles.indexOf(b), 1);
  const win = (winner === 'att' ? b.att : b.def).map((id) => fleetById(state, id)).filter(Boolean);
  const lose = (winner === 'att' ? b.def : b.att).map((id) => fleetById(state, id)).filter(Boolean);
  for (const f of win) { f.battle = 0; f.exp = Math.min(1, f.exp + 0.05); }
  for (const f of lose) {
    f.battle = 0;
    const home = nearestPort(state, map, f.owner, f.zone);
    if (home >= 0) orderFleet(state, map, rules, f.id, { prov: home });
    f.org = Math.min(f.org, 0.1);
  }
  const war = state.wars.find((w) => w.id === b.war);
  const wo = win[0]?.owner ?? -1;
  if (war && wo >= 0) {
    const W = rules.balance.war, sign = war.attackers.includes(wo) ? 1 : -1;
    const lost = b.lost[winner === 'att' ? 1 : 0];
    war.battleScore = Math.max(-W.maxBattleScore, Math.min(W.maxBattleScore, war.battleScore + sign * Math.min(6, 1 + lost * 1.5)));
  }
  const C = state.countries, z = map.sea.zones[b.zone];
  const report = {
    id: b.id, day: state.day, naval: true, zone: b.zone, provName: z.name, days: b.days, winner,
    attackers: [...new Set((winner === 'att' ? win : lose).map((f) => f.owner))].map((k) => C[k].name),
    defenders: [...new Set((winner === 'def' ? win : lose).map((f) => f.owner))].map((k) => C[k].name),
    casualties: b.men ? [Math.round(b.men[0]), Math.round(b.men[1])] : [0, 0], surrendered: 0, sunk: b.sunk,
    factors: [
      `Ships sunk: attackers ${b.sunk[0]}, defenders ${b.sunk[1]}.`,
      b.lastA ? `Firepower at the end: attackers ${b.lastA.fire.toFixed(1)}, defenders ${b.lastD.fire.toFixed(1)}.` : 'One side had no ships left.',
      b.lastA && (b.lastA.detect < 1 || b.lastD.detect < 1) ? `Submarines found by the enemy: attackers ${Math.round(b.lastA.detect * 100)}%, defenders ${Math.round(b.lastD.detect * 100)}%.` : '',
    ].filter(Boolean),
  };
  state.reports.push(report);
  if (state.reports.length > 60) state.reports.shift();
  const all = win.concat(lose);
  if (all.some((f) => f.owner === state.player) || report.attackers.includes(C[state.player]?.name) || report.defenders.includes(C[state.player]?.name)) {
    const won = win.some((f) => f.owner === state.player);
    recordBump(state, won ? 'battlesWon' : 'battlesLost');
    const theirs = b.sunk[won === (winner === 'att') ? 1 : 0], ours = b.sunk[won === (winner === 'att') ? 0 : 1];
    log(state, 'battle', `Naval battle in the ${z.name} ${won ? 'won' : 'lost'}: ${ours} of our ships and ${theirs} enemy ships sunk.`, { zone: b.zone, report: b.id, important: !won });
  }
}

// The friendly port nearest to zone z by sailing distance (-1 if there is none).
export function nearestPort(state, map, k, z) {
  const S = map.sea;
  const d = new Float64Array(S.Z).fill(Infinity), done = new Uint8Array(S.Z);
  d[z] = 0;
  for (let it = 0; it < S.Z; it++) {
    let u = -1, best = Infinity;
    for (let q = 0; q < S.Z; q++) if (!done[q] && d[q] < best) { best = d[q]; u = q; }
    if (u < 0) break;
    done[u] = 1;
    let pick = -1, pv = -1;
    for (const p of S.zoneProvs[u]) {
      if (!canDockAt(state, map, k, p)) continue;
      const v = (state.prov.owner[p] === k ? 2 : 1) + state.prov.dev[p] / 100;
      if (v > pv) { pv = v; pick = p; }
    }
    if (pick >= 0) return pick;
    for (let e = S.start[u]; e < S.start[u + 1]; e++) {
      const v = S.adj[e];
      if (!done[v] && linkOpen(state, map, k, S.link[e]) && d[u] + S.km[e] < d[v]) d[v] = d[u] + S.km[e];
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// monthly: blockades and commerce raiding cut each coastal country's trade

export function navalTrade(state, map, rules) {
  const N = rules.balance.naval, S = map.sea;
  if (!S.Z) return;
  const C = state.countries.length;
  const w = new Map();
  for (const i of map.ids) {
    const o = state.prov.controller[i];
    if (o < 0 || state.prov.owner[i] !== o) continue;
    const pz = portZonesOf(map, i);
    if (!pz.length) continue;
    let m = w.get(o);
    if (!m) w.set(o, (m = new Map()));
    for (const z of pz) m.set(z, (m.get(z) || 0) + 1);
  }
  for (let k = 0; k < C; k++) {
    const c = state.countries[k];
    if (!c.alive || !c.econ) continue;
    const m = w.get(k);
    let tw = 0, bl = 0, rd = 0;
    if (m) for (const [z, n] of m) {
      const b = zoneBalance(state, map, rules, k, z);
      tw += n;
      if (b.enemy > 0) bl += n * b.enemy / (b.enemy + b.own + N.coastalDefence);
      if (b.raid > 0) rd += n * b.raid / (b.raid + b.asw * 2 + N.coastalDefence);
    }
    const blockade = tw ? bl / tw : 0, raid = tw ? rd / tw : 0;
    c.econ.blockade = Math.round(blockade * 1000) / 1000;
    c.econ.raid = Math.round(raid * 1000) / 1000;
    c.econ.tradeFactor = Math.max(0.1, 1 - N.blockadeTrade * blockade - N.raidTrade * raid);
  }
}

// ---------------------------------------------------------------------------------------------
// AI: fleets hunt weaker enemy fleets, blockade enemy coasts and return to port to repair

export function aiFleets(state, map, rules, c) {
  const mine = state.fleets.filter((f) => f.owner === c.idx && !f.battle);
  if (!mine.length) return;
  const war = state.wars.some((w) => w.attackers.includes(c.idx) || w.defenders.includes(c.idx));
  const pres = seaPresence(state, map, rules);
  for (const f of mine) {
    if (f.path.length) continue;
    if (!war) {
      if (f.port < 0) { const p = nearestPort(state, map, c.idx, f.zone); if (p >= 0) orderFleet(state, map, rules, f.id, { prov: p }); }
      continue;
    }
    if (f.str < 0.5 || f.org < 0.35) {
      if (f.port < 0) { const p = nearestPort(state, map, c.idx, f.zone); if (p >= 0) orderFleet(state, map, rules, f.id, { prov: p }); }
      continue;
    }
    if (f.port >= 0 && f.str < 0.85) continue; // finish repairs
    const my = fleetPower(f, rules) + fleetStat(f, rules, 'raid');
    const subsOnly = Object.keys(f.units).every((t) => SUB_ROLES.has(rules.units[t].role));
    // nearby zones (by link steps) with enemy fleets we can beat, else enemy coasts to blockade
    let best = -1, bs = 0;
    const seen = new Set([f.zone]);
    let frontier = [f.zone];
    for (let d = 0; d <= 6 && frontier.length; d++) {
      const next = [];
      for (const z of frontier) {
        let enemy = 0, own = 0;
        for (const [o, p] of pres[z]) { if (atWar(state, o, c.idx)) enemy += p; else if (friendly(state, o, c.idx)) own += p; }
        let coast = 0;
        for (const p of map.sea.zoneProvs[z]) if (atWar(state, state.prov.controller[p], c.idx)) coast++;
        let s = 0;
        if (!subsOnly && enemy > 0 && my + own > enemy * 1.3) s = 10 + enemy;
        else if (coast && enemy < (my + own) * 0.7) s = coast * (subsOnly ? 2 : 1);
        s /= d + 1;
        if (s > bs) { bs = s; best = z; }
        for (let e = map.sea.start[z]; e < map.sea.start[z + 1]; e++) {
          const v = map.sea.adj[e];
          if (!seen.has(v) && linkOpen(state, map, c.idx, map.sea.link[e])) { seen.add(v); next.push(v); }
        }
      }
      frontier = next;
    }
    if (best >= 0 && (best !== f.zone || f.port >= 0)) orderFleet(state, map, rules, f.id, { zone: best });
  }
}
