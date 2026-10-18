import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, provOf } from './helpers.mjs';
import { computeLedgers, monthlyEconomy } from '../src/core/economy.js';
import { provinceGdp } from '../src/core/state.js';

test('ledger: revenue = taxable GDP x tax x efficiency; net balances', () => {
  const g = game();
  const { state, map, rules } = g;
  const k = tagIdx(g, 'DEU'), c = state.countries[k];
  computeLedgers(state, map, rules);
  const gdpMonth = provOf(g, 'DEU').reduce((s, i) => s + provinceGdp(state, i, rules.balance.economy) / 12, 0);
  const L = c.ledger;
  assert.ok(Math.abs(L.gdpMonth - gdpMonth) < 1e-6);
  assert.ok(Math.abs(L.taxRevenue - gdpMonth * c.tax * L.efficiency) < 1e-6);
  assert.ok(Math.abs(L.net - (L.revenue - L.civil - L.military - L.interest)) < 1e-9);
});

test('monthly economy applies the ledger to the treasury', () => {
  const g = game();
  const { state, map, rules } = g;
  const c = state.countries[tagIdx(g, 'BRA')];
  computeLedgers(state, map, rules);
  const before = c.treasury;
  monthlyEconomy(state, map, rules);
  assert.ok(Math.abs(c.treasury - (before + c.ledger.net)) < 1e-6);
});

test('raising taxes raises revenue; occupation removes taxable GDP', () => {
  const g = game();
  const { state, map, rules } = g;
  const k = tagIdx(g, 'ITA'), c = state.countries[k];
  computeLedgers(state, map, rules);
  const r1 = c.ledger.taxRevenue;
  c.tax += 0.1;
  computeLedgers(state, map, rules);
  assert.ok(c.ledger.taxRevenue > r1 * 1.3);
  const p = provOf(g, 'ITA')[0];
  state.prov.controller[p] = tagIdx(g, 'FRA');
  computeLedgers(state, map, rules);
  assert.ok(c.ledger.gdpLost > 0);
  assert.ok(state.countries[tagIdx(g, 'FRA')].ledger.requisition > 0, 'occupier requisitions');
});

test('debt costs interest and erodes stability', () => {
  const g = game();
  const { state, map, rules } = g;
  const c = state.countries[tagIdx(g, 'ESP')];
  c.treasury = -c.ledger.revenue * 20;
  const s0 = c.stability;
  for (let i = 0; i < 6; i++) monthlyEconomy(state, map, rules);
  assert.ok(c.ledger.interest > 0);
  assert.ok(c.stability < s0);
});

test('auto-balanced budgets: no major country starts in deficit', () => {
  const g = game();
  for (const tag of ['USA', 'CHN', 'IND', 'RUS', 'FRA', 'BRA', 'NGA']) {
    const c = g.state.countries[tagIdx(g, tag)];
    assert.ok(c.ledger.net >= -1e-9, `${tag} net ${c.ledger.net}`);
  }
});
