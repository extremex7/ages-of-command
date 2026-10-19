import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { aiEconomy } from '../src/core/ai.js';
import { computeLedgers, monthlyEconomy } from '../src/core/economy.js';
import { provinceGdp } from '../src/core/state.js';
import { stepDays } from '../src/core/pathfind.js';
import { armySpeed } from '../src/core/military.js';
import { sideStats } from '../src/core/combat.js';
import { declareWar } from '../src/core/war.js';
import {
  compileEconomy, industryMonth, canBuild, startProject, cancelProject, processConstruction, projectCost,
  efficiencyBreakdown, toggleEmbargo, tradePartners, constructionSlots,
} from '../src/core/industry.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const sum = (a) => a.reduce((x, y) => x + y, 0);
function worldTotals(s, g) {
  let need = 0, prod = 0;
  for (const c of s.countries) if (c.alive) { need += c.econ.need[g]; prod += c.econ.prod[g]; }
  return { need, prod };
}

test('economy rules: compile, and broken data files fail with a clear message', () => {
  const X = data().rules.econ;
  assert.ok(X.G >= 14 && X.B >= 15 && X.R >= 6);
  assert.deepEqual(X.producers[X.gi.steel], [X.bi.steel_mill]);
  const goods = rd('data/rules/goods.json'), bld = rd('data/rules/buildings.json');
  bld.factory.in.unobtainium = 1;
  assert.throws(() => compileEconomy(goods, bld), /unknown good "unobtainium"/);
  const g2 = rd('data/rules/goods.json'); g2.food.price = 0;
  assert.throws(() => compileEconomy(g2, rd('data/rules/buildings.json')), /price must be positive/);
});

test('start: province GDP is calibrated to the scenario and world output covers world need', () => {
  const g = game();
  const { state, map, rules } = g;
  const E = rules.balance.economy;
  for (const i of map.ids.slice(0, 400)) {
    if (state.prov.owner[i] < 0) continue;
    const target = (state.prov.pop[i] * E.devBase * Math.pow(E.devGrowth, state.prov.dev[i])) / 1e9;
    const got = provinceGdp(state, i, E);
    if (state.econ.sf[i] > 0.051) assert.ok(Math.abs(got - target) / target < 1e-3, `province ${i}: ${got} vs ${target}`);
  }
  for (const gd of rules.econ.goods) {
    const { need, prod } = worldTotals(state, gd.i);
    if (need > 0) assert.ok(prod / need > 0.9, `${gd.id}: world production ${prod.toFixed(1)} vs need ${need.toFixed(1)}`);
  }
  // most countries start with their needs met
  const alive = state.countries.filter((c) => c.alive);
  assert.ok(alive.filter((c) => c.econ.foodSat > 0.95).length / alive.length > 0.9);
});

test('scarce inputs: mines run on this month\'s power and coal is shared, not grabbed', () => {
  const g = game({ seed: 'share' }), s = g.state, X = g.rules.econ, k = tagIdx(g, 'DEU'), e = s.countries[k].econ;
  runDays(g, 1);
  for (const c of s.countries) if (c.idx !== k) toggleEmbargo(s, k, c.idx);
  // no energy left over from last month, and only half the coal the country needs
  e.stock[X.gi.energy] = 0;
  let coalNeed = 0;
  for (const p of provOf(g, 'DEU')) for (const b of ['coal_power', 'steel_mill']) coalNeed += s.econ.bld[p * X.B + X.bi[b]];
  e.stock[X.gi.coal] = 0.5 * (e.need[X.gi.coal] || coalNeed);
  industryMonth(s, g.map, g.rules);
  assert.ok(e.prod[X.gi.coal] > 0, 'coal mines got energy from this month\'s power plants');
  assert.ok(e.prod[X.gi.steel] > 0, 'steel mills got a share of the coal');
  assert.ok(e.prod[X.gi.energy] > 0, 'power plants got a share of the coal');
});

test('production chain: without steel, consumer factories stall and output falls', () => {
  const base = game({ seed: 'chain' }), cut = game({ seed: 'chain' });
  const X = base.rules.econ, k = tagIdx(base, 'DEU');
  for (const g of [base, cut]) runDays(g, 1);
  // cut Germany off from the world and empty its steel stockpile
  const s = cut.state;
  for (const c of s.countries) if (c.idx !== k) toggleEmbargo(s, k, c.idx);
  s.countries[k].econ.stock[X.gi.steel] = 0;
  s.econ.bld.forEach((v, j) => { if (j % X.B === X.bi.steel_mill && s.prov.owner[Math.floor(j / X.B)] === k) s.econ.bld[j] = 0; });
  industryMonth(base.state, base.map, base.rules);
  industryMonth(s, cut.map, cut.rules);
  const cg = X.gi.consumer_goods;
  assert.ok(s.countries[k].econ.inSat[X.gi.steel] < 0.05, 'steel inputs unmet');
  assert.ok(s.countries[k].econ.prod[cg] < base.state.countries[k].econ.prod[cg] * 0.1, 'consumer goods output collapsed');
  assert.ok(s.countries[k].econ.va < base.state.countries[k].econ.va, 'value added fell');
  assert.ok(s.countries[k].econ.unemployment > base.state.countries[k].econ.unemployment, 'idle workers raise unemployment');
  assert.equal(s.countries[k].econ.imp.reduce((a, b) => a + b, 0), 0, 'embargoed country imports nothing');
});

test('construction: costs money and goods, takes its build time, then adds a level', () => {
  const g = game({ player: 'FRA', seed: 'build' });
  const { state, map, rules } = g;
  const X = rules.econ, k = state.player, c = state.countries[k];
  const p = c.capital, b = X.bi.factory;
  const lvl = state.econ.bld[p * X.B + b];
  const cost = projectCost(state, map, rules, k, p, 'building', b);
  const t0 = c.treasury, steel0 = c.econ.stock[X.gi.steel];
  assert.equal(startProject(state, map, rules, k, p, 'building', b), null);
  assert.ok(Math.abs(c.treasury - (t0 - cost.total)) < 1e-6, 'paid up front');
  assert.ok(c.econ.stock[X.gi.steel] < steel0, 'goods taken from the stockpile');
  for (let d = 0; d < X.buildings[b].days - 1; d++) processConstruction(state, map, rules);
  assert.equal(state.econ.bld[p * X.B + b], lvl, 'not finished early');
  processConstruction(state, map, rules);
  assert.equal(state.econ.bld[p * X.B + b], lvl + 1, 'level added');
  assert.equal(state.construction.length, 0);
  // reasons
  const ger = state.countries[tagIdx(g, 'DEU')].capital;
  assert.match(canBuild(state, map, rules, k, ger, 'building', b), /do not own/);
  const noOil = map.ids.find((i) => state.prov.owner[i] === k && state.econ.dep[i * X.R + X.resources.indexOf('oil')] === 0);
  assert.match(canBuild(state, map, rules, k, noOil, 'building', X.bi.oil_well), /deposit/);
  c.treasury = 0;
  assert.match(canBuild(state, map, rules, k, p, 'building', b), /Costs/);
  // cancel refunds half
  c.treasury = 1000;
  startProject(state, map, rules, k, p, 'infra');
  const paid = state.construction[0].paid, t1 = c.treasury;
  cancelProject(state, rules, state.construction[0].id);
  assert.ok(Math.abs(c.treasury - (t1 + paid * rules.balance.industry.cancelRefund)) < 1e-9);
});

test('construction slots limit how many projects advance at once', () => {
  const g = game({ player: 'BEL', seed: 'slots' });
  const { state, map, rules } = g;
  const k = state.player, c = state.countries[k];
  c.treasury = 1e5;
  const slots = constructionSlots(state, rules, k);
  const provs = provOf(g, 'BEL');
  let n = 0;
  for (const p of provs) for (let r = 0; r < 3 && n < slots + 2; r++) if (!startProject(state, map, rules, k, p, 'infra')) n++;
  assert.ok(n > slots);
  processConstruction(state, map, rules);
  const advanced = state.construction.filter((p) => p.left < p.days).length;
  assert.equal(advanced, slots);
});

test('infrastructure raises building efficiency and movement speed', () => {
  const g = game();
  const { state, map, rules } = g;
  const X = rules.econ;
  const p = state.countries[tagIdx(g, 'POL')].capital;
  const e = map.adjStart[p];
  const to = map.adj[e];
  state.prov.infra[to] = 2;
  const slow = stepDays(map, state, p, e, 24);
  state.prov.infra[to] = 9;
  const fast = stepDays(map, state, p, e, 24);
  assert.ok(fast < slow * 0.8, `${fast} vs ${slow}`);
  state.prov.infra[p] = 2;
  const e1 = efficiencyBreakdown(state, map, rules, p, X.bi.factory).total;
  state.prov.infra[p] = 9;
  const e2 = efficiencyBreakdown(state, map, rules, p, X.bi.factory).total;
  assert.ok(e2 > e1 * 1.25);
});

test('trade: partners trade, embargoes and wars close the route', () => {
  const g = game({ seed: 'trade' });
  const { state, map, rules } = g;
  runDays(g, 40);
  const jpn = tagIdx(g, 'JPN');
  const partners = tradePartners(state, jpn);
  assert.ok(partners && partners.length > 0, 'Japan trades');
  const top = partners[0][0];
  toggleEmbargo(state, jpn, top);
  industryMonth(state, map, rules);
  assert.ok(!tradePartners(state, jpn, 200).some(([j]) => j === top), 'embargoed partner gone');
  toggleEmbargo(state, jpn, top);
  industryMonth(state, map, rules);
  assert.ok(tradePartners(state, jpn, 200).some(([j]) => j === top), 'trade resumes after the embargo');
  // war: belligerents stop trading
  const a = tagIdx(g, 'ARG'), b = tagIdx(g, 'CHL');
  declareWar(state, map, rules, a, b);
  industryMonth(state, map, rules);
  assert.ok(!(tradePartners(state, a, 200) || []).some(([j]) => j === b));
});

test('tariffs bring revenue and raise consumer prices', () => {
  const lo = game({ seed: 'tariff' }), hi = game({ seed: 'tariff' });
  const k = tagIdx(lo, 'GBR');
  lo.state.countries[k].econ.tariff = 0;
  hi.state.countries[k].econ.tariff = 0.4;
  for (const g of [lo, hi]) for (let m = 0; m < 3; m++) monthlyEconomy(g.state, g.map, g.rules);
  const L = lo.state.countries[k], H = hi.state.countries[k];
  assert.equal(L.ledger.tariffs, 0);
  assert.ok(H.ledger.tariffs > 0);
  assert.ok(H.econ.cpi > L.econ.cpi, `${H.econ.cpi} vs ${L.econ.cpi}`);
  assert.ok(H.econ.impValue < L.econ.impValue * 1.0001, 'high tariffs cut imports');
});

test('food shortage lowers stability and shrinks the population', () => {
  const g = game({ seed: 'famine' }), ref = game({ seed: 'famine' });
  const k = tagIdx(g, 'EGY');
  const s = g.state, X = g.rules.econ;
  for (const c of s.countries) if (c.idx !== k) toggleEmbargo(s, k, c.idx);
  s.econ.bld.forEach((v, j) => { if (j % X.B === X.bi.farm && s.prov.owner[Math.floor(j / X.B)] === k) s.econ.bld[j] = 0; });
  s.countries[k].econ.stock[X.gi.food] = 0;
  const pop0 = s.countries[k].cache.pop;
  for (let m = 0; m < 4; m++) { monthlyEconomy(s, g.map, g.rules); monthlyEconomy(ref.state, ref.map, ref.rules); }
  const c = s.countries[k], r = ref.state.countries[k];
  assert.ok(c.econ.foodSat < 0.2, `food ${c.econ.foodSat}`);
  assert.ok(c.econ.stabilityParts.food < -15);
  assert.ok(c.stability < r.stability - 3, `${c.stability} vs ${r.stability}`);
  const pop = g.map.ids.reduce((t, i) => t + (s.prov.owner[i] === k ? s.prov.pop[i] : 0), 0);
  assert.ok(pop < pop0, 'population shrinks in famine');
});

test('world prices rise when supply collapses and fall back as it returns', () => {
  const g = game({ seed: 'oil' });
  const { state, map, rules } = g;
  const X = rules.econ, oil = X.gi.oil;
  const saved = state.econ.bld.slice();
  state.econ.bld.forEach((v, j) => { if (j % X.B === X.bi.oil_well) state.econ.bld[j] = Math.floor(v / 3); });
  for (let m = 0; m < 6; m++) monthlyEconomy(state, map, rules);
  const high = state.econ.prices[oil];
  assert.ok(high > X.goods[oil].price * 1.2, `oil price ${high}`);
  state.econ.bld.set(saved);
  for (let m = 0; m < 12; m++) monthlyEconomy(state, map, rules);
  assert.ok(state.econ.prices[oil] < high, 'price eases when supply returns');
});

test('army supply: munitions shortages weaken combat, fuel shortages slow armour', () => {
  const g = game();
  const { state, rules } = g;
  const a = state.armies.find((x) => x.units.armor > 0);
  const e = state.countries[a.owner].econ;
  const full = sideStats(state, [a.id], 'att', 'plains', rules, a.loc).dmg;
  const v0 = armySpeed(a, rules, state);
  e.supplyMun = 0; e.supplyFuel = 0;
  const starved = sideStats(state, [a.id], 'att', 'plains', rules, a.loc).dmg;
  assert.ok(starved < full * 0.62, `${starved} vs ${full}`);
  assert.ok(armySpeed(a, rules, state) < v0 * 0.75);
});

test('occupied provinces produce nothing for their owner', () => {
  const g = game({ seed: 'occ' });
  const { state, map, rules } = g;
  const p = map.ids.find((i) => state.econ.va[i] > 1 && state.prov.owner[i] >= 0);
  const own = state.prov.owner[p];
  const other = state.countries.find((c) => c.idx !== own && c.alive).idx;
  state.prov.controller[p] = other;
  industryMonth(state, map, rules);
  assert.equal(state.econ.va[p], 0);
  assert.ok(efficiencyBreakdown(state, map, rules, p, rules.econ.bi.farm).occupied);
});

test('AI invests: over two years AI countries start projects and industry grows', () => {
  const g = game({ seed: 'ai-econ' });
  const X = g.rules.econ;
  const lv0 = sum(Array.from(g.state.econ.bld));
  runDays(g, 730);
  const lv1 = sum(Array.from(g.state.econ.bld));
  assert.ok(g.state.aiLog.some((l) => l.text.startsWith('Building ')), 'AI building decisions logged');
  assert.ok(lv1 > lv0, `building levels ${lv0} -> ${lv1}`);
  // the world economy stays sane
  const alive = g.state.countries.filter((c) => c.alive);
  assert.ok(alive.filter((c) => c.econ.foodSat > 0.9).length / alive.length > 0.85, 'most countries fed');
  for (const gd of X.goods) {
    const r = g.state.econ.prices[gd.i] / gd.price;
    assert.ok(r > 0.5 && r < 2.5, `${gd.id} price ratio ${r.toFixed(2)}`);
  }
});

test('AI with unused deposits mines raw materials the world is short of', () => {
  const g = game({ seed: 'mine' }), s = g.state, X = g.rules.econ;
  runDays(g, 1);
  const k = tagIdx(g, 'CHN'), c = s.countries[k];
  // the world is short of coal: prices up and a big unmet need elsewhere
  s.econ.prices[X.gi.coal] = X.goods[X.gi.coal].price * 1.4;
  s.countries[tagIdx(g, 'JPN')].econ.need[X.gi.coal] += 500;
  c.treasury = c.ledger.revenue * 10;
  for (const x of s.construction.filter((p) => p.owner === k)) cancelProject(s, g.rules, x.id);
  const before = s.construction.filter((p) => p.owner === k && p.kind === 'building' && p.b === X.bi.coal_mine).length;
  for (let d = 0; d < 2; d++) { aiEconomy(s, g.map, g.rules); s.day += 31; }
  const after = s.construction.filter((p) => p.owner === k && p.kind === 'building' && p.b === X.bi.coal_mine).length;
  assert.ok(after > before, `China started coal mines for export (${before} -> ${after})`);
});
