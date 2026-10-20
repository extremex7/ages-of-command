import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { game, data, tagIdx, provOf } from './helpers.mjs';
import { runDays, tick } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { deserialize } from '../src/core/save.js';
import { declareWar } from '../src/core/war.js';
import { newArmy } from '../src/core/state.js';
import { orderMove } from '../src/core/military.js';
import { portZonesOf } from '../src/core/mapdata.js';
import { canUseUnit } from '../src/core/technology.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));

// Hash of everything Milestone 6 adds on top of the land war: fleets, naval battles, wings,
// supply, depots, strategic capabilities and world effects.
function fingerprint(s) {
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  const str = (t) => { for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); };
  mix(s.day); mix(s.nextId);
  for (let i = 0; i < s.prov.owner.length; i++) { mix(s.prov.controller[i]); mix(Math.round(s.prov.pop[i])); }
  for (const a of s.armies) { mix(a.id); mix(a.loc); mix(a.sea ?? -1); mix(a.path.length); mix(Math.round(a.str * 1e4)); mix(Math.round((a.supply ?? 1) * 100)); }
  for (const f of s.fleets) { mix(f.id); mix(f.zone); mix(f.port); mix(f.path.length); mix(Math.round(f.str * 1e4)); mix(Math.round(f.org * 1e4)); str(JSON.stringify(f.units)); }
  for (const w of s.wings) { mix(w.id); mix(w.base); mix(Math.round(w.str * 1e4)); str(w.mission); }
  for (const b of s.navalBattles) { mix(b.id); mix(b.zone); mix(b.days); }
  for (const c of s.countries) {
    mix(Math.round(c.treasury * 100));
    mix(Math.round((c.econ?.tradeFactor ?? 1) * 1e4));
    str(JSON.stringify(c.strat)); str(JSON.stringify(c.depots || []));
  }
  str(JSON.stringify(s.strategic));
  for (const v of s.econ.bld) mix(v);
  mix(s.wars.length); mix(s.reports.length);
  return h;
}

// A modern world at war at sea and in the air: China against Japan, India against Pakistan.
function warGame(seed, player = null) {
  const g = game({ seed, player, settings: { aiAggression: 1 } });
  const { state, map, rules } = g;
  declareWar(state, map, rules, tagIdx(g, 'CHN'), tagIdx(g, 'JPN'));
  declareWar(state, map, rules, tagIdx(g, 'IND'), tagIdx(g, 'PAK'));
  return g;
}

test('determinism: the same seed gives identical wars at sea and in the air over 200 days', () => {
  const a = warGame('m6det'), b = warGame('m6det');
  assert.ok(a.state.fleets.length > 50 && a.state.wings.length > 50);
  runDays(a, 200); runDays(b, 200);
  assert.equal(fingerprint(a.state), fingerprint(b.state));
  const naval = a.state.reports.filter((r) => r.naval).length;
  assert.ok(naval > 0 || a.state.navalBattles.length > 0, 'fleets fought');
  assert.ok(a.state.armies.some((x) => x.supply < 1), 'supply is tracked');
});

test('save/load mid-war, mid supply period and with armies at sea continues identically', () => {
  const g = warGame('m6save', 'USA');
  const { state, map, rules } = g;
  runDays(g, 90);
  // send a US army to Hawaii so it is at sea when the game is saved
  const k = tagIdx(g, 'USA');
  const coast = provOf(g, 'USA').find((p) => map.lon[p] < -117 && map.lat[p] > 32 && map.lat[p] < 42 && portZonesOf(map, p).length);
  const hawaii = provOf(g, 'USA').find((p) => map.name[p] === 'Hawaii');
  const army = newArmy(state, k, coast, { infantry: 2 });
  state.armies.push(army);
  assert.equal(orderMove(state, map, rules, army.id, hawaii), null);
  for (let d = 0; d < 40 && !(army.sea >= 0); d++) tick(g);
  assert.ok(army.sea >= 0, 'the army is at sea');
  const R = rules.balance.supply.refreshDays;
  while (state.day % R === 0) tick(g);
  assert.ok(state.supplyCache, 'supply maps are cached');
  const text = saveGame(g, { savedAt: 1 });
  const g2 = loadGame(text, { ...data() });
  assert.equal(fingerprint(g2.state), fingerprint(state), 'exact round trip');
  const a2 = g2.state.armies.find((x) => x.id === army.id);
  assert.equal(a2.sea, army.sea);
  assert.deepEqual(a2.path, army.path, 'zone nodes in the path survive the save');
  assert.ok(g2.state.supplyCache && Object.keys(g2.state.supplyCache.maps).length > 0, 'saved supply maps reloaded');
  for (let d = 0; d < 110; d++) {
    tick(g); tick(g2);
    if (d % 10 === 9) assert.equal(fingerprint(g2.state), fingerprint(state), `diverged by day ${d + 1}`);
  }
  assert.equal(fingerprint(g2.state), fingerprint(state));
  assert.equal(army.loc, hawaii, 'the convoy landed');
});

// Turns a current save into the version-5 layout: no navies, air forces, strategic data,
// depots or armies at sea.
function asV5(text) {
  const o = JSON.parse(text);
  for (const k of ['fleets', 'wings', 'navalBattles', 'strategic', 'supplyCache', 'fleetVer', 'supplyVer']) delete o[k];
  for (const c of o.countries) { delete c.strat; delete c.depots; }
  for (const a of o.armies) { delete a.sea; delete a.supply; a.path = (a.path || []).filter((p) => p < data().map.count); }
  o.version = 5;
  return JSON.stringify(o);
}

test('save migration 5 -> 6: an old save gets empty forces and initialised strategic state', () => {
  const d = data();
  const g = game({ seed: 'm6mig', settings: { aiAggression: 1 } });
  runDays(g, 20);
  const s = deserialize(asV5(saveGame(g)), d.map, d.rules, d.scenario);
  assert.equal(s.version, 7);
  assert.deepEqual(s.fleets, []);
  assert.deepEqual(s.wings, []);
  assert.deepEqual(s.navalBattles, []);
  assert.equal(s.strategic.detonations, 0);
  assert.deepEqual(s.strategic.pending, []);
  for (const c of s.countries) {
    assert.equal(c.strat.warheads, 0);
    assert.deepEqual(c.strat.sats, { recon: 0, comms: 0, nav: 0, warning: 0 });
    assert.deepEqual(c.depots, []);
  }
  assert.ok(s.armies.length > 0 && s.armies.every((a) => a.sea === -1));
  // and the migrated game runs
  const g2 = loadGame(asV5(saveGame(g)), d);
  runDays(g2, 45);
  assert.ok(g2.state.countries.every((c) => !c.alive || Number.isFinite(c.treasury)));
  assert.ok(g2.state.armies.every((a) => a.sea === -1 || a.sea >= 0));
});

test('save validation: forces referring to missing zones, units or provinces are dropped', () => {
  const d = data();
  const g = game({ seed: 'm6val' });
  const o = JSON.parse(saveGame(g));
  const f0 = o.fleets.length, w0 = o.wings.length;
  o.fleets[0].zone = 9999;
  o.fleets[1].units = { not_a_ship: 3 };
  o.fleets[2].path = [1, 9999, 2];
  o.wings[0].base = 999999;
  o.wings[1].units = { infantry: 4 };
  o.armies[0].sea = 9999;
  o.armies[0].units.carrier = 2;
  o.countries[0].strat.sats.death_star = 1;
  delete o.countries[1].strat;
  const s = deserialize(JSON.stringify(o), d.map, d.rules);
  assert.equal(s.fleets.length, f0 - 2);
  assert.deepEqual(s.fleets.find((f) => f.id === o.fleets[2].id).path, [1, 2]);
  assert.equal(s.wings.length, w0 - 2);
  const a = s.armies.find((x) => x.id === o.armies[0].id);
  assert.equal(a.sea, -1);
  assert.equal(a.units.carrier, undefined, 'warships are not land units');
  assert.equal(s.countries[0].strat.sats.death_star, undefined);
  assert.equal(s.countries[1].strat.warheads, 0, 'missing strategic data is initialised');
});

const fictionalTechs = (rules) => rules.tech.list.filter((t) => t.fictional);
const knownFictional = (g) => g.state.countries.filter((c) => fictionalTechs(g.rules).some((t) => g.state.tech.known[c.idx * g.state.tech.T + t.i]));

test('future scenarios: forces, warheads and fictional technologies only where allowed', () => {
  const d = data();
  assert.ok(fictionalTechs(d.rules).length >= 5, 'fictional technologies are flagged');
  for (const [id, u] of Object.entries(d.rules.units)) if (u.fictional) assert.ok(d.rules.tech.list[d.rules.tech.unitTech[id]].fictional, `${id} needs a fictional technology`);
  // the present-day world knows none of them and fields no fictional units
  const modern = game({ seed: 'fict' });
  assert.equal(d.scenario.fictional ?? false, false);
  assert.deepEqual(knownFictional(modern).map((c) => c.tag), []);
  const units = (s) => [...s.armies, ...s.fleets, ...s.wings].flatMap((x) => Object.keys(x.units));
  assert.ok(units(modern.state).every((t) => !d.rules.units[t].fictional));
  for (const id of ['flashpoint_2035', 'orbital_age_2085']) {
    const scenario = rd(`data/scenarios/${id}.json`);
    assert.equal(scenario.fictional, true, `${id} is marked fictional`);
    const g = newGame({ ...d, scenario, seed: id, settings: { aiAggression: 1 } });
    const s = g.state;
    assert.ok(s.fleets.length > 20, `${id}: ${s.fleets.length} fleets`);
    assert.ok(s.wings.length > 50, `${id}: ${s.wings.length} wings`);
    assert.ok(s.countries.filter((c) => c.strat.warheads > 0).length >= 5, `${id}: nuclear powers`);
    assert.ok(knownFictional(g).length > 0, `${id}: some countries know fictional technologies`);
    // every unit is one its owner can field
    for (const x of [...s.armies, ...s.fleets, ...s.wings]) for (const t of Object.keys(x.units)) assert.ok(canUseUnit(s, g.rules, x.owner, t), `${id}: ${s.countries[x.owner].tag} fields ${t}`);
    // fleets sit in valid zones and docked ones in a port on that zone
    for (const f of s.fleets) {
      assert.ok(f.zone >= 0 && f.zone < g.map.sea.Z);
      if (f.port >= 0) assert.ok(portZonesOf(g.map, f.port).includes(f.zone), `${id}: ${f.name} docked on its zone`);
    }
    runDays(g, 60);
    assert.ok(s.countries.every((c) => !c.alive || (Number.isFinite(c.treasury) && Number.isFinite(c.stability))), `${id}: finite treasuries`);
    assert.ok(s.countries.every((c) => c.strat.warheads >= 0 && Number.isFinite(c.strat.cyber)));
  }
});
