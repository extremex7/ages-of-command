// Node-side loader for every rule file (units, balance, goods, buildings, governments,
// technologies, the event files listed in data/events/index.json, and formables, traits and
// nations for docs/NATIONS.md).
import fs from 'node:fs';
import { makeRules, decodeMap } from '../src/core/game.js';

const ROOT = new URL('../', import.meta.url);
export const readJson = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT)));

export function rawRules(overrides = {}) {
  const ev = readJson('data/events/index.json').files.map((f) => readJson('data/events/' + f));
  return {
    units: readJson('data/rules/units.json'), balance: readJson('data/rules/balance.json'), goods: readJson('data/rules/goods.json'),
    buildings: readJson('data/rules/buildings.json'), governments: readJson('data/rules/governments.json'), events: ev,
    technologies: readJson('data/rules/technologies.json'),
    nations: { formables: readJson('data/rules/formables.json'), traits: readJson('data/rules/traits.json'), config: readJson('data/rules/nations.json') }, ...overrides,
  };
}

export function loadRules(overrides = {}) {
  const r = rawRules(overrides);
  return makeRules(r.units, r.balance, r.goods, r.buildings, r.governments, r.events, r.technologies, r.nations);
}

// The world map with its sea zones (data/map/world.json + data/map/seas.json).
export function loadMap() {
  return decodeMap(readJson('data/map/world.json'), readJson('data/map/seas.json'));
}
