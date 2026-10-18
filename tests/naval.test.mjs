import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { newGame } from '../src/core/game.js';
import { declareWar } from '../src/core/war.js';
import { newArmy } from '../src/core/state.js';
import { parseDate } from '../src/core/calendar.js';
import { portZonesOf } from '../src/core/mapdata.js';
import {
  newFleet, orderFleet, processFleets, detectNavalBattles, resolveNavalBattles, navalTrade, seaRoute,
  linkOpen, zoneController, hostileSea, zoneBalance, shipCount,
} from '../src/core/naval.js';
import { orderMove, processMovement } from '../src/core/military.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const quiet = (opts = {}) => game({ ...opts, settings: { aiAggression: 0 } });
const bump = (s) => { s.fleetVer = (s.fleetVer || 0) + 1; };
const linkNamed = (map, name) => map.sea.links.findIndex((l) => l.name === name);
const zoneNamed = (map, name) => map.sea.zones.findIndex((z) => z.name === name);

// A fresh fleet at sea in zone z (no other fleets in the world).
function atSea(g, tag, z, units) {
  const f = newFleet(g.state, tagIdx(g, tag), z, -1, units);
  g.state.fleets.push(f);
  bump(g.state);
  return f;
}

test('sea zones: every zone links to another (only the landlocked Caspian stands alone) and the oceans form one network', () => {
  const { map } = data();
  const S = map.sea;
  assert.ok(S.Z > 50, `${S.Z} zones`);
  const isolated = [];
  for (let z = 0; z < S.Z; z++) if (S.start[z + 1] === S.start[z]) isolated.push(S.zones[z].name);
  assert.deepEqual(isolated, ['Caspian Sea'], 'only the Caspian, a landlocked sea, has no link');
  // every other zone is reachable from the Arctic Ocean
  const seen = new Uint8Array(S.Z), q = [0];
  seen[0] = 1;
  while (q.length) { const u = q.pop(); for (let e = S.start[u]; e < S.start[u + 1]; e++) if (!seen[S.adj[e]]) { seen[S.adj[e]] = 1; q.push(S.adj[e]); } }
  for (let z = 0; z < S.Z; z++) if (S.zones[z].name !== 'Caspian Sea') assert.ok(seen[z], `${S.zones[z].name} is reachable`);
  for (const l of S.links) assert.ok(l.a !== l.b && l.km > 0 && l.a < S.Z && l.b < S.Z);
});

test('sea zones: every port province is a real coastal province opening onto valid zones', () => {
  const { map } = data();
  const S = map.sea;
  let ports = 0;
  for (let i = 0; i < map.count; i++) {
    const zs = portZonesOf(map, i);
    if (!zs.length) continue;
    ports++;
    assert.ok(map.exists[i] && map.coastal[i], `port ${i} is a coastal province`);
    for (const z of zs) {
      assert.ok(z >= 0 && z < S.Z, `zone ${z} of province ${i}`);
      assert.ok(S.zoneProvs[z].includes(i), 'zoneProvs is the inverse of portZones');
    }
  }
  assert.ok(ports > 500, `${ports} ports`);
  assert.ok(S.zoneProvs[zoneNamed(map, 'Caspian Sea')].length > 0, 'the Caspian has ports');
  for (let e = 0; e < map.adj.length; e++) if (S.laneZone[e] >= 0) assert.ok(map.adjKind[e] > 0, 'only straits and sea lanes cross a zone');
});

test('canals are closed before their opening year and open after', () => {
  const g = quiet();
  const { state, map } = g;
  const panama = linkNamed(map, 'Panama Canal'), suez = linkNamed(map, 'Suez Canal');
  assert.ok(panama >= 0 && suez >= 0);
  const k = tagIdx(g, 'USA');
  assert.ok(linkOpen(state, map, k, panama) && linkOpen(state, map, k, suez), 'both open in 2026');
  state.day = parseDate('1900-01-01');
  assert.equal(linkOpen(state, map, k, panama), false, 'Panama opens in 1914');
  assert.ok(linkOpen(state, map, k, suez));
  state.day = parseDate('1850-06-01');
  assert.equal(linkOpen(state, map, k, suez), false, 'Suez opens in 1869');
  // the canal is not used for routes while closed: Caribbean -> Gulf of Panama goes the long way
  const car = zoneNamed(map, 'Caribbean Sea'), gop = zoneNamed(map, 'Gulf of Panama');
  const r = seaRoute(state, map, k, car, gop);
  assert.ok(r && r.length > 1, 'a long way round');
  state.day = parseDate('2026-01-01');
  assert.deepEqual(seaRoute(state, map, k, car, gop), [gop], 'through the canal once open');
  // a real ancient scenario: both canals are closed
  const d = data();
  const rome = newGame({ ...d, scenario: rd('data/scenarios/height_of_rome_117.json'), seed: 'rome', settings: { aiAggression: 0 } });
  assert.equal(linkOpen(rome.state, map, 0, panama), false);
  assert.equal(linkOpen(rome.state, map, 0, suez), false);
});

test('fleets: an ordered fleet sails its route zone by zone and docks in port', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const k = tagIdx(g, 'GBR');
  const f = state.fleets.find((x) => x.owner === k && x.port >= 0);
  assert.ok(f, 'a docked British fleet');
  const target = zoneNamed(map, 'Levantine Sea');
  assert.equal(orderFleet(state, map, rules, f.id, { zone: target }), null);
  const route = f.path.slice();
  assert.ok(route.length >= 3, `route of ${route.length} zones`);
  const visited = [f.zone];
  for (let d = 0; d < 200 && f.zone !== target; d++) {
    state.day++;
    processFleets(state, map, rules);
    if (f.zone !== visited[visited.length - 1]) visited.push(f.zone);
  }
  assert.equal(f.zone, target);
  assert.deepEqual(visited.slice(1), route, 'followed the planned route');
  for (let i = 1; i < visited.length; i++) {
    const a = visited[i - 1], b = visited[i];
    let adj = false;
    for (let e = map.sea.start[a]; e < map.sea.start[a + 1]; e++) if (map.sea.adj[e] === b) adj = true;
    assert.ok(adj, `${map.sea.zones[a].name} -> ${map.sea.zones[b].name} are linked`);
  }
  assert.equal(f.port, -1, 'at sea');
  // into a port in its zone
  const port = map.sea.zoneProvs[target].find((p) => state.prov.controller[p] === k)
    ?? provOf(g, 'GBR').find((p) => portZonesOf(map, p).length);
  assert.equal(orderFleet(state, map, rules, f.id, { prov: port }), null);
  for (let d = 0; d < 200 && f.port !== port; d++) { state.day++; processFleets(state, map, rules); }
  assert.equal(f.port, port, 'docked');
  assert.match(orderFleet(state, map, rules, f.id, { prov: provOf(g, 'RUS').find((p) => portZonesOf(map, p).length) }), /friendly ports/);
});

test('naval battle: hostile fleets in one zone fight; ships are sunk and the weaker side loses', () => {
  const g = quiet();
  const { state, map, rules } = g;
  state.fleets = [];
  assert.equal(declareWar(state, map, rules, tagIdx(g, 'IND'), tagIdx(g, 'PAK')), null);
  const z = zoneNamed(map, 'Arabian Sea');
  const big = atSea(g, 'IND', z, { missile_destroyer: 6, missile_cruiser: 4 });
  const small = atSea(g, 'PAK', z, { missile_destroyer: 2 });
  big.arrived = state.day - 5; small.arrived = state.day;
  detectNavalBattles(state, map, rules);
  assert.equal(state.navalBattles.length, 1);
  assert.ok(big.battle && small.battle);
  const reports0 = state.reports.length;
  for (let d = 0; d < 30 && state.navalBattles.length; d++) { state.day++; resolveNavalBattles(state, map, rules); }
  assert.equal(state.navalBattles.length, 0, 'battle ended');
  const r = state.reports[state.reports.length - 1];
  assert.equal(state.reports.length, reports0 + 1);
  assert.ok(r.naval && r.zone === z);
  assert.equal(r.winner, 'def', 'the stronger Indian fleet (first in the zone, defending) won');
  assert.ok(r.sunk[0] > 0, `attackers lost ships: ${r.sunk}`);
  assert.ok(big.battle === 0 && state.fleets.includes(big));
  assert.ok(big.exp > 0, 'winners gain experience');
  const loser = state.fleets.find((f) => f.id === small.id);
  if (loser) assert.ok(loser.org <= 0.1 && (loser.path.length > 0 || loser.port >= 0), 'the loser withdraws to port');
});

test('naval battle: fleets of countries at peace share a zone without fighting', () => {
  const g = quiet();
  const { state, map, rules } = g;
  state.fleets = [];
  const z = zoneNamed(map, 'Arabian Sea');
  atSea(g, 'IND', z, { missile_destroyer: 2 });
  atSea(g, 'PAK', z, { missile_destroyer: 2 });
  detectNavalBattles(state, map, rules);
  assert.equal(state.navalBattles.length, 0);
});

test('blockade: enemy surface control of a country\'s port zones cuts its trade factor', () => {
  const g = quiet();
  const { state, map, rules } = g;
  state.fleets = [];
  const A = tagIdx(g, 'USA'), D = tagIdx(g, 'CUB');
  navalTrade(state, map, rules);
  assert.equal(state.countries[D].econ.tradeFactor, 1, 'no blockade in peace');
  assert.equal(declareWar(state, map, rules, A, D), null);
  const zones = new Set();
  for (const p of provOf(g, 'CUB')) for (const z of portZonesOf(map, p)) zones.add(z);
  assert.ok(zones.size > 0);
  for (const z of zones) atSea(g, 'USA', z, { missile_cruiser: 6, missile_destroyer: 4 });
  for (const z of zones) assert.equal(zoneController(state, map, rules, z), A, 'the US holds the zone');
  navalTrade(state, map, rules);
  const e = state.countries[D].econ;
  assert.ok(e.blockade > 0.5, `blockade ${e.blockade}`);
  assert.ok(e.tradeFactor < 0.7, `trade factor ${e.tradeFactor}`);
  assert.ok(state.countries[A].econ.tradeFactor > 0.99, 'the blockading power trades on');
});

test('submarines raid trade but cannot hold a zone', () => {
  const g = quiet();
  const { state, map, rules } = g;
  state.fleets = [];
  const A = tagIdx(g, 'USA'), D = tagIdx(g, 'CUB');
  declareWar(state, map, rules, A, D);
  const zones = new Set();
  for (const p of provOf(g, 'CUB')) for (const z of portZonesOf(map, p)) zones.add(z);
  for (const z of zones) atSea(g, 'USA', z, { nuclear_submarine: 6 });
  for (const z of zones) {
    assert.equal(zoneController(state, map, rules, z), -1, 'submarines do not control the zone');
    assert.equal(hostileSea(state, map, rules, D, z), false, 'nor make it hostile for Cuban transports');
    assert.ok(zoneBalance(state, map, rules, D, z).raid > 0);
  }
  navalTrade(state, map, rules);
  const e = state.countries[D].econ;
  assert.equal(e.blockade, 0);
  assert.ok(e.raid > 0.3, `raid ${e.raid}`);
  assert.ok(e.tradeFactor < 1 && e.tradeFactor > 0.5, `trade factor ${e.tradeFactor}`);
});

test('chokepoints close to countries at war with their controller', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const bos = linkNamed(map, 'Bosporus and Dardanelles');
  const rus = tagIdx(g, 'RUS'), tur = tagIdx(g, 'TUR'), ukr = tagIdx(g, 'UKR');
  assert.equal(state.prov.controller[map.sea.links[bos].choke[0]], tur);
  assert.ok(linkOpen(state, map, rus, bos), 'open in peace');
  const black = zoneNamed(map, 'Black Sea'), aegean = zoneNamed(map, 'Aegean Sea');
  assert.deepEqual(seaRoute(state, map, rus, black, aegean), [aegean]);
  assert.equal(declareWar(state, map, rules, rus, tur), null);
  assert.equal(linkOpen(state, map, rus, bos), false, 'closed to Russia at war with Turkey');
  assert.ok(linkOpen(state, map, ukr, bos) || state.wars.some((w) => w.attackers.includes(ukr)), 'still open to neutrals');
  assert.equal(seaRoute(state, map, rus, black, aegean), null, 'the Black Sea fleet is bottled up');
  // a fleet already sailing through is halted
  state.fleets = [];
  const f = atSea(g, 'RUS', black, { missile_destroyer: 2 });
  f.path = [aegean];
  for (let d = 0; d < 10; d++) { state.day++; processFleets(state, map, rules); }
  assert.equal(f.zone, black);
  assert.equal(f.path.length, 0);
});

test('amphibious: an army ordered overseas embarks, sails through zone nodes and lands', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const k = tagIdx(g, 'USA');
  const hawaii = provOf(g, 'USA').find((p) => map.name[p] === 'Hawaii');
  assert.ok(hawaii != null, 'found Hawaii');
  const coast = provOf(g, 'USA').find((p) => map.lon[p] < -117 && map.lat[p] > 32 && map.lat[p] < 42 && portZonesOf(map, p).length);
  assert.ok(coast != null, 'a Californian port');
  const a = newArmy(state, k, coast, { infantry: 3 });
  state.armies.push(a);
  assert.equal(orderMove(state, map, rules, a.id, hawaii), null);
  const N = map.count;
  assert.ok(a.path.some((p) => p >= N), 'path has sea-zone nodes');
  assert.equal(a.path[a.path.length - 1], hawaii);
  for (let i = 1; i < a.path.length; i++) {
    const [u, v] = [a.path[i - 1], a.path[i]];
    if (u >= N && v >= N) assert.ok([...map.sea.adj.subarray(map.sea.start[u - N], map.sea.start[u - N + 1])].includes(v - N), 'sea steps follow zone links');
    if (u >= N && v < N) assert.ok(portZonesOf(map, v).includes(u - N), 'lands from an adjacent zone');
  }
  let wasAtSea = false;
  for (let d = 0; d < 120 && a.loc !== hawaii; d++) {
    state.day++;
    processMovement(state, map, rules);
    if (a.sea >= 0) wasAtSea = true;
  }
  assert.ok(wasAtSea, 'the army was at sea');
  assert.equal(a.loc, hawaii);
  assert.equal(a.sea, -1, 'landed');
});

test('amphibious: transports in a zone held by enemy fleets lose strength', () => {
  const g = quiet();
  const { state, map, rules } = g;
  state.fleets = [];
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  declareWar(state, map, rules, A, D);
  const z = zoneNamed(map, 'Arabian Sea');
  const army = newArmy(state, D, state.countries[D].capital, { infantry: 4 });
  army.sea = z;
  army.path = [];
  const safe = newArmy(state, D, state.countries[D].capital, { infantry: 4 });
  safe.sea = zoneNamed(map, 'Persian Gulf');
  state.armies.push(army, safe);
  atSea(g, 'IND', z, { missile_cruiser: 4 });
  assert.ok(hostileSea(state, map, rules, D, z));
  state.day++;
  processMovement(state, map, rules);
  assert.ok(Math.abs(army.str - (1 - rules.balance.naval.transportLossDay)) < 1e-9, `str ${army.str}`);
  assert.equal(safe.str, 1, 'no losses in safe waters');
  // a battered convoy is sunk outright
  army.str = 0.12;
  state.day++;
  processMovement(state, map, rules);
  assert.ok(!state.armies.includes(army), 'the convoy was lost at sea');
  assert.ok(state.armies.includes(safe));
  assert.equal(shipCount(state.fleets[0]), 4);
});
