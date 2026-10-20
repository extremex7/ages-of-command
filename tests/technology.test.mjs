import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { game, data, tagIdx } from './helpers.mjs';
import { runDays } from '../src/core/sim.js';
import { newGame, saveGame, loadGame } from '../src/core/game.js';
import { compileTech, knows, knowsId, grantTech, techCost, researchPoints, canResearch, setResearch, queueResearch, setResearchShare, monthlyResearch, available } from '../src/core/technology.js';
import { canRecruit } from '../src/core/military.js';
import { canBuild, popDemand } from '../src/core/industry.js';
import { computeLedgers } from '../src/core/economy.js';
import { countryNeighbours } from '../src/core/geo.js';
import { rawRules, loadRules } from '../tools/load_rules.mjs';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const hist = (id, o = {}) => { const d = data(); return newGame({ map: d.map, rules: d.rules, scenario: rd(`data/scenarios/${id}.json`), playerTag: o.player ?? null, seed: o.seed ?? 'tech', settings: { aiAggression: 0, ...o.settings } }); };

test('technology file is validated', () => {
  const r = data().rules, raw = rawRules().technologies;
  assert.ok(r.tech.T > 100 && r.tech.eras.length === 13);
  const bad = (techs) => ({ ...raw, techs: { ...raw.techs, ...techs } });
  assert.throws(() => compileTech(bad({ x: { name: 'X', era: 'ancient', field: 'economy', year: 0, cost: 1, req: ['nowhere'] } }), r), /unknown prerequisite/);
  assert.throws(() => compileTech(bad({ x: { name: 'X', era: 'ancient', field: 'economy', year: 0, cost: 1, req: ['y'] }, y: { name: 'Y', era: 'ancient', field: 'economy', year: 0, cost: 1, req: ['x'] } }), r), /cycle/);
  assert.throws(() => compileTech(bad({ x: { name: 'X', era: 'ancient', field: 'economy', year: 0, cost: 1, effects: { luck: 1 } } }), r), /unknown effect/);
  assert.throws(() => compileTech(bad({ x: { name: 'X', era: 'ancient', field: 'economy', year: 0, cost: 1, unlocks: { buildings: ['castle'] } } }), r), /unknown building/);
});

test('the modern world knows everything up to 2020, so tech multipliers are neutral', () => {
  const g = game({ settings: { aiAggression: 0 } });
  const { state: s, rules: r } = g;
  const usa = s.countries[tagIdx(g, 'USA')];
  for (const t of r.tech.list) assert.equal(knows(s, usa.idx, t.i), !t.fictional && t.year <= 2026, t.id);
  // national traits (docs/NATIONS.md) are folded into the same multipliers: take them out
  const NAT = { research: 'research', combat: 'combat', farm: 'farm', popGrowth: 'growth', movement: 'movement', siege: 'siege' };
  for (const [k, v] of Object.entries(usa.tfx.mult)) { const t = v / (1 + (NAT[k] ? usa.tfx.nat[NAT[k]] : 0)); assert.ok(Math.abs(t - 1) < 0.02, `${k} ${t}`); }
  assert.equal(r.tech.eras[usa.tfx.era].id, 'information');
});

test('starting technologies follow the scenario year and each country\'s lag', () => {
  const g = hist('great_war_1914');
  const { state: s, rules: r } = g;
  const ger = tagIdx(g, 'GER'), eth = tagIdx(g, 'ETH');
  assert.ok(knowsId(s, r, ger, 'rifled_firearms') && knowsId(s, r, ger, 'electricity'));
  assert.ok(!knowsId(s, r, ger, 'tanks') && !knowsId(s, r, ger, 'nuclear_fission'));
  assert.ok(s.countries[eth].tfx.known < s.countries[ger].tfx.known, 'laggards know less');
  // prerequisites of anything known are known
  for (const c of s.countries) for (const t of r.tech.list) if (knows(s, c.idx, t.i)) for (const q of t.reqI) assert.ok(knows(s, c.idx, q), `${c.tag} ${t.id} needs ${r.tech.list[q].id}`);
  const rome = hist('height_of_rome_117');
  const rom = rome.state.countries[tagIdx(rome, 'ROM')];
  assert.equal(rome.rules.tech.eras[rom.tfx.era].id, 'classical');
  assert.ok(rom.tfx.mult.industry < 0.5, 'ancient industry is far below the modern baseline');
});

test('units, buildings and goods need their technology', () => {
  const g = hist('great_war_1914');
  const { state: s, map, rules: r } = g;
  const ger = tagIdx(g, 'GER'), cap = s.countries[ger].capital;
  s.countries[ger].treasury = 1e4;
  assert.match(canRecruit(s, map, r, ger, cap, 'armor') || '', /Needs the technology Tanks/);
  assert.equal(canRecruit(s, map, r, ger, cap, 'rifles'), null);
  const ep = r.econ.bi.electronics_plant;
  assert.match(canBuild(s, map, r, ger, cap, 'building', ep) || '', /Needs the technology/);
  assert.equal(popDemand(r, s.countries[ger], new Float64Array(r.econ.G))[r.econ.gi.electronics], 0, 'nobody wants goods that do not exist yet');
  grantTech(s, map, r, ger, r.tech.idx.tanks);
  assert.equal(canRecruit(s, map, r, ger, cap, 'armor'), null);
});

test('research accumulates points, finishes projects and follows the queue', () => {
  const g = hist('great_war_1914', { player: 'GBR' });
  const { state: s, map, rules: r } = g;
  const k = tagIdx(g, 'GBR'), c = s.countries[k];
  computeLedgers(s, map, r);
  assert.ok(researchPoints(s, r, c) > 0);
  assert.match(canResearch(s, r, k, 'nuclear_fission') || '', /^Needs /);
  assert.match(setResearchShare(s, r, k, 0.9) || '', /must be/);
  // queueing a distant technology queues its missing prerequisites first
  assert.equal(queueResearch(s, r, k, 'motorised_infantry'), null);
  const all = [c.research.current, ...c.research.queue];
  assert.equal(all[all.length - 1], 'motorised_infantry');
  for (const id of all) for (const q of r.tech.list[r.tech.idx[id]].reqI) assert.ok(knows(s, k, q) || all.indexOf(r.tech.list[q].id) < all.indexOf(id), `${id} after its prerequisites`);
  // finish the current project
  const first = c.research.current, t = r.tech.idx[first];
  c.research.progress = techCost(s, map, r, k, t) - 0.01;
  monthlyResearch(s, map, r);
  assert.ok(knows(s, k, t));
  assert.equal(c.research.current, all[1]);
  // switching projects keeps half the progress as banked points
  c.research.progress = 100; c.research.bank = 0;
  const other = r.tech.list.find((x) => available(s, r, k, x.i) && x.id !== c.research.current);
  assert.equal(setResearch(s, r, k, other.id), null);
  assert.equal(c.research.bank, 50);
});

test('technologies get cheaper as neighbours and the world learn them', () => {
  const g = game({ settings: { aiAggression: 0 } });
  const { state: s, map, rules: r } = g;
  const k = tagIdx(g, 'FRA');
  const t = r.tech.list.find((x) => x.fictional && available(s, r, k, x.i)).i;
  const parts = {};
  const before = techCost(s, map, r, k, t, parts);
  assert.equal(parts.discount, 0);
  for (const j of countryNeighbours(s, map).sets[k]) grantTech(s, null, r, j, t);
  s.day++; // the world share is cached per day
  const after = techCost(s, map, r, k, t, parts);
  assert.ok(after < before * 0.75, `${after} < ${before}`);
  assert.ok(parts.neighbours === 1 && parts.world > 0);
});

test('the era sets how much of the population can be mobilised', () => {
  const a = hist('height_of_rome_117'), b = hist('great_war_1914');
  const share = (g, tag) => { const c = g.state.countries[tagIdx(g, tag)]; return c.cache.maxManpower / c.cache.pop / c.govt.fx.manpower; };
  assert.ok(Math.abs(share(a, 'ROM') - a.rules.tech.eras[a.rules.tech.eraIdx.classical].manpowerShare) < 1e-9);
  assert.ok(share(b, 'GER') > share(a, 'ROM') * 2, 'industrial mass armies');
});

test('save v4 → v5 migration installs technologies; saves remap a changed technology file', () => {
  const d = data();
  const g = game({ seed: 'mig5', settings: { aiAggression: 0 } });
  runDays(g, 35);
  const o = JSON.parse(saveGame(g));
  o.version = 4; delete o.tech;
  for (const c of o.countries) delete c.research;
  const g2 = loadGame(JSON.stringify(o), d);
  assert.equal(g2.state.version, 6);
  assert.ok(knowsId(g2.state, d.rules, tagIdx(g2, 'USA'), 'transistor'));
  runDays(g2, 40);
  // a mod that removes a technology: known flags of the rest are kept by id
  const raw = rawRules();
  const techs = { ...raw.technologies.techs };
  delete techs.green_revolution;
  for (const t of Object.values(techs)) if (t.req) t.req = t.req.filter((x) => x !== 'green_revolution');
  const r2 = loadRules({ technologies: { ...raw.technologies, techs } });
  const g3 = loadGame(saveGame(g2), { ...d, rules: r2 });
  assert.equal(g3.state.tech.T, r2.tech.T);
  assert.ok(knowsId(g3.state, r2, tagIdx(g3, 'USA'), 'transistor'));
});

test('historical games are deterministic', () => {
  const run = () => { const g = hist('great_war_1914', { seed: 'det' }); runDays(g, 150); return saveGame(g); };
  assert.equal(run(), run());
});
