// Map modes: each returns a fill colour per province from current game state. Only modes
// backed by real simulation data are offered.
import { TERRAINS } from '../core/mapdata.js';
import { atWar, allied, friendly } from '../core/relations.js';
import { provinceGdp } from '../core/state.js';
import { opinion, overlordOf } from '../core/diplomacy.js';

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
  { id: 'government', name: 'Government', key: 'j', tip: 'Form of government: democracies, autocracies, theocracies and military rule; darker = lower stability.' },
];

const RES_COLORS = { oil: '#1f1f1f', coal: '#6b5640', iron: '#b5582a', uranium: '#6fbf2f', rare_earths: '#9b45b8', timber: '#3f7a3a' };
const RES_WEIGHT = { oil: 3, uranium: 4, rare_earths: 4, iron: 1.5, coal: 1.4, timber: 0.12 }; // minerals show over forests
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
  if ((mode === 'diplomacy' && focus >= 0 && rules && state.dip) || (mode === 'government' && rules?.politics)) {
    cc = C.map((c) => {
      if (!c.alive) return '#555';
      if (mode === 'government') {
        const fam = rules.politics.types[c.gov]?.family;
        return ramp(0.35 + 0.65 * Math.min(1, c.stability / 70), '#3a3a3a', GOV_COLORS[fam] || '#888');
      }
      const k = c.idx;
      if (k === focus) return '#3f8f5a';
      if (atWar(state, focus, k)) return '#8e2a22';
      if (overlordOf(state, k) === focus || overlordOf(state, focus) === k) return '#8a5ab8';
      if (allied(state, focus, k)) return '#4f7fc4';
      if ((C[focus].truces[k] ?? -1) > state.day) return '#d8b84a';
      return ramp3((opinion(state, map, rules, k, focus) + 100) / 200, '#c4544a', '#e3ddd0', '#5a9a4a');
    });
  }
  for (const i of map.ids) {
    const o = P.owner[i];
    if (o < 0) { out[i] = '#555'; continue; }
    switch (mode) {
      case 'terrain': out[i] = TERRAIN_COLORS[TERRAINS[map.terrain[i]]]; break;
      case 'population': {
        const d = P.pop[i] / Math.max(1, map.area[i]);
        out[i] = ramp3(Math.log10(d + 1) / 3, '#f4efe3', '#d9a05b', '#7a2e2e'); break;
      }
      case 'development': out[i] = ramp3(P.dev[i] / 100, '#7a3b3b', '#d8c46a', '#3b7a5a'); break;
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
        if (me < 0) out[i] = atWarAny(state, ctl) ? '#c97a6a' : '#cfcac0';
        else if (ctl === me) out[i] = '#5f8fc4';
        else if (friendly(state, me, ctl)) out[i] = '#8fb4d8';
        else if (atWar(state, me, ctl)) out[i] = '#c4544a';
        else out[i] = '#d6d1c6';
        if (P.siege[i] > 0) out[i] = '#e0a040';
        break;
      }
      case 'government': out[i] = cc ? cc[o] : C[o].color; break;
      case 'diplomacy': {
        const me = focus;
        if (me < 0) { out[i] = C[o].color; break; }
        if (cc) { out[i] = cc[o]; break; }
        if (o === me) out[i] = '#3f8f5a';
        else if (atWar(state, me, o)) out[i] = '#c4443a';
        else if (allied(state, me, o)) out[i] = '#4f7fc4';
        else if ((C[me].truces[o] ?? -1) > state.day) out[i] = '#d8b84a';
        else out[i] = '#cfcac0';
        break;
      }
      default: out[i] = C[o].color;
    }
  }
  return out;
}

function atWarAny(state, c) {
  return state.wars.some((w) => w.attackers.includes(c) || w.defenders.includes(c));
}

export const MODE_LEGENDS = {
  terrain: Object.entries(TERRAIN_COLORS),
  military: [['Your side', '#5f8fc4'], ['Allies / co-belligerents', '#8fb4d8'], ['Enemy', '#c4544a'], ['Under siege', '#e0a040'], ['Neutral', '#d6d1c6']],
  diplomacy: [['Selected', '#3f8f5a'], ['Allied', '#4f7fc4'], ['Subject / overlord', '#8a5ab8'], ['At war', '#8e2a22'], ['Truce', '#d8b84a'], ['Hostile', '#c4544a'], ['Neutral', '#e3ddd0'], ['Friendly', '#5a9a4a']],
  government: [['Democracy', '#4f86c4'], ['Autocracy', '#c4704f'], ['Theocracy', '#9a7ac4'], ['Military rule', '#6a7a3a'], ['Darker: low stability', '#3a3a3a']],
  population: [['< 1 /km²', '#f4efe3'], ['~30 /km²', '#d9a05b'], ['1000+ /km²', '#7a2e2e']],
  development: [['Low', '#7a3b3b'], ['Medium', '#d8c46a'], ['High', '#3b7a5a']],
  economy: [['Small', '#efeae0'], ['Medium', '#7fb0c8'], ['Large', '#1f4e79']],
  resources: [['Oil', '#1f1f1f'], ['Coal', '#6b5640'], ['Iron ore', '#b5582a'], ['Uranium', '#6fbf2f'], ['Rare earths', '#9b45b8'], ['Timber', '#3f7a3a'], ['None', '#d6d1c6']],
  industry: [['None', '#e9e5dc'], ['~1B/yr', '#efe3c4'], ['~30B/yr', '#d08a4a'], ['1T+/yr', '#6a2a1a']],
  infrastructure: [['0', '#d9cbb0'], ['5', '#9ab07a'], ['10', '#2f6f5a']],
};
