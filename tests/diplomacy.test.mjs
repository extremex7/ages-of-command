import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { declareWar, canDeclareWar, evaluatePeace, makePeace, warScore, demandCost, validateSeparatePeace, evaluateSeparatePeace, makeSeparatePeace, warJoiners } from '../src/core/war.js';
import { atWar, allied, canEnter, isAtWar } from '../src/core/relations.js';
import {
  validateTreaty, signTreaty, proposeTreaty, evaluateTreaty, cancelTreaty, findTreaty, opinion, trust, addMod, monthlyDiplomacy,
  improveRelations, applyToBloc, leaveBloc, overlordOf, treatyCount, acceptTreatyOffer, PROPOSABLE,
} from '../src/core/diplomacy.js';
import { computeLedgers } from '../src/core/economy.js';
import { industryMonth, toggleEmbargo } from '../src/core/industry.js';

const quiet = () => game({ settings: { aiAggression: 0 } });
const T = (g, tag) => tagIdx(g, tag);

test('treaty validation rejects impossible agreements with a reason', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const fra = T(g, 'FRA'), deu = T(g, 'DEU'), bra = T(g, 'BRA'), arg = T(g, 'ARG'), chl = T(g, 'CHL'), per = T(g, 'PER');
  assert.match(validateTreaty(s, map, r, 'nap', bra, bra), /yourself/);
  assert.match(validateTreaty(s, map, r, 'alliance', fra, deu), /NATO/, 'NATO members are already allies');
  assert.match(validateTreaty(s, map, r, 'trade', fra, deu), /European Union/, 'EU members already trade freely');
  assert.equal(validateTreaty(s, map, r, 'nap', bra, chl), null);
  signTreaty(s, map, r, 'nap', bra, chl);
  assert.match(validateTreaty(s, map, r, 'nap', chl, bra), /already in force/, 'mutual treaties are found in either order');
  // at war
  declareWar(s, map, r, arg, per);
  assert.match(validateTreaty(s, map, r, 'trade', arg, per), /at war/);
  // an ally of a country at war with you
  signTreaty(s, map, r, 'alliance', per, chl);
  assert.match(validateTreaty(s, map, r, 'defensive', arg, chl), /at war with .*ally/);
  // guarantees need strength and peace
  assert.match(validateTreaty(s, map, r, 'guarantee', T(g, 'LUX'), T(g, 'CHN')), /too weak/);
  assert.match(validateTreaty(s, map, r, 'guarantee', T(g, 'USA'), per), /at war/);
  // embargoes block trade agreements
  toggleEmbargo(s, bra, T(g, 'COL'));
  assert.match(validateTreaty(s, map, r, 'trade', bra, T(g, 'COL')), /embargo/);
  // peace-treaty obligations cannot be proposed
  assert.ok(!PROPOSABLE.includes('subject'));
  assert.match(proposeTreaty(s, map, r, 'subject', bra, chl).reason, /peace treaty/);
});

test('treaty limit and subjects: subjects cannot sign treaties, the limit is enforced', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const max = r.balance.diplomacy.maxTreaties;
  const ind = T(g, 'IND');
  const others = s.countries.filter((c) => c.alive && c.idx !== ind && !allied(s, ind, c.idx) && !validateTreaty(s, map, r, 'nap', ind, c.idx)).slice(0, max + 1);
  for (const c of others.slice(0, max)) assert.equal(validateTreaty(s, map, r, 'nap', ind, c.idx), null), signTreaty(s, map, r, 'nap', ind, c.idx);
  assert.equal(treatyCount(s, ind), max);
  assert.match(validateTreaty(s, map, r, 'nap', ind, others[max].idx), /maximum/);
  const npl = T(g, 'NPL'), btn = T(g, 'BTN');
  signTreaty(s, map, r, 'subject', ind, btn);
  assert.equal(overlordOf(s, btn), ind);
  assert.match(validateTreaty(s, map, r, 'trade', btn, npl), /subject of India/);
  assert.match(canDeclareWar(s, map, btn, npl), /subject/);
  assert.match(canDeclareWar(s, map, ind, btn), /your subject/);
  assert.equal(canDeclareWar(s, map, btn, ind), null, 'a war of independence is possible');
});

test('alliances, defensive pacts and guarantees bring their partners into defensive wars', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const bra = T(g, 'BRA'), arg = T(g, 'ARG'), chl = T(g, 'CHL'), bol = T(g, 'BOL'), usa = T(g, 'USA'), ury = T(g, 'URY');
  signTreaty(s, map, r, 'alliance', arg, chl);
  signTreaty(s, map, r, 'defensive', arg, bol);
  signTreaty(s, map, r, 'guarantee', usa, arg);
  assert.ok(allied(s, arg, chl) && allied(s, arg, bol) && !allied(s, usa, arg));
  assert.deepEqual(new Set(warJoiners(s, bra, arg)), new Set([arg, chl, bol, usa]));
  declareWar(s, map, r, bra, arg);
  for (const k of [chl, bol, usa]) assert.ok(atWar(s, bra, k), `${s.countries[k].name} joined`);
  // an attacker's alliance partner is called to arms; one that likes the target refuses
  const g2 = quiet();
  const s2 = g2.state;
  signTreaty(s2, g2.map, g2.rules, 'alliance', bra, ury);
  addMod(s2, ury, arg, 80, 0, 'test'); // Uruguay likes Argentina
  const opBefore = opinion(s2, g2.map, g2.rules, bra, ury);
  declareWar(s2, g2.map, g2.rules, bra, arg);
  assert.ok(!atWar(s2, ury, arg), 'Uruguay refused the call');
  assert.ok(s2.aiLog.some((l) => l.c === ury && /Refused/.test(l.text)));
  assert.ok(opinion(s2, g2.map, g2.rules, bra, ury) < opBefore, 'refusal costs opinion');
});

test('declaring war breaks a non-aggression pact: reputation, stability and opinion fall', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const D = r.balance.diplomacy;
  const vnm = T(g, 'VNM'), khm = T(g, 'KHM'), tha = T(g, 'THA');
  signTreaty(s, map, r, 'nap', vnm, khm);
  const rep = s.countries[vnm].reputation, stab = s.countries[vnm].stability;
  const opBefore = opinion(s, map, r, tha, vnm), trustBefore = trust(s, r, khm, vnm);
  assert.equal(declareWar(s, map, r, vnm, khm), null);
  assert.equal(findTreaty(s, 'nap', vnm, khm), null);
  assert.ok(s.countries[vnm].reputation <= rep - D.breakReputation.nap, 'reputation lost');
  assert.ok(s.countries[vnm].stability <= stab - D.breakStability, 'stability lost');
  assert.ok(opinion(s, map, r, tha, vnm) < opBefore, 'third countries think less of the treaty breaker');
  assert.ok(trust(s, r, khm, vnm) < trustBefore - 30, 'the victim no longer trusts it');
  // modifiers decay month by month
  const m = s.dip.mods.find((x) => x.a === khm && x.b === vnm && x.why === 'Broke a treaty with us' && x.k === 'o');
  const v0 = m.v;
  monthlyDiplomacy(s, map, r);
  assert.ok(Math.abs(m.v) < Math.abs(v0));
});

test('cancelling early costs reputation; subjects cannot cancel; military access opens borders', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const a = T(g, 'KEN'), b = T(g, 'TZA'), ind = T(g, 'IND'), btn = T(g, 'BTN');
  const t = signTreaty(s, map, r, 'trade', a, b);
  const rep = s.countries[a].reputation;
  assert.equal(cancelTreaty(s, map, r, t, a), null);
  assert.ok(s.countries[a].reputation < rep);
  const sub = signTreaty(s, map, r, 'subject', ind, btn);
  assert.match(cancelTreaty(s, map, r, sub, btn), /independence/);
  // access
  const p = s.countries[b].capital;
  assert.ok(!canEnter(s, a, p));
  signTreaty(s, map, r, 'access', b, a); // Tanzania grants Kenya access
  assert.ok(canEnter(s, a, p));
  assert.ok(!canEnter(s, b, s.countries[a].capital), 'access is one-way');
});

test('opinion is the sum of its listed parts, and rivals refuse treaties', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const pak = T(g, 'PAK'), ind = T(g, 'IND');
  for (const [a, b] of [[pak, ind], [T(g, 'FRA'), T(g, 'DEU')], [T(g, 'USA'), T(g, 'CHN')]]) {
    const parts = [];
    const v = opinion(s, map, r, a, b, parts);
    const sum = parts.reduce((x, [, y]) => x + y, 0);
    assert.ok(Math.abs(Math.max(-100, Math.min(100, sum)) - v) < 1e-9, `${a}->${b}: ${v} vs ${sum}`);
  }
  const before = opinion(s, map, r, pak, ind);
  s.countries[pak].rival = ind;
  assert.equal(opinion(s, map, r, pak, ind), Math.max(-100, before + r.balance.diplomacy.rivalOpinion));
  const ev = evaluateTreaty(s, map, r, 'nap', ind, pak);
  assert.equal(ev.accept, false);
  assert.match(ev.reasons[0][0], /rival/);
});

test('proposals: AI answers with reasons; offers to the player wait for an answer; influence improves relations', () => {
  const g = game({ player: 'BRA', settings: { aiAggression: 0 } });
  const { state: s, map, rules: r } = g;
  const bra = T(g, 'BRA'), arg = T(g, 'ARG'), pry = T(g, 'PRY');
  const ev = evaluateTreaty(s, map, r, 'nap', bra, arg);
  assert.ok(ev.reasons.length >= 2 && ev.reasons.every(([t, v]) => typeof t === 'string' && Number.isFinite(v)));
  const res = proposeTreaty(s, map, r, 'nap', bra, arg);
  assert.equal(res.ok, ev.accept);
  assert.equal(!!findTreaty(s, 'nap', bra, arg), ev.accept);
  // AI to player: pending offer
  const res2 = proposeTreaty(s, map, r, 'defensive', pry, bra);
  assert.ok(res2.pending);
  const offer = s.offers.find((o) => o.kind === 'treaty' && o.from === pry);
  assert.equal(acceptTreatyOffer(s, map, r, offer), null);
  assert.ok(findTreaty(s, 'defensive', bra, pry));
  // influence
  s.countries[bra].influence = 50;
  const op = opinion(s, map, r, arg, bra);
  assert.equal(improveRelations(s, r, bra, arg), null);
  assert.equal(opinion(s, map, r, arg, bra), Math.min(100, op + r.balance.diplomacy.improveOpinion));
  assert.equal(s.countries[bra].influence, 50 - r.balance.diplomacy.improveCost);
  s.countries[bra].influence = 0;
  assert.match(improveRelations(s, r, bra, arg), /influence/);
});

test('peace terms: reparations pay monthly, subjects follow their overlord, claims make reconquest cheaper', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const a = T(g, 'ARG'), b = T(g, 'URY');
  declareWar(s, map, r, a, b);
  const war = s.wars.at(-1);
  for (const p of provOf(g, 'URY')) s.prov.controller[p] = a;
  const take = provOf(g, 'URY')[0];
  // too much: provinces + subject at once costs more than 100
  const ev = evaluatePeace(s, map, r, war, a, { provinces: [take], to: a, reparations: true });
  assert.ok(ev.accept, ev.reason);
  makePeace(s, map, r, war, a, { provinces: [take], to: a, reparations: true });
  assert.ok(findTreaty(s, 'reparations', b, a));
  computeLedgers(s, map, r);
  const L = s.countries[b].ledger, LA = s.countries[a].ledger;
  assert.ok(L.transfersOut > 0 && Math.abs(L.transfersOut - L.taxRevenue * r.balance.diplomacy.reparationsShare) < 1e-9);
  assert.ok(Math.abs(LA.transfersIn - L.transfersOut) < 1e-9);
  // the loser now claims the province, and reclaiming it is discounted
  assert.ok(s.countries[b].claims.some((x) => x.p === take));
  assert.ok(opinion(s, map, r, b, a) < -30, 'grievance');
  s.countries[b].truces[a] = 0; s.countries[a].truces[b] = 0;
  declareWar(s, map, r, b, a);
  const war2 = s.wars.at(-1);
  const full = demandCost(s, map, r, war2, [take], true, -1);
  const disc = demandCost(s, map, r, war2, [take], true, b);
  assert.ok(Math.abs(disc - full * r.balance.diplomacy.claimDiscount) < 1e-9);
});

test('subjugation and wars of independence', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const bra = T(g, 'BRA'), ury = T(g, 'URY');
  declareWar(s, map, r, bra, ury);
  const war = s.wars.at(-1);
  for (const p of provOf(g, 'URY')) s.prov.controller[p] = bra;
  const terms = { provinces: [], subject: true, to: bra };
  assert.ok(evaluatePeace(s, map, r, war, bra, terms).accept);
  makePeace(s, map, r, war, bra, terms);
  assert.equal(overlordOf(s, ury), bra);
  assert.ok(!s.alliances.some((b) => b.members.includes(ury)), 'subjects leave their blocs');
  computeLedgers(s, map, r);
  assert.ok(s.countries[ury].ledger.transfersOut > 0, 'tribute');
  // a big country cannot be made a subject
  const g2 = quiet();
  declareWar(g2.state, g2.map, g2.rules, T(g2, 'CHN'), T(g2, 'IND'));
  const w2 = g2.state.wars.at(-1);
  assert.match(evaluatePeace(g2.state, g2.map, g2.rules, w2, T(g2, 'CHN'), { provinces: [], subject: true }).reason, /too large/);
  // independence: the subject declares war and wins
  s.countries[ury].truces[bra] = 0;
  assert.equal(declareWar(s, map, r, ury, bra), null);
  const iw = s.wars.at(-1);
  assert.equal(iw.kind, 'independence');
  const tooEarly = evaluatePeace(s, map, r, iw, ury, { provinces: [], independence: true });
  assert.equal(tooEarly.accept, false);
  iw.battleScore = 40;
  const ev = evaluatePeace(s, map, r, iw, ury, { provinces: [], independence: true });
  assert.ok(ev.accept, ev.reason);
  makePeace(s, map, r, iw, ury, { provinces: [], independence: true });
  assert.equal(overlordOf(s, ury), -1);
});

test('separate peace lets a co-belligerent leave the war', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const rus = T(g, 'RUS'), est = T(g, 'EST'), usa = T(g, 'USA');
  declareWar(s, map, r, rus, est);
  const war = s.wars.at(-1);
  assert.ok(war.defenders.includes(usa));
  assert.match(validateSeparatePeace(s, map, r, war, est, { provinces: [] }), /leaders/);
  // the US has lost nothing: a white separate peace is accepted
  const ev = evaluateSeparatePeace(s, map, r, war, usa, { provinces: [] });
  assert.ok(ev.accept, ev.reason);
  makeSeparatePeace(s, map, r, war, usa, { provinces: [] });
  assert.ok(!atWar(s, usa, rus) && s.wars.includes(war) && atWar(s, rus, est));
  assert.ok((s.countries[usa].truces[rus] ?? 0) > s.day);
  // a participant that is overrun must cede land
  const lva = T(g, 'LVA');
  for (const p of provOf(g, 'LVA')) s.prov.controller[p] = rus;
  assert.equal(evaluateSeparatePeace(s, map, r, war, lva, { provinces: [] }).accept, false);
  assert.ok(evaluateSeparatePeace(s, map, r, war, lva, { provinces: provOf(g, 'LVA') }).accept);
});

test('trade agreements remove tariffs between partners', () => {
  const run = (sign) => {
    const g = quiet();
    const { state: s, map, rules: r } = g;
    const usa = T(g, 'USA'), chn = T(g, 'CHN');
    s.countries[usa].econ.tariff = 0.3;
    if (sign) signTreaty(s, map, r, 'trade', usa, chn);
    industryMonth(s, map, r); industryMonth(s, map, r);
    return s.countries[usa].econ;
  };
  const without = run(false), withT = run(true);
  assert.equal(without.partnerShare < withT.partnerShare, true);
  assert.ok(withT.tariffRev / withT.impValue < without.tariffRev / without.impValue, 'lower effective tariff on imports');
});

test('blocs vote on members; leaving costs reputation', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const nato = s.alliances.find((b) => b.name === 'NATO');
  const irn = T(g, 'IRN'), irl = T(g, 'IRL'), pol = T(g, 'POL');
  const no = applyToBloc(s, map, r, nato, irn);
  assert.equal(no.ok, false);
  assert.match(no.reason, /Rejected/);
  for (const m of nato.members) addMod(s, m, irl, 60, 0, 'test');
  const yes = applyToBloc(s, map, r, nato, irl);
  assert.ok(yes.ok, yes.reason);
  assert.ok(allied(s, irl, T(g, 'USA')));
  const rep = s.countries[pol].reputation;
  assert.equal(leaveBloc(s, r, nato, pol), null);
  assert.ok(!allied(s, pol, T(g, 'USA')) && s.countries[pol].reputation < rep);
});

test('AI turn processing: a year of AI diplomacy produces valid treaties with logged reasons', () => {
  const g = game({ seed: 'dip-ai' });
  runDays(g, 365);
  const { state: s, map, rules: r } = g;
  const log = s.aiLog.map((l) => l.text);
  assert.ok(log.some((t) => /^Named .* as its rival: /.test(t)), 'rivals named with reasons');
  assert.ok(log.some((t) => /^Proposed a .* to .*: .* (accepted|refused) \(/.test(t)), 'proposals with reasons');
  for (const t of s.dip.treaties) {
    assert.ok(s.countries[t.a].alive && s.countries[t.b].alive);
    assert.ok(!atWar(s, t.a, t.b), 'no treaty between enemies');
    if (t.type === 'subject') continue;
    for (const k of [t.a, t.b]) { const o = overlordOf(s, k); assert.ok(o < 0 || o === (k === t.a ? t.b : t.a)); }
  }
  for (const c of s.countries) {
    assert.ok(treatyCount(s, c.idx) <= r.balance.diplomacy.maxTreaties);
    assert.ok(c.rival < 0 || (c.rival !== c.idx && s.countries[c.rival].alive));
    assert.ok(c.influence >= 0 && c.influence <= r.balance.diplomacy.influenceCap);
  }
});

function dipFingerprint(s) {
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  mix(s.day);
  for (const t of s.dip.treaties) { mix(t.id); mix(t.a); mix(t.b); mix(t.start); }
  for (const m of s.dip.mods) { mix(m.a); mix(m.b); mix(Math.round(m.v * 1000)); }
  for (const c of s.countries) {
    mix(c.rival); mix(Math.round(c.influence * 1000)); mix(Math.round(c.reputation * 1000)); mix(Math.round(c.stability * 1000));
    mix(Math.round(c.govt.legitimacy * 100)); mix(Math.round(c.govt.approvalAll * 100));
    for (const f in c.govt.support) mix(Math.round(c.govt.support[f] * 1e4));
    mix(c.gov.length); mix(c.govt.ruling.length);
    for (const v of Object.values(c.govt.policies)) mix(v.length);
  }
  for (const w of s.wars) { mix(w.id); mix(w.attackers.length); mix(w.defenders.length); }
  mix(s.log.length); mix(s.aiLog.length); mix(s.rng);
  return h;
}

test('diplomacy and politics continue identically after save and load', () => {
  const g = game({ seed: 'dip-save', player: 'DEU', settings: { aiAggression: 2 } });
  runDays(g, 300);
  const d = data();
  const g2 = loadGame(saveGame(g), { map: d.map, rules: d.rules, scenario: d.scenario });
  assert.equal(dipFingerprint(g2.state), dipFingerprint(g.state));
  runDays(g, 200); runDays(g2, 200);
  assert.equal(dipFingerprint(g2.state), dipFingerprint(g.state));
});
