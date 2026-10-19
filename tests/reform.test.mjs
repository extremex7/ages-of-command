import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { monthlyGovernment } from '../src/core/government.js';

test('AI government reform: only a government in trouble reforms, and only into a type it may', () => {
  const g = game({ seed: 'reform' }), s = g.state, map = g.map;
  runDays(g, 2);
  const G = g.rules.balance.government;
  const rules = { ...g.rules, balance: { ...g.rules.balance, government: { ...G, aiReformGain: -1000, aiReformChance: 1 } } };
  const k = tagIdx(g, 'CHL'), c = s.countries[k];
  const from = c.gov, allowed = g.rules.politics.types[from].reformsTo;
  c.stability = 60; c.govt.reformDay = -1e9;
  // content: no reform all year
  c.govt.legitimacy = 80; c.govt.approvalAll = 70;
  for (let m = 0; m < 12; m++) { s.day += 31; c.govt.legitimacy = 80; c.govt.approvalAll = 70; monthlyGovernment(s, map, rules, new Map()); }
  assert.equal(c.gov, from, 'a content government stays');
  // in trouble: it reforms within a year
  for (let m = 0; m < 12 && c.gov === from; m++) { s.day += 31; c.govt.legitimacy = 20; c.stability = 60; monthlyGovernment(s, map, rules, new Map()); }
  assert.notEqual(c.gov, from, 'reformed');
  assert.ok(allowed.includes(c.gov), `${from} → ${c.gov} is a permitted reform`);
  assert.ok(s.aiLog.some((l) => l.c === k && /^Reformed into/.test(l.text)), 'the reason is in the AI log');
});
