import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, borderPair } from './helpers.mjs';
import { declareWar, makePeace } from '../src/core/war.js';
import { newArmy } from '../src/core/state.js';
import { runDays } from '../src/core/sim.js';
import { mergeArmies, monthlyMilitary } from '../src/core/military.js';
import { sideStats } from '../src/core/combat.js';
import { expLevel, expMult, dilute, monthlyExperience, expRules } from '../src/core/experience.js';

const quiet = () => game({ settings: { aiAggression: 0, eventRate: 0 } });

test('experience: battles teach both sides, the winner more; capped; damage rises with it', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const a = tagIdx(g, 'ARG'), b = tagIdx(g, 'BOL');
  const [pa, pb] = borderPair(g, 'ARG', 'BOL');
  declareWar(s, map, rules, a, b);
  s.armies = s.armies.filter((x) => x.owner !== a && x.owner !== b);
  const big = newArmy(s, a, pb, { infantry: 8 }), small = newArmy(s, b, pb, { infantry: 2 });
  s.armies.push(big, small);
  for (let d = 0; d < 40 && s.armies.includes(big) && (big.battle || !s.reports.length); d++) runDays(g, 1);
  assert.ok(s.reports.some((r) => r.provName === map.name[pb]), 'a battle was fought');
  assert.ok(big.exp >= expRules(rules).win, `winner gained ${big.exp}`);
  if (s.armies.includes(small)) assert.ok(small.exp > 0 && small.exp < big.exp, 'the loser learned less');
  assert.ok(s.countries[a].expertise > 0, 'national expertise from the battle');
  // damage: an elite army hits harder than a green one, all else equal
  const x = newArmy(s, a, pa, { infantry: 4 });
  s.armies.push(x);
  const green = sideStats(s, [x.id], 'att', 'plains', rules, pa).dmg;
  x.exp = 1;
  const elite = sideStats(s, [x.id], 'att', 'plains', rules, pa).dmg;
  assert.ok(Math.abs(elite / green - expMult(rules, x)) < 1e-9 && elite > green * 1.2);
  assert.equal(expLevel(rules, 1), 'Elite');
  assert.equal(expLevel(rules, 0), 'Green');
});

test('experience: diluted by recruits, reinforcements and merges', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const a = tagIdx(g, 'ARG');
  const v = newArmy(s, a, s.countries[a].capital, { infantry: 4 });
  v.exp = 0.8; v.str = 0.5;
  s.armies.push(v);
  monthlyMilitary(s, map, rules);
  assert.ok(v.str > 0.5 && Math.abs(v.exp - 0.8 * 0.5 / v.str) < 1e-9, 'replacements dilute by strength');
  const w = newArmy(s, a, v.loc, { infantry: 4 });
  w.str = v.str;
  s.armies.push(w);
  const e0 = v.exp;
  mergeArmies(s, [v.id, w.id]);
  assert.ok(Math.abs(v.exp - e0 / 2) < 1e-9, 'merged with an equal green army: half');
  const f = { exp: 0.6 };
  dilute(f, 3, 4);
  assert.ok(Math.abs(f.exp - 0.45) < 1e-12);
});

test('expertise: won wars add it, peace wears it down', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const a = tagIdx(g, 'ARG'), b = tagIdx(g, 'URY');
  declareWar(s, map, rules, a, b);
  const war = s.wars[s.wars.length - 1];
  war.start -= 730;
  makePeace(s, map, rules, war, a, { provinces: [], reparations: true, to: a });
  const E = expRules(rules).expertise;
  assert.ok(Math.abs(s.countries[a].expertise - (E.warWon + 2 * E.warWonPerYear)) < 1e-6, String(s.countries[a].expertise));
  assert.ok(Math.abs(s.countries[b].expertise - E.warLost) < 1e-9);
  const before = s.countries[a].expertise;
  monthlyExperience(s, rules);
  assert.ok(Math.abs(s.countries[a].expertise - before * (1 - E.peaceDecay)) < 1e-9);
  assert.ok(s.countries[a].expertise <= E.cap);
});
