// Reproducible simulation benchmark: fixed scenario, seed and AI settings.
// Usage: node tools/bench.mjs [years=10] [aggression=1]
import fs from 'node:fs';
import { decodeMap, makeRules, newGame, saveGame, loadGame } from '../src/core/game.js';
import { tick } from '../src/core/sim.js';
import { formatDate } from '../src/core/calendar.js';

const years = +(process.argv[2] || 10), aggression = +(process.argv[3] || 1);
const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const mb = () => (process.memoryUsage().heapUsed / 1048576).toFixed(1);
let t = performance.now();
const world = rd('data/map/world.json');
const tParse = performance.now() - t;
t = performance.now();
const map = decodeMap(world);
const rules = makeRules(rd('data/rules/units.json'), rd('data/rules/balance.json'), rd('data/rules/goods.json'), rd('data/rules/buildings.json'), rd('data/rules/governments.json'), [rd('data/events/domestic.json')]);
const scenario = rd('data/scenarios/modern_2026.json');
const tDecode = performance.now() - t;
t = performance.now();
const game = newGame({ map, scenario, rules, seed: 'bench-1', settings: { aiAggression: aggression } });
const tNew = performance.now() - t;
console.log(`map: ${map.ids.length} provinces, ${map.adj.length / 2} edges | parse ${tParse.toFixed(0)} ms, decode ${tDecode.toFixed(0)} ms, new game ${tNew.toFixed(0)} ms, heap ${mb()} MB`);
console.log(`running ${years} years, AI aggression ${aggression}, seed bench-1`);
const daily = [], monthly = [];
t = performance.now();
for (let y = 0; y < years; y++) {
  const ty = performance.now();
  for (let d = 0; d < 365; d++) {
    const { monthly: m } = tick(game);
    (m ? monthly : daily).push(game.profile.total);
  }
  const s = game.state;
  console.log(`  ${formatDate(s.day)}: ${(performance.now() - ty).toFixed(0)} ms/yr | wars ${s.wars.length}, armies ${s.armies.length}, battles so far ${s.reports.length}, alive ${s.countries.filter((c) => c.alive).length}, heap ${mb()} MB`);
}
const total = performance.now() - t;
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
console.log(`total ${total.toFixed(0)} ms = ${(total / (years * 365)).toFixed(3)} ms/day`);
console.log(`daily tick p50 ${pct(daily, 0.5).toFixed(2)} ms, p99 ${pct(daily, 0.99).toFixed(2)} ms | monthly tick p50 ${pct(monthly, 0.5).toFixed(2)} ms, max ${Math.max(...monthly).toFixed(2)} ms`);
t = performance.now();
const text = saveGame(game);
const tSave = performance.now() - t;
t = performance.now();
loadGame(text, { map, rules, scenario });
console.log(`save ${tSave.toFixed(0)} ms (${(text.length / 1024).toFixed(0)} KB), load ${(performance.now() - t).toFixed(0)} ms`);
