// Espionage: spy networks in foreign countries, in every era (cyber operations, a modern extra,
// are in strategic.js). A country builds a network in a target month by month, paying for it;
// the target's counter-intelligence slows that down and catches more operations. Operations
// spend network strength: steal technology, sabotage industry, fund the opposition, or stage a
// coup that installs a friendly government and can make a small country a puppet (subject).
// Numbers: balance.json → espionage. See docs/ESPIONAGE.md.
import { log, aiLog, logFor, isHuman, impFor } from './state.js';
import { rand } from './rng.js';
import { addMod, signTreaty, overlordOf, subjectsOf, validateTreaty } from './diplomacy.js';
import { changeGovernment, govType } from './government.js';
import { stealResearch, sabotageIndustry } from './strategic.js';
import { atWar } from './relations.js';
import { knowsId, available } from './technology.js';
import { bump } from './record.js';

function knownCount(state, k) {
  if (!state.tech) return 0;
  const T = state.tech.T, row = state.tech.known.subarray(k * T, k * T + T);
  let n = 0;
  for (let i = 0; i < T; i++) n += row[i] ? 1 : 0;
  return n;
}

export const SPY_OPS = ['steal', 'sabotage', 'destabilise', 'coup'];
export const SPY_OP_NAMES = { steal: 'Steal technology', sabotage: 'Sabotage industry', destabilise: 'Fund the opposition', coup: 'Stage a coup' };

export function spyOf(c) {
  return (c.spy ||= { nets: {}, building: [], counter: false });
}

// Monthly cost of k's spy service: each network being built, and counter-intelligence.
export function intelUpkeep(state, rules, c) {
  const E = rules.balance.espionage, s = c.spy;
  if (!E || !s) return 0;
  const unit = Math.max(E.minCost, Math.max(0, c.ledger?.taxRevenue ?? 0) * E.networkCostShare);
  return (s.building.length + (s.counter ? E.counterCostNetworks : 0)) * unit;
}

export function networkIn(state, k, target) {
  return state.countries[k].spy?.nets[target] || 0;
}

export function setBuilding(state, rules, k, target, on) {
  const E = rules.balance.espionage, s = spyOf(state.countries[k]);
  const i = s.building.indexOf(target);
  if (!on) { if (i >= 0) s.building.splice(i, 1); return null; }
  if (i >= 0) return null;
  if (target === k || !state.countries[target]?.alive) return 'Invalid target';
  if (s.building.length >= E.maxBuilding) return `At most ${E.maxBuilding} networks can be built at once`;
  s.building.push(target);
  return null;
}

// Share of foreign network growth and operations the target's counter-intelligence stops.
function counterOf(state, rules, t) {
  const E = rules.balance.espionage, c = state.countries[t];
  return (c.spy?.counter ? E.counterEffect : 0) + (c.govt && govType(rules, c).family === 'autocracy' ? E.autocracyCounter : 0);
}

export function canSpy(state, rules, k, target, op) {
  const E = rules.balance.espionage, C = state.countries, t = C[target];
  if (!E) return 'Espionage is off';
  if (!SPY_OPS.includes(op)) return 'Unknown operation';
  if (!t?.alive || k === target) return 'Invalid target';
  const need = E.opCost[op], have = networkIn(state, k, target);
  if (have < need) return `Needs a network of ${need} (you have ${Math.floor(have)})`;
  if (op === 'steal' && state.tech && !rules.tech.list.some((x) => knowsId(state, rules, target, x.id) && available(state, rules, k, x.i))) return `${t.name} knows nothing you could research yet`;
  if (op === 'coup') {
    if (t.stability >= E.coupStability) return `${t.name}'s government is too secure (stability ${Math.round(t.stability)}, needs under ${E.coupStability})`;
    if (atWar(state, k, target)) return 'Not while at war with them';
  }
  return null;
}

export function spyOdds(state, rules, k, target, op) {
  const E = rules.balance.espionage, t = state.countries[target];
  const ctr = counterOf(state, rules, target), net = networkIn(state, k, target);
  let success = E.success[op] * (1 - ctr) * (0.6 + 0.4 * Math.min(1, net / 100));
  if (op === 'coup') success *= Math.min(1.5, (E.coupStability - t.stability) / E.coupStability * 2);
  const detect = Math.min(0.9, E.detect[op] + ctr * 0.5);
  return { success: Math.max(0.05, Math.min(0.9, success)), detect };
}

// Puppet: a coup in a country much smaller than ours makes it our subject, if it can be one.
function canPuppet(state, map, rules, k, target) {
  const C = state.countries;
  if ((C[target].cache?.pop || 0) > (C[k].cache?.pop || 0) * rules.balance.espionage.puppetPopShare) return false;
  if (overlordOf(state, target) >= 0 || subjectsOf(state, target).length) return false;
  return !validateTreaty(state, map, rules, 'subject', k, target);
}

export function spyOperation(state, map, rules, k, target, op) {
  const why = canSpy(state, rules, k, target, op);
  if (why) return { error: why };
  const E = rules.balance.espionage, C = state.countries, c = C[k], t = C[target], s = spyOf(c);
  const { success, detect } = spyOdds(state, rules, k, target, op);
  s.nets[target] -= E.opCost[op];
  const ok = rand(state) < success, seen = rand(state) < (ok ? detect : Math.min(0.95, detect + 0.3));
  let what = 'failed';
  if (ok) {
    if (op === 'steal') what = stealResearch(state, map, rules, k, target, E.stealShare);
    else if (op === 'sabotage') what = sabotageIndustry(state, map, rules, target, E.sabotageLevels);
    else if (op === 'destabilise') {
      t.stability = Math.max(0, t.stability - E.destabiliseStability);
      if (t.govt) t.govt.legitimacy = Math.max(0, t.govt.legitimacy - E.destabiliseLegitimacy);
      what = `funded the opposition (−${E.destabiliseStability} stability)`;
    } else if (op === 'coup') {
      const was = govType(rules, t).name;
      const to = c.gov in rules.politics.types ? c.gov : 'military';
      changeGovernment(state, rules, t, to, { legitimacy: 30, ruling: rules.politics.types[to].ruling || null });
      t.stability = Math.max(0, t.stability - 10);
      addMod(state, target, k, E.coupOpinion, rules.balance.diplomacy.modDecay, 'Installed our government');
      if (isHuman(state, k)) bump(state, 'coups', 1, k);
      what = `overthrew the ${was.toLowerCase()} and installed a friendly ${govType(rules, t).name.toLowerCase()}`;
      if (canPuppet(state, map, rules, k, target)) { signTreaty(state, map, rules, 'subject', k, target, { quiet: true }); what += `; ${t.name} is now our puppet`; }
      log(state, 'politics', `Coup in ${t.name}: the government has fallen${seen ? `, backed by ${c.name}` : ''}.`, { important: impFor(state, k, target), country: target });
    }
  }
  if (seen) {
    addMod(state, target, k, -E.caughtOpinion, rules.balance.diplomacy.modDecay, 'Caught spying on us');
    s.nets[target] *= 1 - E.caughtNetworkLoss;
  }
  const label = SPY_OP_NAMES[op];
  logFor(state, k, 'diplomacy', `${label} in ${t.name}: ${ok ? what : 'failed'}${seen ? '; our agents were caught' : ''}.`, { important: true });
  if (seen || ok) logFor(state, target, 'diplomacy', seen ? `${c.name}'s agents were caught: ${label.toLowerCase()}${ok ? ` (${what.replace('stole', 'they stole')})` : ', foiled'}.` : `Foreign agents struck: ${what}.`, { important: true });
  else aiLog(state, k, `${label} in ${t.name}: ${ok ? what : 'failed'}${seen ? ', caught' : ''}.`);
  return { ok, seen, what };
}

// Monthly: networks grow where they are being built (less against counter-intelligence) and
// fade elsewhere; the AI runs its spy service.
export function monthlyEspionage(state, map, rules) {
  const E = rules.balance.espionage;
  if (!E) return;
  for (const c of state.countries) {
    if (!c.alive || !c.spy) continue;
    const s = c.spy;
    for (const t of Object.keys(s.nets)) {
      if (!state.countries[t]?.alive) { delete s.nets[t]; continue; }
      if (!s.building.includes(+t)) { s.nets[t] = Math.max(0, s.nets[t] - E.decay); if (!s.nets[t]) delete s.nets[t]; }
    }
    s.building = s.building.filter((t) => state.countries[t]?.alive);
    for (const t of s.building) s.nets[t] = Math.min(100, (s.nets[t] || 0) + E.growth * (1 - counterOf(state, rules, t)));
  }
  for (const c of state.countries) if (c.alive && !isHuman(state, c.idx) && c.ledger) aiSpies(state, map, rules, c);
}

// AI: spy on its rival (and enemies at war), steal technology from those ahead, unsettle
// enemies, topple a weak neighbour now and then; counter-intelligence once foreigners dig in.
function aiSpies(state, map, rules, c) {
  const E = rules.balance.espionage, A = E.ai, k = c.idx;
  if ((state.day + k) % 3 !== 0) return; // every few months is enough
  const C = state.countries;
  const rich = c.treasury > Math.max(0, c.ledger.revenue) * A.reserveMonths;
  const s = spyOf(c);
  const targets = [];
  if (c.rival >= 0 && C[c.rival].alive) targets.push(c.rival);
  for (const w of state.wars) {
    const other = w.attackers.includes(k) ? w.leaderD : w.defenders.includes(k) ? w.leaderA : -1;
    if (other >= 0 && !targets.includes(other)) targets.push(other);
  }
  if (rich) for (const t of targets.slice(0, E.maxBuilding)) setBuilding(state, rules, k, t, true);
  s.building = s.building.filter((t) => targets.includes(t) && rich);
  // counter-intelligence when any foreign network here is strong
  s.counter = state.countries.some((o) => o.alive && o.spy && (o.spy.nets[k] || 0) >= A.counterAt) && rich;
  for (const t of Object.keys(s.nets).map(Number)) {
    const net = s.nets[t];
    if (rand(state) > A.opChance) continue;
    const tc = C[t];
    let op = null;
    if (net >= E.opCost.coup && tc.stability < A.coupStability && canPuppet(state, map, rules, k, t) && !atWar(state, k, t)) op = 'coup';
    else if (atWar(state, k, t) && net >= E.opCost.sabotage) op = rand(state) < 0.5 ? 'sabotage' : 'destabilise';
    else if (net >= E.opCost.steal && knownCount(state, t) > knownCount(state, k)) op = 'steal';
    if (op && !canSpy(state, rules, k, t, op)) spyOperation(state, map, rules, k, t, op);
  }
}
