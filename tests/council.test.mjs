import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { propose, monthlyCouncil, councilOf, tally, setSanction, dmzProvinces } from '../src/core/council.js';
import { declareWar } from '../src/core/war.js';
import { atWar, canEnter } from '../src/core/relations.js';
import { industryMonth } from '../src/core/industry.js';

const allVote = (s, r, v) => { for (const c of s.countries) if (c.alive) r.votes[c.idx] = v; };
const closeVote = (g, r) => { g.state.day = r.voteDay; monthlyCouncil(g.state, g.map, g.rules); };

test('sanctions: energy sanctions cut a country off from imported oil but not food', () => {
  const g = game({ seed: 'sanction' }), s = g.state, X = g.rules.econ;
  runDays(g, 35);
  const jp = tagIdx(g, 'JPN'), e = s.countries[jp].econ;
  industryMonth(s, g.map, g.rules);
  const oil0 = e.imp[X.gi.oil], food0 = e.imp[X.gi.food];
  assert.ok(oil0 > 0, 'Japan imports oil');
  for (const c of s.countries) if (c.alive && c.idx !== jp) setSanction(s, c.idx, jp, 'energy');
  industryMonth(s, g.map, g.rules);
  assert.equal(e.imp[X.gi.oil], 0, 'no oil comes in');
  assert.ok(food0 === 0 || e.imp[X.gi.food] > 0, 'food still trades');
});

test('world council: a ceasefire stops the fighting for a year; a DMZ keeps both armies out', () => {
  const g = game({ seed: 'council' }), s = g.state, map = g.map, R = g.rules;
  runDays(g, 35);
  const ind = tagIdx(g, 'IND'), pak = tagIdx(g, 'PAK'), usa = tagIdx(g, 'USA');
  assert.equal(declareWar(s, map, R, ind, pak), null);
  const war = s.wars.find((w) => w.leaderA === ind);
  assert.equal(war.justified, false);
  const r = propose(s, map, R, usa, { kind: 'ceasefire', war: war.id }).res;
  assert.ok(r, 'proposed');
  allVote(s, r, 'yes');
  closeVote(g, r);
  assert.ok(war.ceasefire > s.day && !atWar(s, ind, pak), 'ceasefire in force');
  assert.ok(s.wars.includes(war), 'still at war on paper');
  // a DMZ along the border
  const W = councilOf(s);
  W.lastBy = {};
  const d = propose(s, map, R, usa, { kind: 'dmz', a: ind, b: pak }).res;
  allVote(s, d, 'yes');
  const army = s.armies.find((a) => a.owner === ind);
  const zone = dmzProvinces(s, map, ind, pak);
  army.loc = zone.find((p) => s.prov.owner[p] === ind); army.path = [];
  closeVote(g, d);
  assert.ok(!zone.includes(army.loc), 'armies leave the zone');
  assert.equal(canEnter(s, ind, zone[0]), false);
  // saved and loaded with the game; the ceasefire runs out
  const again = loadGame(saveGame(g), data());
  assert.equal(again.state.council.active.length, 1);
  assert.equal(canEnter(again.state, ind, zone[0]), false);
  s.day = war.ceasefire;
  monthlyCouncil(s, map, R);
  assert.ok(atWar(s, ind, pak), 'fighting may resume');
});

test('world council: a permanent member can veto', () => {
  const g = game({ seed: 'veto' }), s = g.state, map = g.map, R = g.rules;
  runDays(g, 35);
  const W = councilOf(s);
  assert.equal(W.permanent.length, 5);
  const p = W.permanent[0], other = tagIdx(g, 'NPL');
  const r = propose(s, map, R, other, { kind: 'sanction', target: p, level: 'arms' }).res;
  allVote(s, r, 'yes');
  r.votes[p] = 'no';
  const t = tally(s, map, R, r);
  assert.ok(t.yes > t.no && !t.passes && t.veto.includes(p));
  closeVote(g, r);
  assert.ok(!W.active.some((x) => x.target === p));
});
