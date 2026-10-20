import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, data } from './helpers.mjs';
import { victoryConditions, victoryProgress, victoryLeaders, monthlyVictory, pendingVictory, continueAfterVictory } from '../src/core/victory.js';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { computePrestige } from '../src/core/prestige.js';
import { daysFromCivil } from '../src/core/calendar.js';
import { summary, startRecord } from '../src/core/record.js';

const withV = (victory, player = 'USA') => game({ player, settings: { aiAggression: 0, victory } });

test('victory: a sandbox game has no conditions and no winner', () => {
  const g = game({ settings: { aiAggression: 0 } });
  assert.deepEqual(victoryConditions(g.state, g.rules), []);
  runDays(g, 40);
  assert.equal(g.state.victory, undefined);
});

test('victory: conquest by share of the world, with progress and leaders', () => {
  const g = withV({ conquest: 0.03 });
  const { state: s, map, rules } = g;
  const conds = victoryConditions(s, rules);
  assert.deepEqual(conds.map((c) => c.id), ['conquest']);
  const lead = victoryLeaders(s, map, rules)[0];
  assert.ok(lead.k >= 0 && lead.value >= 1, 'someone already holds 3%');
  const won = monthlyVictory(s, map, rules);
  assert.equal(won.id, 'conquest');
  assert.equal(won.k, lead.k);
  assert.match(won.text, /won a conquest victory/);
  assert.equal(pendingVictory(s), won);
  continueAfterVictory(s);
  assert.equal(pendingVictory(s), null);
  assert.equal(monthlyVictory(s, map, rules), null, 'decided once');
  assert.ok(s.log.some((l) => l.victory === 'conquest'));
  const p = victoryProgress(s, map, rules, tagIdx(g, 'USA'))[0];
  assert.ok(p.value > 0 && p.value <= 1 && /provinces/.test(p.text));
  // kept in saves
  const again = loadGame(saveGame(g), data()).state;
  assert.equal(again.victory.won.k, won.k);
  assert.equal(again.victory.continued, true);
});

test('victory: economic share sustained for years', () => {
  const g = withV({ economy: 0.2, economyYears: 1 });
  const { state: s, map, rules } = g;
  const usa = tagIdx(g, 'USA');
  for (let m = 0; m < 11; m++) assert.equal(monthlyVictory(s, map, rules), null);
  assert.equal(s.victory.econ.k, usa);
  const p = victoryProgress(s, map, rules, usa)[0];
  assert.ok(p.value > 0.9 && p.value < 1, String(p.value));
  const won = monthlyVictory(s, map, rules);
  assert.equal(won?.k, usa);
  assert.equal(won.id, 'economy');
});

test('victory: technology era and prestige by an end date; the summary names the winner', () => {
  const g = withV({ tech: 'information' });
  const { state: s, map, rules } = g;
  const won = monthlyVictory(s, map, rules);
  assert.equal(won?.id, 'technology', 'modern countries know the information age already');
  const g2 = withV({ scoreYear: 2030 });
  const s2 = g2.state;
  assert.equal(victoryConditions(s2, g2.rules)[0].end, daysFromCivil(2030, 1, 1));
  assert.equal(monthlyVictory(s2, g2.map, g2.rules), null, 'not yet');
  s2.day = daysFromCivil(2030, 1, 1);
  computePrestige(s2);
  const w2 = monthlyVictory(s2, g2.map, g2.rules);
  assert.equal(w2.k, s2.prestige.rank.indexOf(1));
  startRecord(s2);
  const S = summary(s2);
  assert.ok(S.victory && S.victory.k === w2.k);
  // a past end date is ignored
  const g3 = withV({ scoreYear: 1990 });
  assert.deepEqual(victoryConditions(g3.state, g3.rules), []);
});
