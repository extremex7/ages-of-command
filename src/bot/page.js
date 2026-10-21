// The bot window (bot.html): pick a save, how long to play and how much of the computer to use,
// then watch the bot play the player's country. The simulation runs in a Web Worker (runner.js);
// this page keeps the storage: it reads the chosen save and writes the bot's own save slot,
// "Bot – <country> <date>", every in-game year and when the bot stops. The slot is new (the
// save it started from is never touched) and replaced by the next one of the same run, so a run
// leaves one slot. Every bot save has the country back under the player's control.
import { h, mount } from '../ui/dom.js';
import { money, people, pct } from '../ui/format.js';
import { initStorage, syncSlots, readSave, writeSave, deleteSave, readScenario, isDesktop } from '../ui/storage.js';

const app = document.getElementById('app');
const CPU = [[1, 'Full speed (one processor core)'], [0.5, 'Half (leaves room for other programs)'], [0.2, 'Light (quiet laptop fans)']];
const YEARS = [[0, 'Until I stop it'], [1, '1 year'], [5, '5 years'], [10, '10 years'], [25, '25 years'], [50, '50 years'], [100, '100 years']];
const ui = { years: 0, cpu: 1, pick: null };
let worker = null, run = null; // run: { from, slot (our latest slot name), writing, queued, final, report }
window.__bot = ui; // for tests

function send(msg) { worker.postMessage(msg); }

// the worker, or the same code on this page when workers are unavailable
function startWorker() {
  try {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => onMessage(e.data);
    w.onerror = (e) => { e.preventDefault(); if (!run?.started) { worker = inPage(); retry(); } };
    return w;
  } catch {
    return inPage();
  }
}
function inPage() {
  // the simulation code is loaded only here (the worker loads its own copy)
  const r = import('./runner.js').then(({ createRunner }) => createRunner((m) => setTimeout(() => onMessage(m), 0)));
  return { postMessage: (m) => { r.then((x) => x.handle(m)); }, inPage: true };
}
let pending = null;
function retry() { if (pending) send(pending); }

async function boot() {
  await initStorage({ preload: ['slots', 'settings', 'scenarios'] });
  worker = startWorker();
  menu();
}

async function menu(note = null) {
  const slots = (await syncSlots()).slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  if (!slots.some((s) => s.name === ui.pick)) ui.pick = slots[0]?.name ?? null;
  const list = h('div.list');
  const render = () => mount(list, slots.map((s) => h('div.item' + (s.name === ui.pick ? '.sel' : ''), { on: { click: () => { ui.pick = s.name; render(); } }, 'data-slot': s.name },
    h('b', s.name), h('div.muted', `${s.country || 'Observer'} · ${s.date || ''} · ${s.scenario || ''}${s.savedAt ? ' · saved ' + new Date(s.savedAt).toLocaleString() : ''}`))));
  render();
  const sel = (opts, key) => h('select', { id: 'bot-' + key, on: { change: (e) => (ui[key] = +e.target.value) } },
    opts.map(([v, n]) => h('option', { value: String(v), selected: v === ui[key] }, n)));
  mount(app, h('div.screen', h('div.menu-card.wide',
    h('h2', 'Ages of Command Bot'),
    h('p.muted', 'The bot plays your country while you are away, making every decision the way the computer opponents do, at their strongest. It never changes the save you pick: it writes its own save, "Bot – country date", every game year and when it stops, with your country back under your control. Load that save in the game to carry on.'),
    note && h('p', { className: note.bad ? 'bad' : 'good' }, note.text),
    slots.length ? list : h('p.muted', isDesktop() ? 'No saved games yet. Start a game, save it, then come back.' : 'No saved games in this browser yet.'),
    h('div.grid2', { style: { marginTop: '1em' } },
      h('div.field', h('label', 'How long to play'), sel(YEARS, 'years')),
      h('div.field', h('label', 'Computer use'), sel(CPU, 'cpu'))),
    h('p.muted', 'Close the game window first, or at least do not play the same game in both windows at once: the bot plays a copy.'),
    h('div.row', h('button.primary#bot-start', { disabled: !slots.length, on: { click: () => start(slots.find((s) => s.name === ui.pick)) } }, 'Start the bot')))));
}

async function start(slot) {
  if (!slot) return;
  let text;
  try { text = await readSave(slot.name); } catch { return menu({ bad: true, text: 'This save is damaged and cannot be read.' }); }
  if (!text) return menu({ bad: true, text: 'Save not found.' });
  let scenario = null;
  try {
    const id = JSON.parse(text).scenarioId;
    scenario = await readScenario(id); // a custom scenario from the editor (null for the built-in ones)
  } catch { /* the runner reports a damaged save */ }
  run = { from: slot.name, slot: null, writing: false, queued: null, final: null, started: false, report: null };
  ui.status = 'Starting…';
  pending = { cmd: 'start', text, scenario, years: ui.years, cpu: ui.cpu };
  send(pending);
  view();
}

function onMessage(m) {
  if (!run) return;
  if (m.type === 'status') { ui.status = m.text; view(); }
  else if (m.type === 'started') { run.started = true; pending = null; run.report = m.report; ui.status = 'Playing'; ui.where = worker.inPage ? 'page' : 'worker'; view(); }
  else if (m.type === 'progress') { run.report = m.report; run.speed = m.speed; view(); }
  else if (m.type === 'save') { run.report = m.report; queueSave(m); view(); }
  else if (m.type === 'error') {
    if (!run.started) { const was = run; run = null; return menu({ bad: true, text: `Could not start the bot on "${was.from}": ${m.text}` }); }
    run.error = m.text; view();
  }
}

// Saves are written one at a time; a newer one waiting replaces an older one not yet written.
function queueSave(m) {
  run.queued = m;
  if (!run.writing) writeNext();
}
async function writeNext() {
  const m = run.queued;
  if (!m) return;
  run.queued = null; run.writing = true;
  const taken = (await syncSlots()).map((s) => s.name).filter((n) => n !== run.slot);
  let name = `Bot – ${m.info.country} ${m.info.date}`;
  for (let i = 2; taken.includes(name) || name === run.from; i++) name = `Bot – ${m.info.country} ${m.info.date} (${i})`;
  const err = await writeSave(name, m.text, m.info);
  if (err) run.saveError = err;
  else {
    // the run keeps one slot: the one it wrote before goes (never the save it started from)
    if (run.slot && run.slot !== name && run.slot !== run.from) await deleteSave(run.slot);
    run.slot = name; run.savedAt = Date.now(); run.saveError = null;
  }
  run.writing = false;
  if (m.final) run.final = { name: err ? null : name, err };
  if (run.queued) writeNext();
  view();
}

function stop() {
  if (!run || run.final || run.stopping) return;
  run.stopping = true;
  send({ cmd: 'stop' });
  view();
}

const row = (label, a, b, fmt = (x) => x) => h('tr', h('td.muted', label), h('td', fmt(a)), h('td', fmt(b)));
let lastView = 0, viewTimer = null;
function view() {
  // at most a few redraws a second
  const t = performance.now();
  if (t - lastView < 250) { if (!viewTimer) viewTimer = setTimeout(() => { viewTimer = null; view(); }, 260); return; }
  lastView = t;
  const r = run?.report, done = run?.final;
  const head = h('div',
    h('h2', r ? `Bot playing ${r.country}` : 'Ages of Command Bot'),
    h('p.muted', `From save "${run.from}"${ui.years ? `, for ${ui.years} year${ui.years === 1 ? '' : 's'}` : ', until stopped'}${worker?.inPage ? ' (running on the page: keep this window visible)' : ''}.`));
  if (!r) return mount(app, h('div.screen', h('div.menu-card.wide', head, h('p#bot-status', ui.status || ''))));
  const f = r.from, n = r.now, years = r.years;
  const status = done ? (done.err ? `Stopped, but the last save failed: ${done.err}` : `${r.done || 'Stopped.'} Saved as "${done.name}". Open the game and load it to carry on.`)
    : run.stopping ? 'Stopping and saving…' : `Playing: ${n.date}${run.speed ? ` · ${Math.round(run.speed)} game days a second` : ''}`;
  const table = h('table.bot-table', h('tr', h('th', ''), h('th', 'At the start'), h('th', 'Now')),
    row('Date', f.date, n.date), row('Country', f.name, n.name),
    row('Provinces', f.provinces, n.provinces), row('Population', f.pop, n.pop, people),
    row('GDP a year', f.gdp, n.gdp, money), row('Share of world GDP', f.gdpShare, n.gdpShare, (x) => pct(x, 2)),
    row('Treasury (debt if negative)', f.treasury, n.treasury, money), row('Monthly balance', f.net, n.net, money),
    row('World rank', f.rank, n.rank, (x) => (x ? '#' + x : '–')), row('Score', f.score, n.score, (x) => x.toFixed(1)),
    row('Technologies', f.techs, n.techs), row('Era', f.eraName, n.eraName), row('Stability', f.stability, n.stability, (x) => Math.round(x)),
    row('Wars being fought', f.wars, n.wars));
  const rec = r.record, cnt = r.counts;
  const tally = [`${years.toFixed(1)} years played`, `wars won ${rec.warsWon}, lost ${rec.warsLost}, white peace ${rec.whitePeace}`, `battles won ${rec.battlesWon}, lost ${rec.battlesLost}`];
  for (const [k, label] of [['formed', 'nations formed'], ['annexed', 'countries annexed'], ['golden', 'golden-age news'], ['revolt', 'revolts'], ['war', 'wars declared']]) if (cnt[k]) tally.push(`${label} ${cnt[k]}`);
  mount(app, h('div.screen', h('div.menu-card.wide',
    head,
    h('p#bot-status', { className: done?.err || run.error ? 'bad' : done ? 'good' : '' }, status),
    run.error && h('p.bad', run.error), run.saveError && !done && h('p.bad', `Could not save: ${run.saveError}`),
    run.slot && !done && h('p.muted#bot-slot', `Latest save: "${run.slot}"${run.savedAt ? ' at ' + new Date(run.savedAt).toLocaleTimeString() : ''}.`),
    h('div.row', !done && h('button.primary#bot-stop', { disabled: !!run.stopping, on: { click: stop } }, 'Stop and save'),
      !done && h('select', { id: 'bot-cpu-live', on: { change: (e) => { ui.cpu = +e.target.value; send({ cmd: 'cpu', cpu: ui.cpu }); } } }, CPU.map(([v, nm]) => h('option', { value: String(v), selected: v === ui.cpu }, nm))),
      done && h('button.primary#bot-again', { on: { click: () => { run = null; menu(); } } }, 'Back to the list')),
    table,
    h('p.muted', tally.join(' · ')),
    r.decisions.length > 0 && h('div', h('h4', 'Decisions waiting for you that the bot answered'), h('div.list', { style: { maxHeight: '20vh' } }, r.decisions.map((d) => h('div.item', d)))),
    h('h4', 'What happened'),
    r.events.length ? h('div.list#bot-events', { style: { maxHeight: '30vh' } }, r.events.slice().reverse().map((e) => h('div.item', h('span.muted', e.date + ' '), e.text))) : h('p.muted', 'Nothing notable yet.'))));
}

// closing the window while a save is being written would lose it
window.addEventListener('beforeunload', (e) => { if (run && !run.final && run.started) { e.preventDefault(); e.returnValue = ''; } });

boot();
