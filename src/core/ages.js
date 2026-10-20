// Golden ages and dark ages (docs/RELIGION.md, Ages). A country banks "momentum" in months of
// stability, calm, prosperity and rising prestige; with enough banked a golden age may begin:
// years of faster research and growth, more stability and less unrest. Months of crisis (low
// stability, hunger, inflation, war exhaustion, rebels holding land) bank toward a dark age with
// the opposite effects, which lifts once the country has been stable for a year. Both are
// announced with an event (data/events/society.json) the player answers.
import { log } from './state.js';
import { isAtWar } from './relations.js';
import { rand } from './rng.js';
import { formatDate } from './calendar.js';

// Additive effect of the current age on 'unrest' or 'stability' (0 without one).
export function ageEffect(rules, c, key) {
  const a = c.soc?.age, A = rules.society?.A;
  if (!a || !A) return 0;
  const g = a.kind === 'golden';
  if (key === 'unrest') return g ? -A.golden.unrest : A.dark.unrest;
  if (key === 'stability') return g ? A.golden.stabilityBonus : -A.dark.stabilityPenalty;
  return 0;
}

// Multiplier of the current age on 'research' or 'growth' (1 without one).
export function ageMult(rules, c, key) {
  const a = c.soc?.age, A = rules.society?.A;
  if (!a || !A) return 1;
  return (a.kind === 'golden' ? A.golden : A.dark)[key] ?? 1;
}

// Whether this month counts toward a golden age, with the reason it does not (for the UI).
export function goldenCheck(state, rules, c, warScores = null) {
  const G = rules.society.A.golden, e = c.econ, so = c.soc;
  if (c.stability < G.stability) return `stability below ${G.stability}`;
  if ((so.unrest || 0) >= G.maxUnrest) return `unrest of ${G.maxUnrest} or more`;
  if (e && (e.foodSat < G.prosperity || e.living < G.prosperity)) return 'shortages of food or goods';
  if (e?.hist?.gdp?.length >= 13 && e.hist.gdp[e.hist.gdp.length - 1] < e.hist.gdp[e.hist.gdp.length - 13]) return 'a shrinking economy';
  const score = state.prestige?.score?.[c.idx];
  if (score != null && so.pEma != null && score < so.pEma + (G.prestigeGrowth ?? 0)) return 'prestige is not rising';
  if (warScores) for (const [w, sc] of warScores) {
    const att = w.attackers.includes(c.idx);
    if ((att || w.defenders.includes(c.idx)) && (att ? sc : -sc) < 0) return 'a war it is losing';
  }
  return null;
}

// Whether this month is one of crisis, with its cause.
export function crisisCheck(state, rules, c) {
  const D = rules.society.A.dark, e = c.econ, so = c.soc;
  if (c.stability < D.stability) return `stability below ${D.stability}`;
  if (e && e.foodSat < D.food) return 'hunger';
  if (e && e.inflation > D.inflation) return 'runaway inflation';
  if ((so.warEx || 0) > D.warExhaustion) return 'war exhaustion';
  if (state.society.revolts.some((r) => r.c === c.idx && r.held.length)) return 'rebels holding land';
  return null;
}

export function monthlyAges(state, map, rules, warScores) {
  const A = rules.society.A, G = A.golden, D = A.dark;
  // golden ages stay rare: none begins while too many countries already have one
  let alive = 0, golden = 0;
  for (const c of state.countries) if (c.alive) { alive++; if (c.soc?.age?.kind === 'golden') golden++; }
  for (const c of state.countries) {
    if (!c.alive || !c.soc) continue;
    const so = c.soc, k = c.idx;
    const score = state.prestige?.score?.[k];
    if (score != null) so.pEma = so.pEma == null ? score : Math.round((so.pEma + (score - so.pEma) / 36) * 1000) / 1000;
    const good = !goldenCheck(state, rules, c, warScores), bad = crisisCheck(state, rules, c);
    so.gold = Math.max(0, Math.min(G.momentum * 2, (so.gold || 0) + (good ? 1 : -2)));
    so.dark = Math.max(0, Math.min(D.momentum * 2, (so.dark || 0) + (bad ? 1 : -2)));
    const a = so.age;
    if (a) {
      if (a.kind === 'golden' && (state.day >= a.until || c.stability < G.endStability || so.dark >= D.momentum)) endAge(state, c, state.day >= a.until ? 'ended' : 'cut short');
      else if (a.kind === 'dark') {
        so.recover = c.stability >= D.recoverStability ? (so.recover || 0) + 1 : 0;
        if (state.day >= a.until || so.recover >= D.recoverMonths) endAge(state, c, 'over');
      }
      continue;
    }
    if (so.dark >= D.momentum && state.day - (so.lastDark ?? -1e9) > D.cooldownYears * 365 && rand(state) < D.chance) startAge(state, rules, c, 'dark', bad);
    else if (so.gold >= G.momentum && state.day - (so.lastGolden ?? -1e9) > G.cooldownYears * 365 && golden < alive * (G.maxShare ?? 1) && !isAtWar(state, k) && rand(state) < G.chance) { startAge(state, rules, c, 'golden'); golden++; }
  }
}

export function startAge(state, rules, c, kind, why = '') {
  const A = rules.society.A, so = c.soc, golden = kind === 'golden';
  so.age = { kind, start: state.day, until: state.day + Math.round((golden ? A.golden.years : A.dark.years) * 365) };
  so.recover = 0;
  if (golden) { so.lastGolden = state.day; so.gold = 0; } else { so.lastDark = state.day; so.dark = 0; }
  const text = golden ? `${c.name} enters a golden age: research, growth and stability flourish until ${formatDate(so.age.until)} at the latest.`
    : `${c.name} falls into a dark age${why ? ` (${why})` : ''}: research and growth falter until the country is stable again.`;
  log(state, 'world', text, { important: c.idx === state.player || (golden && (state.prestige?.rank?.[c.idx] ?? 99) <= 10), country: c.idx });
  const ev = golden ? 'golden_age' : 'dark_age';
  if (rules.events.some((e) => e.id === ev)) (state.eventQueue ||= []).push({ c: c.idx, ev });
}

function endAge(state, c, how) {
  const a = c.soc.age;
  c.soc.age = null;
  c.soc.recover = 0;
  log(state, 'world', a.kind === 'golden' ? `The golden age of ${c.name} has ${how}.` : `The dark age of ${c.name} is ${how}: the country has recovered.`, { important: c.idx === state.player, country: c.idx });
}
