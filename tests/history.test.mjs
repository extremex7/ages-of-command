import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { dailyEvents, applyEffects, releaseCountry, compileEvents } from '../src/core/events.js';
import { atWar } from '../src/core/relations.js';
import { overlordOf } from '../src/core/diplomacy.js';
import { rawRules, loadRules } from '../tools/load_rules.mjs';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const index = rd('data/scenarios/index.json').scenarios;
const start = (id, o = {}) => {
  const d = data();
  return newGame({ map: d.map, rules: o.rules || d.rules, scenario: rd(`data/scenarios/${id}.json`), playerTag: o.player ?? null, seed: o.seed ?? 'hist', settings: { aiAggression: 0, ...o.settings } });
};
const owns = (g, tag) => { const k = tagIdx(g, tag); return g.map.ids.filter((i) => g.state.prov.owner[i] === k).length; };

test('every listed scenario loads, balances its budgets and runs', () => {
  assert.ok(index.length >= 5);
  for (const meta of index) {
    const g = start(meta.id);
    const s = g.state;
    const live = s.countries.filter((c) => c.alive);
    assert.ok(live.length > 20, `${meta.id}: ${live.length} countries`);
    assert.ok(live.every((c) => c.capital >= 0 && s.prov.owner[c.capital] === c.idx && c.tfx && c.research), meta.id);
    const deficit = live.filter((c) => c.ledger.net < -0.1 * Math.max(0.01, c.ledger.revenue));
    assert.ok(deficit.length <= live.length * 0.1, `${meta.id}: ${deficit.map((c) => c.tag).join(' ')} start in deficit`);
    runDays(g, 62);
    assert.ok(s.countries.every((c) => !c.alive || (Number.isFinite(c.treasury) && Number.isFinite(c.stability))), meta.id);
    // saves of historical games load again
    const g2 = loadGame(saveGame(g), { ...data(), scenario: rd(`data/scenarios/${meta.id}.json`) });
    assert.equal(g2.state.scenarioId, meta.id);
  }
});

test('historical scenarios carry their period: borders, subjects, dormant states and wars', () => {
  const g = start('great_war_1914');
  const s = g.state, C = s.countries;
  assert.ok(owns(g, 'AUH') > 20 && owns(g, 'RUS') > 200);
  assert.equal(C[tagIdx(g, 'POL')].alive, false, 'Poland is dormant in 1914');
  assert.ok(s.releases.POL.length > 5);
  assert.equal(overlordOf(s, tagIdx(g, 'CAN')), tagIdx(g, 'GBR'));
  assert.ok(s.alliances.some((a) => a.name === 'Triple Alliance'));
  assert.equal(C[tagIdx(g, 'GER')].govt.policies.conscription, 'mass', 'scenario policies applied');
  const b = start('gathering_storm_1936');
  assert.ok(atWar(b.state, tagIdx(b, 'ITA'), tagIdx(b, 'ETH')), 'the Abyssinian war is running');
  const r = start('height_of_rome_117');
  const unowned = r.map.ids.filter((i) => r.state.prov.owner[i] < 0).length;
  assert.ok(unowned > 1000, 'regions outside states are left unowned');
  assert.ok(Object.values(r.state.armies.find((a) => a.owner === tagIdx(r, 'ROM')).units).length > 0);
  assert.ok(r.state.armies.every((a) => Object.keys(a.units).every((t) => !r.rules.units[t].tech || ['iron_working', 'horseback_riding', 'siege_engineering'].includes(r.rules.units[t].tech))), 'only period units');
});

test('releasing a dormant country gives it its regions and brings it to life', () => {
  const g = start('great_war_1914');
  const s = g.state, k = tagIdx(g, 'POL');
  const before = owns(g, 'RUS');
  assert.equal(releaseCountry(s, g.map, g.rules, 'POL', ['RUS']), null);
  assert.ok(s.countries[k].alive && owns(g, 'POL') > 0);
  assert.ok(owns(g, 'RUS') < before);
  assert.ok(s.armies.some((a) => a.owner === k), 'the new state has an army');
  assert.ok(s.countries[k].tfx.known > 0);
});

test('historical events fire on their dates, chain by trigger, and respect the settings', () => {
  // June 1914: Sarajevo → ultimatum → declaration, if the AI follows history
  const g = start('great_war_1914', { seed: 'sarajevo' });
  runDays(g, 45);
  const s = g.state;
  assert.ok(s.fired.sarajevo != null, 'Sarajevo fired');
  assert.ok(s.fired.july_ultimatum != null && s.fired.july_ultimatum >= s.fired.sarajevo, 'trigger chain');
  // no historical events when they are off
  const off = start('great_war_1914', { seed: 'sarajevo', settings: { historicalEvents: 'off' } });
  runDays(off, 45);
  assert.equal(off.state.fired.sarajevo, undefined);
});

test('historical events do not fire when their premise fails', () => {
  const ev = { id: 't_war', title: 'T', text: 't', scenario: ['great_war_1914'], tags: ['FRA'], date: ['1914-06-01', '1914-12-31'], mtth: 0, once: true,
    conditions: { exists: 'GER', notAtWarWith: 'GER' }, options: [{ text: 'War', historical: true, effects: { breakTreaties: 'GER', war: { target: 'GER' }, trigger: { tag: 'GER', event: 't_reply' } } }] };
  const reply = { id: 't_reply', title: 'R', text: 'r', scenario: ['great_war_1914'], tags: ['GER'], mtth: 999, once: true, options: [{ text: 'Ok', effects: { stability: 5 } }] };
  const raw = rawRules();
  const rules = loadRules({ events: [...raw.events, { events: [ev, reply] }] });
  const g = start('great_war_1914', { rules });
  const s = g.state, fra = tagIdx(g, 'FRA'), ger = tagIdx(g, 'GER');
  // remove Germany first: the premise "exists GER" fails, so nothing happens
  const k = s.countries[ger];
  k.alive = false;
  for (let d = 0; d < 31; d++) { s.day++; dailyEvents(s, g.map, rules); }
  assert.equal(s.fired.t_war, undefined);
  k.alive = true;
  for (let d = 0; d < 31; d++) { s.day++; dailyEvents(s, g.map, rules); }
  assert.ok(s.fired.t_war != null, 'fires once the premise holds');
  assert.ok(atWar(s, fra, ger));
  assert.ok(s.fired.t_reply != null && s.fired.t_reply <= s.fired.t_war + 1, 'the triggered event ran the next day despite its long mtth');
  // once: never again
  const at = s.fired.t_war;
  for (let d = 0; d < 62; d++) { s.day++; dailyEvents(s, g.map, rules); }
  assert.equal(s.fired.t_war, at);
});

test('history effects: annex, transfer, government, rename, techs', () => {
  const g = start('great_war_1914');
  const s = g.state, map = g.map, r = g.rules;
  const ger = s.countries[tagIdx(g, 'GER')], aut = tagIdx(g, 'AUH');
  const n = owns(g, 'AUH');
  applyEffects(s, map, r, ger, { annex: 'AUH' });
  assert.equal(owns(g, 'AUH'), 0);
  assert.equal(s.countries[aut].alive, false);
  const fra = s.countries[tagIdx(g, 'FRA')];
  const before = owns(g, 'FRA');
  applyEffects(s, map, r, fra, { transfer: { from: 'GER', iso: ['FRA'] } });
  assert.ok(owns(g, 'FRA') > before, 'Alsace-Lorraine returns');
  applyEffects(s, map, r, ger, { government: 'republic', rename: { name: 'German Republic' }, techs: ['tanks'] });
  assert.equal(ger.gov, 'republic');
  assert.equal(ger.name, 'German Republic');
  assert.ok(r.tech.list[r.tech.idx.tanks] && s.tech.known[ger.idx * s.tech.T + r.tech.idx.tanks] === 1);
  assert.ok(owns(g, 'GER') >= n, 'annexed land kept');
});

test('shipped event files compile and every historical event names a historical option', () => {
  const raw = rawRules();
  const evs = compileEvents(raw.events, data().rules.politics);
  const hist = evs.filter((e) => e.scenario);
  assert.ok(hist.length > 100);
  for (const e of hist) assert.ok(e.options.some((o) => o.historical), e.id);
  const ids = new Set(index.map((s) => s.id));
  for (const e of hist) for (const sc of e.scenario) assert.ok(ids.has(sc), `${e.id}: unknown scenario ${sc}`);
});
