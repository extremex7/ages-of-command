import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { game, data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { makeRules, saveGame, loadGame } from '../src/core/game.js';
import { deserialize } from '../src/core/save.js';
import { refreshCountryCache } from '../src/core/state.js';
import { computeLedgers, taxEfficiency } from '../src/core/economy.js';
import {
  setPolicy, canSetPolicy, reformGovernment, canReform, factionTargets, holdElection, coupChance, revolutionChance, monthlyGovernment,
  govEffects, monthsToElection,
} from '../src/core/government.js';
import { compileEvents, conditionsHold, eventContext, dailyEvents, resolveEvent, applyEffects } from '../src/core/events.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const quiet = (o = {}) => game({ settings: { aiAggression: 0 }, ...o });

test('government type and policies change manpower, tax efficiency and construction cost', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const k = tagIdx(g, 'FRA'), c = s.countries[k];
  const mp = c.cache.maxManpower, eff = taxEfficiency(c, r), m0 = c.govt.fx.manpower;
  assert.equal(setPolicy(s, r, k, 'conscription', 'mass'), null);
  refreshCountryCache(s, map, r);
  assert.ok(c.govt.fx.manpower > m0);
  assert.ok(Math.abs(c.cache.maxManpower / mp - c.govt.fx.manpower / m0) < 1e-6, 'manpower scales with the policy');
  assert.match(canSetPolicy(s, r, k, 'economy', 'planned'), /again in/, 'policy cooldown');
  s.day += r.balance.government.policyCooldownDays;
  setPolicy(s, r, k, 'administration', 'centralised');
  assert.ok(taxEfficiency(c, r) > eff, 'centralised administration collects more tax');
  assert.equal(c.govt.fx.taxEff, govEffects(r, c).taxEff);
});

test('faction approval follows conditions: tax rises anger business, the ruling faction is happier', () => {
  const g = quiet();
  const { state: s, rules: r } = g;
  const c = s.countries[tagIdx(g, 'USA')];
  const t0 = factionTargets(s, r, c);
  c.tax += 0.15;
  const t1 = factionTargets(s, r, c);
  assert.ok(t1.business < t0.business - 5, `business ${t0.business} → ${t1.business}`);
  const withParts = factionTargets(s, r, c, null, null, true);
  assert.ok(withParts.business.parts.some(([k]) => k === 'tax'));
  assert.equal(withParts[c.govt.ruling].inPower, r.balance.government.inPowerApproval);
});

test('elections: democracies vote on schedule and a faction forms the government; autocracies do not', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const fra = s.countries[tagIdx(g, 'FRA')], chn = s.countries[tagIdx(g, 'CHN')];
  assert.ok(monthsToElection(s, fra) > 0 && monthsToElection(s, fra) <= r.politics.types[fra.gov].electionYears * 12 + 1);
  assert.equal(monthsToElection(s, chn), Infinity);
  // make the liberals overwhelmingly popular, then vote
  for (const f in fra.govt.approval) fra.govt.approval[f] = 20;
  fra.govt.approval.liberals = 100; fra.govt.support.liberals = 0.4;
  holdElection(s, r, fra);
  assert.equal(fra.govt.ruling, 'liberals');
  assert.ok(fra.govt.nextElection > s.day);
  assert.ok(Math.abs(Object.values(fra.govt.lastVotes).reduce((a, b) => a + b, 0) - 1) < 0.01);
  assert.ok(s.log.some((l) => l.type === 'politics' && /election/.test(l.text)));
  // the election comes round on its own
  const g2 = quiet();
  const de = g2.state.countries[tagIdx(g2, 'DEU')];
  const due = de.govt.nextElection;
  runDays(g2, due - g2.state.day + 40);
  assert.ok(de.govt.lastElection >= due, 'election held');
});

test('coups need an unhappy, strong military and low stability', () => {
  const g = quiet({ seed: 'coup' });
  const { state: s, map, rules: r } = g;
  const k = tagIdx(g, 'PAK'), c = s.countries[k];
  c.govt.support.military = 0.3; c.govt.approval.military = 50; c.stability = 60;
  assert.equal(coupChance(r, c), 0);
  c.govt.approval.military = 5; c.stability = 10;
  assert.ok(coupChance(r, c) > 0.01);
  // force it: monthly checks until it happens
  let n = 0;
  while (c.gov !== 'military' && n++ < 400) {
    for (const f in c.govt.approval) c.govt.approval[f] = 60; // only the military is unhappy
    c.govt.approval.military = 5; c.stability = 10; c.govt.support.military = 0.3;
    monthlyGovernment(s, map, r, null);
    s.day += 30;
  }
  assert.equal(c.gov, 'military');
  assert.equal(c.govt.ruling, 'military');
  assert.ok(s.log.some((l) => /^Coup in /.test(l.text)));
});

test('revolutions bring the strongest unhappy faction\'s preferred government', () => {
  const g = quiet({ seed: 'rev' });
  const { state: s, map, rules: r } = g;
  const c = s.countries[tagIdx(g, 'SAU')];
  assert.equal(c.gov, 'abs_monarchy');
  const force = () => {
    for (const f in c.govt.approval) c.govt.approval[f] = f === 'liberals' ? 5 : 60;
    c.govt.support.liberals = 0.7; c.govt.approval.military = 60; c.stability = 5;
  };
  force();
  assert.ok(revolutionChance(r, c) > 0);
  let n = 0;
  while (c.gov === 'abs_monarchy' && n++ < 400) { force(); monthlyGovernment(s, map, r, null); s.day += 30; }
  assert.equal(c.gov, r.politics.factions.liberals.prefers);
  assert.ok(s.log.some((l) => /^Revolution in /.test(l.text)));
});

test('reforms follow the allowed paths and need stability and peace', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const k = tagIdx(g, 'SAU'), c = s.countries[k];
  assert.match(canReform(s, r, k, 'one_party'), /cannot reform/);
  c.stability = 20;
  assert.match(canReform(s, r, k, 'const_monarchy'), /stability/);
  c.stability = 70;
  assert.equal(reformGovernment(s, r, k, 'const_monarchy'), null);
  assert.equal(c.gov, 'const_monarchy');
  assert.ok(c.govt.nextElection > s.day, 'a constitutional monarchy holds elections');
  assert.equal(c.govt.policies.press, r.politics.types.const_monarchy.policies.press, 'policies reset to the new type');
  assert.match(canReform(s, r, k, 'parliamentary'), /year/);
});

test('event files are validated', () => {
  const P = data().rules.politics;
  const ok = { id: 'x', title: 'X', text: 't', mtth: 10, conditions: { stability: ['<', 30] }, options: [{ text: 'a', effects: { stability: 1 } }] };
  assert.equal(compileEvents([{ events: [ok] }], P).length, 1);
  assert.throws(() => compileEvents([{ events: [{ ...ok, conditions: { moon: ['<', 1] } }] }], P), /unknown condition "moon"/);
  assert.throws(() => compileEvents([{ events: [{ ...ok, options: [{ text: 'a', effects: { gold: 5 } }] }] }], P), /unknown effect "gold"/);
  assert.throws(() => compileEvents([{ events: [ok, ok] }], P), /duplicate/);
  assert.throws(() => compileEvents([{ events: [{ ...ok, conditions: { 'support.pirates': ['>', 0.1] } }] }], P), /unknown faction/);
  assert.throws(() => makeRules(rd('data/rules/units.json'), rd('data/rules/balance.json'), rd('data/rules/goods.json'), rd('data/rules/buildings.json'),
    { ...rd('data/rules/governments.json'), types: { bad: { family: 'nowhere' } } }), /unknown family/);
});

test('event conditions and effects', () => {
  const g = quiet();
  const { state: s, map, rules: r } = g;
  const c = s.countries[tagIdx(g, 'ITA')];
  const ctx = eventContext(s, map, r, c, null);
  assert.equal(conditionsHold(r, c, { family: 'democracy' }, ctx), true);
  assert.equal(conditionsHold(r, c, { family: 'autocracy' }, ctx), false);
  assert.equal(conditionsHold(r, c, { any: [{ stability: ['<', 0] }, { atWar: false }] }, ctx), true);
  assert.equal(conditionsHold(r, c, { not: { atWar: false } }, ctx), false);
  assert.equal(conditionsHold(r, c, { 'policy.press': 'free' }, ctx), c.govt.policies.press === 'free');
  const st = c.stability, tr = c.treasury;
  computeLedgers(s, map, r);
  applyEffects(s, map, r, c, { stability: -5, treasuryMonths: -1, modifier: { name: 'Test', months: 6, effects: { taxEff: 0.1, faction: { business: 10 } } } });
  assert.equal(c.stability, st - 5);
  assert.ok(Math.abs(c.treasury - (tr - c.ledger.revenue)) < 1e-6);
  assert.ok(c.govt.mods.some((m) => m.name === 'Test'));
  assert.ok(Math.abs(c.govt.fx.taxEff - govEffects(r, c).taxEff) < 1e-12 && c.govt.fx.faction.business >= 10);
});

test('player events wait for a choice and resolve by themselves after the deadline; AI events resolve at once', () => {
  const g = game({ player: 'BRA', seed: 'ev', settings: { aiAggression: 0 } });
  const { state: s, map, rules: r } = g;
  const bra = tagIdx(g, 'BRA');
  // a natural disaster can happen to anyone: make it certain for this test
  const dis = r.events.find((e) => e.id === 'natural_disaster');
  const saved = dis.mtth;
  dis.mtth = 1;
  let n = 0;
  while (!s.pendingEvents.length && n++ < 200) { s.day++; dailyEvents(s, map, r); }
  assert.ok(s.pendingEvents.length, 'player got an event');
  const p = s.pendingEvents[0];
  assert.equal(p.c, bra);
  assert.ok(s.log.some((l) => l.type === 'event' && l.country !== bra), 'AI countries resolved theirs');
  resolveEvent(s, map, r, p, 0);
  assert.equal(s.pendingEvents.length, 0);
  // an unanswered one resolves after eventChoiceDays
  n = 0;
  while (!s.pendingEvents.length && n++ < 4000) { s.day++; dailyEvents(s, map, r); }
  assert.ok(s.pendingEvents.length);
  const q = s.pendingEvents[0];
  s.day = q.day + r.balance.government.eventChoiceDays;
  dailyEvents(s, map, r);
  assert.ok(!s.pendingEvents.includes(q));
  dis.mtth = saved;
});

test('save v3 → v4 migration installs governments and keeps the game running', () => {
  const d = data();
  const g = quiet({ seed: 'mig4' });
  runDays(g, 40);
  const o = JSON.parse(saveGame(g));
  o.version = 3;
  delete o.dip; delete o.pendingEvents;
  for (const c of o.countries) { delete c.govt; delete c.influence; delete c.reputation; delete c.rival; delete c.claims; if (c.econ) delete c.econ.partnerShare; }
  o.alliances = o.alliances.filter((a) => a.name === 'NATO' || a.name === 'CSTO').map(({ kind, ...a }) => a);
  const g2 = loadGame(JSON.stringify(o), d);
  const s = g2.state;
  assert.equal(s.version, 5);
  assert.ok(s.countries.every((c) => c.govt && c.govt.fx && Number.isFinite(c.influence)));
  assert.ok(s.alliances.some((a) => a.name === 'European Union' && a.kind === 'economic'), 'scenario blocs added');
  assert.ok(s.alliances.find((a) => a.name === 'NATO').kind === 'defense');
  runDays(g2, 60);
  assert.ok(s.countries.every((c) => !c.alive || Number.isFinite(c.govt.approvalAll)));
  // unknown government types from a removed mod fall back instead of failing
  const o2 = JSON.parse(saveGame(g));
  o2.countries[0].gov = 'space_empire';
  const s2 = deserialize(JSON.stringify(o2), d.map, d.rules, d.scenario);
  assert.equal(s2.countries[0].gov, 'republic');
});
