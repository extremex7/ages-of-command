// Hotseat multiplayer in the interface (rules in src/core/hotseat.js): the New Game fields, the
// country pick for each player, the handover screen that hides one player's view from the next,
// the "run the simulation" screen, the top-bar buttons, and the per-player notifications.
import { h, mount } from './dom.js';
import { formatDate } from '../core/calendar.js';
import { computeLedgers } from '../core/economy.js';
import { importantTo } from '../core/state.js';
import { summary } from '../core/record.js';
import { startHotseat, beginTurn, endTurn, startRun, runOver, endRun, switchHuman, currentHuman, humanOf, moveHuman, MIN_HUMANS, MAX_HUMANS, RUNS } from '../core/hotseat.js';
import { flagCanvas } from './flags.js';
import { people, money } from './format.js';
import { sfx } from './audio.js';
import { openDialog, saveDialog, civilWarDialog } from './dialogs.js';
import { summaryDialog } from './summary.js';

const MODES = { turns: 'Take turns (each plans in private, then time runs)', shared: 'Shared screen (time runs; switch country with F2)' };
const RUN_SPEED = 4; // days a second while a round runs (20); any speed can be chosen meanwhile

// New Game: number of players, their names, the turn mode and how long a round runs.
// opts.hs = { count, names, mode, run } is read when the game starts.
export function hotseatFields(opts) {
  const hs = opts.hs = { count: 1, names: [], mode: 'turns', run: 'month' };
  const more = h('div');
  const draw = () => mount(more, hs.count > 1 && h('div',
    Array.from({ length: hs.count }, (_, i) => h('div.field', h('label', `Player ${i + 1} name`),
      h('input.hs-name', { value: hs.names[i] || '', placeholder: `Player ${i + 1}`, on: { input: (e) => (hs.names[i] = e.target.value) } }))),
    h('div.field', h('label', 'How the players share the game'), h('select.hs-mode', { on: { change: (e) => { hs.mode = e.target.value; draw(); } } },
      Object.entries(MODES).map(([v, n]) => h('option', { value: v, selected: v === hs.mode }, n)))),
    hs.mode === 'turns' && h('div.field', h('label', 'After everyone has planned, time runs for'), h('select', { on: { change: (e) => (hs.run = e.target.value) } },
      Object.entries(RUNS).map(([v, n]) => h('option', { value: v, selected: v === hs.run }, n)))),
    h('p.muted', 'Every player picks a country on the next screen; the other countries are run by the AI. Achievements are not earned in hotseat games.')));
  const count = h('select.hs-count', { on: { change: (e) => { hs.count = +e.target.value; draw(); } } },
    h('option', { value: 1, selected: true }, '1 (single player)'),
    Array.from({ length: MAX_HUMANS - MIN_HUMANS + 1 }, (_, i) => h('option', { value: i + MIN_HUMANS }, `${i + MIN_HUMANS} players at this computer (hotseat)`)));
  draw();
  return h('div', h('div.field', h('label', 'Players'), count), more);
}

// The pick screen of a hotseat game: each player in turn clicks a country and takes it.
export function renderHotseatPick(cl) {
  const s = cl.state, C = s.countries, hs = cl.opts.hotseat, picks = (cl.hsPicks ||= []);
  const i = picks.length, name = hs.names[i]?.trim() || `Player ${i + 1}`, sel = cl.view.selectedCountry;
  const taken = (k) => picks.find((p) => p.k === k);
  cl.bannerEl.style.display = '';
  const c = sel >= 0 ? C[sel] : null;
  mount(cl.bannerEl, h('div', h('b', `${name}, choose your country`), h('div.muted', `Player ${i + 1} of ${hs.count}${picks.length ? ' · taken: ' + picks.map((p) => `${C[p.k].name} (${p.name})`).join(', ') : ''}`)),
    c && flagCanvas(c, true), c && h('div', h('b', c.name), h('div.muted', `${people(c.cache.pop)} people · GDP ${money(c.cache.gdp)}/yr`)),
    c && h('button.primary.hs-take', { disabled: !!taken(sel), tip: taken(sel) ? `Taken by ${taken(sel).name}` : '', on: { click: () => {
      picks.push({ k: sel, name });
      cl.view.selectedCountry = -1; cl.view.selected = -1;
      if (picks.length === hs.count) startHotseatGame(cl);
      cl.uiDirty = true; cl.requestFrame();
    } } }, `${name} plays ${c.name}`),
    picks.length > 0 && h('button', { on: { click: () => { picks.pop(); cl.uiDirty = true; cl.requestFrame(); } } }, 'Undo last pick'),
    h('button', { on: { click: () => cl.opts.onExit() } }, 'Back'));
}

function startHotseatGame(cl) {
  const s = cl.state, hs = cl.opts.hotseat;
  const err = startHotseat(s, cl.hsPicks, { mode: hs.mode, run: hs.run });
  if (err) return cl.toast(err, true);
  cl.mode = 'play';
  cl.bannerEl.style.display = 'none';
  computeLedgers(s, cl.game.map, cl.game.rules);
  cl.tab = 'country';
  showStage(cl);
}

// Shows what the current stage needs: the handover screen, the run screen, or (in a player's turn
// or the shared mode) the game itself.
export function showStage(cl) {
  const s = cl.state, hs = s.hotseat;
  cl.el.querySelector('.hotseat-cover')?.remove();
  cl.renderer.focus = s.player; cl.renderer.invalidate();
  cl.uiDirty = true; cl.requestFrame();
  if (hs.mode === 'shared') { if (s.player >= 0) cl.focusCountry(s.player, false); return; }
  if (hs.stage === 'handover') cover(cl, handoverScreen(cl));
  else if (hs.stage === 'ready') cover(cl, readyScreen(cl));
  else if (hs.stage === 'plan') cl.focusCountry(s.player, false);
}

function cover(cl, ...content) {
  cl.clearSelection();
  document.querySelector('.dialog-wrap')?.remove();
  const el = h('div.hotseat-cover', h('div.menu-card', ...content));
  cl.el.append(el);
  el.querySelector('button.primary')?.focus({ preventScroll: true });
}

function coverButtons(cl) {
  return h('div.row', { style: { marginTop: '1em' } },
    h('button', { on: { click: () => saveDialog(cl) } }, 'Save game'),
    h('button.danger', { on: { click: () => cl.opts.onExit() } }, 'Exit to main menu'));
}

function handoverScreen(cl) {
  const s = cl.state, hs = s.hotseat, H = currentHuman(s), c = s.countries[H.k];
  return [h('div.muted', `Round ${hs.round} · ${formatDate(s.day)}`),
    h('h2', `Pass the computer to ${H.name}`),
    h('div.row', flagCanvas(c, true), h('div', h('b', c.name), h('div.muted', 'Everyone else, look away until the next handover.'))),
    h('div.row', { style: { marginTop: '1em' } }, h('button.primary.hs-start', { on: { click: () => startTurn(cl) } }, `I am ${H.name}: start my turn`)),
    coverButtons(cl)];
}

function readyScreen(cl) {
  const s = cl.state, hs = s.hotseat;
  return [h('div.muted', `Round ${hs.round} · ${formatDate(s.day)}`),
    h('h2', 'Everyone has planned'),
    h('p', 'Run the simulation for:'),
    h('div.menu-buttons', Object.entries(RUNS).map(([v, n]) => h('button' + (v === hs.run ? '.primary' : '') + '.hs-run', { on: { click: () => runRound(cl, v) } }, n))),
    h('p.muted', 'While it runs nobody can give orders; decisions that come up wait for their player\'s next turn.'),
    coverButtons(cl)];
}

function startTurn(cl) {
  const s = cl.state, t = beginTurn(s);
  showStage(cl);
  cl.logSeen = s.logSeq || 0;
  cl.updateMood();
  const H = t.human;
  const next = () => {
    if (H.civil) { const cc = H.civil; delete H.civil; return civilWarDialog(cl, cc); }
    const ev = s.pendingEvents.find((p) => p.c === H.k);
    if (ev) cl.openEvent(ev);
  };
  if (!t.news.length && !t.offers.length) return next();
  const w = openDialog(cl, h('h2', `${H.name}'s turn: ${s.countries[H.k].name}`),
    h('p.muted', t.news.length ? 'Since your last turn:' : 'Nothing important happened to you since your last turn.'),
    t.news.length > 0 && h('div.list.hs-news', t.news.slice().reverse().map((l) => h('div.log-item' + (l.important ? '.imp' : ''), h('span.d', formatDate(l.day)), l.text))),
    t.offers.length > 0 && h('p.warn', `${t.offers.length} proposal(s) wait for your answer in the Diplomacy tab.`),
    h('div.row', h('button.primary', { on: { click: () => { w.remove(); next(); } } }, 'Continue')));
}

// The player at the screen is done planning.
export function finishTurn(cl) {
  const s = cl.state;
  if (s.hotseat?.stage !== 'plan') return;
  document.querySelector('.dialog-wrap')?.remove();
  cl.setSpeed(0);
  endTurn(s);
  sfx('click');
  showStage(cl);
}

function runRound(cl, run) {
  const s = cl.state;
  startRun(s, run);
  cl.el.querySelector('.hotseat-cover')?.remove();
  cl.logSeen = s.logSeq || 0;
  cl.renderer.focus = -1; cl.renderer.invalidate();
  cl.updateMood();
  cl.speed = cl.pausedSpeed || RUN_SPEED; cl.acc = 0; cl.uiDirty = true; cl.requestFrame();
}

// After each simulated day (client.doTick).
export function hotseatTicked(cl) {
  const s = cl.state;
  if (!runOver(s)) return;
  cl.pausedSpeed = cl.speed || cl.pausedSpeed;
  cl.speed = 0;
  endRun(s);
  if (s.gameOver) return;
  showStage(cl);
}

// Time only runs in a round's run, or in the shared mode. Returns a reason when it may not.
export function timeBlocked(cl) {
  const hs = cl.state.hotseat;
  if (!hs || hs.mode === 'shared' || hs.stage === 'run') return null;
  return hs.stage === 'plan' ? 'Time runs once everyone has planned: press End turn when you are done.' : 'Waiting for the next player.';
}

// Top-bar controls: End turn in a player's turn, the round's end date while it runs, the player
// switch in the shared mode.
export function hotseatTop(cl) {
  const s = cl.state, hs = s.hotseat;
  if (!hs || cl.mode !== 'play') return null;
  const H = currentHuman(s);
  if (hs.mode === 'shared') return h('button.hs-switch', { tip: 'Give the controls to the next player (F2)', on: { click: () => switchPlayer(cl) } }, `${H.name} ▸`);
  if (hs.stage === 'plan') return h('button.primary.hs-end', { tip: `End ${H.name}'s turn and hand over to the next player`, on: { click: () => finishTurn(cl) } }, 'End turn');
  if (hs.stage === 'run') return h('span.muted.hs-running', `Round ${hs.round}: running ${hs.run === 'event' ? 'until the next event' : 'until ' + formatDate(hs.runUntil)}`);
  return null;
}

// Shared mode: the next player takes the controls (F2 or the top-bar button).
export function switchPlayer(cl, k = null) {
  const s = cl.state, hs = s.hotseat;
  if (hs?.mode !== 'shared') return;
  const H = k == null ? switchHuman(s) : switchHuman(s, hs.humans.indexOf(humanOf(s, k)));
  cl.clearSelection();
  showStage(cl);
  cl.updateMood();
  cl.toast(`${H.name} (${s.countries[H.k].name}) has the controls.`);
}

// The leader of a human country chose to take over another (civil war rebels).
export function hotseatMove(cl, k) {
  const err = moveHuman(cl.state, cl.state.player, k);
  if (err) return cl.toast(err, true);
  showStage(cl);
}

// client.afterTicks for hotseat games: notifications go to the human they concern. While a round
// runs, only public news is shown; private news waits for that player's turn.
export function hotseatAfterTicks(cl) {
  const s = cl.state, hs = s.hotseat, me = s.player;
  cl.uiDirty = true;
  let sound = false;
  for (const l of s.log) {
    if (l.seq <= cl.logSeen) continue;
    const show = me >= 0 ? importantTo(l, me) || (l.type === 'battle' && l.report && l.who === me) : l.important === true && l.who == null;
    if (show) { cl.toast(l.text, !!l.important, l.prov); sound = true; }
  }
  if (sound) sfx('notify');
  cl.logSeen = s.logSeq || 0;
  if (hs.mode === 'shared') {
    // decisions for any player: give them the controls first
    for (const o of s.offers) {
      const H = humanOf(s, o.to);
      if (!H || o.notified) continue;
      o.notified = true;
      cl.toast(`${H.name}: ${s.countries[o.from].name} sent a proposal (Diplomacy tab).`, o.kind !== 'treaty');
      if (cl.speed && o.kind !== 'treaty') cl.setSpeed(0);
    }
    const civil = hs.humans.find((H) => H.civil);
    const ev = s.pendingEvents.find((p) => humanOf(s, p.c) && !p.shown);
    if (civil) { if (civil.k !== me) switchPlayer(cl, civil.k); const cc = civil.civil; delete civil.civil; cl.autoPause(); civilWarDialog(cl, cc); }
    else if (ev && !document.querySelector('.dialog-wrap')) { if (ev.c !== me) switchPlayer(cl, ev.c); ev.shown = true; cl.autoPause(); cl.openEvent(ev); }
  }
  if (s.gameOver && !cl.gameOverShown) {
    cl.gameOverShown = true; cl.speed = 0;
    cl.el.querySelector('.hotseat-cover')?.remove();
    finalSummary(cl);
  }
  cl.dropGone();
}

// The end of a hotseat game: every player's headline, each with their own summary.
function finalSummary(cl) {
  const s = cl.state;
  openDialog(cl, h('h2', 'The end of the game'), h('p.muted', s.gameOver.reason),
    h('div.list', s.hotseat.humans.map((H) => {
      const S = summary(s, H.k);
      return h('div.item', h('b', `${H.name} (${s.countries[H.k].name})`), h('div', S?.headline || ''),
        S && h('button', { on: { click: () => summaryDialog(cl, { ended: true, k: H.k }) } }, 'Summary'));
    })),
    h('div.row', h('button.primary', { on: { click: () => cl.opts.onExit() } }, 'Main menu')));
}
