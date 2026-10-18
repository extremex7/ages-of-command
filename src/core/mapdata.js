// Decodes data/map/world.json into compact, read-only structures shared by simulation,
// renderer and UI. Province ids are the stable numeric ids from province_registry.json.

export const TERRAINS = ['plains', 'hills', 'mountains', 'forest', 'desert', 'tundra'];

function decodeRings(rings, quant) {
  // Returns { pts: Float32Array, starts: Uint32Array } with absolute map coordinates.
  let n = 0;
  for (const r of rings) n += r.length;
  const pts = new Float32Array(n);
  const starts = new Uint32Array(rings.length + 1);
  let o = 0;
  rings.forEach((r, i) => {
    starts[i] = o;
    let x = 0, y = 0;
    for (let k = 0; k < r.length; k += 2) {
      x += r[k]; y += r[k + 1];
      pts[o++] = x / quant; pts[o++] = y / quant;
    }
  });
  starts[rings.length] = o;
  return { pts, starts };
}

function decodeLines(lines, quant) {
  return lines.map((r) => {
    const out = new Float32Array(r.length);
    let x = 0, y = 0;
    for (let k = 0; k < r.length; k += 2) { x += r[k]; y += r[k + 1]; out[k] = x / quant; out[k + 1] = y / quant; }
    return out;
  });
}

const R_EARTH = 6371;
export function haversineKm(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * p) / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(((lon2 - lon1) * p) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function decodeMap(world) {
  const list = world.provinces;
  let maxId = -1;
  for (const p of list) maxId = Math.max(maxId, p.id);
  const N = maxId + 1;
  const m = {
    width: world.width, height: world.height, count: N, source: world.source,
    exists: new Uint8Array(N), name: new Array(N).fill(''), key: new Array(N).fill(''),
    iso: new Array(N).fill(''), lat: new Float32Array(N), lon: new Float32Array(N),
    x: new Float32Array(N), y: new Float32Array(N), bbox: new Float32Array(N * 4),
    area: new Float32Array(N), coastal: new Uint8Array(N), terrain: new Uint8Array(N),
    fine: new Array(N), coarse: new Array(N), ids: [], countries: world.countries,
  };
  for (const p of list) {
    const i = p.id;
    m.exists[i] = 1; m.ids.push(i);
    m.name[i] = p.name; m.key[i] = p.key; m.iso[i] = p.iso;
    m.lat[i] = p.lat; m.lon[i] = p.lon; m.x[i] = p.x; m.y[i] = p.y;
    m.bbox.set(p.bbox, i * 4);
    m.area[i] = p.area; m.coastal[i] = p.coastal ? 1 : 0;
    m.terrain[i] = Math.max(0, TERRAINS.indexOf(p.terrain));
    m.fine[i] = decodeRings(p.fine, world.quant);
    m.coarse[i] = decodeRings(p.coarse.length ? p.coarse : p.fine, world.quant);
  }
  // adjacency in CSR form: neighbours of i are adj[start[i] .. start[i+1])
  const a = world.adjacency;
  const deg = new Uint32Array(N + 1);
  for (let k = 0; k < a.length; k += 4) { deg[a[k]]++; deg[a[k + 1]]++; }
  const start = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) start[i + 1] = start[i] + deg[i];
  const fill = start.slice(0, N);
  const E = start[N];
  const adj = new Int32Array(E), kind = new Uint8Array(E), km = new Float32Array(E);
  for (let k = 0; k < a.length; k += 4) {
    const u = a[k], v = a[k + 1], t = a[k + 2];
    const d = haversineKm(m.lat[u], m.lon[u], m.lat[v], m.lon[v]);
    adj[fill[u]] = v; kind[fill[u]] = t; km[fill[u]++] = d;
    adj[fill[v]] = u; kind[fill[v]] = t; km[fill[v]++] = d;
  }
  Object.assign(m, { adjStart: start, adj, adjKind: kind, adjKm: km });
  m.byKey = new Map(m.ids.map((i) => [m.key[i], i]));
  // shared land borders: polylines in absolute map coordinates, used by the renderer
  m.borders = (world.borders || []).map(([a, b, f, c]) => ({ a, b, fine: decodeLines(f, world.quant), coarse: decodeLines(c.length ? c : f, world.quant) }));
  return m;
}

export function neighbours(map, i) {
  return map.adj.subarray(map.adjStart[i], map.adjStart[i + 1]);
}

export function areAdjacent(map, a, b) {
  for (let k = map.adjStart[a]; k < map.adjStart[a + 1]; k++) if (map.adj[k] === b) return true;
  return false;
}
