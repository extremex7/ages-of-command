import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { deserialize } from '../src/core/save.js';

function fingerprint(s) {
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  mix(s.day);
  for (let i = 0; i < s.prov.owner.length; i++) { mix(s.prov.owner[i]); mix(s.prov.controller[i]); }
  for (const a of s.armies) { mix(a.id); mix(a.loc); mix(Math.round(a.str * 1e4)); }
  for (const c of s.countries) {
    mix(Math.round(c.treasury * 100));
    for (const v of c.econ.stock) mix(Math.round(v * 1000));
    mix(Math.round(c.econ.cpi * 1e5));
  }
  for (const v of s.econ.bld) mix(v);
  for (const v of s.prov.infra) mix(v);
  for (const v of s.econ.prices) mix(Math.round(v * 1e6));
  mix(s.construction.length);
  mix(s.wars.length);
  return h;
}

function checkInvariants(g) {
  const { state, map } = g;
  const C = state.countries.length;
  for (const i of map.ids) {
    assert.ok(state.prov.owner[i] >= -1 && state.prov.owner[i] < C);
    assert.ok(state.prov.controller[i] >= -1 && state.prov.controller[i] < C);
  }
  for (const a of state.armies) {
    assert.ok(map.exists[a.loc], 'army on a real province');
    assert.ok(state.countries[a.owner].alive, 'army of a living country');
    assert.ok(a.str >= 0 && a.str <= 1.0001 && a.org >= 0 && a.org <= 1.0001);
  }
  for (const w of state.wars) assert.ok(w.attackers.length && w.defenders.length);
}

test('AI campaign: two aggressive years run with valid state and real decisions', () => {
  const g = game({ seed: 'ai-run', settings: { aiAggression: 4 } });
  runDays(g, 730);
  checkInvariants(g);
  assert.ok(g.state.aiLog.some((l) => l.text.startsWith('Declared war')), 'AI declared wars');
  assert.ok(g.state.reports.length > 0, 'battles were fought');
  assert.ok(g.state.aiLog.some((l) => l.text.startsWith('Made peace')), 'AI made peace');
});

test('determinism: same seed and inputs produce the same world', () => {
  const a = game({ seed: 'det', settings: { aiAggression: 2 } });
  const b = game({ seed: 'det', settings: { aiAggression: 2 } });
  runDays(a, 400); runDays(b, 400);
  assert.equal(fingerprint(a.state), fingerprint(b.state));
});

test('save/load: round trip is exact and the loaded game continues identically', () => {
  const g = game({ seed: 'save', player: 'FRA', settings: { aiAggression: 2 } });
  runDays(g, 200);
  const text = saveGame(g, { savedAt: 1 });
  const d = data();
  const g2 = loadGame(text, { map: d.map, rules: d.rules, scenario: d.scenario });
  assert.equal(fingerprint(g2.state), fingerprint(g.state));
  assert.equal(g2.state.player, tagIdx(g, 'FRA'));
  runDays(g, 150); runDays(g2, 150);
  assert.equal(fingerprint(g2.state), fingerprint(g.state), 'deterministic after reload');
});

// Turns a current save into the old v2 layout: province arrays packed as {t, b}, no economy.
function asV2(text) {
  const o = JSON.parse(text);
  for (const k in o.prov) o.prov[k] = { t: o.prov[k].$ta, b: o.prov[k].b };
  delete o.prov.infra; delete o.econ; delete o.construction;
  for (const c of o.countries) delete c.econ;
  o.version = 2;
  return o;
}

test('save validation and migration', () => {
  const d = data();
  assert.throws(() => deserialize('not json', d.map, d.rules), /JSON/);
  assert.throws(() => deserialize('{"hello":1}', d.map, d.rules), /Not an AOC3 save/);
  const g = game({ seed: 'mig' });
  const obj = JSON.parse(saveGame(g));
  obj.version = 999;
  assert.throws(() => deserialize(JSON.stringify(obj), d.map, d.rules), /newer/);
  // a version-1 save lacks offers/aiLog and the economy; migrations add them
  const v1 = asV2(saveGame(g));
  v1.version = 1; delete v1.offers; delete v1.aiLog;
  assert.throws(() => deserialize(JSON.stringify(v1), d.map, d.rules), /needs its scenario/);
  const s = deserialize(JSON.stringify(v1), d.map, d.rules, d.scenario);
  assert.deepEqual(s.offers, []);
  assert.equal(s.version, 4);
  assert.ok(s.countries.every((c) => c.govt && c.govt.fx), 'governments installed');
  assert.ok(s.econ && s.econ.bld.length === d.map.count * d.rules.econ.B, 'economy installed from the scenario');
  const usa = s.countries.findIndex((c) => c.tag === 'USA');
  assert.ok(Math.abs(s.countries[usa].cache.gdp - g.state.countries[usa].cache.gdp) / g.state.countries[usa].cache.gdp < 0.01, 'GDP preserved by calibration');
  // a v2 save continues to run after migration
  const g2 = loadGame(JSON.stringify(asV2(saveGame(g))), d);
  runDays(g2, 40);
  assert.ok(g2.state.countries[usa].econ.prod.some((x) => x > 0));
  const bad = JSON.parse(saveGame(g));
  delete bad.armies;
  assert.throws(() => deserialize(JSON.stringify(bad), d.map, d.rules), /missing "armies"/);
  const bad2 = JSON.parse(saveGame(g));
  delete bad2.econ;
  assert.throws(() => deserialize(JSON.stringify(bad2), d.map, d.rules), /missing the economy/);
});

test('performance: a simulated year stays well under the low-end budget', () => {
  const g = game({ seed: 'perf', settings: { aiAggression: 2 } });
  const t = performance.now();
  runDays(g, 365);
  const ms = performance.now() - t;
  assert.ok(ms < 8000, `one year took ${ms.toFixed(0)} ms`);
});
