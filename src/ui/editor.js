// The scenario editor: a game screen in 'edit' mode, where the map is painted instead of played.
// The scenario being edited (cl.editor.sc) is the source of truth; painting changes it and the
// shown map at once, and larger changes (a new country, armies, treaties, the start date) rebuild
// the shown game from it. Saved scenarios appear in the New Game list. See docs/SCENARIOS.md.
import { h, mount } from './dom.js';
import { newGame } from '../core/game.js';
import { validateScenario } from '../core/rules.js';
import { parseDate } from '../core/calendar.js';
import { TREATIES } from '../core/diplomacy.js';
import {
  paintProvince, fillRegion, provincesOf, countryOf, addCountry, removeCountry, setCountryField,
  addTreaty, removeTreaty, treatiesOf, addWar, addArmy, armiesAt, removeArmy, tidyScenario, indexEntry,
} from '../core/scenario_edit.js';
import { writeScenario } from './storage.js';
import { flagCanvas, setFlagScenario, forgetFlags } from './flags.js';
import { people } from './format.js';

const TOOLS = [
  ['select', 'Select', 'Click a province to see and edit it and its country.'],
  ['paint', 'Paint', 'Click provinces to give them to the brush country.'],
  ['fill', 'Fill', 'Click a province to give the brush country every connected province of the same owner.'],
];

// Builds the game shown for scenario `sc` (no player, never ticks).
export function editorGame(data, sc) {
  return newGame({ map: data.map, scenario: sc, rules: data.rules, playerTag: null, seed: 'editor' });
}

// Rebuilds the shown game after a change the map alone cannot show.
function reload(cl) {
  const sc = cl.editor.sc;
  try {
    cl.game = editorGame(cl.data, sc);
  } catch (e) {
    cl.toast(String(e.message || e), true);
    return;
  }
  forgetFlags();
  setFlagScenario(sc.flagScenario || sc.id, cl.game.state.countries);
  cl.renderer.invalidate();
  cl.uiDirty = true;
  cl.requestFrame();
}

const tagIdx = (cl, tag) => (tag == null ? -1 : cl.state.countries.findIndex((c) => c.tag === tag));

function paintShown(cl, provs, tag) {
  const s = cl.state, k = tagIdx(cl, tag);
  for (const p of provs) { s.prov.owner[p] = k; s.prov.controller[p] = k; }
  s.mapVersion = (s.mapVersion || 0) + 1;
  cl.editor.dirty = true;
}

// A province was clicked in edit mode.
export function editorClick(cl, p) {
  const ed = cl.editor, sc = ed.sc;
  if (ed.tool === 'paint') { if (paintProvince(sc, p, ed.brush)) paintShown(cl, [p], ed.brush); }
  else if (ed.tool === 'fill') paintShown(cl, fillRegion(sc, cl.game.map, p, ed.brush), ed.brush);
  cl.view.selected = p;
  cl.view.selectedCountry = cl.state.prov.owner[p];
  cl.uiDirty = true;
  cl.requestFrame();
}

function countrySelect(sc, value, onChange, { none = null, exclude = null } = {}) {
  const list = [...sc.countries].sort((a, b) => a.name.localeCompare(b.name));
  return h('select', { on: { change: (e) => onChange(e.target.value === '' ? null : e.target.value) } },
    none && h('option', { value: '', selected: value == null }, none),
    list.filter((c) => c.tag !== exclude).map((c) => h('option', { value: c.tag, selected: c.tag === value }, `${c.name} (${c.tag})`)));
}

const field = (label, input, tip) => h('div.field', { tip }, h('label', label), input);

export function renderEditor(cl) {
  const ed = cl.editor, sc = ed.sc, map = cl.game.map, R = cl.game.rules;
  const refresh = () => { cl.uiDirty = true; cl.requestFrame(); };
  ed.dirty ??= false;
  mount(cl.tabsEl, h('button.on', 'Scenario editor'));
  cl.bannerEl.style.display = 'none';

  // tools and brush
  const tools = h('div.row', TOOLS.map(([id, name, tip]) => h('button' + (ed.tool === id ? '.on' : ''), { tip, on: { click: () => { ed.tool = id; refresh(); } } }, name)));
  const brush = field('Brush country', countrySelect(sc, ed.brush, (t) => { ed.brush = t; if (ed.tool === 'select') ed.tool = 'paint'; refresh(); }, { none: 'Unclaimed land' }),
    'Painting gives provinces to this country.');
  const newName = h('input', { placeholder: 'Name of a new country' });
  const create = h('div.row',
    newName,
    h('button', { on: { click: () => {
      const c = addCountry(sc, { name: newName.value });
      ed.brush = c.tag; ed.tool = 'paint'; ed.dirty = true;
      reload(cl);
      cl.toast(`${c.name} (${c.tag}) added. Paint its provinces on the map.`);
    } } }, 'Add country'));

  // the scenario itself
  const sField = (key, label, input) => field(label, input);
  const upd = (key, conv = (v) => v, rebuild = false) => (e) => { sc[key] = conv(e.target.value); ed.dirty = true; if (rebuild) reload(cl); };
  const scen = h('details', { open: ed.open?.scenario ?? false, on: { toggle: (e) => ((ed.open ||= {}).scenario = e.target.open) } },
    h('summary', h('b', 'Scenario')),
    sField('name', 'Name', h('input', { value: sc.name, on: { change: upd('name') } })),
    sField('startDate', 'Start date (YYYY-MM-DD; years before 1000 as 0117)', h('input', { value: sc.startDate, on: { change: (e) => {
      const v = e.target.value.trim();
      if (!/^-?\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(parseDate(v))) { cl.toast('Use the form YYYY-MM-DD.', true); return; }
      sc.startDate = v; ed.dirty = true; reload(cl);
    } } })),
    sField('techYear', 'Technology year (countries know what was known by then)', h('input', { type: 'number', value: sc.techYear ?? '', placeholder: 'start year', on: { change: upd('techYear', (v) => (v === '' ? undefined : Math.round(+v)), true) } })),
    sField('description', 'Description', h('textarea', { rows: 3, value: sc.description || '', on: { change: upd('description') } })));

  mount(cl.panelEl,
    h('p.muted', 'Paint borders, add countries and set up forces and treaties. Drag to move the map.'),
    tools, brush, create,
    scen,
    provinceSection(cl, refresh),
    countrySection(cl, refresh),
    actions(cl));
}

function provinceSection(cl, refresh) {
  const ed = cl.editor, sc = ed.sc, map = cl.game.map, R = cl.game.rules, p = cl.view.selected;
  if (p < 0) return h('p.muted', 'Click a province to edit it.');
  const r = sc.provinces[p] || [null, 0, 1, 0];
  const setRec = (i, v) => { (sc.provinces[p] ||= [r[0], r[1], r[2], r[3]])[i] = v; ed.dirty = true; reload(cl); };
  const here = armiesAt(sc, p);
  const land = Object.entries(R.units).filter(([, u]) => (u.domain || 'land') === 'land' && u.men);
  const common = mostUsedUnit(sc) || land[0]?.[0];
  const unit = h('select', land.map(([id, u]) => h('option', { value: id, selected: id === common }, u.name)));
  const count = h('input', { type: 'number', value: 4, min: 1, max: 99, style: { width: '4em' } });
  const owner = r[0];
  return h('div.command', { style: { margin: '0.6em 0' } },
    h('h4', `${map.name[p]} · ${owner ? countryOf(sc, owner)?.name : 'Unclaimed'}`),
    h('div.row',
      field('Population', h('input', { type: 'number', value: Math.round(r[1] || 0), min: 0, style: { width: '8em' }, on: { change: (e) => setRec(1, Math.max(0, Math.round(+e.target.value || 0))) } })),
      field('Development', h('input', { type: 'number', value: r[2] ?? 1, min: 1, max: 100, step: 0.5, style: { width: '5em' }, on: { change: (e) => setRec(2, Math.max(1, Math.min(100, +e.target.value || 1))) } })),
      field('Fort', h('input', { type: 'number', value: r[3] || 0, min: 0, max: 10, style: { width: '4em' }, on: { change: (e) => setRec(3, Math.max(0, Math.min(10, Math.round(+e.target.value || 0)))) } }))),
    owner && h('button', { disabled: countryOf(sc, owner)?.capital === p, tip: 'Make this province the capital of its country.',
      on: { click: () => { setCountryField(sc, owner, 'capital', p); ed.dirty = true; reload(cl); } } }, 'Make capital'),
    here.length ? here.map((a) => h('div.row.spread',
      h('span', `${countryOf(sc, a.owner)?.name ?? a.owner}: ${Object.entries(a.units).map(([t, n]) => `${n} ${R.units[t]?.short || t}`).join(', ')}`),
      h('button', { on: { click: () => { removeArmy(sc, a.i); ed.dirty = true; reload(cl); } } }, 'Remove'))) : h('div.muted', 'No armies here.'),
    owner && h('div.row', count, unit, h('button', { tip: `Add an army of ${countryOf(sc, owner)?.name} here.`, on: { click: () => {
      addArmy(sc, owner, p, { [unit.value]: Math.max(1, Math.min(99, Math.round(+count.value || 1))) });
      ed.dirty = true; reload(cl);
    } } }, 'Add army')));
}

function countrySection(cl, refresh) {
  const ed = cl.editor, sc = ed.sc, R = cl.game.rules, s = cl.state;
  const k = cl.view.selectedCountry >= 0 ? cl.view.selectedCountry : tagIdx(cl, ed.brush);
  const tag = k >= 0 ? s.countries[k]?.tag : null, c = tag && countryOf(sc, tag);
  if (!c) return null;
  const provs = provincesOf(sc, tag);
  const pop = provs.reduce((n, i) => n + (sc.provinces[i][1] || 0), 0);
  const live = s.countries[k];
  const set = (key, rebuild = false) => (e) => {
    const err = setCountryField(sc, tag, key, e.target.value);
    if (err) { cl.toast(err, true); return; }
    ed.dirty = true;
    if (rebuild) { reload(cl); return; }
    // shown at once: the name and colour on the map
    live.name = c.name; live.color = c.color; if (c.flag) live.flag = c.flag;
    forgetFlags(); cl.renderer.invalidate(); refresh();
  };
  const govs = Object.entries(R.politics.types);
  let tType = 'alliance', tOther = null, wOther = null;
  const treaties = treatiesOf(sc, tag);
  const wars = (sc.wars || []).map((w, i) => ({ ...w, i })).filter((w) => w.attackers.includes(tag) || w.defenders.includes(tag));
  const name = (t) => countryOf(sc, t)?.name ?? t;
  return h('div.command.ed-country', { style: { margin: '0.6em 0' } },
    h('h4', h('span.row', flagCanvas(live), `${c.name} (${c.tag})`)),
    h('div.muted', `${provs.length} provinces · ${people(pop)} people${provs.length ? '' : ' · owns no land'}`),
    h('div.row',
      field('Name', h('input', { value: c.name, on: { change: set('name') } })),
      field('Colour', h('input', { type: 'color', value: c.color, on: { change: set('color') } }))),
    h('div.row',
      field('Government', h('select', { on: { change: set('gov', true) } }, govs.map(([id, g]) => h('option', { value: id, selected: id === c.gov }, g.name)))),
      field('Stability', h('input', { type: 'number', min: 0, max: 100, value: c.stability ?? 60, style: { width: '4.5em' }, on: { change: set('stability', true) } }))),
    h('div.row',
      field('Treasury (B)', h('input', { type: 'number', value: c.treasury ?? 0, style: { width: '6em' }, on: { change: set('treasury', true) } })),
      field('AI aggression (0–1)', h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: c.aggression ?? 0.5, style: { width: '4.5em' }, on: { change: set('aggression') } })),
      field('Tech lag (years)', h('input', { type: 'number', value: c.techLag ?? 0, style: { width: '4.5em' }, on: { change: set('techLag', true) } }),
        'How many years behind the scenario\'s technology year this country starts.')),
    h('h4', 'Treaties'),
    treaties.length ? treaties.map((t) => h('div.row.spread',
      h('span', `${TREATIES[t.type]?.name}: ${t.a === tag ? name(t.b) : name(t.a)}${TREATIES[t.type]?.mutual ? '' : t.a === tag ? ' (we are ' + roleA(t.type) + ')' : ' (they are ' + roleA(t.type) + ')'}`),
      h('button', { on: { click: () => { removeTreaty(sc, t.i); ed.dirty = true; reload(cl); } } }, 'Remove'))) : h('div.muted', 'None.'),
    h('div.row',
      h('select', { on: { change: (e) => (tType = e.target.value) } }, Object.entries(TREATIES).filter(([id]) => id !== 'reparations').map(([id, t]) => h('option', { value: id }, t.name))),
      countrySelect(sc, null, (v) => (tOther = v), { none: 'with…', exclude: tag }),
      h('button', { tip: 'For one-way treaties this country is the first party: the overlord, the guarantor, or the one granting access.', on: { click: () => {
        if (!tOther) return cl.toast('Pick a country.', true);
        const err = addTreaty(sc, tType, tag, tOther);
        if (err) return cl.toast(err, true);
        ed.dirty = true; reload(cl);
      } } }, 'Add')),
    h('h4', 'Wars at the start'),
    wars.length ? wars.map((w) => h('div.row.spread',
      h('span', `${w.attackers.map(name).join(', ')} against ${w.defenders.map(name).join(', ')}`),
      h('button', { on: { click: () => { sc.wars.splice(w.i, 1); ed.dirty = true; reload(cl); } } }, 'Remove'))) : h('div.muted', 'At peace.'),
    h('div.row',
      countrySelect(sc, null, (v) => (wOther = v), { none: 'Declare war on…', exclude: tag }),
      h('button', { on: { click: () => {
        if (!wOther) return cl.toast('Pick a country.', true);
        const err = addWar(sc, tag, wOther);
        if (err) return cl.toast(err, true);
        ed.dirty = true; reload(cl);
      } } }, 'Add war')),
    h('div.row', { style: { marginTop: '0.6em' } },
      h('button', { on: { click: () => { ed.brush = tag; ed.tool = 'paint'; refresh(); } } }, 'Paint with this country'),
      h('button.danger', { tip: 'Delete this country: its land becomes unclaimed and its forces, treaties and wars are removed.', on: { click: () => {
        removeCountry(sc, tag);
        if (ed.brush === tag) ed.brush = null;
        cl.view.selectedCountry = -1; ed.dirty = true; reload(cl);
      } } }, 'Delete country')));
}

const roleA = (type) => ({ subject: 'the overlord', guarantee: 'the guarantor', access: 'granting access' }[type] || 'first');

function mostUsedUnit(sc) {
  const n = {};
  for (const a of sc.armies || []) for (const [t, v] of Object.entries(a.units)) n[t] = (n[t] || 0) + v;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Checks and saves the scenario; returns true when it was saved.
export async function saveEdited(cl) {
  const sc = cl.editor.sc, map = cl.game.map;
  const notes = tidyScenario(sc, map);
  try {
    validateScenario(sc, map);
    editorGame(cl.data, sc); // it must start
  } catch (e) {
    cl.toast(String(e.message || e), true);
    return false;
  }
  const err = await writeScenario(sc, indexEntry(sc));
  if (err) { cl.toast(err, true); return false; }
  cl.editor.dirty = false;
  reload(cl);
  cl.opts.onScenarioSaved?.(sc);
  cl.toast(`Saved "${sc.name}". It is in the New Game list.${notes.length ? ' ' + notes.slice(0, 3).join('; ') + '.' : ''}`);
  return true;
}

function actions(cl) {
  const sc = cl.editor.sc;
  const exportFile = () => {
    tidyScenario(sc, cl.game.map);
    const blob = new Blob([JSON.stringify(sc)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${sc.id}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return h('div', { style: { marginTop: '0.8em' } },
    h('div.row',
      h('button.primary', { tip: 'Check the scenario, fix what is inconsistent (capitals, forces abroad) and save it.', on: { click: () => saveEdited(cl) } }, cl.editor.dirty ? 'Save scenario *' : 'Save scenario'),
      h('button', { tip: 'Save, then start a new game in it.', on: { click: async () => { if (await saveEdited(cl)) cl.opts.onPlayScenario?.(sc.id); } } }, 'Save and play'),
      h('button', { tip: 'Download the scenario as a JSON file (to share it, or to add it to data/scenarios/ in a mod).', on: { click: exportFile } }, 'Export file')),
    h('p.note', 'Saved scenarios are kept on this device. Exported files can be imported from the editor menu.'));
}
