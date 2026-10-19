"""Builds data/flags/: country flags as SVG files and data/flags/index.json, which says which
file each country tag uses in each scenario.

- Present-day flags come from flag-icons (https://github.com/lipis/flag-icons, MIT licence),
  4:3 versions, matched to the game's ISO 3166 alpha-3 tags with the code table of
  i18n-iso-countries (MIT).
- Historical flags (data/flags/hist/) are drawn here from simple geometry. Several are simplified:
  coats of arms and fine emblems are left out or reduced to shapes. HIST_NOTES says which.
- Tags with no entry (ancient states, which had no national flags, and the invented countries of
  the future scenarios) keep the game's stylised pattern flags.

Usage: python3 tools/build_flags.py <flag-icons package dir> <i18n-iso-countries package dir>
       (npm pack flag-icons i18n-iso-countries, then unpack each tarball)
"""
import json, os, re, sys, shutil

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'data', 'flags')
W, H = 640, 480


def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">{body}</svg>\n'


def hstripes(*cols, weights=None):
    weights = weights or [1] * len(cols)
    tot, y, out = sum(weights), 0, []
    for c, w in zip(cols, weights):
        h = H * w / tot
        out.append(f'<rect y="{y:.2f}" width="{W}" height="{h + 0.5:.2f}" fill="{c}"/>')
        y += h
    return ''.join(out)


def vstripes(*cols):
    w = W / len(cols)
    return ''.join(f'<rect x="{i * w:.2f}" width="{w + 0.5:.2f}" height="{H}" fill="{c}"/>' for i, c in enumerate(cols))


def star(cx, cy, r, fill, rot=-90, inner=0.382):
    import math
    pts = []
    for i in range(10):
        a = math.radians(rot + i * 36)
        rr = r if i % 2 == 0 else r * inner
        pts.append(f'{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}" fill="{fill}"/>'


def crescent(cx, cy, r, fill, bg, dx=0.28):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/><circle cx="{cx + r * dx}" cy="{cy}" r="{r * 0.8}" fill="{bg}"/>'


def hammer_sickle(x, y, s, fill):
    # simplified hammer and sickle in a 100-unit box at (x, y), scaled by s
    return (f'<g transform="translate({x} {y}) scale({s})" fill="none" stroke="{fill}" stroke-width="11" stroke-linecap="round">'
            f'<path d="M22 30 A38 38 0 1 0 78 72"/><path d="M28 78 L72 32" stroke-width="12"/>'
            f'<path d="M58 20 L82 44" stroke-width="16" stroke-linecap="butt"/></g>')


UNION = ('<path fill="#012169" d="M0 0h640v480H0z"/><path fill="#FFF" d="m75 0 244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0z"/>'
         '<path fill="#C8102E" d="m424 281 216 159v40L369 281zm-184 20 6 35L54 480H0zM640 0v3L391 191l2-44L590 0zM0 0l239 176h-60L0 42z"/>'
         '<path fill="#FFF" d="M241 0v480h160V0zM0 160v160h640V160z"/><path fill="#C8102E" d="M0 193v96h640v-96zM273 0v480h96V0z"/>')


def ensign(field):  # British-style ensign: Union Jack in the canton
    return f'<rect width="{W}" height="{H}" fill="{field}"/><g transform="scale(0.5)">{UNION}</g>'


def soviet(stripe=None):
    out = f'<rect width="{W}" height="{H}" fill="#cc0000"/>'
    if stripe:
        out += f'<rect y="{H * 2 / 3:.1f}" width="{W}" height="{H / 3:.1f}" fill="{stripe}"/>'
    out += hammer_sickle(40, 60, 1.25, '#ffd700') + f'<polygon points="95,22 101,40 120,40 105,51 111,69 95,58 79,69 85,51 70,40 89,40" fill="none" stroke="#ffd700" stroke-width="4"/>'
    return out


def elephant(fill):  # a white elephant facing the hoist, simplified
    return (f'<g fill="{fill}"><ellipse cx="350" cy="240" rx="120" ry="80"/><circle cx="230" cy="215" r="60"/>'
            '<path d="M185 225 q-35 60 -20 120 l25 -5 q-10 -50 25 -100z"/><path d="M245 170 q60 -10 70 60 q-30 30 -70 10z" opacity="0.85"/>'
            '<rect x="255" y="285" width="38" height="85"/><rect x="315" y="295" width="38" height="75"/>'
            '<rect x="380" y="295" width="38" height="75"/><rect x="430" y="285" width="38" height="85"/>'
            '<path d="M465 215 q40 20 30 80" stroke="' + fill + '" stroke-width="8" fill="none"/></g>')


def tibet():
    import math
    cx, cy = 320, 300
    rays = ''
    for i in range(12):
        a0, a1 = math.radians(180 + i * 15), math.radians(180 + (i + 1) * 15)
        pts = f'{cx},{cy} {cx + 900 * math.cos(a0):.0f},{cy + 900 * math.sin(a0):.0f} {cx + 900 * math.cos(a1):.0f},{cy + 900 * math.sin(a1):.0f}'
        rays += f'<polygon points="{pts}" fill="{"#d52b1e" if i % 2 == 0 else "#0b2c84"}"/>'
    return (f'<rect width="{W}" height="{H}" fill="#0b2c84"/>{rays}'
            '<polygon points="40,460 320,250 620,460" fill="#fff"/><circle cx="320" cy="245" r="55" fill="#ffd200"/>'
            '<path d="M14 14H640M14 14V466H640" stroke="#ffd200" stroke-width="28" fill="none"/>')


def mauritania_1959():
    return (f'<rect width="{W}" height="{H}" fill="#00a95c"/><circle cx="320" cy="250" r="140" fill="#ffd700"/>'
            '<circle cx="320" cy="190" r="140" fill="#00a95c"/>' + star(320, 190, 55, '#ffd700'))


HIST = {
    'german_empire': hstripes('#000', '#fff', '#dd0000'),
    'austria_hungary': f'<rect width="320" height="480" fill="#c8102e"/><rect y="160" width="320" height="160" fill="#fff"/>'
                       f'<rect x="320" width="320" height="160" fill="#c8102e"/><rect x="320" y="160" width="320" height="160" fill="#fff"/><rect x="320" y="320" width="320" height="160" fill="#477050"/>',
    'ottoman': f'<rect width="{W}" height="{H}" fill="#e30a17"/>' + crescent(270, 240, 120, '#fff', '#e30a17') + star(380, 240, 60, '#fff', rot=180),
    'soviet': soviet(),
    'ukrainian_ssr': soviet('#0099ff'),
    'belarusian_ssr': soviet('#4aa657'),
    'ssr_blue': soviet('#1e73be'),
    'ssr_green': soviet('#2e8b57'),
    'italy_kingdom': vstripes('#009246', '#fff', '#ce2b37') + '<path d="M270 150h100v110q0 60-50 80-50-20-50-80z" fill="#0f47af"/><path d="M280 160h80v100q0 48-40 66-40-18-40-66z" fill="#ce2b37"/><path d="M310 165h20v150h-20zM285 220h70v20h-70z" fill="#fff"/>',
    'china_beiyang': hstripes('#de2910', '#ffde00', '#3b5ba5', '#fff', '#000'),
    'persia': hstripes('#239f40', '#fff', '#da0000') + '<circle cx="320" cy="240" r="42" fill="#f2b632"/><path d="M262 285q58-30 116 0" stroke="#f2b632" stroke-width="10" fill="none"/>',
    'greece_cross': f'<rect width="{W}" height="{H}" fill="#0d5eaf"/><rect x="250" width="140" height="{H}" fill="#fff"/><rect y="170" width="{W}" height="140" fill="#fff"/>',
    'spain_plain': hstripes('#aa151b', '#f1bf00', '#aa151b', weights=[1, 2, 1]),
    'spain_republic': hstripes('#da121a', '#f1bf00', '#6c2c7c'),
    'yugoslavia_kingdom': hstripes('#003893', '#fff', '#de0000'),
    'yugoslavia_sfr': hstripes('#003893', '#fff', '#de0000') + star(320, 240, 120, '#f8d00f') + star(320, 240, 104, '#de0000'),
    'serbia_kingdom': hstripes('#c6363c', '#0c4076', '#fff'),
    'montenegro_kingdom': hstripes('#c6363c', '#0c4076', '#fff'),
    'manchukuo': f'<rect width="{W}" height="{H}" fill="#ffd700"/>' + ''.join(f'<rect y="{i * 40}" width="213" height="40" fill="{c}"/>' for i, c in enumerate(['#ff0000', '#0000ff', '#fff', '#000'])),
    'chinese_soviet': f'<rect width="{W}" height="{H}" fill="#cc0000"/>' + star(320, 240, 150, '#ffd700') + hammer_sickle(270, 190, 1.0, '#cc0000'),
    'oman_red': f'<rect width="{W}" height="{H}" fill="#c1272d"/>',
    'south_africa_1928': hstripes('#ff8200', '#fff', '#001489'),
    'red_ensign': ensign('#c8102e'),
    'east_germany': hstripes('#000', '#dd0000', '#ffce00') + '<circle cx="320" cy="240" r="95" fill="#ffce00" stroke="#dd0000" stroke-width="10"/><path d="M280 290 L360 190 M360 290 L280 190" stroke="#000" stroke-width="14"/>',
    'south_vietnam': f'<rect width="{W}" height="{H}" fill="#ffdd00"/>' + ''.join(f'<rect y="{y}" width="{W}" height="26" fill="#da251d"/>' for y in (171, 227, 283)),
    'burma_1948': f'<rect width="{W}" height="{H}" fill="#dd0000"/><rect width="320" height="240" fill="#00248f"/>' + star(160, 120, 70, '#fff') + ''.join(star(160 + 110 * __import__('math').cos(a), 120 + 90 * __import__('math').sin(a), 18, '#fff') for a in [i * 1.2566 for i in range(5)]),
    'upper_volta': hstripes('#000', '#fff', '#ce1126'),
    'sudan_1956': hstripes('#0033a0', '#ffd100', '#007a33'),
    'congo_leopoldville': f'<rect width="{W}" height="{H}" fill="#007fff"/>' + star(320, 240, 150, '#f7d618') + ''.join(star(55, 50 + i * 76, 26, '#f7d618') for i in range(6)),
    'katanga': '<polygon points="0,0 640,0 0,480" fill="#d21034"/><polygon points="640,0 640,480 0,480" fill="#007a3d"/><polygon points="560,0 640,0 80,480 0,480" fill="#fff"/>',
    'tanganyika': f'<rect width="{W}" height="{H}" fill="#1eb53a"/><rect y="180" width="{W}" height="120" fill="#fcd116"/><rect y="200" width="{W}" height="80" fill="#000"/>',
    'haiti_duvalier': vstripes('#000', '#d21034'),
    'uar': hstripes('#ce1126', '#fff', '#000') + star(240, 240, 52, '#007a3d') + star(400, 240, 52, '#007a3d'),
    'egypt_kingdom': f'<rect width="{W}" height="{H}" fill="#0c8a3e"/>' + crescent(300, 240, 120, '#fff', '#0c8a3e') + star(380, 175, 30, '#fff') + star(410, 240, 30, '#fff') + star(380, 305, 30, '#fff'),
    'egypt_khedivate': f'<rect width="{W}" height="{H}" fill="#c8102e"/>' + ''.join(crescent(cx, cy, 55, '#fff', '#c8102e') + star(cx + 45, cy, 18, '#fff') for cx, cy in ((200, 150), (440, 150), (320, 340))),
    'libya_kingdom': hstripes('#e70013', '#000', '#239e46', weights=[1, 2, 1]) + crescent(310, 240, 70, '#fff', '#000') + star(360, 240, 28, '#fff'),
    'iraq_1959': vstripes('#000', '#fff', '#007a3d') + star(320, 240, 100, '#ce1126', inner=0.6) + '<circle cx="320" cy="240" r="45" fill="#fcd116"/>',
    'iraq_kingdom': hstripes('#000', '#fff', '#007a3d') + '<polygon points="0,0 200,160 200,320 0,480" fill="#ce1126"/>' + star(70, 200, 22, '#fff') + star(70, 280, 22, '#fff'),
    'ethiopia_tricolour': hstripes('#078930', '#fcdd09', '#da121a'),
    'yemen_kingdom': f'<rect width="{W}" height="{H}" fill="#ce1126"/>' + ''.join(star(x, y, 30, '#fff') for x, y in ((200, 120), (320, 90), (440, 120), (250, 380), (390, 380))) + '<path d="M180 250h280" stroke="#fff" stroke-width="20"/>',
    'tuva_1930s': hstripes('#0f47af', '#fff', '#ffd100'),
    'siam_elephant': f'<rect width="{W}" height="{H}" fill="#c8102e"/>' + elephant('#fff'),
    'laos_kingdom': f'<rect width="{W}" height="{H}" fill="#ce1126"/>' + elephant('#fff') + '<rect x="200" y="380" width="300" height="24" fill="#fff"/>',
    'tibet': tibet(),
    'bogd_khanate': f'<rect width="{W}" height="{H}" fill="#f6c200"/><g fill="#c4272f"><path d="M320 70 l20 45 h-40z"/><circle cx="320" cy="150" r="28"/>'
                    '<path d="M285 185 a35 25 0 0 0 70 0z"/><rect x="270" y="215" width="100" height="18"/><rect x="270" y="250" width="100" height="18"/>'
                    '<rect x="240" y="215" width="20" height="200"/><rect x="380" y="215" width="20" height="200"/><circle cx="320" cy="330" r="40"/>'
                    '<rect x="270" y="390" width="100" height="18"/></g>',
    'nejd': f'<rect width="{W}" height="{H}" fill="#006c35"/><rect width="110" height="{H}" fill="#fff"/>'
            '<rect x="200" y="170" width="360" height="40" fill="#fff"/><path d="M200 300h330l30 15-30 15H200z" fill="#fff"/><rect x="170" y="290" width="30" height="50" fill="#fff"/>',
    'afghanistan_emirate': f'<rect width="{W}" height="{H}" fill="#000"/><circle cx="320" cy="240" r="130" fill="none" stroke="#fff" stroke-width="16"/>'
                           '<path d="M240 300h160v-60l-40-40h-80l-40 40z" fill="#fff"/>',
    'rhodesia_nyasaland': ensign('#012169') + '<path d="M440 150h120v120q0 70-60 100-60-30-60-100z" fill="#fff"/><path d="M455 165h90v105q0 55-45 80-45-25-45-80z" fill="#000"/>'
                          '<path d="M455 180q22 20 45 0t45 0" stroke="#fff" stroke-width="10" fill="none"/>',
    'sikkim': f'<rect width="{W}" height="{H}" fill="#fff"/><rect x="18" y="18" width="604" height="444" fill="none" stroke="#d52b1e" stroke-width="36"/>'
              '<circle cx="320" cy="240" r="110" fill="none" stroke="#ffd200" stroke-width="22"/>'
              + ''.join(f'<line x1="320" y1="240" x2="{320 + 110 * __import__("math").cos(a):.0f}" y2="{240 + 110 * __import__("math").sin(a):.0f}" stroke="#ffd200" stroke-width="14"/>' for a in [i * 0.7854 for i in range(8)])
              + '<circle cx="320" cy="240" r="30" fill="#d52b1e"/>',
    'mauritania_1959': mauritania_1959(),
    'cameroon_1961': vstripes('#007a5e', '#ce1126', '#fcd116') + star(107, 130, 40, '#fcd116') + star(107, 230, 40, '#fcd116'),
    'rome_vexillum': f'<rect width="{W}" height="{H}" fill="#8b0000"/><rect x="20" y="20" width="600" height="440" fill="none" stroke="#d4af37" stroke-width="14"/>'
                     '<text x="320" y="290" font-family="Georgia, \'Times New Roman\', serif" font-size="170" font-weight="bold" fill="#d4af37" text-anchor="middle">SPQR</text>',
}

HIST_NOTES = {
    'italy_kingdom': 'Savoy shield simplified, crown left out',
    'persia': 'lion and sun reduced to a sun and a stroke',
    'soviet': 'hammer and sickle simplified',
    'ukrainian_ssr': 'simplified', 'belarusian_ssr': 'ornament left out', 'ssr_blue': 'stand-in for the other Soviet republics',
    'ssr_green': 'stand-in for the other Soviet republics',
    'austria_hungary': 'civil ensign without the arms',
    'spain_plain': 'arms left out', 'south_africa_1928': 'the small flags in the centre left out',
    'east_germany': 'emblem reduced to a ring and crossed lines', 'chinese_soviet': 'approximation',
    'burma_1948': 'simplified', 'katanga': 'crosses left out', 'iraq_1959': 'simplified',
    'yemen_kingdom': 'sword reduced to a bar', 'egypt_khedivate': 'approximation', 'rome_vexillum': 'a modern convention; Rome had no national flag',
    'tuva_1930s': 'approximation', 'red_ensign': 'badge left out',
    'siam_elephant': 'elephant drawn as a simple silhouette', 'laos_kingdom': 'three-headed elephant, parasol and steps drawn as one elephant and a step',
    'tibet': 'snow lions and jewels left out', 'bogd_khanate': 'approximation; the Soyombo symbol is simplified',
    'nejd': 'approximation; the creed is drawn as a bar', 'afghanistan_emirate': 'seal simplified',
    'rhodesia_nyasaland': 'arms reduced to a shield', 'sikkim': 'approximation, after the 1967 flag',
}

ROME_TAGS = [c['tag'] for c in json.load(open(os.path.join(ROOT, 'data', 'scenarios', 'height_of_rome_117.json')))['countries']]

# Per-scenario choices; anything not listed uses the present-day flag of its tag if there is one.
SCENARIO = {
    # states of the year 117 had no national flags: every country but Rome keeps its pattern flag
    'height_of_rome_117': {**{t: None for t in ROME_TAGS}, 'ROM': 'hist/rome_vexillum'},
    'great_war_1914': {
        'GER': 'hist/german_empire', 'AUH': 'hist/austria_hungary', 'OTT': 'hist/ottoman', 'ITA': 'hist/italy_kingdom',
        'CHN': 'hist/china_beiyang', 'PER': 'hist/persia', 'GRE': 'hist/greece_cross', 'SPA': 'hist/spain_plain',
        'SRB': 'hist/serbia_kingdom', 'MNT': 'hist/montenegro_kingdom', 'YUG': 'hist/yugoslavia_kingdom', 'CAN': 'hist/red_ensign',
        'SAF': 'hist/red_ensign', 'EGY': 'hist/egypt_khedivate', 'ETH': 'hist/ethiopia_tricolour', 'OMA': 'hist/oman_red',
        'ROM': 'ro', 'PAR': 'py', 'NET': 'nl', 'JAP': 'jp', 'BUL': 'bg', 'POR': 'pt', 'DEN': 'dk', 'SWI': 'ch', 'NEP': 'np',
        'BHU': 'bt', 'AST': 'au', 'GUA': 'gt', 'HON': 'hn', 'SAL': 'sv', 'COS': 'cr', 'HAI': 'ht', 'PRU': 'pe', 'LAT': 'lv',
        'LIT': 'lt', 'CZS': 'cz', 'SIA': 'hist/siam_elephant', 'TIB': 'hist/tibet', 'MON': 'hist/bogd_khanate',
        'NAJ': 'hist/nejd', 'AFG': 'hist/afghanistan_emirate',
        # no reliable source for the flags of Jabal Shammar and Asir: pattern flags
        'SHR': None, 'ASR': None,
    },
    'gathering_storm_1936': {
        # the German Reich's national flag from 1935 is left out on purpose; the black-white-red
        # tricolour (co-official 1933-35) stands in for it
        'GER': 'hist/german_empire', 'SOV': 'hist/soviet', 'CHI': 'tw', 'MAN': 'hist/manchukuo', 'PRC': 'hist/chinese_soviet',
        'ITA': 'hist/italy_kingdom', 'PER': 'hist/persia', 'GRE': 'hist/greece_cross', 'SPA': 'hist/spain_republic',
        'YUG': 'hist/yugoslavia_kingdom', 'EGY': 'hist/egypt_kingdom', 'IRQ': 'hist/iraq_kingdom', 'ETH': 'hist/ethiopia_tricolour',
        'OMA': 'hist/oman_red', 'SAF': 'hist/south_africa_1928', 'YEM': 'hist/yemen_kingdom', 'TUV': 'hist/tuva_1930s',
        'CAN': 'hist/red_ensign', 'MON': 'mn', 'JAP': 'jp', 'CZS': 'cz', 'ROM': 'ro', 'BUL': 'bg', 'POR': 'pt', 'NET': 'nl',
        'SWI': 'ch', 'DEN': 'dk', 'ICE': 'is', 'LAT': 'lv', 'LIT': 'lt', 'IRE': 'ie', 'NEP': 'np', 'BHU': 'bt', 'SIA': 'th',
        'AST': 'au', 'GUA': 'gt', 'HON': 'hn', 'SAL': 'sv', 'COS': 'cr', 'HAI': 'ht', 'PRU': 'pe', 'PAR': 'py',
        'TIB': 'hist/tibet',
    },
    'cold_war_1962': {
        'SOV': 'hist/soviet', 'UKR': 'hist/ukrainian_ssr', 'BLR': 'hist/belarusian_ssr',
        **{t: 'hist/ssr_blue' for t in ('EST', 'LAT', 'LIT', 'KAZ', 'KGZ', 'TJK', 'MDA')},
        **{t: 'hist/ssr_green' for t in ('ARM', 'AZE', 'GEO', 'TKM', 'UZB')},
        'DDR': 'hist/east_germany', 'BRD': 'de', 'SVM': 'hist/south_vietnam', 'NVM': 'vn', 'BUR': 'hist/burma_1948',
        'UPV': 'hist/upper_volta', 'SUD': 'hist/sudan_1956', 'CGL': 'hist/congo_leopoldville', 'KAT': 'hist/katanga',
        'TAN': 'hist/tanganyika', 'HAI': 'hist/haiti_duvalier', 'EGY': 'hist/uar', 'LBY': 'hist/libya_kingdom',
        'IRQ': 'hist/iraq_1959', 'IRN': 'hist/persia', 'ETH': 'hist/ethiopia_tricolour', 'YUG': 'hist/yugoslavia_sfr',
        'GRE': 'hist/greece_cross', 'SPA': 'hist/spain_plain', 'OMA': 'hist/oman_red', 'SAF': 'hist/south_africa_1928',
        'CAN': 'hist/red_ensign', 'ALG': 'dz', 'NET': 'nl', 'DEN': 'dk', 'POR': 'pt', 'ANG': 'ao', 'CZS': 'cz', 'ROM': 'ro',
        'BUL': 'bg', 'IRE': 'ie', 'SWI': 'ch', 'TAI': 'tw', 'MON': 'mn', 'JAP': 'jp', 'BAN': 'bd', 'CEY': 'lk', 'BHU': 'bt',
        'CAM': 'kh', 'MAL': 'my', 'PHI': 'ph', 'LEB': 'lb', 'KUW': 'kw', 'MOR': 'ma', 'NGR': 'ne', 'GUI': 'gn', 'TOG': 'tg',
        'DAH': 'bj', 'CHA': 'td', 'CAR': 'cf', 'CGB': 'cg', 'MAD': 'mg', 'GUA': 'gt', 'HON': 'hn', 'SAL': 'sv', 'PAR': 'py',
        'URU': 'uy', 'AST': 'au', 'LAO': 'hist/laos_kingdom', 'RHO': 'hist/rhodesia_nyasaland', 'SKM': 'hist/sikkim',
        'YEM': 'hist/yemen_kingdom', 'MRT': 'hist/mauritania_1959', 'CMR': 'hist/cameroon_1961',
    },
    'flashpoint_2035': {'GRL': 'gl'},
    # the unions of 2085 are invented: they keep their pattern flags
    'orbital_age_2085': {'GRL': 'gl', 'EUF': 'eu', 'SAM': None, 'EAF': None, 'WAF': None, 'ARU': None},
}


def main(fi_dir, iso_dir):
    codes = json.load(open(os.path.join(iso_dir, 'codes.json')))
    a3 = {c[1]: c[0].lower() for c in codes}
    src = os.path.join(fi_dir, 'flags', '4x3')
    modern = [c['tag'] for c in json.load(open(os.path.join(ROOT, 'data', 'scenarios', 'modern_2026.json')))['countries']]
    default = {t: a3[t] for t in modern if a3.get(t) and os.path.exists(os.path.join(src, a3[t] + '.svg'))}
    missing = [t for t in modern if t not in default]
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'hist'))
    needed = set(default.values()) | {v for m in SCENARIO.values() for v in m.values() if v and not v.startswith('hist/')}
    for code in sorted(needed):
        s = open(os.path.join(src, code + '.svg')).read()
        s = re.sub(r'\s*\n\s*', '', s).replace(f' id="flag-icons-{code}"', '')
        open(os.path.join(OUT, code + '.svg'), 'w').write(s + '\n')
    for name, body in HIST.items():
        open(os.path.join(OUT, 'hist', name + '.svg'), 'w').write(svg(body))
    shutil.copy(os.path.join(fi_dir, 'LICENSE'), os.path.join(OUT, 'LICENSE-flag-icons.txt'))
    index = {
        '_doc': 'Flag file (under data/flags/, without .svg) for each country tag. "default" applies in every scenario; '
                'a scenario entry overrides it, and null keeps the stylised pattern flag. Present-day flags: flag-icons (MIT, '
                'LICENSE-flag-icons.txt). hist/ flags: drawn by tools/build_flags.py, some simplified (see "notes").',
        'default': default,
        'scenarios': SCENARIO,
        'notes': HIST_NOTES,
    }
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1, sort_keys=False)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f'{len(needed)} present-day flags, {len(HIST)} historical, {size // 1024} KB; tags without a flag file: {missing}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
