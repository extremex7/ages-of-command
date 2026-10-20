// Government: types, domestic factions, approval, legitimacy, policies, elections, coups and
// revolutions. Data: data/rules/governments.json and balance.json → government.
// See docs/GOVERNMENT.md for the formulas.
import { log, aiLog, humanControls, impFor } from './state.js';
import { isAtWar } from './relations.js';
import { rand } from './rng.js';
import { civilFromDays } from './calendar.js';

const MULT = ['manpower', 'construction', 'coupRisk'];
const ADD = ['taxEff', 'stability', 'legitimacy', 'liberty'];

// Validates and indexes governments.json into rules.politics.
export function compilePolitics(gov) {
  const errs = [];
  if (!gov?.types || !gov.factions || !gov.policies || !gov.families) throw new Error('Invalid rules:\ngovernments: needs families, types, factions and policies');
  const factions = Object.keys(gov.factions).filter((k) => !k.startsWith('_'));
  for (const [id, t] of Object.entries(gov.types)) {
    if (!gov.families[t.family]) errs.push(`government "${id}": unknown family "${t.family}"`);
    for (const f of ['stability', 'legitimacy', 'taxEff', 'manpower', 'warPropensity', 'liberty', 'coupRisk', 'electionYears']) {
      if (typeof t[f] !== 'number') errs.push(`government "${id}": "${f}" must be a number`);
    }
    if (!t.electionYears && !gov.factions[t.ruling]) errs.push(`government "${id}": without elections it needs a "ruling" faction`);
    for (const f of Object.keys(t.support || {})) if (!gov.factions[f]) errs.push(`government "${id}": unknown faction "${f}" in support`);
    for (const [g, o] of Object.entries(t.policies || {})) if (!gov.policies[g]?.options[o]) errs.push(`government "${id}": unknown policy ${g}=${o}`);
    for (const r of t.reformsTo || []) if (!gov.types[r]) errs.push(`government "${id}": cannot reform to unknown type "${r}"`);
  }
  for (const [id, f] of Object.entries(gov.factions)) {
    if (!gov.types[f.prefers]) errs.push(`faction "${id}": prefers unknown government "${f.prefers}"`);
    for (const d of Object.keys(f.weights || {})) if (!gov.drivers[d]) errs.push(`faction "${id}": unknown driver "${d}"`);
  }
  for (const [g, p] of Object.entries(gov.policies)) {
    if (!p.options || !Object.keys(p.options).length) errs.push(`policy "${g}": needs options`);
    for (const [o, opt] of Object.entries(p.options || {})) checkEffects(opt.effects || {}, `policy ${g}.${o}`, gov, errs);
  }
  if (errs.length) throw new Error('Invalid rules:\n' + errs.join('\n'));
  return { ...gov, factionIds: factions, policyIds: Object.keys(gov.policies) };
}

export function checkEffects(fx, where, gov, errs) {
  for (const [k, v] of Object.entries(fx)) {
    if (k === 'faction') { for (const f of Object.keys(v)) if (!gov.factions[f]) errs.push(`${where}: unknown faction "${f}"`); }
    else if (!MULT.includes(k) && !ADD.includes(k)) errs.push(`${where}: unknown effect "${k}"`);
    else if (typeof v !== 'number') errs.push(`${where}: effect "${k}" must be a number`);
  }
}

export function govType(rules, c) {
  return rules.politics.types[c.gov] || rules.politics.types.republic;
}

export function govFamily(rules, c) {
  return govType(rules, c).family;
}

function defaultPolicies(rules, type) {
  const P = rules.politics, out = {};
  for (const g of P.policyIds) {
    const opts = Object.keys(P.policies[g].options);
    out[g] = type.policies?.[g] || opts[Math.floor(opts.length / 2)];
  }
  return out;
}

// Deterministic first election date: spread over the electoral cycle by country index.
function firstElection(state, type, idx) {
  const months = type.electionYears * 12;
  return addMonths(state.day, 1 + ((idx * 37) % months));
}

function addMonths(day, n) {
  return day + Math.round(n * 30.44);
}

export function newGovt(state, rules, c) {
  const type = govType(rules, c), F = rules.politics.factionIds;
  const support = {}, approval = {};
  let tot = 0;
  for (const f of F) { support[f] = type.support?.[f] ?? 0.02; tot += support[f]; }
  for (const f of F) { support[f] /= tot; approval[f] = 50; }
  const g = {
    ruling: type.ruling || bestElectable(rules, support),
    support, approval, approvalAll: 50,
    legitimacy: type.legitimacy, policies: defaultPolicies(rules, type),
    nextElection: type.electionYears ? firstElection(state, type, c.idx) : -1,
    lastElection: -1, policyDay: -1e9, reformDay: -1e9, upheavalDay: -1e9,
    glory: 0, mods: [], evDay: {}, fx: null, stabilityParts: null,
  };
  return g;
}

function bestElectable(rules, support) {
  let best = null;
  for (const f of rules.politics.factionIds) if (rules.politics.factions[f].electable && (!best || support[f] > support[best])) best = f;
  return best;
}

// Installs a government on every country (new game, or a save from before Milestone 4), then
// settles approval so the first months do not jump.
export function initGovernment(state, map, rules) {
  for (const c of state.countries) {
    c.govt = newGovt(state, rules, c);
    // policies a scenario sets for the start (ignored where the rules do not define them)
    for (const [grp, o] of Object.entries(c.startPolicies || {})) if (rules.politics.policies[grp]?.options[o]) c.govt.policies[grp] = o;
    delete c.startPolicies;
    c.govt.fx = govEffects(rules, c);
  }
  for (let i = 0; i < 12; i++) for (const c of state.countries) if (c.alive) updateApproval(state, map, rules, c, 1);
}

// Combined effects of the government type, policies and temporary modifiers.
export function govEffects(rules, c) {
  const P = rules.politics, T = govType(rules, c), g = c.govt;
  const fx = { manpower: T.manpower, construction: 1, coupRisk: T.coupRisk, taxEff: T.taxEff, stability: T.stability, legitimacy: 0, liberty: T.liberty, faction: {}, planning: 0, faith: c.gov === 'theocracy' ? 1 : 0 };
  const apply = (e) => {
    for (const [k, v] of Object.entries(e || {})) {
      if (k === 'faction') for (const [f, a] of Object.entries(v)) fx.faction[f] = (fx.faction[f] || 0) + a;
      else if (MULT.includes(k)) fx[k] *= v;
      else fx[k] += v;
    }
  };
  for (const [grp, o] of Object.entries(g.policies)) {
    const opt = P.policies[grp]?.options[o];
    if (!opt) continue;
    apply(opt.effects);
    fx.planning += opt.planning || 0;
    fx.faith += opt.faith || 0;
  }
  for (const m of g.mods) apply(m.effects);
  fx.liberty = Math.max(0, Math.min(1, fx.liberty));
  return fx;
}

function refreshEffects(rules, c) {
  c.govt.fx = govEffects(rules, c);
}

// Measured national conditions that factions react to, each roughly -1..1.
export function drivers(state, rules, c, warScores) {
  const fx = c.govt.fx, e = c.econ, cl = (x) => Math.max(-1, Math.min(1, x));
  let prosperity = 0;
  if (e) prosperity = (e.living - 1) * 6 + (e.foodSat - 1) * 4 - Math.max(0, e.unemployment - 0.06) * 8 - Math.max(0, e.inflation - 0.04) * 6;
  let ws = 0, n = 0;
  if (warScores) for (const [w, sc] of warScores) { if (w.attackers.includes(c.idx)) { ws += sc; n++; } else if (w.defenders.includes(c.idx)) { ws -= sc; n++; } }
  const war = n > 0;
  return {
    tax: cl((0.25 - c.tax) * 5),
    services: cl((c.civilShare - 0.8) * 6),
    defence: cl((1 - c.civilShare - 0.2) * 6),
    prosperity: cl(prosperity),
    peace: war ? -1 : 0.2,
    glory: cl((n ? ws / n / 50 : 0) + c.govt.glory),
    liberty: cl((fx.liberty - 0.6) * 1.5),
    order: cl((c.stability - 50) / 50),
    faith: cl(fx.faith),
    planning: cl(fx.planning),
  };
}

// Target approval of each faction (0-100). With withParts, each target also lists the
// contribution of each driver, for tooltips. `fx` evaluates hypothetical policies (AI).
export function factionTargets(state, rules, c, warScores = null, fx = null, withParts = false) {
  const P = rules.politics, G = rules.balance.government;
  const saved = c.govt.fx;
  if (fx) c.govt.fx = fx;
  const d = drivers(state, rules, c, warScores);
  c.govt.fx = saved;
  const eff = fx || saved;
  const out = {};
  for (const f of P.factionIds) {
    const W = P.factions[f].weights;
    let x = 0;
    const parts = withParts ? [] : null;
    for (const k of Object.keys(W)) { const v = W[k] * d[k]; x += v; if (parts && Math.abs(v) > 0.01) parts.push([k, v]); }
    const inPower = c.govt.ruling === f ? G.inPowerApproval : 0;
    const extra = eff.faction[f] || 0;
    const target = Math.max(0, Math.min(100, G.approvalBase + G.approvalSpread * Math.tanh(x) + inPower + extra));
    out[f] = withParts ? { target, parts, inPower, extra } : target;
  }
  return out;
}

function updateApproval(state, map, rules, c, rate, warScores = null) {
  const G = rules.balance.government, g = c.govt;
  const t = factionTargets(state, rules, c, warScores);
  let all = 0;
  for (const f in t) {
    g.approval[f] += (t[f] - g.approval[f]) * (rate ?? G.approvalSmoothing);
    all += g.support[f] * g.approval[f];
  }
  for (const f in g.approval) g.approval[f] = Math.round(g.approval[f] * 100) / 100;
  g.approvalAll = Math.round(all * 100) / 100;
}

// Supports sum to 1 and are rounded to 0.01% (rounded at the source, so saves stay small and a
// reloaded game continues identically).
function normaliseSupport(g) {
  let tot = 0;
  for (const f in g.support) { g.support[f] = Math.max(0.005, g.support[f]); tot += g.support[f]; }
  for (const f in g.support) g.support[f] = Math.round((g.support[f] / tot) * 1e4) / 1e4;
}

export function shiftSupport(c, f, d) {
  if (c.govt.support[f] == null) return;
  c.govt.support[f] += d;
  normaliseSupport(c.govt);
}

// Stability target contributions from government (added in economy.js monthlyEconomy).
export function govStabilityParts(rules, c) {
  const G = rules.balance.government, g = c.govt;
  if (!g) return null;
  const r = (x) => Math.round(x * 100) / 100;
  return {
    government: r(g.fx.stability),
    approval: r((g.approvalAll - 50) * G.approvalStability),
    legitimacy: r((g.legitimacy - 70) * G.legitimacyStability),
  };
}

export function monthlyGovernment(state, map, rules, warScores) {
  const G = rules.balance.government;
  for (const c of state.countries) {
    if (!c.alive || !c.govt) continue;
    const g = c.govt, T = govType(rules, c);
    const before = g.mods.length;
    g.mods = g.mods.filter((m) => m.until > state.day);
    if (g.mods.length !== before) refreshEffects(rules, c);
    updateApproval(state, map, rules, c, G.approvalSmoothing, warScores);
    // support drifts back toward the government type's base and toward factions that are content
    for (const f in g.support) {
      const base = T.support?.[f] ?? 0.02;
      g.support[f] += G.supportDrift * (base - g.support[f]) + G.supportDrift * 0.1 * g.support[f] * (g.approval[f] - 50) / 50;
    }
    normaliseSupport(g);
    const legTarget = T.legitimacy + g.fx.legitimacy + G.legitimacyApproval * (g.approvalAll - 50);
    g.legitimacy = Math.round((g.legitimacy + (Math.max(0, Math.min(100, legTarget)) - g.legitimacy) * G.legitimacySmoothing) * 100) / 100;
    g.glory *= 0.97;
    if (T.electionYears && g.nextElection >= 0 && state.day >= g.nextElection) holdElection(state, rules, c);
    else if (state.day - g.upheavalDay > G.upheavalCooldownDays) {
      if (!tryCoup(state, map, rules, c)) tryRevolution(state, map, rules, c);
    }
    if (!humanControls(state, c.idx)) { aiPolicy(state, rules, c, warScores); aiReform(state, rules, c, warScores); }
  }
}

export function monthsToElection(state, c) {
  const g = c.govt;
  if (!g || g.nextElection < 0) return Infinity;
  return (g.nextElection - state.day) / 30.44;
}

export function holdElection(state, rules, c) {
  const P = rules.politics, G = rules.balance.government, g = c.govt, T = govType(rules, c);
  const votes = {};
  let tot = 0, eShare = 0;
  for (const f of P.factionIds) {
    if (!P.factions[f].electable) continue;
    votes[f] = g.support[f] * (0.4 + 1.2 * g.approval[f] / 100);
    tot += votes[f]; eShare += g.support[f];
  }
  let winner = null;
  for (const f in votes) {
    votes[f] /= tot;
    g.support[f] += (votes[f] * eShare - g.support[f]) * G.electionSwing;
    if (!winner || votes[f] > votes[winner]) winner = f;
  }
  normaliseSupport(g);
  const prev = g.ruling;
  g.ruling = winner;
  g.lastElection = state.day;
  g.lastVotes = Object.fromEntries(Object.entries(votes).map(([f, v]) => [f, Math.round(v * 1000) / 1000]));
  g.nextElection = addMonths(state.day, T.electionYears * 12);
  g.legitimacy = Math.min(100, g.legitimacy + G.electionLegitimacy);
  const name = P.factions[winner].name;
  const txt = prev === winner
    ? `${c.name}: the ${name} were re-elected with ${Math.round(votes[winner] * 100)}% of the vote.`
    : `${c.name}: the ${name} won the election with ${Math.round(votes[winner] * 100)}% of the vote, replacing the ${P.factions[prev]?.name || prev}.`;
  log(state, 'politics', txt, { important: impFor(state, c.idx), country: c.idx });
  refreshEffects(rules, c);
}

// Monthly chance that the military seizes power: needs a strong, unhappy military and low stability.
export function coupChance(rules, c) {
  const G = rules.balance.government, g = c.govt;
  const ms = g.support.military ?? 0, ma = g.approval.military ?? 50;
  const unhappy = Math.max(0, (G.coupApproval - ma) / G.coupApproval);
  const unstable = Math.max(0, (G.coupStability - c.stability) / G.coupStability);
  return G.coupBase * g.fx.coupRisk * Math.min(1, ms * 4) * unhappy * unstable;
}

function tryCoup(state, map, rules, c) {
  const p = coupChance(rules, c);
  if (p <= 0 || rand(state) >= p) return false;
  const was = govType(rules, c).name;
  changeGovernment(state, rules, c, 'military', { legitimacy: 30, ruling: 'military' });
  c.stability = Math.max(0, c.stability - 8);
  c.govt.approval.military = Math.min(100, c.govt.approval.military + 25);
  shiftSupport(c, 'military', 0.08);
  log(state, 'politics', `Coup in ${c.name}: the armed forces have overthrown the ${was.toLowerCase()} and taken power.`, { important: true, country: c.idx });
  return true;
}

// Share of the population backing factions whose approval is below the revolution threshold.
export function disgruntled(rules, c) {
  const G = rules.balance.government, g = c.govt;
  let share = 0, leader = null;
  for (const f in g.support) {
    if (g.approval[f] >= G.revolutionApproval) continue;
    share += g.support[f];
    if (!leader || g.support[f] > g.support[leader]) leader = f;
  }
  return { share, leader };
}

export function revolutionChance(rules, c) {
  const G = rules.balance.government;
  if (c.stability >= G.revolutionStability) return 0;
  const { share } = disgruntled(rules, c);
  if (share <= G.revolutionShare) return 0;
  return G.revolutionBase * Math.min(1, (share - G.revolutionShare + 0.1) * 5) * (G.revolutionStability - c.stability) / G.revolutionStability;
}

function tryRevolution(state, map, rules, c) {
  const p = revolutionChance(rules, c);
  if (p <= 0 || rand(state) >= p) return false;
  const P = rules.politics, { leader } = disgruntled(rules, c);
  const to = P.factions[leader].prefers;
  const fam = P.types[to].family;
  const was = govType(rules, c).name;
  changeGovernment(state, rules, c, to, { legitimacy: 45, ruling: P.types[to].ruling || (fam === 'democracy' && P.factions[leader].electable ? leader : null) });
  c.stability = Math.max(c.stability, 30);
  c.govt.approval[leader] = Math.min(100, c.govt.approval[leader] + 30);
  shiftSupport(c, leader, 0.1);
  log(state, 'politics', `Revolution in ${c.name}: the ${P.factions[leader].name} brought down the ${was.toLowerCase()}. New government: ${P.types[to].name}.`, { important: true, country: c.idx });
  return true;
}

// Switches government type, resetting policies to the new type's defaults.
export function changeGovernment(state, rules, c, to, { legitimacy, ruling = null } = {}) {
  const P = rules.politics, T = P.types[to], g = c.govt;
  c.gov = to;
  g.policies = defaultPolicies(rules, T);
  g.ruling = T.ruling || ruling || bestElectable(rules, g.support);
  g.legitimacy = legitimacy ?? T.legitimacy;
  g.nextElection = T.electionYears ? addMonths(state.day, T.electionYears * 12) : -1;
  g.upheavalDay = state.day;
  refreshEffects(rules, c);
}

export function canSetPolicy(state, rules, k, group, option) {
  const P = rules.politics, G = rules.balance.government, c = state.countries[k];
  if (!c?.alive) return 'Country does not exist';
  if (!P.policies[group]?.options[option]) return 'Unknown policy';
  if (c.govt.policies[group] === option) return 'Already in force';
  const wait = c.govt.policyDay + G.policyCooldownDays - state.day;
  if (wait > 0) return `Policy changes are possible again in ${wait} days`;
  return null;
}

export function setPolicy(state, rules, k, group, option) {
  const why = canSetPolicy(state, rules, k, group, option);
  if (why) return why;
  const G = rules.balance.government, c = state.countries[k], g = c.govt;
  g.policies[group] = option;
  g.policyDay = state.day;
  g.legitimacy = Math.max(0, g.legitimacy - G.policyLegitimacyCost);
  c.stability = Math.max(0, c.stability - G.policyStabilityCost);
  refreshEffects(rules, c);
  log(state, 'politics', `${c.name} adopted ${rules.politics.policies[group].options[option].name.toLowerCase()}.`, { important: impFor(state, k), country: k });
  return null;
}

export function canReform(state, rules, k, to) {
  const P = rules.politics, G = rules.balance.government, c = state.countries[k];
  if (!c?.alive) return 'Country does not exist';
  if (!P.types[to]) return 'Unknown government type';
  if (!(govType(rules, c).reformsTo || []).includes(to)) return `${govType(rules, c).name} cannot reform into ${P.types[to].name}`;
  const gt = rules.tech?.govTech[to];
  if (gt != null && state.tech && !state.tech.known[k * state.tech.T + gt]) return `Needs the technology ${rules.tech.list[gt].name}`;
  if (isAtWar(state, k)) return 'Not while at war';
  if (c.stability < G.reformMinStability) return `Needs stability ${G.reformMinStability}`;
  const wait = c.govt.reformDay + G.reformCooldownDays - state.day;
  if (wait > 0) return `Another reform is possible in ${Math.ceil(wait / 365)} year(s)`;
  return null;
}

export function reformGovernment(state, rules, k, to) {
  const why = canReform(state, rules, k, to);
  if (why) return why;
  const G = rules.balance.government, c = state.countries[k];
  const was = govType(rules, c).name;
  changeGovernment(state, rules, c, to, { legitimacy: G.reformLegitimacy });
  c.govt.reformDay = state.day;
  c.govt.upheavalDay = -1e9; // a reform is not an upheaval
  c.stability = Math.max(0, c.stability - G.reformStabilityCost);
  log(state, 'politics', `${c.name} reformed from ${was.toLowerCase()} to ${rules.politics.types[to].name.toLowerCase()}.`, { important: true, country: k });
  return null;
}

export function addGovModifier(state, rules, c, name, months, effects) {
  c.govt.mods = c.govt.mods.filter((m) => m.name !== name);
  c.govt.mods.push({ name, until: addMonths(state.day, months), effects });
  refreshEffects(rules, c);
}

// AI reform: once a year, a stable country at peace whose government has lost legitimacy or
// approval considers the government types it can reform into. Each is scored like a policy change
// (support-weighted faction approval under the new type, ruling faction double) plus the backing
// of unhappy factions that prefer that type, and its stability;
// it reforms (with chance `aiReformChance` a year) when the gain beats `aiReformGain`, never into a type the ruling faction would like
// less.
function aiReform(state, rules, c, warScores) {
  const G = rules.balance.government, P = rules.politics, g = c.govt;
  if (!G.aiReformGain || (c.idx + civilFromDays(state.day).m + 6) % 12 !== 0) return;
  // a government people are content with is not reformed
  if (g.legitimacy >= G.aiReformLegitimacy && g.approvalAll >= G.aiReformApproval) return;
  const cands = (govType(rules, c).reformsTo || []).filter((to) => !canReform(state, rules, c.idx, to));
  if (!cands.length) return;
  const score = (t) => {
    let s = 0;
    for (const f in t) s += g.support[f] * t[f] * (f === g.ruling ? 2 : 1);
    return s;
  };
  // factions that are unhappy now push for the type they prefer
  const backing = (type) => { let s = 0; for (const f in g.support) if (P.factions[f]?.prefers === type && g.approval[f] < G.aiReformApproval) s += g.support[f]; return s; };
  const now = factionTargets(state, rules, c, warScores);
  const base = score(now) + backing(c.gov) * 30 + (P.types[c.gov].stability || 0) * 0.5;
  const saved = { gov: c.gov, ruling: g.ruling };
  let best = null;
  for (const to of cands) {
    const T = P.types[to];
    c.gov = to; // policies kept: they can change without a reform, so they should not decide one
    g.ruling = T.ruling || (P.factions[saved.ruling]?.electable ? saved.ruling : bestElectable(rules, g.support));
    const fx = govEffects(rules, c);
    const t = factionTargets(state, rules, c, warScores, fx);
    const s = score(t) + backing(to) * 30 + (T.stability || 0) * 0.5;
    c.gov = saved.gov; g.ruling = saved.ruling;
    // rulers do not reform themselves out of favour
    if (t[saved.ruling] < now[saved.ruling] - 5) continue;
    if (!best || s > best.s) best = { to, s };
  }
  if (!best || best.s - base < G.aiReformGain || rand(state) > (G.aiReformChance ?? 1)) return;
  const name = P.types[best.to].name;
  if (!reformGovernment(state, rules, c.idx, best.to)) aiLog(state, c.idx, `Reformed into a ${name.toLowerCase()}: weighted faction approval and backing ${Math.round(base)} → ${Math.round(best.s)}.`);
}

// AI policy: once a year, look at two policy areas (in rotation) and adopt the single change
// that most raises support-weighted approval (the ruling faction counts double), if the gain is
// worth the legitimacy cost.
function aiPolicy(state, rules, c, warScores) {
  const { y, m } = civilFromDays(state.day);
  if ((c.idx + m) % 12 !== 0) return;
  const P = rules.politics, g = c.govt;
  if (state.day - g.policyDay < rules.balance.government.policyCooldownDays) return;
  const score = (t) => {
    let s = 0;
    for (const f in t) s += g.support[f] * t[f] * (f === g.ruling ? 2 : 1);
    return s;
  };
  const base = score(factionTargets(state, rules, c, warScores));
  let best = null;
  const n = P.policyIds.length;
  for (const grp of [P.policyIds[(y * 2 + c.idx) % n], P.policyIds[(y * 2 + c.idx + 1) % n]]) {
    for (const o of Object.keys(P.policies[grp].options)) {
      if (g.policies[grp] === o) continue;
      const saved = g.policies[grp];
      g.policies[grp] = o;
      const fx = govEffects(rules, c);
      g.policies[grp] = saved;
      let s = score(factionTargets(state, rules, c, warScores, fx));
      // practical effects matter too: manpower when at war, money when in deficit
      if (isAtWar(state, c.idx)) s += (fx.manpower - g.fx.manpower) * 6;
      if (c.ledger && c.ledger.net < 0) s += (fx.taxEff - g.fx.taxEff) * 60;
      s += (fx.stability - g.fx.stability) * 0.8;
      if (!best || s > best.s) best = { grp, o, s };
    }
  }
  if (!best || best.s - base < 3) return;
  const P2 = P.policies[best.grp];
  setPolicy(state, rules, c.idx, best.grp, best.o);
  aiLog(state, c.idx, `Adopted ${P2.options[best.o].name.toLowerCase()}: weighted faction approval ${Math.round(base)} → ${Math.round(best.s)}.`);
}
