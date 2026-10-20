import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { atWar } from '../src/core/relations.js';
import { overlordOf } from '../src/core/diplomacy.js';
import { rawRules } from '../tools/load_rules.mjs';
import { compileEvents } from '../src/core/events.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const ID = 'concert_1815';
const start = (o = {}) => {
  const d = data();
  return newGame({ map: d.map, rules: d.rules, scenario: rd(`data/scenarios/${ID}.json`), playerTag: o.player ?? null, seed: o.seed ?? 'vienna', settings: { aiAggression: 0, ...o.settings } });
};
const owns = (g, tag) => { const k = tagIdx(g, tag); return g.map.ids.filter((i) => g.state.prov.owner[i] === k).length; };
const ownerOf = (g, iso, name) => {
  const i = g.map.ids.find((p) => g.map.iso[p] === iso && g.map.name[p] === name);
  const o = g.state.prov.owner[i];
  return o >= 0 ? g.state.countries[o].tag : null;
};

test('1815: listed, loads with the post-Vienna map', () => {
  assert.ok(rd('data/scenarios/index.json').scenarios.some((s) => s.id === ID && s.startDate === '1815-11-20'));
  const g = start();
  const s = g.state, C = s.countries;
  const live = C.filter((c) => c.alive);
  assert.ok(live.length >= 80 && live.length <= 100, `${live.length} countries`);
  assert.ok(live.every((c) => owns(g, c.tag) > 0 && s.prov.owner[c.capital] === c.idx), 'every living country owns land and its capital');
  // Vienna settlement borders
  assert.equal(ownerOf(g, 'DEU', 'Nordrhein-Westfalen'), 'PRU', 'Prussia has the Rhineland and Westphalia');
  assert.equal(ownerOf(g, 'DEU', 'Saarland'), 'PRU', 'Saarbrücken ceded by the Second Treaty of Paris');
  assert.equal(ownerOf(g, 'ITA', 'Brescia'), 'HAB', 'Lombardy is Austrian');
  assert.equal(ownerOf(g, 'ITA', 'Udine'), 'HAB', 'Venetia is Austrian');
  assert.equal(ownerOf(g, 'BEL', 'Brussels'), 'NET', 'Belgium is part of the United Kingdom of the Netherlands');
  assert.equal(ownerOf(g, 'NOR', 'Oslo'), 'NOR');
  assert.equal(ownerOf(g, 'POL', 'Warsaw'), 'POL');
  assert.equal(ownerOf(g, 'USA', 'Florida'), 'SPA', 'Florida is still Spanish');
  assert.equal(ownerOf(g, 'MEX', 'Mexico City'), 'SPA', 'New Spain');
  assert.equal(ownerOf(g, 'IDN', 'Jawa Tengah'), 'GBR', 'Java is still under British occupation');
  assert.equal(ownerOf(g, 'RUS', 'Primor\'ye'), 'QNG', 'Outer Manchuria is Qing');
  assert.equal(ownerOf(g, 'USA', 'Kansas'), null, 'the Plains are left unowned');
  assert.ok(g.map.ids.filter((i) => s.prov.owner[i] < 0).length > 500, 'lands without modelled states stay unowned');
  // dormant states
  for (const t of ['GRE', 'BEL', 'MEX', 'BRZ', 'GCO', 'CHL', 'PEU', 'BOL', 'UCA']) {
    assert.equal(C[tagIdx(g, t)].alive, false, `${t} dormant`);
    assert.ok(s.releases[t]?.length > 0, `${t} has release regions`);
  }
});

test('1815: subjects, blocs, treaties and the wars running at the start', () => {
  const g = start();
  const s = g.state, k = (t) => tagIdx(g, t);
  for (const [a, b] of [['GBR', 'HAN'], ['RUS', 'POL'], ['RUS', 'FIN'], ['SWE', 'NOR'], ['OTT', 'EGY'], ['OTT', 'SER'], ['EIC', 'HYD']]) {
    assert.equal(overlordOf(s, k(b)), k(a), `${b} is a subject of ${a}`);
  }
  const qa = s.alliances.find((a) => a.name === 'Quadruple Alliance');
  assert.deepEqual(qa.members.map((m) => s.countries[m].tag).sort(), ['GBR', 'HAB', 'PRU', 'RUS']);
  assert.ok(s.alliances.some((a) => a.name === 'German Confederation' && a.members.length >= 9));
  assert.ok(atWar(s, k('SPA'), k('NGR')) && atWar(s, k('SPA'), k('UPR')), 'Spanish American wars');
  assert.ok(atWar(s, k('EIC'), k('NEP')), 'Anglo-Nepalese War');
  assert.ok(!atWar(s, k('GBR'), k('FRA')) && !atWar(s, k('RUS'), k('OTT')), 'Europe at peace');
  assert.equal(s.countries[k('PRU')].govt.policies.conscription, 'mass');
});

test('1815: budgets roughly balance, armies and fleets are period units', () => {
  const g = start();
  const s = g.state, live = s.countries.filter((c) => c.alive);
  const deficit = live.filter((c) => c.ledger.net < -0.1 * Math.max(0.01, c.ledger.revenue));
  assert.ok(deficit.length <= live.length * 0.05, `in deficit: ${deficit.map((c) => c.tag).join(' ')}`);
  const modern = ['rifles', 'field_guns', 'infantry', 'artillery', 'armor'];
  assert.ok(s.armies.every((a) => Object.keys(a.units).every((u) => !modern.includes(u))), 'no post-1815 land units');
  const gbr = tagIdx(g, 'GBR');
  assert.ok(s.fleets.some((f) => f.owner === gbr && Object.keys(f.units).includes('ship_of_the_line')), 'the Royal Navy has ships of the line');
  assert.ok(s.fleets.every((f) => Object.keys(f.units).every((u) => ['ship_of_the_line', 'frigate', 'galleon', 'galley'].includes(u))), 'sailing navies only');
});

test('1815: runs three years, saves and loads; Sugauli ends the Nepal war', () => {
  // seed changed in session 23 (experience and colonies shift the random stream; with 'sugauli' the AI made
  // peace in June 1816 before the treaty event fired, ceding the same land)
  const g = start({ seed: 'kathmandu' });
  runDays(g, 3 * 365);
  const s = g.state;
  const live = s.countries.filter((c) => c.alive);
  assert.ok(live.every((c) => Number.isFinite(c.treasury) && Number.isFinite(c.stability)));
  assert.ok(live.length >= 85, 'no mass extinction');
  assert.ok(live.filter((c) => c.treasury < -2 * Math.max(0.01, c.ledger.revenue)).length <= 5, 'treasuries do not spiral');
  assert.ok(s.fired.kingdom_of_brazil != null, 'the United Kingdom of Portugal, Brazil and the Algarves');
  assert.ok(s.fired.return_of_java != null, 'Java returns to the Dutch');
  assert.ok(s.fired.treaty_of_sugauli != null && !atWar(s, tagIdx(g, 'EIC'), tagIdx(g, 'NEP')), 'Sugauli ends the Anglo-Nepalese War');
  const g2 = loadGame(saveGame(g), { ...data(), scenario: rd(`data/scenarios/${ID}.json`) });
  assert.equal(g2.state.scenarioId, ID);
  assert.equal(g2.state.day, s.day);
});

test('1815: Iguala triggers Central American independence the next day', () => {
  const g = start({ seed: 'iguala' });
  const s = g.state;
  // jump to February 1821 with Spain still holding Mexico
  s.day += Math.round((new Date('1821-02-25') - new Date('1815-11-20')) / 864e5);
  runDays(g, 400);
  assert.ok(s.fired.plan_of_iguala != null, 'Iguala fired');
  assert.ok(s.countries[tagIdx(g, 'MEX')].alive, 'Mexico released');
  assert.equal(s.fired.central_american_independence, s.fired.plan_of_iguala + 1, 'chained by trigger the next day');
  assert.ok(s.countries[tagIdx(g, 'UCA')].alive, 'Central America released');
});

test('1815: every event compiles and names its historical option', () => {
  const evs = compileEvents(rawRules().events, data().rules.politics).filter((e) => e.scenario?.includes(ID));
  assert.ok(evs.length >= 15 && evs.length <= 25, `${evs.length} events`);
  for (const e of evs) assert.ok(e.options.some((o) => o.historical), e.id);
});
