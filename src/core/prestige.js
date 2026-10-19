// Prestige: one score (0–100) for how well each country is doing, the world ranking it gives,
// star tiers and "rising stars". Recomputed monthly; a ranking snapshot is kept every January
// (and at the start) for the last 10 years so rank changes survive saving and loading.
//
// Score = 100 × weighted sum of shares of the world's best (square roots soften the gap
// between giants and everyone else):
//   economy   30%  √(GDP ÷ largest GDP)
//   military  20%  √(army + navy + air power ÷ the strongest)
//   technology 15% technologies known ÷ the most known
//   population 10% √(population ÷ largest)
//   prosperity 10% √(GDP per person ÷ highest)
//   stability  10% stability ÷ 100
//   territory   5% √(provinces ÷ most provinces)

import { log } from './state.js';

export const PRESTIGE_WEIGHTS = { economy: 0.3, military: 0.2, technology: 0.15, population: 0.1, prosperity: 0.1, stability: 0.1, territory: 0.05 };
// star tiers by rank
export const STARS = [{ id: 'gold', name: 'Gold star', upTo: 10 }, { id: 'silver', name: 'Silver star', upTo: 25 }, { id: 'bronze', name: 'Bronze star', upTo: 50 }];
const HISTORY_YEARS = 10, RISING_YEARS = 5;

function power(c) { return (c.cache?.armyPower || 0) + (c.cache?.navyPower || 0) + (c.cache?.airPower || 0); }

// Components (0–1) for every country, or null for dead ones.
export function prestigeParts(state) {
  const C = state.countries, alive = C.filter((c) => c.alive && c.cache);
  const max = (f) => Math.max(1e-9, ...alive.map(f));
  const mg = max((c) => c.cache.gdp), mp = max(power), mpop = max((c) => c.cache.pop), mpp = max((c) => c.cache.gdp / Math.max(1, c.cache.pop));
  const mk = max((c) => c.tfx?.known ?? 0), mt = max((c) => c.cache.provinces);
  return C.map((c) => (!c.alive || !c.cache ? null : {
    economy: Math.sqrt(c.cache.gdp / mg),
    military: Math.sqrt(power(c) / mp),
    technology: c.tfx ? (c.tfx.known ?? 0) / mk : 0,
    population: Math.sqrt(c.cache.pop / mpop),
    prosperity: Math.sqrt(c.cache.gdp / Math.max(1, c.cache.pop) / mpp),
    stability: Math.max(0, Math.min(100, c.stability ?? 50)) / 100,
    territory: Math.sqrt(c.cache.provinces / mt),
  }));
}

export function computePrestige(state) {
  const parts = prestigeParts(state);
  const score = parts.map((p) => (p ? Math.round(1000 * Object.entries(PRESTIGE_WEIGHTS).reduce((s, [k, w]) => s + w * p[k], 0)) / 10 : 0));
  const order = state.countries.map((c) => c.idx).filter((k) => parts[k]).sort((a, b) => score[b] - score[a] || a - b);
  const rank = new Array(state.countries.length).fill(0);
  order.forEach((k, i) => { rank[k] = i + 1; });
  const P = state.prestige || (state.prestige = { hist: [] });
  P.score = score; P.rank = rank; P.day = state.day;
  if (!P.hist.length) P.hist.push({ day: state.day, rank: rank.slice() });
  return P;
}

// Monthly, after the country caches are refreshed.
export function monthlyPrestige(state, month) {
  const k = state.player, before = k >= 0 ? starOf(state.prestige?.rank?.[k] ?? 0) : null;
  const P = computePrestige(state);
  if (k >= 0 && state.countries[k].alive) {
    const after = starOf(P.rank[k]), tier = (x) => (x ? STARS.indexOf(x) : STARS.length);
    if (tier(after) !== tier(before)) {
      const name = state.countries[k].name;
      log(state, 'world', after && tier(after) < tier(before) ? `${name} has earned a ${after.name.toLowerCase()}: now ranked ${P.rank[k]} in the world.`
        : `${name} has lost its ${before.name.toLowerCase()}: now ranked ${P.rank[k]} in the world.`, { important: true });
    }
  }
  if (month === 1 && P.hist[P.hist.length - 1].day !== state.day) {
    P.hist.push({ day: state.day, rank: P.rank.slice() });
    while (P.hist.length > HISTORY_YEARS + 1) P.hist.shift();
  }
}

export function starOf(rank) { return rank > 0 ? STARS.find((s) => rank <= s.upTo) || null : null; }

// The snapshot to compare against: about five years ago, or the oldest kept if the game is
// younger, but at least one year old (null before that).
export function baseline(state) {
  const P = state.prestige;
  if (!P?.hist?.length) return null;
  const target = state.day - RISING_YEARS * 365;
  let best = null;
  for (const h of P.hist) if (state.day - h.day >= 365 && (best == null || Math.abs(h.day - target) < Math.abs(best.day - target))) best = h;
  return best;
}

// Rank change since the baseline (positive = climbed) and whether that makes a rising star:
// a climb of at least 5 places and at least 30% of the old rank (100 → 70 or better, 12 → 7).
export function rankChange(state, k) {
  const P = state.prestige, b = baseline(state);
  if (!P || !b || !b.rank[k] || !P.rank[k]) return { change: 0, since: null, rising: false };
  const change = b.rank[k] - P.rank[k];
  return { change, since: b.day, from: b.rank[k], rising: change >= Math.max(5, 0.3 * b.rank[k]) };
}
