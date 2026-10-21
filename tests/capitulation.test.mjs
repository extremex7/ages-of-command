import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, provOf, data } from './helpers.mjs';
import { declareWar, joinWar } from '../src/core/war.js';
import { atWar } from '../src/core/relations.js';
import { refreshCountryCache } from '../src/core/state.js';
import { dailyCapitulation, capitulationStatus, capitulationTerms } from '../src/core/capitulation.js';
import { overlordOf } from '../src/core/diplomacy.js';
import { saveGame, loadGame } from '../src/core/game.js';

const quiet = (o = {}) => game({ settings: { aiAggression: 0, ...o.settings }, player: o.player });

// occupies `share` of b's provinces, the capital first, by a
function occupy(g, a, tag, share) {
  const s = g.state, b = tagIdx(g, tag), cap = s.countries[b].capital;
  const list = [cap, ...provOf(g, tag).filter((p) => p !== cap)];
  for (const p of list.slice(0, Math.ceil(list.length * share))) s.prov.controller[p] = a;
  refreshCountryCache(s, g.map, g.rules);
}

test('capitulation: a beaten war leader gives up on default terms', () => {
  const g = quiet({ player: 'ARG' });
  const { state: s, map, rules } = g;
  const a = tagIdx(g, 'ARG'), b = tagIdx(g, 'BOL');
  assert.equal(declareWar(s, map, rules, a, b), null);
  const war = s.wars[s.wars.length - 1];
  assert.deepEqual(war.defenders, [b], 'nobody joins Bolivia');
  occupy(g, a, 'BOL', 0.5);
  war.start -= 60;
  assert.equal(capitulationStatus(s, map, rules, war, b).would, false, 'half is not enough');
  dailyCapitulation(s, map, rules);
  assert.ok(s.wars.includes(war));
  occupy(g, a, 'BOL', 0.7);
  const st = capitulationStatus(s, map, rules, war, b);
  assert.ok(st.would && st.capital && st.share >= 0.6, JSON.stringify(st));
  const terms = capitulationTerms(s, map, rules, war, a);
  assert.ok(terms.subject || terms.provinces.length > 0, 'land or a subject');
  const before = provOf(g, 'BOL').length;
  dailyCapitulation(s, map, rules);
  assert.ok(!s.wars.includes(war) && !atWar(s, a, b), 'the war is over');
  assert.ok(s.countries[b].alive, 'the loser survives');
  if (terms.subject) assert.equal(overlordOf(s, b), a);
  else assert.ok(provOf(g, 'BOL').length < before && provOf(g, 'BOL').length >= before * 0.4, 'gave some land, kept most');
  assert.ok(s.log.some((l) => /Bolivia capitulated to Argentina/.test(l.text)));
  assert.equal(s.capitulations.length, 1, 'a notice for the player');
  assert.equal(s.capitulations[0].country, b);
  // the notice survives a save
  assert.equal(loadGame(saveGame(g), data()).state.capitulations.length, 1);
});

test('capitulation: a co-belligerent leaves alone and the war goes on; the threshold can be turned off', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const a = tagIdx(g, 'ARG'), b = tagIdx(g, 'BOL'), c = tagIdx(g, 'PRY');
  declareWar(s, map, rules, a, b);
  const war = s.wars[s.wars.length - 1];
  joinWar(s, map, rules, war, c, 'D');
  war.start -= 60;
  occupy(g, a, 'PRY', 0.8);
  dailyCapitulation(s, map, rules);
  assert.ok(s.wars.includes(war), 'Bolivia fights on');
  assert.ok(!war.defenders.includes(c) && !atWar(s, a, c), 'Paraguay is out');
  assert.ok(s.log.some((l) => /Paraguay capitulated/.test(l.text)));
  // off: nothing happens even at full occupation
  const g2 = quiet({ settings: { capitulation: 0 } });
  declareWar(g2.state, g2.map, g2.rules, a, b);
  const w2 = g2.state.wars[g2.state.wars.length - 1];
  w2.start -= 60;
  occupy(g2, a, 'BOL', 1);
  dailyCapitulation(g2.state, g2.map, g2.rules);
  assert.ok(g2.state.wars.includes(w2));
});

test('capitulation: a leader whose allies still stand hands over the lead', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const a = tagIdx(g, 'ARG'), b = tagIdx(g, 'BOL'), c = tagIdx(g, 'PRY');
  declareWar(s, map, rules, a, b);
  const war = s.wars[s.wars.length - 1];
  joinWar(s, map, rules, war, c, 'D');
  war.start -= 60;
  occupy(g, a, 'BOL', 0.9);
  dailyCapitulation(s, map, rules);
  assert.ok(s.wars.includes(war) && war.leaderD === c && !war.defenders.includes(b));
});
