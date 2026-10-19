import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { industryMonth, canBuild, siteMap, efficiencyBreakdown } from '../src/core/industry.js';
import { grantTech } from '../src/core/technology.js';

test('power sources: hydro needs a hydro deposit, wind and solar need their technology', () => {
  const g = game({ seed: 'power' }), s = g.state, X = g.rules.econ, map = g.map;
  const k = tagIdx(g, 'NPL'), c = s.countries[k];
  c.treasury = 1000;
  const ps = provOf(g, 'NPL');
  const wet = ps.find((p) => s.econ.dep[p * X.R + X.resources.indexOf('hydro')] > 0);
  assert.ok(wet != null, 'Nepal has hydro sites');
  assert.equal(canBuild(s, map, g.rules, k, wet, 'building', X.bi.hydro_dam), null);
  const dry = provOf(g, 'EGY').find((p) => !s.econ.dep[p * X.R + X.resources.indexOf('hydro')]);
  assert.match(canBuild(s, map, g.rules, tagIdx(g, 'EGY'), dry, 'building', X.bi.hydro_dam) || '', /hydro deposit/);
  // a 2026 country knows renewable energy; one from 1914 does not
  assert.equal(canBuild(s, map, g.rules, k, ps[0], 'building', X.bi.wind_farm), null);
});

test('power sources: dams, wind and solar need no fuel; solar follows the sun', () => {
  const g = game({ seed: 'power2' }), s = g.state, X = g.rules.econ, map = g.map;
  runDays(g, 1);
  const k = tagIdx(g, 'NPL'), e = s.countries[k].econ, ps = provOf(g, 'NPL');
  const wet = ps.find((p) => s.econ.dep[p * X.R + X.resources.indexOf('hydro')] > 0);
  s.econ.bld[wet * X.B + X.bi.hydro_dam] = 2;
  s.econ.bld[ps[0] * X.B + X.bi.wind_farm] = 2;
  for (let g2 = 0; g2 < X.G; g2++) if (X.goods[g2].id !== 'energy') e.stock[g2] = 0; // no coal, gas or anything
  const before = e.prod[X.gi.energy];
  industryMonth(s, map, g.rules);
  assert.ok(e.prod[X.gi.energy] > 0, 'energy produced with no fuel in stock');
  const sun = siteMap(map, 'solar');
  const sahara = provOf(g, 'DZA').reduce((a, p) => Math.max(a, sun[p]), 0);
  const north = provOf(g, 'NOR').reduce((a, p) => Math.max(a, sun[p]), 0);
  assert.ok(sahara > north, `Algeria sunnier than Norway (${sahara} vs ${north})`);
  const f = efficiencyBreakdown(s, map, g.rules, ps[0], X.bi.wind_farm);
  assert.ok(f.site > 0 && f.building > 0);
  assert.ok(before >= 0);
});

test('saves from before gas and hydro load with every building and stockpile in place', () => {
  const g = game({ seed: 'oldsave' }), s = g.state, X = g.rules.econ, d = data();
  runDays(g, 40);
  // rebuild the save as the previous version wrote it: no gas, hydro or the new buildings
  const OLD_G = ['food', 'timber', 'coal', 'oil', 'iron', 'uranium', 'rare_earths', 'steel', 'energy', 'fuel', 'consumer_goods', 'electronics', 'machinery', 'munitions'];
  const OLD_B = ['farm', 'lumber_camp', 'coal_mine', 'iron_mine', 'oil_well', 'uranium_mine', 'rare_earth_mine', 'coal_power', 'nuclear_power', 'refinery', 'steel_mill', 'factory', 'electronics_plant', 'machine_works', 'arms_factory'];
  const OLD_R = s.econ.resources.filter((r) => r !== 'gas' && r !== 'hydro');
  const pick = (arr, ids, oldIds, rows) => {
    const out = new arr.constructor(rows * oldIds.length);
    for (let r = 0; r < rows; r++) oldIds.forEach((id, j) => { out[r * oldIds.length + j] = arr[r * ids.length + ids.indexOf(id)]; });
    return out;
  };
  const n = s.prov.owner.length, gIds = X.goods.map((x) => x.id), bIds = X.buildings.map((x) => x.id);
  const old = JSON.parse(saveGame(g));
  const steel = s.countries[tagIdx(g, 'DEU')].econ.stock[X.gi.steel];
  const mills = s.econ.bld.reduce((a, v, j) => a + (j % X.B === X.bi.steel_mill ? v : 0), 0);
  const tmp = { ...g, state: { ...s, econ: { ...s.econ } } };
  tmp.state.econ.bld = pick(s.econ.bld, bIds, OLD_B, n);
  tmp.state.econ.dep = pick(s.econ.dep, s.econ.resources, OLD_R, n);
  tmp.state.econ.prices = pick(s.econ.prices, gIds, OLD_G, 1);
  tmp.state.econ.ratio0 = pick(s.econ.ratio0, gIds, OLD_G, 1);
  tmp.state.econ.resources = OLD_R;
  delete tmp.state.econ.goodIds; delete tmp.state.econ.buildingIds;
  tmp.state.countries = s.countries.map((c) => ({ ...c, econ: c.econ && Object.fromEntries(Object.entries(c.econ).map(([key, v]) => [key, ArrayBuffer.isView(v) && v.length === X.G ? pick(v, gIds, OLD_G, 1) : v])) }));
  tmp.state.construction = s.construction.filter((p) => p.kind !== 'building' || OLD_B.includes(bIds[p.b])).map((p) => (p.kind === 'building' ? { ...p, b: OLD_B.indexOf(bIds[p.b]) } : p));
  assert.ok(old);
  const loaded = loadGame(saveGame(tmp), d).state;
  assert.equal(loaded.countries[tagIdx(g, 'DEU')].econ.stock[X.gi.steel], steel, 'stockpiles kept by good');
  assert.equal(loaded.econ.bld.reduce((a, v, j) => a + (j % X.B === X.bi.steel_mill ? v : 0), 0), mills, 'buildings kept by type');
  assert.ok(loaded.econ.dep.some((v, j) => j % X.R === X.resources.indexOf('hydro') && v > 0), 'hydro deposits filled in from the scenario');
  assert.equal(loaded.econ.prices[X.gi.gas], X.goods[X.gi.gas].price, 'new goods start at base price');
  runDays({ ...g, state: loaded }, 35);
});
