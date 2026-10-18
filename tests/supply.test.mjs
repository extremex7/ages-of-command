import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, borderPair } from './helpers.mjs';
import { declareWar } from '../src/core/war.js';
import { newArmy } from '../src/core/state.js';
import { portZonesOf } from '../src/core/mapdata.js';
import {
  armySupply, supplyMap, SUPPLY_LEVEL, dailySupply, buildDepot, removeDepot, canBuildDepot, provinceCapacity, homeSupply, monthlyDepots,
} from '../src/core/supply.js';

// Pakistan at war with India; a corridor of inland Indian provinces leading away from the border,
// by land-border steps (corridor[0] borders Pakistan).
function setup() {
  const g = game({ seed: 'supply', settings: { aiAggression: 0 } });
  const { state, map, rules } = g;
  const A = tagIdx(g, 'PAK'), D = tagIdx(g, 'IND');
  state.armies = []; state.fleets = [];
  assert.equal(declareWar(state, map, rules, A, D), null);
  const [home, first] = borderPair(g, 'PAK', 'IND');
  const prev = new Map([[first, -1]]), depth = new Map([[first, 1]]), q = [first];
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (let e = map.adjStart[u]; e < map.adjStart[u + 1]; e++) {
      const v = map.adj[e];
      if (map.adjKind[e] !== 0 || state.prov.owner[v] !== D || depth.has(v)) continue;
      depth.set(v, depth.get(u) + 1); prev.set(v, u); q.push(v);
    }
  }
  let deep = first;
  for (const [p, d] of depth) if (!portZonesOf(map, p).length && d > depth.get(deep)) deep = p;
  const corridor = [];
  for (let p = deep; p >= 0; p = prev.get(p)) corridor.unshift(p);
  return { g, state, map, rules, A, D, home, corridor };
}

const level = (s, map, rules, k, p) => SUPPLY_LEVEL[supplyMap(s, map, rules, k)[p]];

test('supply: an army deep in enemy territory is far worse supplied than at home', () => {
  const { state, map, rules, A, home, corridor } = setup();
  assert.ok(corridor.length >= 4, `corridor of ${corridor.length}`);
  const deep = corridor[corridor.length - 1];
  const a = newArmy(state, A, home, { infantry: 2 });
  const b = newArmy(state, A, deep, { infantry: 2 });
  state.armies.push(a, b);
  const sHome = armySupply(state, map, rules, a), sDeep = armySupply(state, map, rules, b);
  assert.ok(sHome > 0.7, `home ${sHome}`);
  assert.equal(sDeep, rules.balance.supply.minimum, 'cut off: supply does not pass through enemy-held land');
  // one step across the border is still reachable
  const c = newArmy(state, A, corridor[0], { infantry: 2 });
  state.armies.push(c);
  const sEdge = armySupply(state, map, rules, c);
  assert.ok(sEdge > sDeep && sEdge < sHome, `edge ${sEdge}`);
});

test('supply: it fades along an occupied corridor', () => {
  const { state, map, rules, A, corridor } = setup();
  for (const p of corridor) state.prov.controller[p] = A;
  state.supplyVer = (state.supplyVer || 0) + 1;
  const lv = corridor.map((p) => level(state, map, rules, A, p));
  // each occupied province is fed from a neighbour, so it is never better supplied than the best
  // of its neighbours, and the far end is clearly worse off than the border
  for (const p of corridor) {
    let best = 0;
    for (let e = map.adjStart[p]; e < map.adjStart[p + 1]; e++) best = Math.max(best, level(state, map, rules, A, map.adj[e]));
    if (!portZonesOf(map, p).length) assert.ok(level(state, map, rules, A, p) <= best + 1e-6, `${map.name[p]} ${level(state, map, rules, A, p)} > ${best}`);
  }
  assert.ok(lv[lv.length - 1] < lv[0] - 0.1, `lower at the far end: ${lv.map((x) => x.toFixed(2))}`);
  assert.ok(lv[0] < level(state, map, rules, A, state.countries[A].capital), 'occupied land is worse than home');
});

test('supply: attrition below the low threshold, none when supplied', () => {
  const { state, map, rules, A, home, corridor } = setup();
  const S = rules.balance.supply;
  const cut = newArmy(state, A, corridor[corridor.length - 1], { infantry: 2 });
  const ok = newArmy(state, A, home, { infantry: 2 });
  state.armies.push(cut, ok);
  for (let d = 0; d < 10; d++) { state.day++; dailySupply(state, map, rules); }
  assert.ok(cut.supply < S.low);
  const expected = 1 - 10 * S.attritionDay * (1 - S.minimum / S.low);
  assert.ok(Math.abs(cut.str - expected) < 1e-6, `str ${cut.str} vs ${expected}`);
  assert.ok(ok.supply >= S.low);
  assert.equal(ok.str, 1, 'no attrition when supplied');
  // armies in battle do not suffer attrition
  cut.battle = 99;
  const s0 = cut.str;
  state.day++; dailySupply(state, map, rules);
  assert.equal(cut.str, s0);
});

test('supply: a depot raises supply nearby', () => {
  const { state, map, rules, A, D, corridor } = setup();
  for (const p of corridor) state.prov.controller[p] = A;
  state.supplyVer = (state.supplyVer || 0) + 1;
  const far = corridor[corridor.length - 1], near = corridor[corridor.length - 2];
  const before = level(state, map, rules, A, far), beforeNear = level(state, map, rules, A, near);
  const t0 = state.countries[A].treasury;
  assert.equal(buildDepot(state, map, rules, A, far), null);
  assert.ok(state.countries[A].treasury < t0, 'depots cost money');
  const after = level(state, map, rules, A, far), afterNear = level(state, map, rules, A, near);
  assert.ok(after >= rules.balance.supply.depot - 0.01 && after > before + 0.05, `depot province ${before} -> ${after}`);
  assert.ok(afterNear >= beforeNear, 'neighbours are no worse off');
  assert.match(canBuildDepot(state, map, rules, A, far), /already/);
  assert.match(canBuildDepot(state, map, rules, A, state.countries[D].capital), /control/);
  // losing the province loses the depot
  state.prov.controller[far] = D;
  monthlyDepots(state, map, rules);
  assert.equal(state.countries[A].depots.includes(far), false);
  assert.match(removeDepot(state, A, far), /No depot/);
});

test('supply: overcrowding beyond the province capacity cuts supply', () => {
  const g = game({ seed: 'crowd', settings: { aiAggression: 0 } });
  const { state, map, rules } = g;
  const k = tagIdx(g, 'FRA');
  state.armies = [];
  const p = state.countries[k].capital;
  const cap = provinceCapacity(state, rules, p);
  const small = newArmy(state, k, p, { infantry: 2 });
  state.armies.push(small);
  const s1 = armySupply(state, map, rules, small);
  assert.ok(Math.abs(s1 - homeSupply(rules, state.prov.infra[p])) < 1e-9, 'full home supply');
  const n = Math.ceil(cap * 2);
  state.armies.push(newArmy(state, k, p, { infantry: n }));
  const s2 = armySupply(state, map, rules, small);
  assert.ok(Math.abs(s2 - s1 * cap / (n + 2)) < 1e-6, `crowded ${s2} = ${s1} x ${cap.toFixed(1)}/${n + 2}`);
  // armies at sea do not crowd the port and are always supplied
  state.armies[1].sea = portZonesOf(map, p)[0] ?? 0;
  assert.ok(Math.abs(armySupply(state, map, rules, small) - s1) < 1e-9);
  assert.equal(armySupply(state, map, rules, state.armies[1]), 1);
});
