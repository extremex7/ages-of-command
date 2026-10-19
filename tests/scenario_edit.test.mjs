import test from 'node:test';
import assert from 'node:assert/strict';
import { data } from './helpers.mjs';
import { newGame } from '../src/core/game.js';
import { runDays } from '../src/core/sim.js';
import { validateScenario } from '../src/core/rules.js';
import {
  startEdit, paintProvince, fillRegion, provincesOf, addCountry, removeCountry, setCountryField,
  addTreaty, addWar, addArmy, tidyScenario, countryOf,
} from '../src/core/scenario_edit.js';

test('scenario editor: paint a new country, give it forces and treaties, delete another; the result plays', () => {
  const d = data(), map = d.map;
  const sc = startEdit(d.scenario, { name: 'Free Bavaria' });
  assert.equal(sc.id, 'custom_free_bavaria');
  assert.equal(sc.flagScenario, 'modern_2026');
  assert.notEqual(sc.countries, d.scenario.countries, 'a copy, not the original');
  const de = provincesOf(sc, 'DEU');
  // the new country takes a quarter of Germany's provinces, the southernmost
  const south = [...de].sort((a, b) => map.y[b] - map.y[a]).slice(0, Math.ceil(de.length / 4));
  const c = addCountry(sc, { name: 'Bavaria', gov: 'const_monarchy' });
  assert.equal(c.tag, 'BAV');
  for (const p of south) assert.equal(paintProvince(sc, p, 'BAV'), true);
  assert.equal(provincesOf(sc, 'BAV').length, south.length);
  assert.equal(setCountryField(sc, 'BAV', 'color', 'blue'), 'Colour must be #rrggbb');
  assert.equal(setCountryField(sc, 'BAV', 'color', '#3366cc'), null);
  addArmy(sc, 'BAV', south[0], { infantry: 3 });
  assert.equal(addTreaty(sc, 'alliance', 'BAV', 'AUT'), null);
  assert.match(addTreaty(sc, 'alliance', 'AUT', 'BAV'), /already/);
  assert.equal(addWar(sc, 'BAV', 'DEU'), null);
  // fill: all of Portugal goes to Spain in one stroke
  const pt = provincesOf(sc, 'PRT');
  const filled = fillRegion(sc, map, countryOf(sc, 'PRT').capital, 'ESP');
  assert.ok(filled.length > 1 && provincesOf(sc, 'PRT').length === pt.length - filled.length, `filled ${filled.length} of ${pt.length}`);
  removeCountry(sc, 'PRT');
  assert.equal(countryOf(sc, 'PRT'), null);
  assert.ok(!sc.armies.some((a) => a.owner === 'PRT'));
  const notes = tidyScenario(sc, map);
  assert.ok(provincesOf(sc, 'BAV').includes(countryOf(sc, 'BAV').capital), 'capital inside the country');
  assert.ok(Array.isArray(notes));
  // at war, German armies may stay in Bavaria; nobody else stands abroad
  const own = (p) => sc.provinces[p][0];
  assert.ok(sc.armies.every((a) => own(a.province) === a.owner || (a.owner === 'DEU' && own(a.province) === 'BAV')));
  validateScenario(sc, map);
  const g = newGame({ map, scenario: sc, rules: d.rules, seed: 'ed' });
  const k = g.state.countries.findIndex((x) => x.tag === 'BAV');
  assert.ok(g.state.countries[k].alive && g.state.armies.some((a) => a.owner === k));
  assert.ok(g.state.wars.some((w) => w.attackers.includes(k)), 'the war is running');
  runDays(g, 40);
  assert.ok(g.state.countries[k].ledger, 'the new country is governed like any other');
});
