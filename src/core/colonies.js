// Colonisation of unowned land (see docs/FEATURES.md and docs/ECONOMY.md, Colonies).
//
// Unowned provinces (most of the world in Height of Rome and Rise of Empires) stay closed to
// armies (relations.canEnter). A country settles one with a colonist project instead: settlers
// leave from one of its provinces next to it, or from one of its ports within sea reach (more
// zones with better navigation technology), and after the project's time the colony is founded
// with a chance of success. A colony takes the settlers as its population and half the source's
// development. Projects live in state.colonies (created on first use, so older saves need nothing).
// The AI colonises the best land in reach when it has money to spare; the player can let it.
import { log, aiLog, refreshCountryCache } from './state.js';
import { rand } from './rng.js';
import { portZonesOf, TERRAINS } from './mapdata.js';
import { knowsId } from './technology.js';
import { isAtWar } from './relations.js';
import { provincesOf, unownedProvinces } from './geo.js';
import { fertilityMap } from './industry.js';

const DEF = {
  cost: 0.4, seaCost: 1.5, days: 270, seaDays: 1.5, settlers: 5000, sourcePop: 4, chance: 0.7, landBonus: 0.15, hopPenalty: 0.03,
  terrain: { plains: 0, hills: -0.05, mountains: -0.15, forest: -0.05, desert: -0.2, tundra: -0.2 },
  maxActive: 2, perEra: 0.25, devShare: 0.5, refund: 0.5,
  seaReach: [['sailing', 1], ['magnetic_compass', 2], ['ocean_navigation', 6], ['steamships', 12]],
  aiEveryMonths: 4, aiReserveMonths: 1,
};
export function colRules(rules) { return { ...DEF, ...(rules.balance.colonisation || {}) }; }

// How many sea zones away from one of its ports a country can found a colony (0: only a coast
// on the same sea zone).
export function seaReach(state, rules, k) {
  let r = 0;
  for (const [id, n] of colRules(rules).seaReach) if (n > r && (!state.tech || knowsId(state, rules, k, id))) r = n;
  return r;
}

export function maxColonies(state, rules, k) {
  const R = colRules(rules);
  return R.maxActive + Math.floor((state.countries[k].tfx?.era ?? 0) * R.perEra);
}

export function activeColonies(state, k) {
  let n = 0;
  for (const p of state.colonies || []) if (p.owner === k) n++;
  return n;
}

// Where settlers for province p would leave from: { from, sea, hops } or null. A province of k
// next to p (land, strait or sea lane), else the nearest port of k by sea zones within reach.
export function colonySource(state, map, rules, k, p) {
  const P = state.prov;
  let best = -1, bp = -1;
  for (let e = map.adjStart[p]; e < map.adjStart[p + 1]; e++) {
    const q = map.adj[e];
    if (P.owner[q] === k && P.controller[q] === k && P.pop[q] > bp) { bp = P.pop[q]; best = q; }
  }
  if (best >= 0) return { from: best, sea: false, hops: 0 };
  const S = map.sea, start = portZonesOf(map, p);
  if (!start.length || !S.Z) return null;
  const reach = seaReach(state, rules, k);
  const dist = new Map();
  let frontier = [...start];
  for (const z of frontier) dist.set(z, 0);
  for (let d = 0; d <= reach && frontier.length; d++) {
    // the most populous port of k on this ring of zones
    for (const z of frontier) for (const q of S.zoneProvs[z]) {
      if (P.owner[q] === k && P.controller[q] === k && P.pop[q] > bp) { bp = P.pop[q]; best = q; }
    }
    if (best >= 0) return { from: best, sea: true, hops: d };
    const next = [];
    for (const z of frontier) for (let j = S.start[z]; j < S.start[z + 1]; j++) {
      const y = S.adj[j];
      if (!dist.has(y)) { dist.set(y, d + 1); next.push(y); }
    }
    frontier = next;
  }
  return null;
}

// Everything about colonising p: { why (null if possible), from, sea, hops, cost, days, chance, settlers }.
export function colonyPlan(state, map, rules, k, p) {
  const R = colRules(rules), P = state.prov, c = state.countries[k];
  const out = { why: null, from: -1, sea: false, hops: 0, cost: 0, days: 0, chance: 0, settlers: R.settlers };
  if (!c?.alive) return { ...out, why: 'Country does not exist' };
  if (!map.exists[p]) return { ...out, why: 'Invalid province' };
  if (P.owner[p] >= 0) return { ...out, why: 'Only unowned land can be colonised' };
  if ((state.colonies || []).some((x) => x.prov === p && x.owner === k)) return { ...out, why: 'Your colonists are already on their way' };
  const src = colonySource(state, map, rules, k, p);
  const reach = seaReach(state, rules, k);
  if (!src) return { ...out, why: `No province of yours borders it and none of your ports is within ${reach} sea zone${reach === 1 ? '' : 's'}${reach < 12 ? ' (navigation technologies extend the reach)' : ''}` };
  Object.assign(out, src);
  const size = 0.5 + Math.sqrt(map.area[p]) / 300;
  out.cost = R.cost * size * (src.sea ? R.seaCost : 1) * (c.cache?.priceLevel ?? 1);
  out.days = Math.round(R.days * (src.sea ? R.seaDays : 1) * (1 + 0.05 * src.hops));
  const terr = TERRAINS[map.terrain[p]];
  out.chance = Math.max(0.2, Math.min(0.95, R.chance + (src.sea ? 0 : R.landBonus) + (R.terrain[terr] ?? 0) - R.hopPenalty * src.hops));
  if (activeColonies(state, k) >= maxColonies(state, rules, k)) return { ...out, why: `At most ${maxColonies(state, rules, k)} colonies at a time in your era` };
  if (P.pop[src.from] < R.settlers * R.sourcePop) return { ...out, why: `${map.name[src.from]} needs ${(R.settlers * R.sourcePop).toLocaleString()} people to send ${R.settlers.toLocaleString()} settlers` };
  if (c.treasury < out.cost) return { ...out, why: `Costs ${out.cost.toFixed(2)}B; treasury has ${c.treasury.toFixed(1)}B` };
  return out;
}

export function startColony(state, map, rules, k, p) {
  const plan = colonyPlan(state, map, rules, k, p);
  if (plan.why) return plan.why;
  const c = state.countries[k];
  c.treasury -= plan.cost;
  state.prov.pop[plan.from] -= plan.settlers;
  (state.colonies ||= []).push({ id: state.nextId++, owner: k, prov: p, from: plan.from, sea: plan.sea, start: state.day, end: state.day + plan.days, chance: plan.chance, settlers: plan.settlers, paid: plan.cost });
  return null;
}

export function cancelColony(state, rules, id) {
  const L = state.colonies || [], i = L.findIndex((x) => x.id === id);
  if (i < 0) return 'No such colony project';
  const p = L[i];
  state.countries[p.owner].treasury += p.paid * colRules(rules).refund;
  L.splice(i, 1);
  return null;
}

// Daily: projects that have arrived succeed or fail.
export function dailyColonies(state, map, rules) {
  const L = state.colonies;
  if (!L?.length) return;
  const R = colRules(rules), P = state.prov, C = state.countries;
  let changed = false;
  for (let i = L.length - 1; i >= 0; i--) {
    const x = L[i];
    if (state.day < x.end && C[x.owner].alive) continue;
    L.splice(i, 1);
    const c = C[x.owner], mine = x.owner === state.player;
    if (!c.alive) continue;
    if (P.owner[x.prov] >= 0) {
      c.treasury += x.paid * R.refund;
      if (mine) log(state, 'economy', `Our colonists turned back: ${map.name[x.prov]} was settled by ${C[P.owner[x.prov]].name} first. Half the cost was refunded.`, { prov: x.prov });
      continue;
    }
    if (rand(state) >= x.chance) {
      if (mine) log(state, 'economy', `The colony in ${map.name[x.prov]} failed: the settlers did not survive.`, { prov: x.prov, important: true });
      continue;
    }
    P.owner[x.prov] = x.owner; P.controller[x.prov] = x.owner;
    P.siege[x.prov] = 0; P.siegeBy[x.prov] = -1;
    P.pop[x.prov] += x.settlers;
    P.dev[x.prov] = Math.max(P.dev[x.prov], 1, (P.dev[x.from] || 1) * R.devShare);
    P.fort[x.prov] = 0;
    if (c.capital < 0) c.capital = x.prov;
    state.mapVersion = (state.mapVersion || 0) + 1;
    changed = true;
    if (mine) log(state, 'economy', `A colony was founded in ${map.name[x.prov]}.`, { prov: x.prov, important: true });
    else aiLog(state, x.owner, `Founded a colony in ${map.name[x.prov]}.`);
  }
  if (changed) refreshCountryCache(state, map, rules);
}

// Land worth settling: farmland, size, deposits, and closeness (land beats sea).
function colonyValue(state, map, rules, p, plan) {
  const X = rules.econ, ec = state.econ;
  let dep = 0;
  if (ec) for (let r = 0; r < X.R; r++) dep += ec.dep[p * X.R + r];
  return (fertilityMap(map)[p] + 0.15 * dep + Math.min(1, Math.sqrt(map.area[p]) / 400)) * plan.chance / (1 + plan.cost);
}

// Monthly AI: every few months each country with money to spare starts one colony in the best
// unowned land within reach. Skipped at once when no land is unowned (the modern scenarios).
export function aiColonies(state, map, rules) {
  const free = unownedProvinces(state, map);
  if (!free.length) return;
  const R = colRules(rules), month = Math.floor((state.day - state.startDay) / 30.44);
  for (const c of state.countries) {
    if (!c.alive || !c.ledger || !c.cache?.provinces) continue;
    if (c.idx === state.player && !c.automate && !c.autoEconomy) continue;
    if ((c.idx + month) % R.aiEveryMonths) continue;
    if (isAtWar(state, c.idx) || c.ledger.net < 0) continue;
    if (activeColonies(state, c.idx) >= maxColonies(state, rules, c.idx)) continue;
    // the dozen most promising by land alone, then the full plan (source, cost, chance) for those
    const fert = fertilityMap(map);
    const targets = reachable(state, map, rules, c.idx).map((p) => [p, fert[p] + Math.min(1, Math.sqrt(map.area[p]) / 400)])
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 12).map((x) => x[0]);
    let best = -1, bv = 0, bplan = null;
    for (const p of targets) {
      const plan = colonyPlan(state, map, rules, c.idx, p);
      if (plan.why) continue;
      if (c.treasury - plan.cost < c.ledger.revenue * R.aiReserveMonths) continue;
      if ((state.colonies || []).some((x) => x.prov === p)) continue; // someone is on the way
      const v = colonyValue(state, map, rules, p, plan);
      if (v > bv) { bv = v; best = p; bplan = plan; }
    }
    if (best < 0) continue;
    if (!startColony(state, map, rules, c.idx, best)) aiLog(state, c.idx, `Sending ${bplan.settlers.toLocaleString()} settlers from ${map.name[bplan.from]} to colonise ${map.name[best]} (${Math.round(bplan.chance * 100)}% chance, ${bplan.cost.toFixed(2)}B, ${bplan.days} days).`);
  }
}

// Unowned provinces next to k's land or on a sea zone within reach of its ports.
export function reachable(state, map, rules, k) {
  const out = new Set(), P = state.prov, S = map.sea;
  const ports = [];
  for (const i of provincesOf(state, map, k)) {
    if (P.controller[i] !== k) continue;
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) if (P.owner[map.adj[e]] < 0) out.add(map.adj[e]);
    if (S.Z && S.portStart[i + 1] > S.portStart[i]) ports.push(i);
  }
  if (!ports.length || !S.Z) return [...out];
  const reach = seaReach(state, rules, k), seen = new Set();
  let frontier = [];
  for (const i of ports) for (const z of portZonesOf(map, i)) if (!seen.has(z)) { seen.add(z); frontier.push(z); }
  for (let d = 0; d <= reach && frontier.length; d++) {
    const next = [];
    for (const z of frontier) {
      for (const q of S.zoneProvs[z]) if (P.owner[q] < 0) out.add(q);
      if (d < reach) for (let j = S.start[z]; j < S.start[z + 1]; j++) { const y = S.adj[j]; if (!seen.has(y)) { seen.add(y); next.push(y); } }
    }
    frontier = next;
  }
  return [...out];
}
