// Rise of Empires (1444): borders, diplomacy, budgets, a short run, saves and the event chains.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { dailyEvents } from '../src/core/events.js';
import { atWar } from '../src/core/relations.js';
import { overlordOf } from '../src/core/diplomacy.js';
import { parseDate } from '../src/core/calendar.js';

const ID = 'rise_of_empires_1444';
const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const scenario = () => rd(`data/scenarios/${ID}.json`);
const start = (o = {}) => {
  const d = data();
  return newGame({ map: d.map, rules: d.rules, scenario: scenario(), playerTag: null, seed: o.seed ?? 'r1444', settings: { aiAggression: 0, ...o.settings } });
};
const ownerTag = (g, name, iso) => {
  const i = g.map.ids.find((p) => g.map.name[p] === name && (!iso || g.map.iso[p] === iso));
  const k = g.state.prov.owner[i];
  return k >= 0 ? g.state.countries[k].tag : null;
};
const owns = (g, tag) => { const k = tagIdx(g, tag); return g.map.ids.filter((i) => g.state.prov.owner[i] === k).length; };

test('1444 is listed and its events file is loaded', () => {
  assert.ok(rd('data/scenarios/index.json').scenarios.some((s) => s.id === ID));
  assert.ok(rd('data/events/index.json').files.includes('history_1444.json'));
});

test('1444 borders: the day after Varna', () => {
  const g = start();
  assert.equal(ownerTag(g, 'Tekirdag', 'TUR'), 'BYZ', 'Constantinople is Byzantine');
  assert.equal(ownerTag(g, 'Peloponnisos', 'GRC'), 'BYZ', 'the Morea is Byzantine');
  assert.equal(ownerTag(g, 'Balikesir', 'TUR'), 'OTT', 'Edirne is Ottoman');
  assert.equal(ownerTag(g, 'Orne', 'FRA'), 'ENG', 'England holds Normandy');
  assert.equal(ownerTag(g, 'Gironde', 'FRA'), 'ENG', 'England holds Gascony');
  assert.equal(ownerTag(g, 'Paris', 'FRA'), 'FRA');
  assert.equal(ownerTag(g, 'Brussels', 'BEL'), 'BUR');
  assert.equal(ownerTag(g, 'Córdoba', 'ESP'), 'GRA');
  assert.equal(ownerTag(g, 'Pomeranian', 'POL'), 'TEU');
  assert.equal(ownerTag(g, 'Kriti', 'GRC'), 'VEN');
  assert.equal(ownerTag(g, 'Novgorod', 'RUS'), 'NOV');
  assert.equal(ownerTag(g, 'Cusco', 'PER'), 'INC');
  assert.equal(ownerTag(g, 'Hokkaidō', 'JPN'), null, 'Ainu lands are unowned');
  assert.ok(owns(g, 'MIN') > 30 && owns(g, 'TIM') > 50);
  const unowned = g.map.ids.filter((i) => g.state.prov.owner[i] < 0).length;
  assert.ok(unowned > 1000, 'lands without states are left unowned');
  const s = g.state;
  assert.equal(s.countries[tagIdx(g, 'SWE')].alive, false, 'Sweden is in the Kalmar Union');
  assert.ok(s.releases.SWE.length > 10);
});

test('1444 diplomacy: subjects, alliances and the Varna war', () => {
  const g = start();
  const s = g.state, k = (t) => tagIdx(g, t);
  assert.equal(overlordOf(s, k('WAL')), k('HUN'));
  assert.equal(overlordOf(s, k('MOL')), k('POL'));
  assert.equal(overlordOf(s, k('MAZ')), k('POL'));
  assert.equal(overlordOf(s, k('CYP')), k('MAM'));
  assert.ok(overlordOf(s, k('SER')) < 0, 'Serbia is shown independent');
  assert.ok(atWar(s, k('HUN'), k('OTT')), 'the Varna crusade is still running');
  assert.ok(atWar(s, k('WAL'), k('OTT')), 'Wallachia follows Hungary');
  assert.ok(!atWar(s, k('ENG'), k('FRA')), 'the Truce of Tours holds');
  assert.equal(s.wars.length, 1);
  assert.equal(s.countries[k('OTT')].rival, k('HUN'));
});

test('1444 budgets balance and only period units exist', () => {
  const g = start();
  const s = g.state, live = s.countries.filter((c) => c.alive);
  assert.ok(live.length >= 100, `${live.length} countries`);
  assert.ok(live.every((c) => c.capital >= 0 && s.prov.owner[c.capital] === c.idx));
  const deficit = live.filter((c) => c.ledger.net < -0.1 * Math.max(0.01, c.ledger.revenue));
  assert.ok(deficit.length <= live.length * 0.05, deficit.map((c) => c.tag).join(' '));
  const allowed = new Set(['levy', 'heavy_inf', 'cavalry', 'siege', 'cannons', 'galley']);
  for (const a of s.armies) for (const t of Object.keys(a.units)) assert.ok(allowed.has(t), `army unit ${t}`);
  for (const f of s.fleets || []) for (const t of Object.keys(f.units)) assert.equal(t, 'galley');
  assert.ok((s.fleets || []).some((f) => f.owner === tagIdx(g, 'VEN')), 'Venice has a fleet');
  // the Americas know neither iron nor horses
  const az = s.armies.filter((a) => a.owner === tagIdx(g, 'AZT'));
  assert.ok(az.length && az.every((a) => Object.keys(a.units).every((t) => t === 'levy')));
});

test('1444 runs three years, saves and loads', () => {
  const g = start({ settings: {} });
  runDays(g, 3 * 365);
  const s = g.state;
  const live = s.countries.filter((c) => c.alive);
  assert.ok(live.length > 100);
  assert.ok(live.every((c) => Number.isFinite(c.treasury) && Number.isFinite(c.stability) && c.cache.provinces > 0));
  assert.ok(s.wars.length < 15, `${s.wars.length} wars`);
  const g2 = loadGame(saveGame(g), { ...data(), scenario: scenario() });
  assert.equal(g2.state.scenarioId, ID);
  assert.equal(g2.state.countries.length, s.countries.length);
  runDays(g2, 31);
});

// Advances only the event system (as tests/history.test.mjs does) from a given date.
function eventsFrom(g, date, days, stop) {
  const s = g.state;
  s.day = parseDate(date);
  for (let d = 0; d < days && !stop(s); d++) { s.day++; dailyEvents(s, g.map, g.rules); }
}

test('1453: the siege of Constantinople chains into its fall', () => {
  const g = start();
  const s = g.state, byz = tagIdx(g, 'BYZ'), ott = tagIdx(g, 'OTT');
  s.wars = []; // the Varna war long over
  eventsFrom(g, '1453-04-01', 400, (x) => x.fired.fall_of_constantinople != null);
  assert.ok(s.fired.constantinople_siege != null, 'the siege began');
  assert.ok(s.fired.constantinople_siege >= parseDate('1453-04-02'), 'not before its window');
  assert.ok(s.fired.fall_of_constantinople != null, 'the triggered fall fired');
  assert.ok(s.fired.fall_of_constantinople - s.fired.constantinople_siege <= 2, 'chained the next day');
  assert.equal(ownerTag(g, 'Tekirdag', 'TUR'), 'OTT');
  assert.ok(s.countries[byz].alive && owns(g, 'BYZ') >= 1, 'the Morea remains');
  assert.ok(!atWar(s, ott, byz), 'peace with the despots');
});

test('1448: the Kalmar Union breaks and Sweden is released', () => {
  const g = start();
  const s = g.state;
  const before = owns(g, 'KAL');
  eventsFrom(g, '1448-01-04', 400, (x) => x.fired.kalmar_breakup != null);
  assert.ok(s.fired.kalmar_breakup != null);
  assert.ok(s.countries[tagIdx(g, 'SWE')].alive && owns(g, 'SWE') > 10);
  assert.ok(owns(g, 'KAL') < before && owns(g, 'KAL') > 5);
  assert.equal(s.countries[tagIdx(g, 'KAL')].name, 'Denmark-Norway');
});

test('1444 events do not fire outside their scenario or before their dates', () => {
  const g = start();
  eventsFrom(g, '1444-11-11', 365, () => false);
  for (const id of ['constantinople_siege', 'kalmar_breakup', 'columbus', 'fall_of_granada', 'union_of_crowns']) assert.equal(g.state.fired[id], undefined, id);
});
