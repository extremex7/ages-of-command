import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, data } from './helpers.mjs';
import { tick, } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { computePrestige, rankChange, starOf } from '../src/core/prestige.js';

test('prestige ranks every living country, with the large powers on top', () => {
  const g = game({ player: 'FRA' });
  const P = g.state.prestige;
  const alive = g.state.countries.filter((c) => c.alive);
  const ranks = alive.map((c) => P.rank[c.idx]).sort((a, b) => a - b);
  assert.deepEqual(ranks, alive.map((_, i) => i + 1), 'ranks are 1..N without gaps');
  for (const t of ['USA', 'CHN']) assert.ok(P.rank[tagIdx(g, t)] <= 5, `${t} is in the top 5 (rank ${P.rank[tagIdx(g, t)]})`);
  assert.ok(P.rank[tagIdx(g, 'TUV')] > 100, 'Tuvalu ranks low');
  for (const c of alive) assert.ok(P.score[c.idx] > 0 && P.score[c.idx] <= 100);
  assert.equal(starOf(1).id, 'gold'); assert.equal(starOf(10).id, 'gold'); assert.equal(starOf(11).id, 'silver');
  assert.equal(starOf(50).id, 'bronze'); assert.equal(starOf(51), null);
});

test('rank history is kept each January, survives saving, and marks rising stars', () => {
  const g = game({ player: 'FRA', seed: 'prestige' });
  const s = g.state;
  for (let i = 0; i < 400; i++) tick(g);
  assert.ok(s.prestige.hist.length >= 2, 'a January snapshot was added');
  const back = loadGame(saveGame(g, {}), data());
  assert.deepEqual(back.state.prestige.rank, s.prestige.rank);
  assert.equal(back.state.prestige.hist.length, s.prestige.hist.length);
  // a country that climbs from 100th to 30th is a rising star; 50th to 45th is not
  const k = tagIdx(g, 'NPL'), j = tagIdx(g, 'PER');
  s.prestige.hist[0].rank[k] = 100; s.prestige.rank[k] = 30;
  s.prestige.hist[0].rank[j] = 50; s.prestige.rank[j] = 45;
  assert.equal(rankChange(s, k).rising, true);
  assert.equal(rankChange(s, k).change, 70);
  assert.equal(rankChange(s, j).rising, false);
  computePrestige(s);
});
