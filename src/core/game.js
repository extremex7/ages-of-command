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

// governments: data/rules/governments.json; events: list of data/events/*.json files
export function makeRules(units, balance, goods, buildings, governments, events = []) {
  const politics = compilePolitics(governments);
  const rules = { units: {}, balance, econ: compileEconomy(goods, buildings), politics, events: compileEvents(events, politics) };
  for (const [k, v] of Object.entries(units)) if (!k.startsWith('_')) rules.units[k] = v;
  validateRules(rules);
  return rules;
}

export function newGame({ map, scenario, rules, playerTag = null, seed, settings }) {
  const state = createState({ map, scenario, rules, playerTag, seed: seed ?? `${scenario.id}-${Date.now()}`, settings });
  initEconomy(state, map, rules, scenario);
  initGovernment(state, map, rules);
  initDiplomacy(state, map, rules, scenario);
  refreshCountryCache(state, map, rules);
  for (const c of state.countries) c.manpower = Math.min(c.manpower, c.cache.maxManpower);
  if (scenario.autoBudget) autoBalanceBudgets(state, map, rules);
  else computeLedgers(state, map, rules);
  return { state, map, rules, scenario };
}

export function loadGame(text, { map, rules, scenario }) {
  const state = deserialize(text, map, rules, scenario);
  // ledgers are part of the save (the AI reads them); only rebuild if missing
  if (state.countries.some((c) => c.alive && !c.ledger)) computeLedgers(state, map, rules);
  return { state, map, rules, scenario };
}

export function saveGame(game, meta) {
  return serialize(game.state, meta);
}

export { decodeMap };
