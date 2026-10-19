// Research tab and the technology tree overlay. Shows the selected country (read-only) or
// yours: era, research spending and points, the current project and queue, and what can be
// researched next. Every number comes from src/core/technology.js.
import { h, mount } from './dom.js';
import { money, pct } from './format.js';
import { refreshCountryCache } from '../core/state.js';
import { computeLedgers } from '../core/economy.js';
import {
  knows, available, techCost, researchPoints, setResearch, queueResearch, setResearchShare, eraOf,
} from '../core/technology.js';
import { techTreeDialog } from './techtree.js';
import { icon } from './icons.js';

const EFFECT_NAMES = {
  farm: 'Farm output', mine: 'Mine output', industry: 'Industrial output', research: 'Research', popGrowth: 'Population growth',
  combat: 'Combat strength', movement: 'Army speed', siege: 'Siege speed', devGrowth: 'Development growth', tax: 'Tax efficiency', construction: 'Construction cost',
};

function bar(v, color = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: color } }));
}

function yearText(y) { return y < 0 ? `${-y} BC` : `${y}`; }

// Tooltip text for one technology: description, year, effects, unlocks, prerequisites, cost.
export function techTip(cl, k, t) {
  const s = cl.state, R = cl.game.rules, T = R.tech, tech = T.list[t];
  const lines = [tech.name + (tech.fictional ? ' (speculative)' : ''), `${T.eras[tech.eraI].name} · ${T.fields[tech.field] || tech.field} · first used ${yearText(tech.year)}`];
  if (tech.desc) lines.push('', tech.desc);
  const fx = Object.entries(tech.effects).map(([e, v]) => `${EFFECT_NAMES[e] || e} ${e === 'construction' ? '−' : '+'}${Math.round(v * 100)}%`);
  if (fx.length) lines.push('', 'Effects (before normalisation): ' + fx.join(', '));
  const u = tech.unlocks || {};
  const un = [
    ...(u.goods || []).map((g) => R.econ.goods[R.econ.gi[g]].name),
    ...(u.buildings || []).map((b) => R.econ.buildings[R.econ.bi[b]].name),
    ...Object.entries(T.unitTech).filter(([, x]) => x === t).map(([id]) => R.units[id].name),
    ...(u.govTypes || []).map((g) => R.politics.types[g].name),
  ];
  if (un.length) lines.push('Unlocks: ' + [...new Set(un)].join(', '));
  if (tech.reqI.length) lines.push('Requires: ' + tech.reqI.map((r) => T.list[r].name + (knows(s, k, r) ? ' ✓' : '')).join(', '));
  if (!knows(s, k, t)) {
    const parts = {};
    const cost = techCost(s, cl.game.map, R, k, t, parts);
    lines.push('', `Cost ${Math.round(cost)} points = ${Math.round(parts.base)} × (1 − ${pct(parts.discount)} diffusion discount: ${pct(parts.neighbours)} of neighbours and ${pct(parts.world)} of world GDP know it)`);
  }
  return lines.join('\n');
}

export function researchTab(cl) {
  const s = cl.state, C = s.countries, R = cl.game.rules, T = R.tech, Rb = R.balance.research, map = cl.game.map;
  const k = cl.view.selectedCountry >= 0 ? cl.view.selectedCountry : s.player;
  if (k < 0) return h('p.muted', 'Select a country to see its research.');
  const c = C[k], r = c.research, mine = k === s.player;
  if (!r || !s.tech) return h('p.muted', 'This game has no research.');
  const era = eraOf(R, c);
  const parts = {};
  const rp = researchPoints(s, R, c, parts);
  const refresh = () => { refreshCountryCache(s, map, R); computeLedgers(s, map, R); cl.uiDirty = true; cl.requestFrame(); };
  const act = (fn) => { const e = fn(); if (e) cl.toast(e, true); refresh(); };
  const cur = r.current ? T.idx[r.current] : null;
  const cost = cur != null ? techCost(s, map, R, k, cur) : 0;
  const months = cur != null && rp > 0 ? Math.max(0, Math.ceil((cost - r.progress) / (rp + Math.min(r.bank, rp)))) : null;
  const avail = T.list.filter((t) => available(s, R, k, t.i)).map((t) => ({ t, cost: techCost(s, map, R, k, t.i) })).sort((a, b) => a.cost - b.cost);
  const share = h('input', { type: 'range', min: 0, max: Rb.maxShare, step: 0.005, value: r.share, disabled: !mine,
    on: { change: (e) => act(() => setResearchShare(s, R, k, +e.target.value)) } });
  return h('div',
    h('h3', `${c.name}: ${era.name}`),
    !mine && h('p.muted', 'Viewing another country (read-only).'),
    h('div.kv',
      h('span', { tip: 'The latest era of which the country knows at least half the technologies, without gaps. Sets the share of the population that can be mobilised.' }, 'Era'), h('span', era.name),
      h('span', 'Technologies'), h('span', `${c.tfx.known} of ${T.T}`),
      h('span', { tip: `Share of tax revenue spent on research (0–${pct(Rb.maxShare)}). Shown in the budget as "Research".` }, 'Research spending'),
      h('span', `${pct(r.share, 1)} of tax revenue = ${money(parts.spend || 0)}/month`),
      h('span', { tip: `Points = ${Rb.rpScale} × √(spending ÷ price level ${c.cache.priceLevel.toFixed(2)}) × education ${(parts.edu || 0).toFixed(2)} (from average development) × research bonus ${(parts.mult || 1).toFixed(2)} (from technologies).` }, 'Research points'),
      h('span', `${rp.toFixed(1)} a month`),
      h('span', { tip: `Points saved while no project runs, or carried over from finished projects (up to ${Rb.bankMonths} months). Spent at up to one month's worth extra per month.` }, 'Banked'), h('span', r.bank.toFixed(0))),
    mine && h('div.field', { style: { marginTop: '0.5em' } }, h('label', 'Research spending'), share),
    h('h3', { style: { marginTop: '0.8em' } }, 'Current project'),
    cur != null ? h('div', { tip: techTip(cl, k, cur) },
      h('div.row.spread', h('b', T.list[cur].name), h('span.muted', `${Math.round(r.progress)} / ${Math.round(cost)}${months != null ? ` · about ${months} month${months === 1 ? '' : 's'}` : ''}`)),
      bar(r.progress / Math.max(1, cost), 'var(--blue)'))
      : h('p.muted', mine ? 'No project: points are being banked. Pick one below.' : 'None.'),
    r.queue.length > 0 && h('div', h('h4', 'Queue'), h('table.t.small', r.queue.map((id, n) => h('tr',
      h('td', { tip: techTip(cl, k, T.idx[id]) }, `${n + 1}. ${T.list[T.idx[id]].name}`),
      mine && h('td.n', h('button', { tip: 'Remove from the queue', on: { click: () => { r.queue.splice(n, 1); refresh(); } } }, '×')))))),
    h('div.row.spread', { style: { marginTop: '0.8em' } }, h('h3', 'Available'), h('button', { on: { click: () => techTreeDialog(cl, k, techTip) } }, icon('tech_tree'), 'Technology tree')),
    avail.length ? h('table.t.small', avail.map(({ t, cost: tc }) => h('tr',
      h('td', { tip: techTip(cl, k, t.i) }, t.name, t.fictional ? h('span.muted', ' (speculative)') : null, h('div.muted', `${T.fields[t.field] || t.field} · ${yearText(t.year)}`)),
      h('td.n', Math.round(tc)),
      mine && h('td.n', h('button', { tip: 'Research now (half of the current progress is kept as banked points)', disabled: r.current === t.id, on: { click: () => act(() => setResearch(s, R, k, t.id)) } }, 'Start'),
        h('button', { tip: 'Add to the queue', disabled: r.queue.includes(t.id) || r.current === t.id, on: { click: () => act(() => queueResearch(s, R, k, t.id)) } }, '+')))))
      : h('p.muted', 'Everything available is known.'));
}
