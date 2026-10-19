// Generals and battle plans in the Military tab: the general line on each army card, and the
// command section for the selected armies (general, front, attack arrow, running plans).
import { h } from './dom.js';
import { money } from './format.js';
import { hireGeneral, hireCost, assignGeneral, generalCount, maxGenerals, describeTrait } from '../core/commanders.js';
import { makeFront, executePlan, cancelPlan, planOf } from '../core/plans.js';
import { enemiesOf } from '../core/relations.js';

const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

export function generalTip(cl, g) {
  const R = cl.game.rules, K = R.balance.commanders;
  return `General ${g.name}, skill ${g.skill} of ${K.maxSkill} (+${Math.round(K.skillBonus * g.skill * 100)}% damage)\n`
    + g.traits.map((t) => { const T = describeTrait(R, t); return `${T.name}: ${T.text}`; }).join('\n')
    + `\nBattles won ${g.wins}, lost ${g.losses}. Experience ${Math.round((g.xp / (K.xpPerSkill * g.skill)) * 100)}% to the next level.`;
}

// One line for an army card: its general and plan.
export function generalLine(cl, a) {
  const R = cl.game.rules, map = cl.game.map, p = planOf(cl.state, a.id);
  const plan = p && (p.kind === 'front' ? `Front: ${cl.state.countries[p.enemy].name}` : `Attack: ${map.name[p.target]}${p.status === 'prep' ? ' (preparing)' : ''}`);
  return h('div.muted', a.gen
    ? h('span', { tip: generalTip(cl, a.gen) }, `Gen. ${a.gen.name} ${stars(a.gen.skill)} · ${a.gen.traits.map((t) => describeTrait(R, t).name).join(', ')}`)
    : h('span', { tip: 'No general: the army fights without a commander’s skill or traits.' }, 'No general'),
  plan ? h('span', ` · ${plan}`) : null);
}

// Countries the player can hold a front against: enemies first, then neighbours over land.
const nbCache = new WeakMap();
function frontCandidates(cl) {
  const s = cl.state, map = cl.game.map, me = s.player;
  const c = nbCache.get(s);
  if (c && c.day === s.day) return c.list;
  const P = s.prov, set = new Set(enemiesOf(s, me));
  for (const i of map.ids) {
    if (P.controller[i] !== me) continue;
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      const o = P.controller[map.adj[e]];
      if (o >= 0 && o !== me && map.adjKind[e] !== 2) set.add(o);
    }
  }
  const en = enemiesOf(s, me);
  const list = [...set].filter((k) => s.countries[k].alive).sort((x, y) => (en.has(y) - en.has(x)) || s.countries[x].name.localeCompare(s.countries[y].name));
  nbCache.set(s, { day: s.day, list });
  return list;
}

export function commandSection(cl, selected) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules, me = s.player, c = s.countries[me];
  if (!R.balance.commanders || me < 0) return null;
  const refresh = () => { cl.uiDirty = true; cl.requestFrame(); };
  const pool = c.generals || [];
  const parts = [];
  if (selected.length === 1) {
    const a = selected[0];
    const others = s.armies.filter((x) => x.owner === me && x.gen && x.id !== a.id);
    parts.push(h('div.row', h('span.muted', 'General'),
      h('select', { tip: 'Give this army a general. A general taken from another army leaves that army without one.', on: { change: (e) => { const err = assignGeneral(s, a.id, +e.target.value); if (err) cl.toast(err, true); refresh(); } } },
        h('option', { value: 0, selected: !a.gen }, 'None'),
        a.gen && h('option', { value: a.gen.id, selected: true }, `${a.gen.name} ${stars(a.gen.skill)}`),
        pool.map((g) => h('option', { value: g.id }, `${g.name} ${stars(g.skill)} (waiting)`)),
        others.map((x) => h('option', { value: x.gen.id }, `${x.gen.name} ${stars(x.gen.skill)} (from ${x.name})`)))));
  }
  const full = generalCount(s, me) >= maxGenerals(s, R, me), cost = hireCost(R, c);
  parts.push(h('div.row',
    h('button', { disabled: full || c.treasury < cost, tip: full ? 'You have a general for every army, plus spares.' : `Hire a new general for ${money(cost)}. New generals have skill 1–3 and one trait; leaderless armies take the best waiting general each month.`,
      on: { click: () => { const g = hireGeneral(s, map, R, me); if (typeof g === 'string') cl.toast(g, true); else cl.toast(`General ${g.name} hired (${describeTrait(R, g.traits[0]).name}).`); refresh(); } } }, `Hire general (${money(cost)})`),
    pool.length ? h('span.muted', `${pool.length} waiting`) : null));
  if (selected.length) {
    const cands = frontCandidates(cl), en = enemiesOf(s, me);
    parts.push(h('div.row',
      h('select', { tip: 'Hold a front: the armies spread along your border with this country, the most threatened provinces first, and follow the line as it moves.',
        on: { change: (e) => { if (e.target.value === '') return; const r = makeFront(s, map, R, me, selected.map((a) => a.id), +e.target.value); if (typeof r === 'string') cl.toast(r, true); else cl.toast(`Front against ${s.countries[r.enemy].name}: ${r.armies.length} armies.`); refresh(); } } },
        h('option', { value: '' }, 'Hold front against…'),
        cands.map((k) => h('option', { value: k }, `${s.countries[k].name}${en.has(k) ? ' (at war)' : ''}`))),
      h('button' + (cl.view.planMode ? '.on' : ''), { tip: 'Draw an attack arrow: then right-click the target province. The armies prepare (up to +15% attack over 30 days), then advance together when you press Execute.',
        on: { click: () => { cl.view.planMode = !cl.view.planMode; if (cl.view.planMode) cl.toast('Right-click the province to attack.'); refresh(); } } }, 'Plan attack')));
  }
  const plans = (s.plans || []).filter((p) => p.owner === me);
  if (plans.length) {
    parts.push(h('div', { style: { marginTop: '0.3em' } }, plans.map((p) => h('div.row.spread',
      h('span', p.kind === 'front' ? `Front: ${s.countries[p.enemy].name} (${p.armies.length})` : `Attack on ${map.name[p.target]} (${p.armies.length}) · ${p.status === 'prep' ? `preparing +${Math.round(p.prep * R.balance.commanders.planMaxBonus * 100)}%` : `advancing, step ${p.step + 1} of ${p.path.length}`}`),
      h('span.row',
        p.kind === 'attack' && p.status === 'prep' && h('button', { tip: 'Start the advance.', on: { click: () => { executePlan(s, p.id); refresh(); } } }, 'Execute'),
        h('button', { tip: 'Cancel the plan; the armies stay where they are.', on: { click: () => { cancelPlan(s, p.id); refresh(); } } }, 'Cancel'))))));
  }
  return h('div.command', { style: { margin: '0.4em 0 0.6em' } }, h('h4', 'Command'), parts);
}
