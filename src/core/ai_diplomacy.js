// AI diplomacy, run for each AI country every few months (staggered). Goals, in order: name a
// rival (the neighbour that threatens it most, or holds its lost land); drop treaties with
// countries it has fallen out with; seek the treaty that best answers the rival (alliances with
// the rival's enemies, pacts with strong neighbours, guarantees for small friends, trade with big
// markets); embargo a hated rival; join a defence bloc when outmatched; spend influence on the
// partner it most wants. Every decision is written to the AI log with its reason.
import { aiLog, isHuman, humanControls } from './state.js';
import { allied, atWar, isAtWar } from './relations.js';
import { countryNeighbours } from './geo.js';
import { opinion, evaluateTreaty, proposeTreaty, recentlyRefused, validateTreaty, recordOrder, findTreaty, treatiesOf, cancelTreaty,
  overlordOf, TREATIES, improveRelations, canImprove, applyToBloc, canJoinBloc } from './diplomacy.js';
import { toggleEmbargo } from './industry.js';
import { warOdds } from './ai.js';

// Runs daily: each AI country has its own day in every round of aiEveryMonths months, so the
// work is spread evenly instead of landing on the first of the month.
export function aiDiplomacy(state, map, rules) {
  if (!state.dip) return;
  const D = rules.balance.diplomacy;
  const period = Math.round(D.aiEveryMonths * 30.44);
  let greats = null;
  for (const c of state.countries) {
    if (!c.alive || !c.cache || humanControls(state, c.idx)) continue;
    const t = state.day + c.idx * 7;
    if (t % period) continue;
    const round = Math.floor(t / period);
    greats ||= greatPowers(state);
    chooseRival(state, map, rules, c);
    if (overlordOf(state, c.idx) >= 0) continue; // subjects follow their overlord's foreign policy
    reviewTreaties(state, map, rules, c);
    // new treaties are sought every other round (about twice a year), blocs about once a year
    const wanted = round % 2 ? -1 : seekTreaty(state, map, rules, c, greats);
    manageEmbargo(state, map, rules, c);
    if (round % 4 === 1) considerBloc(state, map, rules, c);
    spendInfluence(state, map, rules, c, wanted);
  }
}

function greatPowers(state) {
  return state.countries.filter((c) => c.alive && c.cache).sort((a, b) => b.cache.armyPower - a.cache.armyPower).slice(0, 12).map((c) => c.idx);
}

// Rival: the neighbour (or holder of our lost provinces) we think worst of (opinion already
// counts military threat, governments and grievances), plus claims on their land. The current
// rival gets a bonus so rivalries are stable.
export function rivalScores(state, map, rules, c) {
  const D = rules.balance.diplomacy, C = state.countries;
  const cands = new Set(countryNeighbours(state, map).sets[c.idx]);
  for (const x of c.claims) { const o = state.prov.owner[x.p]; if (o >= 0) cands.add(o); }
  const out = [];
  for (const t of cands) {
    const T = C[t];
    if (!T.alive || t === c.idx || allied(state, c.idx, t) || overlordOf(state, t) === c.idx) continue;
    let op = opinion(state, map, rules, c.idx, t);
    if (c.rival === t) op -= D.rivalOpinion; // judge without the rivalry itself
    const threat = Math.min(3, T.cache.armyPower / Math.max(1, c.cache.armyPower)) * (0.5 + T.aggression);
    let claims = 0;
    for (const x of c.claims) if (state.prov.owner[x.p] === t) claims++;
    const score = Math.max(0, -op) / 100 + Math.min(0.9, claims * 0.3) + (c.rival === t ? 0.15 : 0);
    out.push({ t, score, threat, op, claims });
  }
  return out.sort((a, b) => b.score - a.score);
}

function chooseRival(state, map, rules, c) {
  const D = rules.balance.diplomacy, C = state.countries;
  const best = rivalScores(state, map, rules, c)[0];
  const next = best && best.score >= D.aiRivalThreshold ? best.t : -1;
  if (next === c.rival) return;
  const prev = c.rival;
  c.rival = next;
  if (next >= 0) {
    const why = [];
    if (best.threat > 0.6) why.push(`military threat ${best.threat.toFixed(1)}`);
    if (best.op < 0) why.push(`opinion ${Math.round(best.op)}`);
    if (best.claims) why.push(`holds ${best.claims} of our former provinces`);
    aiLog(state, c.idx, `Named ${C[next].name} as its rival: ${why.join(', ') || 'neighbour'}.`);
  } else if (prev >= 0) aiLog(state, c.idx, `No longer treats ${C[prev].name} as a rival.`);
}

function reviewTreaties(state, map, rules, c) {
  const D = rules.balance.diplomacy, C = state.countries;
  for (const t of [...treatiesOf(state, c.idx)]) {
    if (TREATIES[t.type].peaceOnly) continue;
    if (t.type === 'access' && t.b === c.idx) continue; // access granted to us costs nothing
    const p = t.a === c.idx ? t.b : t.a;
    if (state.day - t.start < D.minTreatyDays) continue;
    const op = opinion(state, map, rules, c.idx, p);
    let why = null;
    if (c.rival === p && t.type !== 'nap') why = `${C[p].name} is now our rival`;
    else if (op < -30) why = `opinion of ${C[p].name} fell to ${Math.round(op)}`;
    if (!why) continue;
    if (!cancelTreaty(state, map, rules, t, c.idx)) aiLog(state, c.idx, `Ended its ${TREATIES[t.type].name.toLowerCase()} with ${C[p].name}: ${why}.`);
  }
}

// Ranks treaty proposals by how much they would help, then proposes the best acceptable one.
// Returns the most wanted partner (for spending influence).
function seekTreaty(state, map, rules, c, greats) {
  const C = state.countries, k = c.idx, R = c.rival;
  const nbs = countryNeighbours(state, map).sets;
  const cands = new Set([...nbs[k], ...greats]);
  if (R >= 0) for (const x of nbs[R]) cands.add(x);
  const myP = Math.max(1, c.cache.armyPower);
  const threatened = R >= 0 && C[R].cache.armyPower > myP * 0.7;
  // a country keeps a few treaties of each kind rather than signing with everyone
  const have = { alliance: 0, defensive: 0, nap: 0, trade: 0, guarantee: 0 };
  for (const t of treatiesOf(state, k)) if (have[t.type] != null && (t.type !== 'guarantee' || t.a === k)) have[t.type]++;
  const pacts = have.alliance + have.defensive;
  const strongThreat = R >= 0 && C[R].cache.armyPower > myP * 1.5;
  const maxPacts = strongThreat ? 2 : 1;
  const wants = [];
  for (const p of cands) {
    const P = C[p];
    if (p === k || p === R || !P.alive || !P.cache || overlordOf(state, p) >= 0 || atWar(state, k, p)) continue;
    const op = opinion(state, map, rules, k, p);
    const pp = P.cache.armyPower, nb = nbs[k].has(p);
    // a far-away power is only worth a defence pact when it borders the threat itself
    const hostileToR = R >= 0 && (P.rival === R || opinion(state, map, rules, p, R) < -20);
    if (threatened && pacts < maxPacts && hostileToR && op > 20) wants.push({ type: 'alliance', p, u: 30 + op * 0.3 + Math.min(30, (pp / myP) * 10), why: `ally against ${C[R].name}` });
    else if (threatened && pacts < maxPacts && op > 10 && pp > myP * 0.3 && (nb || nbs[R].has(p))) wants.push({ type: 'defensive', p, u: 20 + op * 0.2 + Math.min(20, (pp / myP) * 8), why: `protection from ${C[R].name}` });
    if (nb && have.nap < 2 && pp > myP && op > -30 && op < 10 && P.rival !== k) wants.push({ type: 'nap', p, u: 10 + 10 * Math.min(2, pp / myP), why: `secure the border with a strong neighbour` });
    if (R >= 0 && have.guarantee < 3 && myP > pp * 3 && nbs[R].has(p) && op > 30 && greats.includes(k)) wants.push({ type: 'guarantee', p, u: 15 + op * 0.1, why: `protect ${P.name} from ${C[R].name}` });
    // (trade partners from the last market are not saved, so the AI judges markets by size and proximity)
    if (have.trade < 3 && op > 20 && (nb || greats.includes(p))) wants.push({ type: 'trade', p, u: 8 + 12 * Math.min(1, P.cache.gdp / Math.max(1, c.cache.gdp)) + (nb ? 4 : 0), why: 'trade without tariffs' });
  }
  // nuclear powers seek arms control with the largest arsenal facing them
  if ((c.strat?.warheads || 0) > 0 && !treatiesOf(state, k).some((t) => t.type === 'arms_control')) {
    let big = -1;
    for (const o of C) if (o.alive && o.idx !== k && (o.strat?.warheads || 0) > (big < 0 ? 0 : C[big].strat.warheads) && !atWar(state, k, o.idx)) big = o.idx;
    if (big >= 0 && C[big].strat.warheads > c.strat.warheads * 0.5 && opinion(state, map, rules, k, big) > -40) wants.push({ type: 'arms_control', p: big, u: 12, why: 'cap the nuclear arms race' });
  }
  wants.sort((a, b) => b.u - a.u);
  let wanted = -1, tried = 0;
  for (const w of wants) {
    const [a, b] = recordOrder(w.type, k, w.p);
    if (findTreaty(state, w.type, a, b) || validateTreaty(state, map, rules, w.type, a, b)) continue;
    if (recentlyRefused(state, rules, w.type, k, w.p)) { if (wanted < 0) wanted = w.p; continue; }
    if (humanControls(state, w.p) && state.offers.filter((o) => o.kind === 'treaty' && o.to === w.p).length >= 2) continue;
    if (w.type !== 'guarantee' && !isHuman(state, w.p)) {
      const ev = evaluateTreaty(state, map, rules, w.type, k, w.p);
      if (!ev.accept) { if (wanted < 0 && ev.score > -25) wanted = w.p; continue; }
    }
    const r = proposeTreaty(state, map, rules, w.type, k, w.p);
    aiLog(state, k, `Proposed a ${TREATIES[w.type].name.toLowerCase()} to ${C[w.p].name} to ${w.why}: ${r.reason}`);
    if (++tried >= 1) break;
  }
  return wanted;
}

function manageEmbargo(state, map, rules, c) {
  const D = rules.balance.diplomacy, C = state.countries, e = c.econ;
  if (!e) return;
  for (const t of [...e.embargo]) {
    if (t === c.rival && !isAtWar(state, c.idx)) continue;
    if (opinion(state, map, rules, c.idx, t) > -20) { toggleEmbargo(state, c.idx, t); aiLog(state, c.idx, `Lifted its embargo on ${C[t].name}: relations improved.`); }
  }
  const R = c.rival;
  if (R < 0 || e.embargo.includes(R) || findTreaty(state, 'trade', c.idx, R)) return;
  const op = opinion(state, map, rules, c.idx, R);
  if (op >= D.aiEmbargoOpinion) return;
  // a country does not embargo an economy much larger than its own
  if (C[R].cache.gdp > c.cache.gdp * 4) return;
  toggleEmbargo(state, c.idx, R);
  aiLog(state, c.idx, `Imposed an embargo on its rival ${C[R].name}: opinion ${Math.round(op)}.`);
}

// When the rival could beat it, a country applies to a defence bloc the rival is not in.
function considerBloc(state, map, rules, c) {
  const C = state.countries, R = c.rival;
  if (R < 0) return;
  if (state.alliances.some((b) => b.kind !== 'economic' && b.members.includes(c.idx))) return;
  const odds = warOdds(state, R, c.idx);
  if (odds.mine < odds.theirs * 1.5) return; // the rival is not clearly stronger
  for (const bloc of state.alliances) {
    if (bloc.kind === 'economic' || bloc.members.includes(R) || canJoinBloc(state, rules, bloc, c.idx)) continue;
    let s = 0, n = 0;
    for (const m of bloc.members) { s += opinion(state, map, rules, m, R); n++; }
    if (!n || s / n > 0) continue;
    const r = applyToBloc(state, map, rules, bloc, c.idx);
    aiLog(state, c.idx, `Applied to join ${bloc.name} for protection from ${C[R].name}: ${r.reason}`);
    break;
  }
}

function spendInfluence(state, map, rules, c, wanted) {
  const D = rules.balance.diplomacy;
  if (wanted < 0 || c.influence < D.improveCost + 10) return;
  if (canImprove(state, rules, c.idx, wanted)) return;
  improveRelations(state, rules, c.idx, wanted);
  aiLog(state, c.idx, `Spent ${D.improveCost} influence improving relations with ${state.countries[wanted].name}.`);
}
