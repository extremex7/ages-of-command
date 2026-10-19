// Industry, resources, construction and the world market (Milestone 3).
//
// Each country has a national stockpile per good. Once a month, in this order:
//   1. production: every building runs at an efficiency set by its province (workforce,
//      infrastructure, development, farmland or deposit) and by the national availability of
//      its inputs, processed in buildings.json order (power plants first) so upstream output
//      feeds downstream use;
//   2. trade: stock above a country's target is offered to the world market, stock below it is
//      bought; war and embargoes block a trade route; importers pay their own tariff;
//   3. consumption: armies first (munitions, fuel), then the population;
//   4. effects: satisfaction feeds GDP (energy, fuel), stability, population growth,
//      unemployment, consumer prices and army supply; world prices follow world demand/supply.
// All per-province data are typed arrays in state.econ; per-country data live in c.econ.
import { sanctionPairs, sanctionGoods } from './council.js';
import { log } from './state.js';
import { atWar, tradeLinks } from './relations.js';

// ---------------------------------------------------------------------------------------------
// rules

export function compileEconomy(goodsJson, buildingsJson) {
  const goods = Object.entries(goodsJson).filter(([k]) => !k.startsWith('_')).map(([id, g], i) => ({ id, i, ...g }));
  const gi = Object.fromEntries(goods.map((g) => [g.id, g.i]));
  const resources = [];
  const errs = [];
  const conv = (bid, o, what) => Object.entries(o || {}).map(([g, a]) => {
    if (!(g in gi)) errs.push(`building "${bid}": unknown good "${g}" in ${what}`);
    if (!(typeof a === 'number' && a >= 0)) errs.push(`building "${bid}": ${what}.${g} must be a non-negative number`);
    return [gi[g], a];
  });
  const buildings = Object.entries(buildingsJson).filter(([k]) => !k.startsWith('_')).map(([id, b], i) => {
    let dep = -1;
    if (b.deposit) {
      dep = resources.indexOf(b.deposit);
      if (dep < 0) { dep = resources.length; resources.push(b.deposit); }
    }
    for (const f of ['workers', 'cost', 'days', 'maxLevel']) if (!(typeof b[f] === 'number' && b[f] >= 0)) errs.push(`building "${id}": "${f}" must be a non-negative number`);
    if (b.maxLevel > 255) errs.push(`building "${id}": maxLevel must be at most 255`);
    if (b.site && !SITES.includes(b.site)) errs.push(`building "${id}": site must be one of ${SITES.join(', ')}`);
    return {
      id, i, name: b.name || id, out: conv(id, b.out, 'out'), inp: conv(id, b.in, 'in'), dep, fertility: !!b.fertility,
      workers: b.workers, cost: b.cost, goods: conv(id, b.goods, 'goods'), days: Math.max(1, Math.round(b.days)),
      maxLevel: b.maxLevel, minDev: b.minDev || 0, site: b.site || null,
    };
  });
  for (const g of goods) {
    for (const f of ['price', 'demand', 'incomeExp', 'stockMonths']) if (!(typeof g[f] === 'number' && g[f] >= 0)) errs.push(`good "${g.id}": "${f}" must be a non-negative number`);
    if (!(g.price > 0)) errs.push(`good "${g.id}": price must be positive`);
  }
  if (errs.length) throw new Error('Invalid economy rules:\n' + errs.join('\n'));
  const bi = Object.fromEntries(buildings.map((b) => [b.id, b.i]));
  // which buildings produce each good (for construction AI and UI)
  const producers = goods.map((g) => buildings.filter((b) => b.out.some(([o]) => o === g.i)).map((b) => b.i));
  // production order: power plants first, so mines and factories draw on this month's energy
  // rather than whatever the population left in the stockpile last month
  const powers = (b) => 'energy' in gi && b.out.some(([o]) => o === gi.energy);
  const order = [...buildings.filter(powers), ...buildings.filter((b) => !powers(b))];
  return { goods, gi, buildings, bi, resources, producers, order, G: goods.length, B: buildings.length, R: resources.length };
}

// ---------------------------------------------------------------------------------------------
// province factors

const fertCache = new WeakMap();
const FERT_T = [1.0, 0.7, 0.3, 0.6, 0.08, 0.05]; // plains hills mountains forest desert tundra (TERRAINS order)

// Farmland quality 0..1.1 estimated from terrain and latitude (static, per map).
export function fertilityMap(map) {
  let f = fertCache.get(map);
  if (f) return f;
  f = new Float32Array(map.count);
  for (const i of map.ids) {
    const lat = Math.abs(map.lat[i]);
    const latF = lat > 62 ? 0.3 : lat > 55 ? 0.65 : lat < 12 ? 0.85 : 1;
    f[i] = FERT_T[map.terrain[i]] * latF * (map.coastal[i] ? 1.08 : 1);
  }
  fertCache.set(map, f);
  return f;
}

// Labour productivity from development: sqrt of productivity relative to development 80.
export function devEff(dev, rules) {
  const E = rules.balance.economy, I = rules.balance.industry;
  const v = Math.exp((dev - E.refDev) * Math.log(E.devGrowth) * I.devEffExp);
  return v < I.devEffMin ? I.devEffMin : v > I.devEffMax ? I.devEffMax : v;
}

export function infraEff(infra, rules) {
  const I = rules.balance.industry;
  return I.infraEffBase + I.infraEffPerLevel * infra;
}

// Sunshine and wind (0.3..1.4) per province, estimated from terrain, latitude and the coast
// (static, per map). Solar and wind farms scale with them.
const SITES = ['solar', 'wind'];
const siteCache = new WeakMap();
const SUN_T = [1.0, 1.0, 0.9, 0.7, 1.3, 0.5]; // plains hills mountains forest desert tundra
const WIND_T = [1.1, 1.0, 0.8, 0.6, 0.9, 1.1];
export function siteMap(map, kind) {
  let c = siteCache.get(map);
  if (!c) {
    c = { solar: new Float32Array(map.count), wind: new Float32Array(map.count) };
    for (const i of map.ids) {
      const lat = Math.abs(map.lat[i]);
      c.solar[i] = Math.min(1.4, SUN_T[map.terrain[i]] * (lat < 35 ? 1.1 : lat < 50 ? 0.9 : 0.6));
      c.wind[i] = Math.min(1.4, WIND_T[map.terrain[i]] * (map.coastal[i] ? 1.25 : 1) * (lat > 40 ? 1.1 : 1));
    }
    siteCache.set(map, c);
  }
  return c[kind];
}

// Building-specific efficiency multiplier in a province (before workforce and inputs).
// site = the province's sunshine or wind factor for solar and wind farms (siteMap).
export function buildingEff(b, de, fert, site = 1) {
  if (b.site) return site * (0.5 + 0.5 * de);
  if (b.fertility) return fert * (0.4 + 0.6 * de);
  if (b.dep >= 0) return 0.5 + 0.5 * de;
  return de;
}

// Workforce available to industry and agriculture in a province, and what its buildings need.
export function provinceLabour(state, rules, i) {
  const X = rules.econ, I = rules.balance.industry, ec = state.econ;
  let need = 0;
  for (let b = 0; b < X.B; b++) { const L = ec.bld[i * X.B + b]; if (L) need += L * X.buildings[b].workers; }
  const avail = state.prov.pop[i] * I.industrialLaborShare;
  return { need, avail, factor: need > 0 ? Math.min(1, avail / need) : 1 };
}

// Explains the efficiency of building b in province i (used by tooltips and the AI).
export function efficiencyBreakdown(state, map, rules, i, b) {
  const B = rules.econ.buildings[b];
  const lab = provinceLabour(state, rules, i);
  const de = devEff(state.prov.dev[i], rules);
  const ie = infraEff(state.prov.infra[i], rules);
  const fert = fertilityMap(map)[i];
  const site = B.site ? siteMap(map, B.site)[i] : null;
  const be = buildingEff(B, de, fert, site ?? 1);
  const occ = state.prov.controller[i] !== state.prov.owner[i] ? 0 : 1;
  const tech = techOutput(state.countries[state.prov.owner[i]], b);
  return { labour: lab.factor, dev: de, infra: ie, fert, site, building: be, tech, occupied: !occ, total: lab.factor * ie * be * tech * occ };
}

// ---------------------------------------------------------------------------------------------
// state setup

export function newCountryEcon(G, tariff) {
  const f32 = () => new Float32Array(G);
  return {
    stock: new Float32Array(G), // the only per-good array the next month depends on
    prod: f32(), need: f32(), imp: f32(), exp: f32(), sat: f32(), inSat: f32(), // this month, for reports
    buildUse: new Float32Array(G), // goods recently taken by construction (smoothed), added to need
    tariff, embargo: [], battleUse: 0,
    supplyMun: 1, supplyFuel: 1, gdpMult: 1, living: 1, foodSat: 1, unemployment: 0.05,
    cpi: 1, cpi0: 0, cpiHist: [], inflation: 0, va: 0, idle: 0, indUtil: 1,
    tariffRev: 0, impValue: 0, expValue: 0, partnerShare: 0, hist: { gdp: [], treasury: [], cpi: [] },
  };
}

const GOV_TARIFF = { one_party: 0.12, military: 0.12, theocracy: 0.1, abs_monarchy: 0.08 };

// Creates state.econ from the scenario's economy section (or empty industry if it has none),
// then runs one calibration month so the starting GDP of every province equals the scenario's.
export function initEconomy(state, map, rules, scenario) {
  const X = rules.econ, I = rules.balance.industry, N = map.count;
  const ec = state.econ = {
    bld: new Uint8Array(N * X.B), dep: new Uint8Array(N * X.R),
    sf: new Float32Array(N).fill(1), va: new Float32Array(N), iw: new Float32Array(N),
    prices: Float64Array.from(X.goods, (g) => g.price), ratio0: new Float64Array(X.G),
    resources: [...X.resources], buildingCount: X.B, // for map modes and save checks
    goodIds: X.goods.map((g) => g.id), buildingIds: X.buildings.map((b) => b.id), // for remapping saves
  };
  const S = scenario.economy || {};
  for (const [id, rec] of Object.entries(S.buildings || {})) {
    const i = +id;
    if (!map.exists[i]) continue;
    for (const [b, L] of Object.entries(rec)) if (b in X.bi) ec.bld[i * X.B + X.bi[b]] = Math.min(X.buildings[X.bi[b]].maxLevel, L);
  }
  for (const [id, rec] of Object.entries(S.deposits || {})) {
    const i = +id;
    if (!map.exists[i]) continue;
    for (const [r, L] of Object.entries(rec)) { const k = X.resources.indexOf(r); if (k >= 0) ec.dep[i * X.R + k] = Math.min(255, L); }
  }
  for (const c of state.countries) c.econ = newCountryEcon(X.G, GOV_TARIFF[c.gov] ?? I.defaultTariff);
  state.construction = state.construction || [];
  // start with stockpiles at target so month one is not an artificial shortage
  const { pot } = potentials(state, map, rules);
  for (const c of state.countries) {
    const need = countryNeeds(state, rules, c, pot);
    for (let g = 0; g < X.G; g++) c.econ.stock[g] = need[g] * (1 + X.goods[g].stockMonths);
  }
  industryMonth(state, map, rules, { calibrate: true });
  // calibration: services factor so province GDP matches the scenario at the start
  const E = rules.balance.economy;
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) continue;
    const base = (state.prov.pop[i] * E.devBase * Math.pow(E.devGrowth, state.prov.dev[i])) / 1e9;
    if (base <= 0) continue;
    const services = base * (1 - ec.iw[i]) * state.countries[o].econ.gdpMult;
    ec.sf[i] = Math.max(0.05, (base - ec.va[i] * 12) / Math.max(1e-9, services));
  }
  for (const c of state.countries) {
    const e = c.econ;
    e.cpi = 1; e.cpiHist = [1]; e.inflation = 0; e.hist = { gdp: [], treasury: [], cpi: [] };
  }
}

// ---------------------------------------------------------------------------------------------
// demand

// Population demand per good this month (units).
export function popDemand(rules, c, out) {
  const X = rules.econ, E = rules.balance.economy;
  const pm = (c.cache?.pop || 0) / 1e6;
  const rel = Math.pow(E.devGrowth, (c.cache?.avgDev ?? E.refDev) - E.refDev);
  const av = c.tfx?.goods;
  for (const g of X.goods) out[g.i] = g.demand > 0 && (!av || av[g.i]) ? pm * g.demand * Math.pow(rel, g.incomeExp) : 0;
  return out;
}

// Army demand per good this month: munitions for every unit that uses them (weighted by the
// unit's "munitions" factor) plus battle use, fuel for units with a "fuel" factor (armour).
// counts = optional precomputed { mun, fuel } arrays per country (see armyCounts).
export function milDemand(state, rules, c, out, counts = null) {
  const X = rules.econ, I = rules.balance.industry;
  out.fill(0);
  let mun = 0, fuel = 0;
  if (counts) { mun = counts.mun[c.idx]; fuel = counts.fuel[c.idx]; }
  else { const all = armyCounts(state, rules); mun = all.mun[c.idx]; fuel = all.fuel[c.idx]; }
  const av = c.tfx?.goods;
  if ('munitions' in X.gi && (!av || av[X.gi.munitions])) out[X.gi.munitions] = mun * I.munitionsPerUnitMonth + (c.econ?.battleUse || 0);
  if ('fuel' in X.gi && (!av || av[X.gi.fuel])) out[X.gi.fuel] = fuel * I.fuelPerArmorMonth;
  return out;
}

export function armyCounts(state, rules) {
  const C = state.countries.length, mun = new Float64Array(C), fuel = new Float64Array(C);
  // armies, fleets and air wings
  for (const list of [state.armies, state.fleets || [], state.wings || []]) for (const a of list) for (const t in a.units) { const u = rules.units[t]; mun[a.owner] += a.units[t] * (u.munitions ?? 1); fuel[a.owner] += a.units[t] * (u.fuel ?? 0); }
  return { mun, fuel };
}

// Inputs building b needs in country c (technology may waive some) and its output multiplier.
export function buildingInputs(rules, c, b) {
  return c?.tfx ? c.tfx.inp[b] : rules.econ.buildings[b].inp;
}
export function techOutput(c, b) {
  return c?.tfx ? c.tfx.bm[b] : 1;
}

// National output potential per building type (units of "level × efficiency") and the
// per-province base efficiency. Also stores the industrial share of each labour force.
function potentials(state, map, rules) {
  const X = rules.econ, I = rules.balance.industry, ec = state.econ, P = state.prov;
  const C = state.countries.length, B = X.B;
  const pot = new Float64Array(C * B);
  const base = new Float64Array(map.count);
  const fert = fertilityMap(map);
  // nuclear winter cuts farm output everywhere; fallout stops a province's farms; orbital stations
  // and asteroid mining raise output, network disruption cuts it (see docs/STRATEGIC.md)
  const W = state.strategic, farmMult = W?.farmMult ?? 1, fallout = W?.fallout || {};
  const indM = state.countries.map((c) => (c.strat ? (1 + 0.03 * c.strat.stations) * (c.strat.disrupted > 0 ? 0.9 : 1) : 1));
  const minM = state.countries.map((c) => (c.strat?.asteroid ? 1 + 0.05 * c.strat.stations : 1));
  for (const i of map.ids) {
    const o = P.owner[i];
    if (o < 0) { ec.iw[i] = 0; continue; }
    const off = i * B;
    let need = 0;
    for (let b = 0; b < B; b++) { const L = ec.bld[off + b]; if (L) need += L * X.buildings[b].workers; }
    if (!need) { ec.iw[i] = 0; continue; }
    const avail = P.pop[i] * I.industrialLaborShare;
    const lab = Math.min(1, avail / need);
    const lf = P.pop[i] * I.laborShare;
    ec.iw[i] = lf > 0 ? Math.min(need, avail) / lf : 0;
    if (P.controller[i] !== o) continue; // occupied: workers idle, nothing produced
    const bs = lab * infraEff(P.infra[i], rules);
    base[i] = bs;
    const de = devEff(P.dev[i], rules);
    const tc = state.countries[o];
    for (let b = 0; b < B; b++) {
      const L = ec.bld[off + b];
      if (!L) continue;
      const Bd = X.buildings[b];
      const m = Bd.fertility ? (fallout[i] ? 0 : farmMult) : Bd.dep >= 0 ? minM[o] : indM[o];
      pot[o * B + b] += L * bs * buildingEff(Bd, de, fert[i], Bd.site ? siteMap(map, Bd.site)[i] : 1) * techOutput(tc, b) * m;
    }
  }
  return { pot, base };
}

function countryNeeds(state, rules, c, pot) {
  const X = rules.econ;
  const need = new Float64Array(X.G), tmp = new Float64Array(X.G);
  popDemand(rules, c, tmp); for (let g = 0; g < X.G; g++) need[g] += tmp[g];
  milDemand(state, rules, c, tmp); for (let g = 0; g < X.G; g++) need[g] += tmp[g];
  for (const b of X.buildings) {
    const p = pot[c.idx * X.B + b.i];
    if (p) for (const [g, a] of buildingInputs(rules, c, b.i)) need[g] += p * a;
  }
  return need;
}

// ---------------------------------------------------------------------------------------------
// monthly step

export function canTrade(state, a, b) {
  if (a === b) return false;
  if (state.countries[a].econ.embargo.includes(b) || state.countries[b].econ.embargo.includes(a)) return false;
  return !atWar(state, a, b);
}

export function industryMonth(state, map, rules, opts = {}) {
  const X = rules.econ, I = rules.balance.industry, ec = state.econ;
  const G = X.G, B = X.B, C = state.countries.length;
  const prices = ec.prices;
  const alive = state.countries.filter((c) => c.alive && c.cache && c.cache.provinces > 0);
  const { pot, base } = potentials(state, map, rules);
  const fac = new Float64Array(C * B).fill(1);
  const popD = new Float64Array(C * G), milD = new Float64Array(C * G);
  const tmp = new Float64Array(G);
  const counts = armyCounts(state, rules);

  // 1. production
  for (const c of alive) {
    const e = c.econ, st = e.stock, k = c.idx;
    e.prod.fill(0); e.need.fill(0); e.imp.fill(0); e.exp.fill(0);
    const indNeed = new Float64Array(G), indGot = new Float64Array(G);
    // a short input is shared by every building still to run in proportion to its need, so the
    // first in line (power plants) cannot take all the coal and leave the steel mills none
    const rem = new Float64Array(G), inps = new Array(B);
    for (const b of X.order) {
      const p = pot[k * B + b.i];
      if (!p) continue;
      inps[b.i] = buildingInputs(rules, c, b.i);
      for (const [g, a] of inps[b.i]) rem[g] += p * a;
    }
    for (const b of X.order) {
      const p = pot[k * B + b.i];
      if (!p) continue;
      let f = 1;
      const inp = inps[b.i];
      for (const [g, a] of inp) {
        const req = p * a;
        indNeed[g] += req;
        if (req > 0) f = Math.min(f, st[g] / rem[g]);
        rem[g] -= req;
      }
      f = Math.max(0, f);
      fac[k * B + b.i] = f;
      for (const [g, a] of inp) { st[g] = Math.max(0, st[g] - p * a * f); indGot[g] += p * a * f; }
      for (const [g, a] of b.out) { const v = p * a * f; st[g] += v; e.prod[g] += v; }
    }
    for (let g = 0; g < G; g++) e.inSat[g] = indNeed[g] > 0 ? indGot[g] / indNeed[g] : 1;
    popDemand(rules, c, tmp); popD.set(tmp, k * G);
    milDemand(state, rules, c, tmp, counts); milD.set(tmp, k * G);
    for (let g = 0; g < G; g++) { e.need[g] = popD[k * G + g] + milD[k * G + g] + indNeed[g] + e.buildUse[g]; e.buildUse[g] *= 0.5; }
    e.battleUse = 0;
    e.tariffRev = 0; e.impValue = 0; e.expValue = 0;
  }

  // 2. world market. Every exporter x offers the share r[x] = surplus / (deficits it can reach)
  // to each importer it can reach; an importer offered more than it needs scales all offers by
  // s[y]. Flows are q(x→y) = r[x]·def[y]·s[y] for open routes, so totals are computed in
  // O(exporters + importers + closed routes) instead of looping over every pair.
  const closedAll = closedRoutes(state, C);
  const closedByGood = sanctionRoutes(state, rules, closedAll, C);
  const flows = { day: state.day, C, G, passes: [] }; // kept (unsaved) for trade-partner reports
  const sur = new Float64Array(C), def = new Float64Array(C), cut = new Float64Array(C);
  const ex = new Int32Array(C), im = new Int32Array(C);
  // trade agreements and economic blocs: no tariff on goods from partners. The demand cut uses
  // the tariff on last month's non-partner share of imports; revenue counts only non-partner flows.
  const links = tradeLinks(state);
  const effTariff = new Float64Array(C), partnerImp = new Float64Array(C);
  // blockades and commerce raiding cut a coastal country's trade (c.econ.tradeFactor, naval.js)
  const tf = new Float64Array(C).fill(1);
  for (const c of alive) { tf[c.idx] = c.econ.tradeFactor ?? 1; effTariff[c.idx] = c.econ.tariff * (1 - (c.econ.partnerShare || 0)); cut[c.idx] = (1 - I.tariffImportCut * effTariff[c.idx]) * tf[c.idx]; }
  for (let g = 0; g < G; g++) {
    const sm = X.goods[g].stockMonths;
    const closed = closedByGood?.[g] || closedAll;
    let ne = 0, ni = 0;
    for (const c of alive) {
      const e = c.econ, k = c.idx;
      const target = popD[k * G + g] + milD[k * G + g] + e.need[g] * sm;
      const st = e.stock[g];
      sur[k] = 0; def[k] = 0;
      if (st > target * 1.02 + 1e-6) { sur[k] = (st - target) * tf[k]; ex[ne++] = k; }
      else if (st < target) { def[k] = (target - st) * cut[k]; if (def[k] > 1e-6) im[ni++] = k; else def[k] = 0; }
    }
    if (!ne || !ni) continue;
    const price = prices[g];
    for (let pass = 0; pass < 2; pass++) {
      const r = new Float64Array(C), w = new Float64Array(C);
      let totDef = 0, R = 0, W = 0;
      for (let b = 0; b < ni; b++) totDef += def[im[b]];
      for (let a = 0; a < ne; a++) {
        const x = ex[a];
        if (sur[x] <= 1e-9) continue;
        let T = totDef;
        const cl = closed[x];
        if (cl) for (const y of cl) T -= def[y];
        if (T > 1e-9) { r[x] = Math.min(1, sur[x] / T); R += r[x]; }
      }
      if (R <= 0) break;
      for (let b = 0; b < ni; b++) {
        const y = im[b];
        let Ry = R;
        const cl = closed[y];
        if (cl) for (const x of cl) Ry -= r[x];
        if (Ry > 1e-12) { w[y] = def[y] * Math.min(1, 1 / Ry); W += w[y]; }
      }
      let moved = 0;
      for (let a = 0; a < ne; a++) {
        const x = ex[a];
        if (!r[x]) continue;
        let Wx = W;
        const cl = closed[x];
        if (cl) for (const y of cl) Wx -= w[y];
        const out = r[x] * Wx;
        if (out <= 0) continue;
        const XE = state.countries[x].econ;
        XE.stock[g] = Math.max(0, XE.stock[g] - out); XE.exp[g] += out; XE.expValue += out * price; sur[x] -= out;
        moved += out;
      }
      for (let b = 0; b < ni; b++) {
        const y = im[b];
        if (!w[y]) continue;
        let Ry = R;
        const cl = closed[y];
        if (cl) for (const x of cl) Ry -= r[x];
        const q = w[y] * Ry;
        if (q <= 0) continue;
        const YE = state.countries[y].econ, v = q * price;
        let vp = 0;
        const ln = links[y];
        if (ln) {
          let Rp = 0;
          for (const x of ln) if (r[x] && !(cl && cl.includes(x))) Rp += r[x];
          vp = Math.min(v, w[y] * Rp * price);
          partnerImp[y] += vp;
        }
        YE.stock[g] += q; YE.imp[g] += q; YE.impValue += v; YE.tariffRev += (v - vp) * YE.tariff;
      }
      flows.passes.push({ g, price, r, w });
      if (moved <= 1e-9) break;
      for (let b = 0; b < ni; b++) {
        const y = im[b], e = state.countries[y].econ;
        const target = popD[y * G + g] + milD[y * G + g] + e.need[g] * sm;
        def[y] = Math.max(0, (target - e.stock[g]) * cut[y]);
      }
    }
  }
  flows.closed = closedAll;
  flowCache.set(state, flows);

  // 3. consumption, 4. national effects
  const iFood = X.gi.food, iEnergy = X.gi.energy, iFuel = X.gi.fuel, iMun = X.gi.munitions;
  for (const c of alive) {
    const e = c.econ, k = c.idx, st = e.stock;
    let livW = 0, livS = 0, cpiW = 0, cpiP = 0;
    for (let g = 0; g < G; g++) {
      const m = milD[k * G + g], p = popD[k * G + g];
      const gm = Math.min(st[g], m); st[g] -= gm;
      const gp = Math.min(st[g], p); st[g] -= gp;
      e.sat[g] = m + p > 0 ? (gm + gp) / (m + p) : 1;
      if (g === iMun) e.supplyMun = m > 0 ? gm / m : 1;
      if (g === iFuel) e.supplyFuel = m > 0 ? gm / m : 1;
      if (g === iFood) e.foodSat = p > 0 ? gp / p : 1;
      const sp = p > 0 ? gp / p : 1;
      const w = p * X.goods[g].price;
      if (g !== iFood) { livW += w; livS += w * sp; }
      if (w > 0) {
        const impShare = e.need[g] > 0 ? Math.min(1, e.imp[g] / e.need[g]) : 0;
        cpiW += w;
        cpiP += w * (prices[g] / X.goods[g].price) * (1 + effTariff[k] * impShare) * (1 + 0.6 * (1 - sp));
      }
      st[g] = Math.min(st[g], Math.max(e.need[g], e.prod[g]) * I.stockCapMonths);
    }
    e.living = livW > 0 ? livS / livW : 1;
    e.partnerShare = e.impValue > 0 ? Math.round((partnerImp[k] / e.impValue) * 1000) / 1000 : 0;
    const sE = iEnergy != null ? e.sat[iEnergy] : 1, sF = iFuel != null ? e.sat[iFuel] : 1;
    e.gdpMult = (0.55 + 0.45 * sE) * (0.9 + 0.1 * sF);
    const raw = cpiW > 0 ? cpiP / cpiW : 1;
    if (opts.calibrate || !e.cpi0) e.cpi0 = raw;
    e.cpi = Math.round((e.cpi + (raw / e.cpi0 - e.cpi) * 0.5) * 1e5) / 1e5; // rounded: short and exact in saves
    e.cpiHist.push(e.cpi);
    if (e.cpiHist.length > 13) e.cpiHist.shift();
    const first = e.cpiHist[0], n = e.cpiHist.length - 1;
    e.inflation = n > 0 ? Math.round((Math.pow(e.cpi / first, 12 / n) - 1) * 1e5) / 1e5 : 0;
  }

  // per-province value added (at world prices), idle workforce, unemployment
  // net value of one unit of output, per country (waived inputs cost nothing)
  const net = new Float64Array(C * B);
  for (const c of alive) for (const b of X.buildings) {
    let v = 0;
    for (const [g, a] of b.out) v += a * prices[g];
    for (const [g, a] of buildingInputs(rules, c, b.i)) v -= a * prices[g];
    net[c.idx * B + b.i] = v;
  }
  const vaC = new Float64Array(C), idle = new Float64Array(C), jobs = new Float64Array(C), potV = new Float64Array(C);
  const fert = fertilityMap(map);
  const bmC = state.countries.map((c) => c.tfx?.bm || null);
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) continue;
    let va = 0;
    const off = i * B;
    if (base[i] > 0) {
      const de = devEff(state.prov.dev[i], rules);
      for (let b = 0; b < B; b++) {
        const L = ec.bld[off + b];
        if (!L) continue;
        const Bd = X.buildings[b];
        const p = L * base[i] * buildingEff(Bd, de, fert[i], Bd.site ? siteMap(map, Bd.site)[i] : 1) * (bmC[o] ? bmC[o][b] : 1);
        const f = fac[o * B + b];
        va += p * f * net[o * B + b];
        potV[o] += p * Math.max(0, net[o * B + b]);
        const w = L * Bd.workers * Math.min(1, base[i] / infraEff(state.prov.infra[i], rules));
        jobs[o] += w;
        idle[o] += w * (1 - f);
      }
    } else if (ec.iw[i] > 0) {
      idle[o] += ec.iw[i] * state.prov.pop[i] * I.laborShare; // occupied: whole workforce idle
    }
    ec.va[i] = Math.max(0, va);
    vaC[o] += ec.va[i];
  }
  for (const c of alive) {
    const e = c.econ, k = c.idx;
    const lf = c.cache.pop * I.laborShare;
    e.va = vaC[k];
    e.idle = idle[k];
    e.indUtil = potV[k] > 0 ? vaC[k] / potV[k] : 1;
    const sE = iEnergy != null ? e.sat[iEnergy] : 1;
    e.unemployment = Math.max(0.02, Math.min(0.6, 0.04 + (lf > 0 ? idle[k] / lf : 0) + 0.12 * (1 - sE) + 0.04 * (1 - e.living)));
  }

  // world prices follow world need vs world production (and stocks), relative to the start
  for (let g = 0; g < G; g++) {
    let need = 0, prod = 0, stock = 0;
    for (const c of alive) { need += c.econ.need[g]; prod += c.econ.prod[g]; stock += c.econ.stock[g]; }
    const r = need > 0 ? need / Math.max(1e-6, prod + 0.1 * stock) : 0;
    if (opts.calibrate || !ec.ratio0[g]) { ec.ratio0[g] = r || 1; continue; }
    const base0 = X.goods[g].price;
    // no need at all: the floor price if some is made, the base price for a good not traded yet
    const target = r > 0 ? base0 * Math.pow(r / ec.ratio0[g], I.priceElasticity) : base0 * (prod + stock > 0 ? I.priceMin : 1);
    const clamped = Math.max(base0 * I.priceMin, Math.min(base0 * I.priceMax, target));
    prices[g] += (clamped - prices[g]) * I.priceSmoothing;
  }
}

// Per good, the closed routes plus arms and energy sanctions (council or unilateral; full council
// sanctions close every good); null when there are no sanctions.
function sanctionRoutes(state, rules, base, C) {
  const pairs = sanctionPairs(state);
  if (!pairs.length) return null;
  const out = new Array(rules.econ.G).fill(null);
  for (const [a, b, level] of pairs) {
    if (a === b || a >= C || b >= C) continue;
    const goods = level === 'full' ? rules.econ.goods.map((x) => x.i) : sanctionGoods(rules, level);
    for (const g of goods) {
      const cl = (out[g] ||= base.map((x) => (x ? x.slice() : null)));
      (cl[a] ||= []).includes(b) || cl[a].push(b);
      (cl[b] ||= []).includes(a) || cl[b].push(a);
    }
  }
  return out;
}

// Closed trade routes (war or embargo) as sparse per-country lists; null when none.
function closedRoutes(state, C) {
  const closed = new Array(C).fill(null);
  const add = (a, b) => { (closed[a] ||= []).includes(b) || closed[a].push(b); };
  for (const c of state.countries) for (const t of c.econ.embargo) if (t >= 0 && t < C && t !== c.idx) { add(c.idx, t); add(t, c.idx); }
  for (const w of state.wars) for (const a of w.attackers) for (const d of w.defenders) { add(a, d); add(d, a); }
  return closed;
}

const flowCache = new WeakMap();

// Trade partners of country k in the last monthly market, by value (B/month), largest first.
// Derived from the market's flow factors, which are not saved: returns null until the first
// market after a load.
export function tradePartners(state, k, n = 6) {
  const f = flowCache.get(state);
  if (!f) return null;
  const memo = (f.memo ||= new Map());
  const hit = memo.get(k * 100 + n);
  if (hit) return hit;
  const C = f.C, val = new Float64Array(C);
  const cl = new Set(f.closed[k] || []);
  for (const { price, r, w } of f.passes) {
    if (r[k]) for (let y = 0; y < C; y++) if (w[y] && !cl.has(y)) val[y] += r[k] * w[y] * price;
    if (w[k]) for (let x = 0; x < C; x++) if (r[x] && !cl.has(x)) val[x] += r[x] * w[k] * price;
  }
  const out = [];
  for (let j = 0; j < C; j++) if (val[j] > 0) out.push([j, val[j]]);
  const res = out.sort((a, b) => b[1] - a[1]).slice(0, n);
  memo.set(k * 100 + n, res);
  return res;
}

// Monthly history for charts (display only; rounded to keep saves small).
export function recordHistory(state) {
  const r = (x) => +x.toPrecision(4);
  for (const c of state.countries) {
    if (!c.alive || !c.econ || !c.cache) continue;
    const h = c.econ.hist;
    h.gdp.push(r(c.cache.gdp)); h.treasury.push(r(c.treasury)); h.cpi.push(r(c.econ.cpi));
    for (const k in h) if (h[k].length > 24) h[k].shift();
  }
}

// ---------------------------------------------------------------------------------------------
// construction

export function constructionSlots(state, rules, country) {
  const I = rules.balance.industry, c = state.countries[country];
  return Math.min(I.maxConstructionSlots, I.baseConstructionSlots + Math.floor(((c.cache?.gdp || 0) / 1000) * I.slotsPerTrillionGdp));
}

function queued(state, prov, kind, b) {
  let n = 0;
  for (const p of state.construction) if (p.prov === prov && p.kind === kind && (kind === 'infra' || p.b === b)) n++;
  return n;
}

// Money and goods a project needs; goods missing from the stockpile are bought at a premium.
export function projectCost(state, map, rules, country, prov, kind, b) {
  const X = rules.econ, I = rules.balance.industry, c = state.countries[country];
  const pl = c.cache.priceLevel * (c.govt?.fx?.construction ?? 1) * (c.tfx?.mult.construction ?? 1);
  let money, goods, days, name;
  if (kind === 'infra') {
    const lvl = state.prov.infra[prov] + queued(state, prov, 'infra');
    const size = 0.5 + Math.sqrt(map.area[prov]) / 300;
    money = I.infraCost * size * (1 + 0.25 * lvl) * pl;
    goods = 'steel' in X.gi ? [[X.gi.steel, I.infraSteel * size * (1 + 0.25 * lvl)]] : [];
    days = I.infraDays; name = 'Infrastructure';
  } else {
    const B = X.buildings[b];
    const lvl = state.econ.bld[prov * X.B + b] + queued(state, prov, 'building', b);
    money = B.cost * (1 + 0.04 * lvl) * pl;
    goods = B.goods.map(([g, a]) => [g, a]);
    days = B.days; name = B.name;
  }
  // goods a country has no technology for are not needed (older building methods)
  if (c.tfx) goods = goods.filter(([g]) => c.tfx.goods[g]);
  let premium = 0;
  const missing = [];
  for (const [g, a] of goods) {
    const have = c.econ.stock[g];
    if (have < a) { const m = a - have; premium += m * state.econ.prices[g] * I.missingGoodsPremium; missing.push([g, m]); }
  }
  return { money, goods, premium, missing, total: money + premium, days, name };
}

// Returns null if the project is allowed, else the reason.
export function canBuild(state, map, rules, country, prov, kind, b = -1) {
  const X = rules.econ, I = rules.balance.industry, P = state.prov;
  const c = state.countries[country];
  if (!c || !c.alive) return 'Country does not exist';
  if (!map.exists[prov]) return 'Invalid province';
  if (P.owner[prov] !== country) return 'You do not own this province';
  if (P.controller[prov] !== country) return 'The province is occupied';
  if (state.construction.filter((p) => p.owner === country).length >= I.maxQueue) return `Construction queue is full (${I.maxQueue})`;
  if (kind === 'infra') {
    if (P.infra[prov] + queued(state, prov, 'infra') >= I.maxInfra) return `Infrastructure is at the maximum (${I.maxInfra})`;
  } else if (kind === 'building') {
    const B = X.buildings[b];
    if (!B) return 'Unknown building';
    const lvl = state.econ.bld[prov * X.B + b] + queued(state, prov, 'building', b);
    if (lvl >= B.maxLevel) return `${B.name} is at the maximum level (${B.maxLevel})`;
    if (B.dep >= 0) {
      const d = state.econ.dep[prov * X.R + B.dep];
      if (!d) return `Needs a ${X.resources[B.dep].replace('_', ' ')} deposit`;
      if (lvl >= d) return `The ${X.resources[B.dep].replace('_', ' ')} deposit supports ${d} level(s)`;
    }
    if (B.minDev && P.dev[prov] < B.minDev) return `Needs development ${B.minDev} (province has ${P.dev[prov].toFixed(0)})`;
    if (c.tfx && !c.tfx.bld[b]) return `Needs the technology ${rules.tech.list[rules.tech.bldTech[b]].name}`;
  } else return 'Unknown project';
  const cost = projectCost(state, map, rules, country, prov, kind, b);
  if (c.treasury < cost.total) return `Costs ${cost.total.toFixed(1)}B; treasury has ${c.treasury.toFixed(1)}B`;
  return null;
}

export function startProject(state, map, rules, country, prov, kind, b = -1) {
  const why = canBuild(state, map, rules, country, prov, kind, b);
  if (why) return why;
  const c = state.countries[country];
  const cost = projectCost(state, map, rules, country, prov, kind, b);
  c.treasury -= cost.total;
  for (const [g, a] of cost.goods) { c.econ.stock[g] = Math.max(0, c.econ.stock[g] - a); c.econ.buildUse[g] += a / 2; }
  c.econ.spentConstruction = (c.econ.spentConstruction || 0) + cost.total;
  state.construction.push({ id: state.nextId++, owner: country, prov, kind, b, left: cost.days, days: cost.days, paid: cost.total });
  return null;
}

export function cancelProject(state, rules, id) {
  const k = state.construction.findIndex((p) => p.id === id);
  if (k < 0) return 'No such project';
  const p = state.construction[k];
  state.countries[p.owner].treasury += p.paid * rules.balance.industry.cancelRefund;
  state.construction.splice(k, 1);
  return null;
}

// Daily: the first N projects of each country advance, where N is its construction slots.
// Projects in occupied provinces are paused; projects in lost provinces are cancelled.
export function processConstruction(state, map, rules) {
  if (!state.construction.length) return;
  const X = rules.econ;
  const used = new Map();
  const done = [];
  state.construction = state.construction.filter((p) => state.prov.owner[p.prov] === p.owner && state.countries[p.owner].alive);
  for (const p of state.construction) {
    const n = used.get(p.owner) || 0;
    if (n >= constructionSlots(state, rules, p.owner)) continue;
    used.set(p.owner, n + 1);
    if (state.prov.controller[p.prov] !== p.owner) continue;
    if (--p.left <= 0) done.push(p);
  }
  for (const p of done) {
    if (p.kind === 'infra') state.prov.infra[p.prov] = Math.min(rules.balance.industry.maxInfra, state.prov.infra[p.prov] + 1);
    else state.econ.bld[p.prov * X.B + p.b] = Math.min(X.buildings[p.b].maxLevel, state.econ.bld[p.prov * X.B + p.b] + 1);
    if (p.owner === state.player) {
      const what = p.kind === 'infra' ? `Infrastructure level ${state.prov.infra[p.prov]}` : `${X.buildings[p.b].name} level ${state.econ.bld[p.prov * X.B + p.b]}`;
      log(state, 'economy', `${what} completed in ${map.name[p.prov]}.`, { prov: p.prov });
    }
  }
  if (done.length) state.construction = state.construction.filter((p) => !done.includes(p));
}

// Ownership change: buildings stay with the province (they are captured), deposits too.
// Nothing to do here; the hook exists for clarity and future damage rules.

export function toggleEmbargo(state, country, target) {
  const e = state.countries[country].econ;
  const k = e.embargo.indexOf(target);
  if (k >= 0) e.embargo.splice(k, 1);
  else if (target !== country && state.countries[target]) e.embargo.push(target);
  return k < 0;
}
