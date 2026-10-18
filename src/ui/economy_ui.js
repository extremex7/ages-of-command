// Economy, industry and trade panels, plus the province's industry section. Every figure is
// read from the simulation; tooltips spell out how it was calculated.
import { h } from './dom.js';
import { flagCanvas } from './flags.js';
import { money, signedMoney, people, pct } from './format.js';
import { computeLedgers } from '../core/economy.js';
import { provinceGdp, provinceGdpParts } from '../core/state.js';
import {
  popDemand, milDemand, constructionSlots, canBuild, startProject, cancelProject, projectCost,
  efficiencyBreakdown, provinceLabour, toggleEmbargo, tradePartners, fertilityMap,
} from '../core/industry.js';

function bar(v, color = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: color } }));
}
const num = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const signed = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x));
const satClass = (s) => (s < 0.75 ? 'bad' : s < 0.95 ? 'warn' : '');

// Small line chart drawn once per panel render (no animation, no timers).
export function sparkline(values, { w = 290, h: hh = 46, color = '#d8b860', label = '', fmt = (v) => v.toFixed(1) } = {}) {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr; c.height = hh * dpr; c.style.width = w + 'px'; c.style.height = hh + 'px';
  c.className = 'spark';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#a3a9b2'; g.font = '10px system-ui, sans-serif';
  if (!values || values.length < 2) { g.fillText(`${label}: history builds up month by month`, 2, hh / 2); return c; }
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < Math.abs(hi) * 0.02) { hi += Math.abs(hi) * 0.01 + 1e-9; lo -= Math.abs(lo) * 0.01 + 1e-9; }
  const x = (i) => 2 + (i / (values.length - 1)) * (w - 4);
  const y = (v) => 14 + (1 - (v - lo) / (hi - lo)) * (hh - 18);
  g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
  values.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.stroke();
  g.fillText(`${label}: ${fmt(values[values.length - 1])}  (range ${fmt(lo)} – ${fmt(hi)}, ${values.length} months)`, 2, 10);
  return c;
}

function refresh(cl) { computeLedgers(cl.state, cl.game.map, cl.game.rules); cl.uiDirty = true; cl.requestFrame(); }

// ---------------------------------------------------------------------------------------------
// Economy tab: budget, policy, indicators, stability factors, history

export function economyTab(cl) {
  const s = cl.state, me = s.player;
  if (me < 0) return h('p.muted', 'Observer mode: choose a country to manage its economy.');
  const c = s.countries[me], L = c.ledger, R = cl.game.rules, E = R.balance.economy, I = R.balance.industry, e = c.econ;
  const map = cl.game.map;
  const slider = (min, max, val, fn) => h('input', { type: 'range', min, max, value: val, style: { width: '100%' }, on: { input: (ev) => { fn(+ev.target.value / 100); refresh(cl); } } });
  let vaYear = e.va * 12, gdp = c.cache.gdp;
  const hist = e.hist;
  const g12 = hist.gdp.length >= 13 ? hist.gdp[hist.gdp.length - 1] / hist.gdp[hist.gdp.length - 13] - 1 : null;
  const sp = e.stabilityParts || {};
  return h('div',
    h('h3', 'Indicators'),
    h('div.kv',
      h('span', { tip: 'Services (population × productivity from development, minus workers employed in industry, scaled by energy and fuel supply) plus industrial value added (output minus inputs at world prices).' }, 'GDP (annual)'), h('span', money(gdp)),
      h('span', { tip: 'Value added by farms, mines, power plants and factories, at world prices.' }, '  of which industry'), h('span', `${money(vaYear)} (${pct(vaYear / Math.max(1e-9, gdp))})`),
      h('span', { tip: 'Change of GDP over the last 12 months.' }, 'Growth (12 months)'), h('span', { className: g12 == null ? 'muted' : g12 < 0 ? 'bad' : 'good' }, g12 == null ? 'after one year' : pct(g12, 1)),
      h('span', { tip: `4% base + workers idled by missing inputs or occupation (${people(e.idle)}) + 12% × energy shortage + 4% × consumer shortage.` }, 'Unemployment'), h('span', { className: e.unemployment > 0.08 ? 'bad' : '' }, pct(e.unemployment, 1)),
      h('span', { tip: 'Consumer price index (start = 1.00): world prices of what your people buy, plus your tariff on the imported part, plus scarcity premiums when goods are short. Raises the cost of units and construction.' }, 'Prices (CPI)'), h('span', e.cpi.toFixed(3)),
      h('span', { tip: 'CPI change over up to the last 12 months, annualised.' }, 'Inflation'), h('span', { className: e.inflation > 0.05 ? 'bad' : '' }, pct(e.inflation, 1)),
      h('span', { tip: 'Share of food demand met this month. Below 100% stability falls, and below 50% the population shrinks.' }, 'Food supply'), h('span', { className: satClass(e.foodSat) }, pct(e.foodSat)),
      h('span', { tip: 'Share of non-food consumer demand met (energy, fuel, consumer goods, electronics…), weighted by value. Drives development growth and stability.' }, 'Living standard'), h('span', { className: satClass(e.living) }, pct(e.living)),
      h('span', { tip: 'Share of your armies\' munitions needs met. Shortages cut combat damage by up to 40%; fuel shortages slow and weaken armour.' }, 'Army supply'), h('span', { className: satClass(Math.min(e.supplyMun, e.supplyFuel)) }, `munitions ${pct(e.supplyMun)}, fuel ${pct(e.supplyFuel)}`),
      h('span', { tip: 'Energy and fuel supply scale services output: (0.55 + 0.45 × energy) × (0.9 + 0.1 × fuel).' }, 'Supply effect on GDP'), h('span', { className: e.gdpMult < 0.98 ? 'bad' : '' }, '×' + e.gdpMult.toFixed(2))),
    h('h3', { style: { marginTop: '0.8em' } }, 'Monthly budget'),
    L ? h('table.t',
      h('tr', h('td', { tip: 'Sum of provincial GDP this month.' }, 'GDP this month'), h('td.n', money(L.gdpMonth))),
      L.gdpLost > 0 && h('tr', h('td.muted', 'of which occupied (untaxable)'), h('td.n.bad', money(L.gdpLost))),
      h('tr', h('td', { tip: 'Taxable GDP × tax rate × efficiency. Efficiency falls with low stability.' }, `Tax revenue (eff. ${pct(L.efficiency)})`), h('td.n.good', money(L.taxRevenue))),
      L.tariffs > 0 && h('tr', h('td', { tip: `Your tariff (${pct(e.tariff)}) × value of this month's imports (${money(e.impValue)}).` }, 'Tariffs'), h('td.n.good', money(L.tariffs))),
      L.requisition > 0 && h('tr', h('td', 'Requisitions (occupied land)'), h('td.n.good', money(L.requisition))),
      h('tr', h('td', { tip: 'Administration, services, education, welfare. Higher spending raises stability and development growth.' }, 'Civil spending'), h('td.n.bad', '−' + money(L.civil))),
      h('tr', h('td', { tip: 'Upkeep of every unit (half for units in training), scaled by your price level (development and CPI).' }, `Military upkeep (price level ${c.cache.priceLevel.toFixed(2)})`), h('td.n.bad', '−' + money(L.military))),
      L.interest > 0 && h('tr', h('td', { tip: `${pct(E.debtInterestYear)} per year on negative treasury.` }, 'Debt interest'), h('td.n.bad', '−' + money(L.interest))),
      h('tr', h('th', 'Net'), h('th.n', { className: L.net < 0 ? 'bad' : 'good' }, signedMoney(L.net))),
      L.construction > 0 && h('tr', h('td.muted', { tip: 'Paid up front from the treasury when projects start; not part of the monthly net.' }, 'Construction started this month'), h('td.n.muted', money(L.construction)))) : h('p.muted', 'No budget yet.'),
    h('h4', `Tax rate: ${pct(c.tax)}`), slider(E.minTax * 100, E.maxTax * 100, Math.round(c.tax * 100), (v) => { c.tax = v; }),
    h('p.muted', `Above 30% stability drifts down.`),
    h('h4', `Civil spending: ${pct(c.civilShare)} of tax revenue`), slider(50, 95, Math.round(c.civilShare * 100), (v) => { c.civilShare = v; }),
    h('p.muted', 'The rest funds the military. Below 70% stability erodes; development grows faster with more.'),
    h('h4', { tip: 'Charged on the value of imports. Raises revenue and consumer prices, and cuts import demand by half the rate.' }, `Import tariff: ${pct(c.econ.tariff)}`), slider(0, 50, Math.round(e.tariff * 100), (v) => { e.tariff = v; }),
    h('h4', 'Stability drivers this month'),
    h('div.kv',
      h('span', 'Stability'), h('span', String(Math.round(c.stability))),
      h('span', { tip: `−${I.foodShortageStability} × food shortage` }, 'Food'), h('span', { className: (sp.food || 0) < -0.5 ? 'bad' : 'muted' }, (sp.food || 0).toFixed(1)),
      h('span', { tip: `−${I.goodsShortageStability} × consumer-goods shortage` }, 'Living standard'), h('span', { className: (sp.goods || 0) < -0.5 ? 'bad' : 'muted' }, (sp.goods || 0).toFixed(1)),
      h('span', { tip: `−${I.unemploymentStability} per point of unemployment above 6%` }, 'Unemployment'), h('span', { className: (sp.jobs || 0) < -0.5 ? 'bad' : 'muted' }, (sp.jobs || 0).toFixed(1)),
      h('span', { tip: `−${I.inflationStability} per point of inflation above 5% (max −15)` }, 'Inflation'), h('span', { className: (sp.prices || 0) < -0.5 ? 'bad' : 'muted' }, (sp.prices || 0).toFixed(1))),
    h('p.muted', 'These shift the stability target; stability moves 8% of the way to its target each month.'),
    h('h4', 'History'),
    sparkline(hist.gdp, { label: 'GDP (B/yr)', fmt: (v) => money(v) }),
    sparkline(hist.treasury, { label: 'Treasury', color: '#79a7d9', fmt: (v) => money(v) }),
    sparkline(hist.cpi, { label: 'CPI', color: '#e0705f', fmt: (v) => v.toFixed(3) }),
    h('h4', 'Largest provincial economies'),
    h('table.t', map.ids.filter((i) => s.prov.owner[i] === me).sort((a, b) => provinceGdp(s, b, E) - provinceGdp(s, a, E)).slice(0, 6)
      .map((i) => h('tr.click', { on: { click: () => cl.focusProvince(i) } }, h('td', map.name[i]), h('td.n', money(provinceGdp(s, i, E)) + '/yr')))));
}

// ---------------------------------------------------------------------------------------------
// Industry tab: goods balance, construction queue, buildings, market

export function industryTab(cl) {
  const s = cl.state, R = cl.game.rules, X = R.econ, map = cl.game.map;
  const k = s.player >= 0 ? s.player : cl.view.selectedCountry;
  if (k < 0) return h('p.muted', 'Select a country.');
  const c = s.countries[k], e = c.econ, mine = k === s.player;
  const pd = popDemand(R, c, new Float64Array(X.G)), md = milDemand(s, R, c, new Float64Array(X.G));
  const rows = X.goods.map((g) => {
    const i = g.i, need = e.need[i], net = e.imp[i] - e.exp[i];
    const ind = Math.max(0, need - pd[i] - md[i] - e.buildUse[i]);
    const months = need > 0 ? e.stock[i] / need : 0;
    const pr = s.econ.prices[i] / g.price;
    const met = Math.min(pd[i] + md[i] > 0 ? e.sat[i] : 1, e.inSat[i]);
    const tip = `${g.name}\nProduced: ${num(e.prod[i])} units/month\nNeeded: ${num(need)} = population ${num(pd[i])} + armies ${num(md[i])} + industry ${num(ind)}${e.buildUse[i] > 0.01 ? ` + construction ${num(e.buildUse[i])}` : ''}\nImported ${num(e.imp[i])}, exported ${num(e.exp[i])}\nStockpile ${num(e.stock[i])} (${months.toFixed(1)} months; target ${g.stockMonths})\nNeeds met: ${pd[i] + md[i] > 0 ? `${pct(e.sat[i])} of population + army demand, ` : ''}${pct(e.inSat[i])} of industry inputs\nWorld price ${(s.econ.prices[i]).toFixed(3)}B/unit (base ${g.price}, ×${pr.toFixed(2)})`;
    return h('tr', { tip },
      h('td', g.name), h('td.n', num(e.prod[i])), h('td.n', num(need)),
      h('td.n', { className: net > 0.005 ? 'warn' : net < -0.005 ? 'good' : 'muted' }, Math.abs(net) < 0.005 ? '·' : signed(-net)),
      h('td.n', { className: satClass(met) }, need > 0 ? pct(met) : '–'),
      h('td.n', { className: pr > 1.15 ? 'bad' : pr < 0.87 ? 'good' : '' }, '×' + pr.toFixed(2)));
  });
  const queue = s.construction.filter((p) => p.owner === k);
  const slots = constructionSlots(s, R, k);
  const levels = X.buildings.map((b) => {
    let n = 0, prov = 0;
    for (const i of map.ids) if (s.prov.owner[i] === k) { const L = s.econ.bld[i * X.B + b.i]; if (L) { n += L; prov++; } }
    return { b, n, prov };
  }).filter((x) => x.n > 0);
  const partners = tradePartners(s, k);
  const C = s.countries;
  return h('div',
    h('h3', mine ? 'Goods' : `Goods: ${c.name}`),
    h('p.muted', 'Units per month. Net: + exports, − imports. Hover a row for the breakdown.'),
    h('table.t.small', h('tr', h('th', 'Good'), h('th.n', 'Made'), h('th.n', 'Need'), h('th.n', 'Net'), h('th.n', 'Met'), h('th.n', { tip: 'World price relative to the base price' }, 'Price')), rows),
    h('div.kv', { style: { marginTop: '0.5em' } },
      h('span', { tip: 'Value of industrial output relative to what the buildings could make with every input available.' }, 'Industry running at'), h('span', { className: satClass(e.indUtil) }, pct(e.indUtil)),
      h('span', 'Imports / exports this month'), h('span', `${money(e.impValue)} / ${money(e.expValue)}`)),
    h('h3', { style: { marginTop: '0.8em' } }, `Construction (${Math.min(queue.length, slots)}/${slots} active)`),
    h('p.muted', { tip: `${R.balance.industry.baseConstructionSlots} + ${R.balance.industry.slotsPerTrillionGdp} per trillion of GDP, max ${R.balance.industry.maxConstructionSlots}. Projects beyond that wait in the queue.` },
      mine ? 'Select one of your provinces on the map to build there.' : 'Projects of this country.'),
    queue.length ? queue.map((p, n) => h('div.army-card', { on: { click: () => cl.focusProvince(p.prov) } },
      h('div.row.spread', h('b', p.kind === 'infra' ? 'Infrastructure' : X.buildings[p.b].name), h('span.muted', map.name[p.prov])),
      h('div.row', { style: { gap: '0.4em' } }, h('div', { style: { flex: 1 } }, bar(1 - p.left / p.days, n < slots ? '' : 'var(--line)')),
        h('span.muted', n < slots ? `${p.left}d left` : 'queued'),
        mine && h('button', { tip: `Cancel: refunds ${pct(R.balance.industry.cancelRefund)} of ${money(p.paid)}`, on: { click: (ev) => { ev.stopPropagation(); cancelProject(s, R, p.id); refresh(cl); } } }, '×')))) : h('p.muted', 'Nothing under construction.'),
    h('h3', { style: { marginTop: '0.8em' } }, 'Buildings'),
    levels.length ? h('table.t.small', levels.map(({ b, n, prov }) => h('tr', { tip: `${b.name}: makes ${b.out.map(([g, a]) => `${a} ${X.goods[g].name.toLowerCase()}`).join(', ')}${b.inp.length ? ' from ' + b.inp.map(([g, a]) => `${a} ${X.goods[g].name.toLowerCase()}`).join(', ') : ''} per level and month at 100% efficiency; ${b.workers.toLocaleString()} workers per level.` },
      h('td', b.name), h('td.n', `${n} levels`), h('td.n.muted', `${prov} prov.`)))) : h('p.muted', 'No industry.'),
    h('h3', { style: { marginTop: '0.8em' } }, 'Trade partners'),
    partners == null ? h('p.muted', 'Shown after the next monthly market.')
      : partners.length ? h('table.t.small', partners.map(([j, v]) => h('tr.click', { on: { click: () => { cl.view.selectedCountry = j; cl.setTab('country'); cl.focusCountry(j); } } },
        h('td', flagCanvas(C[j]), ' ', C[j].name), h('td.n', money(v) + '/mo')))) : h('p.muted', 'No trade this month.'),
    e.embargo.length > 0 && h('div', h('h4', 'Embargoes declared'), h('div.muted', e.embargo.map((j) => C[j].name).join(', '))),
    h('p.note', 'Trade is automatic: each month countries sell stock above their target and buy what they lack, at world prices that follow world supply and demand. War and embargoes close a trade route.'));
}

// ---------------------------------------------------------------------------------------------
// Province panel: GDP parts, infrastructure, deposits, buildings, build menu

export function provinceEconomy(cl, p) {
  const s = cl.state, R = cl.game.rules, X = R.econ, map = cl.game.map, E = R.balance.economy;
  const own = s.prov.owner[p];
  if (own < 0 || !s.econ) return null;
  const me = s.player, mine = me >= 0 && own === me;
  const parts = provinceGdpParts(s, p, E);
  const lab = provinceLabour(s, R, p);
  const deps = X.resources.map((r, k) => [r, s.econ.dep[p * X.R + k]]).filter(([, v]) => v > 0);
  const fert = fertilityMap(map)[p];
  const built = X.buildings.filter((b) => s.econ.bld[p * X.B + b.i] > 0);
  const out = [
    h('div.kv',
      h('span', { tip: `Services: ${money(parts.base)} (population × productivity) × calibration ${parts.factor.toFixed(2)} × (1 − ${pct(parts.industryShare)} of the workforce in industry) × supply ${parts.supply.toFixed(2)} = ${money(parts.services)}\nIndustry value added: ${money(parts.industry)}` }, 'GDP parts'),
      h('span', `${money(parts.services)} + ${money(parts.industry)}`),
      h('span', { tip: 'Roads, rail and utilities: +4% building efficiency and +5% movement speed per level.' }, 'Infrastructure'), h('span', `${s.prov.infra[p]} / ${R.balance.industry.maxInfra}`),
      h('span', { tip: `Industrial workforce = ${pct(R.balance.industry.industrialLaborShare)} of population. Buildings need ${people(lab.need)}; if they need more than there is, all of them run slower.` }, 'Industrial workforce'),
      h('span', { className: lab.factor < 1 ? 'warn' : '' }, `${people(Math.min(lab.need, lab.avail))} / ${people(lab.avail)}`),
      h('span', { tip: 'Farm output multiplier from terrain and latitude.' }, 'Farmland'), h('span', fert.toFixed(2)),
      h('span', 'Deposits'), h('span', deps.length ? deps.map(([r, v]) => `${r.replace('_', ' ')} ${v}`).join(', ') : 'none')),
  ];
  if (built.length) {
    out.push(h('h4', 'Buildings'), h('table.t.small', built.map((b) => {
      const f = efficiencyBreakdown(s, map, R, p, b.i);
      const tip = `Efficiency ${pct(f.total)} = workforce ${pct(f.labour)} × infrastructure ${pct(f.infra)} × ${b.fertility ? `farmland ${f.fert.toFixed(2)} × (0.4 + 0.6 × development ${f.dev.toFixed(2)})` : b.dep >= 0 ? `extraction (0.5 + 0.5 × development ${f.dev.toFixed(2)})` : `development ${pct(f.dev)}`}${f.occupied ? ' × 0 (occupied)' : ''}\nNational input shortages reduce this further.`;
      return h('tr', { tip }, h('td', b.name), h('td.n', 'lvl ' + s.econ.bld[p * X.B + b.i]), h('td.n', { className: f.total < 0.5 ? 'warn' : '' }, pct(f.total)));
    })));
  }
  const queued = s.construction.filter((q) => q.prov === p);
  if (queued.length) out.push(h('div.muted', 'Under construction: ' + queued.map((q) => (q.kind === 'infra' ? 'infrastructure' : X.buildings[q.b].name) + ` (${q.left}d)`).join(', ')));
  if (mine) {
    const opts = [{ kind: 'infra', b: -1, name: 'Infrastructure' }, ...X.buildings.map((b) => ({ kind: 'building', b: b.i, name: b.name }))];
    const items = opts.map((o) => {
      const why = canBuild(s, map, R, me, p, o.kind, o.b);
      const cost = projectCost(s, map, R, me, p, o.kind, o.b);
      // hide buildings that can never be built here (no deposit, too undeveloped, maxed out)
      if (why && !/^Costs/.test(why) && !/queue is full/.test(why)) return null;
      const goods = cost.goods.map(([g, a]) => `${num(a)} ${X.goods[g].name.toLowerCase()}`).join(', ');
      const tip = `${o.name}: ${money(cost.money)}${goods ? ` + ${goods} from your stockpile` : ''}${cost.premium > 0 ? ` (missing goods bought for ${money(cost.premium)})` : ''}, ${cost.days} days.${why ? '\n' + why : ''}`;
      return h('button', { disabled: !!why, tip, on: { click: () => { const err = startProject(s, map, R, me, p, o.kind, o.b); if (err) cl.toast(err, true); refresh(cl); } } }, `+ ${o.name} ${money(cost.total)}`);
    }).filter(Boolean);
    out.push(h('h4', 'Build here'), items.length ? h('div.build-grid', items) : h('p.muted', 'Nothing can be built here.'));
  }
  return h('div', out);
}

// Nation tab: embargo toggle for another country.
export function embargoButton(cl, k) {
  const s = cl.state, me = s.player;
  if (me < 0 || k === me || !s.countries[k].alive) return null;
  const on = s.countries[me].econ.embargo.includes(k);
  const trade = s.dip?.treaties.some((t) => t.type === 'trade' && ((t.a === me && t.b === k) || (t.a === k && t.b === me)));
  return h('button', {
    disabled: !on && trade,
    tip: !on && trade ? 'You have a trade agreement with them: end it first (Diplomacy tab).' : on ? `Lift the embargo: trade with ${s.countries[k].name} resumes next month.` : `Stop all trade with ${s.countries[k].name} from next month (both directions). Their opinion of you falls.`,
    on: { click: () => { toggleEmbargo(s, me, k); cl.uiDirty = true; cl.requestFrame(); } },
  }, on ? 'Lift embargo' : 'Embargo');
}
