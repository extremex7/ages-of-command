// A* over the province adjacency graph. Edge cost is travel time in days, so terrain,
// straits and sea lanes are weighed the same way the movement system will charge them.
import { canEnter } from './relations.js';
import { haversineKm, TERRAINS } from './mapdata.js';

export const TERRAIN_SPEED = { plains: 1, hills: 0.75, mountains: 0.5, forest: 0.7, desert: 0.8, tundra: 0.65 };
export const EDGE_FACTOR = [1, 1.8, 4]; // land border, strait crossing, sea lane (until navies exist)
const SPEED_BY_T = TERRAINS.map((t) => TERRAIN_SPEED[t]);

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export function stepDays(map, state, from, edgeIdx, speedKmDay) {
  const to = map.adj[edgeIdx];
  const infra = 1 + Math.min(100, state.prov.dev[to]) / 200;
  return (map.adjKm[edgeIdx] * EDGE_FACTOR[map.adjKind[edgeIdx]]) / (speedKmDay * SPEED_BY_T[map.terrain[to]] * infra);
}

// Returns an array of province ids from (excluding) `from` to (including) `to`, or null.
export function findPath(map, state, country, from, to, speedKmDay, maxNodes = 6000) {
  if (from === to) return [];
  if (!canEnter(state, country, to)) return null;
  const N = map.count;
  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const vmax = speedKmDay * 1.5; // best-case speed for an admissible heuristic
  const tlat = map.lat[to], tlon = map.lon[to];
  const h = (i) => haversineKm(map.lat[i], map.lon[i], tlat, tlon) / vmax;
  const heap = new Heap();
  g[from] = 0; heap.push(h(from), from);
  let expanded = 0;
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    if (u === to) break;
    closed[u] = 1;
    if (++expanded > maxNodes) return null;
    for (let e = map.adjStart[u]; e < map.adjStart[u + 1]; e++) {
      const v = map.adj[e];
      if (closed[v]) continue;
      if (v !== to && !canEnter(state, country, v)) continue;
      const ng = g[u] + stepDays(map, state, u, e, speedKmDay);
      if (ng < g[v]) { g[v] = ng; prev[v] = u; heap.push(ng + h(v), v); }
    }
  }
  if (prev[to] < 0) return null;
  const path = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}

export function edgeIndex(map, a, b) {
  for (let e = map.adjStart[a]; e < map.adjStart[a + 1]; e++) if (map.adj[e] === b) return e;
  return -1;
}
