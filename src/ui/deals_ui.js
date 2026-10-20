// Deals in the interface: the Deals buttons of a foreign country's relations section (loans,
// gifts, province deals, ultimatums, personal unions, money for rebels), their dialogs with the
// other side's answer worked out live, and the Diplomacy tab's lists of offers waiting for the
// player, loans, unions, casus belli and rebel funding. Rules: src/core/deals.js.
import { h, mount } from './dom.js';
import { money, pct } from './format.js';
import { formatDate } from '../core/calendar.js';
import { openDialog } from './dialogs.js';
import { seniorOf, juniorsOf, casusBelliOf } from '../core/diplomacy.js';
import {
  loanPayment, evaluateLoan, proposeLoan, loansOf, repayLoan, canRepay, repudiateLoan, debtService, revenueOf,
  DEMAND_KINDS, DEMAND_NAMES, demandableProvinces, evaluateDemand, issueDemand, describeDemand,
  evaluateUnion, proposeUnion, canIntegrate, integrateUnion, canBreakUnion, breakUnion, unionYears,
  provinceWorth, tradableProvinces, evaluateSale, proposeSale, canSendMoney, giftOpinion, sendMoney,
  supportOf, setSupport, validateSupport, supportOdds, rebelSide, pendingFor, acceptPending, declinePending,
} from '../core/deals.js';

const sg = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));

function refresh(cl, msg, bad = false) {
  if (msg) cl.toast(msg, bad);
  cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame();
}

// "They would accept (score +12):\n  reason +x" as the treaty buttons show it.
export function evTip(ev, who = 'They') {
  if (ev.invalid) return ev.invalid;
  return `${who} would ${ev.accept ? 'accept' : 'refuse'} (score ${sg(ev.score)}):\n` + ev.reasons.map(([t, v]) => `  ${t} ${sg(v)}`).join('\n');
}

function evBlock(ev, who) {
  if (ev.invalid) return h('p.bad', ev.invalid);
  return h('div', h('p', { className: ev.accept ? 'good' : 'bad' }, `${who} would ${ev.accept ? 'accept' : 'refuse'} (score ${sg(ev.score)}).`),
    h('ul.small', ev.reasons.map(([t, v]) => h('li', { className: v > 0 ? 'good' : v < 0 ? 'bad' : '' }, `${t} ${sg(v)}`))));
}

const choice = (label, opts, cur, on) => h('div.field', h('label', label),
  h('select', { on: { change: (e) => on(opts[+e.target.value][0]) } }, opts.map(([v, text], i) => h('option', { value: i, selected: v === cur }, text))));

// ---------------------------------------------------------------------------------------------
// relations section of a foreign country

export function dealsSection(cl, k) {
  const s = cl.state, me = s.player, map = cl.game.map, R = cl.game.rules, X = R.balance.deals, C = s.countries;
  if (!X || !s.dip || me < 0 || me === k || !C[k].alive) return null;
  const buttons = [
    h('button', { tip: 'Lend money to them, or ask them for a loan: repaid monthly with interest. A borrower that misses repayments defaults, losing reputation and giving the lender a casus belli.', on: { click: () => loanDialog(cl, k) } }, 'Loan…'),
    h('button', { tip: 'Send them money as a gift: their opinion of you rises with the gift\'s size against their revenue.', on: { click: () => giftDialog(cl, k) } }, 'Send money…'),
    h('button', { tip: 'Sell, buy or give a border province in peacetime. The other side weighs the price against what the province is worth to it.', on: { click: () => provinceDialog(cl, k) } }, 'Province deal…'),
    h('button', { tip: 'Demand provinces, money or that they become your subject, without war. They answer by the balance of force, their friends and their opinion of you; a refusal gives you a casus belli.', on: { click: () => demandDialog(cl, k) } }, 'Ultimatum…'),
  ];
  // personal union: offer, integrate, dissolve or break away
  if (seniorOf(s, k) === me) {
    const why = canIntegrate(s, map, R, me, k);
    buttons.push(h('button', { disabled: !!why, tip: why || `Integrate ${C[k].name}: its land, armies and treasury become yours and the country ends. Costs ${X.unionIntegrateInfluence} influence.`,
      on: { click: () => refresh(cl, integrateUnion(s, map, R, me, k), true) } }, 'Integrate'));
  } else if (seniorOf(s, me) === k) {
    const why = canBreakUnion(s, map, R, me);
    buttons.push(h('button', { disabled: !!why, tip: why || `Leave the personal union with ${C[k].name}. They will resent it and gain a casus belli.`, on: { click: () => refresh(cl, breakUnion(s, map, R, me), true) } }, 'Break away'));
  } else {
    const ev = evaluateUnion(s, map, R, me, k);
    buttons.push(h('button' + (ev.accept ? '.good-btn' : ''), { disabled: !!ev.invalid,
      tip: `${C[k].name} keeps its name and economy but follows your foreign policy and joins your wars; after ${X.unionIntegrateYears} years with an opinion of you of at least ${X.unionIntegrateOpinion} you can integrate it. Costs ${X.unionInfluence} influence.\n` + evTip(ev),
      on: { click: () => { const r = proposeUnion(s, map, R, me, k); refresh(cl, r.reason, !r.ok); } } }, 'Personal union'));
  }
  // money for rebels
  const cur = supportOf(s, me, k), rs = rebelSide(s, k);
  const levels = X.rebelLevels.map((_, i) => {
    const o = supportOdds(s, R, me, k, i), why = validateSupport(s, R, me, k, i);
    return [i, `${['Low', 'Medium', 'High'][i] || `Level ${i + 1}`}: ${money(o.cost)}/month`, why, o];
  });
  const lvTip = levels.map(([i, label, why, o]) => `${label}: ${why || (rs ? `money and men for the ${C[rs.rebels].name}, ${pct(o.militia)} a month of an extra militia unit` : `stability −${o.stability} a month, civil-war chance ×${o.chanceMult}`)}; found out ${pct(o.detect)} a month`).join('\n');
  const rebels = h('div.row', { style: { marginTop: '0.4em' } },
    h('span', { tip: `Secretly fund ${rs ? `the ${C[rs.rebels].name} in the civil war` : 'the opposition and unrest'} in ${C[k].name}, paid monthly. If found out: their opinion −${-X.rebelOpinion}, trust −${-X.rebelTrust}, and a casus belli against you for ${X.rebelCbYears} years.\n${lvTip}` }, rs ? 'Fund the rebels' : 'Fund unrest'),
    h('select', { on: { change: (e) => refresh(cl, setSupport(s, R, me, k, +e.target.value), true) } },
      h('option', { value: -1, selected: !cur }, 'Off'),
      levels.map(([i, label, why]) => h('option', { value: i, selected: cur?.level === i, disabled: !!why && cur?.level !== i }, label))),
    cur?.detected && h('span.bad', ' (found out)'));
  return h('div', h('h4', 'Deals'), h('div.row.wrap', buttons), rebels);
}

// ---------------------------------------------------------------------------------------------
// dialogs

export function loanDialog(cl, k) {
  const s = cl.state, me = s.player, map = cl.game.map, R = cl.game.rules, X = R.balance.deals, C = s.countries;
  const st = { role: 'lend', months: X.loanAmountMonths[1] ?? 3, rate: X.loanRates[1] ?? 0.06, term: X.loanTermsMonths[1] ?? 60 };
  const body = h('div');
  const update = () => {
    const lender = st.role === 'lend' ? me : k, borrower = st.role === 'lend' ? k : me;
    const amount = revenueOf(C[borrower]) * st.months;
    const ev = evaluateLoan(s, map, R, lender, borrower, amount, st.rate, st.term, k);
    const pay = loanPayment(amount, st.rate, st.term);
    mount(body,
      h('div.kv', h('span', 'Amount'), h('span', money(amount)), h('span', 'Monthly repayment'), h('span', `${money(pay)} for ${st.term} months`),
        h('span', 'Total repaid'), h('span', money(pay * st.term)),
        h('span', `${C[borrower].name} already owes`), h('span', money(debtService(s, borrower).owed))),
      evBlock(ev, C[k].name),
      h('div.row', h('button.primary', { disabled: !!ev.invalid, on: { click: () => { const r = proposeLoan(s, map, R, me, k, { role: st.role, amount, rate: st.rate, months: st.term }); w.remove(); refresh(cl, r.reason, !r.ok); } } }, st.role === 'lend' ? 'Offer the loan' : 'Ask for the loan'),
        h('button', { on: { click: () => w.remove() } }, 'Cancel')));
  };
  const w = openDialog(cl, h('h2', `Loan: ${C[k].name}`),
    h('p.muted', `A borrower repays in equal monthly instalments while its debt after paying stays within ${X.loanPayDebtMonths} months of its revenue; ${X.missedToDefault} missed instalments in a row are a default (reputation −${X.defaultReputation}, the lender's opinion ${X.defaultOpinion}, and a casus belli for ${X.defaultCbYears} years).`),
    choice('Direction', [['lend', `Lend to ${C[k].name}`], ['borrow', `Borrow from ${C[k].name}`]], st.role, (v) => { st.role = v; update(); }),
    choice('Amount', X.loanAmountMonths.map((m) => [m, `${m} month(s) of the borrower's revenue`]), st.months, (v) => { st.months = v; update(); }),
    choice('Interest a year', X.loanRates.map((r) => [r, pct(r)]), st.rate, (v) => { st.rate = v; update(); }),
    choice('Term', X.loanTermsMonths.map((m) => [m, `${m / 12} years`]), st.term, (v) => { st.term = v; update(); }),
    body);
  update();
}

export function giftDialog(cl, k) {
  const s = cl.state, me = s.player, R = cl.game.rules, X = R.balance.deals, C = s.countries;
  let share = X.giftSteps[1] ?? 0.25;
  const body = h('div');
  const update = () => {
    const amount = revenueOf(C[me]) * share, why = canSendMoney(s, R, me, k, amount);
    mount(body, h('p', why ? h('span.bad', why) : `${money(amount)}: their opinion of you +${Math.round(giftOpinion(s, R, k, amount))} (fading ${R.balance.diplomacy.modDecay} a month).`),
      h('div.row', h('button.primary', { disabled: !!why, on: { click: () => { const e = sendMoney(s, R, me, k, amount); w.remove(); refresh(cl, e || `Sent ${money(amount)} to ${C[k].name}.`, !!e); } } }, 'Send'),
        h('button', { on: { click: () => w.remove() } }, 'Cancel')));
  };
  const w = openDialog(cl, h('h2', `Send money to ${C[k].name}`),
    choice('Amount', X.giftSteps.map((f) => [f, `${pct(f)} of your monthly revenue (${money(revenueOf(C[me]) * f)})`]), share, (v) => { share = v; update(); }), body);
  update();
}

export function provinceDialog(cl, k) {
  const s = cl.state, me = s.player, map = cl.game.map, R = cl.game.rules, X = R.balance.deals, C = s.countries;
  const st = { role: 'sell', p: -1, f: 1 };
  const body = h('div');
  const update = () => {
    const seller = st.role === 'buy' ? k : me, buyer = st.role === 'buy' ? me : k;
    const ps = tradableProvinces(s, map, R, seller, buyer).slice(0, 30);
    if (!ps.includes(st.p)) st.p = ps[0] ?? -1;
    cl.view.highlight = st.p >= 0 ? [st.p] : null; cl.requestFrame();
    if (st.p < 0) { mount(body, h('p.muted', `${C[seller].name} has no province bordering ${C[buyer].name} (or claimed by it) that could change hands.`)); return; }
    const worth = provinceWorth(s, R, st.p), price = st.role === 'give' ? 0 : worth * st.f;
    const ev = evaluateSale(s, map, R, seller, buyer, st.p, price, k);
    mount(body,
      choice('Province', ps.map((p) => [p, `${map.name[p]} (worth ${money(provinceWorth(s, R, p))})`]), st.p, (v) => { st.p = v; update(); }),
      st.role !== 'give' && choice('Price', X.salePriceSteps.map((f) => [f, `${pct(f)} of its value: ${money(worth * f)}`]), st.f, (v) => { st.f = v; update(); }),
      h('p.muted', `Value: ${X.saleValueYears} years of the tax it brings (${money(worth)}).`),
      evBlock(ev, C[k].name),
      h('div.row', h('button.primary', { disabled: !!ev.invalid, on: { click: () => { const r = proposeSale(s, map, R, me, k, { role: st.role, p: st.p, price }); cl.view.highlight = null; w.remove(); refresh(cl, r.reason, !r.ok); } } },
        { sell: 'Offer to sell', buy: 'Offer to buy', give: 'Give it' }[st.role]),
      h('button', { on: { click: () => { cl.view.highlight = null; w.remove(); cl.requestFrame(); } } }, 'Cancel')));
  };
  const w = openDialog(cl, h('h2', `Province deal: ${C[k].name}`),
    choice('Deal', [['sell', `Sell one of your provinces to ${C[k].name}`], ['buy', `Buy one of ${C[k].name}'s provinces`], ['give', `Give a province to ${C[k].name}`]], st.role, (v) => { st.role = v; update(); }),
    body);
  update();
}

export function demandDialog(cl, k) {
  const s = cl.state, me = s.player, map = cl.game.map, R = cl.game.rules, X = R.balance.deals, C = s.countries;
  const st = { kind: 'money', months: X.demandMoneyMonths[0] ?? 1, provinces: new Set() };
  const cands = demandableProvinces(s, map, R, me, k).slice(0, 20);
  const body = h('div');
  const update = () => {
    const d = { kind: st.kind, provinces: [...st.provinces], amount: revenueOf(C[k]) * st.months };
    cl.view.highlight = st.kind === 'provinces' ? d.provinces : null; cl.requestFrame();
    const ev = evaluateDemand(s, map, R, me, k, d);
    mount(body,
      st.kind === 'money' && choice('Amount', X.demandMoneyMonths.map((m) => [m, `${m} month(s) of their revenue: ${money(revenueOf(C[k]) * m)}`]), st.months, (v) => { st.months = v; update(); }),
      st.kind === 'provinces' && h('div.list', cands.length ? cands.map((p) => h('label.item', { style: { display: 'flex', gap: '0.5em', alignItems: 'center' } },
        h('input', { type: 'checkbox', checked: st.provinces.has(p), on: { change: (e) => { if (e.target.checked) st.provinces.add(p); else st.provinces.delete(p); update(); } } }),
        h('span', map.name[p]), h('span.muted', money(provinceWorth(s, R, p))))) : h('div.item.muted', 'They have no province bordering yours, and you claim none of theirs.')),
      evBlock(ev, C[k].name),
      h('div.row', h('button.danger', { disabled: !!ev.invalid, on: { click: () => { const r = issueDemand(s, map, R, me, k, d); cl.view.highlight = null; w.remove(); refresh(cl, r.reason, !r.ok); } } }, 'Send the ultimatum'),
        h('button', { on: { click: () => { cl.view.highlight = null; w.remove(); cl.requestFrame(); } } }, 'Cancel')));
  };
  const w = openDialog(cl, h('h2', `Ultimatum to ${C[k].name}`),
    h('p.muted', `Costs ${X.demandInfluence} influence and ${X.demandReputation} reputation (none when they are your rival, hold your claims or you have a casus belli). If they refuse you have a casus belli for ${X.demandCbYears} years; if they yield, they lose ${X.yieldStability} stability and resent it.`),
    choice('Demand', DEMAND_KINDS.map((x) => [x, DEMAND_NAMES[x]]), st.kind, (v) => { st.kind = v; update(); }),
    body);
  update();
}

// ---------------------------------------------------------------------------------------------
// Diplomacy tab

function offerText(s, map, R, o) {
  const C = s.countries;
  if (o.kind === 'loan') {
    const pay = loanPayment(o.amount, o.rate, o.months);
    return [o.lender === o.from ? `${C[o.from].name} offers you a loan` : `${C[o.from].name} asks you for a loan`,
      `${money(o.amount)} at ${pct(o.rate, 1)} a year, repaid at ${money(pay)} a month for ${o.months / 12} years.`];
  }
  if (o.kind === 'demand') return [`Ultimatum from ${C[o.from].name}`, `They demand that you ${describeDemand(s, map, o)}. Refusing, or not answering by ${formatDate(o.deadline)}, gives them a casus belli; yielding costs ${R.balance.deals.yieldStability} stability.`];
  if (o.kind === 'union') return [`${C[o.from].name} offers a personal union`, `You would keep your name and economy but follow ${C[o.from].name}'s foreign policy, leave your other treaties and defence blocs, and join its wars. It could integrate you after ${R.balance.deals.unionIntegrateYears} years of good relations.`];
  const what = o.price ? `for ${money(o.price)} (value ${money(provinceWorth(s, R, o.p))})` : 'as a gift';
  return [o.buyer === o.from ? `${C[o.from].name} wants to buy ${map.name[o.p]}` : `${C[o.from].name} offers you ${map.name[o.p]}`, `${map.name[o.p]} ${what}.`];
}

export function dealsTab(cl) {
  const s = cl.state, me = s.player, map = cl.game.map, R = cl.game.rules, X = R.balance.deals, C = s.countries;
  if (!X || !s.dip || me < 0) return null;
  const out = [];
  const offers = pendingFor(s, me);
  if (offers.length) {
    out.push(h('h3', 'Deals offered to you'));
    for (const o of offers) {
      const [title, desc] = offerText(s, map, R, o);
      out.push(h('div.army-card', h('div.row.spread', h('b', title), h('span.muted', `answer by ${formatDate(o.deadline)}`)), h('div', desc),
        h('div.row', h('button.primary', { on: { click: () => refresh(cl, acceptPending(s, map, R, o), true) } }, o.kind === 'demand' ? 'Yield' : 'Accept'),
          h('button', { on: { click: () => { declinePending(s, map, R, o); refresh(cl); } } }, o.kind === 'demand' ? 'Refuse' : 'Decline'))));
    }
  }
  const loans = loansOf(s, me);
  out.push(h('h3', { style: { marginTop: '1em' } }, 'Loans'));
  out.push(loans.length ? h('table.t.small', h('tr', h('th', 'With'), h('th.n', 'Owed'), h('th.n', 'Monthly'), h('th.n', 'Left'), h('th', '')), loans.map((l) => {
    const mineB = l.borrower === me, why = canRepay(s, l, me);
    return h('tr', h('td', { tip: `${money(l.amount)} at ${pct(l.rate, 1)} since ${formatDate(l.start)}${l.missed ? `; ${l.missed} missed repayment(s)` : ''}` }, mineB ? `Borrowed from ${C[l.lender].name}` : `Lent to ${C[l.borrower].name}`),
      h('td.n', money(l.principal)), h('td.n', (mineB ? '−' : '+') + money(l.pay)), h('td.n', `${l.left} mo`),
      h('td', mineB && h('div.row', h('button', { disabled: !!why, tip: why || 'Pay off what is left now.', on: { click: () => refresh(cl, repayLoan(s, R, l, me), true) } }, 'Repay'),
        h('button.danger', { tip: `Stop paying: reputation −${X.repudiateReputation}, ${C[l.lender].name}'s opinion ${X.defaultOpinion} and trust ${X.defaultTrust}, and it gains a casus belli for ${X.defaultCbYears} years.`, on: { click: () => refresh(cl, repudiateLoan(s, map, R, l, me), true) } }, 'Default'))));
  })) : h('p.muted', 'No loans. Select a country and use Loan… to lend or borrow.'));
  const juniors = juniorsOf(s, me), senior = seniorOf(s, me);
  if (juniors.length || senior >= 0) {
    out.push(h('h3', { style: { marginTop: '1em' } }, 'Personal unions'));
    if (senior >= 0) out.push(h('p', `You are the junior partner of ${C[senior].name} (${unionYears(s, senior, me).toFixed(1)} years). ${canBreakUnion(s, map, R, me) || 'You can break away now (its Nation tab).'}`));
    for (const j of juniors) out.push(h('p', { tip: canIntegrate(s, map, R, me, j) || 'Ready to integrate (its Nation tab).' }, `${C[j].name}: junior partner for ${unionYears(s, me, j).toFixed(1)} of ${X.unionIntegrateYears} years. ${canIntegrate(s, map, R, me, j) ? '' : 'Ready to integrate.'}`));
  }
  const cbs = casusBelliOf(s, me), against = (s.dip.cbs || []).filter((x) => x.b === me && x.until > s.day);
  if (cbs.length || against.length) {
    out.push(h('h3', { style: { marginTop: '1em' } }, 'Casus belli'));
    out.push(h('ul.small', cbs.map((x) => h('li.good', `Against ${C[x.b].name} until ${formatDate(x.until)}: ${x.why.toLowerCase()}. A war on them is justified.`)),
      against.map((x) => h('li.warn', `${C[x.a].name} may attack you without penalty until ${formatDate(x.until)}: ${x.why.toLowerCase()}.`))));
  }
  const sup = (s.dip.support || []).filter((x) => x.from === me);
  if (sup.length) {
    out.push(h('h3', { style: { marginTop: '1em' } }, 'Rebels you fund'));
    out.push(h('ul.small', sup.map((x) => h('li', `${C[x.target].name}: ${money(supportOdds(s, R, me, x.target, x.level).cost)} a month${rebelSide(s, x.target) ? ' to the rebels in the civil war' : ' for unrest'}${x.detected ? ' (found out)' : ''}.`))));
  }
  return h('div', out);
}

