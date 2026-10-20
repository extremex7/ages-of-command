// AI use of the peacetime deals in deals.js, run from aiDiplomacy (each AI country every few
// months, staggered). In order: borrow when in debt from the friendliest lender that would agree
// at the lowest rate; integrate junior union partners that are ready; offer a personal union to
// a much weaker friendly neighbouring monarchy that would accept; fund the rebels of a rival in trouble;
// sell a border province when deep in debt, or buy back lost land when rich; and, rarely, send
// an ultimatum to a much weaker neighbour it has a quarrel with. Every decision is in the AI log.
import { aiLog, isHuman, humanControls } from './state.js';
import { rand } from './rng.js';
import { atWar, isAtWar, allied } from './relations.js';
import { countryNeighbours } from './geo.js';
import { opinion, seniorOf, juniorsOf, followsOf } from './diplomacy.js';
import { warOdds } from './ai.js';
import { revenueOf, evaluateLoan, proposeLoan, validateLoan, debtService, canIntegrate, integrateUnion, evaluateUnion, proposeUnion, canBreakUnion, breakUnion,
  rebelSide, supportOf, setSupport, validateSupport, provinceWorth, tradableProvinces, evaluateSale, proposeSale, demandableProvinces, validateDemand,
  issueDemand, describeDemand, evaluateDemand, pendingFor, fmtMoney, topReasons } from './deals.js';

const DIFFICULTY = { easy: 0.6, normal: 1, hard: 1.3 };

// Offers the AI sends the player wait in the Diplomacy tab; it never stacks more than a few.
function playerBusy(state, k) {
  return humanControls(state, k) && pendingFor(state, k).length >= 3;
}

export function aiDeals(state, map, rules, c, greats, round) {
  const X = rules.balance.deals;
  if (!X || !c.ledger) return;
  const nb = countryNeighbours(state, map).sets[c.idx];
  borrow(state, map, rules, c, greats, nb);
  for (const j of juniorsOf(state, c.idx)) {
    if (!canIntegrate(state, map, rules, c.idx, j) && rand(state) < X.ai.integrateChance) {
      const name = state.countries[j].name;
      if (!integrateUnion(state, map, rules, c.idx, j)) aiLog(state, c.idx, `Integrated its junior partner ${name} after years of good relations.`);
    }
  }
  if (round % 2 === 0 && rand(state) < X.ai.unionChance) seekUnion(state, map, rules, c, nb);
  supportRebels(state, map, rules, c);
  if (round % 2 === 1) tradeLand(state, map, rules, c, nb);
  ultimatum(state, map, rules, c, nb);
}

// Subjects and junior partners: a junior breaks away once relations have soured.
export function aiFollowerDeals(state, map, rules, c) {
  if (!rules.balance.deals || seniorOf(state, c.idx) < 0) return;
  if (!canBreakUnion(state, map, rules, c.idx) && rand(state) < 0.5) {
    const s = state.countries[seniorOf(state, c.idx)].name;
    const op = Math.round(opinion(state, map, rules, c.idx, seniorOf(state, c.idx)));
    if (!breakUnion(state, map, rules, c.idx)) aiLog(state, c.idx, `Broke away from its personal union with ${s}: opinion ${op}.`);
  }
}

function borrow(state, map, rules, c, greats, nb) {
  const X = rules.balance.deals, C = state.countries, k = c.idx, rv = revenueOf(c);
  const tm = c.treasury / rv;
  if (!(tm < -1 || (isAtWar(state, k) && tm < 0.5))) return;
  if (rand(state) > X.ai.loanChance) return;
  const cands = new Set([...greats, ...nb]);
  const list = [...cands].filter((p) => p !== k && C[p].alive && C[p].ledger && !atWar(state, k, p) && C[p].rival !== k && c.rival !== p
    && C[p].treasury > X.lenderReserveMonths * revenueOf(C[p]) + rv)
    .map((p) => ({ p, op: opinion(state, map, rules, p, k) })).sort((a, b) => b.op - a.op).slice(0, 5);
  const months = X.loanTermsMonths[1] ?? 60;
  for (const m of X.loanAmountMonths.slice().reverse()) {
    const amount = rv * m;
    if (debtService(state, k).owed + amount > X.loanMaxMonths * rv) continue;
    for (const { p } of list) {
      for (const rate of X.loanRates) {
        if (validateLoan(state, map, rules, p, k, amount, rate, months)) continue;
        if (humanControls(state, p)) {
          if (playerBusy(state, p) || rate !== X.loanRates[Math.floor(X.loanRates.length / 2)]) continue;
        } else if (!evaluateLoan(state, map, rules, p, k, amount, rate, months, p).accept) continue;
        const r = proposeLoan(state, map, rules, k, p, { role: 'borrow', amount, rate, months });
        aiLog(state, k, `Asked ${C[p].name} for a loan of ${fmtMoney(amount)} at ${Math.round(rate * 100)}% (treasury ${tm.toFixed(1)} months of revenue): ${r.reason}`);
        return;
      }
    }
  }
}

function seekUnion(state, map, rules, c, nb) {
  const X = rules.balance.deals, C = state.countries, k = c.idx;
  if (c.influence < X.unionInfluence + 10 || isAtWar(state, k) || followsOf(state, k) >= 0) return;
  // the AI only proposes dynastic unions, between two crowns (the player may offer any)
  if (!/monarchy/.test(c.gov)) return;
  let best = null;
  for (const p of nb) {
    if (playerBusy(state, p) || !/monarchy/.test(C[p].gov)) continue;
    const ev = evaluateUnion(state, map, rules, k, p);
    if (ev.accept && (!best || ev.score > best.ev.score)) best = { p, ev };
  }
  if (!best) return;
  const r = proposeUnion(state, map, rules, k, best.p);
  aiLog(state, k, `Offered ${C[best.p].name} a personal union (${topReasons(best.ev)}): ${r.reason}`);
}

// Money for the rebels of its rival: in a civil war, or while the rival is close to one.
function supportRebels(state, map, rules, c) {
  const X = rules.balance.deals, C = state.countries, k = c.idx, R = c.rival;
  const rich = c.treasury > X.ai.reserveMonths * revenueOf(c);
  for (const s of (state.dip.support || []).filter((x) => x.from === k)) {
    if (s.target !== R || !rich) { setSupport(state, rules, k, s.target, -1); aiLog(state, k, `Stopped funding rebels in ${C[s.target].name}.`); }
  }
  if (R < 0 || !C[R].alive || !rich || allied(state, k, R)) return;
  const civil = rebelSide(state, R);
  const level = civil ? 1 : C[R].stability < 25 && c.aggression > 0.5 ? 0 : -1;
  const cur = supportOf(state, k, R);
  if (level < 0) { if (cur) setSupport(state, rules, k, R, -1); return; }
  if (cur?.level === level || (!cur && rand(state) > X.ai.rebelChance) || validateSupport(state, rules, k, R, level)) return;
  setSupport(state, rules, k, R, level);
  aiLog(state, k, civil ? `Funding the ${C[civil.rebels].name} against its rival ${C[R].name}.` : `Funding unrest in its rival ${C[R].name} (stability ${Math.round(C[R].stability)}).`);
}

// Deep in debt: sell the least valuable border province to the neighbour that would buy it.
// Rich: buy back a province it lost, from a holder that is not hostile.
function tradeLand(state, map, rules, c, nb) {
  const X = rules.balance.deals, C = state.countries, k = c.idx, rv = revenueOf(c), tm = c.treasury / rv;
  if (isAtWar(state, k)) return;
  if (tm < -X.ai.saleDebtMonths && c.cache.provinces > 3) {
    for (const b of nb) {
      if (!C[b].alive || atWar(state, k, b) || C[b].rival === k || playerBusy(state, b)) continue;
      const ps = tradableProvinces(state, map, rules, k, b).sort((x, y) => provinceWorth(state, rules, x) - provinceWorth(state, rules, y)).slice(0, 2);
      for (const p of ps) {
        const price = provinceWorth(state, rules, p);
        if (C[b].treasury < price) continue;
        if (!(humanControls(state, b)) && !evaluateSale(state, map, rules, k, b, p, price, b).accept) continue;
        const r = proposeSale(state, map, rules, k, b, { role: 'sell', p, price });
        aiLog(state, k, `Offered to sell ${map.name[p]} to ${C[b].name} for ${fmtMoney(price)} to pay its debts: ${r.reason}`);
        return;
      }
    }
  } else if (tm > X.ai.buyReserveMonths && c.claims.length) {
    for (const cl of c.claims) {
      const h = state.prov.owner[cl.p];
      if (h < 0 || h === k || !C[h].alive || atWar(state, k, h) || opinion(state, map, rules, k, h) < -20 || playerBusy(state, h)) continue;
      for (const f of [1, 1.25, 1.5]) {
        const price = provinceWorth(state, rules, cl.p) * f;
        if (c.treasury - price < X.ai.reserveMonths * rv) break;
        if (!(humanControls(state, h)) && !evaluateSale(state, map, rules, h, k, cl.p, price, h).accept) continue;
        const r = proposeSale(state, map, rules, k, h, { role: 'buy', p: cl.p, price });
        aiLog(state, k, `Offered ${fmtMoney(price)} to buy back ${map.name[cl.p]} from ${C[h].name}: ${r.reason}`);
        return;
      }
    }
  }
}

// Rarely: a demand on a much weaker neighbour it has a quarrel with. A refusal is a casus belli,
// which the war AI counts as a motive.
function ultimatum(state, map, rules, c, nb) {
  const X = rules.balance.deals, A = X.ai, C = state.countries, k = c.idx, set = state.settings;
  if (isAtWar(state, k) || c.stability < 35 || c.influence < X.demandInfluence) return;
  const aggr = c.aggression * (set.aiAggression ?? 1) * (DIFFICULTY[set.difficulty] || 1);
  if (aggr <= 0 || rand(state) > A.demandChance * aggr) return;
  let best = null;
  for (const t of nb) {
    if (!C[t].alive || playerBusy(state, t) || validateDemand(state, map, rules, k, t, { kind: 'money', amount: 1 })) continue;
    let claims = 0;
    for (const x of c.claims) if (state.prov.owner[x.p] === t) claims++;
    const op = opinion(state, map, rules, k, t);
    if (c.rival !== t && !claims && op > -10) continue; // needs a quarrel
    const o = warOdds(state, k, t), ratio = o.mine / o.theirs;
    if (ratio < A.demandPowerRatio) continue;
    if (!best || ratio > best.ratio) best = { t, ratio, claims, op };
  }
  if (!best) return;
  const t = best.t, T = C[t];
  let d;
  const ps = demandableProvinces(state, map, rules, k, t);
  if (best.claims && ps.length) d = { kind: 'provinces', provinces: ps.slice(0, Math.min(X.demandMaxProvinces, best.claims)) };
  else if (T.cache.provinces <= 5 && best.ratio >= A.demandPowerRatio * 2 && !isHuman(state, t) && evaluateDemand(state, map, rules, k, t, { kind: 'subject' }).accept) d = { kind: 'subject' };
  else {
    // the largest tribute they would pay, or the smallest if they would refuse anything
    const opts = X.demandMoneyMonths.map((m) => ({ kind: 'money', amount: revenueOf(T) * m }));
    d = opts.slice().reverse().find((x) => !isHuman(state, t) && evaluateDemand(state, map, rules, k, t, x).accept) || opts[0];
  }
  const what = describeDemand(state, map, { demand: d.kind, provinces: d.provinces || [], amount: d.amount || 0 });
  const r = issueDemand(state, map, rules, k, t, d);
  aiLog(state, k, `Sent ${T.name} an ultimatum to ${what} (strength ${best.ratio.toFixed(1)}×, opinion ${Math.round(best.op)}${best.claims ? `, ${best.claims} claims` : ''}): ${r.reason}`);
}
