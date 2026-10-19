// Entry point shared by the browser client, tests and benchmarks.
import { decodeMap } from './mapdata.js';
import { createState, refreshCountryCache } from './state.js';
import { autoBalanceBudgets, computeLedgers } from './economy.js';
import { serialize, deserialize } from './save.js';
import { validateRules } from './rules.js';
import { compileEconomy, initEconomy } from './industry.js';
import { compilePolitics, initGovernment } from './government.js';
import { compileEvents } from './events.js';
import { initDiplomacy } from './diplomacy.js';
import { compileTech, initTechnology } from './technology.js';
import { declareWar, joinWar } from './war.js';
import { initStrategic } from './strategic.js';
import { computePrestige } from './prestige.js';

// governments: data/rules/governments.json; events: list of data/events/*.json files;
// technologies: data/rules/technologies.json
export function makeRules(units, balance, goods, buildings, governments, events = [], technologies = null) {
  const politics = compilePolitics(governments);
  const rules = { units: {}, balance, econ: compileEconomy(goods, buildings), politics, events: compileEvents(events, politics) };
  for (const [k, v] of Object.entries(units)) if (!k.startsWith('_')) rules.units[k] = v;
  validateRules(rules);
  rules.tech = compileTech(technologies || { eras: [{ id: 'modern', name: 'Modern' }], fields: {}, techs: {} }, rules);
  return rules;
}

export function newGame({ map, scenario, rules, playerTag = null, seed, settings }) {
  const state = createState({ map, scenario, rules, playerTag, seed: seed ?? `${scenario.id}-${Date.now()}`, settings });
  initTechnology(state, map, rules, scenario);
  initStrategic(state, map, rules, scenario);
  refreshCountryCache(state, map, rules);
  // starting manpower follows the era's mobilisable share unless the scenario sets it
  const given = new Set((scenario.countries || []).filter((c) => c.manpower).map((c) => c.tag));
  for (const c of state.countries) if (!given.has(c.tag)) c.manpower = c.cache.maxManpower * 0.6;
  initEconomy(state, map, rules, scenario);
  initGovernment(state, map, rules);
  initDiplomacy(state, map, rules, scenario);
  refreshCountryCache(state, map, rules);
  startScenarioWars(state, map, rules, scenario);
  for (const c of state.countries) c.manpower = Math.min(c.manpower, c.cache.maxManpower);
  if (scenario.autoBudget) autoBalanceBudgets(state, map, rules);
  else computeLedgers(state, map, rules);
  computePrestige(state);
  return { state, map, rules, scenario };
}

// Wars already running at the scenario start ("wars": [{ attackers: [tags], defenders: [tags] }]).
function startScenarioWars(state, map, rules, scenario) {
  const idx = new Map(state.countries.map((c) => [c.tag, c.idx]));
  for (const w of scenario.wars || []) {
    const att = (w.attackers || []).map((t) => idx.get(t)).filter((k) => k != null && state.countries[k].alive);
    const def = (w.defenders || []).map((t) => idx.get(t)).filter((k) => k != null && state.countries[k].alive);
    if (!att.length || !def.length || declareWar(state, map, rules, att[0], def[0])) continue;
    const war = state.wars[state.wars.length - 1];
    if (w.name) war.name = w.name;
    war.start = state.day - 30;
    for (const k of att.slice(1)) joinWar(state, map, rules, war, k, 'A');
    for (const k of def.slice(1)) joinWar(state, map, rules, war, k, 'D');
  }
  state.log = [];
}

export function loadGame(text, { map, rules, scenario }) {
  const state = deserialize(text, map, rules, scenario);
  // ledgers are part of the save (the AI reads them); only rebuild if missing
  if (state.countries.some((c) => c.alive && !c.ledger)) computeLedgers(state, map, rules);
  // saves from before the leaderboard: start its history now
  if (!state.prestige) computePrestige(state);
  return { state, map, rules, scenario };
}

export function saveGame(game, meta) {
  return serialize(game.state, meta);
}

export { decodeMap };
