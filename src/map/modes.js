// Map modes: each returns a fill colour per province from current game state. Only modes
// backed by real simulation data are offered.
import { TERRAINS } from '../core/mapdata.js';
import { atWar, allied, friendly } from '../core/relations.js';

export const MAP_MODES = [
  { id: 'political', name: 'Political', key: 'p', tip: 'Country ownership. Stripes mark provinces occupied by another country.' },
  { id: 'terrain', name: 'Terrain', key: 't', tip: 'Estimated terrain type, which affects movement, combat width and defence.' },
  { id: 'population', name: 'Population', key: 'o', tip: 'Population density (people per km²), log scale.' },
  { id: 'development', name: 'Development', key: 'v', tip: 'Development index 0–100: drives productivity per person and infrastructure speed.' },
  { id: 'economy', name: 'Economy', key: 'g', tip: 'Annual provincial GDP (log scale).' },
  { id: 'military', name: 'Military', key: 'r', tip: 'Fronts: your side, enemies, and provinces under siege.' },
  { id: 'diplomacy', name: 'Diplomacy', key: 'y', tip: 'Relations to the selected (or your) country: allies, enemies, truces.' },
];

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

export function provinceColors(mode, state, map, focus) {
  const out = new Array(map.count);
  const C = state.countries;
  const P = state.prov;
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
        const g = (P.pop[i] * 400 * Math.pow(1.06, P.dev[i])) / 1e9;
        out[i] = ramp3((Math.log10(g + 0.01) + 1) / 4.3, '#efeae0', '#7fb0c8', '#1f4e79'); break;
      }
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
      case 'diplomacy': {
        const me = focus;
        if (me < 0) { out[i] = C[o].color; break; }
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
  diplomacy: [['Selected country', '#3f8f5a'], ['Allied', '#4f7fc4'], ['At war', '#c4443a'], ['Truce', '#d8b84a'], ['Neutral', '#cfcac0']],
  population: [['< 1 /km²', '#f4efe3'], ['~30 /km²', '#d9a05b'], ['1000+ /km²', '#7a2e2e']],
  development: [['Low', '#7a3b3b'], ['Medium', '#d8c46a'], ['High', '#3b7a5a']],
  economy: [['Small', '#efeae0'], ['Medium', '#7fb0c8'], ['Large', '#1f4e79']],
};
