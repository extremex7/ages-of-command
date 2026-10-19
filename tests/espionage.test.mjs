import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { setBuilding, networkIn, canSpy, spyOperation, spyOdds, intelUpkeep } from '../src/core/espionage.js';
import { overlordOf } from '../src/core/diplomacy.js';
import { computeLedgers } from '../src/core/economy.js';
import { available } from '../src/core/technology.js';

test('espionage: a network grows while built and costs money; counter-intelligence slows it', () => {
  const g = game({ seed: 'spy1', player: 'IND' }), s = g.state, R = g.rules;
  runDays(g, 2);
  const me = tagIdx(g, 'IND'), pk = tagIdx(g, 'PAK'), cn = tagIdx(g, 'CHN');
  assert.equal(setBuilding(s, R, me, pk, true), null);
  assert.equal(setBuilding(s, R, me, cn, true), null);
  s.countries[cn].spy ||= { nets: {}, building: [], counter: false };
  s.countries[cn].spy.counter = true;
  computeLedgers(s, g.map, R);
  assert.ok(s.countries[me].ledger.intel > 0 && intelUpkeep(s, R, s.countries[me]) > 0, 'the service is paid for');
  runDays(g, 95);
  const a = networkIn(s, me, pk), b = networkIn(s, me, cn);
  assert.ok(a >= 15 && b < a, `network in Pakistan ${a}, in China ${b}`);
  assert.match(canSpy(s, R, me, pk, 'coup'), /network|secure/);
  setBuilding(s, R, me, pk, false);
  runDays(g, 62);
  assert.ok(networkIn(s, me, pk) < a, 'an abandoned network fades');
  const again = loadGame(saveGame(g), data()).state;
  assert.equal(networkIn(again, me, cn), networkIn(s, me, cn));
});

test('espionage: stealing technology, and a coup that makes a small country a puppet', () => {
  const g = game({ seed: 'spy2', player: 'IND' }), s = g.state, R = g.rules, map = g.map;
  runDays(g, 2);
  const me = tagIdx(g, 'IND'), us = tagIdx(g, 'USA'), np = tagIdx(g, 'NPL');
  const c = s.countries[me], n = s.countries[np];
  n.spy = { nets: { [us]: 100 }, building: [], counter: false };
  // Nepal forgets a technology the United States knows, so there is something to steal
  const T = s.tech.T, gone = R.tech.list.filter((x) => s.tech.known[us * T + x.i] && s.tech.known[np * T + x.i] && available(s, R, np, x.i) === false).find((x) => { s.tech.known[np * T + x.i] = 0; if (available(s, R, np, x.i)) return true; s.tech.known[np * T + x.i] = 1; return false; });
  assert.ok(gone, 'a technology to steal');
  assert.equal(canSpy(s, R, np, us, 'steal'), null);
  let stole = false;
  for (let i = 0; i < 8 && !stole; i++) { n.spy.nets[us] = 100; const r = spyOperation(s, map, R, np, us, 'steal'); stole = r.ok && /stole/.test(r.what); }
  assert.ok(stole, 'technology or research stolen');
  c.spy = { nets: { [np]: 100 }, building: [], counter: false };
  // a coup needs a shaky government
  assert.match(canSpy(s, R, me, np, 'coup'), /too secure/);
  const t = s.countries[np];
  let done = false;
  for (let i = 0; i < 12 && !done; i++) {
    t.stability = 5; c.spy.nets[np] = 100;
    assert.ok(spyOdds(s, R, me, np, 'coup').success > 0.3);
    done = spyOperation(s, map, R, me, np, 'coup').ok;
  }
  assert.ok(done, 'coup succeeded');
  assert.equal(t.gov, c.gov, 'friendly government installed');
  assert.equal(overlordOf(s, np), me, 'Nepal is now a puppet');
  runDays(g, 35);
});
