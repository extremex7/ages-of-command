// Adds natural gas and hydro deposits to every scenario (geology does not change between
// scenarios, so all get the same deposits) without touching anything else in the files.
//
// Gas: each country's approximate share of world gas production c. 2023 (GAS below, percent;
// rounded public estimates used as balance inputs) becomes deposit levels on its present-day
// territory (Modern World owners), oil provinces first, then lowland provinces.
// Hydro: from terrain (mountains 2, hills 1) plus one level, and at least 2 outside deserts, in
// countries known for large hydro resources (HYDRO below).
//
// Usage: node tools/add_energy_deposits.mjs
import fs from 'node:fs';
import { decodeMap } from '../src/core/game.js';
import { TERRAINS } from '../src/core/mapdata.js';

const ROOT = new URL('../', import.meta.url);
const rd = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT)));
const map = decodeMap(rd('data/map/world.json'), rd('data/map/seas.json'));
const modern = rd('data/scenarios/modern_2026.json');

const GAS = {
  USA: 24, RUS: 16, IRN: 6, CHN: 5.5, CAN: 4.5, QAT: 4.4, AUS: 3.8, NOR: 3, SAU: 3, DZA: 2.3, TKM: 2, MYS: 1.8,
  EGY: 1.6, IDN: 1.5, ARE: 1.4, UZB: 1.2, NGA: 1.2, ARG: 1.1, OMN: 1, AZE: 1, GBR: 0.9, MEX: 0.8, KAZ: 0.8, PAK: 0.8,
  THA: 0.8, IND: 0.8, BGD: 0.7, TTO: 0.7, VEN: 0.6, UKR: 0.5, NLD: 0.5, KWT: 0.4, BHR: 0.4, BOL: 0.4, MMR: 0.4,
  PER: 0.3, BRN: 0.3, LBY: 0.3, IRQ: 0.3, ROU: 0.2, ISR: 0.4, MOZ: 0.3, ITA: 0.1, DEU: 0.1, COL: 0.3, BRA: 0.6,
};
const HYDRO = ['NPL', 'BTN', 'NOR', 'CHE', 'AUT', 'CAN', 'BRA', 'PRY', 'COL', 'PER', 'CHN', 'LAO', 'ISL', 'NZL', 'ETH',
  'TJK', 'KGZ', 'GEO', 'VEN', 'ZMB', 'MOZ', 'SWE', 'ECU', 'VNM', 'MMR', 'IND', 'PAK', 'COD', 'AGO', 'TUR', 'JPN'];
const WORLD_GAS_LEVELS = 520, MAX_GAS = 10, MAX_HYDRO = 6;

const owner = {};
for (const [id, rec] of Object.entries(modern.provinces)) owner[+id] = rec[0];
const T = (i) => TERRAINS[map.terrain[i]];
const oilOf = (i) => modern.economy.deposits[i]?.oil || 0;

const gas = {}, hydro = {};
for (const i of map.ids) {
  const t = T(i), lat = Math.abs(map.lat[i]);
  let h = { mountains: 2, hills: 1 }[t] || 0;
  if (HYDRO.includes(owner[i]) && t !== 'desert') h = Math.max(h + 1, 2);
  if (lat > 66) h = Math.min(h, 1);
  if (h) hydro[i] = Math.min(MAX_HYDRO, h);
}
const byCountry = {};
for (const i of map.ids) if (owner[i]) (byCountry[owner[i]] ||= []).push(i);
for (const [tag, share] of Object.entries(GAS)) {
  const ps = (byCountry[tag] || []).filter((i) => T(i) !== 'mountains').sort((a, b) => oilOf(b) - oilOf(a) || ({ desert: 0, plains: 1, tundra: 2, hills: 3, forest: 4 }[T(a)] - { desert: 0, plains: 1, tundra: 2, hills: 3, forest: 4 }[T(b)]) || a - b);
  if (!ps.length) { console.warn(`${tag}: no provinces`); continue; }
  let left = Math.max(1, Math.round((share / 100) * WORLD_GAS_LEVELS));
  // spread over up to a third of the country's provinces, oil provinces first
  const use = ps.slice(0, Math.max(1, Math.min(ps.length, Math.ceil(left / 3), Math.ceil(ps.length / 3))));
  for (let r = 0; left > 0 && r < MAX_GAS; r++) for (const i of use) { if (left <= 0) break; gas[i] = (gas[i] || 0) + 1; left--; }
}

let files = 0;
for (const f of fs.readdirSync(new URL('data/scenarios/', ROOT))) {
  if (f === 'index.json' || !f.endsWith('.json')) continue;
  const path = new URL(`data/scenarios/${f}`, ROOT);
  const s = JSON.parse(fs.readFileSync(path));
  if (!s.economy) continue;
  const dep = s.economy.deposits;
  for (const rec of Object.values(dep)) { delete rec.gas; delete rec.hydro; }
  for (const [i, v] of Object.entries(gas)) (dep[i] ||= {}).gas = v;
  for (const [i, v] of Object.entries(hydro)) (dep[i] ||= {}).hydro = v;
  fs.writeFileSync(path, JSON.stringify(s));
  files++;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log(`gas ${sum(gas)} levels in ${Object.keys(gas).length} provinces, hydro ${sum(hydro)} levels in ${Object.keys(hydro).length} provinces; ${files} scenarios updated`);
