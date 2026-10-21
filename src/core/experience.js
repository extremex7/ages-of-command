// Army and fleet experience, and national military expertise (see docs/MILITARY.md).
//
// Experience (a.exp, 0..cap) is earned in battle: more for a win, some for a defeat, and a little
// for every day of fighting. It raises damage by up to `bonus` at the cap. Fresh men dilute it:
// new units joining an army, reinforcements topping up its strength, repairs of a fleet in port,
// and merges (the average weighted by men). Expertise (c.expertise, 0..cap) is the country's
// accumulated know-how: gained from battles and won wars, it raises the damage of all its armies
// and fleets a little and fades by a share every month the country is at peace.
import { isAtWar } from './relations.js';

const DEF = {
  cap: 1, bonus: 0.25, win: 0.06, loss: 0.025, perDay: 0.004, maxDays: 20,
  levels: [[0.8, 'Elite'], [0.55, 'Veteran'], [0.3, 'Regular'], [0.1, 'Trained'], [0, 'Green']],
  expertise: { cap: 0.1, battleWon: 0.0015, battleLost: 0.0005, warWon: 0.025, warWonPerYear: 0.01, warLost: 0.005, peaceDecay: 0.03 },
};

export function expRules(rules) {
  const X = rules.balance.experience;
  return X ? { ...DEF, ...X, expertise: { ...DEF.expertise, ...(X.expertise || {}) } } : DEF;
}

// Damage multiplier from a force's own experience.
export function expMult(rules, x) {
  return 1 + (x.exp || 0) * expRules(rules).bonus;
}

// Damage multiplier from the country's expertise (1 + expertise).
export function expertiseMult(c) {
  return 1 + (c?.expertise || 0);
}

export function expLevel(rules, exp) {
  for (const [at, name] of expRules(rules).levels) if ((exp || 0) >= at) return name;
  return 'Green';
}

// After a battle of `days` days: every army or fleet that fought gains experience, and its
// country gains a little expertise.
export function battleExperience(state, rules, list, won, days) {
  const X = expRules(rules), E = X.expertise;
  const gain = (won ? X.win : X.loss) + X.perDay * Math.min(days || 0, X.maxDays);
  const seen = new Set();
  for (const a of list) {
    a.exp = Math.min(X.cap, (a.exp || 0) + gain);
    if (seen.has(a.owner)) continue;
    seen.add(a.owner);
    addExpertise(state, rules, a.owner, won ? E.battleWon : E.battleLost);
  }
}

export function addExpertise(state, rules, k, v) {
  const c = state.countries[k];
  if (!c || !(v > 0)) return;
  c.expertise = Math.min(expRules(rules).expertise.cap, (c.expertise || 0) + v);
}

// A war ended: the winning side learns the most (more for longer wars), the losers a little.
// winners/losers: country index lists; years: the war's length.
export function warExpertise(state, rules, winners, losers, years) {
  const E = expRules(rules).expertise;
  for (const k of winners) addExpertise(state, rules, k, E.warWon + E.warWonPerYear * Math.min(4, years));
  for (const k of losers) addExpertise(state, rules, k, E.warLost);
}

// Fresh men join a force: experience falls in proportion. `before` and `after` are any
// measure of the old and new size (units, or strength × units).
export function dilute(x, before, after) {
  if (!x.exp || !(after > 0)) return;
  x.exp *= Math.max(0, Math.min(1, before / after));
  if (x.exp < 1e-4) x.exp = 0;
}

// Monthly: expertise fades in peacetime.
export function monthlyExperience(state, rules) {
  const d = expRules(rules).expertise.peaceDecay;
  for (const c of state.countries) {
    if (!c.expertise || !c.alive) continue;
    if (isAtWar(state, c.idx)) continue;
    c.expertise *= 1 - d;
    if (c.expertise < 1e-4) c.expertise = 0;
  }
}
