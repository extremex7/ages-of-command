// Entry point shared by the browser client, tests and benchmarks.
import { decodeMap } from './mapdata.js';
import { createState } from './state.js';
import { autoBalanceBudgets, computeLedgers } from './economy.js';
import { serialize, deserialize } from './save.js';
import { validateRules } from './rules.js';

export function makeRules(units, balance) {
  const rules = { units: {}, balance };
  for (const [k, v] of Object.entries(units)) if (!k.startsWith('_')) rules.units[k] = v;
  validateRules(rules);
  return rules;
}

export function newGame({ map, scenario, rules, playerTag = null, seed, settings }) {
  const state = createState({ map, scenario, rules, playerTag, seed: seed ?? `${scenario.id}-${Date.now()}`, settings });
  if (scenario.autoBudget) autoBalanceBudgets(state, map, rules);
  else computeLedgers(state, map, rules);
  return { state, map, rules, scenario };
}

export function loadGame(text, { map, rules, scenario }) {
  const state = deserialize(text, map, rules);
  // ledgers are part of the save (the AI reads them); only rebuild if missing
  if (state.countries.some((c) => c.alive && !c.ledger)) computeLedgers(state, map, rules);
  return { state, map, rules, scenario };
}

export function saveGame(game, meta) {
  return serialize(game.state, meta);
}

export { decodeMap };
