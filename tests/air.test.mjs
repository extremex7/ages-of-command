import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, provOf } from './helpers.mjs';
import { declareWar } from '../src/core/war.js';
import { newArmy } from '../src/core/state.js';
import { detectBattles, resolveBattles } from '../src/core/combat.js';
import {
  newWing, provKm, inRange, wingRange, battleSupport, rebaseWing, setMission, strategicBombing, processWings, canBase,
} from '../src/core/air.js';

// India attacks a fortified Pakistani mountain province with 9 infantry against 6: without air
// power the defence holds (see military.test.mjs). `air`: [[side, units, mission, far]].
function mountainBattle(air = []) {
  const g = game({ seed: 'air', settings: { aiAggression: 0 } });
  const { state, map, rules } = g;
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  state.armies = []; state.wings = []; state.fleets = [];
  declareWar(state, map, rules, A, D);
  const p = map.ids.find((i) => state.prov.owner[i] === D && map.terrain[i] === 2);
  state.prov.fort[p] = 3;
  const d = newArmy(state, D, p, { infantry: 6 }), a = newArmy(state, A, p, { infantry: 9 });
  a.arrived = state.day; d.arrived = state.day - 10;
  state.armies.push(d, a);
  const byDist = map.ids.filter((i) => state.prov.owner[i] === A).sort((x, y) => provKm(map, x, p) - provKm(map, y, p));
  const wings = air.map(([side, units, mission, far]) => {
    const w = newWing(state, side === 'A' ? A : D, far ? byDist[byDist.length - 1] : byDist[0], units, mission);
    state.wings.push(w);
    return w;
  });
  let support = null;
  for (let i = 0; i < 60 && (i === 0 || state.battles.length); i++) {
    detectBattles(state, map);
    if (!support && state.battles.length) support = battleSupport(state, map, rules, state.battles[0], A, D);
    resolveBattles(state, map, rules);
  }
  return { g, p, wings, support, report: state.reports[state.reports.length - 1] };
}

test('air: close air support turns a battle the defence would otherwise hold', () => {
  const none = mountainBattle();
  assert.equal(none.report.winner, 'def');
  const cas = mountainBattle([['A', { dive_bomber: 12 }, 'support']]);
  assert.equal(cas.report.winner, 'att', 'ground-attack aircraft break the defence');
  assert.ok(cas.support.aGround > 0 && cas.support.aWings.length === 1);
  assert.ok(cas.report.casualties[1] > none.report.casualties[1], 'the defender suffers more');
  assert.equal(cas.wings[0].fought, 1, 'the wing flew over the battle');
});

test('air: enemy air superiority shields the defenders from ground attack', () => {
  const contested = mountainBattle([['A', { combat_drone: 12 }, 'support'], ['D', { stealth_fighter: 12 }, 'superiority']]);
  assert.ok(contested.support.dAir > contested.support.aAir * 3, 'the defender owns the sky');
  assert.equal(contested.report.winner, 'def');
  const none = mountainBattle();
  assert.deepEqual(contested.report.casualties, none.report.casualties, 'no ground attack gets through');
  assert.ok(contested.wings[0].str < 1, 'the support wing took losses');
});

test('air: a wing out of range gives no support', () => {
  const far = mountainBattle([['A', { attack_helicopter: 12 }, 'support', true]]);
  const w = far.wings[0];
  assert.ok(provKm(far.g.map, w.base, far.p) > wingRange(w, far.g.rules));
  assert.equal(inRange(far.g.map, far.g.rules, w, far.p), false);
  assert.equal(far.support.aWings.length, 0);
  assert.equal(far.support.aGround, 0);
  assert.equal(far.report.winner, 'def');
  const near = mountainBattle([['A', { attack_helicopter: 12 }, 'support']]);
  assert.ok(inRange(near.g.map, near.g.rules, near.wings[0], near.p));
  assert.equal(near.report.winner, 'att');
});

test('air: idle and bombing wings do not fly battle support', () => {
  const idle = mountainBattle([['A', { dive_bomber: 12 }, 'idle']]);
  assert.equal(idle.support.aWings.length, 0);
  assert.equal(idle.report.winner, 'def');
});

test('air: strategic bombing destroys enemy buildings and stability every month', () => {
  const g = game({ seed: 'bomb', settings: { aiAggression: 0 } });
  const { state, map, rules } = g;
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  state.wings = [];
  declareWar(state, map, rules, A, D);
  const target = state.countries[D].capital;
  const base = provOf(g, 'IND').sort((x, y) => provKm(map, x, target) - provKm(map, y, target))[0];
  const w = newWing(state, A, base, { jet_bomber: 12 }, 'idle');
  state.wings.push(w);
  assert.equal(setMission(state, rules, w.id, 'bombing'), null);
  const X = rules.econ;
  const levels = () => provOf(g, 'PAK').reduce((s, i) => { for (let b = 0; b < X.B; b++) s += state.econ.bld[i * X.B + b]; return s; }, 0);
  const b0 = levels(), s0 = state.countries[D].stability;
  for (let m = 0; m < 3; m++) strategicBombing(state, map, rules);
  assert.ok(levels() < b0, `buildings ${b0} -> ${levels()}`);
  assert.ok(state.countries[D].stability < s0, 'bombing hurts stability');
  assert.equal(w.str, 1, 'unopposed bombers take no losses');
  // interceptors over the target shoot bombers down
  const fighters = newWing(state, D, target, { jet_fighter: 24 }, 'superiority');
  state.wings.push(fighters);
  strategicBombing(state, map, rules);
  assert.ok(w.str < 1, 'intercepted bombers take losses');
  assert.ok(fighters.str < 1 && fighters.fought === 1, 'the interceptors fought');
  // fighters cannot bomb
  const f = newWing(state, A, base, { jet_fighter: 12 });
  state.wings.push(f);
  assert.match(setMission(state, rules, f.id, 'bombing'), /no bombers/);
  assert.match(setMission(state, rules, f.id, 'loiter'), /Unknown/);
});

test('air: bombing does nothing in peace or beyond range', () => {
  const g = game({ seed: 'bomb2', settings: { aiAggression: 0 } });
  const { state, map, rules } = g;
  state.wings = [];
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  const X = rules.econ;
  const total = () => state.econ.bld.reduce((s, v) => s + v, 0);
  const base = state.countries[A].capital;
  state.wings.push(newWing(state, A, base, { jet_bomber: 12 }, 'bombing'));
  const t0 = total();
  strategicBombing(state, map, rules);
  assert.equal(total(), t0, 'no war, no bombing');
  declareWar(state, map, rules, A, tagIdx(g, 'USA'));
  // at war with a distant power: only provinces within the bombers' range can be hit
  const before = state.econ.bld.slice();
  strategicBombing(state, map, rules);
  for (const i of map.ids) {
    let changed = false;
    for (let b = 0; b < X.B; b++) if (state.econ.bld[i * X.B + b] !== before[i * X.B + b]) changed = true;
    if (changed) assert.ok(provKm(map, base, i) <= 6000, `${map.name[i]} hit within range`);
  }
  void D;
});

test('air: wings rebase only to friendly provinces and range follows the base', () => {
  const g = game({ seed: 'rebase', settings: { aiAggression: 0 } });
  const { state, map, rules } = g;
  const A = tagIdx(g, 'FRA');
  const paris = state.countries[A].capital;
  const w = newWing(state, A, paris, { attack_helicopter: 6 }, 'support');
  state.wings.push(w);
  const berlin = state.countries[tagIdx(g, 'DEU')].capital, moscow = state.countries[tagIdx(g, 'RUS')].capital;
  assert.equal(inRange(map, rules, w, berlin), false, 'helicopters in Paris do not reach Berlin');
  assert.match(rebaseWing(state, map, rules, w.id, moscow), /allies control/);
  assert.equal(w.base, paris);
  assert.equal(rebaseWing(state, map, rules, w.id, berlin), null, 'Germany is a NATO ally');
  assert.equal(w.base, berlin);
  assert.ok(w.str < 1, 'rebasing costs a little strength');
  assert.ok(inRange(map, rules, w, berlin));
  // losing the base: the wing flies home
  const D = tagIdx(g, 'DEU');
  assert.ok(canBase(state, map, A, berlin));
  state.prov.controller[berlin] = tagIdx(g, 'RUS');
  declareWar(state, map, rules, tagIdx(g, 'RUS'), D);
  processWings(state, map, rules);
  assert.equal(w.base, paris, 'returned to the capital');
});
