#!/usr/bin/env python3
"""Map pipeline: Natural Earth admin-1 subdivisions -> game provinces.

Input  (see tools/fetch_source.sh):
  build/source/package/dist/assets/adm1/*.json   Natural Earth 10m admin-1 (public domain), per country
  build/source/countries-50m.json                Natural Earth 50m admin-0 TopoJSON (fills gaps)
Output:
  data/map/world.json               province geometry (2 LODs, projected, quantized) + adjacency
  data/map/province_registry.json   stable key -> numeric id map (append-only; keeps saves valid)

Steps: load -> fill missing countries -> merge tiny subdivisions -> split huge ones ->
global adjacency (land borders + short sea straits) -> coastal flags -> terrain estimate ->
project (Miller) -> simplify -> quantize + delta encode.
"""
import glob, json, math, os, re, sys
from collections import defaultdict
from shapely.geometry import shape, Polygon, MultiPolygon, box, mapping
from shapely.ops import unary_union, polylabel
from shapely.validation import make_valid
from shapely.strtree import STRtree
import shapely

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'build', 'source')
OUT = os.path.join(ROOT, 'data', 'map')
MAP_W = 4096.0          # world width in map units
QUANT = 10              # stored coordinates = map units * QUANT
LAT_MIN, LAT_MAX = -58.0, 84.0
DROP = {'ATA', 'HMD', 'ATF', 'SGS', 'UMI', 'IOT', 'PCN', 'BVT'}
KM_PER_DEG = 111.32
SPLIT_KM2 = 330_000     # provinces larger than this are split
MIN_KM2 = 2_500         # provinces smaller than this are merged where possible
STRAIT_DEG = 0.45       # max sea gap (~50 km) that land units may cross

def log(*a):
    print(*a, file=sys.stderr)

def polys(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    if isinstance(g, MultiPolygon): return list(g.geoms)
    return [p for x in getattr(g, 'geoms', []) for p in polys(x)]

def clean(g):
    g = make_valid(g) if not g.is_valid else g
    ps = [p for p in polys(g) if p.area > 1e-7]
    if not ps: return Polygon()
    return MultiPolygon(ps) if len(ps) > 1 else ps[0]

def km2(g):
    if g.is_empty: return 0.0
    lat = g.centroid.y
    return g.area * KM_PER_DEG * KM_PER_DEG * math.cos(math.radians(lat))

# ---------------------------------------------------------------- load sources
def load_names():
    src = open(os.path.join(SRC, 'package/dist/src/generated/name-index.js'), encoding='utf8').read()
    arr = json.loads(re.search(r'COUNTRY_NAMES = (\[.*?\]);', src, re.S).group(1))
    return {c['cca3']: c for c in arr}

def topo_features(path):
    t = json.load(open(path))
    sx, sy = t['transform']['scale']; tx, ty = t['transform']['translate']
    arcs = []
    for arc in t['arcs']:
        x = y = 0; pts = []
        for dx, dy in arc:
            x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    def ring(idx):
        out = []
        for i in idx:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(a if not out else a[1:])
        return out
    feats = []
    for g in list(t['objects'].values())[0]['geometries']:
        if g['type'] == 'Polygon':
            geom = Polygon(ring(g['arcs'][0]), [ring(r) for r in g['arcs'][1:]])
        elif g['type'] == 'MultiPolygon':
            geom = MultiPolygon([Polygon(ring(p[0]), [ring(r) for r in p[1:]]) for p in g['arcs']])
        else:
            continue
        feats.append((g['properties'], clean(geom)))
    return feats

def load_units():
    units = []
    for f in sorted(glob.glob(os.path.join(SRC, 'package/dist/assets/adm1/*.json'))):
        d = json.load(open(f, encoding='utf8'))
        iso = d['adm0iso']
        if iso in DROP: continue
        for ft in d['features']:
            g = clean(shape(ft['geometry']))
            g = clean(g.intersection(box(-180, LAT_MIN, 180, LAT_MAX)))
            if g.is_empty: continue
            units.append({'keys': [ft['id']], 'name': ft['properties']['name'], 'iso': iso, 'geom': g})
    log('admin-1 units', len(units))
    return units

def fill_missing(units):
    """Countries absent from the admin-1 package (e.g. South Sudan) come from admin-0 50m."""
    have = {u['iso'] for u in units}
    tree = STRtree([u['geom'] for u in units])
    added = []
    for props, g in topo_features(os.path.join(SRC, 'countries-50m.json')):
        iso = props.get('isoA3') or props.get('adm0A3')
        if not iso or iso == '-99': iso = props.get('adm0A3')
        if iso in have or iso in DROP or g.is_empty: continue
        g = clean(g.intersection(box(-180, LAT_MIN, 180, LAT_MAX)))
        near = [units[i]['geom'] for i in tree.query(g)]
        if near:
            g = clean(g.difference(unary_union(near).buffer(0.002)))
        if km2(g) < 500: continue
        added.append({'keys': ['A0-' + iso], 'name': props.get('nameLong') or props['name'], 'iso': iso, 'geom': g, 'admin0': True})
        log('filled from admin-0:', iso, props['name'], int(km2(g)), 'km2')
    return units + added

# ---------------------------------------------------------------- merge / split
def neighbours(geoms, tol=0.01):
    tree = STRtree(geoms)
    nb = defaultdict(set)
    for i, g in enumerate(geoms):
        for j in tree.query(g.buffer(tol), predicate='intersects'):
            j = int(j)
            if j != i: nb[i].add(j); nb[j].add(i)
    return nb

def merge_country(us):
    total = sum(km2(u['geom']) for u in us)
    target = max(1, min(len(us), round(math.sqrt(total) / 38)))
    geoms = [u['geom'] for u in us]
    nb = neighbours(geoms)
    alive = {i: {'keys': list(u['keys']), 'name': u['name'], 'iso': u['iso'], 'geom': u['geom'],
                 'area': km2(u['geom']), 'big': km2(u['geom']), 'nb': set(nb[i])} for i, u in enumerate(us)}
    def join(a, b):
        A, B = alive[a], alive.pop(b)
        frozen.discard(a)
        A['keys'] += B['keys']; A['geom'] = clean(unary_union([A['geom'], B['geom']]))
        if B['big'] > A['big']: A['name'], A['big'] = B['name'], B['big']
        A['area'] += B['area']
        A['nb'] = (A['nb'] | B['nb']) - {a, b}
        for k in B['nb']:
            if k in alive:
                alive[k]['nb'].discard(b)
                if k != a: alive[k]['nb'].add(a)
    frozen = set()
    while len(alive) > 1:
        open_ = [k for k in alive if k not in frozen]
        if not open_: break
        i = min(open_, key=lambda k: alive[k]['area'])
        u = alive[i]
        if len(alive) <= target and u['area'] >= MIN_KM2: break
        cands = [k for k in u['nb'] if k in alive]
        if not cands:
            # isolated islet: attach to the nearest unit of the same country if close and tiny
            if u['area'] >= MIN_KM2: frozen.add(i); continue
            best = min((k for k in alive if k != i), key=lambda k: alive[k]['geom'].distance(u['geom']))
            if alive[best]['geom'].distance(u['geom']) > 1.5: frozen.add(i); continue
            cands = [best]
        j = min(cands, key=lambda k: alive[k]['area'])
        join(j, i) if alive[j]['area'] >= u['area'] else join(i, j)
    out = []
    for u in alive.values():
        out.append({'keys': u['keys'], 'name': u['name'], 'iso': u['iso'], 'geom': u['geom']})
    return out

DIRS = {(0, 1): 'North', (0, -1): 'South', (1, 0): 'East', (-1, 0): 'West', (1, 1): 'Northeast',
        (-1, 1): 'Northwest', (1, -1): 'Southeast', (-1, -1): 'Southwest', (0, 0): 'Central'}

def split_big(u):
    a = km2(u['geom'])
    if a <= SPLIT_KM2: return [u]
    k = math.ceil(a / (SPLIT_KM2 * 0.75))
    minx, miny, maxx, maxy = u['geom'].bounds
    cell = math.sqrt(u['geom'].area / k)
    nx, ny = max(1, round((maxx - minx) / cell)), max(1, round((maxy - miny) / cell))
    dx, dy = (maxx - minx) / nx, (maxy - miny) / ny
    pieces = []
    for ix in range(nx):
        for iy in range(ny):
            p = clean(u['geom'].intersection(box(minx + ix * dx, miny + iy * dy, minx + (ix + 1) * dx, miny + (iy + 1) * dy)))
            if not p.is_empty: pieces.append(p)
    # fold slivers into their largest touching piece
    avg = u['geom'].area / max(1, len(pieces))
    changed = True
    while changed:
        changed = False
        pieces.sort(key=lambda p: p.area)
        for i, p in enumerate(pieces):
            if p.area < avg * 0.3 and len(pieces) > 1:
                others = [q for q in pieces if q is not p]
                best = max(others, key=lambda q: q.buffer(0.01).intersection(p).area)
                if best.buffer(0.01).intersection(p).area == 0:
                    best = min(others, key=lambda q: q.distance(p))
                pieces.remove(best); pieces.remove(p); pieces.append(clean(unary_union([best, p]))); changed = True
                break
    if len(pieces) == 1: return [u]
    c = u['geom'].centroid; out = []
    used = defaultdict(int)
    for p in pieces:
        pc = p.centroid
        sx = 0 if abs(pc.x - c.x) < (maxx - minx) * 0.17 else (1 if pc.x > c.x else -1)
        sy = 0 if abs(pc.y - c.y) < (maxy - miny) * 0.17 else (1 if pc.y > c.y else -1)
        d = DIRS[(sx, sy)]; used[d] += 1
        nm = f"{u['name']} ({d}{'' if used[d] == 1 else ' ' + str(used[d])})"
        out.append({'keys': ['+'.join(sorted(u['keys'])) + '#' + str(len(out))], 'name': nm, 'iso': u['iso'], 'geom': p})
    return out

# ---------------------------------------------------------------- terrain estimate
# Coarse lon/lat boxes for the main physical regions. Transparent approximation:
# Natural Earth admin data carries no elevation or land-cover, so terrain is estimated from
# the province's label point. Order matters (first match wins).
TERRAIN_BOXES = [
    ('mountains', [(-10, 42, -5, 43.5), (5.5, 44, 16, 47.8), (19, 45, 26.5, 49.5), (38, 40, 49, 43.5), (69, 27, 97, 37), (79, 27, 103, 36),
                   (43, 30, 54, 38), (-80, -45, -65, -5), (-125, 35, -104, 60), (-8, 29.5, 1, 33.5), (56, 50, 61, 66), (36, 6, 41, 14),
                   (-118, 50, -110, 60), (100, 22, 104, 30), (-75, -5, -68, 10), (66, 35, 76, 40), (138, 35, 140, 37), (40, -9, 44, 0)]),
    ('desert', [(-17, 16, 33, 31), (33, 16, 60, 30), (60, 24, 72, 31), (35, 29, 40, 34), (52, 36, 66, 45), (75, 37, 92, 43),
                (93, 39, 115, 46), (12, -28, 26, -18), (115, -32, 142, -18), (-71, -28, -68, -18), (-117, 25, -104, 37), (44, 10, 52, 13)]),
    ('tundra', [(-180, 66, 180, 90), (-170, 58, -140, 66), (105, 58, 180, 66), (-100, 58, -60, 66)]),
    ('forest', [(-75, -12, -48, 5), (10, -6, 30, 5), (95, -8, 150, 6), (60, 56, 105, 66), (-130, 50, -60, 58), (22, 58, 32, 66)]),
    ('hills', [(-5, 36, 3, 43), (20, 37, 28, 43), (26, 36, 45, 41), (-85, 34, -77, 40), (8, 37, 16, 42), (125, 33, 136, 39), (34, 31, 37, 35)]),
]

def terrain_for(lon, lat):
    for name, boxes in TERRAIN_BOXES:
        for (x0, y0, x1, y1) in boxes:
            if x0 <= lon <= x1 and y0 <= lat <= y1: return name
    if abs(lat) < 12: return 'forest'
    return 'plains'

# ---------------------------------------------------------------- projection / encoding
YMAX = 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(LAT_MAX)))
YMIN = 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(LAT_MIN)))
SCALE = MAP_W / (2 * math.pi)
MAP_H = (YMAX - YMIN) * SCALE

def proj(lon, lat):
    y = 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(max(LAT_MIN, min(LAT_MAX, lat)))))
    return ((lon + 180) / 360 * MAP_W, (YMAX - y) * SCALE)

def enc_ring(coords):
    pts = [proj(x, y) for x, y in coords]
    q = [(round(x * QUANT), round(y * QUANT)) for x, y in pts]
    ded = [q[0]]
    for p in q[1:]:
        if p != ded[-1]: ded.append(p)
    if len(ded) > 1 and ded[0] == ded[-1]: ded.pop()
    if len(ded) < 3: return None
    out = [ded[0][0], ded[0][1]]
    for i in range(1, len(ded)):
        out += [ded[i][0] - ded[i - 1][0], ded[i][1] - ded[i - 1][1]]
    return out

def enc_geom(g, min_area=0.0):
    rings = []
    ps = polys(g)
    biggest = max(ps, key=lambda p: p.area) if ps else None
    for p in ps:
        if p is not biggest and p.area < min_area: continue
        for r in [p.exterior] + list(p.interiors):
            e = enc_ring(r.coords)
            if e: rings.append(e)
    return rings

def main():
    names = load_names()
    units = fill_missing(load_units())
    by_c = defaultdict(list)
    for u in units: by_c[u['iso']].append(u)
    provs = []
    for iso in sorted(by_c):
        merged = merge_country(by_c[iso])
        for m in merged: provs.extend(split_big(m))
    log('provinces after merge/split', len(provs))

    # name the province holding each national capital after the capital city
    import csv as _csv
    caps = [r for r in _csv.DictReader(l for l in open(os.path.join(ROOT, 'tools/country_table.csv'), encoding='utf8') if not l.startswith('#'))]
    from shapely.geometry import Point
    for r in caps:
        pt = Point(float(r['cap_lon']), float(r['cap_lat']))
        cands = [p for p in provs if p['iso'] == r['iso3']] or provs
        best = min(cands, key=lambda p: p['geom'].distance(pt))
        if best['geom'].distance(pt) < 1.0 and len(best['keys']) > 1 or best['geom'].contains(pt):
            best['name'] = r['capital']

    # stable ids
    reg_path = os.path.join(OUT, 'province_registry.json')
    reg = json.load(open(reg_path)) if os.path.exists(reg_path) else {'next': 0, 'ids': {}}
    for p in provs:
        p['key'] = '+'.join(sorted(p['keys']))
        if p['key'] not in reg['ids']:
            reg['ids'][p['key']] = reg['next']; reg['next'] += 1
        p['id'] = reg['ids'][p['key']]
    provs.sort(key=lambda p: p['id'])
    if len({p['id'] for p in provs}) != len(provs): raise SystemExit('duplicate province ids')

    # simplify as a coverage (shared borders stay shared), two LODs
    geoms = [p['geom'] for p in provs]
    fine = shapely.coverage_simplify(geoms, 0.012)
    coarse = shapely.coverage_simplify(geoms, 0.09)

    # adjacency
    nb = neighbours(geoms, 0.01)
    edges = {}
    for i in nb:
        for j in nb[i]:
            if i < j: edges[(i, j)] = 0
    land_union_nb = {}
    tree = STRtree(geoms)
    coastal = []
    for i, g in enumerate(geoms):
        others = [geoms[j] for j in nb[i]]
        free = g.boundary if not others else g.boundary.difference(unary_union(others).buffer(0.03))
        coastal.append(free.length > 0.08)
    for i, g in enumerate(geoms):
        if not coastal[i]: continue
        for j in tree.query(g.buffer(STRAIT_DEG), predicate='intersects'):
            j = int(j)
            if j == i or not coastal[j]: continue
            key = (min(i, j), max(i, j))
            if key in edges: continue
            if g.distance(geoms[j]) <= STRAIT_DEG: edges[key] = 1
    # keep only the nearest few strait links per province to avoid dense webs between islands
    strait_by = defaultdict(list)
    for (a, b), k in edges.items():
        if k == 1:
            d = geoms[a].distance(geoms[b]); strait_by[a].append((d, b)); strait_by[b].append((d, a))
    keep = set()
    for a, lst in strait_by.items():
        for d, b in sorted(lst)[:3]: keep.add((min(a, b), max(a, b)))
    edges = {e: k for e, k in edges.items() if k == 0 or e in keep}
    # sea lanes (kind 2): join every disconnected landmass to its nearest neighbour until the
    # graph is connected, so islands are reachable before naval transport exists
    parent = list(range(len(geoms)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for (a, b) in edges: parent[find(a)] = find(b)
    lanes = 0
    while True:
        comps = defaultdict(list)
        for i in range(len(geoms)): comps[find(i)].append(i)
        if len(comps) == 1: break
        big = max(comps, key=lambda r: len(comps[r]))
        for root, members in sorted(comps.items(), key=lambda kv: len(kv[1])):
            if root == big or find(root) != root: continue
            mem = set(members)
            best = None
            for i in members:
                for r in (1, 3, 8, 20, 60):
                    hits = [int(j) for j in tree.query(geoms[i].buffer(r)) if int(j) not in mem]
                    if hits: break
                for j in hits:
                    d = geoms[i].distance(geoms[j])
                    if best is None or d < best[0]: best = (d, i, j)
            if best:
                _, i, j = best
                edges[(min(i, j), max(i, j))] = 2; parent[find(i)] = find(j); lanes += 1
        if lanes > 2000: break
    log('sea lanes added', lanes)

    out_p = []
    for i, p in enumerate(provs):
        g = p['geom']
        big = max(polys(g), key=lambda q: q.area)
        try:
            lp = polylabel(big, tolerance=0.02)
        except Exception:
            lp = big.representative_point()
        x, y = proj(lp.x, lp.y)
        minx, miny, maxx, maxy = g.bounds
        bx0, by1 = proj(minx, miny); bx1, by0 = proj(maxx, maxy)
        out_p.append({
            'id': p['id'], 'key': p['key'], 'name': p['name'].replace('?', '').strip(' +') or p['iso'], 'iso': p['iso'],
            'lon': round(lp.x, 3), 'lat': round(lp.y, 3), 'x': round(x, 1), 'y': round(y, 1),
            'bbox': [round(bx0, 1), round(by0, 1), round(bx1, 1), round(by1, 1)],
            'area': round(km2(g)), 'coastal': coastal[i], 'terrain': terrain_for(lp.x, lp.y),
            'fine': enc_geom(fine[i]), 'coarse': enc_geom(coarse[i], 0.04),
        })
    # shared border polylines for land neighbours, per LOD, so the renderer can stroke
    # province and country borders without topology work at runtime
    from shapely.ops import linemerge
    def shared_lines(ga, gb):
        try:
            x = ga.boundary.intersection(gb.boundary)
        except Exception:
            return []
        ls = [g for g in getattr(x, 'geoms', [x]) if g.geom_type in ('LineString', 'MultiLineString')]
        if not ls: return []
        m = linemerge(unary_union(ls)) if len(ls) > 1 else ls[0]
        out = []
        for g in getattr(m, 'geoms', [m]):
            if g.geom_type != 'LineString' or len(g.coords) < 2: continue
            pts = [proj(x0, y0) for x0, y0 in g.coords]
            q = [(round(x0 * QUANT), round(y0 * QUANT)) for x0, y0 in pts]
            enc = [q[0][0], q[0][1]]
            for k2 in range(1, len(q)): enc += [q[k2][0] - q[k2 - 1][0], q[k2][1] - q[k2 - 1][1]]
            out.append(enc)
        return out
    borders = []
    for (a, b), k in sorted(edges.items()):
        if k != 0: continue
        lf = shared_lines(fine[a], fine[b])
        if not lf: continue
        lc = shared_lines(coarse[a], coarse[b])
        borders.append([provs[a]['id'], provs[b]['id'], lf, lc])
    log('border segments', len(borders))
    adj = []
    for (a, b), k in sorted(edges.items()):
        pa, pb = out_p[a], out_p[b]
        dist = math.hypot(pa['x'] - pb['x'], pa['y'] - pb['y'])
        adj += [provs[a]['id'], provs[b]['id'], k, round(dist, 1)]
    countries = {}
    for p in provs:
        n = names.get(p['iso'], {})
        countries[p['iso']] = {'iso': p['iso'], 'name': n.get('common', p['name'] if p['keys'][0].startswith('A0') else p['iso']),
                               'region': n.get('region', ''), 'subregion': n.get('subregion', ''), 'sovereign': n.get('sovereign', True)}
    world = {'version': 1, 'source': 'Natural Earth 1:10m admin-1 v5.1.2 (public domain), admin-0 1:50m for gaps',
             'projection': 'miller', 'width': MAP_W, 'height': round(MAP_H, 1), 'quant': QUANT,
             'latRange': [LAT_MIN, LAT_MAX], 'countries': sorted(countries.values(), key=lambda c: c['iso']),
             'provinces': out_p, 'adjacency': adj, 'borders': borders}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'world.json'), 'w', encoding='utf8') as f:
        json.dump(world, f, ensure_ascii=False, separators=(',', ':'))
    with open(reg_path, 'w') as f:
        json.dump(reg, f, indent=0, sort_keys=True)
    nstr = sum(1 for k in edges.values() if k >= 1)
    log(f'wrote {len(out_p)} provinces, {len(edges)} edges ({nstr} straits), {len(countries)} countries')

if __name__ == '__main__':
    main()
