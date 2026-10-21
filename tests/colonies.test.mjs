import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data } from './helpers.mjs';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { colonyPlan, startColony, dailyColonies, reachable, seaReach, cancelColony, colonySource } from '../src/core/colonies.js';
import { canEnter } from '../src/core/relations.js';
import { runDays } from '../src/core/sim.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const rome = (o = {}) => { const d = data(); return newGame({ map: d.map, rules: d.rules, scenario: rd('data/scenarios/height_of_rome_117.json'), playerTag: o.player ?? null, seed: o.seed ?? 'col', settings: { aiAggression: 0, eventRate: 0 } }); };

test('colonies: settle unowned land next to your own; armies still cannot enter it', () => {
  const g = rome({ player: 'ROM' });
  const { state: s, map, rules } = g;
  const k = s.player;
  const targets = reachable(s, map, rules, k);
  assert.ok(targets.length > 10, `${targets.length} provinces in reach`);
  const land = targets.find((p) => { const src = colonySource(s, map, rules, k, p); return src && !src.sea; });
  assert.ok(land != null, 'a land neighbour');
  assert.equal(canEnter(s, k, land), false, 'unowned land stays closed to armies');
  s.countries[k].treasury = 50;
  const plan = colonyPlan(s, map, rules, k, land);
  assert.equal(plan.why, null, plan.why);
  assert.ok(plan.cost > 0 && plan.days > 0 && plan.chance > 0.5 && plan.chance <= 0.95);
  const t0 = s.countries[k].treasury, pop0 = s.prov.pop[plan.from];
  assert.equal(startColony(s, map, rules, k, land), null);
  assert.ok(Math.abs(s.countries[k].treasury - (t0 - plan.cost)) < 1e-9);
  assert.equal(s.prov.pop[plan.from], pop0 - plan.settlers);
  assert.match(colonyPlan(s, map, rules, k, land).why, /already on their way/);
  // a save in the middle keeps the project
  const g2 = loadGame(saveGame(g), { ...data(), scenario: rd('data/scenarios/height_of_rome_117.json') });
  assert.equal(g2.state.colonies.length, 1);
  // arrival: certain success here
  s.colonies[0].chance = 1;
  s.day = s.colonies[0].end;
  dailyColonies(s, map, rules);
  assert.equal(s.prov.owner[land], k);
  assert.equal(s.prov.controller[land], k);
  assert.ok(s.prov.pop[land] >= plan.settlers && s.prov.dev[land] >= 1);
  assert.equal(s.colonies.length, 0);
  assert.ok(s.log.some((l) => /colony was founded/.test(l.text)));
  assert.match(colonyPlan(s, map, rules, k, land).why, /Only unowned land/);
});

test('colonies: failure, cancellation, reach by sea, limits', () => {
  const g = rome({ player: 'ROM' });
  const { state: s, map, rules } = g;
  const k = s.player;
  s.countries[k].treasury = 50;
  const [p1, p2] = reachable(s, map, rules, k).filter((p) => !colonyPlan(s, map, rules, k, p).why);
  startColony(s, map, rules, k, p1);
  s.colonies[0].chance = 0;
  s.day = s.colonies[0].end;
  dailyColonies(s, map, rules);
  assert.ok(s.prov.owner[p1] < 0, 'failed');
  startColony(s, map, rules, k, p2);
  const t = s.countries[k].treasury;
  assert.equal(cancelColony(s, rules, s.colonies[0].id), null);
  assert.ok(s.countries[k].treasury > t, 'half refunded');
  assert.ok(seaReach(s, rules, k) >= 1, 'Rome sails');
  // the Americas are beyond the reach of an ancient navy
  const far = map.ids.find((i) => s.prov.owner[i] < 0 && map.lon[i] < -60 && map.lat[i] > 0);
  assert.match(colonyPlan(s, map, rules, k, far).why, /No province of yours borders it/);
});

test('colonies: the AI settles land over a few years', () => {
  const g = rome({ seed: 'colai' });
  const { state: s, map } = g;
  let owned0 = 0;
  for (const i of map.ids) if (s.prov.owner[i] >= 0) owned0++;
  runDays(g, 3 * 365);
  let owned = 0;
  for (const i of map.ids) if (s.prov.owner[i] >= 0) owned++;
  assert.ok(owned > owned0 || (s.colonies || []).length > 0, `owned ${owned0} -> ${owned}`);
});
