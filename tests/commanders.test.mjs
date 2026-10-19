import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { hireGeneral, assignGeneral, generalFx, battleExperience } from '../src/core/commanders.js';
import { makeFront, makeAttack, executePlan, frontProvinces, planBonus } from '../src/core/plans.js';
import { sideStats } from '../src/core/combat.js';
import { declareWar } from '../src/core/war.js';
import { mergeArmies } from '../src/core/military.js';

test('generals: every army starts with one; skill and traits change combat; they rise with victories', () => {
  const g = game({ seed: 'gen' }), s = g.state, R = g.rules;
  runDays(g, 40); // past the first month
  const led = s.armies.filter((a) => a.gen).length;
  assert.ok(s.armies.length > 50 && led / s.armies.length > 0.9, `armies with generals: ${led} of ${s.armies.length}`);
  const a = s.armies.find((x) => x.owner === tagIdx(g, 'FRA') && x.gen);
  const gen = a.gen;
  const base = sideStats(s, [a.id], 'att', 'plains', R, a.loc).dmg;
  assignGeneral(s, a.id, 0);
  assert.equal(a.gen, null);
  assert.ok(s.countries[a.owner].generals.includes(gen), 'relieved general waits in the pool');
  const none = sideStats(s, [a.id], 'att', 'plains', R, a.loc).dmg;
  assert.ok(base > none, `a general adds damage (${base.toFixed(2)} vs ${none.toFixed(2)})`);
  assignGeneral(s, a.id, gen.id);
  gen.traits = ['mountaineer'];
  assert.ok(generalFx(R, a).terrain.mountains > 1 && !generalFx(R, a).terrain.plains);
  const before = gen.skill;
  for (let i = 0; i < 12; i++) battleExperience(s, R, [a], [], 'plains', () => 'att');
  assert.ok(gen.skill > before && gen.wins === 12, `skill ${before} -> ${gen.skill}`);
  // hiring costs money and is capped
  const k = a.owner, c = s.countries[k], t0 = c.treasury;
  const h1 = hireGeneral(s, g.map, R, k);
  assert.equal(typeof h1, 'object');
  assert.ok(c.treasury < t0);
  let err = null;
  for (let i = 0; i < 50 && !err; i++) { const r = hireGeneral(s, g.map, R, k); if (typeof r === 'string') err = r; }
  assert.match(err, /every army|money/);
  // the merged army keeps the better general, the other waits; generals survive a save
  const b = s.armies.find((x) => x.owner === k && x.id !== a.id && !x.battle);
  if (!b.gen) assignGeneral(s, b.id, c.generals[0].id);
  b.loc = a.loc; b.path = []; a.path = [];
  const best = a.gen.skill >= b.gen.skill ? a.gen : b.gen, other = best === a.gen ? b.gen : a.gen;
  assert.equal(mergeArmies(s, [a.id, b.id]), null);
  assert.equal(a.gen, best);
  assert.ok(c.generals.includes(other));
  const again = loadGame(saveGame(g), data()).state;
  assert.equal(again.armies.find((x) => x.id === a.id).gen.name, best.name);
});

test('battle plans: a front spreads armies along the border; an attack prepares, then advances', () => {
  const g = game({ seed: 'plan', player: 'IND' }), s = g.state, map = g.map, R = g.rules;
  runDays(g, 2);
  const de = tagIdx(g, 'IND'), pl = tagIdx(g, 'PAK');
  const mine = s.armies.filter((a) => a.owner === de).slice(0, 3);
  assert.equal(mine.length, 3);
  const front = makeFront(s, map, R, de, mine.map((a) => a.id), pl);
  assert.equal(typeof front, 'object', String(front));
  const line = frontProvinces(s, map, de, pl);
  runDays(g, 160);
  assert.ok(mine.every((a) => line.includes(a.loc)), 'armies on the Pakistani border');
  assert.equal(new Set(mine.map((a) => a.loc)).size, 3, 'spread over three provinces');
  // attack: preparation builds a bonus, then the armies take the target
  assert.equal(declareWar(s, map, R, de, pl), null);
  const target = provOf(g, 'PAK').find((p) => map.adj.slice(map.adjStart[p], map.adjStart[p + 1]).some((q) => line.includes(q)));
  const plan = makeAttack(s, map, R, de, mine.map((a) => a.id), target);
  assert.equal(typeof plan, 'object', String(plan));
  assert.ok(!s.plans.includes(front) || !front.armies.length, 'the armies left the front plan');
  runDays(g, 20);
  assert.ok(plan.prep > 0.5 && planBonus(s, R, mine[0]) > 0.07, `prepared ${plan.prep}`);
  executePlan(s, plan.id);
  let took = false;
  for (let d = 0; d < 200 && !took; d++) { runDays(g, 1); took = s.prov.controller[target] === de; }
  assert.ok(took, 'target taken');
  runDays(g, 3);
  assert.ok(!s.plans.includes(plan), 'plan finished');
});
