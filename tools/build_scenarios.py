#!/usr/bin/env python3
"""Builds scenario files from data/map/world.json and tools/country_table.csv.

Currently generates: data/scenarios/modern_2026.json ("Modern World").
Per-province population and development are estimates: each country's population/GDP is
spread over its provinces by area, terrain, coast and capital weights. This is a documented
approximation, not census data.
"""
import csv, json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'scenarios')

DEPENDENCY_OF = {
    'ABW': 'NLD', 'CUW': 'NLD', 'SXM': 'NLD',
    'AIA': 'GBR', 'BMU': 'GBR', 'CYM': 'GBR', 'FLK': 'GBR', 'GGY': 'GBR', 'GIB': 'GBR', 'IMN': 'GBR',
    'JEY': 'GBR', 'MSR': 'GBR', 'SHN': 'GBR', 'TCA': 'GBR', 'VGB': 'GBR',
    'ASM': 'USA', 'GUM': 'USA', 'MNP': 'USA', 'PRI': 'USA', 'VIR': 'USA',
    'BLM': 'FRA', 'MAF': 'FRA', 'NCL': 'FRA', 'PYF': 'FRA', 'SPM': 'FRA', 'WLF': 'FRA',
    'COK': 'NZL', 'NIU': 'NZL', 'FRO': 'DNK', 'GRL': 'DNK', 'HKG': 'CHN', 'MAC': 'CHN',
    'NFK': 'AUS', 'ALA': 'FIN', 'KAS': 'IND', 'ESH': 'MAR',
}
# Real flags reduced to simple patterns (h = horizontal bands, v = vertical, cross = Nordic
# cross, disc = centred disc). Countries not listed get a procedural flag.
FLAGS = {
    'FRA': ('v', ['#0055a4', '#ffffff', '#ef4135']), 'ITA': ('v', ['#009246', '#ffffff', '#ce2b37']),
    'IRL': ('v', ['#169b62', '#ffffff', '#ff883e']), 'BEL': ('v', ['#000000', '#fae042', '#ed2939']),
    'MEX': ('v', ['#006847', '#ffffff', '#ce1126']), 'PER': ('v', ['#d91023', '#ffffff', '#d91023']),
    'NGA': ('v', ['#008751', '#ffffff', '#008751']), 'CAN': ('v', ['#d52b1e', '#ffffff', '#d52b1e']),
    'ROU': ('v', ['#002b7f', '#fcd116', '#ce1126']), 'TCD': ('v', ['#002664', '#fecb00', '#c60c30']),
    'MLI': ('v', ['#14b53a', '#fcd116', '#ce1126']), 'GIN': ('v', ['#ce1126', '#fcd116', '#009460']),
    'CIV': ('v', ['#f77f00', '#ffffff', '#009e60']), 'DEU': ('h', ['#000000', '#dd0000', '#ffce00']),
    'RUS': ('h', ['#ffffff', '#0039a6', '#d52b1e']), 'NLD': ('h', ['#ae1c28', '#ffffff', '#21468b']),
    'AUT': ('h', ['#ed2939', '#ffffff', '#ed2939']), 'HUN': ('h', ['#cd2a3e', '#ffffff', '#436f4d']),
    'BGR': ('h', ['#ffffff', '#00966e', '#d62612']), 'LTU': ('h', ['#fdb913', '#006a44', '#c1272d']),
    'EST': ('h', ['#0072ce', '#000000', '#ffffff']), 'ARM': ('h', ['#d90012', '#0033a0', '#f2a800']),
    'YEM': ('h', ['#ce1126', '#ffffff', '#000000']), 'EGY': ('h', ['#ce1126', '#ffffff', '#000000']),
    'IND': ('h', ['#ff9933', '#ffffff', '#138808']), 'COL': ('h', ['#fcd116', '#003893', '#ce1126']),
    'GAB': ('h', ['#009e60', '#fcd116', '#3a75c4']), 'SLE': ('h', ['#1eb53a', '#ffffff', '#0072c6']),
    'LUX': ('h', ['#ed2939', '#ffffff', '#00a1de']), 'IRN': ('h', ['#239f40', '#ffffff', '#da0000']),
    'POL': ('h', ['#ffffff', '#dc143c']), 'UKR': ('h', ['#0057b7', '#ffd700']), 'IDN': ('h', ['#ff0000', '#ffffff']),
    'MCO': ('h', ['#ce1126', '#ffffff']), 'JPN': ('disc', ['#ffffff', '#bc002d']), 'BGD': ('disc', ['#006a4e', '#f42a41']),
    'PLW': ('disc', ['#4aadd6', '#ffde00']), 'SWE': ('cross', ['#006aa7', '#fecc00']), 'DNK': ('cross', ['#c8102e', '#ffffff']),
    'FIN': ('cross', ['#ffffff', '#002f6c']), 'NOR': ('cross', ['#ba0c2f', '#ffffff', '#00205b']),
    'ISL': ('cross', ['#02529c', '#ffffff', '#dc1e35']), 'CHN': ('h', ['#de2910', '#de2910']),
    'USA': ('h', ['#b22234', '#ffffff', '#b22234', '#ffffff', '#3c3b6e']), 'GBR': ('cross', ['#012169', '#ffffff', '#c8102e']),
    'TUR': ('disc', ['#e30a17', '#ffffff']), 'BRA': ('disc', ['#009c3b', '#ffdf00']), 'ARG': ('h', ['#74acdf', '#ffffff', '#74acdf']),
    'ESP': ('h', ['#aa151b', '#f1bf00', '#aa151b']), 'PRT': ('v', ['#006600', '#ff0000', '#ff0000']),
    'KOR': ('disc', ['#ffffff', '#cd2e3a']), 'SAU': ('h', ['#006c35', '#006c35']), 'AUS': ('h', ['#00008b', '#00008b']),
    'ISR': ('h', ['#ffffff', '#0038b8', '#ffffff']), 'GRC': ('h', ['#0d5eaf', '#ffffff', '#0d5eaf', '#ffffff', '#0d5eaf']),
    'CHE': ('cross', ['#da291c', '#ffffff']),
}
COLORS = {  # restrained, map-friendly colours for major powers
    'USA': '#4f74b8', 'CAN': '#b8565a', 'MEX': '#5c9a6a', 'BRA': '#6aa35c', 'ARG': '#8fb8d8',
    'GBR': '#c0505a', 'FRA': '#4a68c4', 'DEU': '#6b6b6b', 'ITA': '#5fa86b', 'ESP': '#d4b44a',
    'RUS': '#3f7d5a', 'CHN': '#c4a43c', 'IND': '#d98a3d', 'JPN': '#d9d0c3', 'AUS': '#5b8fa8',
    'TUR': '#b8735a', 'IRN': '#6fa88a', 'SAU': '#a8b860', 'EGY': '#d6c48a', 'POL': '#c46a7a',
    'UKR': '#d8c75a', 'KOR': '#7a8fc4', 'IDN': '#b05a4f', 'PAK': '#4f8a5a', 'NGA': '#6a9f5c',
    'ZAF': '#c49a5a', 'SWE': '#5a86c4', 'NOR': '#a85a5a', 'FIN': '#e0e0e8', 'KAZ': '#7ab8c4',
}
PALETTE = ['#8a6fb0', '#c48f6a', '#6ab0a4', '#b0a86a', '#a86a8f', '#6a8fb0', '#b07a5a', '#7ab06a',
           '#c4c46a', '#6ac4a4', '#9a8ac4', '#c46a6a', '#5aa0c4', '#a4c46a', '#c49ac4', '#8ac4c4',
           '#d4a46a', '#7a9a6a', '#b0b0d4', '#d48a8a', '#6a7ab0', '#a8805a', '#8ab08a', '#c4a4a4',
           '#5a9a8a', '#b4c48a', '#9a6a6a', '#6a6a9a', '#d4c49a', '#8ad4a4', '#a46ab4', '#c4b45a']
AGGRESSION = {'republic': 0.25, 'federal_republic': 0.12, 'parliamentary': 0.05, 'const_monarchy': 0.08,
              'abs_monarchy': 0.3, 'one_party': 0.45, 'military': 0.6, 'theocracy': 0.5}
MILITARISATION = {'RUS': 3.2, 'PRK': 4, 'ISR': 2.6, 'IRN': 1.8, 'TUR': 1.6, 'PAK': 1.6, 'KOR': 1.7, 'SAU': 1.3,
                  'EGY': 1.4, 'UKR': 2.6, 'USA': 0.85, 'CHN': 1.05, 'IND': 1.0, 'VNM': 1.5, 'SYR': 1.8,
                  'TWN': 1.6, 'ARM': 1.6, 'AZE': 1.6, 'ERI': 2.0, 'CUB': 1.4, 'MMR': 1.5, 'DZA': 1.4, 'GRC': 1.4}
NATO = 'USA CAN GBR FRA DEU ITA ESP PRT NLD BEL LUX DNK NOR ISL TUR GRC POL CZE SVK HUN ROU BGR HRV SVN ALB MNE MKD EST LVA LTU FIN SWE'.split()
CSTO = 'RUS BLR KAZ KGZ TJK'.split()
TERRAIN_POP = {'plains': 1.0, 'hills': 0.8, 'mountains': 0.45, 'forest': 0.55, 'desert': 0.12, 'tundra': 0.06}
DEV_BASE, DEV_GROWTH = 400, 1.06

def prod(dev):
    return DEV_BASE * DEV_GROWTH ** dev

def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

def main():
    world = json.load(open(os.path.join(ROOT, 'data/map/world.json'), encoding='utf8'))
    rows = {r['iso3']: r for r in csv.DictReader(l for l in open(os.path.join(ROOT, 'tools/country_table.csv'), encoding='utf8') if not l.startswith('#'))}
    names = {c['iso']: c['name'] for c in world['countries']}
    provs = world['provinces']
    owner_of = {p['id']: DEPENDENCY_OF.get(p['iso'], p['iso']) for p in provs}
    tags = sorted(set(owner_of.values()))
    by_tag = {t: [p for p in provs if owner_of[p['id']] == t] for t in tags}

    # neighbouring countries (for colouring)
    adj = world['adjacency']; nb = {t: set() for t in tags}
    for k in range(0, len(adj), 4):
        a, b = owner_of[adj[k]], owner_of[adj[k + 1]]
        if a != b: nb[a].add(b); nb[b].add(a)
    colors = dict((t, c) for t, c in COLORS.items() if t in by_tag)
    for t in sorted(tags, key=lambda t: -len(nb[t])):
        if t in colors: continue
        def score(c):
            rgb = hexrgb(c)
            ds = [sum((x - y) ** 2 for x, y in zip(rgb, hexrgb(colors[n]))) for n in nb[t] if n in colors]
            return min(ds) if ds else 1e9
        best = max(PALETTE, key=lambda c: (score(c), -abs(hash(t + c)) % 97))
        colors[t] = best

    countries, prov_out, armies = [], {}, []
    for t in tags:
        ps = by_tag[t]
        r = rows.get(t)
        area = sum(p['area'] for p in ps)
        pop = float(r['pop_m']) * 1e6 if r else max(20000, area * 25)
        gdp = float(r['gdp_b']) * 1e9 if r else pop * 6000
        gov = r['gov'] if r else ('republic' if area > 3000 else 'parliamentary')
        # capital = province nearest to the listed capital coordinates
        if r:
            clat, clon = float(r['cap_lat']), float(r['cap_lon'])
            cap = min(ps, key=lambda p: (p['lat'] - clat) ** 2 + ((p['lon'] - clon) * math.cos(math.radians(clat))) ** 2)
        else:
            cap = max(ps, key=lambda p: p['area'])
        w = {}
        for p in ps:
            w[p['id']] = (p['area'] ** 0.5) * TERRAIN_POP[p['terrain']] * (1.35 if p['coastal'] else 1) * (4 if p is cap else 1) + 1
        tw = sum(w.values())
        if len(ps) > 3 and w[cap['id']] < 0.07 * tw:  # capitals are major population centres
            tw += 0.07 * tw - w[cap['id']]; w[cap['id']] = 0.07 * (tw - w[cap['id']]) / 0.93
            tw = sum(w.values())
        pc_dev = math.log(max(450, gdp / pop) / DEV_BASE) / math.log(DEV_GROWTH)
        devs = {}
        for p in ps:
            d = pc_dev + (6 if p is cap else 0) + (2 if p['coastal'] else 0) - {'desert': 4, 'tundra': 4, 'mountains': 2}.get(p['terrain'], 0)
            devs[p['id']] = d
        pops = {i: pop * w[i] / tw for i in w}
        actual = sum(pops[i] * prod(devs[i]) for i in pops)
        shift = math.log(gdp / actual) / math.log(DEV_GROWTH)
        for p in ps:
            i = p['id']
            dev = max(1.0, min(100.0, devs[i] + shift))
            fort = 3 if p is cap else (1 if p['terrain'] == 'mountains' else 0)
            prov_out[i] = [t, round(pops[i]), round(dev, 2), fort]
        pat, cols = FLAGS.get(t, (None, None))
        if not pat:
            h = sum(ord(ch) * (k + 1) for k, ch in enumerate(t))
            pat = ['h', 'v', 'disc', 'cross'][h % 4]
            cols = [colors[t], ['#ffffff', '#1a1a1a', '#e8c547', '#2e6b3a'][h // 4 % 4], PALETTE[h % len(PALETTE)]]
        countries.append({
            'tag': t, 'name': names.get(t, t), 'color': colors[t], 'gov': gov, 'capital': cap['id'],
            'aggression': AGGRESSION.get(gov, 0.3), 'flag': {'pattern': pat, 'colors': cols},
            'stability': 65 if gov in ('parliamentary', 'const_monarchy') else 55,
        })
        # starting forces
        gb = gdp / 1e9; pm = pop / 1e6
        div = round((math.sqrt(gb) * 0.25 + pm * 0.015) * MILITARISATION.get(t, 1.0))
        div = max(1 if pm >= 0.5 else 0, min(45, div))
        if div:
            arm = round(div * (0.2 if pc_dev > 45 else 0.08)); art = round(div * 0.2); inf = max(1, div - arm - art)
            sites = [cap] + sorted([p for p in ps if p is not cap], key=lambda p: -pops[p['id']])
            stacks = max(1, min(len(sites), math.ceil(div / 6)))
            for s in range(stacks):
                part = lambda n: n // stacks + (1 if s < n % stacks else 0)
                u = {'infantry': part(inf), 'artillery': part(art), 'armor': part(arm)}
                if sum(u.values()): armies.append({'owner': t, 'province': sites[s]['id'], 'units': u})
    scen = {
        'id': 'modern_2026', 'name': 'Modern World', 'era': 'modern', 'startDate': '2026-01-01',
        'description': 'The world of the mid-2020s with present-day borders (Natural Earth, UN boundary view). '
                       'Every recognised state and Taiwan is playable; overseas dependencies belong to their sovereign states.',
        'approximations': 'Population and GDP per country are rounded c. 2025 estimates; their spread across provinces, '
                          'terrain, and starting armies are model estimates. No wars are active at start.',
        'autoBudget': True,
        'countries': countries,
        'provinces': {str(k): v for k, v in sorted(prov_out.items())},
        'alliances': [{'name': 'NATO', 'members': [m for m in NATO if m in by_tag]},
                      {'name': 'CSTO', 'members': [m for m in CSTO if m in by_tag]}],
        'armies': armies,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'modern_2026.json'), 'w', encoding='utf8') as f:
        json.dump(scen, f, ensure_ascii=False, separators=(',', ':'))
    index = {'scenarios': [{'id': scen['id'], 'file': 'modern_2026.json', 'name': scen['name'], 'era': scen['era'],
                            'startDate': scen['startDate'], 'description': scen['description'], 'approximations': scen['approximations']}]}
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f'modern_2026: {len(countries)} countries, {len(prov_out)} provinces, {len(armies)} armies')

if __name__ == '__main__':
    main()
