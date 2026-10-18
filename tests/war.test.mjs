import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, provOf } from './helpers.mjs';
import { declareWar, canDeclareWar, evaluatePeace, makePeace, warScore, transferProvince } from '../src/core/war.js';
import { atWar, canEnter } from '../src/core/relations.js';

const quiet = () => game({ settings: { aiAggression: 0 } });

test('declaring war on an alliance member calls in its allies', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const rus = tagIdx(g, 'RUS'), pol = tagIdx(g, 'POL'), usa = tagIdx(g, 'USA');
  assert.equal(declareWar(state, map, rules, rus, pol), null);
  assert.ok(atWar(state, rus, usa), 'NATO ally joined');
  assert.ok(canEnter(state, usa, state.countries[pol].capital), 'allies may enter each other');
  assert.match(canDeclareWar(state, map, rus, pol), /Already/);
  assert.match(canDeclareWar(state, map, pol, usa), /allied/);
});

test('peace: demands must be backed by war score; transfers ownership; truce follows', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const a = tagIdx(g, 'ARG'), b = tagIdx(g, 'URY');
  declareWar(state, map, rules, a, b);
  const war = state.wars[state.wars.length - 1];
  const target = provOf(g, 'URY')[0];
  assert.match(evaluatePeace(state, map, rules, war, a, { provinces: [target], to: a }).reason, /occupied/);
  for (const p of provOf(g, 'URY')) state.prov.controller[p] = a; // full occupation
  assert.ok(warScore(state, map, rules, war) >= 99);
  const ev = evaluatePeace(state, map, rules, war, a, { provinces: [target], to: a });
  assert.ok(ev.accept, ev.reason);
  makePeace(state, map, rules, war, a, { provinces: [target], to: a });
  assert.equal(state.prov.owner[target], a);
  assert.ok(!atWar(state, a, b));
  for (const p of provOf(g, 'URY')) assert.equal(state.prov.controller[p], b, 'unceded occupations end');
  assert.match(canDeclareWar(state, map, a, b), /Truce/);
});

test('excessive demands are refused', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const a = tagIdx(g, 'CHN'), b = tagIdx(g, 'VNM');
  declareWar(state, map, rules, a, b);
  const war = state.wars[0];
  const vn = provOf(g, 'VNM');
  state.prov.controller[vn[0]] = a; state.prov.controller[vn[1]] = a;
  const ev = evaluatePeace(state, map, rules, war, a, { provinces: [vn[0], vn[1]], to: a });
  const score = warScore(state, map, rules, war);
  assert.equal(ev.accept, ev.cost <= score);
});

test('a country that loses all provinces is eliminated', () => {
  const g = quiet();
  const { state, map } = g;
  const lux = tagIdx(g, 'LUX'), bel = tagIdx(g, 'BEL');
  for (const p of provOf(g, 'LUX')) transferProvince(state, map, p, bel);
  assert.equal(state.countries[lux].alive, false);
  assert.ok(!state.armies.some((x) => x.owner === lux));
});
