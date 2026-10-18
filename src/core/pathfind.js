// A* over the province adjacency graph. Edge cost is travel time in days, so terrain,
// straits and sea lanes are weighed the same way the movement system will charge them.
import { canEnter, friendly } from './relations.js';
import { haversineKm, TERRAINS } from './mapdata.js';
import { laneOpen, linkOpen, hostileSea } from './naval.js';

export const TERRAIN_SPEED = { plains: 1, hills: 0.75, mountains: 0.5, forest: 0.7, desert: 0.8, tundra: 0.65 };
export const EDGE_FACTOR = [1, 1.8, 4]; // land border, strait crossing, short sea lane
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
  const infra = 1 + state.prov.infra[to] * 0.05; // roads and rail: up to +50% at level 10
  return (map.adjKm[edgeIdx] * EDGE_FACTOR[map.adjKind[edgeIdx]]) / (speedKmDay * SPEED_BY_T[map.terrain[to]] * infra);
}

// Returns an array of province ids from (excluding) `from` to (including) `to`, or null.
// Straits and sea lanes are closed to a country while enemy fleets hold the waters they cross
// (rules: needed for that check; without it every crossing is open).
export function findPath(map, state, country, from, to, speedKmDay, maxNodes = 6000, rules = null) {
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
      if (rules && map.adjKind[e] > 0 && !laneOpen(state, map, rules, country, e)) continue;
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

// Paths that may go by sea: nodes >= map.count are sea zones (map.count + zone). Armies embark in
// a port the country or its allies control, sail through zones its enemies do not hold, and land
// on any coast they may enter. Costs are days, as processMovement charges them.
export function findSeaPath(map, state, rules, country, from, to, speedKmDay, maxNodes = 12000) {
  if (from === to) return [];
  if (!canEnter(state, country, to)) return null;
  const S = map.sea, N = map.count, NB = rules.balance.naval;
  if (!S.Z) return null;
  const T = N + S.Z;
  const g = new Float64Array(T).fill(Infinity), prev = new Int32Array(T).fill(-1), closed = new Uint8Array(T);
  const sea = Math.max(NB.transportKmDay, speedKmDay * 1.5);
  const tlat = map.lat[to], tlon = map.lon[to];
  const h = (i) => (i < N ? haversineKm(map.lat[i], map.lon[i], tlat, tlon) : haversineKm(S.zones[i - N].lat, S.zones[i - N].lon, tlat, tlon)) / sea;
  const heap = new Heap();
  const relax = (u, v, cost) => { const ng = g[u] + cost; if (ng < g[v]) { g[v] = ng; prev[v] = u; heap.push(ng + h(v), v); } };
  g[from] = 0; heap.push(h(from), from);
  let expanded = 0;
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    if (u === to) break;
    closed[u] = 1;
    if (++expanded > maxNodes) return null;
    if (u < N) {
      for (let e = map.adjStart[u]; e < map.adjStart[u + 1]; e++) {
        const v = map.adj[e];
        if (closed[v] || (v !== to && !canEnter(state, country, v))) continue;
        if (map.adjKind[e] > 0 && !laneOpen(state, map, rules, country, e)) continue;
        relax(u, v, stepDays(map, state, u, e, speedKmDay));
      }
      // embark only where we or our allies hold the port
      if (friendly(state, country, state.prov.controller[u])) {
        for (let k = S.portStart[u]; k < S.portStart[u + 1]; k++) {
          const z = S.portZones[k];
          if (!closed[N + z] && !hostileSea(state, map, rules, country, z)) relax(u, N + z, NB.embarkDays);
        }
      }
    } else {
      const z = u - N;
      for (let e = S.start[z]; e < S.start[z + 1]; e++) {
        const w = S.adj[e];
        if (closed[N + w] || !linkOpen(state, map, country, S.link[e]) || hostileSea(state, map, rules, country, w)) continue;
        relax(u, N + w, S.km[e] / NB.transportKmDay);
      }
      for (const p of S.zoneProvs[z]) if (!closed[p] && (p === to || canEnter(state, country, p))) relax(u, p, NB.embarkDays);
    }
  }
  if (prev[to] < 0) return null;
  const path = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}

export function pathDays(map, state, rules, from, path, speedKmDay) {
  const N = map.count, S = map.sea, NB = rules.balance.naval;
  let d = 0, at = from;
  for (const v of path) {
    if (at < N && v < N) { const e = edgeIndex(map, at, v); d += e >= 0 ? stepDays(map, state, at, e, speedKmDay) : 0; }
    else if (at >= N && v >= N) { const z = at - N, w = v - N; for (let e = S.start[z]; e < S.start[z + 1]; e++) if (S.adj[e] === w) { d += S.km[e] / NB.transportKmDay; break; } }
    else d += NB.embarkDays;
    at = v;
  }
  return d;
}
