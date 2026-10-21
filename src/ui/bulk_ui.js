// Industry tab: bulk construction (one building in many provinces, a brush to paint them on the
// map), "build where most needed", the auto-managed economy, and colonies under way. The rules
// are in src/core/bulk.js and src/core/colonies.js.
import { h } from './dom.js';
import { icon } from './icons.js';
import { money, pct } from './format.js';
import { scopeProvinces, bulkPlan, bulkBuild, neededProjects, buildNeeded } from '../core/bulk.js';
import { cancelColony } from '../core/colonies.js';
import { computeLedgers } from '../core/economy.js';

const refresh = (cl) => { computeLedgers(cl.state, cl.game.map, cl.game.rules); cl.uiDirty = true; cl.requestFrame(); };

// The plans are worked out again only when something they depend on changed.
function memo(cl, key, fn) {
  const s = cl.state, v = cl.view;
  const stamp = `${key}|${s.day}|${s.construction.length}|${Math.round(s.countries[s.player].treasury * 100)}|${s.mapVersion || 0}`;
  v._bulkMemo ||= {};
  if (v._bulkMemo[key]?.stamp !== stamp) v._bulkMemo[key] = { stamp, val: fn() };
  return v._bulkMemo[key].val;
}

export function bulkSection(cl) {
  const s = cl.state, R = cl.game.rules, X = R.econ, map = cl.game.map, me = s.player;
  if (me < 0 || !s.econ) return null;
  const c = s.countries[me];
  const B = (cl.view.bulk ||= { kind: 'infra', b: -1, scope: 'painted' });
  const brush = cl.view.brush;
  if (brush?.provs.size) cl.view.highlight = [...brush.provs];
  const sel = cl.view.selected, selMine = sel >= 0 && s.prov.owner[sel] === me;
  if (B.scope === 'region' && !selMine) B.scope = brush?.provs.size ? 'painted' : 'country';
  const scope = B.scope === 'painted' ? { type: 'list', provs: [...(brush?.provs || [])] }
    : B.scope === 'region' ? { type: 'region', iso: map.iso[sel] } : { type: 'country' };
  const provs = scopeProvinces(s, map, me, scope);
  const what = B.kind === 'infra' ? 'Infrastructure' : X.buildings[B.b].name;
  const plan = memo(cl, `plan|${B.kind}|${B.b}|${B.scope}|${scope.iso || ''}|${scope.provs?.join(',') || ''}`, () => bulkPlan(s, map, R, me, provs, B.kind, B.b));
  const options = [h('option', { value: 'infra', selected: B.kind === 'infra' }, 'Infrastructure'),
    ...X.buildings.filter((b) => !c.tfx || c.tfx.bld[b.i]).map((b) => h('option', { value: String(b.i), selected: B.kind === 'building' && B.b === b.i }, b.name))];
  const pick = h('select.bulk-building', { on: { change: (e) => { const v = e.target.value; if (v === 'infra') { B.kind = 'infra'; B.b = -1; } else { B.kind = 'building'; B.b = +v; } cl.uiDirty = true; cl.requestFrame(); } } }, options);
  const scopeSel = h('select.bulk-scope', { on: { change: (e) => { B.scope = e.target.value; cl.uiDirty = true; cl.requestFrame(); } } },
    h('option', { value: 'painted', selected: B.scope === 'painted' }, `Painted provinces (${brush?.provs.size || 0})`),
    selMine && h('option', { value: 'region', selected: B.scope === 'region' }, `Region of ${map.name[sel]} (${scopeProvinces(s, map, me, { type: 'region', iso: map.iso[sel] }).length})`),
    h('option', { value: 'country', selected: B.scope === 'country' }, `Whole country (${scopeProvinces(s, map, me, { type: 'country' }).length})`));
  const setBrush = (on, erase = false) => {
    const b = (cl.view.brush ||= { provs: new Set(), on: false, erase: false });
    b.on = on; b.erase = erase;
    if (on) { B.scope = 'painted'; cl.toast(erase ? 'Drag over your provinces to remove them. Esc stops.' : 'Drag over your provinces to paint them; the map does not pan while painting. Esc stops.'); }
    cl.canvas.style.cursor = on ? 'crosshair' : 'default';
    cl.uiDirty = true; cl.requestFrame();
  };
  const waitQ = plan.sites.filter((x) => !x.ok && x.why === 'queue full').length, waitM = plan.sites.filter((x) => !x.ok && x.why !== 'queue full').length;
  const unaffordable = waitQ + waitM;
  const queue = () => {
    const r = bulkBuild(s, map, R, me, provs, B.kind, B.b);
    cl.toast(r.started ? `${what}: ${r.started} project${r.started === 1 ? '' : 's'} queued for ${money(r.spent)}.` : r.errors[0] || 'Nothing could be started.', !r.started);
    refresh(cl);
  };
  const needed = memo(cl, 'needed', () => neededProjects(s, map, R, me));
  return h('div.bulk',
    h('h3', { style: { marginTop: '0.8em' } }, icon('editor'), ' Bulk construction'),
    h('p.muted', 'Queue one building or infrastructure in many provinces at once: paint them on the map, or take a region or the whole country. The best sites come first.'),
    h('div.field', h('label', 'Build'), pick),
    h('div.field', h('label', 'Where'), scopeSel),
    h('div.row',
      h('button' + (brush?.on && !brush.erase ? '.on' : ''), { tip: 'Paint provinces on the map by dragging (Esc stops)', on: { click: () => setBrush(!(brush?.on && !brush.erase)) } }, icon('editor'), 'Paint'),
      h('button' + (brush?.on && brush.erase ? '.on' : ''), { tip: 'Remove provinces from the painted set by dragging', on: { click: () => setBrush(!(brush?.on && brush.erase), true) } }, 'Erase'),
      h('button', { disabled: !brush?.provs.size, on: { click: () => { brush.provs.clear(); cl.view.highlight = null; cl.uiDirty = true; cl.requestFrame(); } } }, 'Clear')),
    h('div.kv.bulk-preview',
      h('span', 'Eligible provinces'), h('span', `${plan.sites.length}${plan.skipped ? ` (${plan.skipped} unsuitable)` : ''}`),
      h('span', { tip: `Cost of each project, with goods missing from the stockpile bought at a premium as it runs down. Treasury ${money(plan.treasury)}, ${plan.room} free places in the queue.` }, 'Can start now'), h('span', { className: plan.n ? '' : 'muted' }, `${plan.n} for ${money(plan.total)}`),
      unaffordable > 0 && h('span', 'All of them'), unaffordable > 0 && h('span.muted', `${money(plan.all)} (${[waitQ && `${waitQ} wait for queue space`, waitM && `${waitM} for money`].filter(Boolean).join(', ')})`)),
    h('button.primary.bulk-go', { disabled: !plan.n, tip: plan.sites.slice(0, 12).map((x) => `${map.name[x.p]}: ${money(x.cost)}${x.ok ? '' : ` (${x.why})`}`).join('\n') || 'No eligible province', on: { click: queue } },
      `Queue ${plan.n} × ${what}`),
    h('h4', { tip: 'The largest shortfalls of goods (need minus production minus what is being built), and the buildings and sites the AI would choose for them.' }, 'Build where most needed'),
    needed.length ? h('div', needed.map((x) => h('div.army-card.need-card',
      h('div.row.spread', h('b', icon(X.buildings[x.b].id), ' ', x.good), h('span.muted', `short ${x.units >= 10 ? x.units.toFixed(0) : x.units.toFixed(1)}/month`)),
      h('div.muted.small', `${x.sites.length} × ${x.building}${x.why ? ` (${x.why})` : ''}: ${[...new Set(x.sites.map((p) => map.name[p]))].slice(0, 4).join(', ')}`),
      h('button', { disabled: c.treasury < x.cost, tip: `Total ${money(x.cost)}; treasury ${money(c.treasury)}`, on: { click: () => {
        const r = buildNeeded(s, map, R, me, x);
        cl.toast(r.started ? `${x.building}: ${r.started} project${r.started === 1 ? '' : 's'} queued for ${money(r.spent)}.` : r.errors[0] || 'Nothing could be started.', !r.started);
        refresh(cl);
      } } }, `Queue for ${money(x.cost)}`)))) : h('p.muted', 'No shortfall that new buildings could close.'),
    h('label.row.auto-econ', { tip: 'The AI plans and pays for construction (and colonies) for you, as it does for its own countries, keeping a reserve. Taxes, the army, war and diplomacy stay in your hands.' },
      h('input', { type: 'checkbox', checked: !!c.autoEconomy, on: { change: (e) => { c.autoEconomy = e.target.checked; cl.toast(c.autoEconomy ? 'The AI now builds for you (every other month).' : 'You manage construction again.'); cl.uiDirty = true; } } }),
      ' Auto-manage economy'),
    coloniesList(cl));
}

function coloniesList(cl) {
  const s = cl.state, map = cl.game.map, me = s.player;
  const list = (s.colonies || []).filter((x) => x.owner === me);
  if (!list.length) return null;
  return h('div', h('h4', icon('tech_sailing'), ' Colonies under way'),
    list.map((x) => h('div.army-card', { on: { click: () => cl.focusProvince(x.prov) } },
      h('div.row.spread', h('b', map.name[x.prov]), h('span.muted', `${Math.max(0, x.end - s.day)}d left · ${pct(x.chance)} chance`)),
      h('div.row', { style: { gap: '0.4em' } }, h('div.bar', { style: { flex: 1 } }, h('i', { style: { width: Math.round(100 * (s.day - x.start) / Math.max(1, x.end - x.start)) + '%' } })),
        h('button', { tip: `Recall the settlers: refunds half of ${money(x.paid)}`, on: { click: (e) => { e.stopPropagation(); cancelColony(s, cl.game.rules, x.id); refresh(cl); } } }, '×')))));
}
