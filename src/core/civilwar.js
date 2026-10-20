// Civil wars: a deeply unstable country splits. The most disgruntled faction takes a block of
// provinces far from the capital, some of the armies there and a share of the treasury, and
// fights the government for them. See docs/GOVERNMENT.md (Civil wars).
//
// The rebels are a new country added to the game (addCountry), so everything per-country they
// need (economy, government, research, technology row) is created here.
import { log, aiLog, newArmy, pickCapital, refreshCountryCache, isHuman } from './state.js';
import { rand } from './rng.js';
import { touchRelations } from './relations.js';
import { transferProvince, endWar, eliminate } from './war.js';
import { newCountryEcon } from './industry.js';
import { newGovt, govEffects, disgruntled } from './government.js';
import { newResearch, refreshTech, knows } from './technology.js';
import { newStrat } from './strategic.js';
import { computeLedgers } from './economy.js';

// The government type and name a faction's rebellion takes.
const REBELS = {
  liberals: { gov: 'parliamentary', name: (n) => `Free ${n}` },
  conservatives: { gov: 'republic', name: (n) => `${n} Restoration Front` },
  socialists: { gov: 'one_party', name: (n) => `People's Republic of ${n}` },
  nationalists: { gov: 'military', name: (n) => `National ${n}` },
  business: { gov: 'republic', name: (n) => `${n} Free State` },
  military: { gov: 'military', name: (n) => `${n} Military Council` },
  clergy: { gov: 'theocracy', name: (n) => `Holy ${n}` },
};

// Mixes two #rrggbb colours (t = share of b).
function mix(a, b, t) {
  const p = (s, i) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, '0')).join('');
}

// Adds a new, empty country to the running game. spec = { tag, name, color, gov, flag, from }:
// `from` is a country whose technology the new one inherits.
export function addCountry(state, map, rules, spec) {
  const C = state.countries, k = C.length, X = rules.econ;
  const c = {
    idx: k, tag: spec.tag, name: spec.name, color: spec.color, gov: rules.politics.types[spec.gov] ? spec.gov : 'republic',
    capital: -1, treasury: 0, tax: rules.balance.economy.defaultTax, civilShare: rules.balance.economy.civilShare,
    stability: 45, manpower: 0, aggression: 0.5, flag: spec.flag || null,
    alive: true, truces: {}, ledger: null, cache: null, automate: false, startPolicies: null,
    research: newResearch(rules), strat: newStrat(), depots: [], claims: [], influence: 0, reputation: 0, rival: -1,
  };
  if (state.econ) c.econ = newCountryEcon(X.G, rules.balance.industry.defaultTariff);
  C.push(c);
  if (state.tech) {
    const T = state.tech.T, known = new Uint8Array((k + 1) * T);
    known.set(state.tech.known);
    if (spec.from >= 0) known.set(state.tech.known.subarray(spec.from * T, spec.from * T + T), k * T);
    state.tech.known = known;
    state.tech.ver = (state.tech.ver || 0) + 1;
    refreshTech(state, rules, c);
  }
  if (state.dip) { c.govt = newGovt(state, rules, c); c.govt.fx = govEffects(rules, c); }
  if (spec.from >= 0 && state.econ) c.econ.tariff = C[spec.from].econ.tariff;
  touchRelations(state);
  return c;
}

// Monthly chance that country c falls into civil war, 0 when it cannot.
export function civilWarChance(state, rules, c) {
  const W = rules.balance.civilWar;
  if (!W || !c.alive || !c.govt || !c.cache || c.cache.provinces < W.minProvinces) return 0;
  if (c.stability >= W.stability) return 0;
  if (state.day - (c.civilWarDay ?? -1e9) < W.cooldownYears * 365) return 0;
  if (state.wars.some((w) => w.kind === 'civil' && (w.attackers.includes(c.idx) || w.defenders.includes(c.idx)))) return 0;
  const { share } = disgruntled(rules, c);
  if (share < W.disgruntledShare) return 0;
  // foreign money for the rebels (deals.js) multiplies the chance
  return W.base * (W.stability - c.stability) / W.stability * Math.min(1, share * 2) * (1 + (c.rebelFund || 0));
}

// Provinces the rebels take: a connected block grown from the owned province farthest (in
// steps) from the capital, about `share` of the country's provinces; never the capital.
function rebelProvinces(state, map, k, share) {
  const P = state.prov, cap = state.countries[k].capital;
  const own = map.ids.filter((i) => P.owner[i] === k && P.controller[i] === k);
  const dist = new Map([[cap, 0]]), q = [cap];
  while (q.length) {
    const i = q.shift();
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      const j = map.adj[e];
      if (P.owner[j] !== k || dist.has(j)) continue;
      dist.set(j, dist.get(i) + 1); q.push(j);
    }
  }
  let seed = -1, far = -1;
  for (const i of own) { const d = dist.get(i) ?? 1e6; if (i !== cap && (d > far || (d === far && P.pop[i] > P.pop[seed]))) { far = d; seed = i; } }
  if (seed < 0) return [];
  const want = Math.max(1, Math.round(own.length * share));
  const take = new Set([seed]), fr = [seed];
  while (fr.length && take.size < want) {
    const i = fr.shift();
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      const j = map.adj[e];
      if (take.size >= want) break;
      if (P.owner[j] !== k || P.controller[j] !== k || j === cap || take.has(j)) continue;
      take.add(j); fr.push(j);
    }
  }
  return [...take];
}

// Splits country k. Returns the rebel country, or null if no block of provinces could be found.
export function startCivilWar(state, map, rules, k, why = '') {
  const W = rules.balance.civilWar, C = state.countries, gov = C[k];
  const { leader } = disgruntled(rules, gov);
  const R = REBELS[leader] || REBELS.nationalists;
  const share = W.provinceShare[0] + (W.provinceShare[1] - W.provinceShare[0]) * rand(state);
  const ps = rebelProvinces(state, map, k, share);
  if (!ps.length) return null;
  let n = 1;
  while (C.some((c) => c.tag === `${gov.tag}_R${n}`)) n++;
  const rgov = R.gov === gov.gov ? (gov.gov === 'military' ? 'republic' : 'military') : R.gov;
  const reb = addCountry(state, map, rules, {
    tag: `${gov.tag}_R${n}`, name: R.name(gov.name), gov: rgov, from: k,
    color: mix(gov.color || '#888888', '#202020', 0.35),
    flag: { pattern: 'h', colors: [mix(gov.color || '#888888', '#202020', 0.35), '#f2f2f2', gov.color || '#888888'] },
  });
  const r = reb.idx;
  const popBefore = gov.cache.pop;
  for (const p of ps) transferProvince(state, map, p, r);
  reb.capital = pickCapital(state, map, r);
  // the faction's supporters follow it; the government keeps everyone else
  if (reb.govt && gov.govt) {
    for (const f of Object.keys(reb.govt.support)) reb.govt.support[f] = f === leader ? 0.5 : (gov.govt.support[f] || 0.02) * 0.5;
    reb.govt.ruling = rules.politics.types[rgov].ruling || (rules.politics.factions[leader]?.electable ? leader : reb.govt.ruling);
    reb.govt.approval[leader] = 80;
  }
  // armies in rebel land defect, each with an even chance
  const defected = [];
  for (const a of state.armies) if (a.owner === k && ps.includes(a.loc) && !a.battle && rand(state) < W.armyDefectChance) {
    a.owner = r; a.path = []; a.prog = 0; defected.push(a.name);
  }
  refreshCountryCache(state, map, rules);
  const popShare = reb.cache.pop / Math.max(1, popBefore);
  const cash = Math.max(0, gov.treasury) * popShare;
  gov.treasury -= cash; reb.treasury = cash;
  reb.manpower = gov.manpower * popShare; gov.manpower -= reb.manpower;
  reb.stability = 50; gov.stability = Math.max(0, gov.stability - 5);
  if (reb.econ && gov.econ) for (let g = 0; g < reb.econ.stock.length; g++) { const v = gov.econ.stock[g] * popShare; reb.econ.stock[g] = v; gov.econ.stock[g] -= v; }
  // a rebel militia sized from the population, of the best line unit the country knows
  const types = Object.entries(rules.units).filter(([id, u]) => (u.domain || 'land') === 'land' && (u.role || 'line') === 'line' && (!rules.tech?.unitTech[id] || knows(state, r, rules.tech.unitTech[id])));
  const yr = (id) => (rules.tech?.unitTech[id] == null ? -1e9 : rules.tech.list[rules.tech.unitTech[id]].year);
  types.sort((a, b) => yr(b[0]) - yr(a[0]));
  const nUnits = Math.max(1, Math.min(W.maxMilitia, Math.round(reb.cache.pop / W.popPerMilitia)));
  if (types.length && reb.capital >= 0) { const a = newArmy(state, r, reb.capital, { [types[0][0]]: nUnits }); a.name = 'Rebel Army'; state.armies.push(a); }
  const war = {
    id: state.nextId++, name: `${gov.name} Civil War`, attackers: [r], defenders: [k],
    leaderA: r, leaderD: k, start: state.day, battleScore: 0, kind: 'civil',
  };
  state.wars.push(war);
  gov.civilWarDay = reb.civilWarDay = state.day;
  // the player picks a side (the client asks; until then they keep the government). In a hotseat
  // game the choice waits with that human (hotseat.js).
  if (isHuman(state, k)) { const H = state.hotseat?.humans.find((x) => x.k === k); if (H) H.civil = { gov: k, rebel: r }; else state.civilChoice = { gov: k, rebel: r }; }
  touchRelations(state);
  if (state.econ) computeLedgers(state, map, rules);
  log(state, 'war', `Civil war in ${gov.name}! The ${rules.politics.factions[leader]?.name || 'rebels'} have risen as the ${reb.name}, taking ${ps.length} province(s)${defected.length ? ` and ${defected.length} army(ies)` : ''}${why ? ` (${why})` : ''}.`,
    { important: true, war: war.id, country: k });
  aiLog(state, r, `Rose against ${gov.name}: ${ps.length} provinces, ${nUnits} militia units.`);
  return reb;
}

// Monthly: new civil wars, and the end of running ones. A government that holds every rebel
// province reunites the country; rebels that hold out for `stalemateYears`, or win
// decisively, keep their land as an independent country.
export function monthlyCivilWar(state, map, rules, warScores) {
  const W = rules.balance.civilWar;
  if (!W) return;
  for (const war of state.wars.filter((w) => w.kind === 'civil')) {
    const r = war.leaderA, k = war.leaderD, C = state.countries;
    if (!C[r]?.alive || !C[k]?.alive) continue;
    const score = warScores?.get(war) ?? 0;
    const rebelLand = map.ids.filter((i) => state.prov.owner[i] === r);
    const held = rebelLand.filter((i) => war.defenders.includes(state.prov.controller[i])).length;
    const years = (state.day - war.start) / 365;
    if (rebelLand.length && held === rebelLand.length) {
      const name = C[r].name;
      endWar(state, map, rules, war);
      for (const p of rebelLand) transferProvince(state, map, p, k);
      if (C[r].alive) eliminate(state, map, r);
      C[k].stability = Math.min(100, C[k].stability + 10);
      refreshCountryCache(state, map, rules);
      log(state, 'peace', `The ${war.name} is over: ${C[k].name} crushed the ${name} and reunited the country.`, { important: true, country: k });
    } else if (score >= W.rebelVictoryScore || years >= W.stalemateYears) {
      const taken = map.ids.filter((i) => state.prov.owner[i] === k && state.prov.controller[i] === r);
      endWar(state, map, rules, war);
      for (const p of taken) transferProvince(state, map, p, r);
      refreshCountryCache(state, map, rules);
      log(state, 'peace', `The ${war.name} is over: the ${C[r].name} ${score >= W.rebelVictoryScore ? 'won' : 'held out'} and is now an independent country${taken.length ? `, taking ${taken.length} more province(s)` : ''}.`, { important: true, country: k });
    }
  }
  for (const c of state.countries) {
    if (!c.alive) continue;
    const p = civilWarChance(state, rules, c);
    if (p > 0 && rand(state) < p) startCivilWar(state, map, rules, c.idx, `stability ${Math.round(c.stability)}`);
  }
}

export function inCivilWar(state, k) {
  return state.wars.some((w) => w.kind === 'civil' && (w.attackers.includes(k) || w.defenders.includes(k)));
}

