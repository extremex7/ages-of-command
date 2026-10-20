// Formable nations, national traits, advisors and missions (docs/NATIONS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { game, tagIdx, data } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { transferProvince } from '../src/core/war.js';
import { refreshCountryCache } from '../src/core/state.js';
import { computeLedgers } from '../src/core/economy.js';
import { computePrestige } from '../src/core/prestige.js';
import { nationalFx } from '../src/core/natfx.js';
import { formableRegion, formStatus, formNation, formablesFor, monthlyNations, regionOf, holderOf } from '../src/core/nations.js';
import { govEffects } from '../src/core/government.js';
import { advisorPool, hireAdvisor, canHire, advisorSlots, dismissAdvisor, monthlyAdvisors } from '../src/core/advisors.js';
import { monthlyMissions, missionProgress, missionMotive } from '../src/core/missions.js';
import { hasClaim } from '../src/core/diplomacy.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const scenarioGame = (id, o = {}) => { const d = data(); return newGame({ map: d.map, rules: d.rules, scenario: rd(`data/scenarios/${id}.json`), playerTag: o.player ?? null, seed: o.seed ?? 'nations' }); };
const give = (g, k, provs) => { for (const p of provs) transferProvince(g.state, g.map, p, k); refreshCountryCache(g.state, g.map, g.rules); computeLedgers(g.state, g.map, g.rules); };

test('the nation data is valid: regions, flags, traits', () => {
  const { map, rules } = data(), N = rules.nations;
  assert.ok(N.formableIds.length >= 20, `${N.formableIds.length} formable nations`);
  const flags = new Set(fs.readdirSync(new URL('../data/flags/', import.meta.url)).map((f) => f.replace(/\.svg$/, '')));
  for (const f of fs.readdirSync(new URL('../data/flags/hist/', import.meta.url))) flags.add('hist/' + f.replace(/\.svg$/, ''));
  for (const id of N.formableIds) {
    const F = N.formables[id];
    assert.ok(formableRegion(map, rules, id).length >= 3, `${id} has a region`);
    for (const f of [F.flag, ...F.flagEras.map((e) => e.flag)]) if (f) assert.ok(flags.has(f), `${id}: flag ${f} exists`);
    assert.ok(F.pattern?.colors?.length >= 2, `${id} has a pattern flag`);
    assert.ok(N.traits[F.trait], `${id} grants a known trait`);
  }
  assert.ok(Object.keys(N.traits).length >= 40);
  // small effects: shares up to 15%, points up to 6, influence up to 1 a month
  for (const [id, T] of Object.entries(N.traits)) for (const [k, v] of Object.entries(T.effects)) {
    assert.ok(Math.abs(v) <= (['stability', 'legitimacy'].includes(k) ? 6 : k === 'influence' ? 1 : 0.15), `${id}.${k} = ${v}`);
  }
});

test('every country gets 1 to 3 traits; listed tags, scenario-specific tags and regional defaults', () => {
  const g = game({ player: 'FRA' }), s = g.state, R = g.rules;
  for (const c of s.countries.filter((x) => x.alive)) assert.ok(c.traits.length >= 1 && c.traits.length <= 3, `${c.tag}: ${c.traits}`);
  assert.deepEqual(s.countries[tagIdx(g, 'GBR')].traits, R.nations.tags.GBR);
  assert.deepEqual(s.countries[tagIdx(g, 'AUS')].traits, ['pioneers', 'mineral_wealth'], 'AUS is Australia today');
  const old = scenarioGame('rise_of_empires_1444');
  assert.deepEqual(old.state.countries[tagIdx(old, 'AUS')].traits, ['diplomats', 'bureaucratic'], 'AUS is Austria in 1444');
  // defaults depend only on the tag and the situation: the same in every game
  const g2 = game({ seed: 'other' });
  for (const c of s.countries) assert.deepEqual(g2.state.countries[c.idx].traits, c.traits);
  assert.equal(regionOf(g.map, s.countries[tagIdx(g, 'KEN')]), 'sub_saharan');
  assert.equal(regionOf(g.map, s.countries[tagIdx(g, 'JPN')]), 'east_asia');
  assert.equal(regionOf(g.map, s.countries[tagIdx(g, 'MNG')]), 'steppe');
});

test('trait effects reach tax efficiency, stability, research and naval combat', () => {
  const g = game(), s = g.state, R = g.rules;
  const c = s.countries[tagIdx(g, 'CHE')]; // neutral, banking, mountain folk
  const n = nationalFx(R, c);
  assert.ok(Math.abs(n.tax - 0.035) < 1e-9 && n.stability === 4, JSON.stringify(n));
  const withTraits = c.govt.fx.taxEff, traits = c.traits;
  c.traits = [];
  const without = govEffects(R, c).taxEff;
  c.traits = traits;
  assert.ok(Math.abs(withTraits - without - 0.035) < 1e-9, 'traits raise the government\'s tax efficiency');
  const usa = s.countries[tagIdx(g, 'USA')];
  assert.ok(usa.tfx.nat.research > 0 && usa.tfx.mult.research > 1, 'USA innovators: research bonus in the technology multiplier');
  const gbr = s.countries[tagIdx(g, 'GBR')];
  assert.ok(gbr.tfx.nat.naval >= 0.1, 'naval tradition');
});

test('forming Yugoslavia: decision conditions, renaming, flag, trait, prestige and claims', () => {
  const g = game({ player: 'SRB' }), s = g.state, R = g.rules, map = g.map;
  const k = tagIdx(g, 'SRB'), c = s.countries[k];
  const st0 = formStatus(s, map, R, k, 'yugoslavia');
  assert.equal(st0.ok, false);
  assert.match(st0.why, /^Own \d+ of its \d+ provinces/);
  assert.ok(formablesFor(s, map, R, k).some((x) => x.id === 'yugoslavia'), 'Serbia may form Yugoslavia');
  assert.ok(!formablesFor(s, map, R, tagIdx(g, 'FRA')).some((x) => x.id === 'yugoslavia'), 'France may not');
  const reg = formableRegion(map, R, 'yugoslavia');
  // take 85% of the region; leave the rest with its owners
  const take = reg.filter((p, i) => i < Math.ceil(reg.length * 0.85));
  give(g, k, take);
  c.stability = 60;
  const st = formStatus(s, map, R, k, 'yugoslavia');
  assert.equal(st.ok, true, st.why);
  const score0 = computePrestige(s).score[k];
  assert.equal(formNation(s, map, R, k, 'yugoslavia'), null);
  assert.equal(c.name, 'Yugoslavia');
  assert.equal(c.flagId, 'hist/yugoslavia_sfr', 'the federal flag in the information age');
  assert.ok(c.traits.includes('brotherhood_unity'));
  assert.ok(c.prestigeBonus >= 5);
  assert.ok(computePrestige(s).score[k] > score0, 'prestige rises');
  const left = reg.filter((p) => s.prov.owner[p] !== k);
  assert.ok(left.length > 0 && left.every((p) => hasClaim(s, k, p)), 'claims on the rest of the region');
  assert.ok(s.log.some((l) => l.formed === 'yugoslavia' && l.important), 'the player is told');
  // nobody can form it again
  assert.equal(holderOf(s, R, 'yugoslavia'), k);
  const other = left.map((p) => s.prov.owner[p]).find((o) => o >= 0 && o !== k);
  if (other != null) assert.match(formStatus(s, map, R, other, 'yugoslavia').why, /already is Yugoslavia/);
  assert.equal(formNation(s, map, R, k, 'yugoslavia'), 'Already formed');
});

test('formable limits: eras, existing nations, government family, subjects', () => {
  const old = scenarioGame('rise_of_empires_1444');
  const s = old.state, R = old.rules;
  assert.match(formStatus(s, old.map, R, tagIdx(old, 'ENG'), 'great_britain').why, /Renaissance era/);
  const g = game(), m = g.map;
  // Germany exists, so Austria cannot form it; the European Federation needs a democracy and the Cold War era or later
  assert.match(formStatus(g.state, m, g.rules, tagIdx(g, 'AUT'), 'germany').why, /Germany already is Germany/);
  const pol = tagIdx(g, 'POL');
  g.state.countries[pol].gov = 'abs_monarchy';
  assert.match(formStatus(g.state, m, g.rules, pol, 'european_federation').why, /democracy/);
});

test('the AI forms a nation it qualifies for and is logged', () => {
  const g = game({ player: 'FRA' }), s = g.state, R = g.rules;
  const k = tagIdx(g, 'COL');
  give(g, k, formableRegion(g.map, R, 'gran_colombia'));
  s.countries[k].stability = 60;
  for (let i = 0; i < 12 && !s.countries[k].formed; i++) { s.day += 30; monthlyNations(s, g.map, R); }
  assert.equal(s.countries[k].name, 'Gran Colombia');
  assert.ok(s.aiLog.some((l) => l.c === k && /Formed Gran Colombia/.test(l.text)));
});

test('advisors: a pool that does not touch the game, hiring, seats, effects, salaries', () => {
  const g = game({ player: 'FRA' }), s = g.state, R = g.rules, map = g.map;
  const k = tagIdx(g, 'FRA'), c = s.countries[k];
  const rng = s.rng, pool = advisorPool(s, map, R, k);
  assert.deepEqual(advisorPool(s, map, R, k), pool, 'the same pool every time');
  assert.equal(s.rng, rng, 'looking at the pool draws nothing from the game');
  assert.equal(pool.length, R.nations.advisors.poolSize);
  assert.ok(new Set(pool.map((x) => x.type)).size === 5, 'every kind on offer');
  c.treasury = 1e4;
  const eco = pool.find((x) => x.type === 'economy');
  const tax0 = c.govt.fx.taxEff;
  const a = hireAdvisor(s, map, R, k, eco.cid);
  assert.equal(typeof a, 'object', String(a));
  assert.ok(Math.abs(c.govt.fx.taxEff - tax0 - 0.01 * a.skill) < 1e-9, 'treasurer raises tax efficiency by skill');
  assert.ok(!advisorPool(s, map, R, k).some((x) => x.cid === eco.cid), 'the hired candidate leaves the pool');
  const eco2 = { ...eco, cid: 99 };
  assert.match(canHire(s, R, k, eco2), /already have/);
  computeLedgers(s, map, R);
  assert.ok(c.ledger.advisors > 0, 'salary in the budget');
  for (const x of advisorPool(s, map, R, k)) if (!c.advisors.some((y) => y.type === x.type)) hireAdvisor(s, map, R, k, x.cid);
  assert.equal(c.advisors.length, advisorSlots(R, c), 'seats limit the council');
  assert.equal(dismissAdvisor(s, R, k, a.id), null);
  assert.ok(Math.abs(c.govt.fx.taxEff - tax0) < 1e-9, 'dismissing removes the bonus');
  // a military government has fewer seats: extra advisors leave at the next month
  c.gov = 'military';
  monthlyAdvisors(s, map, R);
  assert.equal(c.advisors.length, 2);
  // old advisors retire
  c.advisors[0].born = s.day - 80 * 365.25;
  monthlyAdvisors(s, map, R);
  assert.equal(c.advisors.length, 1);
});

test('AI countries hire advisors and keep within their seats', () => {
  const g = game({ player: 'FRA' }), s = g.state, R = g.rules;
  runDays(g, 400);
  const ai = s.countries.filter((c) => c.alive && c.idx !== s.player);
  const hired = ai.filter((c) => c.advisors?.length);
  assert.ok(hired.length > ai.length * 0.3, `${hired.length} of ${ai.length} AI countries have advisors`);
  for (const c of hired) {
    assert.ok(c.advisors.length <= advisorSlots(R, c));
    assert.equal(new Set(c.advisors.map((a) => a.type)).size, c.advisors.length, 'one of each kind');
  }
});

test('missions: generated from the situation, completed with rewards, replaced, AI motive', () => {
  const g = game({ player: 'FRA' }), s = g.state, R = g.rules, map = g.map;
  const k = tagIdx(g, 'FRA'), c = s.countries[k];
  runDays(g, 100);
  assert.ok(c.missions.length >= 1 && c.missions.length <= 3, `${c.missions.length} objectives`);
  assert.ok(s.log.some((l) => l.mission && /New objective/.test(l.text)), 'the player is told');
  for (const m of c.missions) { const p = missionProgress(s, map, R, c, m); assert.ok(p.p >= 0 && p.p <= 1); }
  // a GDP objective already reached completes next month and pays its reward
  c.missions = [{ id: 1, kind: 'gdp', from: c.cache.gdp * 0.5, v: c.cache.gdp * 0.9, start: s.day, until: s.day + 3000, reward: { prestige: 2, money: 10 } }];
  const t0 = c.treasury, b0 = c.prestigeBonus || 0;
  monthlyMissions(s, map, R);
  assert.ok(c.treasury >= t0 + 10 - 1e-9 && c.prestigeBonus === b0 + 2, 'reward paid');
  assert.ok(!c.missions.some((m) => m.id === 1), 'completed objective removed');
  assert.ok(c.missions.length === 1 && c.missions[0].kind !== 'gdp', 'a new objective of another kind replaces it');
  // an expired objective is dropped
  c.missions[0].until = s.day - 1;
  monthlyMissions(s, map, R);
  assert.ok(c.missions.every((m) => m.until >= s.day));
  // a claim objective gives the AI a war motive against the holder
  const esp = tagIdx(g, 'ESP'), p = g.map.ids.find((i) => s.prov.owner[i] === esp);
  const ai = s.countries[tagIdx(g, 'PRT')];
  ai.missions = [{ id: 2, kind: 'claim', p, t: esp, start: s.day, until: s.day + 999, reward: {} }];
  assert.equal(missionMotive(s, map, R, ai, esp), R.nations.missions.aiMotive);
  assert.equal(missionMotive(s, map, R, ai, k), 0);
});

test('saves keep traits, advisors and missions; saves without them get traits on load', () => {
  const g = game({ player: 'FRA', seed: 'nsave' }), s = g.state;
  runDays(g, 200);
  const text = saveGame(g, {});
  const back = loadGame(text, data());
  for (const c of s.countries) {
    const b = back.state.countries[c.idx];
    assert.deepEqual(b.traits, c.traits); assert.deepEqual(b.advisors, c.advisors); assert.deepEqual(b.missions, c.missions);
    if (c.alive) assert.deepEqual(b.tfx.nat, c.tfx.nat);
  }
  // continue both: the same day after a month
  runDays(g, 40); runDays(back, 40);
  assert.equal(back.state.rng, s.rng);
  assert.deepEqual(back.state.countries.map((c) => c.missions?.length), s.countries.map((c) => c.missions?.length));
  // a save from before this feature (no traits, advisors, missions)
  const old = JSON.parse(text);
  for (const c of old.countries) { delete c.traits; delete c.advisors; delete c.missions; delete c.mHist; delete c.prestigeBonus; }
  const g3 = loadGame(JSON.stringify(old), data());
  assert.ok(g3.state.countries.filter((c) => c.alive).every((c) => c.traits?.length >= 1));
  runDays(g3, 40);
});
