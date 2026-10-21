// Handing a human country to the AI and back (c.automate, see humanControls in state.js), as the
// bot in src/bot/autoplay.js does while the player is away.
//
// While c.automate is on, the AI runs the country like any other: budget, research, construction,
// armies, diplomacy, deals, advisors, missions, nations to form, religion and revolts. Nothing
// new waits for the player: events are decided at once and offers are answered at once, because
// every system asks humanControls() before it queues something for a human. settlePending()
// answers what was already waiting when the AI took over (events, proposals, peace offers, calls
// to arms, deals and ultimatums, the civil-war choice) the way the AI would have.
import { aiChoice, resolveEvent } from './events.js';
import { evaluatePeace, makePeace, evaluateSeparatePeace, makeSeparatePeace, joinWar } from './war.js';
import { evaluateTreaty, acceptTreatyOffer, declineOffer, opinion, addMod } from './diplomacy.js';
import { evaluateLoan, evaluateDemand, evaluateUnion, evaluateSale, acceptPending, declinePending } from './deals.js';
import { isAtWar } from './relations.js';
import { leavePlans } from './plans.js';

// The player's own settings that handToAI changes and handBack restores.
const KEPT = ['automate', 'autoEconomy', 'aiProfile'];

// Gives country k to the AI. profile: { aggression, difficulty, war } for this country only (see
// aiTemper in ai.js), or null for the game's settings. Returns what handBack needs.
export function handToAI(state, map, rules, k, profile = null) {
  const c = state.countries[k];
  const saved = {};
  for (const f of KEPT) saved[f] = c[f];
  c.automate = true;
  if (profile) c.aiProfile = { ...profile }; else delete c.aiProfile;
  // the player's battle plans would fight the AI's orders for the same armies
  if (state.plans?.length) leavePlans(state, state.plans.filter((p) => p.owner === k).flatMap((p) => p.armies));
  return { k, saved, settled: settlePending(state, map, rules, k) };
}

// Gives the country back to the player with their settings as they were.
export function handBack(state, h) {
  const c = state.countries[h.k];
  if (!c) return;
  for (const f of KEPT) {
    if (h.saved[f] === undefined) delete c[f];
    else c[f] = h.saved[f];
  }
  c.automate = !!h.saved.automate;
}

// Answers everything waiting for country k as the AI would. Returns a line per decision.
export function settlePending(state, map, rules, k) {
  const C = state.countries, out = [];
  const name = (x) => C[x]?.name || '?';
  // domestic events
  for (const p of state.pendingEvents.filter((x) => x.c === k)) {
    const ev = rules.events.find((e) => e.id === p.ev);
    const opt = ev ? aiChoice(state, ev) : 0;
    resolveEvent(state, map, rules, p, opt);
    out.push(`Event "${p.title}": ${ev?.options[opt]?.text || 'decided'}`);
  }
  // proposals, peace offers and calls to arms (state.offers)
  for (const o of state.offers.filter((x) => x.to === k)) {
    if (!state.offers.includes(o)) continue;
    const war = o.war != null ? state.wars.find((w) => w.id === o.war) : null;
    const drop = () => { state.offers = state.offers.filter((x) => x !== o); };
    if (o.kind === 'treaty') {
      if (evaluateTreaty(state, map, rules, o.type, o.from, o.to).accept && !acceptTreatyOffer(state, map, rules, o)) out.push(`Accepted ${name(o.from)}'s ${o.type} proposal`);
      else { declineOffer(state, map, rules, o); out.push(`Declined ${name(o.from)}'s ${o.type} proposal`); }
    } else if (!war) drop();
    else if (o.kind === 'call') {
      drop();
      const D = rules.balance.diplomacy, b = war.leaderD;
      const ok = opinion(state, map, rules, k, o.from) > D.callToArmsOpinion && opinion(state, map, rules, k, b) < 20 && C[k].stability > 35 && !isAtWar(state, k);
      if (ok && !joinWar(state, map, rules, war, k, 'A')) out.push(`Joined ${name(o.from)} in the ${war.name}`);
      else { addMod(state, o.from, k, -20, D.modDecay, 'Refused our call to arms'); out.push(`Refused ${name(o.from)}'s call to arms`); }
    } else if (o.kind === 'separate') {
      drop();
      if (evaluateSeparatePeace(state, map, rules, war, o.from, o.terms).accept) {
        makeSeparatePeace(state, map, rules, war, o.from, o.terms);
        out.push(`Accepted ${name(o.from)}'s separate peace`);
      } else out.push(`Turned down ${name(o.from)}'s separate peace`);
    } else { // peace terms from the enemy leader
      drop();
      if (evaluatePeace(state, map, rules, war, o.from, o.terms).accept) { makePeace(state, map, rules, war, o.from, o.terms); out.push(`Accepted peace terms in the ${war.name}`); }
      else out.push(`Rejected peace terms in the ${war.name}`);
    }
  }
  // deals: loans, ultimatums, personal unions, province sales (state.dip.pending)
  for (const o of (state.dip?.pending || []).filter((x) => x.to === k)) {
    let ev = null;
    if (o.kind === 'loan') ev = evaluateLoan(state, map, rules, o.lender, o.borrower, o.amount, o.rate, o.months, k);
    else if (o.kind === 'demand') ev = evaluateDemand(state, map, rules, o.from, k, { kind: o.demand, provinces: o.provinces, amount: o.amount });
    else if (o.kind === 'union') ev = evaluateUnion(state, map, rules, o.from, k);
    else if (o.kind === 'sale') ev = evaluateSale(state, map, rules, o.seller, o.buyer, o.p, o.price, k);
    const yes = !!ev?.accept && !ev.invalid;
    if (yes && !acceptPending(state, map, rules, o)) out.push(`Accepted ${name(o.from)}'s ${o.kind === 'demand' ? 'ultimatum' : o.kind} offer`);
    else { if (state.dip.pending.includes(o)) declinePending(state, map, rules, o); out.push(`${o.kind === 'demand' ? 'Refused' : 'Declined'} ${name(o.from)}'s ${o.kind === 'demand' ? 'ultimatum' : o.kind}`); }
  }
  // a civil war split the country: the player keeps the government (the dialog's first choice)
  if (state.civilChoice?.gov === k) { delete state.civilChoice; out.push('Kept leading the government in the civil war'); }
  return out;
}
