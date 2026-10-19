// Map modes: each returns a fill colour per province from current game state. Only modes
// backed by real simulation data are offered.
import { TERRAINS } from '../core/mapdata.js';
import { atWar, allied, friendly } from '../core/relations.js';
import { provinceGdp } from '../core/state.js';
import { opinion, overlordOf } from '../core/diplomacy.js';
import { zoneController, seaPresence } from '../core/naval.js';
import { supplyView, SUPPLY_LEVEL } from '../core/supply.js';

export const MAP_MODES = [
  { id: 'political', name: 'Political', key: 'p', tip: 'Country ownership. Stripes mark provinces occupied by another country.' },
  { id: 'terrain', name: 'Terrain', key: 't', tip: 'Estimated terrain type, which affects movement, combat width and defence.' },
  { id: 'population', name: 'Population', key: 'o', tip: 'Population density (people per km²), log scale.' },
  { id: 'development', name: 'Development', key: 'v', tip: 'Development index 0–100: drives productivity per person and infrastructure speed.' },
  { id: 'economy', name: 'Economy', key: 'g', tip: 'Annual provincial GDP (log scale).' },
  { id: 'resources', name: 'Resources', key: 'x', tip: 'Largest natural-resource deposit in each province (brighter = larger).' },
  { id: 'industry', name: 'Industry', key: 'k', tip: 'Industrial value added per year (log scale): farms, mines, power and factories.' },
  { id: 'infrastructure', name: 'Infrastructure', key: 'f', tip: 'Infrastructure level 0–10: building efficiency and movement speed.' },
  { id: 'military', name: 'Military', key: 'r', tip: 'Fronts: your side, enemies, and provinces under siege.' },
  { id: 'diplomacy', name: 'Diplomacy', key: 'y', tip: 'Opinion of each country toward the selected (or your) country, red to green; allies blue, enemies dark red, subjects purple.' },
  { id: 'technology', name: 'Technology', key: 'q', tip: 'Each country\'s era (from its known technologies); lighter = more technologies within that era.' },
  { id: 'naval', name: 'Naval', key: 's', tip: 'Sea control: who holds each sea zone with fleets at sea (yours, allies, enemies, others); contested zones are amber.' },
  { id: 'supply', name: 'Supply', key: 'w', tip: 'Supply level for your armies in each province (refreshed every few days). Below the attrition line armies lose men.' },
  { id: 'government', name: 'Government', key: 'j', tip: 'Form of government: democracies, autocracies, theocracies and military rule; darker = lower stability.' },
];

// Colours with a meaning (own side, enemy, good to bad), with substitutes for colour-blind
// players (Settings → Accessibility): orange against blue for red-green colour blindness
// (protanopia, deuteranopia), red against teal for blue-yellow (tritanopia).
const NORMAL = {
  own: '#5f8fc4', ally: '#8fb4d8', enemy: '#c4544a', siege: '#e0a040', neutral: '#d6d1c6',
  selected: '#3f8f5a', allied: '#4f7fc4', subject: '#8a5ab8', war: '#8e2a22', truce: '#d8b84a',
  opBad: '#c4544a', opMid: '#e3ddd0', opGood: '#5a9a4a', dipWar: '#c4443a',
  supLow: '#b8443a', supHalf: '#e0c050', supFull: '#4f9a4a',
  devLow: '#7a3b3b', devMid: '#d8c46a', devHigh: '#3b7a5a',
  seaOwn: '#3f78c4', seaAlly: '#7fa8d8', seaEnemy: '#c4443a', contested: '#d9a441', atWar: '#c97a6a',
};
export const PALETTES = {
  normal: NORMAL,
  redgreen: { ...NORMAL,
    own: '#0072b2', ally: '#56b4e9', enemy: '#d55e00', siege: '#f0e442',
    selected: '#003f66', allied: '#56b4e9', subject: '#cc79a7', war: '#8a3b00', truce: '#f0e442',
    opBad: '#b35806', opMid: '#ece6d8', opGood: '#2166ac', dipWar: '#d55e00',
    supLow: '#d55e00', supHalf: '#f0e442', supFull: '#0072b2',
    devLow: '#b35806', devMid: '#ece6d8', devHigh: '#2166ac',
    seaOwn: '#0072b2', seaAlly: '#56b4e9', seaEnemy: '#d55e00', contested: '#f0e442', atWar: '#e69f00' },
  blueyellow: { ...NORMAL,
    own: '#127a7a', ally: '#8fd0d0', enemy: '#d62728', siege: '#f4f4f4',
    selected: '#0b4f4f', allied: '#7fc8c8', subject: '#c27ba0', war: '#7f1010', truce: '#a8a8a8',
    opBad: '#c51b2b', opMid: '#eeeeee', opGood: '#127a7a', dipWar: '#d62728',
    supLow: '#c51b2b', supHalf: '#f0c8c8', supFull: '#127a7a',
    devLow: '#c51b2b', devMid: '#eeeeee', devHigh: '#127a7a',
    seaOwn: '#127a7a', seaAlly: '#8fd0d0', seaEnemy: '#d62728', contested: '#f4f4f4', atWar: '#e07070' },
};
let PAL = NORMAL;
export function setPalette(name) { PAL = PALETTES[name] || NORMAL; }

const RES_COLORS = { oil: '#1f1f1f', coal: '#6b5640', iron: '#b5582a', uranium: '#6fbf2f', rare_earths: '#9b45b8', timber: '#3f7a3a', gas: '#e0a030', hydro: '#3a8fd0' };
const RES_WEIGHT = { oil: 3, uranium: 4, rare_earths: 4, iron: 1.5, coal: 1.4, gas: 2.5, hydro: 0.5, timber: 0.12 }; // minerals show over rivers and forests
const GOV_COLORS = { democracy: '#4f86c4', autocracy: '#c4704f', theocracy: '#9a7ac4', military: '#6a7a3a' };
const TERRAIN_COLORS = { plains: '#a9c18a', hills: '#b9a878', mountains: '#8c7f73', forest: '#5f8a5a', desert: '#e0cc94', tundra: '#c7d0cf' };

function ramp(t, a, b) {
  t = Math.max(0, Math.min(1, t));
  const pa = hex(a), pb = hex(b);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
function ramp3(t, a, b, c) { return t < 0.5 ? ramp(t * 2, a, b) : ramp((t - 0.5) * 2, b, c); }
const hexCache = new Map();
export function hex(h) {
  let v = hexCache.get(h);
  if (!v) { v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); hexCache.set(h, v); }
  return v;
}

export function provinceColors(mode, state, map, focus, rules) {
  const out = new Array(map.count);
  const C = state.countries;
  const P = state.prov;
  // per-country colours for the diplomatic and government modes, computed once
  let cc = null;
  if (mode === 'technology' && rules?.tech) {
    const n = rules.tech.eras.length - 1;
    cc = C.map((c) => (c.alive && c.tfx ? ramp3(Math.min(1, (c.tfx.era + Math.min(1, c.tfx.known / rules.tech.T)) / n), '#6a4a3a', '#c8b86a', '#4a8ab8') : '#555'));
  }
  if ((mode === 'diplomacy' && focus >= 0 && rules && state.dip) || (mode === 'government' && rules?.politics)) {
    cc = C.map((c) => {
      if (!c.alive) return '#555';
      if (mode === 'government') {
        const fam = rules.politics.types[c.gov]?.family;
        return ramp(0.35 + 0.65 * Math.min(1, c.stability / 70), '#3a3a3a', GOV_COLORS[fam] || '#888');
      }
      const k = c.idx;
      if (k === focus) return PAL.selected;
      if (atWar(state, focus, k)) return PAL.war;
      if (overlordOf(state, k) === focus || overlordOf(state, focus) === k) return PAL.subject;
      if (allied(state, focus, k)) return PAL.allied;
      if ((C[focus].truces[k] ?? -1) > state.day) return PAL.truce;
      return ramp3((opinion(state, map, rules, k, focus) + 100) / 200, PAL.opBad, PAL.opMid, PAL.opGood);
    });
  }
  const sup = mode === 'supply' && focus >= 0 && rules ? supplyView(state, map, rules, focus) : null;
  for (const i of map.ids) {
    const o = P.owner[i];
    if (o < 0) { out[i] = '#555'; continue; }
    switch (mode) {
      case 'naval': out[i] = ramp(0.6, C[o].color, '#d6d1c6'); break;
      case 'supply': {
        if (!sup) { out[i] = '#cfcac0'; break; }
        const v = SUPPLY_LEVEL[sup[i]];
        out[i] = v <= 0 ? '#6a6a6a' : ramp3(v, PAL.supLow, PAL.supHalf, PAL.supFull);
        break;
      }
      case 'terrain': out[i] = TERRAIN_COLORS[TERRAINS[map.terrain[i]]]; break;
      case 'population': {
        const d = P.pop[i] / Math.max(1, map.area[i]);
        out[i] = ramp3(Math.log10(d + 1) / 3, '#f4efe3', '#d9a05b', '#7a2e2e'); break;
      }
      case 'development': out[i] = ramp3(P.dev[i] / 100, PAL.devLow, PAL.devMid, PAL.devHigh); break;
      case 'economy': {
        const g = provinceGdp(state, i, rules.balance.economy);
        out[i] = ramp3((Math.log10(g + 0.01) + 1) / 4.3, '#efeae0', '#7fb0c8', '#1f4e79'); break;
      }
      case 'resources': {
        const ec = state.econ, R = ec.resources.length;
        let best = -1, bv = 0;
        for (let r = 0; r < R; r++) {
          const v = ec.dep[i * R + r] * (RES_WEIGHT[ec.resources[r]] ?? 1);
          if (v > bv) { bv = v; best = r; }
        }
        out[i] = best < 0 ? '#d6d1c6' : ramp(0.35 + Math.min(1, ec.dep[i * R + best] / 8) * 0.65, '#e4dfd4', RES_COLORS[ec.resources[best]] || '#888');
        break;
      }
      case 'industry': {
        const v = state.econ.va[i] * 12;
        out[i] = v <= 0.001 ? '#e9e5dc' : ramp3((Math.log10(v) + 0.5) / 3.8, '#efe3c4', '#d08a4a', '#6a2a1a'); break;
      }
      case 'infrastructure': out[i] = ramp3(P.infra[i] / 10, '#d9cbb0', '#9ab07a', '#2f6f5a'); break;
      case 'military': {
        const me = focus >= 0 ? focus : -1;
        const ctl = P.controller[i];
        if (me < 0) out[i] = atWarAny(state, ctl) ? PAL.atWar : '#cfcac0';
        else if (ctl === me) out[i] = PAL.own;
        else if (friendly(state, me, ctl)) out[i] = PAL.ally;
        else if (atWar(state, me, ctl)) out[i] = PAL.enemy;
        else out[i] = PAL.neutral;
        if (P.siege[i] > 0) out[i] = PAL.siege;
        break;
      }
      case 'government': case 'technology': out[i] = cc ? cc[o] : C[o].color; break;
      case 'diplomacy': {
        const me = focus;
        if (me < 0) { out[i] = C[o].color; break; }
        if (cc) { out[i] = cc[o]; break; }
        if (o === me) out[i] = PAL.selected;
        else if (atWar(state, me, o)) out[i] = PAL.dipWar;
        else if (allied(state, me, o)) out[i] = PAL.allied;
        else if ((C[me].truces[o] ?? -1) > state.day) out[i] = PAL.truce;
        else out[i] = '#cfcac0';
        break;
      }
      default: out[i] = C[o].color;
    }
  }
  return out;
}

// Naval mode: a colour per sea zone (null = open water nobody holds).
export function zoneColors(state, map, rules, focus) {
  const pres = seaPresence(state, map, rules), C = state.countries;
  return map.sea.zones.map((z, i) => {
    if (!pres[i]?.some((e) => e[1] > 0)) return null; // empty, or only submarines (they cannot hold a zone)
    const k = zoneController(state, map, rules, i);
    if (k < 0) return PAL.contested;
    if (focus >= 0) {
      if (k === focus) return PAL.seaOwn;
      if (friendly(state, focus, k)) return PAL.seaAlly;
      if (atWar(state, focus, k)) return PAL.seaEnemy;
    }
    return C[k].color;
  });
}

function atWarAny(state, c) {
  return state.wars.some((w) => w.attackers.includes(c) || w.defenders.includes(c));
}

// The legend of a map mode, in the colours in use.
export function modeLegend(mode) {
  const L = {
    terrain: Object.entries(TERRAIN_COLORS),
    military: [['Your side', PAL.own], ['Allies / co-belligerents', PAL.ally], ['Enemy', PAL.enemy], ['Under siege', PAL.siege], ['Neutral', PAL.neutral]],
    diplomacy: [['Selected', PAL.selected], ['Allied', PAL.allied], ['Subject / overlord', PAL.subject], ['At war', PAL.war], ['Truce', PAL.truce], ['Hostile', PAL.opBad], ['Neutral', PAL.opMid], ['Friendly', PAL.opGood]],
    government: [['Democracy', '#4f86c4'], ['Autocracy', '#c4704f'], ['Theocracy', '#9a7ac4'], ['Military rule', '#6a7a3a'], ['Darker: low stability', '#3a3a3a']],
    population: [['< 1 /km²', '#f4efe3'], ['~30 /km²', '#d9a05b'], ['1000+ /km²', '#7a2e2e']],
    development: [['Low', PAL.devLow], ['Medium', PAL.devMid], ['High', PAL.devHigh]],
    economy: [['Small', '#efeae0'], ['Medium', '#7fb0c8'], ['Large', '#1f4e79']],
    resources: [['Oil', '#1f1f1f'], ['Coal', '#6b5640'], ['Iron ore', '#b5582a'], ['Uranium', '#6fbf2f'], ['Rare earths', '#9b45b8'], ['Timber', '#3f7a3a'], ['None', '#d6d1c6']],
    industry: [['None', '#e9e5dc'], ['~1B/yr', '#efe3c4'], ['~30B/yr', '#d08a4a'], ['1T+/yr', '#6a2a1a']],
    infrastructure: [['0', '#d9cbb0'], ['5', '#9ab07a'], ['10', '#2f6f5a']],
    naval: [['Your sea control', PAL.seaOwn], ['Allied', PAL.seaAlly], ['Enemy', PAL.seaEnemy], ['Contested', PAL.contested], ['Other country', '#9a9a9a'], ['Open water', '#9fb7c6']],
    supply: [['Full', PAL.supFull], ['Half', PAL.supHalf], ['Low (attrition)', PAL.supLow], ['None', '#6a6a6a']],
    technology: [['Ancient', '#6a4a3a'], ['Industrial', '#c8b86a'], ['Future', '#4a8ab8']],
  };
  return L[mode];
}
