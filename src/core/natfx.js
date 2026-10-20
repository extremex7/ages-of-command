// National bonuses: the combined effects of a country's traits (data/rules/traits.json) and its
// advisors (data/rules/nations.json → advisors). Always derived from the saved lists, never saved.
// government.js folds tax, stability, legitimacy, manpower and construction into govt.fx;
// technology.js folds research, combat, industry, farm, growth, movement and siege into tfx.mult
// and keeps the whole set as tfx.nat (naval and trade are read from there). See docs/NATIONS.md.
// This module imports nothing, so the core modules can all use it without import cycles.

export const NAT_EFFECTS = ['tax', 'stability', 'legitimacy', 'influence', 'manpower', 'construction', 'research', 'combat', 'naval', 'trade', 'industry', 'farm', 'growth', 'movement', 'siege'];

// Plain-English labels and how to show each value (for tooltips).
export const NAT_LABELS = {
  tax: ['Tax efficiency', 'pts'], stability: ['Stability', 'abs'], legitimacy: ['Legitimacy', 'abs'], influence: ['Influence a month', 'abs'],
  manpower: ['Manpower', 'pct'], construction: ['Construction cost', 'pct'], research: ['Research', 'pct'], combat: ['Combat strength', 'pct'],
  naval: ['Naval combat', 'pct'], trade: ['Trade income (share of exports)', 'pct'], industry: ['Industrial output', 'pct'], farm: ['Farm output', 'pct'],
  growth: ['Population growth', 'pct'], movement: ['Army speed', 'pct'], siege: ['Siege speed', 'pct'],
};

// "Research +6%, stability +2" for an effects object.
export function describeNatFx(fx) {
  const out = [];
  for (const k of NAT_EFFECTS) {
    const v = fx?.[k];
    if (!v) continue;
    const [name, kind] = NAT_LABELS[k];
    const sign = v > 0 ? '+' : '−', a = Math.abs(v);
    out.push(`${name} ${sign}${kind === 'pct' ? +(a * 100).toFixed(1) + '%' : kind === 'pts' ? +(a * 100).toFixed(1) + ' points' : +a.toFixed(2)}`);
  }
  return out.join(', ') || 'No effect';
}

// Sum of the effects of traits and advisors (every key present, zero when unused).
export function nationalFx(rules, c) {
  const fx = {};
  for (const k of NAT_EFFECTS) fx[k] = 0;
  const N = rules.nations;
  if (!N) return fx;
  for (const t of c.traits || []) {
    const e = N.traits[t]?.effects;
    if (e) for (const k in e) if (k in fx) fx[k] += e[k];
  }
  for (const a of c.advisors || []) {
    const per = N.advisors.types[a.type]?.perSkill;
    if (per) for (const k in per) if (k in fx) fx[k] += per[k] * a.skill;
  }
  return fx;
}

// A number in [0, 1) fixed by the game seed, the day and the given keys. Traits, advisors, forming
// and missions roll with this instead of the game's random stream, so adding them (or opening a
// panel) never shifts the rolls of battles, events and the AI.
export function hashRand(state, ...keys) {
  let h = 2166136261;
  const s = `${state.seed}|${state.day}|${keys.join('|')}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// Monthly salary of one advisor (billions), from the country's revenue.
export function advisorSalary(rules, c, a, revenue = c.ledger?.revenue ?? 0) {
  const A = rules.nations?.advisors;
  if (!A) return 0;
  return (A.salaryBase + Math.max(0, revenue) * A.salaryRevenueShare) * a.skill;
}

export function advisorUpkeep(rules, c, revenue) {
  let s = 0;
  for (const a of c.advisors || []) s += advisorSalary(rules, c, a, revenue);
  return s;
}
