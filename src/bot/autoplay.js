// The bot: plays the player's country while they are away, then hands it back.
//
// A plain ES module with no DOM or Node dependencies, used by the bot window (bot.html through
// src/bot/worker.js) and the command line (tools/autoplay.mjs). It takes a loaded game, gives the
// player's country to the AI (c.automate, src/core/automate.js) at the bot profile below, runs
// the simulation in chunks so the caller can yield, keeps a progress report, and on stop gives
// the country back with the player's own settings and produces a save. Every save it makes has
// the country back under the player's control, so loading it simply continues the game.
import { tick } from '../core/sim.js';
import { saveGame } from '../core/game.js';
import { handToAI, handBack, settlePending } from '../core/automate.js';
import { formatDate, civilFromDays } from '../core/calendar.js';
import { recordFor } from '../core/record.js';
import { formStatus, formNation, holderOf } from '../core/nations.js';

// How the bot plays (measured in docs/BOT.md, "How well it plays"): the AI's own decisions, with
// the hard difficulty's war appetite and an AI aggression of 1.5 for this country only (1.5 beat
// 1 and 2 over 30 years from 1444), and the right to start wars; nations are formed as soon as
// they can be (the AI otherwise waits for a random roll).
export const BOT_PROFILE = { aggression: 1.5, difficulty: 'hard', war: true };
export const BOT_EXTRAS = { formNations: true };

// Why a game cannot be played by the bot, or null.
export function botProblem(state) {
  if (state.hotseat) return 'The bot plays single-player games only (this is a hotseat game).';
  if (!(state.player >= 0)) return 'This save has no player country (observer mode).';
  if (!state.countries[state.player]?.alive) return 'The player\'s country no longer exists.';
  if (state.gameOver) return `This game is over: ${state.gameOver.reason}`;
  return null;
}

// Figures for the report: one snapshot of the player's country.
export function snapshot(state) {
  const k = state.player, c = state.countries[k], P = state.prestige, L = c.ledger;
  const world = state.countries.reduce((s, x) => s + (x.alive ? x.cache?.gdp || 0 : 0), 0);
  return {
    day: state.day, date: formatDate(state.day), name: c.name, alive: !!c.alive,
    provinces: c.cache?.provinces || 0, pop: c.cache?.pop || 0, gdp: c.cache?.gdp || 0, gdpShare: world ? (c.cache?.gdp || 0) / world : 0,
    treasury: c.treasury, revenue: L?.revenue || 0, net: L?.net || 0,
    rank: P?.rank?.[k] || 0, score: P?.score?.[k] || 0, prestigeBonus: c.prestigeBonus || 0,
    techs: c.tfx?.known || 0, era: c.tfx?.era ?? 0, stability: c.stability,
    armies: state.armies.filter((a) => a.owner === k).length,
    wars: state.wars.filter((w) => w.attackers.includes(k) || w.defenders.includes(k)).length,
  };
}

// Log lines worth reporting: what happened to the player's country.
const NOTABLE = [
  ['formed', /has proclaimed/], ['golden', /golden age/i], ['dark', /dark age/i], ['revolt', /rebel unit\(s\) have taken up arms|Civil war in/],
  ['war', /declared war on/], ['peace', /^Peace:|White peace|separate peace/], ['annexed', /has ceased to exist|annex/i],
  ['victory', /victory/i], ['religion', /state religion/], ['government', /government|constitution|revolution/i],
];

export class Autoplay {
  // opts: years (0 = until stopped), profile, extras
  constructor(game, opts = {}) {
    const why = botProblem(game.state);
    if (why) throw new Error(why);
    this.game = game;
    this.years = Math.max(0, +opts.years || 0);
    this.profile = opts.profile === undefined ? BOT_PROFILE : opts.profile;
    this.extras = { ...BOT_EXTRAS, ...(opts.extras || {}) };
    this.k = game.state.player;
    this.handle = null;
    this.events = [];
    this.counts = {};
    this.decisions = [];
    this.stopped = null;
  }

  // Takes over the country (answers anything waiting for the player first).
  start() {
    const { state, map, rules } = this.game;
    this.handle = handToAI(state, map, rules, this.k, this.profile);
    this.decisions.push(...this.handle.settled);
    this.startDay = state.day;
    this.endDay = this.years ? state.day + Math.round(this.years * 365.25) : Infinity;
    this.from = snapshot(state);
    this.recordStart = { ...(recordFor(state, this.k)?.n || {}) };
    this.logSeq = state.logSeq || 0;
    this.lastYear = civilFromDays(state.day).y;
    return this;
  }

  get running() { return !!this.handle && !this.stopped; }

  // Why the run is over (the time asked for, the game ended, the country is gone), or null.
  finished() {
    const s = this.game.state;
    if (s.gameOver) return `Game over: ${s.gameOver.reason}`;
    if (!s.countries[this.k].alive) return 'The country was annexed.';
    if (s.player !== this.k) return 'The player now leads another country.';
    if (s.day >= this.endDay) return `Played the ${this.years} year${this.years === 1 ? '' : 's'} asked for.`;
    return null;
  }

  // Runs up to n days (fewer when the run is over or `budgetMs` of real time has passed).
  // Returns { days, newYear, done } where done is the reason the run is over or null.
  step(n, budgetMs = Infinity) {
    if (!this.running) throw new Error('The bot is not running');
    const g = this.game, s = g.state, t0 = now();
    let days = 0, newYear = false;
    while (days < n) {
      if (this.finished()) break;
      const { monthly } = tick(g);
      days++;
      if (monthly) {
        this.monthly();
        const y = civilFromDays(s.day).y;
        if (y !== this.lastYear) { this.lastYear = y; newYear = true; }
      }
      if (now() - t0 >= budgetMs) break;
    }
    this.collect();
    return { days, newYear, done: this.finished() };
  }

  monthly() {
    const { state, map, rules } = this.game;
    // nothing should be waiting (the AI answers at once), but a save from an older version could
    // still queue something: answer it so the game never waits for the player
    const extra = settlePending(state, map, rules, this.k);
    if (extra.length) this.decisions.push(...extra);
    if (this.extras.formNations && rules.nations) {
      for (const id of rules.nations.formableIds) {
        if (holderOf(state, rules, id) >= 0 || !formStatus(state, map, rules, this.k, id).ok) continue;
        const F = rules.nations.formables[id];
        if (!formNation(state, map, rules, this.k, id)) this.decisions.push(`Formed ${F.name}`);
      }
    }
  }

  // Picks the player's notable log entries since the last call.
  collect() {
    const s = this.game.state, c = s.countries[this.k];
    for (const l of s.log) {
      if (l.seq <= this.logSeq) continue;
      if (l.who != null && l.who !== this.k) continue;
      const mine = l.country === this.k || l.text.includes(c.name) || (this.from && l.text.includes(this.from.name));
      if (!mine) continue;
      const tag = NOTABLE.find(([, re]) => re.test(l.text))?.[0];
      if (!tag && !l.important) continue;
      if (tag) this.counts[tag] = (this.counts[tag] || 0) + 1;
      this.events.push({ day: l.day, date: formatDate(l.day), tag: tag || 'other', text: l.text });
    }
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    this.logSeq = s.logSeq || 0;
  }

  // Start against now, the player's war record and what happened.
  report() {
    const s = this.game.state, n = recordFor(s, this.k)?.n || {}, d = (x) => (n[x] || 0) - (this.recordStart?.[x] || 0);
    return {
      country: s.countries[this.k].name, scenario: s.scenarioName,
      from: this.from, now: snapshot(s), years: (s.day - this.startDay) / 365.25,
      record: { battlesWon: d('battlesWon'), battlesLost: d('battlesLost'), warsWon: d('warsWon'), warsLost: d('warsLost'), whitePeace: d('whitePeace') },
      counts: { ...this.counts }, events: this.events.slice(-60), decisions: this.decisions.slice(-60),
      running: this.running, done: this.stopped || this.finished(),
    };
  }

  // A save of the game as it is now, with the country back under the player's control (the bot
  // keeps playing afterwards).
  save(meta = {}) {
    const { state, map, rules } = this.game;
    handBack(state, this.handle);
    try {
      return saveGame(this.game, { savedAt: Date.now(), ...meta });
    } finally {
      this.handle = handToAI(state, map, rules, this.k, this.profile);
    }
  }

  // Gives the country back for good. Returns the final save.
  stop(reason = 'Stopped.', meta = {}) {
    if (!this.handle) throw new Error('The bot was not started');
    if (!this.stopped) {
      this.collect();
      handBack(this.game.state, this.handle);
      this.stopped = this.finished() || reason;
    }
    return saveGame(this.game, { savedAt: Date.now(), ...meta });
  }

  // Runs until stopped or finished, in slices of `sliceMs` of work. Between slices it awaits
  // rest(ms) with a pause of `slice time × (1 / cpu − 1)` (cpu 1 = flat out, 0.5 = half the time,
  // 0.25 = a quarter; a number or a function read before every pause), which is also where a stop
  // request arrives. onSlice(this, info) after every slice; onYear(this) when a new in-game year
  // starts. shouldStop() → true ends the run.
  async run({ cpu = 1, sliceMs = 60, rest = defaultRest, shouldStop = () => false, onSlice = null, onYear = null } = {}) {
    if (!this.handle) this.start();
    for (;;) {
      const share = Math.max(0.05, Math.min(1, +(typeof cpu === 'function' ? cpu() : cpu) || 1));
      if (shouldStop()) break;
      const t0 = now();
      const info = this.step(100000, sliceMs);
      const used = now() - t0;
      if (onSlice) await onSlice(this, info);
      if (info.newYear && onYear) await onYear(this);
      if (info.done) break;
      await rest(share >= 1 ? 0 : used * (1 / share - 1));
    }
  }
}

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function defaultRest(ms) { return new Promise((r) => setTimeout(r, Math.max(0, ms))); }

// The slot name for a bot save: "Bot – France 1 Jan 1450", made unique against `taken` (the
// names in use) with " (2)", " (3)"…
export function botSlotName(state, taken = []) {
  const base = `Bot – ${state.countries[state.player]?.name || 'Observer'} ${formatDate(state.day)}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} (${i})`)) return `${base} (${i})`;
}

// The slot index entry for a save (as src/ui/client.js slotInfo writes it), marked as the bot's.
export function botSlotInfo(state) {
  return { savedAt: Date.now(), date: formatDate(state.day), country: state.countries[state.player]?.name || 'Observer', scenario: state.scenarioName, bot: true };
}
