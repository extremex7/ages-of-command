// Peacetime deals between countries: loans, ultimatums (demands without war), personal unions,
// selling, buying and giving provinces, gifts of money, and money for another country's rebels.
// Every offer is scored by the side that must agree, with the reasons listed like treaty
// proposals (evaluate* returns { accept, score, reasons }). AI recipients answer at once; the
// player gets the offer in the Diplomacy tab (state.dip.pending), and an ultimatum to the player
// counts as refused when its deadline passes.
//
// State (all created lazily, so older saves load unchanged): state.dip.loans, state.dip.support,
// state.dip.pending, state.dip.cbs (casus belli, diplomacy.js), c.rebelFund (derived monthly).
// Numbers: balance.json → deals. See docs/DIPLOMACY.md (Deals).
import { log, aiLog, refreshCountryCache, provinceGdp } from './state.js';
import { rand } from './rng.js';
import { atWar, allied, isAtWar, touchRelations } from './relations.js';
import { countryNeighbours } from './geo.js';
import { opinion, trust, addMod, addClaim, hasClaim, overlordOf, subjectsOf, followsOf, seniorOf, juniorsOf, findTreaty, removeTreaty,
  signTreaty, TREATIES, addCasusBelli, casusBelli, unionProblem, unionStrengthShare, formUnion } from './diplomacy.js';
import { transferProvince, eliminate } from './war.js';
import { govFamily } from './government.js';
import { warOdds } from './ai.js';

export const DEMAND_KINDS = ['provinces', 'money', 'subject'];
export const DEMAND_NAMES = { provinces: 'Cede provinces', money: 'Pay tribute', subject: 'Become our subject' };

// Money as the interface writes it (B = billions), for log lines.
export function fmtMoney(b) {
  const a = Math.abs(b);
  const s = a >= 1000 ? (a / 1000).toFixed(2) + 'T' : a >= 100 ? a.toFixed(0) + 'B' : a >= 1 ? a.toFixed(1) + 'B' : (a * 1000).toFixed(0) + 'M';
  return (b < 0 ? '−' : '') + s;
}
const pctTxt = (x) => `${Math.round(x * 1000) / 10}%`;

function dl(state) {
  const d = state.dip;
  d.loans ||= []; d.support ||= []; d.pending ||= [];
  return d;
}

// Monthly revenue (B), never zero.
export function revenueOf(c) {
  return Math.max(1e-4, c.ledger?.revenue ?? ((c.cache?.gdp || 0) * (c.tax || 0.2)) / 12);
}

function scorer() {
  const reasons = [];
  let score = 0;
  const add = (text, x) => { x = Math.round(x); if (!x) return; score += x; reasons.push([text, x]); };
  return { add, reasons, get score() { return score; } };
}

function verdict(sc, hard = false) {
  return { accept: !hard && sc.score > 0, score: hard ? Math.min(-100, sc.score) : sc.score, reasons: sc.reasons };
}

export function topReasons(ev, n = 3) {
  return ev.reasons.slice().sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, n).map(([t, v]) => `${t} ${v > 0 ? '+' : ''}${v}`).join(', ');
}

const involves = (state, ...ks) => ks.includes(state.player);
const playerDecides = (state, k) => k === state.player && !state.countries[k].automate;

function pend(state, rules, offer) {
  const d = dl(state);
  if (d.pending.some((o) => o.kind === offer.kind && o.from === offer.from && o.to === offer.to)) return { ok: false, reason: 'An offer of this kind is already waiting for an answer' };
  d.pending.push({ id: state.nextId++, day: state.day, deadline: state.day + (rules.balance.deals.demandDeadlineDays || 30), ...offer });
  return { ok: true, pending: true, reason: 'Offer sent; they will answer in the Diplomacy tab.' };
}

// ---------------------------------------------------------------------------------------------
// loans

// Equal monthly instalment repaying `amount` at `rate` a year over `months`.
export function loanPayment(amount, rate, months) {
  const r = rate / 12;
  return r > 0 ? (amount * r) / (1 - Math.pow(1 + r, -months)) : amount / months;
}

export function loansOf(state, k) {
  return (state.dip?.loans || []).filter((l) => l.lender === k || l.borrower === k);
}

// What k owes on loans (remaining principal) and pays on them each month.
export function debtService(state, k) {
  let owed = 0, pay = 0;
  for (const l of state.dip?.loans || []) if (l.borrower === k) { owed += l.principal; pay += l.pay; }
  return { owed, pay };
}

export function validateLoan(state, map, rules, lender, borrower, amount, rate, months) {
  const X = rules.balance.deals, C = state.countries;
  if (!X || !state.dip) return 'Loans are off';
  if (lender === borrower || !C[lender]?.alive || !C[borrower]?.alive) return 'Choose another country';
  if (atWar(state, lender, borrower)) return 'You are at war';
  if (!(amount > 0) || !(rate >= 0 && rate <= 0.5) || !(months >= 1 && months <= 240)) return 'Invalid terms';
  if (C[lender].treasury < amount) return `${C[lender].name} does not have ${fmtMoney(amount)} to lend (treasury ${fmtMoney(C[lender].treasury)})`;
  const rv = revenueOf(C[borrower]), ds = debtService(state, borrower);
  if (ds.owed + amount > X.loanMaxMonths * rv) return `${C[borrower].name} would owe more than ${X.loanMaxMonths} months of its revenue (${fmtMoney(X.loanMaxMonths * rv)})`;
  if (ds.pay + loanPayment(amount, rate, months) > X.loanMaxServiceShare * rv) return `Repayments would take more than ${Math.round(X.loanMaxServiceShare * 100)}% of ${C[borrower].name}'s revenue`;
  return null;
}

// The deciding side's view of a loan: the lender when asked for money, the borrower when offered it.
export function evaluateLoan(state, map, rules, lender, borrower, amount, rate, months, decider) {
  const why = validateLoan(state, map, rules, lender, borrower, amount, rate, months);
  if (why) return { accept: false, score: -999, reasons: [[why, 0]], invalid: why };
  const X = rules.balance.deals, C = state.countries, L = C[lender], B = C[borrower];
  const sc = scorer();
  const other = decider === lender ? borrower : lender;
  if (C[decider].rival === other || C[other].rival === decider) { sc.add('Rivals do not lend to each other', -100); return verdict(sc, true); }
  const pay = loanPayment(amount, rate, months);
  if (decider === lender) {
    const spare = L.treasury - amount - X.lenderReserveMonths * revenueOf(L);
    if (spare < 0) { sc.add(`Cannot spare ${fmtMoney(amount)} (keeps ${X.lenderReserveMonths} months of revenue in reserve)`, -100); return verdict(sc, true); }
    sc.add('Risk of lending abroad', -10);
    sc.add('Their opinion of you', opinion(state, map, rules, lender, borrower) * 0.4);
    sc.add('Their trust in you', (trust(state, rules, lender, borrower) - 50) * 0.5);
    // the rate they want: a base rate plus a premium for debt and existing repayments
    const debtMonths = Math.max(0, -B.treasury / revenueOf(B));
    const burden = (debtService(state, borrower).pay + pay) / revenueOf(B);
    const want = X.lenderBaseRate + Math.min(0.1, 0.02 * debtMonths) + Math.max(0, burden - 0.1) * 0.2;
    sc.add(`Interest ${pctTxt(rate)} against the ${pctTxt(want)} they want`, (rate - want) * 400);
    if (isAtWar(state, borrower)) sc.add('You are at war', -10);
    if ((L.cache?.gdp || 0) > (B.cache?.gdp || 0) * 2) sc.add('Influence over a smaller economy', 5);
  } else {
    sc.add('Taking on foreign debt', -5);
    const tm = B.treasury / revenueOf(B);
    if (tm < 0) sc.add('Needs money to pay its debts', 20 + Math.min(30, -tm * 5));
    else if (tm < 1) sc.add('Low reserves', 10);
    else sc.add('Does not need money', -15 - Math.min(20, tm * 2));
    const dr = rules.balance.economy.debtInterestYear;
    if (tm < 0) sc.add(`Interest ${pctTxt(rate)} against ${pctTxt(dr)} on its own debt`, (dr - rate) * 400);
    else sc.add(`Interest ${pctTxt(rate)}`, -rate * 300);
    sc.add('Their opinion of you', opinion(state, map, rules, borrower, lender) * 0.2);
    if (isAtWar(state, borrower)) sc.add('Money for the war', 10);
  }
  return verdict(sc);
}

// from proposes a loan to `to`: role 'lend' (from lends) or 'borrow' (from asks to borrow).
export function proposeLoan(state, map, rules, from, to, { role, amount, rate, months }) {
  const lender = role === 'lend' ? from : to, borrower = role === 'lend' ? to : from;
  const why = validateLoan(state, map, rules, lender, borrower, amount, rate, months);
  if (why) return { ok: false, reason: why };
  if (playerDecides(state, to)) {
    const r = pend(state, rules, { kind: 'loan', from, to, lender, borrower, amount, rate, months });
    if (r.ok) log(state, 'diplomacy', role === 'lend' ? `${state.countries[from].name} offers you a loan of ${fmtMoney(amount)} at ${pctTxt(rate)}.` : `${state.countries[from].name} asks you for a loan of ${fmtMoney(amount)} at ${pctTxt(rate)}.`, { important: true });
    return r;
  }
  const ev = evaluateLoan(state, map, rules, lender, borrower, amount, rate, months, to);
  const C = state.countries;
  if (!ev.accept) {
    state.dip.refused[`loan:${from}:${to}`] = state.day;
    return { ok: false, ev, reason: `${C[to].name} refused (${topReasons(ev)}).` };
  }
  makeLoan(state, rules, lender, borrower, amount, rate, months);
  return { ok: true, ev, reason: `${C[to].name} accepted (${topReasons(ev)}).` };
}

export function makeLoan(state, rules, lender, borrower, amount, rate, months) {
  const X = rules.balance.deals, C = state.countries;
  C[lender].treasury -= amount; C[borrower].treasury += amount;
  const l = { id: state.nextId++, lender, borrower, amount, principal: amount, rate, months, left: months, pay: loanPayment(amount, rate, months), missed: 0, start: state.day };
  dl(state).loans.push(l);
  addMod(state, borrower, lender, X.loanOpinion, rules.balance.diplomacy.modDecay, 'Lent us money');
  log(state, 'diplomacy', `${C[lender].name} lent ${fmtMoney(amount)} to ${C[borrower].name} at ${pctTxt(rate)} over ${Math.round(months / 12 * 10) / 10} years (${fmtMoney(l.pay)} a month).`, { important: involves(state, lender, borrower) });
  return l;
}

export function canRepay(state, loan, by) {
  if (!state.dip?.loans?.includes(loan)) return 'The loan is closed';
  if (by !== loan.borrower) return 'Only the borrower can repay';
  if (state.countries[by].treasury < loan.principal) return `Needs ${fmtMoney(loan.principal)} in the treasury`;
  return null;
}

// The borrower pays off what is left at once.
export function repayLoan(state, rules, loan, by) {
  const why = canRepay(state, loan, by);
  if (why) return why;
  const C = state.countries;
  C[loan.borrower].treasury -= loan.principal; C[loan.lender].treasury += loan.principal;
  closeLoan(state, loan);
  addMod(state, loan.lender, loan.borrower, 5, rules.balance.diplomacy.modDecay, 'Repaid a loan early');
  log(state, 'diplomacy', `${C[loan.borrower].name} repaid its loan from ${C[loan.lender].name} early (${fmtMoney(loan.principal)}).`, { important: involves(state, loan.lender, loan.borrower) });
  return null;
}

// The borrower refuses to pay any more: a default by choice, which costs more reputation.
export function repudiateLoan(state, map, rules, loan, by) {
  if (!state.dip?.loans?.includes(loan)) return 'The loan is closed';
  if (by !== loan.borrower) return 'Only the borrower can default';
  defaultLoan(state, rules, loan, true);
  return null;
}

function closeLoan(state, loan) {
  const l = state.dip.loans, i = l.indexOf(loan);
  if (i >= 0) l.splice(i, 1);
}

function defaultLoan(state, rules, loan, deliberate) {
  const X = rules.balance.deals, D = rules.balance.diplomacy, C = state.countries, a = loan.lender, b = loan.borrower;
  closeLoan(state, loan);
  C[b].reputation = Math.max(-100, C[b].reputation - (deliberate ? X.repudiateReputation : X.defaultReputation));
  C[b].loanDefaults = (C[b].loanDefaults || 0) + 1;
  addMod(state, a, b, X.defaultOpinion, D.grievanceDecay, 'Defaulted on our loan');
  addMod(state, a, b, X.defaultTrust, D.grievanceDecay, 'Defaulted on our loan', 't');
  addCasusBelli(state, a, b, X.defaultCbYears * 365, 'Defaulted on our loan');
  log(state, 'diplomacy', `${C[b].name} ${deliberate ? 'repudiated' : 'defaulted on'} its loan from ${C[a].name}, leaving ${fmtMoney(loan.principal)} unpaid. ${C[a].name} has a casus belli.`, { important: true });
}

// ---------------------------------------------------------------------------------------------
// ultimatums

// Provinces `from` may demand of `to`: `to`'s own, controlled, non-capital provinces that border
// `from` or that `from` claims, claims first, then by value.
export function demandableProvinces(state, map, rules, from, to) {
  const P = state.prov, C = state.countries, E = rules.balance.economy;
  const out = [];
  for (const i of map.ids) {
    if (P.owner[i] !== to || P.controller[i] !== to || i === C[to].capital) continue;
    let border = hasClaim(state, from, i);
    if (!border) for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) if (P.owner[map.adj[e]] === from) { border = true; break; }
    if (border) out.push(i);
  }
  return out.sort((x, y) => (hasClaim(state, from, y) - hasClaim(state, from, x)) || provinceGdp(state, y, E) - provinceGdp(state, x, E));
}

export function validateDemand(state, map, rules, from, to, d) {
  const X = rules.balance.deals, C = state.countries;
  if (!X || !state.dip) return 'Ultimatums are off';
  if (from === to || !C[from]?.alive || !C[to]?.alive) return 'Choose another country';
  if (atWar(state, from, to)) return 'Already at war';
  const tr = C[from].truces[to];
  if (tr != null && tr > state.day) return `Truce in force for ${tr - state.day} more days`;
  if (followsOf(state, from) >= 0) return `${C[from].name} follows the foreign policy of ${C[followsOf(state, from)].name}`;
  if (followsOf(state, to) === from) return `${C[to].name} already answers to you`;
  if (allied(state, from, to)) return 'Not against an ally';
  if ((state.dip.pending || []).some((o) => o.kind === 'demand' && o.from === from && o.to === to)) return 'An ultimatum is already waiting for an answer';
  const last = state.dip.refused[`demand:${from}:${to}`];
  if (last != null && state.day - last < X.demandCooldownDays) return `You made a demand of them ${state.day - last} days ago (wait ${X.demandCooldownDays})`;
  if (C[from].influence < X.demandInfluence) return `Needs ${X.demandInfluence} influence (you have ${Math.floor(C[from].influence)})`;
  if (!DEMAND_KINDS.includes(d?.kind)) return 'Choose a demand';
  if (d.kind === 'provinces') {
    const ps = d.provinces || [];
    if (!ps.length) return 'Choose the provinces to demand';
    if (ps.length > X.demandMaxProvinces) return `At most ${X.demandMaxProvinces} provinces at once`;
    const ok = new Set(demandableProvinces(state, map, rules, from, to));
    for (const p of ps) if (!ok.has(p)) return `${map.name[p] || 'That province'} cannot be demanded (only their border provinces and your claims, never the capital)`;
    if (ps.length >= C[to].cache.provinces) return 'They would have nothing left';
  } else if (d.kind === 'money') {
    if (!(d.amount > 0)) return 'Choose an amount';
  } else if (d.kind === 'subject') {
    if (followsOf(state, to) >= 0 || subjectsOf(state, to).length || juniorsOf(state, to).length) return `${C[to].name} already has an overlord, a senior partner, subjects or junior partners`;
    const mx = rules.balance.diplomacy.subjectMaxProvinces;
    if (C[to].cache.provinces > mx) return `${C[to].name} is too large to become a subject (${C[to].cache.provinces} provinces, max ${mx})`;
  }
  return null;
}

// The target's view: how the balance of force (counting who would join each side), its
// friends, its opinion of you and the size of the demand weigh against its pride.
export function evaluateDemand(state, map, rules, from, to, d, odds = null) {
  const why = validateDemand(state, map, rules, from, to, d);
  if (why) return { accept: false, score: -999, reasons: [[why, 0]], invalid: why };
  const C = state.countries, F = C[from], T = C[to], E = rules.balance.economy;
  const sc = scorer();
  sc.add('Yielding to threats', -25);
  const o = odds || warOdds(state, from, to);
  const ratio = o.mine / Math.max(1, o.theirs);
  sc.add(`Your strength against theirs with their friends (${ratio.toFixed(1)}×)`, Math.max(-60, Math.min(60, 30 * Math.log2(Math.max(0.01, ratio)))));
  if (o.joiners.length) sc.add(`Friends who would fight for them: ${o.joiners.slice(0, 3).map((k) => C[k].name).join(', ')}${o.joiners.length > 3 ? '…' : ''}`, -5 * Math.min(4, o.joiners.length));
  sc.add('Their opinion of you', opinion(state, map, rules, to, from) * 0.25);
  if (d.kind === 'provinces') {
    let g = 0, claimed = 0;
    for (const p of d.provinces) { g += provinceGdp(state, p, E); if (hasClaim(state, from, p)) claimed++; }
    const share = g / Math.max(1e-6, T.cache.gdp);
    sc.add(`Cede ${d.provinces.length} province(s), ${pctTxt(share)} of their economy`, -(10 * d.provinces.length + share * 300));
    if (claimed) sc.add('Your claims on them', 5 * claimed);
  } else if (d.kind === 'money') {
    const m = d.amount / revenueOf(T);
    sc.add(`Pay ${fmtMoney(d.amount)}, ${m.toFixed(1)} months of their revenue`, -8 * m);
    if (T.treasury < d.amount) sc.add('They would have to borrow it', -15);
  } else sc.add('Give up their foreign policy and pay tribute', -60);
  if (isAtWar(state, to)) sc.add('Already at war elsewhere', 15);
  const fw = F.strat?.warheads || 0, tw = T.strat?.warheads || 0;
  if (fw > 0 && !tw) sc.add('Your nuclear weapons', 15);
  if (tw > 0) sc.add('Their nuclear deterrent', -30);
  if (T.govt?.ruling === 'nationalists' || T.govt?.ruling === 'military') sc.add('Nationalist government', -10);
  if (T.stability < 30) sc.add('A shaky government avoids war', 10);
  if (F.reputation < -30) sc.add('They doubt you would stop there', -10);
  return { ...verdict(sc), ratio };
}

export function issueDemand(state, map, rules, from, to, d) {
  const why = validateDemand(state, map, rules, from, to, d);
  if (why) return { ok: false, reason: why };
  const X = rules.balance.deals, C = state.countries;
  // the AI answers first (the answer reads the demand as it is now, before any influence is spent)
  const ev = playerDecides(state, to) ? null : evaluateDemand(state, map, rules, from, to, d);
  C[from].influence -= X.demandInfluence;
  // a demand backed by claims, rivalry or a casus belli is not held against the demander
  const justified = C[from].rival === to || casusBelli(state, from, to) || C[from].claims.some((x) => state.prov.owner[x.p] === to);
  if (!justified) C[from].reputation = Math.max(-100, C[from].reputation - X.demandReputation);
  const offer = { kind: 'demand', from, to, demand: d.kind, provinces: d.provinces || [], amount: d.amount || 0 };
  const what = describeDemand(state, map, offer);
  if (playerDecides(state, to)) {
    dl(state).pending.push({ id: state.nextId++, day: state.day, deadline: state.day + X.demandDeadlineDays, ...offer });
    log(state, 'diplomacy', `Ultimatum from ${C[from].name}: ${what}. Answer within ${X.demandDeadlineDays} days or they gain a casus belli.`, { important: true });
    return { ok: true, pending: true, reason: 'Ultimatum sent.' };
  }
  if (ev.accept) { yieldDemand(state, map, rules, offer); return { ok: true, ev, reason: `${C[to].name} gave in (${topReasons(ev)}).` }; }
  refuseDemand(state, map, rules, offer);
  return { ok: false, ev, refused: true, reason: `${C[to].name} refused (${topReasons(ev)}). You have a casus belli for ${X.demandCbYears} years.` };
}

export function describeDemand(state, map, o) {
  if (o.demand === 'provinces') return `cede ${o.provinces.map((p) => map.name[p]).join(', ')}`;
  if (o.demand === 'money') return `pay ${fmtMoney(o.amount)}`;
  return 'become a subject';
}

function yieldDemand(state, map, rules, o) {
  const X = rules.balance.deals, D = rules.balance.diplomacy, C = state.countries, { from, to } = o;
  if (o.demand === 'provinces') {
    for (const p of o.provinces) {
      if (state.prov.owner[p] !== to) continue;
      transferProvince(state, map, p, from);
      addClaim(state, to, p);
      sendArmiesHome(state, to, p);
    }
    refreshCountryCache(state, map, rules);
  } else if (o.demand === 'money') {
    C[to].treasury -= o.amount; C[from].treasury += o.amount;
  } else {
    for (const t of [...state.dip.treaties]) if ((t.a === to || t.b === to) && !TREATIES[t.type].peaceOnly) removeTreaty(state, t);
    for (const al of state.alliances) if (al.members.includes(to)) al.members = al.members.filter((m) => m !== to);
    signTreaty(state, map, rules, 'subject', from, to, { quiet: true });
    touchRelations(state);
  }
  C[to].stability = Math.max(0, C[to].stability - X.yieldStability);
  addMod(state, to, from, X.yieldOpinion, D.grievanceDecay, 'Forced us to yield');
  log(state, 'diplomacy', `${C[to].name} yielded to the ultimatum of ${C[from].name} and agreed to ${describeDemand(state, map, o)}.`, { important: true });
}

function refuseDemand(state, map, rules, o) {
  const X = rules.balance.deals, C = state.countries, { from, to } = o;
  state.dip.refused[`demand:${from}:${to}`] = state.day;
  addCasusBelli(state, from, to, X.demandCbYears * 365, 'Refused our ultimatum');
  addMod(state, to, from, X.refuseOpinion, rules.balance.diplomacy.modDecay, 'Threatened us');
  log(state, 'diplomacy', `${C[to].name} rejected the ultimatum of ${C[from].name} (${describeDemand(state, map, o)}). ${C[from].name} has a casus belli.`, { important: true });
}

// Armies of `k` left in a province it no longer owns go to its capital.
function sendArmiesHome(state, k, p) {
  const cap = state.countries[k].capital;
  for (const a of state.armies) if (a.owner === k && a.loc === p && cap >= 0) { a.loc = cap; a.path = []; a.prog = 0; }
}

// ---------------------------------------------------------------------------------------------
// personal unions

const MONARCHY = ['const_monarchy', 'abs_monarchy'];

// The junior's view of a union offer.
export function evaluateUnion(state, map, rules, senior, junior) {
  const why = unionProblem(state, map, rules, senior, junior);
  if (why) return { accept: false, score: -999, reasons: [[why, 0]], invalid: why };
  const C = state.countries, S = C[senior], J = C[junior];
  const sc = scorer();
  if (J.rival === senior) { sc.add('They consider you their rival', -100); return verdict(sc, true); }
  sc.add('Gives up its own foreign policy', -45);
  sc.add('Their opinion of you', opinion(state, map, rules, junior, senior) * 0.6);
  sc.add('Their trust in you', (trust(state, rules, junior, senior) - 50) * 0.3);
  if (MONARCHY.includes(J.gov) && MONARCHY.includes(S.gov)) sc.add('Both crowns: a shared dynasty', 15);
  else if (govFamily(rules, J) === 'democracy' && !MONARCHY.includes(J.gov)) sc.add('Voters oppose a foreign head of state', -20);
  if (govFamily(rules, J) === govFamily(rules, S)) sc.add('Similar governments', 5);
  const R = J.rival;
  if (R >= 0 && C[R].alive && (C[R].cache?.armyPower || 0) > (J.cache?.armyPower || 0)) sc.add(`Protection from ${C[R].name}`, S.rival === R ? 30 : 20);
  if (isAtWar(state, junior) && !isAtWar(state, senior)) sc.add('Help in its war', 10);
  if (countryNeighbours(state, map).sets[junior]?.has(senior)) sc.add('Neighbours', 5);
  if (S.reputation < -30) sc.add('Your reputation', -10);
  return verdict(sc);
}

export function proposeUnion(state, map, rules, senior, junior) {
  const X = rules.balance.deals, C = state.countries;
  const why = unionProblem(state, map, rules, senior, junior);
  if (why) return { ok: false, reason: why };
  if (C[senior].influence < X.unionInfluence) return { ok: false, reason: `Needs ${X.unionInfluence} influence (you have ${Math.floor(C[senior].influence)})` };
  const last = state.dip.refused[`union:${senior}:${junior}`];
  if (last != null && state.day - last < rules.balance.diplomacy.refusalCooldownDays) return { ok: false, reason: 'They refused a union recently' };
  if (playerDecides(state, junior)) {
    const r = pend(state, rules, { kind: 'union', from: senior, to: junior });
    if (r.ok) { C[senior].influence -= X.unionInfluence; log(state, 'diplomacy', `${C[senior].name} offers a personal union under its crown.`, { important: true }); }
    return r;
  }
  C[senior].influence -= X.unionInfluence;
  const ev = evaluateUnion(state, map, rules, senior, junior);
  if (!ev.accept) { state.dip.refused[`union:${senior}:${junior}`] = state.day; return { ok: false, ev, reason: `${C[junior].name} refused (${topReasons(ev)}).` }; }
  formUnion(state, map, rules, senior, junior);
  return { ok: true, ev, reason: `${C[junior].name} accepted (${topReasons(ev)}).` };
}

export function unionYears(state, senior, junior) {
  const t = findTreaty(state, 'union', senior, junior);
  return t ? (state.day - t.start) / 365 : 0;
}

export function canIntegrate(state, map, rules, senior, junior) {
  const X = rules.balance.deals, C = state.countries;
  if (!X || !findTreaty(state, 'union', senior, junior)) return 'Not in a personal union';
  const y = unionYears(state, senior, junior);
  if (y < X.unionIntegrateYears) return `Only ${y.toFixed(1)} of ${X.unionIntegrateYears} years in the union`;
  const op = opinion(state, map, rules, junior, senior);
  if (op < X.unionIntegrateOpinion) return `${C[junior].name}'s opinion of you is ${Math.round(op)} (needs ${X.unionIntegrateOpinion})`;
  if (isAtWar(state, senior) || isAtWar(state, junior)) return 'Not while at war';
  if (C[senior].influence < X.unionIntegrateInfluence) return `Needs ${X.unionIntegrateInfluence} influence (you have ${Math.floor(C[senior].influence)})`;
  return null;
}

// The junior's land joins the senior's; the junior country ends.
export function integrateUnion(state, map, rules, senior, junior) {
  const why = canIntegrate(state, map, rules, senior, junior);
  if (why) return why;
  const X = rules.balance.deals, C = state.countries, name = C[junior].name;
  C[senior].influence -= X.unionIntegrateInfluence;
  C[senior].treasury += Math.max(0, C[junior].treasury);
  for (const a of state.armies) if (a.owner === junior) a.owner = senior;
  for (const f of state.fleets || []) if (f.owner === junior) f.owner = senior;
  for (const w of state.wings || []) if (w.owner === junior) w.owner = senior;
  state.fleetVer = (state.fleetVer || 0) + 1;
  log(state, 'diplomacy', `${C[senior].name} integrated ${name} after ${unionYears(state, senior, junior).toFixed(0)} years of personal union.`, { important: true });
  const ps = map.ids.filter((i) => state.prov.owner[i] === junior);
  for (const p of ps) transferProvince(state, map, p, senior);
  if (C[junior].alive) eliminate(state, map, junior);
  refreshCountryCache(state, map, rules);
  return null;
}

export function canBreakUnion(state, map, rules, junior) {
  const X = rules.balance.deals, C = state.countries;
  const s = state.dip ? seniorOf(state, junior) : -1;
  if (!X || s < 0) return 'Not a junior partner in a personal union';
  const op = opinion(state, map, rules, junior, s);
  if (op >= X.unionBreakOpinion && C[s].stability >= 25) return `Relations are too good to break away (your opinion of ${C[s].name} is ${Math.round(op)}, needs under ${X.unionBreakOpinion}, or their stability under 25)`;
  return null;
}

export function breakUnion(state, map, rules, junior) {
  const why = canBreakUnion(state, map, rules, junior);
  if (why) return why;
  const C = state.countries, s = seniorOf(state, junior), D = rules.balance.diplomacy;
  removeTreaty(state, findTreaty(state, 'union', s, junior));
  addMod(state, s, junior, -30, D.grievanceDecay, 'Broke our personal union');
  addCasusBelli(state, s, junior, rules.balance.deals.demandCbYears * 365, 'Broke our personal union');
  log(state, 'diplomacy', `${C[junior].name} broke away from its personal union with ${C[s].name}.`, { important: true });
  return null;
}

// ---------------------------------------------------------------------------------------------
// provinces and money

// What a province is worth in money: saleValueYears of the tax it brings.
export function provinceWorth(state, rules, p) {
  const o = state.prov.owner[p], tax = o >= 0 ? state.countries[o].tax : rules.balance.economy.defaultTax;
  return provinceGdp(state, p, rules.balance.economy) * tax * rules.balance.deals.saleValueYears;
}

// Provinces `seller` could hand to `buyer`: its controlled non-capital provinces bordering
// `buyer`, and `buyer`'s claims it holds.
export function tradableProvinces(state, map, rules, seller, buyer) {
  return demandableProvinces(state, map, rules, buyer, seller);
}

function landBorders(state, map, p, k) {
  for (let e = map.adjStart[p]; e < map.adjStart[p + 1]; e++) if (state.prov.owner[map.adj[e]] === k) return true;
  return false;
}

export function validateSale(state, map, rules, seller, buyer, p, price) {
  const X = rules.balance.deals, C = state.countries;
  if (!X || !state.dip) return 'Province deals are off';
  if (seller === buyer || !C[seller]?.alive || !C[buyer]?.alive) return 'Choose another country';
  if (atWar(state, seller, buyer)) return 'You are at war';
  if (!map.exists[p] || state.prov.owner[p] !== seller) return `${C[seller].name} does not own that province`;
  if (state.prov.controller[p] !== seller) return 'The province is occupied';
  if (p === C[seller].capital) return 'A capital cannot change hands';
  if (C[seller].cache.provinces <= 1) return `It is all ${C[seller].name} has`;
  const f = followsOf(state, seller);
  if (f >= 0 && f !== buyer) return `${C[seller].name} answers to ${C[f].name} and can only cede land to it`;
  if (!landBorders(state, map, p, buyer) && !hasClaim(state, buyer, p)) return `${map.name[p]} does not border ${C[buyer].name} (and is not its claim)`;
  if (price > 0 && C[buyer].treasury < price) return `${C[buyer].name} cannot pay ${fmtMoney(price)} (treasury ${fmtMoney(C[buyer].treasury)})`;
  if (price < 0) return 'Invalid price';
  return null;
}

// The deciding side's view of a province sale (price 0 is a gift).
export function evaluateSale(state, map, rules, seller, buyer, p, price, decider) {
  const why = validateSale(state, map, rules, seller, buyer, p, price);
  if (why) return { accept: false, score: -999, reasons: [[why, 0]], invalid: why };
  const C = state.countries, S = C[seller], B = C[buyer], E = rules.balance.economy;
  const sc = scorer();
  const worth = provinceWorth(state, rules, p);
  const r = price / Math.max(1e-6, worth);
  if (decider === seller) {
    if (S.rival === buyer) { sc.add('They will not sell land to their rival', -100); return verdict(sc, true); }
    sc.add('Reluctance to give up land', -20);
    sc.add(`Price ${fmtMoney(price)} against a value of ${fmtMoney(worth)}`, (r - 1) * 60);
    sc.add(`${pctTxt(provinceGdp(state, p, E) / Math.max(1e-6, S.cache.gdp))} of their economy`, -(provinceGdp(state, p, E) / Math.max(1e-6, S.cache.gdp)) * 200);
    if (S.govt?.ruling === 'nationalists') sc.add('Nationalist government', -20);
    else if (govFamily(rules, S) === 'democracy') sc.add('Voters dislike selling land', -5);
    if (hasClaim(state, buyer, p)) sc.add('Ends a lasting dispute (you claim it)', 10);
    if (S.treasury < 0) sc.add('Needs money for its debts', Math.min(30, (-S.treasury / revenueOf(S)) * 3));
    sc.add('Their opinion of you', opinion(state, map, rules, seller, buyer) * 0.2);
  } else {
    if (B.rival === seller && price > 0) { sc.add('They will not pay their rival', -100); return verdict(sc, true); }
    if (price === 0) sc.add('Free land', 20);
    else {
      sc.add('Buying land is a gamble', -5);
      sc.add(`Price ${fmtMoney(price)} against a value of ${fmtMoney(worth)}`, (1 - r) * 60);
      const left = (B.treasury - price) / revenueOf(B);
      if (left < rules.balance.deals.ai.reserveMonths) sc.add(`Leaves only ${Math.max(0, left).toFixed(1)} months of revenue in their treasury`, -15 - Math.min(30, (rules.balance.deals.ai.reserveMonths - left) * 5));
    }
    if (landBorders(state, map, p, buyer)) sc.add('Borders their land', 10);
    else sc.add('Cut off from their land', -15);
    if (hasClaim(state, buyer, p)) sc.add('Their former land', 20);
    sc.add('Their opinion of you', opinion(state, map, rules, buyer, seller) * 0.1);
  }
  return verdict(sc);
}

// from offers `to` a province deal: role 'sell' (from sells p to `to`), 'buy' (from buys p from
// `to`) or 'give' (from gives p to `to` for nothing).
export function proposeSale(state, map, rules, from, to, { role, p, price = 0 }) {
  const seller = role === 'buy' ? to : from, buyer = role === 'buy' ? from : to;
  if (role === 'give') price = 0;
  const why = validateSale(state, map, rules, seller, buyer, p, price);
  if (why) return { ok: false, reason: why };
  const C = state.countries;
  if (playerDecides(state, to)) {
    const r = pend(state, rules, { kind: 'sale', from, to, seller, buyer, p, price });
    if (r.ok) log(state, 'diplomacy', role === 'buy' ? `${C[from].name} offers ${fmtMoney(price)} for ${map.name[p]}.` : role === 'give' ? `${C[from].name} offers you ${map.name[p]} as a gift.` : `${C[from].name} offers to sell you ${map.name[p]} for ${fmtMoney(price)}.`, { important: true });
    return r;
  }
  const ev = evaluateSale(state, map, rules, seller, buyer, p, price, to);
  if (!ev.accept) { state.dip.refused[`sale:${from}:${to}`] = state.day; return { ok: false, ev, reason: `${C[to].name} refused (${topReasons(ev)}).` }; }
  executeSale(state, map, rules, seller, buyer, p, price);
  return { ok: true, ev, reason: `${C[to].name} accepted (${topReasons(ev)}).` };
}

export function executeSale(state, map, rules, seller, buyer, p, price) {
  const X = rules.balance.deals, C = state.countries, D = rules.balance.diplomacy;
  C[buyer].treasury -= price; C[seller].treasury += price;
  transferProvince(state, map, p, buyer);
  sendArmiesHome(state, seller, p);
  refreshCountryCache(state, map, rules);
  if (price === 0) addMod(state, buyer, seller, X.landGiftOpinion, D.modDecay, 'Gave us land');
  else addMod(state, buyer, seller, 5, D.modDecay, 'Sold us land');
  log(state, 'diplomacy', price ? `${C[seller].name} sold ${map.name[p]} to ${C[buyer].name} for ${fmtMoney(price)}.` : `${C[seller].name} gave ${map.name[p]} to ${C[buyer].name}.`, { important: involves(state, seller, buyer) });
}

export function canSendMoney(state, rules, from, to, amount) {
  const C = state.countries;
  if (!rules.balance.deals || !state.dip) return 'Gifts are off';
  if (from === to || !C[from]?.alive || !C[to]?.alive) return 'Choose another country';
  if (atWar(state, from, to)) return 'You are at war';
  if (!(amount > 0)) return 'Choose an amount';
  if (C[from].treasury < amount) return `Needs ${fmtMoney(amount)} in the treasury (you have ${fmtMoney(C[from].treasury)})`;
  return null;
}

// Opinion a gift of `amount` buys: per month of the recipient's revenue, up to a cap.
export function giftOpinion(state, rules, to, amount) {
  const X = rules.balance.deals;
  return Math.min(X.giftOpinionMax, (amount / revenueOf(state.countries[to])) * X.giftOpinionPerMonth);
}

export function sendMoney(state, rules, from, to, amount) {
  const why = canSendMoney(state, rules, from, to, amount);
  if (why) return why;
  const C = state.countries;
  C[from].treasury -= amount; C[to].treasury += amount;
  const v = giftOpinion(state, rules, to, amount);
  if (v >= 1) addMod(state, to, from, Math.round(v), rules.balance.diplomacy.modDecay, 'Sent us money');
  log(state, 'diplomacy', `${C[from].name} sent ${fmtMoney(amount)} to ${C[to].name}.`, { important: involves(state, from, to) });
  return null;
}

// ---------------------------------------------------------------------------------------------
// support for rebels

// The rising against `target`'s government, if any: { war, rebels }.
export function rebelSide(state, target) {
  const w = state.wars.find((x) => x.kind === 'civil' && x.leaderD === target);
  return w ? { war: w, rebels: w.leaderA } : null;
}

export function supportOf(state, from, target) {
  return (state.dip?.support || []).find((s) => s.from === from && s.target === target) || null;
}

export function supportCost(state, rules, target, level) {
  return rules.balance.deals.rebelLevels[level] * revenueOf(state.countries[target]);
}

export function validateSupport(state, rules, from, target, level) {
  const X = rules.balance.deals, C = state.countries;
  if (!X || !state.dip) return 'Rebel support is off';
  if (from === target || !C[from]?.alive || !C[target]?.alive) return 'Choose another country';
  if (!(level >= 0 && level < X.rebelLevels.length)) return 'Invalid level';
  if (allied(state, from, target)) return 'Not against an ally';
  const rs = rebelSide(state, target);
  if (rs && rs.rebels === from) return 'You are the rebels';
  if (rs && atWar(state, from, rs.rebels)) return 'You are at war with the rebels';
  const cost = supportCost(state, rules, target, level);
  if (C[from].treasury < cost) return `Needs ${fmtMoney(cost)} a month (treasury ${fmtMoney(C[from].treasury)})`;
  return null;
}

// What funding at `level` would do: monthly cost, monthly chance of being found out, and
// either the stability lost and the civil-war chance multiplier, or the militia chance.
export function supportOdds(state, rules, from, target, level) {
  const X = rules.balance.deals, C = state.countries;
  return {
    cost: supportCost(state, rules, target, level),
    detect: Math.min(0.9, X.rebelDetect[level] + (C[target].spy?.counter ? X.rebelCounterDetect : 0)),
    stability: X.rebelStability[level], chanceMult: 1 + X.rebelChanceBoost[level], militia: X.rebelMilitiaChance[level],
    rebels: rebelSide(state, target)?.rebels ?? -1,
  };
}

// Starts, changes (level) or stops (level < 0) funding the rebels against `target`.
export function setSupport(state, rules, from, target, level) {
  const C = state.countries;
  const cur = supportOf(state, from, target);
  if (level < 0) {
    if (cur) { dl(state).support.splice(state.dip.support.indexOf(cur), 1); if (involves(state, from)) log(state, 'diplomacy', `${C[from].name} stopped funding rebels in ${C[target].name}.`); }
    return null;
  }
  const why = validateSupport(state, rules, from, target, level);
  if (why) return why;
  if (cur) cur.level = level;
  else dl(state).support.push({ id: state.nextId++, from, target, level, start: state.day, detected: false });
  if (involves(state, from)) log(state, 'diplomacy', `${C[from].name} is secretly funding rebels in ${C[target].name} (${fmtMoney(supportCost(state, rules, target, level))} a month).`);
  return null;
}

// ---------------------------------------------------------------------------------------------
// answering offers (the player)

export function pendingFor(state, k) {
  return (state.dip?.pending || []).filter((o) => o.to === k);
}

// The player accepts a pending offer. Returns an error string or null.
export function acceptPending(state, map, rules, o) {
  const d = dl(state);
  d.pending = d.pending.filter((x) => x !== o);
  const C = state.countries;
  if (!C[o.from]?.alive || !C[o.to]?.alive) return 'The other country no longer exists';
  if (o.kind === 'loan') {
    const why = validateLoan(state, map, rules, o.lender, o.borrower, o.amount, o.rate, o.months);
    if (why) return why;
    makeLoan(state, rules, o.lender, o.borrower, o.amount, o.rate, o.months);
  } else if (o.kind === 'demand') {
    const why = o.demand === 'provinces' && o.provinces.some((p) => state.prov.owner[p] !== o.to) ? 'You no longer hold those provinces' : null;
    if (why) return why;
    yieldDemand(state, map, rules, o);
  } else if (o.kind === 'union') {
    const why = unionProblem(state, map, rules, o.from, o.to);
    if (why) return why;
    formUnion(state, map, rules, o.from, o.to);
  } else if (o.kind === 'sale') {
    const why = validateSale(state, map, rules, o.seller, o.buyer, o.p, o.price);
    if (why) return why;
    executeSale(state, map, rules, o.seller, o.buyer, o.p, o.price);
  }
  return null;
}

export function declinePending(state, map, rules, o) {
  const d = dl(state);
  d.pending = d.pending.filter((x) => x !== o);
  if (o.kind === 'demand') { refuseDemand(state, map, rules, o); return; }
  state.dip.refused[`${o.kind}:${o.from}:${o.to}`] = state.day;
  addMod(state, o.from, o.to, -5, rules.balance.diplomacy.modDecay, 'Rejected our proposal');
}

// Daily (cheap: only the few pending offers): unanswered ultimatums count as refused when their
// deadline passes; other offers lapse.
export function expireDeals(state, map, rules) {
  const l = state.dip?.pending;
  if (!l?.length) return;
  for (const o of [...l]) {
    const gone = !state.countries[o.from]?.alive || !state.countries[o.to]?.alive;
    if (!gone && state.day < o.deadline) continue;
    state.dip.pending = state.dip.pending.filter((x) => x !== o);
    if (!gone && o.kind === 'demand') { log(state, 'diplomacy', `The deadline of ${state.countries[o.from].name}'s ultimatum has passed.`, { important: true }); refuseDemand(state, map, rules, o); }
  }
}

// ---------------------------------------------------------------------------------------------
// monthly: loan repayments, rebel funding, expired casus belli

export function monthlyDeals(state, map, rules) {
  const X = rules.balance.deals;
  if (!X || !state.dip) return;
  const C = state.countries, D = rules.balance.diplomacy;
  for (const l of [...(state.dip.loans || [])]) {
    const L = C[l.lender], B = C[l.borrower];
    if (!L?.alive || !B?.alive) {
      closeLoan(state, l);
      if (L?.alive && !B?.alive) log(state, 'diplomacy', `${B.name} no longer exists: its loan from ${L.name} (${fmtMoney(l.principal)}) is lost.`, { important: involves(state, l.lender) });
      continue;
    }
    // a borrower pays while its debt after paying stays within loanPayDebtMonths of revenue
    if (B.treasury - l.pay >= -X.loanPayDebtMonths * revenueOf(B)) {
      B.treasury -= l.pay; L.treasury += l.pay;
      l.principal = Math.max(0, l.principal * (1 + l.rate / 12) - l.pay);
      l.left--; l.missed = 0;
      if (l.left <= 0 || l.principal < 1e-6) {
        closeLoan(state, l);
        addMod(state, l.lender, l.borrower, 5, D.modDecay, 'Repaid a loan');
        log(state, 'diplomacy', `${B.name} has repaid its loan from ${L.name}.`, { important: involves(state, l.lender, l.borrower) });
      }
    } else if (++l.missed >= X.missedToDefault) defaultLoan(state, rules, l, false);
    else log(state, 'diplomacy', `${B.name} missed a repayment of ${fmtMoney(l.pay)} to ${L.name} (${l.missed} of ${X.missedToDefault} before default).`, { important: involves(state, l.lender, l.borrower) });
  }
  for (const c of C) if (c.rebelFund) c.rebelFund = 0;
  for (const s of [...(state.dip.support || [])]) {
    const F = C[s.from], T = C[s.target];
    const stop = (why) => { state.dip.support.splice(state.dip.support.indexOf(s), 1); if (why) log(state, 'diplomacy', why, { important: involves(state, s.from, s.target) }); };
    if (!F?.alive || !T?.alive) { stop(null); continue; }
    if (allied(state, s.from, s.target)) { stop(`${F.name} stopped funding rebels in its ally ${T.name}.`); continue; }
    const cost = supportCost(state, rules, s.target, s.level);
    if (F.treasury < cost) { stop(`${F.name} ran out of money to fund rebels in ${T.name}.`); continue; }
    F.treasury -= cost;
    const rs = rebelSide(state, s.target);
    if (rs && C[rs.rebels].alive && !atWar(state, s.from, rs.rebels)) {
      const R = C[rs.rebels];
      R.treasury += cost;
      R.manpower += cost * 2e5; // men a year of a rebel's pay buys, roughly
      s.war = rs.war.id; s.rebels = rs.rebels;
      if (rand(state) < X.rebelMilitiaChance[s.level]) {
        const a = state.armies.filter((x) => x.owner === rs.rebels).sort((x, y) => Object.values(y.units).reduce((p, q) => p + q, 0) - Object.values(x.units).reduce((p, q) => p + q, 0))[0];
        if (a) { const t = Object.keys(a.units).sort((x, y) => a.units[y] - a.units[x])[0]; if (t) a.units[t]++; }
      }
      addMod(state, rs.rebels, s.from, 10, D.modDecay, 'Funds our struggle');
    } else {
      // the rising is over: rebels that won remember who paid for it
      if (s.war != null && C[s.rebels]?.alive && !state.wars.some((w) => w.id === s.war)) {
        addMod(state, s.rebels, s.from, X.rebelGratitude, D.grievanceDecay, 'Backed our independence');
        s.war = null;
      }
      T.stability = Math.max(0, T.stability - X.rebelStability[s.level]);
      T.rebelFund = (T.rebelFund || 0) + X.rebelChanceBoost[s.level];
    }
    if (rand(state) < supportOdds(state, rules, s.from, s.target, s.level).detect) {
      addMod(state, s.target, s.from, X.rebelOpinion, D.grievanceDecay, 'Funded rebels against us');
      addMod(state, s.target, s.from, X.rebelTrust, D.grievanceDecay, 'Funded rebels against us', 't');
      addCasusBelli(state, s.target, s.from, X.rebelCbYears * 365, 'Funded rebels against us');
      if (!s.detected) log(state, 'diplomacy', `${T.name} has uncovered ${F.name}'s money for its rebels. ${T.name} has a casus belli.`, { important: true });
      s.detected = true;
    }
  }
  if (state.dip.cbs) state.dip.cbs = state.dip.cbs.filter((x) => x.until > state.day && C[x.a]?.alive && C[x.b]?.alive);
}
