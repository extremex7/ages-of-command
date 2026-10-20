// Hotseat multiplayer: two to eight humans share one computer, each leading a country; the
// others are AI. Everything lives in state.hotseat (saved with the game; absent in single player):
//   { mode, run, humans: [{ k, name, seq, record?, civil?, out? }], turn, stage, round, runFrom, runUntil }
// Two modes:
// - 'turns' (default): each human plans in turn while the game is paused; a handover screen hides
//   the previous human's view. When everyone has planned, the simulation runs for a week, a month
//   or until the next decision for a human, then the next round starts.
//   stage: 'handover' (waiting for humans[turn] to sit down) → 'plan' → … → 'ready' (everyone
//   planned, choose how long to run) → 'run' → 'handover' of the first human of the next round.
// - 'shared': time runs as in single player and the humans switch country with a key.
// state.player is the human at the screen (-1 between turns and while the simulation runs), so the
// interface works unchanged; the simulation asks isHuman() (state.js) instead of comparing with
// state.player. Decisions wait for their human: events and offers to a human who has not seen
// them yet do not expire, and their time to answer starts when that human's turn begins.
import { daysFromCivil, civilFromDays } from './calendar.js';
import { humanControls, importantTo, visibleTo, log } from './state.js';
import { startRecord, recordOf } from './record.js';

export const MIN_HUMANS = 2, MAX_HUMANS = 8;
export const RUNS = { week: 'A week', month: 'A month', event: 'Until the next event' };
const EVENT_RUN_CAP = 365; // "until the next event" stops after a year without one

// Starts a hotseat game. players: [{ k, name }]. Returns an error string or null.
export function startHotseat(state, players, { mode = 'turns', run = 'month' } = {}) {
  if (!Array.isArray(players) || players.length < MIN_HUMANS || players.length > MAX_HUMANS) return `Choose ${MIN_HUMANS} to ${MAX_HUMANS} players`;
  const ks = players.map((p) => p.k);
  if (ks.some((k) => !state.countries[k]?.alive)) return 'Every player needs a country';
  if (new Set(ks).size !== ks.length) return 'Each player needs a different country';
  state.hotseat = {
    mode: mode === 'shared' ? 'shared' : 'turns', run: RUNS[run] ? run : 'month',
    humans: players.map((p, i) => ({ k: p.k, name: String(p.name || '').trim().slice(0, 24) || `Player ${i + 1}`, seq: state.logSeq || 0 })),
    turn: 0, stage: mode === 'shared' ? 'shared' : 'handover', round: 1, runFrom: state.day, runUntil: state.day,
  };
  for (const H of state.hotseat.humans) { state.countries[H.k].automate = false; startRecord(state, H.k); }
  state.player = mode === 'shared' ? ks[0] : -1;
  return null;
}

export const hotseatOn = (state) => !!state.hotseat;
export const takingTurns = (state) => state.hotseat?.mode === 'turns';
export const humanOf = (state, k) => state.hotseat?.humans.find((h) => h.k === k) || null;
export const currentHuman = (state) => state.hotseat?.humans[state.hotseat.turn] || null;
const inGame = (state, H) => H.out == null && state.countries[H.k]?.alive;

// The human whose turn it is sits down: their view opens, and the events and offers waiting for
// them count as seen from today. Returns what they need to know since their last turn.
export function beginTurn(state) {
  const hs = state.hotseat, H = hs.humans[hs.turn];
  hs.stage = 'plan';
  state.player = H.k;
  for (const p of state.pendingEvents) if (p.c === H.k) p.seen ??= state.day;
  for (const o of state.offers) if (o.to === H.k) o.seen ??= state.day;
  return { human: H, news: newsFor(state, H), events: state.pendingEvents.filter((p) => p.c === H.k), offers: state.offers.filter((o) => o.to === H.k) };
}

// Important log entries for human H since they last looked (newest last).
export function newsFor(state, H, max = 40) {
  return state.log.filter((l) => l.seq > H.seq && importantTo(l, H.k)).slice(-max);
}

// The human at the screen is done planning: hand over to the next one, or (after the last) wait
// for the run to start. Returns the next stage.
export function endTurn(state) {
  const hs = state.hotseat, H = hs.humans[hs.turn];
  H.seq = state.logSeq || 0;
  state.player = -1;
  let next = hs.turn + 1;
  while (next < hs.humans.length && !inGame(state, hs.humans[next])) next++;
  if (next < hs.humans.length) { hs.turn = next; hs.stage = 'handover'; } else hs.stage = 'ready';
  return hs.stage;
}

// Everyone has planned: the simulation runs for the chosen period.
export function startRun(state, run = state.hotseat.run) {
  const hs = state.hotseat;
  if (RUNS[run]) hs.run = run;
  hs.stage = 'run';
  state.player = -1;
  hs.runFrom = state.day;
  if (hs.run === 'week') hs.runUntil = state.day + 7;
  else if (hs.run === 'month') {
    const d = civilFromDays(state.day), y = d.m === 12 ? d.y + 1 : d.y, m = d.m === 12 ? 1 : d.m + 1;
    hs.runUntil = daysFromCivil(y, m, Math.min(d.d, 28));
  } else hs.runUntil = state.day + EVENT_RUN_CAP;
  return hs.runUntil;
}

// Something a human must decide or know at once came up during the run (for "until the next
// event"): an event or an offer for them, their country splitting, or a new war they are in.
export function decisionWaiting(state) {
  const hs = state.hotseat, from = hs.runFrom;
  const mine = (k) => hs.humans.some((H) => H.k === k && inGame(state, H));
  return state.pendingEvents.some((p) => p.day > from && mine(p.c))
    || state.offers.some((o) => o.day > from && mine(o.to))
    || hs.humans.some((H) => H.civil)
    || state.wars.some((w) => w.start > from && [...w.attackers, ...w.defenders].some(mine));
}

// Checked after every simulated day of a run: true when the run is over.
export function runOver(state) {
  const hs = state.hotseat;
  if (hs?.stage !== 'run') return false;
  return !!state.gameOver || state.day >= hs.runUntil || (hs.run === 'event' && decisionWaiting(state));
}

// The run is over: the first human still in the game takes the next turn.
export function endRun(state) {
  const hs = state.hotseat;
  hs.round++;
  hs.turn = Math.max(0, hs.humans.findIndex((H) => inGame(state, H)));
  hs.stage = 'handover';
  state.player = -1;
}

// 'shared' mode: the next human (still in the game) takes the controls.
export function switchHuman(state, i = null) {
  const hs = state.hotseat, n = hs.humans.length;
  if (i == null) { i = hs.turn; for (let s = 0; s < n; s++) { i = (i + 1) % n; if (inGame(state, hs.humans[i])) break; } }
  hs.turn = i;
  state.player = hs.humans[i].k;
  return hs.humans[i];
}

// Human at country `from` now leads `to` (the rebels of a civil war, or a country taken over).
export function moveHuman(state, from, to) {
  const H = humanOf(state, from);
  if (!H || (to !== from && humanOf(state, to))) return 'Another player leads that country';
  H.k = to;
  state.countries[to].automate = false;
  if (state.player === from) state.player = to;
  recordOf(state, to); // a fresh record, remembering the country left
  return null;
}

// A peace offer from one human to another (answered in the Diplomacy tab in their turn).
// kind: 'peace' (war leaders) or 'separate' (a participant leaving the war).
export function offerToHuman(state, kind, war, from, to, terms) {
  if (!humanControls(state, to)) return 'They are not a human player';
  if (state.offers.some((o) => o.kind === kind && o.war === war.id && o.from === from && o.to === to)) return 'Already offered; waiting for their answer';
  state.offers.push({ id: state.nextId++, kind, war: war.id, from, to, terms, day: state.day });
  log(state, 'diplomacy', `${state.countries[from].name} sent ${state.countries[to].name} ${kind === 'separate' ? 'a request for a separate peace' : 'peace terms'} in the ${war.name}.`, { who: from });
  return null;
}

// The log as human k sees it (single player: all of it).
export function logOf(state, k = state.player) {
  return state.hotseat ? state.log.filter((l) => visibleTo(l, k)) : state.log;
}

// Who the humans are, for save slots: "Alice (France), Bob (Germany)".
export function humansLabel(state) {
  return state.hotseat.humans.map((H) => `${H.name} (${state.countries[H.k].name})`).join(', ');
}

// After loading: drop humans whose country does not exist, and never reopen a turn in the middle
// (whoever loads the game is shown the handover screen first).
export function checkHotseat(state) {
  const hs = state.hotseat;
  if (!hs) return;
  if (!Array.isArray(hs.humans)) { delete state.hotseat; return; }
  hs.humans = hs.humans.filter((H) => Number.isInteger(H?.k) && state.countries[H.k]);
  if (!hs.humans.length) { delete state.hotseat; return; }
  for (const H of hs.humans) { H.name ||= 'Player'; H.seq ??= 0; }
  hs.mode = hs.mode === 'shared' ? 'shared' : 'turns';
  if (!RUNS[hs.run]) hs.run = 'month';
  if (!(hs.turn >= 0 && hs.turn < hs.humans.length)) hs.turn = 0;
  hs.round ||= 1;
  if (hs.mode === 'shared') { hs.stage = 'shared'; state.player = hs.humans[hs.turn].k; return; }
  if (!['handover', 'plan', 'ready', 'run'].includes(hs.stage) || hs.stage === 'plan') hs.stage = 'handover';
  if (hs.stage !== 'run') state.player = -1;
}

