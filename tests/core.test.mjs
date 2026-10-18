import test from 'node:test';
import assert from 'node:assert/strict';
import { daysFromCivil, civilFromDays, parseDate, formatDate } from '../src/core/calendar.js';
import { pickProvince, buildIndex } from '../src/map/picking.js';
import { data, game, tagIdx, provOf } from './helpers.mjs';
import fs from 'node:fs';

test('calendar round-trips across eras and leap years', () => {
  for (const [y, m, d] of [[1970, 1, 1], [2000, 2, 29], [1900, 3, 1], [-500, 6, 15], [2400, 12, 31], [1, 1, 1]]) {
    assert.deepEqual(civilFromDays(daysFromCivil(y, m, d)), { y, m, d });
  }
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.equal(parseDate('2001-03-01') - parseDate('2001-02-28'), 1);
  assert.equal(parseDate('2000-03-01') - parseDate('2000-02-28'), 2);
  assert.equal(formatDate(daysFromCivil(-43, 3, 15)), '15 Mar 44 BCE');
  assert.throws(() => parseDate('yesterday'));
});

test('map: provinces, symmetric adjacency, full connectivity', () => {
  const { map } = data();
  assert.ok(map.ids.length > 2000, 'thousands of provinces');
  for (const i of map.ids) {
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      const j = map.adj[e];
      let back = false;
      for (let f = map.adjStart[j]; f < map.adjStart[j + 1]; f++) if (map.adj[f] === i) back = true;
      assert.ok(back, `edge ${i}->${j} has no reverse`);
    }
  }
  const seen = new Uint8Array(map.count), stack = [map.ids[0]];
  seen[map.ids[0]] = 1;
  let n = 0;
  while (stack.length) {
    const u = stack.pop(); n++;
    for (let e = map.adjStart[u]; e < map.adjStart[u + 1]; e++) if (!seen[map.adj[e]]) { seen[map.adj[e]] = 1; stack.push(map.adj[e]); }
  }
  assert.equal(n, map.ids.length, 'every province is reachable');
});

test('map: province ids match the append-only registry', () => {
  const { map } = data();
  const reg = JSON.parse(fs.readFileSync(new URL('../data/map/province_registry.json', import.meta.url)));
  for (const i of map.ids) assert.equal(reg.ids[map.key[i]], i);
});

test('picking finds the province under its own label point', () => {
  const { map } = data();
  const idx = buildIndex(map);
  let ok = 0;
  for (const i of map.ids) if (pickProvince(map, idx, map.x[i], map.y[i]) === i) ok++;
  assert.ok(ok / map.ids.length > 0.97, `picked ${ok}/${map.ids.length}`);
  assert.equal(pickProvince(map, idx, 10, 1500), -1, 'open ocean picks nothing');
});

test('scenario: every country owns land and has a valid capital', () => {
  const g = game();
  for (const c of g.state.countries) {
    assert.ok(c.cache.provinces > 0, `${c.tag} owns provinces`);
    assert.equal(g.state.prov.owner[c.capital], c.idx, `${c.tag} capital owned`);
  }
  assert.ok(provOf(g, 'FRA').length > 10);
  assert.ok(tagIdx(g, 'USA') >= 0);
});
