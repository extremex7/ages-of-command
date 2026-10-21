// Religion, province unrest, local revolts and golden and dark ages (docs/RELIGION.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { newArmy } from '../src/core/state.js';
import { dailyEvents } from '../src/core/events.js';
import { seedProvinces, compileSociety, conversionRate, monthlyConversion, canChangeReligion, changeReligion, religionOpinion, religionMix } from '../src/core/religion.js';
import {
  unrestParts, unrestTarget, monthlyUnrest, startRevolt, dailyRevolts, monthlyRevolts, heldMask, taxFactor, revoltAt,
  canSuppress, suppress, independence, aiRevolts, aiTolerance, revoltKind,
} from '../src/core/unrest.js';
import { ageEffect, ageMult, startAge, monthlyAges, crisisCheck } from '../src/core/ages.js';
import { ensureSociety, stabilityParts } from '../src/core/society.js';
import { setPolicy } from '../src/core/government.js';
import { civilFromDays } from '../src/core/calendar.js';
import { provinceColors, modeLegend } from '../src/map/modes.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const start = (id, seed = 'soc') => { const d = data(); return newGame({ map: d.map, rules: d.rules, scenario: rd(`data/scenarios/${id}.json`), playerTag: null, seed, settings: { aiAggression: 0 } }); };
const relId = (g, i) => g.rules.society.list[g.state.society.rel[i]]?.id;
// share of an ISO's provinces of religion id, seeded for a year
const share = (S, map, year, iso, id) => {
  const rel = seedProvinces(map, S, year);
  let n = 0, m = 0;
  for (const i of map.ids) if (map.iso[i] === iso) { n++; if (S.list[rel[i]]?.id === id) m++; }
  return m / Math.max(1, n);
};

test('rules: society.json compiles; bad data is refused', () => {
  const S = data().rules.society;
  assert.ok(S.list.length >= 12 && S.idx.catholic != null && S.idx.secular != null);
  assert.ok(S.list.every((r) => /^#[0-9a-f]{6}$/i.test(r.color) && S.families[r.family]));
  const bad = rd('data/rules/society.json');
  bad.provinceRules.push({ rel: 'no_such_faith', iso: ['FRA'] });
  assert.throws(() => compileSociety(bad), /Invalid rules/);
});

test('seeding follows the era: Roman paganism, the Reformation, Safavid Iran, modern secularism', () => {
  const { map, rules } = data(), S = rules.society;
  assert.ok(share(S, map, 117, 'ITA', 'hellenic') > 0.9);
  assert.ok(share(S, map, 117, 'ISR', 'jewish') > 0.9);
  assert.ok(share(S, map, 117, 'IRN', 'zoroastrian') > 0.9);
  assert.ok(share(S, map, 1444, 'ITA', 'catholic') > 0.9);
  assert.ok(share(S, map, 1444, 'BGR', 'orthodox') > 0.9);
  assert.ok(share(S, map, 1444, 'IRN', 'sunni') > 0.9, 'Iran is Sunni before the Safavids');
  assert.ok(share(S, map, 1444, 'ALB', 'animist') === 0, 'Albania is Christian in 1444');
  assert.ok(share(S, map, 1815, 'IRN', 'shia') > 0.9);
  assert.ok(share(S, map, 1815, 'GBR', 'protestant') > 0.9);
  assert.equal(share(S, map, 1444, 'GBR', 'protestant'), 0);
  assert.ok(share(S, map, 1815, 'DEU', 'protestant') > 0.3 && share(S, map, 1815, 'DEU', 'catholic') > 0.2, 'Germany is split');
  assert.ok(share(S, map, 2026, 'FRA', 'secular') > 0.1 && share(S, map, 2026, 'FRA', 'secular') < 0.7);
  assert.equal(share(S, map, 1815, 'FRA', 'secular'), 0);
});

test('state religions at the start dates', () => {
  const rome = start('height_of_rome_117');
  assert.equal(rome.state.countries[tagIdx(rome, 'ROM')].soc.rel, 'hellenic');
  const g = start('rise_of_empires_1444'), s = g.state;
  assert.equal(s.countries[tagIdx(g, 'OTT')].soc.rel, 'sunni');
  assert.equal(s.countries[tagIdx(g, 'FRA')].soc.rel, 'catholic');
  // the Ottomans rule Orthodox Christians in the Balkans: unrest there, none at home
  const ott = tagIdx(g, 'OTT');
  const balkan = g.map.ids.filter((i) => s.prov.owner[i] === ott && relId(g, i) === 'orthodox');
  assert.ok(balkan.length >= 3, `${balkan.length} Orthodox provinces under the Ottomans`);
  const parts = unrestParts(s, g.map, g.rules, balkan[0]);
  assert.ok(parts.religion > 0, 'religion adds unrest');
  assert.ok(s.countries[ott].soc.misShare > 0.1);
  const m = modern();
  assert.equal(m.state.countries[tagIdx(m, 'IRN')].soc.rel, 'shia');
  assert.equal(m.state.countries[tagIdx(m, 'IND')].soc.rel, 'hindu');
  assert.equal(m.state.countries[tagIdx(m, 'CHN')].soc.rel, 'secular');
});

let _modern = null;
function modern() { return (_modern ||= game({ seed: 'society' })); }

test('unrest: causes add up; garrisons, civil spending and crackdowns lower it', () => {
  const g = game({ seed: 'unrest' }), s = g.state, map = g.map, R = g.rules;
  const k = tagIdx(g, 'FRA'), c = s.countries[k];
  const p = provOf(g, 'FRA').find((i) => i !== c.capital);
  const base = unrestTarget(unrestParts(s, map, R, p));
  c.stability = 10;
  const low = unrestParts(s, map, R, p);
  assert.ok(low.stability > 0 && unrestTarget(low) > base, 'low stability raises unrest');
  const garr = unrestParts(s, map, R, p, 3);
  assert.equal(garr.garrison, -3 * R.society.U.garrisonPerUnit);
  c.civilShare = 0.95;
  assert.ok(unrestParts(s, map, R, p).civil < low.civil, 'civil spending calms');
  // another faith
  s.society.rel[p] = R.society.idx.sunni;
  assert.ok(unrestParts(s, map, R, p).religion > 0);
  c.govt.policies.religion = 'state';
  const zeal = unrestParts(s, map, R, p).religion;
  c.govt.policies.religion = 'tolerant';
  assert.ok(unrestParts(s, map, R, p).religion < zeal, 'tolerance calms other faiths');
  // a recent conquest
  s.society.core[p] = tagIdx(g, 'DEU'); s.society.since[p] = s.day;
  const conq = unrestParts(s, map, R, p);
  assert.ok(conq.conquest > 15 && conq.separatism > 0);
  assert.equal(revoltKind({ conquest: 20, separatism: 6, stability: 5 }), 'separatist');
  assert.equal(revoltKind({ religion: 18, stability: 5 }), 'faith');
  // the province follows its target month by month
  for (let m = 0; m < 24; m++) monthlyUnrest(s, map, R);
  assert.ok(s.society.unrest[p] > 25, `unrest rose to ${s.society.unrest[p]}`);
  assert.ok(taxFactor(s, R, p) < 1, 'restless provinces pay less tax');
  // crackdown
  c.treasury = 1e3;
  assert.equal(canSuppress(s, R, k, p), null);
  const before = s.society.unrest[p], t0 = c.treasury, l0 = c.govt.legitimacy;
  assert.equal(suppress(s, R, k, p), null);
  assert.ok(s.society.unrest[p] < before && c.treasury < t0 && c.govt.legitimacy < l0);
  assert.match(canSuppress(s, R, k, p), /already/);
  assert.ok(unrestParts(s, map, R, p).suppression < 0, 'the crackdown keeps lowering the target');
  assert.match(canSuppress(s, R, tagIdx(g, 'DEU'), p), /own/);
  // the map modes
  const cols = provinceColors('unrest', s, map, -1, R);
  assert.ok(typeof cols[p] === 'string' && cols[p] !== cols[c.capital]);
  const rc = provinceColors('religion', s, map, -1, R);
  assert.notEqual(rc[p], rc[c.capital], 'a Sunni province in France is drawn differently');
  const leg = modeLegend('religion', R, s).map((x) => x[0]);
  assert.ok(leg.includes('Catholic') && leg.includes('Sunni Islam'));
  assert.ok(modeLegend('unrest').length === 4);
});

test('a revolt besieges and holds land, costs tax and stability, and is crushed by an army', () => {
  const g = game({ seed: 'revolt' }), s = g.state, map = g.map, R = g.rules, V = R.society.V;
  const k = tagIdx(g, 'ESP'), c = s.countries[k];
  const p = provOf(g, 'ESP').find((i) => i !== c.capital && !s.armies.some((a) => a.loc === i));
  s.society.unrest[p] = 80;
  const r = startRevolt(s, map, R, p, 'popular', 'test');
  assert.ok(r && revoltAt(s, p) === r && r.units >= 1);
  for (let d = 0; d < V.siegeDays + V.siegeFortDays * s.prov.fort[p] + 2; d++) dailyRevolts(s, map, R);
  assert.deepEqual(r.held, [p], 'the rebels hold the province');
  assert.equal(heldMask(s)[p], 1);
  assert.equal(taxFactor(s, R, p), 0, 'held land pays no tax');
  assert.ok(stabilityParts(s, R, c).revolts < 0);
  assert.ok(crisisCheck(s, R, c), 'rebels holding land is a crisis');
  // an army arrives and wins
  const a = newArmy(s, k, r.p, { [r.type]: 12 });
  s.armies.push(a);
  let d = 0;
  while (s.society.revolts.includes(r) && d++ < 200) dailyRevolts(s, map, R);
  assert.ok(!s.society.revolts.includes(r), `crushed after ${d} days`);
  assert.ok(s.log.some((l) => /crushed the popular revolt/.test(l.text)));
  assert.equal(heldMask(s)[p], 0);
});

test('a popular revolt that holds out wins concessions', () => {
  const g = game({ seed: 'concede' }), s = g.state, map = g.map, R = g.rules;
  const k = tagIdx(g, 'ITA'), c = s.countries[k];
  const p = provOf(g, 'ITA').find((i) => i !== c.capital && !s.armies.some((a) => a.loc === i));
  const r = startRevolt(s, map, R, p, 'popular');
  r.held = [p]; r.since = s.day - 30.44 * (R.society.V.demandMonths + 1);
  c.tax = 0.4;
  monthlyRevolts(s, map, R);
  assert.ok(!s.society.revolts.includes(r));
  assert.ok(c.tax < 0.4, 'taxes cut');
  assert.ok(s.log.some((l) => /gave in to the popular revolt/.test(l.text)));
});

test('separatists: a new country, rejoining a former owner, and releasing a dormant nation', () => {
  const g = game({ seed: 'sep' }), s = g.state, map = g.map, R = g.rules;
  const k = tagIdx(g, 'GBR'), C0 = s.countries.length;
  const ps = provOf(g, 'GBR').filter((i) => i !== s.countries[k].capital);
  // a new country
  const r = startRevolt(s, map, R, ps[0], 'separatist');
  assert.equal(r.tag, null);
  r.held = [ps[0]]; r.since = s.day - 30.44 * (R.society.V.independenceMonths + 1);
  monthlyRevolts(s, map, R);
  assert.equal(s.countries.length, C0 + 1);
  const nc = s.countries[C0];
  assert.match(nc.tag, /^SEP\d+$/);
  assert.equal(s.prov.owner[ps[0]], C0);
  assert.ok(nc.alive && nc.soc && nc.capital === ps[0]);
  assert.ok(s.armies.some((a) => a.owner === C0), 'the new country has an army');
  assert.ok((nc.truces[k] || 0) > s.day, 'with a truce');
  // a province whose old owner is alive rejoins it
  const irl = tagIdx(g, 'IRL');
  s.society.core[ps[1]] = irl;
  const r2 = startRevolt(s, map, R, ps[1], 'separatist');
  assert.equal(r2.tag, 'IRL');
  r2.held = [ps[1]];
  independence(s, map, R, r2);
  assert.equal(s.prov.owner[ps[1]], irl);
  runDays(g, 40); // the game carries on with the new country
  const again = loadGame(saveGame(g), data());
  assert.equal(again.state.countries[C0].tag, nc.tag);
  // 1444: Sweden waits to be released from the Kalmar Union
  const h = start('rise_of_empires_1444', 'kalmar'), hs = h.state;
  const swe = tagIdx(h, 'SWE');
  assert.ok(swe >= 0 && !hs.countries[swe].alive && hs.releases.SWE?.length, 'Sweden starts dormant');
  {
    const p = hs.releases.SWE.find((i) => hs.prov.owner[i] >= 0 && hs.prov.controller[i] === hs.prov.owner[i]);
    const r3 = startRevolt(hs, h.map, h.rules, p, 'separatist');
    assert.equal(r3.tag, 'SWE');
    r3.held = [p];
    independence(hs, h.map, h.rules, r3);
    assert.ok(hs.countries[swe].alive && hs.prov.owner[p] === swe, 'Sweden is free');
  }
});

test('conversion: provinces turn to the state religion, faster under the state religion policy', () => {
  const g = game({ seed: 'conv' }), s = g.state, map = g.map, R = g.rules, S = R.society;
  const k = tagIdx(g, 'POL'), c = s.countries[k];
  const p = provOf(g, 'POL').find((i) => i !== c.capital);
  s.society.rel[p] = S.idx.orthodox; s.society.unrest[p] = 0;
  c.govt.policies.religion = 'tolerant';
  const tol = conversionRate(s, R, p, c);
  c.govt.policies.religion = 'state';
  const st = conversionRate(s, R, p, c);
  assert.ok(tol > 0 && st > tol);
  c.civilShare = 0.2;
  assert.ok(conversionRate(s, R, p, c) < st, 'less civil spending, slower conversion');
  s.society.unrest[p] = 90;
  assert.equal(conversionRate(s, R, p, c), 0, 'no conversion in a restless province');
  s.society.unrest[p] = 0;
  s.society.conv[p] = 0.9999;
  monthlyConversion(s, map, R);
  assert.equal(relId(g, p), 'catholic');
});

test('changing the state religion is a costly government decision', () => {
  const g = game({ seed: 'change' }), s = g.state, map = g.map, R = g.rules, S = R.society;
  const k = tagIdx(g, 'DEU'), c = s.countries[k];
  assert.match(canChangeReligion(s, map, R, k, 'hindu'), /Needs 10%/);
  assert.match(canChangeReligion(s, map, R, k, c.soc.rel), /Already/);
  const mix = religionMix(s, map, R, k);
  const other = S.list[mix.find(([r]) => S.list[r].id !== c.soc.rel)[0]].id;
  const st = c.stability, leg = c.govt.legitimacy;
  assert.equal(changeReligion(s, map, R, k, other), null);
  assert.equal(c.soc.rel, other);
  assert.ok(c.stability < st && c.govt.legitimacy < leg);
  assert.ok(c.govt.mods.some((m) => /faith/i.test(m.name)), 'the clergy is angered');
  assert.match(canChangeReligion(s, map, R, k, mix[0][0] === S.idx[other] ? S.list[mix[1][0]].id : S.list[mix[0][0]].id), /recently/);
});

test('religion and diplomacy: shared faith improves opinion', () => {
  const g = modern(), s = g.state, R = g.rules, S = R.society;
  const a = tagIdx(g, 'SAU'), b = tagIdx(g, 'EGY'), x = tagIdx(g, 'IND');
  assert.equal(religionOpinion(s, R, a, b), S.R.sameOpinion);
  assert.ok(religionOpinion(s, R, a, x) <= 0);
});

test('golden and dark ages: start, effects, events and their end', () => {
  const g = game({ seed: 'ages' }), s = g.state, map = g.map, R = g.rules, A = R.society.A;
  const k = tagIdx(g, 'JPN'), c = s.countries[k];
  startAge(s, R, c, 'golden');
  assert.equal(c.soc.age.kind, 'golden');
  assert.equal(ageMult(R, c, 'research'), A.golden.research);
  assert.equal(ageMult(R, c, 'growth'), A.golden.growth);
  assert.equal(ageEffect(R, c, 'stability'), A.golden.stabilityBonus);
  assert.ok(ageEffect(R, c, 'unrest') < 0);
  assert.ok(s.eventQueue.some((q) => q.c === k && q.ev === 'golden_age'));
  assert.ok(stabilityParts(s, R, c).age > 0);
  s.day = c.soc.age.until;
  monthlyAges(s, map, R, []);
  assert.equal(c.soc.age, null, 'the golden age ends on time');
  // a dark age lifts after a stable year
  const d = s.countries[tagIdx(g, 'ARG')];
  startAge(s, R, d, 'dark', 'test');
  assert.equal(ageMult(R, d, 'research'), A.dark.research);
  assert.ok(ageEffect(R, d, 'unrest') > 0);
  d.stability = 80;
  for (let m = 0; m < A.dark.recoverMonths; m++) monthlyAges(s, map, R, []);
  assert.equal(d.soc.age, null);
  // momentum: a crisis banks toward a dark age; with the chance forced, it begins
  const e = s.countries[tagIdx(g, 'PER') >= 0 ? tagIdx(g, 'PER') : tagIdx(g, 'VEN')];
  e.stability = 5;
  assert.match(crisisCheck(s, R, e), /stability/);
  const ch = A.dark.chance;
  try {
    A.dark.chance = 1;
    for (let m = 0; m < A.dark.momentum + 1 && !e.soc.age; m++) { e.stability = 5; monthlyAges(s, map, R, []); }
  } finally { A.dark.chance = ch; }
  assert.equal(e.soc.age?.kind, 'dark');
});

test('triggered events only fire when queued', () => {
  const g = game({ seed: 'trig', player: 'FRA' }), s = g.state, map = g.map, R = g.rules;
  const ev = R.events.find((e) => e.id === 'golden_age');
  assert.ok(ev?.triggered);
  for (let d = 0; d < 1500; d++) { s.day++; dailyEvents(s, map, R); }
  assert.ok(!s.pendingEvents.some((p) => p.ev === 'golden_age') && !s.fired?.golden_age, 'never at random');
  startAge(s, R, s.countries[s.player], 'golden');
  dailyEvents(s, map, R);
  assert.ok(s.pendingEvents.some((p) => p.ev === 'golden_age'), 'fires when queued');
});

test('AI: sends armies against rebels and turns tolerant when minorities are restless', () => {
  const g = game({ seed: 'aisoc' }), s = g.state, map = g.map, R = g.rules;
  const k = tagIdx(g, 'TUR'), c = s.countries[k];
  const p = provOf(g, 'TUR').find((i) => i !== c.capital && !s.armies.some((a) => a.loc === i));
  const r = startRevolt(s, map, R, p, 'popular');
  aiRevolts(s, map, R, c);
  const sent = s.armies.filter((a) => a.quell === r.id);
  assert.ok(sent.length >= 1 && sent.every((a) => a.owner === k && (a.path.length || a.loc === p)));
  // tolerance
  c.govt.policies.religion = 'state'; c.govt.policyDay = -1e9; c.gov = c.gov === 'theocracy' ? 'republic' : c.gov;
  c.soc.misShare = 0.25;
  while ((c.idx + civilFromDays(s.day).m) % 6) s.day += 28;
  aiTolerance(s, R, c, setPolicy);
  assert.equal(c.govt.policies.religion, 'tolerant');
  assert.ok(c.soc.relPolicyDay === s.day, 'the policy AI leaves it alone for a while');
});

test('saves: old saves without religion load; a running revolt saves and replays the same', () => {
  const g = game({ seed: 'save' }), s = g.state, map = g.map, R = g.rules;
  runDays(g, 35);
  // an old save
  const old = JSON.parse(saveGame(g));
  delete old.state?.society; for (const c of old.state?.countries || old.countries || []) delete c.soc;
  delete old.society;
  const text = JSON.stringify(old);
  const back = loadGame(text, data());
  assert.ok(back.state.society && ArrayBuffer.isView(back.state.society.rel));
  assert.ok(back.state.countries.every((c) => c.soc && c.soc.rel));
  runDays(back, 35);
  // determinism with a revolt in progress
  const k = tagIdx(g, 'BRA'), p = provOf(g, 'BRA').find((i) => i !== s.countries[k].capital);
  s.society.unrest[p] = 75;
  startRevolt(s, map, R, p, 'popular');
  const a = loadGame(saveGame(g), data()), b = loadGame(saveGame(g), data());
  runDays(a, 70); runDays(b, 70);
  assert.equal(saveGame(a), saveGame(b));
  assert.ok(a.state.society.revolts.length >= 1 || a.state.log.some((l) => /crushed|gave in/.test(l.text)));
  // ensureSociety repairs a grown map or a changed religion list
  const so = ensureSociety(a.state, map, R);
  assert.equal(so.rel.length, map.count);
});

test('a decade of 1444 runs with revolts and ages, and stays sane', () => {
  const g = start('rise_of_empires_1444', 'decade'), s = g.state;
  runDays(g, 365 * 6);
  const so = s.society;
  assert.ok(g.map.ids.every((i) => so.unrest[i] >= 0 && so.unrest[i] <= 100 && Number.isFinite(so.unrest[i])));
  assert.ok(so.revolts.every((r) => s.countries[r.c].alive && r.units > 0));
  assert.ok(s.countries.every((c) => !c.alive || (c.soc && c.soc.warEx >= 0 && c.soc.warEx <= 100)));
  assert.ok(s.countries.filter((c) => c.soc?.age?.kind === 'golden').length <= Math.ceil(s.countries.filter((c) => c.alive).length * 0.06) + 1);
});
