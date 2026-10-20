// Monthly national economy: provincial GDP -> tax revenue -> civil spending, military upkeep,
// debt interest -> treasury. Every figure is kept in a ledger so the UI can explain it.
import { provinceGdp, refreshCountryCache, log } from './state.js';
import { isAtWar } from './relations.js';
import { industryMonth, recordHistory } from './industry.js';
import { govStabilityParts } from './government.js';
import { transferShares } from './diplomacy.js';
import { strategicUpkeep } from './strategic.js';
import { intelUpkeep } from './espionage.js';
import { advisorUpkeep } from './natfx.js';

export function militaryUpkeep(state, c, rules, all = null) {
  if (all) return all[c.idx] * c.cache.priceLevel;
  const U = rules.units;
  let up = 0;
  for (const a of state.armies) {
    if (a.owner !== c.idx) continue;
    for (const t in a.units) up += a.units[t] * U[t].upkeep;
  }
  for (const f of state.fleets || []) if (f.owner === c.idx) for (const t in f.units) up += f.units[t] * U[t].upkeep;
  for (const w of state.wings || []) if (w.owner === c.idx) for (const t in w.units) up += w.units[t] * U[t].upkeep;
  for (const r of state.recruit) if (r.owner === c.idx) up += U[r.type].upkeep * 0.5;
  return up * c.cache.priceLevel;
}

// Base upkeep (before price level) of every country's armies and recruits, in one pass.
function allUpkeep(state, rules) {
  const U = rules.units, up = new Float64Array(state.countries.length);
  for (const a of state.armies) for (const t in a.units) up[a.owner] += a.units[t] * U[t].upkeep;
  for (const f of state.fleets || []) for (const t in f.units) up[f.owner] += f.units[t] * U[t].upkeep;
  for (const w of state.wings || []) for (const t in w.units) up[w.owner] += w.units[t] * U[t].upkeep;
  for (const r of state.recruit) up[r.owner] += U[r.type].upkeep * 0.5;
  return up;
}

// Share of the nominal tax actually collected: stability, times the government's efficiency
// (type, policies and modifiers; see docs/GOVERNMENT.md).
export function taxEfficiency(c, rules) {
  const w = rules.balance.economy.taxEfficiencyStabilityWeight;
  const g = c.govt?.fx ? Math.max(0.6, Math.min(1.3, c.govt.fx.taxEff)) : 1;
  return (1 - w + w * (c.stability / 100)) * g * (c.tfx?.mult.tax ?? 1);
}

// Computes this month's ledger for every country without mutating treasuries.
export function computeLedgers(state, map, rules) {
  const E = rules.balance.economy;
  const C = state.countries.length;
  const gdpOwned = new Float64Array(C), gdpControlled = new Float64Array(C), requisition = new Float64Array(C);
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) continue;
    const g = provinceGdp(state, i, E) / 12;
    const ctl = state.prov.controller[i];
    if (ctl === o) gdpControlled[o] += g;
    else if (ctl >= 0) requisition[ctl] += g * 0.25 * 0.3; // occupiers extract a fraction
    gdpOwned[o] += g;
  }
  const ups = allUpkeep(state, rules);
  // reparations and subject tribute: a share of the payer's tax revenue
  const taxRev = new Float64Array(C), transfer = new Float64Array(C);
  for (const c of state.countries) if (c.alive) taxRev[c.idx] = gdpControlled[c.idx] * c.tax * taxEfficiency(c, rules);
  for (const [from, to, share] of transferShares(state, rules)) {
    if (!state.countries[from].alive || !state.countries[to].alive) continue;
    const v = Math.max(0, taxRev[from]) * share;
    transfer[from] -= v; transfer[to] += v;
  }
  for (const c of state.countries) {
    if (!c.alive) { c.ledger = null; continue; }
    const k = c.idx;
    const eff = taxEfficiency(c, rules);
    const taxRevenue = taxRev[k];
    const tariffs = c.econ ? c.econ.tariffRev : 0;
    // national trade bonus: a share of the month's export value (docs/NATIONS.md)
    const trade = c.econ ? (c.econ.expValue || 0) * (c.tfx?.nat?.trade || 0) : 0;
    const revenue = taxRevenue + requisition[k] + tariffs + trade + Math.max(0, transfer[k]);
    const civil = taxRevenue * c.civilShare;
    const research = Math.max(0, taxRevenue) * (c.research?.share ?? 0);
    const military = militaryUpkeep(state, c, rules, ups);
    const strategic = strategicUpkeep(c, rules);
    const intel = intelUpkeep(state, rules, c);
    const interest = c.treasury < 0 ? (-c.treasury * E.debtInterestYear) / 12 : 0;
    const advisors = advisorUpkeep(rules, c, revenue);
    const paid = Math.max(0, -transfer[k]);
    c.ledger = {
      gdpMonth: gdpOwned[k], gdpLost: gdpOwned[k] - gdpControlled[k], efficiency: eff,
      taxRevenue, requisition: requisition[k], tariffs, trade, advisors, transfersIn: Math.max(0, transfer[k]), transfersOut: paid, revenue, civil, research, military, strategic, intel, interest,
      construction: c.econ ? c.econ.spentConstruction || 0 : 0,
      net: revenue - civil - research - military - strategic - intel - interest - advisors - paid,
    };
  }
}

export function monthlyEconomy(state, map, rules) {
  const E = rules.balance.economy, P = rules.balance.population, I = rules.balance.industry;
  refreshCountryCache(state, map, rules);
  if (state.econ) industryMonth(state, map, rules);
  computeLedgers(state, map, rules);
  for (const c of state.countries) {
    if (!c.alive || !c.ledger) continue;
    const L = c.ledger;
    const before = c.treasury;
    c.treasury += L.net;
    if (before >= 0 && c.treasury < 0 && c.idx === state.player) log(state, 'economy', `${c.name} is now running on debt.`, { important: true });
    // stability drifts toward a target shaped by taxes, public services, debt, war and occupation
    let target = 50 + (c.civilShare - 0.7) * 60 - Math.max(0, c.tax - 0.3) * 100 * E.highTaxStabilityPenalty / 10;
    if (c.treasury < 0) target -= E.negativeTreasuryStabilityPenalty * Math.min(10, -c.treasury / Math.max(1, L.revenue));
    if (isAtWar(state, c.idx)) target -= 5;
    if (c.cache.provinces) target -= 25 * (c.cache.occupied / c.cache.provinces);
    const ee = c.econ;
    if (ee) {
      // shortages, unemployment and inflation (see docs/ECONOMY.md)
      ee.stabilityParts = {
        food: -I.foodShortageStability * (1 - ee.foodSat),
        goods: -I.goodsShortageStability * (1 - ee.living),
        jobs: -I.unemploymentStability * Math.max(0, ee.unemployment - 0.06) * 100,
        prices: -Math.min(15, I.inflationStability * Math.max(0, ee.inflation - 0.05) * 100),
      };
      for (const k in ee.stabilityParts) target += ee.stabilityParts[k];
      ee.spentConstruction = 0;
    }
    // government type, faction approval and legitimacy (see docs/GOVERNMENT.md)
    const gp = govStabilityParts(rules, c);
    if (gp) { c.govt.stabilityParts = gp; for (const k in gp) target += gp[k]; }
    target = Math.max(5, Math.min(95, target));
    c.stability += (target - c.stability) * 0.08;
    // manpower regenerates toward the cap
    const cap = c.cache.maxManpower;
    c.manpower = Math.min(cap, c.manpower + cap * P.manpowerRegenMonth);
  }
  // population growth (occupied provinces stagnate; hunger slows or reverses it) and
  // development growth (driven by living standards and civil spending)
  // (medicine and agriculture technology scale growth; see docs/TECHNOLOGY.md)
  const C = state.countries;
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0 || state.prov.controller[i] !== o) continue;
    const tm = C[o].tfx?.mult;
    const g = (P.growthYear / 12) * (tm ? tm.popGrowth : 1);
    const ee = C[o].econ;
    if (!ee) { state.prov.pop[i] *= 1 + g; continue; }
    const fs = ee.foodSat;
    state.prov.pop[i] *= 1 + g * (2 * fs - 1) - (fs < 0.5 ? (0.5 - fs) * 0.01 : 0);
    const d = state.prov.dev[i];
    if (d < 100) state.prov.dev[i] = Math.min(100, d + I.devGrowthMonth * ee.living * (C[o].civilShare / 0.75) * Math.max(0.2, 1.3 - d / 100) * (tm ? tm.devGrowth : 1));
  }
  if (state.econ) recordHistory(state);
}

// Called once at game start for scenarios flagged autoBudget: sets each country's civil share
// so the starting army is affordable, instead of every country starting in deficit.
export function autoBalanceBudgets(state, map, rules) {
  computeLedgers(state, map, rules);
  for (const c of state.countries) {
    if (!c.ledger) continue;
    const L = c.ledger;
    if (L.taxRevenue <= 0) continue;
    const need = ((L.military + (L.strategic || 0) + (L.intel || 0)) * 1.08) / L.taxRevenue + (c.research?.share ?? 0);
    c.civilShare = Math.max(0.55, Math.min(0.9, 1 - need));
    c.treasury = L.taxRevenue * 3;
  }
  computeLedgers(state, map, rules);
}
