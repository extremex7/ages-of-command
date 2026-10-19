// Boot: load data files, then show the main menu.
import { h, mount } from './dom.js';
import { decodeMap, makeRules, newGame, loadGame } from '../core/game.js';
import { validateScenario } from '../core/rules.js';
import { formatDate, parseDate } from '../core/calendar.js';
import { loadSettings, saveSettings, listSlots, readSave, deleteSave, initStorage, isDesktop } from './storage.js';
import { Client } from './client.js';

const app = document.getElementById('app');
const data = { map: null, rules: null, scenarios: [], scenarioCache: new Map(), settings: loadSettings(), timings: {} };
window.__aoc3 = data; // exposed for benchmarks and debugging

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
  return r.json();
}

async function boot() {
  const t0 = performance.now();
  // the desktop app keeps settings and saves on disk; reload the settings from there
  data.desktop = await initStorage();
  if (data.desktop) data.settings = loadSettings();
  applyUiScale();
  try {
    const [world, seas, units, balance, goods, buildings, governments, technologies, evIndex, index] = await Promise.all([
      json('data/map/world.json'), json('data/map/seas.json'), json('data/rules/units.json'), json('data/rules/balance.json'),
      json('data/rules/goods.json'), json('data/rules/buildings.json'), json('data/rules/governments.json'),
      json('data/rules/technologies.json'), json('data/events/index.json'), json('data/scenarios/index.json'),
    ]);
    const events = await Promise.all(evIndex.files.map((f) => json('data/events/' + f)));
    const t1 = performance.now();
    data.map = decodeMap(world, seas);
    data.rules = makeRules(units, balance, goods, buildings, governments, events, technologies);
    data.scenarios = index.scenarios;
    data.timings.fetch = t1 - t0;
    data.timings.decode = performance.now() - t1;
    data.timings.boot = performance.now() - t0;
  } catch (e) {
    mount(app, h('div.screen', h('div.menu-card', h('h2', 'Could not start'), h('p', String(e.message || e)),
      h('p.muted', 'Run the game through a local web server (see README: "npm start"), not by opening index.html directly.'))));
    throw e;
  }
  mainMenu();
}

function applyUiScale() {
  document.documentElement.style.setProperty('--ui-scale', String(data.settings.uiScale || 1));
}

async function getScenario(id) {
  if (data.scenarioCache.has(id)) return data.scenarioCache.get(id);
  const meta = data.scenarios.find((s) => s.id === id);
  const sc = await json('data/scenarios/' + meta.file);
  validateScenario(sc, data.map);
  data.scenarioCache.set(id, sc);
  return sc;
}

export function mainMenu() {
  mount(app, h('div.screen', h('div.menu-card',
    h('div.title', 'AGES OF COMMAND'),
    h('div.subtitle', 'A grand strategy sandbox — prototype build'),
    h('div.menu-buttons',
      h('button.primary', { on: { click: newGameScreen } }, 'New Game'),
      h('button', { on: { click: loadScreen }, disabled: !listSlots().length }, 'Load Game'),
      h('button', { on: { click: settingsScreen } }, 'Settings')),
    h('p.note', `Map: ${data.map.ids.length.toLocaleString()} provinces from ${data.map.source}. Loaded in ${Math.round(data.timings.boot)} ms.`))));
}

function newGameScreen() {
  let sel = data.scenarios[0]?.id;
  const opts = { difficulty: 'normal', aiAggression: 1, seed: '', historicalEvents: 'historical', eventRate: 1 };
  const detail = h('div');
  const list = h('div.list');
  function renderList() {
    mount(list, data.scenarios.map((s) => h('div.item' + (s.id === sel ? '.sel' : ''), { on: { click: () => { sel = s.id; renderList(); renderDetail(); } } },
      h('b', s.name), ' ', h('span.muted', `· ${s.era} · ${formatDate(parseDate(s.startDate))}`))));
  }
  function renderDetail() {
    const s = data.scenarios.find((x) => x.id === sel);
    if (!s) return mount(detail, h('p', 'No scenarios found.'));
    mount(detail, h('h3', s.name), h('p', s.description), s.approximations && h('p.note', 'Approximations: ' + s.approximations));
  }
  renderList(); renderDetail();
  const diff = h('select', { on: { change: (e) => (opts.difficulty = e.target.value) } },
    ['easy', 'normal', 'hard'].map((d) => h('option', { value: d, selected: d === 'normal' }, d[0].toUpperCase() + d.slice(1))));
  const aggr = h('select', { on: { change: (e) => (opts.aiAggression = +e.target.value) } },
    [['0', 'Passive (AI never starts wars)'], ['0.5', 'Low'], ['1', 'Normal'], ['2', 'High'], ['4', 'Warmongering']].map(([v, n]) => h('option', { value: v, selected: v === '1' }, n)));
  const hist = h('select', { on: { change: (e) => (opts.historicalEvents = e.target.value) } },
    [['historical', 'Historical (countries usually choose what happened)'], ['plausible', 'Plausible (every option weighed on its merits)'], ['off', 'Off (no historical events)']].map(([v, n]) => h('option', { value: v, selected: v === 'historical' }, n)));
  const rate = h('select', { on: { change: (e) => (opts.eventRate = +e.target.value) } },
    [['0.5', 'Rare'], ['1', 'Normal'], ['2', 'Frequent']].map(([v, n]) => h('option', { value: v, selected: v === '1' }, n)));
  const seed = h('input', { placeholder: 'random', on: { input: (e) => (opts.seed = e.target.value.trim()) } });
  mount(app, h('div.screen', h('div.menu-card.wide',
    h('h2', 'New Game'),
    h('div.grid2',
      h('div', h('h4', 'Scenario'), list),
      h('div', detail,
        h('h4', 'Rules'),
        h('div.field', h('label', 'Difficulty (AI decision quality and ambition)'), diff),
        h('div.field', h('label', 'AI aggressiveness'), aggr),
        h('div.field', h('label', 'Historical events (dated events of the scenario\'s period; each still needs its conditions)'), hist),
        h('div.field', h('label', 'Random events (disasters, scandals, booms)'), rate),
        h('div.field', h('label', 'Random seed (same seed + same choices = same game)'), seed))),
    h('div.row.spread', { style: { marginTop: '1em' } },
      h('button', { on: { click: mainMenu } }, 'Back'),
      h('button.primary', { on: { click: async () => {
        const sc = await getScenario(sel);
        const game = newGame({ map: data.map, scenario: sc, rules: data.rules, playerTag: null,
          seed: opts.seed || String(Math.floor(Math.random() * 1e9)),
          settings: { difficulty: opts.difficulty, aiAggression: opts.aiAggression, historicalEvents: opts.historicalEvents, eventRate: opts.eventRate, autosaveMonths: data.settings.autosaveMonths, autosaveKeep: data.settings.autosaveKeep } });
        startClient(game, 'pick');
      } } }, 'Choose country →')))));
}

function loadScreen() {
  const slots = listSlots();
  const list = h('div.list');
  const render = () => mount(list, listSlots().map((s) => h('div.item.row.spread',
    h('div', h('b', s.name), h('div.muted', `${s.country || 'Observer'} · ${s.date || ''} · ${s.scenario || ''} · ${Math.round((s.size || 0) / 1024)} KB`)),
    h('div.row',
      h('button.primary', { on: { click: () => loadSlot(s.name) } }, 'Load'),
      h('button.danger', { on: { click: () => { deleteSave(s.name); render(); } } }, 'Delete')))));
  render();
  const file = h('input', { type: 'file', accept: '.json,.aoc3', on: { change: async (e) => {
    const f = e.target.files[0];
    if (f) loadText(await f.text());
  } } });
  mount(app, h('div.screen', h('div.menu-card.wide', h('h2', 'Load Game'),
    slots.length ? list : h('p.muted', isDesktop() ? 'No saved games yet.' : 'No saved games in this browser.'),
    h('div.field', { style: { marginTop: '1em' } }, h('label', 'Import a save file'), file),
    h('div.row', h('button', { on: { click: mainMenu } }, 'Back')))));
}

async function loadSlot(name) {
  let text = null;
  try { text = await readSave(name); } catch { return alertMsg('This save slot is damaged and cannot be read.'); }
  if (!text) return alertMsg('Save not found.');
  loadText(text);
}

async function loadText(text) {
  try {
    const peek = JSON.parse(text);
    const sc = await getScenario(peek.scenarioId);
    const game = loadGame(text, { map: data.map, rules: data.rules, scenario: sc });
    startClient(game, 'play');
  } catch (e) {
    alertMsg('Could not load save: ' + (e.message || e));
  }
}

function alertMsg(msg) {
  const wrap = h('div.dialog-wrap', h('div.dialog', h('p', msg), h('button', { on: { click: () => wrap.remove() } }, 'OK')));
  document.body.append(wrap);
}

function settingsScreen() {
  const s = data.settings;
  const prof = h('select', { on: { change: (e) => (s.profile = e.target.value) } },
    [['low', 'Low-end (fewer details, lower render scale)'], ['balanced', 'Balanced'], ['high', 'High-end (full resolution, more labels)']]
      .map(([v, n]) => h('option', { value: v, selected: s.profile === v }, n)));
  const scale = h('select', { on: { change: (e) => { s.uiScale = +e.target.value; applyUiScale(); } } },
    ['0.85', '1', '1.15', '1.3'].map((v) => h('option', { value: v, selected: String(s.uiScale) === v }, Math.round(+v * 100) + '%')));
  const autoM = h('select', { on: { change: (e) => (s.autosaveMonths = +e.target.value) } },
    [['0', 'Off'], ['1', 'Monthly'], ['3', 'Every 3 months'], ['6', 'Every 6 months'], ['12', 'Yearly']].map(([v, n]) => h('option', { value: v, selected: String(s.autosaveMonths) === v }, n)));
  const keep = h('input', { type: 'number', min: 1, max: 10, value: s.autosaveKeep, on: { change: (e) => (s.autosaveKeep = Math.max(1, Math.min(10, +e.target.value || 3))) } });
  mount(app, h('div.screen', h('div.menu-card', h('h2', 'Settings'),
    h('div.field', h('label', 'Performance profile (same gameplay in every profile)'), prof),
    h('div.field', h('label', 'Interface scale'), scale),
    h('div.field', h('label', 'Autosave'), autoM),
    h('div.field', h('label', 'Autosaves to keep'), keep),
    h('div.row', h('button.primary', { on: { click: () => { saveSettings(s); mainMenu(); } } }, 'Save & back')))));
}

let client = null;
function startClient(game, mode) {
  if (client) client.destroy();
  client = new Client(app, data, game, { mode, onExit: () => { client.destroy(); client = null; mainMenu(); }, onLoad: loadText });
  window.__client = client;
}

boot();
