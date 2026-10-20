import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data, tagIdx } from './helpers.mjs';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { levelSize, projectCost, provinceLabour } from '../src/core/industry.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const game = (id) => { const d = data(); return newGame({ map: d.map, rules: d.rules, scenario: rd(`data/scenarios/${id}.json`), seed: 'lvl' }); };

test('building levels are sized to the province: a 1444 farm is affordable, a modern one full size', () => {
  const g = game('rise_of_empires_1444'), s = g.state, R = g.rules, X = R.econ;
  // the median country's cheapest farm costs a few months of its revenue, not years
  const months = s.countries.filter((c) => c.alive && c.ledger?.revenue > 0).map((c) => {
    const ps = g.map.ids.filter((i) => s.prov.owner[i] === c.idx);
    return Math.min(...ps.map((i) => projectCost(s, g.map, R, c.idx, i, 'building', X.bi.farm).money)) / c.ledger.revenue;
  }).sort((a, b) => a - b);
  assert.ok(months[months.length >> 1] < 12, `median farm costs ${months[months.length >> 1].toFixed(1)} months of revenue`);
  for (const i of g.map.ids) if (s.prov.owner[i] >= 0) { const z = levelSize(s, R, i); assert.ok(z >= 0.01 && z <= 1); }
  const m = game('modern_2026'), fr = tagIdx(m, 'FRA');
  const paris = m.map.ids.filter((i) => m.state.prov.owner[i] === fr).sort((a, b) => m.state.prov.pop[b] - m.state.prov.pop[a])[0];
  assert.equal(levelSize(m.state, m.rules, paris), 1);
});

test('a smaller level costs, employs and produces proportionally less', () => {
  const g = game('rise_of_empires_1444'), s = g.state, R = g.rules, X = R.econ;
  const k = tagIdx(g, 'FRA'), ps = g.map.ids.filter((i) => s.prov.owner[i] === k).map((i) => [i, levelSize(s, R, i)]).sort((a, b) => a[1] - b[1]);
  const [small, zs] = ps[0], [big, zb] = ps[ps.length - 1];
  assert.ok(zs < zb);
  const cs = projectCost(s, g.map, R, k, small, 'building', X.bi.farm), cb = projectCost(s, g.map, R, k, big, 'building', X.bi.farm);
  const lvl = (i) => 1 + 0.04 * s.econ.bld[i * X.B + X.bi.farm] * levelSize(s, R, i);
  assert.ok(Math.abs(cs.money / lvl(small) / zs - cb.money / lvl(big) / zb) < 1e-9, 'cost per unit of level size is the same');
  const before = provinceLabour(s, R, small).need;
  s.econ.bld[small * X.B + X.bi.farm]++;
  assert.ok(Math.abs(provinceLabour(s, R, small).need - before - X.buildings[X.bi.farm].workers * zs) < 1e-6, 'workers scale with level size');
});

test('a version 6 save keeps its output: full-size levels are converted to province-sized ones', () => {
  const g = game('rise_of_empires_1444'), s = g.state, R = g.rules, X = R.econ;
  const i = g.map.ids.find((p) => s.prov.owner[p] >= 0 && levelSize(s, R, p) < 0.2 && levelSize(s, R, p) > 0.05);
  s.econ.bld.fill(0);
  s.econ.bld[i * X.B + X.bi.farm] = 2; // two full-size farms in an old save
  const old = JSON.parse(saveGame(g));
  old.version = 6;
  const g2 = loadGame(JSON.stringify(old), { map: g.map, rules: R, scenario: rd('data/scenarios/rise_of_empires_1444.json') });
  const L = g2.state.econ.bld[i * X.B + X.bi.farm], z = levelSize(g2.state, R, i);
  assert.ok(Math.abs(L * z - 2) <= z / 2 + 1e-9, `${L} levels of size ${z.toFixed(3)}`);
});
