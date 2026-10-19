// A House Divided (1861): the scenario loads with its period borders, subjects and wars, the
// opening American Civil War chain fires, and the game runs, saves and loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { releaseCountry } from '../src/core/events.js';
import { atWar } from '../src/core/relations.js';
import { overlordOf } from '../src/core/diplomacy.js';

const ID = 'house_divided_1861';
const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const scenario = () => rd(`data/scenarios/${ID}.json`);
const start = (o = {}) => {
  const d = data();
  return newGame({ map: d.map, rules: d.rules, scenario: scenario(), playerTag: null, seed: o.seed ?? 'hd1861', settings: { ...o.settings } });
};
const prov = (g, iso, name) => g.map.ids.find((i) => g.map.iso[i] === iso && g.map.name[i] === name);
const ownerTag = (g, iso, name) => { const o = g.state.prov.owner[prov(g, iso, name)]; return o >= 0 ? g.state.countries[o].tag : null; };
const owns = (g, tag) => { const k = tagIdx(g, tag); return g.map.ids.filter((i) => g.state.prov.owner[i] === k).length; };

test('1861: listed, loads with period borders, subjects, dormant states and wars', () => {
  assert.ok(rd('data/scenarios/index.json').scenarios.some((s) => s.id === ID), 'listed in the scenario index');
  const g = start();
  const s = g.state, C = s.countries;
  const live = C.filter((c) => c.alive);
  assert.ok(live.length >= 90 && live.length <= 115, `${live.length} countries`);
  assert.ok(live.every((c) => c.capital >= 0 && s.prov.owner[c.capital] === c.idx), 'every country holds its capital');
  // the Union and the seven seceded states
  assert.ok(atWar(s, tagIdx(g, 'USA'), tagIdx(g, 'CSA')), 'the Civil War is running');
  for (const n of ['South Carolina', 'Georgia', 'Louisiana', 'Alabama']) assert.equal(ownerTag(g, 'USA', n), 'CSA', n);
  for (const n of ['Kentucky', 'Missouri', 'Virginia', 'Pennsylvania', 'California (Central)']) assert.equal(ownerTag(g, 'USA', n), 'USA', n);
  assert.equal(C[s.prov.owner[C[tagIdx(g, 'USA')].capital]].tag, 'USA');
  assert.equal(ownerTag(g, 'USA', 'Alaska (South)'), 'RUS', 'Russian America');
  assert.equal(ownerTag(g, 'USA', 'Hawaii'), 'HAW');
  // Europe in 1861
  assert.equal(ownerTag(g, 'ITA', 'Udine'), 'AUS', 'Venetia is Austrian');
  assert.equal(ownerTag(g, 'ITA', 'Rome'), 'PAP', 'Rome is papal');
  assert.equal(ownerTag(g, 'ITA', 'Turin'), 'ITA');
  assert.equal(ownerTag(g, 'DEU', 'Schleswig-Holstein'), 'DEN');
  assert.equal(ownerTag(g, 'POL', 'Warsaw'), 'RUS');
  assert.equal(ownerTag(g, 'CHN', 'Jiangsu'), 'TPG', 'the Taiping hold Nanjing');
  assert.ok(atWar(s, tagIdx(g, 'QNG'), tagIdx(g, 'TPG')), 'the Taiping Rebellion is running');
  assert.ok(atWar(s, tagIdx(g, 'FRA'), tagIdx(g, 'VIE')), 'the Cochinchina campaign is running');
  for (const [o, sub] of [['GBR', 'CAN'], ['GBR', 'HYD'], ['OTT', 'EGY'], ['OTT', 'ROM'], ['OTT', 'SRB'], ['OTT', 'TUN']]) {
    assert.equal(overlordOf(s, tagIdx(g, sub)), tagIdx(g, o), `${sub} is a subject of ${o}`);
  }
  assert.ok(s.alliances.some((a) => a.name === 'German Confederation' && a.members.includes(tagIdx(g, 'PRS')) && a.members.includes(tagIdx(g, 'AUS'))));
  assert.ok(owns(g, 'GBR') > 200 && owns(g, 'RUS') > 250 && owns(g, 'OTT') > 100);
  assert.equal(C[tagIdx(g, 'MXE')].alive, false, 'the Mexican Empire is dormant');
  assert.ok(s.releases.MXE.length > 10 && s.releases.POL.length === 5);
  const unowned = g.map.ids.filter((i) => s.prov.owner[i] < 0).length;
  assert.ok(unowned > 300 && unowned < 600, `${unowned} provinces without states of the period`);
  // starting forces: period units only, navies from the forces table
  assert.ok(s.armies.every((a) => Object.keys(a.units).every((t) => ['rifles', 'musketeers', 'cannons', 'cavalry', 'levy', 'heavy_inf', 'siege'].includes(t))), 'only period land units');
  assert.ok(s.fleets.some((f) => f.owner === tagIdx(g, 'GBR')) && s.fleets.some((f) => f.owner === tagIdx(g, 'USA')));
  assert.ok(!(s.wings || []).length, 'no aircraft in 1861');
});

test('1861: budgets roughly balance at the start', () => {
  const g = start();
  const live = g.state.countries.filter((c) => c.alive);
  const deficit = live.filter((c) => c.ledger.net < -0.1 * Math.max(0.01, c.ledger.revenue));
  assert.ok(deficit.length <= live.length * 0.1, `${deficit.map((c) => c.tag).join(' ')} start in deficit`);
});

test('1861: Fort Sumter leads to the secession of the upper South', () => {
  const g = start({ seed: 'sumter' });
  const s = g.state;
  runDays(g, 45);
  assert.ok(s.fired.hd_fort_sumter != null, 'Fort Sumter fired');
  assert.ok(s.fired.hd_upper_south != null && s.fired.hd_upper_south >= s.fired.hd_fort_sumter, 'the chained event fired after it');
  for (const n of ['Virginia', 'North Carolina', 'Tennessee', 'Arkansas']) assert.equal(ownerTag(g, 'USA', n), 'CSA', n);
  for (const n of ['West Virginia', 'Kentucky', 'Delaware', 'Missouri']) assert.ok(['USA'].includes(ownerTag(g, 'USA', n)), `${n} stays Union`);
  // with historical events off, nothing fires
  const off = start({ seed: 'sumter', settings: { historicalEvents: 'off' } });
  runDays(off, 45);
  assert.equal(off.state.fired.hd_fort_sumter, undefined);
  assert.equal(ownerTag(off, 'USA', 'Virginia'), 'USA');
});

test('1861: runs three years without absurd results, then saves and loads', () => {
  const g = start({ seed: 'run' });
  const s = g.state, usa = tagIdx(g, 'USA');
  runDays(g, 60);
  const cap = s.countries[usa].capital;
  assert.equal(s.prov.controller[cap], usa, 'Washington holds in the first two months');
  runDays(g, 3 * 365 - 60);
  const live = s.countries.filter((c) => c.alive);
  assert.ok(live.length > 80, `${live.length} countries left`);
  assert.ok(live.every((c) => owns(g, c.tag) > 0), 'no living country without provinces');
  assert.ok(live.every((c) => Number.isFinite(c.treasury) && Number.isFinite(c.stability)));
  const broke = live.filter((c) => c.treasury < -2 * Math.max(0.01, c.ledger.revenue));
  assert.ok(broke.length <= live.length * 0.1, `deep in debt: ${broke.map((c) => c.tag).join(' ')}`);
  assert.ok(s.countries[usa].alive && owns(g, 'USA') >= 30, 'the Union survives');
  const g2 = loadGame(saveGame(g), { ...data(), scenario: scenario() });
  assert.equal(g2.state.scenarioId, ID);
  assert.equal(g2.state.day, s.day);
  runDays(g2, 31);
});

test('1861: the Mexican Empire can be released from Mexico', () => {
  const g = start();
  const s = g.state, k = tagIdx(g, 'MXE');
  const before = owns(g, 'MEX');
  assert.equal(releaseCountry(s, g.map, g.rules, 'MXE', []), null);
  assert.ok(s.countries[k].alive && owns(g, 'MXE') > 10 && owns(g, 'MEX') < before);
  assert.ok(s.armies.some((a) => a.owner === k));
});
