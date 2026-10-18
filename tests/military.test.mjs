import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, borderPair } from './helpers.mjs';
import { recruit, orderMove, processRecruitment, recruitCost } from '../src/core/military.js';
import { findPath } from '../src/core/pathfind.js';
import { tick, runDays } from '../src/core/sim.js';
import { declareWar } from '../src/core/war.js';
import { newArmy } from '../src/core/state.js';
import { areAdjacent } from '../src/core/mapdata.js';
import { detectBattles, resolveBattles } from '../src/core/combat.js';

function quiet(opts = {}) {
  return game({ ...opts, settings: { aiAggression: 0, ...(opts.settings || {}) } });
}

test('pathfinding: valid adjacent steps; respects access rules', () => {
  const g = quiet();
  const { state, map } = g;
  const fra = tagIdx(g, 'FRA'), che = tagIdx(g, 'CHE'), deu = tagIdx(g, 'DEU');
  const paris = state.countries[fra].capital;
  assert.equal(findPath(map, state, fra, paris, state.countries[che].capital, 25), null, 'no access to neutral Switzerland');
  assert.ok(findPath(map, state, fra, paris, state.countries[deu].capital, 25), 'allies (NATO) grant access');
  const south = map.ids.filter((i) => state.prov.owner[i] === fra && map.lat[i] > 42.5 && map.lat[i] < 45 && map.lon[i] > -2 && map.lon[i] < 7.5);
  const marseille = south[0];
  assert.ok(marseille >= 0, 'found a southern French province');
  const p = findPath(map, state, fra, paris, marseille, 25);
  assert.ok(p && p.length > 0);
  let prev = paris;
  for (const s of p) { assert.ok(areAdjacent(map, prev, s)); prev = s; }
  const rus = tagIdx(g, 'RUS'), geo = tagIdx(g, 'GEO');
  assert.equal(declareWar(state, map, g.rules, rus, geo), null);
  assert.ok(findPath(map, state, rus, state.countries[rus].capital, state.countries[geo].capital, 25), 'path into enemy territory');
});

test('recruitment: costs money and manpower, unit appears after training', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const k = tagIdx(g, 'POL'), c = state.countries[k];
  const t0 = c.treasury, m0 = c.manpower;
  const cost = recruitCost(state, rules, k, 'infantry');
  const armies0 = state.armies.filter((a) => a.owner === k).reduce((s, a) => s + a.units.infantry, 0);
  assert.equal(recruit(state, map, rules, k, c.capital, 'infantry'), null);
  assert.ok(Math.abs(c.treasury - (t0 - cost.money)) < 1e-9);
  assert.equal(c.manpower, m0 - cost.men);
  for (let d = 0; d < cost.days; d++) processRecruitment(state, map, rules);
  const armies1 = state.armies.filter((a) => a.owner === k).reduce((s, a) => s + a.units.infantry, 0);
  assert.equal(armies1, armies0 + 1);
  c.treasury = 0;
  assert.match(recruit(state, map, rules, k, c.capital, 'armor'), /money/);
  assert.match(recruit(state, map, rules, k, state.countries[tagIdx(g, 'DEU')].capital, 'infantry'), /own/);
});

test('movement: an army reaches its destination over several days', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const k = tagIdx(g, 'ESP');
  const a = state.armies.find((x) => x.owner === k);
  const dest = map.ids.find((i) => state.prov.owner[i] === k && !areAdjacent(map, a.loc, i) && i !== a.loc && map.lon[i] > -4 && map.lat[i] > 41 && map.lat[i] < 43.5);
  assert.equal(orderMove(state, map, rules, a.id, dest), null);
  let days = 0;
  while (a.loc !== dest && days < 200) { tick(g); days++; }
  assert.equal(a.loc, dest);
  assert.ok(days > 2, `took ${days} days`);
});

function setupBattle(g, terrainPick, attUnits, defUnits, fort = 0) {
  const { state, map } = g;
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  state.armies = [];
  declareWar(state, map, g.rules, A, D);
  const p = map.ids.find((i) => state.prov.owner[i] === D && terrainPick(map.terrain[i]));
  state.prov.fort[p] = fort;
  const d = newArmy(state, D, p, defUnits);
  const a = newArmy(state, A, p, attUnits);
  a.arrived = state.day; d.arrived = state.day - 10;
  state.armies.push(d, a);
  return { p, a, d, A, D };
}

function fight(g) {
  for (let i = 0; i < 60 && (i === 0 || g.state.battles.length); i++) {
    detectBattles(g.state, g.map);
    resolveBattles(g.state, g.map, g.rules);
  }
  return g.state.reports[g.state.reports.length - 1];
}

test('combat: overwhelming force wins on open ground and a report explains it', () => {
  const g = quiet();
  setupBattle(g, (t) => t === 0, { infantry: 12, artillery: 4 }, { infantry: 4 });
  const r = fight(g);
  assert.equal(r.winner, 'att');
  assert.ok(r.casualties[1] > 0 && r.factors.some((f) => f.includes('Terrain')));
});

test('combat: numbers do not always win — fortified mountain defence holds', () => {
  const g = quiet();
  setupBattle(g, (t) => t === 2, { infantry: 9 }, { infantry: 6 }, 3);
  const r = fight(g);
  assert.equal(r.winner, 'def', 'combat width and terrain favour the defender');
  assert.ok(r.factors.some((f) => f.includes('Combat width')));
});

test('combat: losing armies retreat, or surrender when encircled', () => {
  const g = quiet();
  const { state } = g;
  const { a, d } = setupBattle(g, (t) => t === 0, { infantry: 14, armor: 4 }, { infantry: 3 });
  const p = d.loc;
  fight(g);
  const dd = state.armies.find((x) => x.id === d.id);
  if (dd) assert.notEqual(dd.loc, p, 'defender retreated');
  assert.ok(state.armies.includes(a));
});

test('occupation: an unopposed army besieges and takes control', () => {
  const g = quiet({ player: 'RUS' });
  const { state, map, rules } = g;
  const [own, enemy] = borderPair(g, 'RUS', 'MNG');
  const A = tagIdx(g, 'RUS'), D = tagIdx(g, 'MNG');
  state.armies = state.armies.filter((x) => x.owner !== D);
  state.countries[D].treasury = -1e6; // cannot recruit a relief force
  declareWar(state, map, rules, A, D);
  const a = newArmy(state, A, enemy, { infantry: 6 });
  state.armies.push(a);
  runDays(g, 120);
  assert.equal(state.prov.controller[enemy], A);
  assert.equal(state.prov.owner[enemy], D, 'occupation is not annexation');
  void own;
});
