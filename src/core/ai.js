// Country AI. Each country thinks once every few days, staggered so the work is spread over
// ticks. Decisions are simple, goal-driven heuristics, and important ones are written to
// state.aiLog with the reason so they can be inspected in the AI debug panel.
import { aiLog, unitCount } from './state.js';
import { atWar, allied, enemiesOf, friendly, isAtWar, canEnter } from './relations.js';
import { recruit, canRecruit, orderMove, recruitCost, bestUnits, modernizeCost, modernizeArmy } from './military.js';
import { declareWar, canDeclareWar, warScore, demandCost, evaluatePeace, makePeace, provinceValue, warJoiners, termsCost,
  separateScore, evaluateSeparatePeace, makeSeparatePeace, warJustified } from './war.js';
import { opinion, treatiesBrokenByWar, overlordOf, subjectsOf, hasClaim, TREATIES } from './diplomacy.js';
import { govType } from './government.js';
import { rand } from './rng.js';
import { countryNeighbours } from './geo.js';
import { aiFleets } from './naval.js';
import { aiWings } from './air.js';
import { aiDepots } from './supply.js';
import { nuclearDeterred, hasDeterrent } from './strategic.js';
import { portZonesOf } from './mapdata.js';
import { constructionSlots, projectCost, canBuild, startProject, provinceLabour, devEff, infraEff, buildingEff, fertilityMap } from './industry.js';

export { countryNeighbours };

// Strength each side could field if a declared war on t: the target with everyone who would
// join it, against the attacker, its subjects and (at 40%) the allies it would call to arms.
export function warOdds(state, a, t) {
  const C = state.countries;
  const def = warJoiners(state, a, t);
  // land power, plus air power (it supports every battle in range)
  const pw = (k) => C[k].cache.armyPower + (C[k].cache.airPower || 0) * AIR_WEIGHT;
  let theirs = 0;
  for (const d of def) theirs += pw(d) * (d === t ? 1 : 0.6);
  let mine = pw(a);
  for (const s of subjectsOf(state, a)) if (!def.includes(s)) mine += pw(s);
  for (const tr of state.dip.treaties) {
    if (tr.type !== 'alliance' || (tr.a !== a && tr.b !== a)) continue;
    const p = tr.a === a ? tr.b : tr.a;
    if (!def.includes(p)) mine += pw(p) * 0.4;
  }
  return { mine, theirs: Math.max(1, theirs), joiners: def.slice(1) };
}

const DIFFICULTY = { easy: 0.6, normal: 1, hard: 1.3 };
const AIR_WEIGHT = 0.15;

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
  aiFleets(state, map, rules, c);
  if ((state.day + c.idx) % 28 < rules.balance.ai.thinkEveryDays) { aiWings(state, map, rules, c); aiDepots(state, map, rules, c); }
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

function pickUnitType(state, rules, c) {
  const n = state.armies.reduce((s, a) => (a.owner === c.idx ? s + unitCount(a) : s), 0);
  const roll = (n * 7 + c.idx) % 10;
  const b = bestUnits(state, rules, c.idx);
  const mobile = b.mobile && (rules.units[b.mobile].fuel ? c.cache.avgDev > 45 : true);
  if (mobile && roll < 2) return b.mobile;
  if (b.support && roll < 4) return b.support;
  return b.line || b.support || b.mobile;
}

// Spending targets by domain: coastal countries keep a navy, and countries that can fly keep an
// air force, in proportion to how industrialised they are. Picks the domain furthest below its
// share of upkeep, then a role in it.
const SEA_MIX = [['capital', 3], ['screen', 4], ['nsub', 2], ['sub', 2], ['carrier', 1]];
const AIR_MIX = [['fighter', 5], ['attack', 3], ['drone', 2], ['bomber', 1]];
// Upkeep by domain and units by role for every country, built once a day (the AI asks per country).
const forceCache = new WeakMap();
function forceTotals(state, rules) {
  let f = forceCache.get(state);
  if (f && f.day === state.day && f.n === state.armies.length + state.fleets.length * 1e4 + state.wings.length * 1e8) return f;
  const U = rules.units, C = state.countries.length;
  f = { day: state.day, n: state.armies.length + state.fleets.length * 1e4 + state.wings.length * 1e8, land: new Float64Array(C), sea: new Float64Array(C), air: new Float64Array(C), roles: { sea: state.countries.map(() => ({})), air: state.countries.map(() => ({})) } };
  for (const a of state.armies) for (const t in a.units) f.land[a.owner] += a.units[t] * U[t].upkeep;
  for (const [list, d] of [[state.fleets, 'sea'], [state.wings, 'air']]) {
    for (const x of list) {
      const r = f.roles[d][x.owner];
      for (const t in x.units) { f[d][x.owner] += x.units[t] * U[t].upkeep; r[U[t].role] = (r[U[t].role] || 0) + x.units[t]; }
    }
  }
  forceCache.set(state, f);
  return f;
}

function pickDomain(state, rules, c) {
  const F = forceTotals(state, rules);
  const up = { land: F.land[c.idx], sea: F.sea[c.idx], air: F.air[c.idx] };
  const tot = up.land + up.sea + up.air || 1;
  const dev = Math.min(1, c.cache.avgDev / 60);
  const want = { land: 1, sea: c.cache.ports > 0 ? 0.25 + 0.15 * dev + (c.cache.ports / Math.max(1, c.cache.provinces) > 0.6 ? 0.15 : 0) : 0, air: 0.3 * dev };
  const wt = want.land + want.sea + want.air;
  let best = 'land', gap = -Infinity;
  for (const d of ['land', 'sea', 'air']) {
    if (!want[d]) continue;
    const g = want[d] / wt - up[d] / tot;
    if (g > gap) { gap = g; best = d; }
  }
  if (best === 'land') return { domain: 'land', type: pickUnitType(state, rules, c) };
  const b = bestUnits(state, rules, c.idx, best);
  const mix = best === 'sea' ? SEA_MIX : AIR_MIX;
  // the role most below its weight in the current force
  const have = F.roles[best][c.idx];
  let pick = null, pv = Infinity;
  for (const [role, w] of mix) {
    if (!b[role]) continue;
    if (role === 'carrier' && c.cache.gdp < 1500) continue;
    const v = (have[role] || 0) / w;
    if (v < pv) { pv = v; pick = b[role]; }
  }
  return pick ? { domain: best, type: pick } : { domain: 'land', type: pickUnitType(state, rules, c) };
}

function manageRecruitment(state, map, rules, c) {
  const L = c.ledger;
  if (!L) return;
  const war = isAtWar(state, c.idx);
  const budget = L.taxRevenue * (1 - c.civilShare - (c.research?.share ?? 0)) + L.requisition - L.interest;
  const share = war ? 1.05 : rules.balance.ai.targetArmyShare;
  if (L.military >= budget * share) return; // no room for any new unit: skip choosing one
  const { domain, type } = pickDomain(state, rules, c);
  if (!type) return;
  const cost = recruitCost(state, rules, c.idx, type);
  const upkeep = rules.units[type].upkeep * c.cache.priceLevel;
  if (L.military + upkeep > budget * share) return;
  if (c.treasury < cost.money * (war ? 1 : 1.5)) return;
  let site = c.capital;
  if (site < 0 || state.prov.controller[site] !== c.idx || (domain === 'sea' && !portZonesOf(map, site).length)) {
    site = -1;
    for (const i of countryProvinces(state, map, c.idx)) if (state.prov.controller[i] === c.idx && (domain !== 'sea' || portZonesOf(map, i).length)) { site = i; break; }
  }
  if (site < 0) return;
  if (!canRecruit(state, map, rules, c.idx, site, type)) recruit(state, map, rules, c.idx, site, type);
  // in peacetime, re-equip one outdated army when money allows
  if (!war && (state.day + c.idx) % 28 < rules.balance.ai.thinkEveryDays) {
    for (const a of state.armies) {
      if (a.owner !== c.idx || a.battle) continue;
      const mc = modernizeCost(state, rules, a);
      if (mc.units && c.treasury > mc.money * 3 && c.manpower > mc.men * 2) {
        if (!modernizeArmy(state, rules, a.id)) aiLog(state, c.idx, `Re-equipped ${a.name} with newer units (${mc.money.toFixed(2)}B).`);
        break;
      }
    }
  }
}

// War needs a motive (low opinion, rivalry or claims on their land), favourable odds counting
// everyone who would join, and stable politics. Breaking a treaty needs a stronger motive.
function considerWar(state, map, rules, c) {
  // checked about every four weeks (every fourth AI round)
  if ((Math.floor(state.day / rules.balance.ai.thinkEveryDays) + c.idx) % 4) return;
  if (isAtWar(state, c.idx)) return;
  if (state.day - state.startDay < 60) return;
  const set = state.settings;
  const aggr = c.aggression * (set.aiAggression ?? 1) * (DIFFICULTY[set.difficulty] || 1);
  if (aggr <= 0) return;
  if (c.stability < 35) return;
  const A = rules.balance.ai, D = rules.balance.diplomacy;
  const T = govType(rules, c);
  const nb = countryNeighbours(state, map).sets[c.idx];
  const independence = overlordOf(state, c.idx);
  let best = null;
  const targets = independence >= 0 ? [independence] : nb;
  for (const t of targets) {
    if (canDeclareWar(state, map, c.idx, t)) continue;
    // motive first (cheap), then the odds counting everyone who would join
    const op = opinion(state, map, rules, c.idx, t);
    let claims = 0;
    for (const x of c.claims) if (state.prov.owner[x.p] === t) claims++;
    const motive = Math.max(0, -op) / 100 + (c.rival === t ? 0.5 : 0) + Math.min(0.6, claims * 0.1) + (t === independence ? 0.6 : 0);
    const broken = treatiesBrokenByWar(state, c.idx, t).filter((x) => x.type === 'nap' || x.type === 'guarantee');
    // the AI aggression setting lowers the grievance needed for war
    const need = (D.aiWarMotive + (broken.length ? 0.5 : 0) + (warJustified(state, c.idx, t) ? 0 : 0.1)) / Math.max(0.5, set.aiAggression ?? 1);
    if (motive < need) continue;
    const odds = warOdds(state, c.idx, t);
    const ratio = odds.mine / odds.theirs;
    if (ratio < A.powerRatioForWar / Math.min(1.5, Math.max(0.35, aggr))) continue;
    // nuclear deterrence: nobody attacks a nuclear power (or its protected allies) without one
    // of its own and an overwhelming grievance (see docs/STRATEGIC.md)
    const nuke = nuclearDeterred(state, map, rules, c.idx, [t, ...odds.joiners]);
    if (nuke >= 0 && (!hasDeterrent(state, map, rules, c.idx) || motive < need + 1 || rand(state) > 0.2)) continue;
    const s = ratio * (0.5 + motive);
    if (!best || s > best.s) best = { t, ratio, op, claims, motive, broken, odds, s };
  }
  if (!best) return;
  if (rand(state) > A.baseWarChance * aggr * T.warPropensity * (0.5 + best.motive)) return;
  const C = state.countries;
  const why = [];
  if (best.t === independence) why.push('fighting for independence');
  if (c.rival === best.t) why.push('rival');
  if (best.claims) why.push(`holds ${best.claims} of our former provinces`);
  if (best.op < 0) why.push(`opinion ${Math.round(best.op)}`);
  if (best.broken.length) why.push(`breaking our ${best.broken.map((x) => TREATIES[x.type].name.toLowerCase()).join(', ')}`);
  aiLog(state, c.idx, `Declared war on ${C[best.t].name}: ${why.join(', ')}; strength ratio ${best.ratio.toFixed(1)} counting ${best.odds.joiners.length} countries that would join them; stability ${Math.round(c.stability)}.`);
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

// Monthly peace evaluation for wars with an AI leader on at least one side. A winning leader
// demands occupied land, then reparations with the score left over, or makes a small loser its
// subject; a subject that is winning its war of independence demands it. Participants that are
// not leaders and are losing badly seek a separate peace.
export function aiPeace(state, map, rules, warScores = null) {
  for (const war of [...state.wars]) {
    const months = (state.day - war.start) / 30;
    if (months < 2) continue;
    const score = warScores?.get(war) ?? warScore(state, map, rules, war);
    for (const side of ['A', 'D']) {
      const leader = side === 'A' ? war.leaderA : war.leaderD;
      const other = side === 'A' ? war.leaderD : war.leaderA;
      if ((leader === state.player && !state.countries[leader].automate) || !state.wars.includes(war)) continue;
      const myScore = side === 'A' ? score : -score;
      const terms = peaceTerms(state, map, rules, war, side, leader, other, myScore, months);
      if (!terms) continue;
      if (other === state.player && !state.countries[other].automate) {
        if (!state.offers.some((o) => o.war === war.id && o.kind === 'peace')) {
          state.offers.push({ id: state.nextId++, kind: 'peace', war: war.id, from: leader, to: other, terms, day: state.day });
        }
        continue;
      }
      const ev = evaluatePeace(state, map, rules, war, leader, terms);
      if (ev.accept) {
        aiLog(state, leader, `Made peace with ${state.countries[other].name}: ${describeTerms(state, terms)} (war score ${Math.round(myScore)}).`);
        makePeace(state, map, rules, war, leader, terms);
      }
    }
    if (state.wars.includes(war) && months >= 3) aiSeparatePeace(state, map, rules, war);
  }
  // expire stale offers
  state.offers = state.offers.filter((o) => state.day - o.day < 30 && (o.war == null || state.wars.some((w) => w.id === o.war)));
}

export function describeTerms(state, terms) {
  const parts = [];
  if (terms.provinces?.length) parts.push(`${terms.provinces.length} province(s) ceded`);
  if (terms.reparations) parts.push('reparations');
  if (terms.subject) parts.push('becomes a subject');
  if (terms.independence) parts.push('independence');
  return parts.length ? parts.join(', ') : 'white peace';
}

function peaceTerms(state, map, rules, war, side, leader, other, myScore, months) {
  const C = state.countries, D = rules.balance.diplomacy, PC = D.peaceCost;
  if (war.kind === 'independence' && side === 'A' && myScore >= PC.independence) return { provinces: [], independence: true };
  if (myScore > 20) {
    const mySide = side === 'A' ? war.attackers : war.defenders;
    const theirSide = side === 'A' ? war.defenders : war.attackers;
    // a small, beaten enemy leader becomes a subject instead of losing land
    if (myScore >= PC.subject + 5 && C[other].cache.provinces <= D.subjectMaxProvinces && C[other].cache.gdp < C[leader].cache.gdp * 0.3
      && overlordOf(state, leader) < 0 && overlordOf(state, other) < 0 && !subjectsOf(state, other).length && war.kind !== 'independence') {
      return { provinces: [], subject: true, to: leader };
    }
    const cands = map.ids.filter((i) => theirSide.includes(state.prov.owner[i]) && mySide.includes(state.prov.controller[i]));
    // reclaim lost land first, then the most valuable provinces
    cands.sort((x, y) => (hasClaim(state, leader, y) - hasClaim(state, leader, x)) || provinceValue(state, rules, y) - provinceValue(state, rules, x));
    const take = [];
    for (const p of cands) {
      if (state.prov.controller[p] !== leader) continue;
      if (demandCost(state, map, rules, war, take.concat(p), side === 'A', leader) <= myScore) take.push(p);
    }
    const terms = { provinces: take, to: leader };
    if (termsCost(state, map, rules, war, leader, { ...terms, reparations: true }) <= myScore) terms.reparations = true;
    if (take.length || terms.reparations) return terms;
  }
  if ((months * 30 > rules.balance.war.exhaustionDays && Math.abs(myScore) < 15) || myScore < -50) return { provinces: [] };
  return null;
}

// Non-leaders that are losing ask the enemy leader for a separate peace, ceding occupied land if needed.
function aiSeparatePeace(state, map, rules, war) {
  const C = state.countries;
  for (const c of [...war.attackers, ...war.defenders]) {
    if (c === war.leaderA || c === war.leaderD || (c === state.player && !C[c].automate)) continue;
    if (!state.wars.includes(war) || !(war.attackers.includes(c) || war.defenders.includes(c))) continue;
    if (overlordOf(state, c) >= 0) continue; // subjects follow their overlord
    const sc = separateScore(state, map, rules, war, c);
    const occupied = C[c].cache.provinces ? C[c].cache.occupied / C[c].cache.provinces : 0;
    if (sc > -25 && occupied < 0.35) continue;
    const att = war.attackers.includes(c);
    const enemyLeader = att ? war.leaderD : war.leaderA;
    const enemySide = att ? war.defenders : war.attackers;
    let terms = { provinces: [] };
    let ev = evaluateSeparatePeace(state, map, rules, war, c, terms);
    if (!ev.accept) {
      const lost = map.ids.filter((i) => state.prov.owner[i] === c && enemySide.includes(state.prov.controller[i]))
        .sort((x, y) => provinceValue(state, rules, x) - provinceValue(state, rules, y));
      const give = [];
      for (const p of lost) {
        give.push(p);
        ev = evaluateSeparatePeace(state, map, rules, war, c, { provinces: give });
        if (ev.accept) break;
      }
      if (!ev.accept || give.length >= C[c].cache.provinces) continue;
      terms = { provinces: give };
    }
    if (enemyLeader === state.player && !C[enemyLeader].automate) {
      if (!state.offers.some((o) => o.kind === 'separate' && o.war === war.id && o.from === c)) {
        state.offers.push({ id: state.nextId++, kind: 'separate', war: war.id, from: c, to: enemyLeader, terms, day: state.day });
      }
      continue;
    }
    aiLog(state, c, `Made a separate peace with ${C[enemyLeader].name}: own score ${Math.round(sc)}, ${Math.round(occupied * 100)}% of our provinces occupied${terms.provinces.length ? `, ceding ${terms.provinces.length}` : ''}.`);
    makeSeparatePeace(state, map, rules, war, c, terms);
  }
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
