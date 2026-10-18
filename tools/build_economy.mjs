// Seeds a scenario's economy: resource deposits per province and starting building levels,
// sized so the world roughly produces what it consumes at the scenario start. Uses the game's
// own demand and efficiency functions, so it stays consistent with the simulation.
//
// Usage: node tools/build_economy.mjs [scenario=modern_2026] [--deposits-from=<scenario>]
// With --deposits-from, resource deposits are copied from another scenario (geology does not
// change) and mines are placed on them; otherwise deposits are sized from resource_table.csv.
// Buildings and goods a country has no technology for are not placed.
// Inputs: data/map/world.json, data/rules/*.json, tools/resource_table.csv.
// Output: adds "economy" (deposits, buildings) and an infrastructure level to every province
// record of data/scenarios/<scenario>.json.
import fs from 'node:fs';
import { decodeMap, makeRules } from '../src/core/game.js';
import { loadRules } from './load_rules.mjs';
import { createState } from '../src/core/state.js';
import { popDemand, milDemand, devEff, infraEff, buildingEff, fertilityMap, buildingInputs, techOutput } from '../src/core/industry.js';
import { initTechnology } from '../src/core/technology.js';
import { refreshCountryCache } from '../src/core/state.js';

const ROOT = new URL('../', import.meta.url);
const rd = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT)));
const args = process.argv.slice(2);
const scenId = args.find((a) => !a.startsWith('--')) || 'modern_2026';
const depFrom = args.find((a) => a.startsWith('--deposits-from='))?.split('=')[1] || null;
const scenPath = new URL(`data/scenarios/${scenId}.json`, ROOT);
const map = decodeMap(rd('data/map/world.json'), rd('data/map/seas.json'));
const rules = loadRules();
const scenario = JSON.parse(fs.readFileSync(scenPath));
delete scenario.economy;
for (const rec of Object.values(scenario.provinces)) rec.length = 4;
const X = rules.econ, I = rules.balance.industry, E = rules.balance.economy;
const state = createState({ map, scenario, rules, seed: 'build' });
initTechnology(state, map, rules, scenario);
refreshCountryCache(state, map, rules);
const C = state.countries, N = map.count, P = state.prov;
const fert = fertilityMap(map);

// --- table ---
const table = {};
if (!depFrom) {
  const lines = fs.readFileSync(new URL('tools/resource_table.csv', ROOT), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const head = lines[0].split(',');
  for (const l of lines.slice(1)) {
    const v = l.split(',');
    const row = {};
    head.forEach((h, k) => { if (k && v[k] !== '' && v[k] != null) row[h] = +v[k]; });
    table[v[0]] = row;
  }
}
const SPEC_COL = { food: 'food', consumer_goods: 'consumer', electronics: 'electronics', steel: 'steel', machinery: 'machinery', fuel: 'fuel' };
function spec(c, g) {
  const row = table[c.tag] || {}, col = SPEC_COL[g], dev = c.cache.avgDev;
  if (col && row[col] != null) return row[col];
  switch (g) {
    case 'food': return 1.0;
    case 'consumer_goods': return dev > 25 ? 0.8 : 0.4;
    case 'electronics': return dev >= 45 ? 0.3 : 0;
    case 'steel': return dev > 25 ? 0.6 : 0.2;
    case 'machinery': return dev >= 50 ? 0.6 : 0.15;
    case 'fuel': return dev > 25 ? 0.6 : 0.3;
    case 'munitions': return dev > 20 ? 1 : 0.3;
    default: return 1;
  }
}

// --- per-country data ---
const provs = C.map(() => []);
for (const i of map.ids) if (P.owner[i] >= 0) provs[P.owner[i]].push(i);
const G = X.G;
const D = C.map((c) => {
  const a = popDemand(rules, c, new Float64Array(G)), m = milDemand(state, rules, c, new Float64Array(G));
  for (let g = 0; g < G; g++) a[g] += m[g];
  return a;
});
const levels = new Float64Array(N * X.B); // fractional until rounded
const deposits = new Uint8Array(N * X.R);
const labourLeft = new Float64Array(N);
const effOf = (i, b) => infraEff(P.infra[i], rules) * buildingEff(X.buildings[b], devEff(P.dev[i], rules), fert[i]) * techOutput(C[P.owner[i]], b);
const canHave = (k, b) => !C[k].tfx || C[k].tfx.bld[b];
// fixed deposits copied from another scenario
const fixedDep = new Uint8Array(N * X.R);
if (depFrom) {
  const src = JSON.parse(fs.readFileSync(new URL(`data/scenarios/${depFrom}.json`, ROOT))).economy.deposits;
  for (const [i, d] of Object.entries(src)) for (const [r, v] of Object.entries(d)) if (X.resources.includes(r)) fixedDep[+i * X.R + X.resources.indexOf(r)] = v;
}

// --- deposits ---
const AFFINITY = { // TERRAINS order: plains hills mountains forest desert tundra
  oil: [1.5, 0.6, 0.3, 0.6, 3, 1.5], coal: [1, 2, 1.5, 1, 0.4, 0.8], iron: [0.8, 2, 2, 0.8, 1.2, 0.8],
  uranium: [1, 1, 0.8, 0.6, 2.5, 1], rare_earths: [1, 1.5, 1.5, 1, 1, 0.6],
};
function placeDeposits(r, k, units) {
  // units = level-equivalents of mining capacity wanted for country k
  const R = X.resources.indexOf(r);
  const mine = X.buildings.find((b) => b.dep === R);
  const ps = provs[k];
  const w = ps.map((i) => (AFFINITY[r]?.[map.terrain[i]] ?? 1) * Math.sqrt(map.area[i]) * (r === 'oil' && map.coastal[i] ? 1.5 : 1));
  const tw = w.reduce((a, b) => a + b, 0);
  let carry = 0;
  ps.forEach((i, n) => {
    const want = (units * w[n]) / tw / Math.max(0.2, effOf(i, mine.i)) + carry;
    const lv = Math.max(0, Math.min(mine.maxLevel, Math.floor(labourLeft[i] / mine.workers), Math.round(want)));
    carry = want - lv;
    if (lv > 0) {
      labourLeft[i] -= lv * mine.workers;
      deposits[i * X.R + R] = Math.min(mine.maxLevel, Math.ceil(lv * 1.3 + 0.5));
      levels[i * X.B + mine.i] = lv;
    }
  });
}
// timber: forests everywhere
const TR = X.resources.indexOf('timber');
for (const i of map.ids) {
  if (P.owner[i] < 0) continue;
  const t = map.terrain[i], lat = Math.abs(map.lat[i]);
  const forest = t === 3 ? 1 : (t === 5 && lat < 66) || ((t === 1 || t === 2) && lat > 40 && lat < 65) ? 0.5 : t === 0 ? 0.15 : 0;
  const d = Math.round(forest * Math.min(10, Math.sqrt(map.area[i]) / 25));
  if (d > 0) deposits[i * X.R + TR] = d;
}

// --- planning ---
function placeLevels(k, b, unitsWanted) {
  // unitsWanted = output units per month wanted from building b in country k
  const B = X.buildings[b];
  const outAmt = B.out[0][1];
  let need = unitsWanted / outAmt; // level × efficiency units
  const ps = provs[k].filter((i) => P.dev[i] >= (B.minDev || 0) && (!B.fertility || fert[i] >= 0.2) && (B.dep < 0 || deposits[i * X.R + B.dep] > 0));
  if (!ps.length || need <= 0 || !canHave(k, b)) return need > 0 ? unitsWanted : 0;
  for (let round = 0; round < 3 && need > 1e-6; round++) {
    const w = ps.map((i) => {
      const room = Math.min(B.maxLevel - levels[i * X.B + b], B.dep >= 0 ? deposits[i * X.R + B.dep] - levels[i * X.B + b] : Infinity, labourLeft[i] / B.workers);
      return room > 0.05 ? P.pop[i] ** 0.7 * effOf(i, b) * (B.fertility ? fert[i] : 1) : 0;
    });
    const tw = w.reduce((a, c) => a + c, 0);
    if (!tw) break;
    let placed = 0;
    ps.forEach((i, n) => {
      if (!w[n]) return;
      const e = Math.max(0.05, effOf(i, b));
      const room = Math.min(B.maxLevel - levels[i * X.B + b], B.dep >= 0 ? deposits[i * X.R + B.dep] - levels[i * X.B + b] : Infinity, labourLeft[i] / B.workers);
      const lv = Math.min(room, (need * w[n]) / tw / e);
      levels[i * X.B + b] += lv;
      labourLeft[i] -= lv * B.workers;
      placed += lv * e;
    });
    need -= placed;
  }
  return need * outAmt; // unplaced output
}

function inputsOf(k, b, extra) {
  const B = X.buildings[b];
  for (const i of provs[k]) {
    const lv = levels[i * X.B + b];
    if (!lv) continue;
    const e = effOf(i, b);
    for (const [g, a] of buildingInputs(rules, C[k], b)) extra[k][g] += lv * e * a;
  }
}

const gid = X.gi, bid = X.bi;
const ORDER = ['electronics', 'consumer_goods', 'machinery', 'munitions', 'fuel', 'steel', 'energy', 'food', 'timber', 'rare_earths', 'uranium', 'iron', 'coal', 'oil'];
const PRODUCER = { electronics: 'electronics_plant', consumer_goods: 'factory', machinery: 'machine_works', munitions: 'arms_factory', fuel: 'refinery', steel: 'steel_mill', food: 'farm', timber: 'lumber_camp', rare_earths: 'rare_earth_mine', uranium: 'uranium_mine', iron: 'iron_mine', coal: 'coal_mine', oil: 'oil_well' };
let mineEnergy = C.map(() => 0);
let extra;
const mult = new Float64Array(G).fill(1.04), wanted = new Float64Array(G);
const net = X.buildings.map((b) => b.out.reduce((s, [g, a]) => s + a * X.goods[g].price, 0) - b.inp.reduce((s, [g, a]) => s + a * X.goods[g].price, 0));
let capped = 0;
for (let iter = 0; iter < 6; iter++) {
  levels.fill(0);
  deposits.fill(0, 0); // re-placed below (timber restored after)
  if (depFrom) deposits.set(fixedDep);
  for (const i of map.ids) {
    if (P.owner[i] < 0) continue;
    labourLeft[i] = P.pop[i] * I.industrialLaborShare * 0.92;
    const t = map.terrain[i], lat = Math.abs(map.lat[i]);
    const forest = t === 3 ? 1 : (t === 5 && lat < 66) || ((t === 1 || t === 2) && lat > 40 && lat < 65) ? 0.5 : t === 0 ? 0.15 : 0;
    const d = Math.round(forest * Math.min(10, Math.sqrt(map.area[i]) / 12));
    if (d > 0 && !depFrom) deposits[i * X.R + TR] = d;
  }
  extra = C.map(() => new Float64Array(G));
  C.forEach((c, k) => { extra[k][gid.energy] += mineEnergy[k]; });
  for (const gname of ORDER) {
    const g = gid[gname];
    const want = C.map((c, k) => (c.alive && provs[k].length ? D[k][g] + extra[k][g] : 0));
    const W = want.reduce((a, b) => a + b, 0) * mult[g];
    wanted[g] = want.reduce((a, b) => a + b, 0) * 1.03;
    if (W <= 0) continue;
    if (gname === 'energy') {
      C.forEach((c, k) => {
        if (!want[k]) return;
        const nuc = (table[c.tag]?.nuclear || 0) * want[k] * mult[g];
        const left = placeLevels(k, bid.nuclear_power, nuc);
        placeLevels(k, bid.coal_power, want[k] * mult[g] - nuc + left);
        inputsOf(k, bid.nuclear_power, extra); inputsOf(k, bid.coal_power, extra);
      });
      continue;
    }
    const raw = ['oil', 'coal', 'iron', 'uranium', 'rare_earths'].includes(gname);
    let share;
    if (raw && depFrom) { const R = X.resources.indexOf(gname); share = C.map((c, k) => provs[k].reduce((s, i) => s + deposits[i * X.R + R], 0)); }
    else if (raw) share = C.map((c) => table[c.tag]?.[gname] || 0);
    else if (gname === 'timber') share = C.map((c, k) => provs[k].reduce((s, i) => s + deposits[i * X.R + TR], 0));
    else share = C.map((c, k) => want[k] * spec(c, gname));
    const ts = share.reduce((a, b) => a + b, 0);
    if (!ts) continue;
    const b = bid[PRODUCER[gname]];
    C.forEach((c, k) => {
      if (!share[k] || !provs[k].length) return;
      const units = (W * share[k]) / ts;
      if (raw && depFrom) placeLevels(k, b, units);
      else if (raw) placeDeposits(gname, k, units / X.buildings[b].out[0][1]);
      else placeLevels(k, b, units);
      inputsOf(k, b, extra);
    });
  }
  // energy used by mines and wells, for the next iteration
  mineEnergy = C.map((c, k) => {
    let s = 0;
    for (const b of X.buildings) if (b.dep >= 0) for (const i of provs[k]) {
      const lv = levels[i * X.B + b.i];
      if (lv) for (const [g, a] of buildingInputs(rules, C[k], b.i)) if (g === gid.energy) s += lv * effOf(i, b.i) * a;
    }
    return s;
  });
  // cap industrial value added at 70% of GDP (labour productivity sanity); farms exempt
  capped = 0;
  C.forEach((c, k) => {
    let va = 0, vaFarm = 0;
    for (const i of provs[k]) for (const b of X.buildings) {
      const lv = levels[i * X.B + b.i];
      if (!lv) continue;
      const v = lv * effOf(i, b.i) * net[b.i] * 12;
      va += v; if (b.fertility) vaFarm += v;
    }
    const gdp = c.cache.gdp;
    if (va > 0.7 * gdp && va > vaFarm) {
      const f = Math.max(0, 0.7 * gdp - vaFarm) / (va - vaFarm);
      for (const i of provs[k]) for (const b of X.buildings) if (!b.fertility) levels[i * X.B + b.i] *= f;
      capped++;
    }
  });
  // compare achieved world output with what was wanted and correct the targets
  const got = new Float64Array(G);
  for (const i of map.ids) for (const b of X.buildings) {
    const lv = levels[i * X.B + b.i];
    if (lv) for (const [g, a] of b.out) got[g] += lv * effOf(i, b.i) * a;
  }
  const line = [];
  for (let g = 0; g < G; g++) {
    if (!wanted[g]) continue;
    const r = wanted[g] / Math.max(1e-6, got[g]);
    mult[g] *= Math.max(0.85, Math.min(1.6, r));
    line.push(`${X.goods[g].id} ${(got[g] / wanted[g] * 100).toFixed(0)}%`);
  }
  if (process.env.VERBOSE) console.log(`iteration ${iter}: output vs wanted (incl. 3% margin):`, line.join(', '));
}

// --- round to whole levels, carrying remainders per country and building ---
const out = { deposits: {}, buildings: {} };
let totalLevels = 0;
C.forEach((c, k) => {
  for (let b = 0; b < X.B; b++) {
    let carry = 0;
    const ps = [...provs[k]].sort((x, y) => levels[y * X.B + b] - levels[x * X.B + b]);
    for (const i of ps) {
      const v = levels[i * X.B + b] + carry;
      const B = X.buildings[b];
      let lv = Math.max(0, Math.min(B.maxLevel, Math.round(v)));
      if (B.dep >= 0) lv = Math.min(lv, deposits[i * X.R + B.dep]);
      carry = v - lv;
      levels[i * X.B + b] = lv;
      if (lv) { (out.buildings[i] ||= {})[B.id] = lv; totalLevels += lv; }
    }
  }
});
for (const i of map.ids) for (let r = 0; r < X.R; r++) if (deposits[i * X.R + r]) (out.deposits[i] ||= {})[X.resources[r]] = deposits[i * X.R + r];
for (const [id, rec] of Object.entries(scenario.provinces)) rec[4] = P.infra[+id];
scenario.economy = {
  note: 'Generated by tools/build_economy.mjs from tools/resource_table.csv. Deposits and starting industry are model estimates sized to world demand.',
  ...out,
};
fs.writeFileSync(scenPath, JSON.stringify(scenario));
console.log(`${scenId}: ${Object.keys(out.buildings).length} provinces with buildings, ${totalLevels} building levels, ${Object.keys(out.deposits).length} provinces with deposits; VA capped in ${capped} countries`);
