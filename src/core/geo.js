// Country adjacency derived from province ownership, cached per map version.
const nbCache = new WeakMap();

// Countries sharing a land border or strait with each country, and each country's border provinces.
export function countryNeighbours(state, map) {
  const ver = state.mapVersion || 0;
  let c = nbCache.get(state);
  if (c && c.ver === ver && c.sets.length === state.countries.length) return c;
  const sets = state.countries.map(() => new Set());
  const border = state.countries.map(() => []);
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) continue;
    let isBorder = false;
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      if (map.adjKind[e] === 2) continue;
      const o2 = state.prov.owner[map.adj[e]];
      if (o2 >= 0 && o2 !== o) { sets[o].add(o2); isBorder = true; }
    }
    if (isBorder) border[o].push(i);
  }
  c = { ver, sets, border };
  nbCache.set(state, c);
  return c;
}

export function neighbours(state, map, a, b) {
  return countryNeighbours(state, map).sets[a]?.has(b) || false;
}

// Each country's provinces (owned), cached per map version; also the unowned land ([-1] slot).
const provCache = new WeakMap();
function provinceLists(state, map) {
  const ver = state.mapVersion || 0;
  let c = provCache.get(state);
  if (!c || c.ver !== ver || c.n !== state.countries.length) {
    c = { ver, n: state.countries.length, lists: state.countries.map(() => []), free: [] };
    for (const i of map.ids) { const o = state.prov.owner[i]; if (o >= 0) c.lists[o].push(i); else c.free.push(i); }
    provCache.set(state, c);
  }
  return c;
}
export function provincesOf(state, map, k) { return provinceLists(state, map).lists[k] || []; }
export function unownedProvinces(state, map) { return provinceLists(state, map).free; }
