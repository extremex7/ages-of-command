import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { declareWar, canDeclareWar, warJustified, validatePeace, makePeace, warJoiners } from '../src/core/war.js';
import { allied, atWar } from '../src/core/relations.js';
import { addMod, validateTreaty, findTreaty, seniorOf, juniorsOf, casusBelli, opinion, formUnion } from '../src/core/diplomacy.js';
import { applyEffects } from '../src/core/events.js';
import { civilWarChance, startCivilWar } from '../src/core/civilwar.js';
import {
  revenueOf, loanPayment, makeLoan, validateLoan, evaluateLoan, proposeLoan, monthlyDeals, repudiateLoan, debtService,
  validateDemand, evaluateDemand, issueDemand, demandableProvinces, acceptPending, declinePending, expireDeals, pendingFor,
  evaluateUnion, proposeUnion, canIntegrate, integrateUnion, canBreakUnion, breakUnion,
  tradableProvinces, provinceWorth, evaluateSale, proposeSale, sendMoney,
  setSupport, validateSupport, supportOdds, supportOf,
} from '../src/core/deals.js';
import { aiDeals } from '../src/core/ai_deals.js';

const quiet = (player = null) => { const g = game({ settings: { aiAggression: 0 }, player }); runDays(g, 1); return g; };
const T = (g, tag) => tagIdx(g, tag);

test('loans: validation and the lender\'s reasons; monthly repayments with interest until repaid', () => {
  const g = quiet(), { state: s, map, rules: r } = g, C = s.countries, X = r.balance.deals;
  const usa = T(g, 'USA'), mex = T(g, 'MEX');
  C[usa].treasury = revenueOf(C[usa]) * 10;
  const amount = revenueOf(C[mex]) * 3;
  assert.match(validateLoan(s, map, r, usa, mex, revenueOf(C[mex]) * (X.loanMaxMonths + 1), 0.06, 60), /owe more/);
  assert.match(validateLoan(s, map, r, mex, usa, C[mex].treasury + 1e6, 0.06, 60), /does not have/);
  const lowRate = evaluateLoan(s, map, r, usa, mex, amount, 0.0, 60, usa), highRate = evaluateLoan(s, map, r, usa, mex, amount, 0.1, 60, usa);
  assert.ok(highRate.score > lowRate.score, 'a higher rate pleases the lender');
  assert.ok(highRate.reasons.some(([t]) => /Interest/.test(t)), 'the rate is one of the visible reasons');
  addMod(s, usa, mex, 60, 0.1, 'Test friendship');
  const res = proposeLoan(s, map, r, mex, usa, { role: 'borrow', amount, rate: 0.1, months: 24 });
  assert.ok(res.ok, res.reason);
  const loan = s.dip.loans[0];
  assert.ok(Math.abs(loan.pay - loanPayment(amount, 0.1, 24)) < 1e-9);
  assert.ok(opinion(s, map, r, mex, usa) > 0, 'the borrower is grateful');
  const t0 = C[usa].treasury;
  monthlyDeals(s, map, r);
  assert.ok(Math.abs(C[usa].treasury - t0 - loan.pay) < 1e-9, 'one instalment reached the lender');
  assert.ok(loan.principal < amount && loan.left === 23);
  for (let i = 0; i < 23; i++) { C[mex].treasury = Math.max(C[mex].treasury, loan.pay * 2); monthlyDeals(s, map, r); }
  assert.equal(s.dip.loans.length, 0, 'repaid after the term');
  assert.ok(s.log.some((l) => /has repaid its loan/.test(l.text)));
});

test('loans: a borrower deep in debt misses payments and defaults; the lender gets a casus belli', () => {
  const g = quiet(), { state: s, map, rules: r } = g, C = s.countries, X = r.balance.deals;
  const deu = T(g, 'DEU'), pol = T(g, 'POL');
  C[deu].treasury = revenueOf(C[deu]) * 10;
  makeLoan(s, r, deu, pol, revenueOf(C[pol]), 0.06, 60);
  const rep = C[pol].reputation;
  for (let i = 0; i < X.missedToDefault; i++) { C[pol].treasury = -revenueOf(C[pol]) * (X.loanPayDebtMonths + 2); monthlyDeals(s, map, r); }
  assert.equal(s.dip.loans.length, 0, 'the loan is gone');
  assert.ok(C[pol].reputation < rep, 'reputation lost');
  assert.ok(casusBelli(s, deu, pol), 'lender has a casus belli');
  assert.ok(warJustified(s, deu, pol), 'a war over the default is justified');
  // repudiating on purpose costs more reputation
  s.dip.loans.push({ id: 2, lender: deu, borrower: pol, amount: 1, principal: 1, rate: 0.06, months: 60, left: 60, pay: 0.1, missed: 0, start: s.day });
  const r2 = C[pol].reputation;
  assert.equal(repudiateLoan(s, map, r, s.dip.loans[0], pol), null);
  assert.ok(r2 - C[pol].reputation >= Math.min(X.repudiateReputation, r2 + 100) - 1e-9);
});

test('ultimatums: a weak neighbour yields to a strong one; a strong one refuses and the demander gains a casus belli', () => {
  const g = quiet(), { state: s, map, rules: r } = g, C = s.countries;
  const ind = T(g, 'IND'), npl = T(g, 'NPL');
  C[ind].influence = C[npl].influence = 100;
  const d = { kind: 'money', amount: revenueOf(C[npl]) };
  const ev = evaluateDemand(s, map, r, ind, npl, d);
  assert.ok(ev.reasons.some(([t]) => /strength/.test(t)), 'the balance of force is a visible reason');
  assert.ok(ev.ratio > 3);
  const tInd = C[ind].treasury, tNpl = C[npl].treasury, st = C[npl].stability;
  const res = issueDemand(s, map, r, ind, npl, d);
  if (ev.accept) {
    assert.ok(res.ok, res.reason);
    assert.ok(Math.abs(C[ind].treasury - tInd - d.amount) < 1e-9 && C[npl].treasury < tNpl && C[npl].stability < st);
  } else assert.ok(res.refused);
  assert.match(validateDemand(s, map, r, ind, npl, d), /recently|days ago|influence/);
  // the other way round: Nepal demands land from India and is refused
  const ps = demandableProvinces(s, map, r, npl, ind);
  assert.ok(ps.length && !ps.includes(C[ind].capital));
  const r2 = issueDemand(s, map, r, npl, ind, { kind: 'provinces', provinces: ps.slice(0, 1) });
  assert.ok(!r2.ok && r2.refused, r2.reason);
  assert.ok(casusBelli(s, npl, ind) && warJustified(s, npl, ind));
  assert.match(validateDemand(s, map, r, npl, ind, { kind: 'provinces', provinces: ps.slice(0, 5) }), /At most|recently|days ago|influence/);
});

test('ultimatums to the player wait for an answer; the deadline counts as a refusal; yielding cedes the land', () => {
  const g = quiet('NPL'), { state: s, map, rules: r } = g, C = s.countries;
  const ind = T(g, 'IND'), npl = T(g, 'NPL');
  C[ind].influence = 100;
  const ps = demandableProvinces(s, map, r, ind, npl).slice(0, 1);
  const res = issueDemand(s, map, r, ind, npl, { kind: 'provinces', provinces: ps });
  assert.ok(res.pending);
  assert.equal(pendingFor(s, npl).length, 1);
  assert.equal(acceptPending(s, map, r, pendingFor(s, npl)[0]), null);
  assert.equal(s.prov.owner[ps[0]], ind, 'the province changed hands');
  assert.ok(C[npl].claims.some((x) => x.p === ps[0]), 'and became a claim');
  // a second ultimatum, from another country, left unanswered
  const chn = T(g, 'CHN');
  C[chn].influence = 100;
  issueDemand(s, map, r, chn, npl, { kind: 'money', amount: 0.01 });
  s.day += r.balance.deals.demandDeadlineDays + 1;
  expireDeals(s, map, r);
  assert.equal(pendingFor(s, npl).length, 0);
  assert.ok(casusBelli(s, chn, npl), 'silence counts as a refusal');
});

test('personal unions: offer, shared foreign policy, wars, integration and breaking away', () => {
  const g = quiet(), { state: s, map, rules: r } = g, C = s.countries, X = r.balance.deals;
  const bel = T(g, 'BEL'), lux = T(g, 'LUX'), fra = T(g, 'FRA');
  assert.match(evaluateUnion(s, map, r, lux, bel).invalid, /not much weaker/);
  C[bel].influence = 100;
  addMod(s, lux, bel, 80, 0.01, 'Test friendship');
  const ev = evaluateUnion(s, map, r, bel, lux);
  assert.ok(ev.accept, JSON.stringify(ev.reasons));
  assert.ok(ev.reasons.some(([t]) => /dynasty|head of state/.test(t)));
  assert.ok(proposeUnion(s, map, r, bel, lux).ok);
  assert.equal(seniorOf(s, lux), bel);
  assert.deepEqual(juniorsOf(s, bel), [lux]);
  assert.ok(allied(s, bel, lux));
  assert.match(validateTreaty(s, map, r, 'trade', lux, T(g, 'USA')), /personal union/);
  assert.match(canDeclareWar(s, map, lux, T(g, 'DEU')), /personal union/);
  assert.match(canDeclareWar(s, map, bel, lux), /junior partner/);
  assert.ok(warJoiners(s, T(g, 'RUS'), bel).includes(lux), 'the junior defends its senior');
  assert.ok(warJoiners(s, T(g, 'RUS'), lux).includes(bel), 'and the senior its junior');
  // integration needs years of good relations
  assert.match(canIntegrate(s, map, r, bel, lux), /years/);
  findTreaty(s, 'union', bel, lux).start -= X.unionIntegrateYears * 365 + 1;
  assert.equal(canIntegrate(s, map, r, bel, lux), null);
  const provs = map.ids.filter((i) => s.prov.owner[i] === lux);
  assert.equal(integrateUnion(s, map, r, bel, lux), null);
  assert.ok(!C[lux].alive && provs.every((i) => s.prov.owner[i] === bel));
  // breaking away: only when relations have soured
  formUnion(s, map, r, fra, T(g, 'MCO'));
  const j = juniorsOf(s, fra)[0];
  assert.match(canBreakUnion(s, map, r, j), /too good/);
  addMod(s, j, fra, -150, 0.01, 'Test grievance');
  assert.equal(canBreakUnion(s, map, r, j), null);
  assert.equal(breakUnion(s, map, r, j), null);
  assert.equal(seniorOf(s, j), -1);
  assert.ok(casusBelli(s, fra, j));
});

test('personal unions: juniors follow the senior into its wars, as a peace term, and by event', () => {
  const g = quiet(), { state: s, map, rules: r } = g, C = s.countries;
  const bel = T(g, 'BEL'), lux = T(g, 'LUX');
  formUnion(s, map, r, bel, lux);
  const target = T(g, 'NGA');
  assert.equal(declareWar(s, map, r, bel, target), null);
  const w = s.wars.at(-1);
  assert.ok(w.attackers.includes(lux), 'the junior joined');
  // as a peace term, in a fresh game
  const g2 = quiet(), s2 = g2.state, r2 = g2.rules;
  const tha = T(g2, 'THA'), khm = T(g2, 'KHM');
  declareWar(s2, g2.map, r2, tha, khm);
  const war = s2.wars.at(-1);
  for (const i of g2.map.ids) if (s2.prov.owner[i] === khm) s2.prov.controller[i] = tha;
  assert.equal(validatePeace(s2, g2.map, r2, war, tha, { provinces: [], union: true }), null);
  makePeace(s2, g2.map, r2, war, tha, { provinces: [], union: true });
  assert.equal(seniorOf(s2, khm), tha);
  assert.ok(!atWar(s2, tha, khm));
  // event effect
  const g3 = quiet(), s3 = g3.state;
  const den = T(g3, 'DNK');
  applyEffects(s3, g3.map, g3.rules, s3.countries[den], { union: { with: 'ISL' } });
  assert.equal(seniorOf(s3, T(g3, 'ISL')), den, 'Iceland joins Denmark by event');
});

test('province deals: sell, buy and give border provinces; gifts of money buy opinion', () => {
  const g = quiet(), { state: s, map, rules: r } = g, C = s.countries;
  const fra = T(g, 'FRA'), esp = T(g, 'ESP');
  const ps = tradableProvinces(s, map, r, fra, esp);
  assert.ok(ps.length && !ps.includes(C[fra].capital));
  const p = ps.at(-1), worth = provinceWorth(s, r, p);
  assert.ok(worth > 0);
  C[esp].treasury = worth * 5;
  const cheap = evaluateSale(s, map, r, fra, esp, p, worth * 0.5, esp), dear = evaluateSale(s, map, r, fra, esp, p, worth * 2, esp);
  assert.ok(cheap.score > dear.score, 'the buyer prefers a lower price');
  const res = proposeSale(s, map, r, fra, esp, { role: 'sell', p, price: worth * 0.5 });
  assert.ok(res.ok, res.reason);
  assert.equal(s.prov.owner[p], esp);
  // the seller is reluctant: Spain asks France for a province at half price
  const q = tradableProvinces(s, map, r, fra, esp)[0];
  const ask = evaluateSale(s, map, r, fra, esp, q, provinceWorth(s, r, q) * 0.5, fra);
  assert.ok(!ask.accept && ask.reasons.some(([t]) => /Reluctance/.test(t)));
  // give one back for nothing
  const back = tradableProvinces(s, map, r, esp, fra).find((x) => x === p) ?? tradableProvinces(s, map, r, esp, fra)[0];
  const op = opinion(s, map, r, fra, esp);
  assert.ok(proposeSale(s, map, r, esp, fra, { role: 'give', p: back }).ok);
  assert.ok(opinion(s, map, r, fra, esp) > op);
  const op2 = opinion(s, map, r, T(g, 'CHL'), fra);
  assert.equal(sendMoney(s, r, fra, T(g, 'CHL'), revenueOf(C[T(g, 'CHL')]) * 2), null);
  assert.ok(opinion(s, map, r, T(g, 'CHL'), fra) > op2 + 10);
  assert.match(sendMoney(s, r, fra, T(g, 'CHL'), 1e9), /Needs/);
});

test('rebel support: unrest lowers stability and raises the civil-war chance; in a civil war it funds the rebels; being found out has a price', () => {
  const g = quiet(), { state: s, map, rules: r } = g, C = s.countries, X = r.balance.deals;
  const nga = T(g, 'NGA'), usa = T(g, 'USA');
  C[usa].treasury = 1e5;
  assert.match(validateSupport(s, r, usa, T(g, 'CAN'), 0), /ally/);
  const odds = supportOdds(s, r, usa, nga, 2);
  assert.ok(odds.cost > 0 && odds.detect > 0 && odds.chanceMult > 1);
  assert.equal(setSupport(s, r, usa, nga, 2), null);
  const st = C[nga].stability;
  const keep = X.rebelDetect.slice();
  X.rebelDetect.fill(0);
  monthlyDeals(s, map, r);
  assert.ok(C[nga].stability < st);
  assert.equal(C[nga].rebelFund, X.rebelChanceBoost[2]);
  C[nga].stability = 3;
  for (const f of Object.keys(C[nga].govt.approval)) C[nga].govt.approval[f] = 5;
  const p0 = civilWarChance(s, r, { ...C[nga], rebelFund: 0 }), p1 = civilWarChance(s, r, C[nga]);
  assert.ok(p1 > p0 * 2, `chance ${p0} → ${p1}`);
  const reb = startCivilWar(s, map, r, nga, 'test');
  const tr = reb.treasury;
  monthlyDeals(s, map, r);
  assert.ok(reb.treasury > tr, 'money reaches the rebels');
  assert.ok(opinion(s, map, r, reb.idx, usa) > 0);
  X.rebelDetect.fill(1);
  monthlyDeals(s, map, r);
  X.rebelDetect.splice(0, X.rebelDetect.length, ...keep);
  assert.ok(supportOf(s, usa, nga).detected);
  assert.ok(casusBelli(s, nga, usa));
  assert.ok(s.dip.mods.some((m) => m.a === nga && m.b === usa && /rebels/.test(m.why)));
  assert.equal(setSupport(s, r, usa, nga, -1), null);
  assert.equal(supportOf(s, usa, nga), null);
});

test('deals survive save and load, and old saves without them still run', () => {
  const g = quiet('FRA'), { state: s, map, rules: r } = g, C = s.countries;
  const usa = T(g, 'USA'), fra = T(g, 'FRA');
  C[usa].treasury = 1e5;
  s.dip.loans = [{ id: 9, lender: usa, borrower: fra, amount: 10, principal: 10, rate: 0.05, months: 60, left: 60, pay: loanPayment(10, 0.05, 60), missed: 0, start: s.day }];
  proposeLoan(s, map, r, usa, fra, { role: 'lend', amount: 1, rate: 0.03, months: 24 });
  assert.equal(pendingFor(s, fra).length, 1);
  formUnion(s, map, r, T(g, 'BEL'), T(g, 'LUX'));
  const g2 = loadGame(saveGame(g), data());
  assert.equal(g2.state.dip.loans.length, 1);
  assert.equal(pendingFor(g2.state, fra).length, 1);
  assert.equal(seniorOf(g2.state, T(g, 'LUX')), T(g, 'BEL'));
  declinePending(g2.state, g2.map, g2.rules, pendingFor(g2.state, fra)[0]);
  runDays(g2, 40);
  assert.ok(g2.state.dip.loans[0]?.left < 60 || debtService(g2.state, fra).owed === 0);
  // a save from before this session has none of the new fields
  const old = JSON.parse(saveGame(g));
  delete old.dip.loans; delete old.dip.pending; delete old.dip.support; delete old.dip.cbs;
  old.dip.treaties = old.dip.treaties.filter((t) => t.type !== 'union');
  const g3 = loadGame(JSON.stringify(old), data());
  runDays(g3, 70);
  assert.ok(g3.state.day > s.day);
});

test('AI: a country in debt borrows from a willing lender; the AI answers the player\'s loan request', () => {
  const g = quiet('FRA'), { state: s, map, rules: r } = g, C = s.countries;
  const usa = T(g, 'USA'), mex = T(g, 'MEX'), fra = T(g, 'FRA');
  C[mex].treasury = -revenueOf(C[mex]) * 3;
  C[usa].treasury = revenueOf(C[usa]) * 10;
  addMod(s, usa, mex, 60, 0.1, 'Test friendship');
  const keep = r.balance.deals.ai.loanChance;
  r.balance.deals.ai.loanChance = 1;
  aiDeals(s, map, r, C[mex], [usa], 1);
  r.balance.deals.ai.loanChance = keep;
  assert.ok(s.dip.loans?.some((l) => l.borrower === mex), 'Mexico borrowed');
  assert.ok(s.aiLog.some((l) => l.c === mex && /loan/.test(l.text)));
  // the player asks a rich, friendly AI for money: it answers at once with reasons
  addMod(s, usa, fra, 60, 0.1, 'Test friendship');
  C[fra].treasury = -revenueOf(C[fra]);
  const res = proposeLoan(s, map, r, fra, usa, { role: 'borrow', amount: revenueOf(C[fra]), rate: 0.1, months: 60 });
  assert.ok(!res.pending && /accepted|refused/.test(res.reason));
});
