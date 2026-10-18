import fs from 'node:fs';
import { decodeMap, makeRules, newGame } from '../src/core/game.js';

const rd = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));

let cached = null;
export function data() {
  if (!cached) {
    cached = {
      map: decodeMap(rd('data/map/world.json')),
      rules: makeRules(rd('data/rules/units.json'), rd('data/rules/balance.json')),
      scenario: rd('data/scenarios/modern_2026.json'),
    };
  }
  return cached;
}

export function game(opts = {}) {
  const d = data();
  return newGame({ ...d, playerTag: opts.player ?? null, seed: opts.seed ?? 'test', settings: opts.settings });
}

export function tagIdx(g, tag) {
  return g.state.countries.findIndex((c) => c.tag === tag);
}

export function provOf(g, tag) {
  const k = tagIdx(g, tag);
  return g.map.ids.filter((i) => g.state.prov.owner[i] === k);
}

// Two neighbouring provinces owned by different given countries, connected by a land border.
export function borderPair(g, a, b) {
  const A = tagIdx(g, a), B = tagIdx(g, b), m = g.map;
  for (const i of m.ids) {
    if (g.state.prov.owner[i] !== A) continue;
    for (let e = m.adjStart[i]; e < m.adjStart[i + 1]; e++) {
      if (m.adjKind[e] === 0 && g.state.prov.owner[m.adj[e]] === B) return [i, m.adj[e]];
    }
  }
  return null;
}
