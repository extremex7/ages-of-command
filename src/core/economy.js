// Monthly national economy: provincial GDP -> tax revenue -> civil spending, military upkeep,
// debt interest -> treasury. Every figure is kept in a ledger so the UI can explain it.
import { provinceGdp, refreshCountryCache, log } from './state.js';
import { isAtWar } from './relations.js';

export function militaryUpkeep(state, c, rules) {
  const U = rules.units;
  let up = 0;
  for (const a of state.armies) {
    if (a.owner !== c.idx) continue;
    for (const t in a.units) up += a.units[t] * U[t].upkeep;
  }
  for (const r of state.recruit) if (r.owner === c.idx) up += U[r.type].upkeep * 0.5;
  return up * c.cache.priceLevel;
}

export function taxEfficiency(c, rules) {
  const w = rules.balance.economy.taxEfficiencyStabilityWeight;
  return 1 - w + w * (c.stability / 100);
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
  for (const c of state.countries) {
    if (!c.alive) { c.ledger = null; continue; }
    const k = c.idx;
    const eff = taxEfficiency(c, rules);
    const taxRevenue = gdpControlled[k] * c.tax * eff;
    const revenue = taxRevenue + requisition[k];
    const civil = taxRevenue * c.civilShare;
    const military = militaryUpkeep(state, c, rules);
    const interest = c.treasury < 0 ? (-c.treasury * E.debtInterestYear) / 12 : 0;
    c.ledger = {
      gdpMonth: gdpOwned[k], gdpLost: gdpOwned[k] - gdpControlled[k], efficiency: eff,
      taxRevenue, requisition: requisition[k], revenue, civil, military, interest,
      net: revenue - civil - military - interest,
    };
  }
}

export function monthlyEconomy(state, map, rules) {
  const E = rules.balance.economy, P = rules.balance.population;
  refreshCountryCache(state, map, rules);
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
    target = Math.max(5, Math.min(95, target));
    c.stability += (target - c.stability) * 0.08;
    // manpower regenerates toward the cap
    const cap = c.cache.maxManpower;
    c.manpower = Math.min(cap, c.manpower + cap * P.manpowerRegenMonth);
  }
  // population growth (occupied provinces stagnate)
  const g = P.growthYear / 12;
  for (const i of map.ids) {
    if (state.prov.owner[i] < 0) continue;
    if (state.prov.controller[i] === state.prov.owner[i]) state.prov.pop[i] *= 1 + g;
  }
}

// Called once at game start for scenarios flagged autoBudget: sets each country's civil share
// so the starting army is affordable, instead of every country starting in deficit.
export function autoBalanceBudgets(state, map, rules) {
  computeLedgers(state, map, rules);
  for (const c of state.countries) {
    if (!c.ledger) continue;
    const L = c.ledger;
    if (L.taxRevenue <= 0) continue;
    const need = (L.military * 1.08) / L.taxRevenue;
    c.civilShare = Math.max(0.55, Math.min(0.9, 1 - need));
    c.treasury = L.taxRevenue * 3;
  }
  computeLedgers(state, map, rules);
}
