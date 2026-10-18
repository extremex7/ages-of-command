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

export function decodeMap(world, seas = null) {
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
  m.sea = seas ? decodeSeas(seas, m) : emptySeas(m);
  return m;
}

// Sea zones (data/map/seas.json, built by tools/build_seas.py): zones, zone links in CSR form,
// the zones each coastal province touches (ports), the zone each strait or sea lane crosses,
// and the 0.5° grid of zone ids used for map clicks and the naval map mode.
function decodeSeas(seas, m) {
  const zones = seas.zones.map((z) => ({ ...z }));
  const Z = zones.length;
  const deg = new Uint32Array(Z + 1);
  for (const l of seas.links) { deg[l.a]++; deg[l.b]++; }
  const start = new Uint32Array(Z + 1);
  for (let z = 0; z < Z; z++) start[z + 1] = start[z] + deg[z];
  const fill = start.slice(0, Z);
  const adj = new Int16Array(start[Z]), km = new Float32Array(start[Z]), link = new Int16Array(start[Z]);
  const links = seas.links.map((l, i) => ({ i, a: l.a, b: l.b, km: l.km, name: l.name || '', choke: l.choke || null, opens: l.opens ?? null }));
  for (const l of links) {
    adj[fill[l.a]] = l.b; km[fill[l.a]] = l.km; link[fill[l.a]++] = l.i;
    adj[fill[l.b]] = l.a; km[fill[l.b]] = l.km; link[fill[l.b]++] = l.i;
  }
  const portStart = new Uint32Array(m.count + 1), portList = [];
  const ports = seas.ports || {};
  for (let i = 0; i < m.count; i++) {
    portStart[i] = portList.length;
    for (const z of ports[i] || []) portList.push(z);
  }
  portStart[m.count] = portList.length;
  const portZones = Int16Array.from(portList);
  const zoneProvs = zones.map(() => []);
  for (let i = 0; i < m.count; i++) for (let k = portStart[i]; k < portStart[i + 1]; k++) zoneProvs[portZones[k]].push(i);
  // the zone each province-graph edge crosses (-1 for land borders)
  const laneZone = new Int16Array(m.adj.length).fill(-1);
  for (const [u, v, z] of seas.lanes || []) {
    for (let e = m.adjStart[u]; e < m.adjStart[u + 1]; e++) if (m.adj[e] === v) laneZone[e] = z;
    for (let e = m.adjStart[v]; e < m.adjStart[v + 1]; e++) if (m.adj[e] === u) laneZone[e] = z;
  }
  const G = seas.grid, cells = new Int16Array(G.cols * G.rows);
  for (let k = 0, o = 0; k < G.rle.length; k += 2) { cells.fill(G.rle[k], o, o + G.rle[k + 1]); o += G.rle[k + 1]; }
  return { Z, zones, links, start, adj, km, link, portStart, portZones, zoneProvs, laneZone, grid: { ...G, cells, rle: null } };
}

function emptySeas(m) {
  return decodeSeas({ zones: [], links: [], ports: {}, lanes: [], grid: { res: 1, lon0: -180, lat0: -58, cols: 1, rows: 1, rle: [-1, 1] } }, m);
}

// The zones a province's ports open onto (empty for inland provinces).
export function portZonesOf(map, i) {
  const s = map.sea;
  return s.portZones.subarray(s.portStart[i], s.portStart[i + 1]);
}

// Map projection (Miller, as tools/build_map.py) and its inverse.
const LAT_MIN = -58, LAT_MAX = 84;
const millerY = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * (Math.max(LAT_MIN, Math.min(LAT_MAX, lat)) * Math.PI) / 180));
const YMAX = millerY(LAT_MAX);
export function projectLonLat(map, lon, lat) {
  const scale = map.width / (2 * Math.PI);
  return [((lon + 180) / 360) * map.width, (YMAX - millerY(lat)) * scale];
}
export function unprojectXY(map, x, y) {
  const scale = map.width / (2 * Math.PI);
  const yy = YMAX - y / scale;
  return [(x / map.width) * 360 - 180, (2.5 * (Math.atan(Math.exp(yy / 1.25)) - Math.PI / 4) * 180) / Math.PI];
}

// The sea zone at a map point, or -1 on land.
export function zoneAt(map, x, y) {
  const G = map.sea.grid;
  const [lon, lat] = unprojectXY(map, x, y);
  const r = Math.floor((lat - G.lat0) / G.res), c = Math.floor((((lon + 180) % 360 + 360) % 360) / G.res);
  if (r < 0 || r >= G.rows || c < 0 || c >= G.cols) return -1;
  return G.cells[r * G.cols + c];
}

export function neighbours(map, i) {
  return map.adj.subarray(map.adjStart[i], map.adjStart[i + 1]);
}

export function areAdjacent(map, a, b) {
  for (let k = map.adjStart[a]; k < map.adjStart[a + 1]; k++) if (map.adj[k] === b) return true;
  return false;
}
