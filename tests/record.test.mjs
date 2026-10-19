import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { startRecord, summary, recordPeace } from '../src/core/record.js';

test('record: yearly history, deeds, achievements, and the summary headline', () => {
  const g = game({ seed: 'rec', player: 'POL' }), s = g.state, k = tagIdx(g, 'POL');
  const R = startRecord(s);
  assert.equal(R.k, k);
  assert.ok(R.start.rank > 0 && R.start.gdp > 0);
  s.countries[k].stability = 95;
  R.n.battlesWon = 1;
  runDays(g, 40);
  assert.ok(s.log.some((l) => l.achievement === 'content'), 'logged for the player');
  runDays(g, 360);
  const got = Object.keys(s.record.ach);
  assert.ok(got.includes('content') && got.includes('first_victory'), got.join(', '));
  assert.ok(s.record.hist.length >= 2, 'a January sample');
  // a won war counts for everyone on the winning side
  recordPeace(s, { attackers: [k, 3], defenders: [7] }, 3, true);
  recordPeace(s, { attackers: [k], defenders: [7] }, 7, false);
  assert.deepEqual([s.record.n.warsWon, s.record.n.whitePeace], [1, 1]);
  // the headline compares the start with now
  s.record.start.rank = s.prestige.rank[k] + 30;
  const S = summary(s);
  assert.match(S.headline, new RegExp(`rose from #${s.prestige.rank[k] + 30} to #${s.prestige.rank[k]}`));
  // kept in saves
  const again = loadGame(saveGame(g), data()).state;
  assert.deepEqual(Object.keys(again.record.ach).sort(), got.sort());
  // cheats: no achievements
  s.cheated = true; s.countries[k].stability = 95;
  delete s.record.ach.content;
  runDays(g, 40);
  assert.ok(!s.record.ach.content);
  // observer mode records nothing
  const o = game({ seed: 'obs' });
  runDays(o, 40);
  assert.equal(o.state.record, undefined);
});
