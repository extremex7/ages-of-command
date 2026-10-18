#!/usr/bin/env python3
"""Sea zones for navies (Milestone 6): data/map/seas.json.

Input:  build/source/countries-50m.json (Natural Earth 50m admin-0, the land mask)
        data/map/world.json (provinces, for ports and sea lanes)
Output: data/map/seas.json

Steps: rasterise the oceans on a 0.5 degree grid -> grow named zones from hand-placed seeds
through water only (nearest seed by sailing distance) -> zone links from touching cells, plus
hand-listed straits and canals the grid is too coarse to see -> each coastal province's zones
(its ports) -> the zone of every strait and sea lane in the province graph.

Chokepoints name the provinces that command them: a country at war with whoever controls one
of those provinces cannot sail through. Canals open in a given year.
"""
import heapq, json, math, os, sys
import numpy as np
import shapely
import shapely.affinity
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_map import topo_features, proj, polys, SRC, ROOT, LAT_MIN, LAT_MAX, MAP_W, YMAX, SCALE  # noqa: E402

RES = 0.5
COLS = int(360 / RES)
ROWS = int((LAT_MAX - LAT_MIN) / RES)

# name, lon, lat (a point in open water near the middle of the zone)
SEEDS = [
    # Arctic
    ('Arctic Ocean', 60, 83), ('Greenland Sea', -5, 76), ('Norwegian Sea', 3, 68), ('Barents Sea', 40, 73),
    ('Kara Sea', 70, 76), ('Laptev Sea', 125, 77), ('East Siberian Sea', 162, 74), ('Chukchi Sea', -170, 70),
    ('Beaufort Sea', -140, 72.5), ('Canadian Arctic', -95, 75), ('Baffin Bay', -65, 72), ('Hudson Bay', -85, 59),
    ('Denmark Strait', -28, 66),
    # Atlantic and European seas
    ('North Sea', 3, 56), ('Skagerrak', 9, 58), ('Baltic Sea', 19, 56.5), ('Gulf of Bothnia', 20, 62.5),
    ('English Channel', -1.5, 50), ('Celtic Sea', -8, 49), ('Irish Sea', -5, 53.5), ('Bay of Biscay', -5, 45.5),
    ('Labrador Sea', -55, 57), ('Gulf of St Lawrence', -62, 48), ('North Atlantic', -35, 50),
    ('Western Atlantic', -60, 38), ('Sargasso Sea', -62, 27), ('Mid-Atlantic', -38, 30), ('Eastern Atlantic', -18, 33),
    ('Gulf of Mexico', -90, 25), ('Caribbean Sea', -75, 15), ('Central Atlantic', -30, 8), ('Gulf of Guinea', 3, 1),
    ('Brazil Basin', -28, -15), ('South Atlantic', -12, -32), ('Cape Basin', 10, -32), ('Argentine Sea', -58, -44),
    ('Southern Atlantic', -25, -52), ('Drake Passage', -65, -57),
    # Mediterranean and Black Sea
    ('Alboran Sea', -3, 36), ('Western Mediterranean', 5, 39.5), ('Tyrrhenian Sea', 12, 40), ('Adriatic Sea', 15.5, 43),
    ('Ionian Sea', 18.5, 37), ('Strait of Sicily', 14, 34.5), ('Aegean Sea', 25, 38.5), ('Levantine Sea', 31, 33.5),
    ('Black Sea', 34, 43.3), ('Caspian Sea', 51, 41),
    # Indian Ocean
    ('Red Sea', 38, 20), ('Gulf of Aden', 48, 12.5), ('Persian Gulf', 51, 27), ('Gulf of Oman', 58.8, 24.5),
    ('Arabian Sea', 63, 15), ('Laccadive Sea', 74, 8), ('Bay of Bengal', 88, 15), ('Andaman Sea', 96, 10),
    ('Strait of Malacca', 99.5, 4.5), ('Somali Basin', 55, 0), ('Mozambique Channel', 41, -18), ('Mascarene Basin', 58, -20),
    ('Central Indian Ocean', 78, -10), ('Eastern Indian Ocean', 100, -15), ('Southwest Indian Ocean', 45, -38),
    ('South Indian Ocean', 80, -36), ('Great Australian Bight', 130, -38), ('Southern Indian Ocean', 70, -52),
    ('Southern Ocean', 130, -52),
    # Pacific
    ('Bering Sea', -178, 58), ('Gulf of Alaska', -145, 55), ('Sea of Okhotsk', 150, 55), ('Sea of Japan', 135, 40),
    ('Yellow Sea', 123, 36), ('East China Sea', 126, 29), ('Taiwan Strait', 119.5, 24), ('South China Sea', 114, 14),
    ('Gulf of Thailand', 101.5, 9.5), ('Philippine Sea', 132, 20), ('Celebes and Sulu Seas', 121, 6),
    ('Java Sea', 111, -5), ('Banda Sea', 127, -6), ('Arafura Sea', 135, -10), ('Coral Sea', 155, -16),
    ('Tasman Sea', 160, -38), ('Northwest Pacific', 155, 35), ('North Pacific', -170, 40), ('Hawaiian Waters', -158, 22),
    ('Northeast Pacific', -132, 35), ('Mexican Pacific', -105, 14), ('Gulf of Panama', -82, 5), ('Western Pacific', 160, 5),
    ('Central Pacific', -155, 0), ('Eastern Pacific', -110, -5), ('Peru Basin', -85, -20), ('Polynesia', -150, -20),
    ('Southwest Pacific', -175, -22), ('Melanesia', 165, -10), ('South Pacific', -120, -35),
    ('New Zealand Waters', 178, -45), ('Southern Pacific', -110, -54),
]

# Straits and canals the grid cannot see, and chokepoints. Provinces are game province ids
# (see data/map/province_registry.json); "opens" is the first year a canal can be used.
LINKS = [
    {'a': 'Black Sea', 'b': 'Aegean Sea', 'name': 'Bosporus and Dardanelles', 'choke': [2087]},
    {'a': 'Baltic Sea', 'b': 'Skagerrak', 'name': 'Danish Straits', 'choke': [635]},
    {'a': 'Alboran Sea', 'b': 'Eastern Atlantic', 'name': 'Strait of Gibraltar', 'choke': [850]},
    {'a': 'Levantine Sea', 'b': 'Red Sea', 'name': 'Suez Canal', 'choke': [707, 706], 'opens': 1869},
    {'a': 'Red Sea', 'b': 'Gulf of Aden', 'name': 'Bab-el-Mandeb', 'choke': [2317]},
    {'a': 'Persian Gulf', 'b': 'Gulf of Oman', 'name': 'Strait of Hormuz', 'choke': [1038]},
    {'a': 'Strait of Malacca', 'b': 'South China Sea', 'name': 'Singapore Strait', 'choke': [1915]},
    {'a': 'Caribbean Sea', 'b': 'Gulf of Panama', 'name': 'Panama Canal', 'choke': [1560, 1561], 'opens': 1914},
]

def log(*a):
    print(*a, file=sys.stderr)

def km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371 * math.asin(min(1, math.sqrt(a)))

def cell_ll(r, c):
    return (-180 + (c + 0.5) * RES, LAT_MIN + (r + 0.5) * RES)

def cell_of(lon, lat):
    return int((lat - LAT_MIN) / RES), int(((lon + 180) % 360) / RES)

def unproj(x, y):
    lon = x / MAP_W * 360 - 180
    yy = YMAX - y / SCALE
    lat = math.degrees(2.5 * (math.atan(math.exp(yy / 1.25)) - math.pi / 4))
    return lon, lat

def unwrap(g):
    """Polygons crossing the antimeridian come out as bands around the world; split them."""
    out = []
    for p in polys(g):
        x0, _, x1, _ = p.bounds
        if x1 - x0 <= 180: out.append(p); continue
        sh = lambda ring: [(x + 360 if x < 0 else x, y) for x, y in ring.coords]
        q = Polygon(sh(p.exterior), [sh(r) for r in p.interiors]).buffer(0)
        east = q.intersection(shapely.box(0, -90, 180, 90))
        west = shapely.affinity.translate(q.intersection(shapely.box(180, -90, 540, 90)), -360)
        out += polys(east) + polys(west)
    return unary_union(out) if out else Polygon()

def province_geoms(world):
    q = world['quant']
    out = {}
    for p in world['provinces']:
        ps = []
        for ring in p['fine']:
            x = y = 0; pts = []
            for k in range(0, len(ring), 2):
                x += ring[k]; y += ring[k + 1]
                pts.append(unproj(x / q, y / q))
            if len(pts) >= 3: ps.append(unwrap(Polygon(pts).buffer(0)))
        out[p['id']] = unary_union(ps) if ps else None
    return out

def main():
    land = unary_union([unwrap(g) for _, g in topo_features(os.path.join(SRC, 'countries-50m.json'))])
    shapely.prepare(land)
    lons = -180 + (np.arange(COLS) + 0.5) * RES
    lats = LAT_MIN + (np.arange(ROWS) + 0.5) * RES
    LO, LA = np.meshgrid(lons, lats)
    water = ~shapely.contains_xy(land, LO.ravel(), LA.ravel()).reshape(ROWS, COLS)
    log('water cells', int(water.sum()), 'of', ROWS * COLS)

    # grow zones from the seeds by sailing distance (Dijkstra over water cells, 8 neighbours)
    zone = np.full((ROWS, COLS), -1, dtype=np.int16)
    dist = np.full((ROWS, COLS), np.inf)
    heap = []
    for z, (name, lon, lat) in enumerate(SEEDS):
        r, c = cell_of(lon, lat)
        if not water[r, c]:
            # nudge onto the nearest water cell
            best = None
            for dr in range(-6, 7):
                for dc in range(-6, 7):
                    rr, cc = r + dr, (c + dc) % COLS
                    if 0 <= rr < ROWS and water[rr, cc] and (best is None or dr * dr + dc * dc < best[0]):
                        best = (dr * dr + dc * dc, rr, cc)
            if not best: raise SystemExit(f'seed {name} is on land')
            _, r, c = best
        dist[r, c] = 0; heapq.heappush(heap, (0.0, r, c, z))
    steps = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]
    while heap:
        d, r, c, z = heapq.heappop(heap)
        if zone[r, c] >= 0: continue
        zone[r, c] = z
        lon, lat = cell_ll(r, c)
        for dr, dc in steps:
            rr, cc = r + dr, (c + dc) % COLS
            if not (0 <= rr < ROWS) or not water[rr, cc] or zone[rr, cc] >= 0: continue
            lon2, lat2 = cell_ll(rr, cc)
            nd = d + km(lat, lon, lat2, lon2)
            if nd < dist[rr, cc]:
                dist[rr, cc] = nd; heapq.heappush(heap, (nd, rr, cc, z))
    cells = np.bincount(zone[zone >= 0].ravel(), minlength=len(SEEDS))
    for z, n in enumerate(cells):
        if n == 0: raise SystemExit(f'zone {SEEDS[z][0]} got no water')
    log('unreached water cells (lakes, enclosed bays)', int((water & (zone < 0)).sum()))

    # zone centres: the seed (labels and fleet positions)
    zones = []
    for z, (name, lon, lat) in enumerate(SEEDS):
        x, y = proj(lon, lat)
        zones.append({'id': z, 'name': name, 'lon': lon, 'lat': lat, 'x': round(x, 1), 'y': round(y, 1), 'cells': int(cells[z])})
    idx = {s[0]: i for i, s in enumerate(SEEDS)}

    # links from touching cells (4-neighbour, so diagonal slivers across land do not count)
    touch = {}
    for r in range(ROWS):
        for c in range(COLS):
            a = zone[r, c]
            if a < 0: continue
            for dr, dc in ((0, 1), (1, 0)):
                rr, cc = r + dr, (c + dc) % COLS
                if rr >= ROWS: continue
                b = zone[rr, cc]
                if b >= 0 and b != a:
                    k = (min(a, b), max(a, b)); touch[k] = touch.get(k, 0) + 1
    links = {}
    for (a, b), n in touch.items():
        if n < 2: continue
        links[(a, b)] = {'a': int(a), 'b': int(b)}
    for L in LINKS:
        a, b = idx[L['a']], idx[L['b']]
        k = (min(a, b), max(a, b))
        rec = links.setdefault(k, {'a': k[0], 'b': k[1]})
        rec['name'] = L['name']
        if 'choke' in L: rec['choke'] = L['choke']
        if 'opens' in L: rec['opens'] = L['opens']
        # a canal replaces any grid contact between the same zones
    for rec in links.values():
        A, B = zones[rec['a']], zones[rec['b']]
        rec['km'] = round(km(A['lat'], A['lon'], B['lat'], B['lon']))
    links = sorted(links.values(), key=lambda r: (r['a'], r['b']))
    # every zone must be reachable from the Atlantic, except the Caspian
    nbr = {z: set() for z in range(len(zones))}
    for L in links: nbr[L['a']].add(L['b']); nbr[L['b']].add(L['a'])
    seen, todo = {idx['North Atlantic']}, [idx['North Atlantic']]
    while todo:
        u = todo.pop()
        for v in nbr[u]:
            if v not in seen: seen.add(v); todo.append(v)
    lost = [zones[z]['name'] for z in range(len(zones)) if z not in seen and zones[z]['name'] != 'Caspian Sea']
    if lost: raise SystemExit(f'zones not connected to the oceans: {lost}')

    # ports: the zones each coastal province touches (water cells within ~0.6 degrees)
    world = json.load(open(os.path.join(ROOT, 'data/map/world.json')))
    geoms = province_geoms(world)
    wr, wc = np.nonzero(zone >= 0)
    pts_lon = -180 + (wc + 0.5) * RES; pts_lat = LAT_MIN + (wr + 0.5) * RES
    tree = shapely.STRtree(shapely.points(pts_lon, pts_lat))
    ports = {}
    for p in world['provinces']:
        g = geoms[p['id']]
        if not p['coastal'] or g is None or g.is_empty: continue
        hits = tree.query(g.buffer(0.6), predicate='intersects')
        if not len(hits):
            hits = tree.query(g.buffer(1.5), predicate='intersects')
        if not len(hits): continue
        zs = np.bincount(zone[wr[hits], wc[hits]], minlength=len(zones))
        order = [int(z) for z in np.argsort(-zs) if zs[z] > 0][:3]
        ports[p['id']] = order
    log('ports', len(ports), 'of', sum(1 for p in world['provinces'] if p['coastal']), 'coastal provinces')

    # the zone of each strait (kind 1) and sea lane (kind 2): the water nearest the midpoint
    by_id = {p['id']: p for p in world['provinces']}
    adj = world['adjacency']
    lanes = []
    for k in range(0, len(adj), 4):
        u, v, t = adj[k], adj[k + 1], adj[k + 2]
        if t == 0: continue
        A, B = by_id[u], by_id[v]
        dlon = ((B['lon'] - A['lon'] + 540) % 360) - 180
        mlon, mlat = A['lon'] + dlon / 2, (A['lat'] + B['lat']) / 2
        common = [z for z in ports.get(u, []) if z in ports.get(v, [])]
        if common:
            z = common[0]
        else:
            i = tree.nearest(shapely.Point(((mlon + 180) % 360) - 180, mlat))
            z = int(zone[wr[i], wc[i]])
        lanes.append([u, v, z])

    # the grid itself (run-length encoded zone ids, -1 = land), for map clicks and the naval map mode
    flat = zone.ravel().tolist()
    rle = []
    prev, n = flat[0], 0
    for v in flat:
        if v == prev: n += 1
        else: rle += [prev, n]; prev, n = v, 1
    rle += [prev, n]
    out = {
        'version': 1, 'source': 'tools/build_seas.py from Natural Earth 50m admin-0 (public domain)',
        'grid': {'res': RES, 'lon0': -180, 'lat0': LAT_MIN, 'cols': COLS, 'rows': ROWS, 'rle': rle},
        'zones': zones, 'links': links, 'ports': {str(k): v for k, v in sorted(ports.items())}, 'lanes': lanes,
    }
    path = os.path.join(ROOT, 'data/map/seas.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    log(f'wrote {len(zones)} zones, {len(links)} links, {len(ports)} ports, {len(lanes)} lanes, {len(rle)//2} runs -> {os.path.getsize(path)//1024} KB')

if __name__ == '__main__':
    main()
