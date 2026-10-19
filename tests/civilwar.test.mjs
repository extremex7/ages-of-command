import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { startCivilWar, civilWarChance, monthlyCivilWar } from '../src/core/civilwar.js';
import { refreshCountryCache } from '../src/core/state.js';

test('civil war: an unstable country splits into a working rebel country at war with it', () => {
  const g = game({ seed: 'civil' }), s = g.state, map = g.map, rules = g.rules;
  runDays(g, 1);
  const k = tagIdx(g, 'NGA'), c = s.countries[k];
  const before = c.cache.provinces, C0 = s.countries.length;
  const reb = startCivilWar(s, map, rules, k, 'test');
  assert.ok(reb, 'rebels formed');
  assert.equal(s.countries.length, C0 + 1);
  assert.equal(reb.idx, C0);
  const lost = before - c.cache.provinces;
  assert.ok(lost >= 1 && lost < before, `rebels took ${lost} of ${before} provinces`);
  assert.ok(map.ids.every((i) => s.prov.owner[i] !== reb.idx || i !== c.capital), 'capital stays with the government');
  const war = s.wars.find((w) => w.kind === 'civil');
  assert.deepEqual([war.leaderA, war.leaderD], [reb.idx, k]);
  assert.ok(s.armies.some((a) => a.owner === reb.idx), 'rebels have an army');
  assert.equal(s.tech.known.length, s.countries.length * s.tech.T, 'technology table grew');
  // the game runs on with the new country, and saves and loads
  runDays(g, 120);
  const again = loadGame(saveGame(g), data());
  assert.equal(again.state.countries.length, s.countries.length);
  assert.equal(again.state.countries[reb.idx].tag, reb.tag);
  runDays({ ...g, state: again.state }, 40);
});

test('civil war: only deeply unstable, divided countries split; the government can reunite them', () => {
  const g = game({ seed: 'civil2' }), s = g.state, map = g.map, rules = g.rules;
  runDays(g, 1);
  const k = tagIdx(g, 'FRA'), c = s.countries[k];
  assert.equal(civilWarChance(s, rules, c), 0, 'a stable country does not split');
  c.stability = 3;
  for (const f of Object.keys(c.govt.approval)) c.govt.approval[f] = 5;
  assert.ok(civilWarChance(s, rules, c) > 0, 'an unstable, divided one may');
  const reb = startCivilWar(s, map, rules, k);
  const war = s.wars.find((w) => w.kind === 'civil');
  // the government occupies every rebel province: the country is reunited
  for (const i of map.ids) if (s.prov.owner[i] === reb.idx) s.prov.controller[i] = k;
  refreshCountryCache(s, map, rules);
  const provs = c.cache.provinces;
  monthlyCivilWar(s, map, rules, new Map([[war, -50]]));
  assert.ok(!s.wars.includes(war), 'war over');
  assert.equal(reb.alive, false, 'rebels gone');
  assert.ok(c.cache.provinces > provs, 'provinces returned');
});
