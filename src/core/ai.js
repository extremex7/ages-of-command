// Country AI. Each country thinks once every few days, staggered so the work is spread over
// ticks. Decisions are simple, goal-driven heuristics, and important ones are written to
// state.aiLog with the reason so they can be inspected in the AI debug panel.
import { aiLog, unitCount } from './state.js';
import { atWar, allied, enemiesOf, friendly, isAtWar, canEnter } from './relations.js';
import { recruit, canRecruit, orderMove, recruitCost } from './military.js';
import { declareWar, canDeclareWar, warScore, demandCost, evaluatePeace, makePeace, provinceValue } from './war.js';
import { rand } from './rng.js';
import { constructionSlots, projectCost, canBuild, startProject, provinceLabour, devEff, infraEff, buildingEff, fertilityMap } from './industry.js';

const nbCache = new WeakMap();

// Countries sharing a land border or strait with each country, cached per map version.
export function countryNeighbours(state, map) {
  const ver = state.mapVersion || 0;
  let c = nbCache.get(state);
  if (c && c.ver === ver) return c;
  const sets = state.countries.map(() => new Set());
  const border = state.countries.map(() => []);
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) continue;
    let isBorder = false;
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      if (map.adjKind[e] === 2) continue;
      const o2 = state.prov.owner[map.adj[e]];
      if (o2 >= 0 && o2 !== o) { sets[o].add(o2); isBorder = true; }
    }
    if (isBorder) border[o].push(i);
  }
  c = { ver, sets, border };
  nbCache.set(state, c);
  return c;
}

function alliancePower(state, c) {
  let p = state.countries[c].cache.armyPower;
  for (const al of state.alliances) {
    if (!al.members.includes(c)) continue;
    for (const m of al.members) if (m !== c && state.countries[m].alive) p += state.countries[m].cache.armyPower * 0.6;
  }
  return p;
}

const DIFFICULTY = { easy: 0.6, normal: 1, hard: 1.3 };

export function aiTick(state, map, rules) {
  const every = rules.balance.ai.thinkEveryDays;
  for (const c of state.countries) {
    if (!c.alive) continue;
    if (c.idx === state.player && !c.automate) continue;
    if ((c.idx + state.day) % every !== 0) continue;
    think(state, map, rules, c);
  }
}

function think(state, map, rules, c) {
  manageBudget(state, rules, c);
  manageRecruitment(state, map, rules, c);
  if (c.idx !== state.player) considerWar(state, map, rules, c);
  planArmies(state, map, rules, c);
}

function manageBudget(state, rules, c) {
  const L = c.ledger;
  if (!L) return;
  const E = rules.balance.economy;
  if (L.net < 0 && c.treasury < L.revenue * 3) {
    if (c.tax < 0.34) c.tax = Math.min(E.maxTax, c.tax + 0.01);
    else if (c.civilShare > 0.6) c.civilShare -= 0.02;
  } else if (c.treasury > L.revenue * 14 && c.tax > 0.12) {
    c.tax -= 0.01;
  } else if (L.net > L.revenue * 0.1 && c.civilShare < 0.85 && !isAtWar(state, c.idx)) {
    c.civilShare += 0.01;
  }
}

function pickUnitType(state, c) {
  const n = state.armies.reduce((s, a) => (a.owner === c.idx ? s + unitCount(a) : s), 0);
  const roll = (n * 7 + c.idx) % 10;
  if (c.cache.avgDev > 45 && roll < 2) return 'armor';
  if (roll < 4) return 'artillery';
  return 'infantry';
}

function manageRecruitment(state, map, rules, c) {
  const L = c.ledger;
  if (!L) return;
  const war = isAtWar(state, c.idx);
  const budget = L.taxRevenue * (1 - c.civilShare) + L.requisition - L.interest;
  const type = pickUnitType(state, c);
  const cost = recruitCost(state, rules, c.idx, type);
  const upkeep = rules.units[type].upkeep * c.cache.priceLevel;
  const share = war ? 1.05 : rules.balance.ai.targetArmyShare;
  if (L.military + upkeep > budget * share) return;
  if (c.treasury < cost.money * (war ? 1 : 1.5)) return;
  let site = c.capital;
  if (site < 0 || state.prov.controller[site] !== c.idx) {
    site = -1;
    for (const i of map.ids) if (state.prov.owner[i] === c.idx && state.prov.controller[i] === c.idx) { site = i; break; }
  }
  if (site < 0) return;
  if (!canRecruit(state, map, rules, c.idx, site, type)) recruit(state, map, rules, c.idx, site, type);
}

function considerWar(state, map, rules, c) {
  if (isAtWar(state, c.idx)) return;
  if (state.day - state.startDay < 60) return;
  const set = state.settings;
  const aggr = c.aggression * (set.aiAggression ?? 1) * (DIFFICULTY[set.difficulty] || 1);
  if (aggr <= 0) return;
  if (c.stability < 35) return;
  const A = rules.balance.ai;
  const nb = countryNeighbours(state, map).sets[c.idx];
  const mine = alliancePower(state, c.idx);
  let best = null;
  for (const t of nb) {
    if (canDeclareWar(state, map, c.idx, t)) continue;
    const theirs = Math.max(1, alliancePower(state, t));
    const ratio = mine / theirs;
    if (ratio < A.powerRatioForWar / Math.min(1.5, Math.max(0.35, aggr))) continue;
    if (!best || ratio > best.ratio) best = { t, ratio };
  }
  if (!best) return;
  if (rand(state) > A.baseWarChance * aggr) return;
  const C = state.countries;
  aiLog(state, c.idx, `Declared war on ${C[best.t].name}: strength ratio ${best.ratio.toFixed(1)} incl. alliances, shared border, stability ${Math.round(c.stability)}.`);
  declareWar(state, map, rules, c.idx, best.t);
}

// Breadth-first search from `start` over enterable provinces, returning the first province
// satisfying `pred` scored by `score` (higher better) within `depth` steps.
function searchTarget(state, map, country, start, depth, pred, score) {
  const seen = new Set([start]);
  let frontier = [start], best = -1, bestS = -Infinity;
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const u of frontier) {
      for (let e = map.adjStart[u]; e < map.adjStart[u + 1]; e++) {
        const v = map.adj[e];
        if (seen.has(v)) continue;
        seen.add(v);
        if (!canEnter(state, country, v)) continue;
        if (pred(v)) {
          const s = score(v) / (d + 1);
          if (s > bestS) { bestS = s; best = v; }
        }
        next.push(v);
      }
    }
    if (best >= 0 && d >= 3) break;
    frontier = next;
  }
  return best;
}

function enemyPowerAt(state, rules, c, p) {
  let s = 0;
  for (const a of state.armies) if (a.loc === p && atWar(state, a.owner, c)) s += unitCount(a) * a.str * (0.4 + 0.6 * a.org);
  return s;
}

function planArmies(state, map, rules, c) {
  const enemies = enemiesOf(state, c.idx);
  const mine = state.armies.filter((a) => a.owner === c.idx && !a.battle);
  if (!mine.length) return;
  if (enemies.size) {
    const threatProvs = new Set();
    for (const a of state.armies) if (enemies.has(a.owner) && friendly(state, c.idx, state.prov.owner[a.loc])) threatProvs.add(a.loc);
    for (const a of mine) {
      if (a.path.length) continue;
      const myP = unitCount(a) * a.str * (0.4 + 0.6 * a.org);
      if (a.org < 0.45 || a.str < 0.4) {
        // recover in friendly territory
        if (!friendly(state, c.idx, state.prov.controller[a.loc])) {
          const back = searchTarget(state, map, c.idx, a.loc, 6, (v) => state.prov.controller[v] === c.idx && !enemyPowerAt(state, rules, c.idx, v), () => 1);
          if (back >= 0) orderMove(state, map, rules, a.id, back);
        }
        continue;
      }
      let target = -1;
      // finish a siege in progress unless an enemy army is loose in our territory
      if (state.prov.siegeBy[a.loc] === c.idx && state.prov.siege[a.loc] > 0 && !threatProvs.size) continue;
      if (threatProvs.size) {
        target = searchTarget(state, map, c.idx, a.loc, 8, (v) => threatProvs.has(v) && enemyPowerAt(state, rules, c.idx, v) < myP * 1.3, () => 10);
      }
      if (target < 0) {
        target = searchTarget(state, map, c.idx, a.loc, 10,
          (v) => enemies.has(state.prov.controller[v]) || (state.prov.owner[v] === c.idx && state.prov.controller[v] !== c.idx),
          (v) => {
            const ep = enemyPowerAt(state, rules, c.idx, v);
            if (ep > myP * 1.2) return -1;
            return provinceValue(state, rules, v) + (state.prov.owner[v] === c.idx ? 20 : 0) + (ep ? 0 : 5);
          });
      }
      if (target >= 0 && target !== a.loc) orderMove(state, map, rules, a.id, target);
    }
    return;
  }
  // peacetime: position some armies on the border facing the strongest non-allied neighbour
  if ((state.day + c.idx) % 28 >= rules.balance.ai.thinkEveryDays) return;
  const nb = countryNeighbours(state, map);
  let threat = -1, tp = 0;
  for (const t of nb.sets[c.idx]) {
    if (allied(state, c.idx, t)) continue;
    const p = state.countries[t].cache.armyPower;
    if (p > tp) { tp = p; threat = t; }
  }
  if (threat < 0) return;
  const front = nb.border[c.idx].filter((p) => {
    for (let e = map.adjStart[p]; e < map.adjStart[p + 1]; e++) if (state.prov.owner[map.adj[e]] === threat && map.adjKind[e] !== 2) return true;
    return false;
  });
  if (!front.length) return;
  mine.forEach((a, k) => {
    if (a.path.length || k % 2 === 1) return; // keep half in reserve
    if (front.includes(a.loc)) return;
    orderMove(state, map, rules, a.id, front[(k / 2) % front.length]);
  });
}

// Monthly peace evaluation for wars with an AI leader on at least one side.
export function aiPeace(state, map, rules) {
  for (const war of [...state.wars]) {
    const months = (state.day - war.start) / 30;
    if (months < 2) continue;
    const score = warScore(state, map, rules, war);
    for (const side of ['A', 'D']) {
      const leader = side === 'A' ? war.leaderA : war.leaderD;
      const other = side === 'A' ? war.leaderD : war.leaderA;
      if (leader === state.player || !state.wars.includes(war)) continue;
      const myScore = side === 'A' ? score : -score;
      let terms = null;
      if (myScore > 20) {
        const mySide = side === 'A' ? war.attackers : war.defenders;
        const theirSide = side === 'A' ? war.defenders : war.attackers;
        const cands = map.ids.filter((i) => theirSide.includes(state.prov.owner[i]) && mySide.includes(state.prov.controller[i]));
        cands.sort((x, y) => provinceValue(state, rules, y) - provinceValue(state, rules, x));
        const take = [];
        for (const p of cands) {
          if (state.prov.controller[p] !== leader) continue;
          if (demandCost(state, map, rules, war, take.concat(p), side === 'A') <= myScore) take.push(p);
        }
        if (take.length) terms = { provinces: take, to: leader };
      }
      if (!terms && (months * 30 > rules.balance.war.exhaustionDays && Math.abs(score) < 15 || myScore < -50)) terms = { provinces: [] };
      if (!terms) continue;
      if (other === state.player) {
        if (!state.offers.some((o) => o.war === war.id)) {
          state.offers.push({ id: state.nextId++, war: war.id, from: leader, to: other, terms, day: state.day });
        }
        continue;
      }
      const ev = evaluatePeace(state, map, rules, war, leader, terms);
      if (ev.accept) {
        aiLog(state, leader, `Made peace with ${state.countries[other].name}: ${terms.provinces.length ? terms.provinces.length + ' provinces ceded' : 'white peace'} (war score ${Math.round(myScore)}).`);
        makePeace(state, map, rules, war, leader, terms);
      }
    }
  }
  // expire stale offers
  state.offers = state.offers.filter((o) => state.day - o.day < 30 && state.wars.some((w) => w.id === o.war));
}

// Monthly economic AI, every other month per country: invest in what the country lacks most
// (by value of the gap between need and production), placing each building where it would be
// most efficient per unit of cost; improve infrastructure when nothing is missing.
export function aiEconomy(state, map, rules) {
  if (!state.econ) return;
  const month = Math.floor((state.day - state.startDay) / 30.44);
  for (const c of state.countries) {
    if (!c.alive || !c.econ || !c.ledger) continue;
    if (c.idx === state.player && !c.automate) continue;
    if ((c.idx + month) % 2) continue;
    aiBuild(state, map, rules, c);
  }
}

function inputAvailability(e, b) {
  let f = 1, worst = -1;
  for (const [g] of b.inp) {
    const a = e.need[g] > 0 ? Math.min(1, (e.prod[g] + e.imp[g]) / e.need[g]) : 1;
    if (a < f) { f = a; worst = g; }
  }
  return { f, worst };
}

function bestSite(state, map, rules, c, b) {
  const X = rules.econ, P = state.prov, fert = fertilityMap(map);
  const B = X.buildings[b];
  let best = -1, bestScore = 0;
  for (const i of countryProvinces(state, map, c.idx)) {
    if (P.controller[i] !== c.idx) continue;
    const L = state.econ.bld[i * X.B + b];
    if (L >= B.maxLevel) continue;
    if (B.dep >= 0 && L >= state.econ.dep[i * X.R + B.dep]) continue;
    if (B.minDev && P.dev[i] < B.minDev) continue;
    if (B.fertility && fert[i] < 0.25) continue;
    const lab = provinceLabour(state, rules, i);
    const labF = Math.min(1, lab.avail / (lab.need + B.workers));
    if (labF < 0.6) continue;
    const eff = labF * infraEff(P.infra[i], rules) * buildingEff(B, devEff(P.dev[i], rules), fert[i]);
    const score = eff / (1 + 0.04 * L);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

const provCache = new WeakMap();
function countryProvinces(state, map, k) {
  const ver = state.mapVersion || 0;
  let c = provCache.get(state);
  if (!c || c.ver !== ver) {
    c = { ver, lists: state.countries.map(() => []) };
    for (const i of map.ids) if (state.prov.owner[i] >= 0) c.lists[state.prov.owner[i]].push(i);
    provCache.set(state, c);
  }
  return c.lists[k];
}

function aiBuild(state, map, rules, c) {
  const X = rules.econ, L = c.ledger, e = c.econ, prices = state.econ.prices;
  const active = state.construction.reduce((n, p) => n + (p.owner === c.idx), 0);
  if (active >= constructionSlots(state, rules, c.idx)) return;
  const reserve = Math.max(L.revenue * 2, L.military * 4);
  if (c.treasury <= reserve || L.net < -0.05 * L.revenue) return;
  const gaps = [];
  for (const g of X.goods) {
    const gap = e.need[g.i] - e.prod[g.i];
    if (gap > 0 && X.producers[g.i].length) gaps.push({ g: g.i, value: gap * prices[g.i] });
  }
  // armies short of munitions come first: it is a military emergency, not a market signal
  if (e.supplyMun < 0.9 && 'munitions' in X.gi) for (const x of gaps) if (x.g === X.gi.munitions) x.value *= 20;
  gaps.sort((a, b) => b.value - a.value);
  let started = 0;
  for (const { g, value } of gaps.slice(0, 4)) {
    if (started >= 2) break;
    for (const b of X.producers[g]) {
      const B = X.buildings[b];
      const inp = inputAvailability(e, B);
      let bb = b, why = '';
      if (e.prod[g] > 0 && inp.f < 0.7 && inp.worst >= 0 && X.producers[inp.worst].length) {
        bb = X.producers[inp.worst][0]; // fix the bottleneck input first
        why = ` (input for ${B.name.toLowerCase()})`;
      }
      const site = bestSite(state, map, rules, c, bb);
      if (site < 0) continue;
      const cost = projectCost(state, map, rules, c.idx, site, 'building', bb);
      if (c.treasury - cost.total < reserve) return;
      if (canBuild(state, map, rules, c.idx, site, 'building', bb)) continue;
      startProject(state, map, rules, c.idx, site, 'building', bb);
      aiLog(state, c.idx, `Building ${X.buildings[bb].name} in ${map.name[site]}${why}: ${X.goods[g].name.toLowerCase()} shortfall worth ${value.toFixed(1)}B/month, cost ${cost.total.toFixed(1)}B.`);
      started++;
      break;
    }
  }
  if (started) return;
  // nothing missing: improve infrastructure where most industry is
  let best = -1, bv = 0;
  for (const i of countryProvinces(state, map, c.idx)) {
    if (state.prov.infra[i] >= Math.min(10, 3 + state.prov.dev[i] / 12)) continue;
    let lv = 0;
    for (let b = 0; b < X.B; b++) lv += state.econ.bld[i * X.B + b];
    if (lv > bv) { bv = lv; best = i; }
  }
  if (best >= 0 && !canBuild(state, map, rules, c.idx, best, 'infra')) {
    const cost = projectCost(state, map, rules, c.idx, best, 'infra');
    if (c.treasury - cost.total < reserve) return;
    startProject(state, map, rules, c.idx, best, 'infra');
    aiLog(state, c.idx, `Improving infrastructure in ${map.name[best]} (${bv} building levels there), cost ${cost.total.toFixed(1)}B.`);
  }
}
