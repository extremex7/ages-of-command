// Logistics (Milestone 6): every army has a supply level between 0 and 1. Supply flows from the
// country's home network (its own and its allies' controlled land, its supply depots, and its
// ports while the sea lanes are open) outward through controlled territory, fading with each
// step and faster where infrastructure (roads and rail) is poor. Too many troops in one
// province exceed what it can feed. Low supply cuts combat strength and organisation recovery
// and causes attrition. Constants: the `supply` section of balance.json; docs/LOGISTICS.md.
import { friendly, atWar, canEnter, isAtWar } from './relations.js';
import { portZonesOf } from './mapdata.js';
import { hostileSea, laneOpen, zoneBalance } from './naval.js';
import { unitCount, log, aiLog } from './state.js';

const mapCache = new WeakMap();

// Supply quality of a province on the country's own network.
export function homeSupply(rules, infra) {
  const S = rules.balance.supply;
  return Math.min(1, S.homeBase + S.homePerInfra * infra);
}

// Supply level by province for country k (Float32Array; 0 where unreachable), rebuilt every few
// days or when borders or relations change.
export function supplyMap(state, map, rules, k) {
  const S = rules.balance.supply;
  let cache = mapCache.get(state);
  const key = `${Math.floor(state.day / S.refreshDays)}:${state.mapVersion || 0}:${state.relVersion || 0}:${state.fleetVer || 0}`;
  if (!cache || cache.key !== key) { cache = { key, by: new Map() }; mapCache.set(state, cache); }
  let m = cache.by.get(k);
  if (m) return m;
  const N = map.count, P = state.prov;
  m = new Float32Array(N);
  // sources: own and allied home land, depots, open ports
  const queue = [];
  const push = (i, v) => { if (v > m[i] + 1e-6) { m[i] = v; queue.push(i); } };
  for (const i of map.ids) {
    const ctl = P.controller[i];
    if (ctl < 0 || !friendly(state, k, ctl) || P.owner[i] !== ctl) continue;
    if (ctl !== k && atWar(state, k, ctl)) continue;
    push(i, homeSupply(rules, P.infra[i]) * (ctl === k ? 1 : S.alliedSource));
  }
  for (const d of state.countries[k].depots || []) if (P.controller[d] === k) push(d, Math.max(m[d], S.depot));
  // sea supply: a coast on open water is reachable from home ports
  const hasPort = state.countries[k].cache?.ports > 0;
  if (hasPort && map.sea.Z) {
    for (const i of map.ids) {
      if (m[i] >= S.sea) continue;
      const ctl = P.controller[i];
      if (ctl < 0 || (!friendly(state, k, ctl) && !atWar(state, k, ctl))) continue;
      const zs = portZonesOf(map, i);
      if (!zs.length) continue;
      let best = 0;
      for (const z of zs) {
        if (hostileSea(state, map, rules, k, z)) continue;
        const b = zoneBalance(state, map, rules, k, z);
        best = Math.max(best, S.sea + (b.own > 0 ? S.seaEscorted : 0));
      }
      if (best > 0) push(i, best * (atWar(state, k, ctl) ? S.enemyStep : 1));
    }
  }
  // spread: through friendly-controlled or neutral (with access) land, one step into enemy land
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    const vu = m[u];
    if (vu < S.floor) continue;
    if (atWar(state, k, P.controller[u])) continue; // supply does not pass through enemy-held land
    for (let e = map.adjStart[u]; e < map.adjStart[u + 1]; e++) {
      const v = map.adj[e];
      if (map.adjKind[e] > 0 && !laneOpen(state, map, rules, k, e)) continue;
      const ctl = P.controller[v];
      const enemy = atWar(state, k, ctl);
      if (!enemy && ctl >= 0 && !friendly(state, k, ctl) && !canEnter(state, k, v)) continue;
      const step = (S.stepBase + S.stepPerInfra * P.infra[v]) * (map.adjKind[e] > 0 ? S.waterStep : 1) * (enemy ? S.enemyStep : 1);
      push(v, vu * step);
    }
  }
  cache.by.set(k, m);
  return m;
}

// Supply of one army: its province's level, cut by overcrowding. byLoc (optional): armies by
// province, so the daily pass does not rescan every army for each one.
export function armySupply(state, map, rules, a, byLoc = null) {
  if (a.sea >= 0) return 1;
  const S = rules.balance.supply;
  const P = state.prov;
  let lvl;
  const ctl = P.controller[a.loc];
  if (ctl === a.owner && P.owner[a.loc] === a.owner && !isAtWar(state, a.owner)) lvl = homeSupply(rules, P.infra[a.loc]);
  else lvl = supplyMap(state, map, rules, a.owner)[a.loc];
  return Math.max(S.minimum, lvl * crowding(state, rules, a, byLoc ? byLoc.get(a.loc) : state.armies));
}

export function provinceCapacity(state, rules, p) {
  const S = rules.balance.supply;
  return S.stackBase + S.stackPerInfra * state.prov.infra[p] + state.prov.dev[p] * S.stackPerDev;
}

function crowding(state, rules, a, list) {
  let units = 0;
  for (const b of list) if (b.loc === a.loc && !(b.sea >= 0) && friendly(state, b.owner, a.owner)) units += unitCount(b);
  const cap = provinceCapacity(state, rules, a.loc);
  return units > cap ? cap / units : 1;
}

// Daily: every army's supply level, attrition where it is low.
export function dailySupply(state, map, rules) {
  const S = rules.balance.supply;
  const byLoc = new Map();
  for (const a of state.armies) {
    if (a.sea >= 0) continue;
    let l = byLoc.get(a.loc);
    if (!l) byLoc.set(a.loc, (l = []));
    l.push(a);
  }
  for (const a of state.armies) {
    const s = armySupply(state, map, rules, a, byLoc);
    a.supply = Math.round(s * 100) / 100;
    if (s < S.low && !a.battle) {
      const loss = S.attritionDay * (1 - s / S.low);
      a.str = Math.max(0.02, a.str - loss);
      if (a.owner === state.player && a.str < 0.5 && !a.warnedSupply) {
        a.warnedSupply = 1;
        log(state, 'military', `${a.name} is out of supply in ${map.name[a.loc]} and losing men to attrition.`, { prov: a.loc, important: true });
      }
    } else if (s >= S.low) a.warnedSupply = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// depots

export function maxDepots(state, rules, k) {
  const S = rules.balance.supply, c = state.countries[k];
  return S.depotsBase + Math.floor((c.cache?.gdp || 0) / S.depotPerGdp);
}

export function depotCost(state, rules, k) {
  return rules.balance.supply.depotCost * (state.countries[k].cache?.priceLevel || 1);
}

export function canBuildDepot(state, map, rules, k, p) {
  const c = state.countries[k];
  if (!c?.alive) return 'Country does not exist';
  if (!map.exists[p] || state.prov.controller[p] !== k) return 'You must control the province';
  const ds = c.depots || [];
  if (ds.includes(p)) return 'There is already a depot here';
  if (ds.length >= maxDepots(state, rules, k)) return `At most ${maxDepots(state, rules, k)} depots (remove one first)`;
  const cost = depotCost(state, rules, k);
  if (c.treasury < cost) return `Costs ${cost.toFixed(2)}B`;
  return null;
}

export function buildDepot(state, map, rules, k, p) {
  const why = canBuildDepot(state, map, rules, k, p);
  if (why) return why;
  const c = state.countries[k];
  c.treasury -= depotCost(state, rules, k);
  (c.depots ||= []).push(p);
  state.mapVersion = (state.mapVersion || 0) + 1;
  return null;
}

export function removeDepot(state, k, p) {
  const c = state.countries[k];
  const i = (c.depots || []).indexOf(p);
  if (i < 0) return 'No depot there';
  c.depots.splice(i, 1);
  state.mapVersion = (state.mapVersion || 0) + 1;
  return null;
}

// Monthly: depots in lost provinces are gone; the AI moves depots behind its advancing armies.
export function monthlyDepots(state, map, rules) {
  for (const c of state.countries) {
    if (!c.depots?.length) continue;
    const before = c.depots.length;
    c.depots = c.depots.filter((p) => state.prov.controller[p] === c.idx);
    if (c.depots.length < before && c.idx === state.player) log(state, 'military', 'A supply depot was lost to the enemy.');
  }
}

export function aiDepots(state, map, rules, c) {
  if (!isAtWar(state, c.idx)) { if (c.depots?.length) c.depots = []; return; }
  const S = rules.balance.supply;
  // the worst-supplied army in enemy territory: put a depot in the controlled province nearest it
  let worst = null;
  for (const a of state.armies) if (a.owner === c.idx && !(a.sea >= 0) && (a.supply ?? 1) < S.low + 0.15 && (!worst || a.supply < worst.supply)) worst = a;
  if (!worst) return;
  let best = -1, bv = -1;
  for (let e = map.adjStart[worst.loc]; e < map.adjStart[worst.loc + 1]; e++) {
    const v = map.adj[e];
    if (state.prov.controller[v] !== c.idx) continue;
    const s = state.prov.infra[v] + (state.prov.owner[v] === c.idx ? 0 : 2);
    if (s > bv) { bv = s; best = v; }
  }
  if (state.prov.controller[worst.loc] === c.idx) best = worst.loc;
  if (best < 0) return;
  if ((c.depots || []).length >= maxDepots(state, rules, c.idx)) c.depots.shift();
  if (!buildDepot(state, map, rules, c.idx, best)) aiLog(state, c.idx, `Built a supply depot in ${map.name[best]}: ${worst.name} was at ${Math.round(worst.supply * 100)}% supply.`);
}
