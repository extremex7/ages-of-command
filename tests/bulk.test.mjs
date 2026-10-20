import test from 'node:test';
import assert from 'node:assert/strict';
import { game } from './helpers.mjs';
import { scopeProvinces, bulkPlan, bulkBuild, neededProjects, buildNeeded } from '../src/core/bulk.js';
import { aiEconomy } from '../src/core/ai.js';
import { computeLedgers } from '../src/core/economy.js';

const quiet = (player = 'POL') => game({ player, settings: { aiAggression: 0, eventRate: 0 } });

test('bulk: infrastructure in every province of the country, costed first, limited by money and queue', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const k = s.player, c = s.countries[k];
  const own = scopeProvinces(s, map, k, { type: 'country' });
  assert.ok(own.length > 5);
  c.treasury = 1e4;
  const plan = bulkPlan(s, map, rules, k, own, 'infra');
  assert.ok(plan.sites.length > 0 && plan.n === Math.min(plan.sites.length, plan.room));
  assert.ok(Math.abs(plan.total - plan.sites.filter((x) => x.ok).reduce((t, x) => t + x.cost, 0)) < 1e-9);
  const q0 = s.construction.length, t0 = c.treasury;
  const r = bulkBuild(s, map, rules, k, own, 'infra');
  assert.equal(r.started, plan.n);
  assert.equal(s.construction.length, q0 + plan.n);
  assert.ok(Math.abs(t0 - c.treasury - plan.total) < 1e-6, `spent ${t0 - c.treasury}, planned ${plan.total}`);
  // a short treasury: only what it pays for, best sites first
  const g2 = quiet();
  const s2 = g2.state, own2 = scopeProvinces(s2, g2.map, s2.player, { type: 'country' });
  const full = bulkPlan(s2, g2.map, g2.rules, s2.player, own2, 'infra');
  s2.countries[s2.player].treasury = full.sites[0].cost * 2.5;
  const part = bulkPlan(s2, g2.map, g2.rules, s2.player, own2, 'infra');
  assert.equal(part.n, 2);
  assert.ok(part.sites[0].ok && part.sites[1].ok && !part.sites[2].ok && part.sites[2].why === 'not enough money');
});

test('bulk: a building in a painted set or a region; unsuitable provinces skipped', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const k = s.player;
  s.countries[k].treasury = 1e4;
  const own = scopeProvinces(s, map, k, { type: 'country' });
  const painted = scopeProvinces(s, map, k, { type: 'list', provs: [own[0], own[1], 99999 % map.count] });
  assert.deepEqual(painted, [own[0], own[1]].filter((p) => painted.includes(p)));
  const region = scopeProvinces(s, map, k, { type: 'region', iso: map.iso[own[0]] });
  assert.ok(region.length > 0 && region.every((p) => map.iso[p] === map.iso[own[0]]));
  const mine = rules.econ.bi.coal_mine;
  const plan = bulkPlan(s, map, rules, k, own, 'building', mine);
  const X = rules.econ;
  assert.ok(plan.sites.every((x) => s.econ.dep[x.p * X.R + X.buildings[mine].dep] > 0), 'only provinces with coal');
  assert.equal(plan.sites.length + plan.skipped, own.length);
});

test('bulk: build where most needed, and the auto-managed economy', () => {
  const g = quiet();
  const { state: s, map, rules } = g;
  const k = s.player, c = s.countries[k];
  c.treasury = 1e4;
  c.econ.need[rules.econ.gi.steel] += 50; // a big steel shortfall
  const list = neededProjects(s, map, rules, k);
  assert.ok(list.length > 0);
  const steel = list.find((x) => x.g === rules.econ.gi.steel);
  assert.ok(steel && steel.sites.length > 0 && steel.cost > 0, JSON.stringify(list.map((x) => x.good)));
  const q0 = s.construction.length;
  const r = buildNeeded(s, map, rules, k, steel);
  assert.equal(r.started, steel.sites.length);
  assert.equal(s.construction.length, q0 + r.started);
  // auto-manage economy: the AI builds for the player
  const g2 = quiet('DEU');
  const s2 = g2.state, me = s2.player;
  computeLedgers(s2, g2.map, g2.rules);
  s2.countries[me].treasury = 1e4;
  const count = () => s2.construction.filter((p) => p.owner === me).length;
  for (let m = 0; m < 2; m++) { s2.day += 31; aiEconomy(s2, g2.map, g2.rules); }
  assert.equal(count(), 0, 'nothing without the toggle');
  s2.countries[me].autoEconomy = true;
  for (let m = 0; m < 2; m++) { s2.day += 31; aiEconomy(s2, g2.map, g2.rules); }
  assert.ok(count() > 0, 'the AI built for the player');
});
