// Economy diagnostics: world supply/demand per good, prices and key national indicators,
// at the start and after N years of AI play. Usage: node tools/econ_report.mjs [years=3] [tags…]
import fs from 'node:fs';
import { decodeMap, makeRules, newGame } from '../src/core/game.js';
import { tick } from '../src/core/sim.js';
import { formatDate } from '../src/core/calendar.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const years = +(process.argv[2] || 3);
const tags = process.argv.slice(3).length ? process.argv.slice(3) : ['USA', 'CHN', 'DEU', 'JPN', 'IND', 'RUS', 'SAU', 'BRA', 'NGA', 'EGY', 'FRA', 'KOR'];
const map = decodeMap(rd('data/map/world.json'));
const rules = makeRules(rd('data/rules/units.json'), rd('data/rules/balance.json'), rd('data/rules/goods.json'), rd('data/rules/buildings.json'));
const game = newGame({ map, scenario: rd('data/scenarios/modern_2026.json'), rules, seed: 'econ-1' });
const s = game.state, X = rules.econ;
const gdp0 = Object.fromEntries(s.countries.map((c) => [c.tag, c.cache.gdp]));
const f = (x, d = 1) => (Math.abs(x) >= 1000 ? (x / 1000).toFixed(1) + 'k' : x.toFixed(d));

function world() {
  console.log(`\n== ${formatDate(s.day)} world market ==`);
  console.log('good            need      prod     traded   stock   price(×base)  sat<0.9');
  for (const g of X.goods) {
    let need = 0, prod = 0, tr = 0, st = 0, short = 0;
    for (const c of s.countries) {
      if (!c.alive) continue;
      need += c.econ.need[g.i]; prod += c.econ.prod[g.i]; tr += c.econ.imp[g.i]; st += c.econ.stock[g.i];
      if (c.econ.need[g.i] > 0 && c.econ.sat[g.i] < 0.9) short++;
    }
    console.log(g.id.padEnd(15), f(need).padStart(8), f(prod).padStart(9), f(tr).padStart(9), f(st).padStart(8), (s.econ.prices[g.i] / g.price).toFixed(2).padStart(10), String(short).padStart(8));
  }
}
function nations() {
  console.log('tag  GDP(B/yr) vs start  ind%  unemp  infl   CPI  food  living energy  stab  treasury  net/mo  tariff');
  for (const t of tags) {
    const c = s.countries.find((x) => x.tag === t);
    if (!c?.alive) { console.log(t, 'gone'); continue; }
    const e = c.econ;
    console.log(t.padEnd(4), f(c.cache.gdp, 0).padStart(9), ((c.cache.gdp / gdp0[t] - 1) * 100).toFixed(1).padStart(7) + '%', ((e.va * 12) / c.cache.gdp * 100).toFixed(0).padStart(5),
      (e.unemployment * 100).toFixed(1).padStart(6), (e.inflation * 100).toFixed(1).padStart(6), e.cpi.toFixed(2).padStart(5), e.foodSat.toFixed(2).padStart(5), e.living.toFixed(2).padStart(6),
      e.sat[X.gi.energy].toFixed(2).padStart(6), c.stability.toFixed(0).padStart(5), f(c.treasury).padStart(9), f(c.ledger.net, 2).padStart(7), f(e.tariffRev, 2).padStart(7));
  }
  const alive = s.countries.filter((c) => c.alive);
  const hungry = alive.filter((c) => c.econ.foodSat < 0.9).map((c) => c.tag);
  const avgStab = alive.reduce((a, c) => a + c.stability, 0) / alive.length;
  const wg = alive.reduce((a, c) => a + c.cache.gdp, 0), wg0 = Object.values(gdp0).reduce((a, b) => a + b, 0);
  console.log(`world GDP ${f(wg, 0)}B (${((wg / wg0 - 1) * 100).toFixed(1)}%), avg stability ${avgStab.toFixed(1)}, food < 90%: ${hungry.length} [${hungry.slice(0, 20).join(' ')}], projects ${s.construction.length}`);
}
world(); nations();
const t0 = performance.now();
for (let y = 1; y <= years; y++) {
  for (let d = 0; d < 365; d++) tick(game);
  if (y === years || y % 2 === 0) { world(); nations(); }
}
console.log(`\nsimulated ${years} years in ${((performance.now() - t0) / 1000).toFixed(1)} s; wars ${s.wars.length}; AI economic decisions ${s.aiLog.filter((l) => /Building|Improving/.test(l.text)).length}`);
