// The player's record: where their country started, a yearly sample of how it has done since,
// counts of battles, wars and other deeds, and the achievements earned. It feeds the game summary
// (Menu → Summary, and at the end of a game) and the achievements list. Only the player's country
// is recorded; in observer mode nothing is. A game in which cheats were used earns no
// achievements. See docs/ACHIEVEMENTS.md.
import { log } from './state.js';
import { starOf, rankChange } from './prestige.js';
import { overlordOf } from './diplomacy.js';
import { isAtWar } from './relations.js';
import { civilFromDays } from './calendar.js';

function snapshot(state, k) {
  const c = state.countries[k], P = state.prestige;
  const world = state.countries.reduce((s, x) => s + (x.alive ? x.cache?.gdp || 0 : 0), 0);
  return {
    day: state.day, rank: P?.rank?.[k] || 0, score: P?.score?.[k] || 0,
    gdp: c.cache?.gdp || 0, share: world ? (c.cache?.gdp || 0) / world : 0, pop: c.cache?.pop || 0,
    prov: c.cache?.provinces || 0, techs: c.tfx?.known || 0, era: c.tfx?.era ?? 0, gov: c.gov,
    subject: overlordOf(state, k) >= 0, warheads: c.strat?.warheads || 0, colonies: c.strat?.colonies || 0,
  };
}

// Starts (or restarts, after the player takes over another country) the record.
export function startRecord(state) {
  const k = state.player;
  if (k < 0) return null;
  const old = state.record;
  const start = snapshot(state, k);
  state.record = {
    k, tag: state.countries[k].tag, start, hist: [start], best: { rank: start.rank, day: state.day },
    n: { battlesWon: 0, battlesLost: 0, warsWon: 0, warsLost: 0, whitePeace: 0, coups: 0, resolutions: 0 },
    monthsAt1: 0, peaceMonths: 0, ach: old?.ach || {}, earlier: old ? [...(old.earlier || []), { tag: old.tag, until: state.day }] : [],
  };
  return state.record;
}

export function recordOf(state) {
  if (state.player < 0) return null;
  if (!state.record || state.record.k !== state.player) return startRecord(state);
  return state.record;
}

export function bump(state, key, n = 1) {
  const R = state.player >= 0 ? recordOf(state) : null;
  if (R) R.n[key] = (R.n[key] || 0) + n;
}

// A war ended: did the player's side win, lose, or make a white peace? (`from` dictated terms.)
export function recordPeace(state, war, from, gained) {
  const k = state.player;
  if (k < 0 || !(war.attackers.includes(k) || war.defenders.includes(k))) return;
  const sideFrom = war.attackers.includes(from) ? war.attackers : war.defenders;
  bump(state, !gained ? 'whitePeace' : sideFrom.includes(k) ? 'warsWon' : 'warsLost');
}

// Achievement definitions: id, name, what it takes, and the test (record, current snapshot).
export const ACHIEVEMENTS = [
  { id: 'silver_star', name: 'On the world stage', text: 'Reach the top 25 of the world leaderboard (a silver star).', test: (R, x) => x.rank > 0 && x.rank <= 25 },
  { id: 'gold_star', name: 'Great power', text: 'Reach the top 10 (a gold star).', test: (R, x) => x.rank > 0 && x.rank <= 10 },
  { id: 'number_one', name: 'First among nations', text: 'Rank first in the world.', test: (R, x) => x.rank === 1 },
  { id: 'hegemon', name: 'Hegemon', text: 'Stay first in the world for 10 years in a row.', test: (R) => R.monthsAt1 >= 120 },
  { id: 'rising_star', name: 'Rising star', text: 'Climb at least 5 places and 30% of your rank in about five years.', test: (R, x, s) => rankChange(s, R.k).rising },
  { id: 'underdog', name: 'Underdog', text: 'Start ranked 50th or lower and reach the top 25.', test: (R, x) => R.start.rank >= 50 && x.rank > 0 && x.rank <= 25 },
  { id: 'to_gold', name: 'From nowhere to gold', text: 'Start outside the top 25 and earn a gold star.', test: (R, x) => R.start.rank > 25 && x.rank > 0 && x.rank <= 10 },
  { id: 'first_victory', name: 'First victory', text: 'Win a battle.', test: (R) => R.n.battlesWon >= 1 },
  { id: 'veteran', name: 'Veteran army', text: 'Win 50 battles.', test: (R) => R.n.battlesWon >= 50 },
  { id: 'victor', name: 'Victor', text: 'Win a war: make peace on your terms.', test: (R) => R.n.warsWon >= 1 },
  { id: 'conqueror', name: 'Conqueror', text: 'Win three wars.', test: (R) => R.n.warsWon >= 3 },
  { id: 'long_peace', name: 'Long peace', text: 'Go 25 years without a war.', test: (R) => R.peaceMonths >= 300 },
  { id: 'empire', name: 'Empire builder', text: 'Hold twice as many provinces as at the start.', test: (R, x) => R.start.prov > 0 && x.prov >= 2 * R.start.prov },
  { id: 'miracle', name: 'Economic miracle', text: 'Double your share of the world economy.', test: (R, x) => R.start.share > 0 && x.share >= 2 * R.start.share && x.share >= 0.002 },
  { id: 'tech_leader', name: 'Frontier of knowledge', text: 'Know more technologies than any other country.', test: (R, x, s) => x.techs > 0 && s.countries.every((c) => !c.alive || c.idx === R.k || (c.tfx?.known || 0) < x.techs) },
  { id: 'new_era', name: 'A new age', text: 'Enter a new era of technology.', test: (R, x) => x.era > R.start.era },
  { id: 'content', name: 'Content people', text: 'Reach stability 90.', test: (R, x, s) => s.countries[R.k].stability >= 90 },
  { id: 'reform', name: 'New constitution', text: 'Change your form of government.', test: (R, x) => x.gov !== R.start.gov },
  { id: 'independence', name: 'Free at last', text: 'Start as a subject and become independent.', test: (R, x) => R.start.subject && !x.subject },
  { id: 'kingmaker', name: 'Kingmaker', text: 'Topple a foreign government in a coup.', test: (R) => R.n.coups >= 1 },
  { id: 'world_voice', name: 'Voice of the world', text: 'Have a resolution you proposed passed by the world council.', test: (R) => R.n.resolutions >= 1 },
  { id: 'the_bomb', name: 'The bomb', text: 'Build your first nuclear warhead.', test: (R, x) => !R.start.warheads && x.warheads > 0 },
  { id: 'off_world', name: 'Off-world', text: 'Found your first settlement beyond Earth.', test: (R, x) => !R.start.colonies && x.colonies > 0 },
  { id: 'half_century', name: 'Still standing', text: 'Lead your country for 50 years.', test: (R, x, s) => s.day - R.start.day >= 50 * 365 },
];

// Monthly, after prestige: counters, the yearly sample and new achievements (logged).
export function monthlyRecord(state, rules, month) {
  if (state.player < 0 || !state.countries[state.player].alive) return [];
  const R = recordOf(state), x = snapshot(state, R.k);
  R.monthsAt1 = x.rank === 1 ? R.monthsAt1 + 1 : 0;
  R.peaceMonths = isAtWar(state, R.k) ? 0 : R.peaceMonths + 1;
  if (x.rank > 0 && (!R.best.rank || x.rank < R.best.rank)) R.best = { rank: x.rank, day: state.day };
  if (month === 1 && R.hist[R.hist.length - 1].day !== state.day) R.hist.push(x);
  if (state.cheated) return [];
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (R.ach[a.id] != null || !a.test(R, x, state)) continue;
    R.ach[a.id] = state.day;
    earned.push(a);
    log(state, 'world', `Achievement: ${a.name}. ${a.text}`, { important: true, achievement: a.id });
  }
  return earned;
}

// The game summary: a headline and the figures behind it (start against now).
export function summary(state) {
  const R = state.record;
  if (!R) return null;
  const c = state.countries[R.k], alive = c.alive;
  const now = alive ? snapshot(state, R.k) : R.hist[R.hist.length - 1];
  const years = Math.max(0, Math.round((state.day - R.start.day) / 365));
  const from = R.start.rank, to = alive ? now.rank : 0, st = starOf(to);
  const span = years ? ` in ${years} year${years === 1 ? '' : 's'}` : '';
  let headline;
  if (!alive) headline = `${c.name} was annexed in ${civilFromDays(state.day).y}, after ${years} year${years === 1 ? '' : 's'} under your rule.`;
  else if (to < from) headline = `${c.name} rose from #${from} to #${to}${span}${st ? `, earning a ${st.name.toLowerCase()}` : ''}.`;
  else if (to > from) headline = `${c.name} fell from #${from} to #${to}${span}.`;
  else headline = `${c.name} held its place at #${to}${span}.`;
  return {
    headline, years, from, to, best: R.best, start: R.start, now, n: R.n, hist: R.hist, cheated: !!state.cheated,
    achievements: ACHIEVEMENTS.filter((a) => R.ach[a.id] != null).map((a) => ({ ...a, day: R.ach[a.id] })),
    total: ACHIEVEMENTS.length, earlier: R.earlier,
  };
}
