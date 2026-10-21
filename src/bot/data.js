// Loads what the bot needs to run a save: the map, the rules and the scenario the save was made
// from. `json(path)` reads a game file relative to the game folder (fetch in a browser or worker,
// the file system in Node); `customScenario(id)` returns a custom scenario made in the editor
// (stored as "scenario.<id>") or null. Same files as src/ui/main.js boot().
import { decodeMap, makeRules, loadGame } from '../core/game.js';
import { validateScenario } from '../core/rules.js';

export async function loadGameData(json) {
  const [world, seas, units, balance, goods, buildings, governments, technologies, evIndex, index, formables, traits, nations, society] = await Promise.all([
    json('data/map/world.json'), json('data/map/seas.json'), json('data/rules/units.json'), json('data/rules/balance.json'),
    json('data/rules/goods.json'), json('data/rules/buildings.json'), json('data/rules/governments.json'),
    json('data/rules/technologies.json'), json('data/events/index.json'), json('data/scenarios/index.json'),
    json('data/rules/formables.json'), json('data/rules/traits.json'), json('data/rules/nations.json'), json('data/rules/society.json'),
  ]);
  const events = await Promise.all(evIndex.files.map((f) => json('data/events/' + f)));
  const map = decodeMap(world, seas);
  const rules = makeRules(units, balance, goods, buildings, governments, events, technologies, { formables, traits, config: nations }, society);
  return { map, rules, scenarios: index.scenarios, json };
}

// The game in save text `text`.
export async function loadSaveText(data, text, customScenario = async () => null) {
  let id;
  try { id = JSON.parse(text).scenarioId; } catch { throw new Error('This save is damaged (not valid JSON).'); }
  const meta = data.scenarios.find((s) => s.id === id);
  const sc = meta ? await data.json('data/scenarios/' + meta.file) : await customScenario(id);
  if (!sc) throw new Error(`Scenario "${id}" is not installed (a custom scenario that was deleted?)`);
  validateScenario(sc, data.map);
  return loadGame(text, { map: data.map, rules: data.rules, scenario: sc });
}
