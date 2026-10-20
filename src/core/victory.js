// Victory conditions, chosen at New Game (state.settings.victory; none = a sandbox game). Any
// combination of:
//   conquest   own (with your subjects) a share of the world's land provinces
//   economy    have the world's largest economy and at least a share of world GDP for N years
//   technology be the first to know every technology of a target era
//   score      have the highest prestige score (prestige.js) on an end date
// Checked monthly after prestige; any country can win, not only the player. The first win is
// kept in state.victory.won; the player may continue playing afterwards (state.victory.continued),
// and then nothing more is checked. See docs/FEATURES.md and docs/ACHIEVEMENTS.md.
import { log } from './state.js';
import { daysFromCivil } from './calendar.js';
import { subjectsOf } from './diplomacy.js';
import { knows } from './technology.js';

export const VICTORY_KINDS = {
  conquest: { name: 'Conquest', text: 'Own, with your subjects, a share of the world\'s land provinces.' },
  economy: { name: 'Economic', text: 'Have the largest economy in the world and a share of world GDP, for years on end.' },
  technology: { name: 'Technology', text: 'Be the first to know every technology of an era.' },
  score: { name: 'Prestige', text: 'Have the highest prestige score on the end date.' },
};

// The active conditions with their targets, [] for a sandbox game.
export function victoryConditions(state, rules) {
  const V = state.settings?.victory;
  if (!V) return [];
  const out = [];
  if (V.conquest > 0) out.push({ id: 'conquest', share: Math.min(1, +V.conquest) });
  if (V.economy > 0) out.push({ id: 'economy', share: +V.economy, years: Math.max(1, +V.economyYears || 10) });
  if (V.tech && rules.tech?.eraIdx?.[V.tech] != null) out.push({ id: 'technology', era: rules.tech.eraIdx[V.tech] });
  if (V.scoreYear > 0) {
    const end = daysFromCivil(+V.scoreYear, 1, 1);
    if (end > state.startDay) out.push({ id: 'score', end, year: +V.scoreYear });
  }
  return out;
}

function vstate(state) { return (state.victory ||= { econ: null, won: null, continued: false }); }

function provincesWithSubjects(state, k) {
  const C = state.countries;
  let n = C[k].cache?.provinces || 0;
  if (state.dip) for (const s of subjectsOf(state, k)) n += C[s].cache?.provinces || 0;
  return n;
}

function worldGdp(state) {
  let w = 0, top = -1, tg = -1;
  for (const c of state.countries) if (c.alive && c.cache) { w += c.cache.gdp; if (c.cache.gdp > tg) { tg = c.cache.gdp; top = c.idx; } }
  return { world: w, top };
}

function eraTechs(rules, era) { return rules.tech.byEra[era] || []; }

// Progress of country k on each condition: [{ id, name, value 0..1, text, need }].
export function victoryProgress(state, map, rules, k) {
  const C = state.countries, c = C[k], V = vstate(state);
  return victoryConditions(state, rules).map((v) => {
    const name = VICTORY_KINDS[v.id].name;
    if (v.id === 'conquest') {
      const n = provincesWithSubjects(state, k), need = Math.ceil(v.share * map.ids.length);
      return { id: v.id, name, value: Math.min(1, n / need), text: `${n} of ${need} provinces (${Math.round(v.share * 100)}% of the world's ${map.ids.length})` };
    }
    if (v.id === 'economy') {
      const { world, top } = worldGdp(state), share = world ? (c.cache?.gdp || 0) / world : 0;
      const months = V.econ?.k === k ? V.econ.months : 0;
      const need = v.years * 12;
      const value = share < v.share || top !== k ? 0.5 * Math.min(1, share / v.share) : 0.5 + 0.5 * Math.min(1, months / need);
      return { id: v.id, name, value, text: `${(share * 100).toFixed(1)}% of world GDP${top === k ? ', the largest economy' : ''}; needs ${Math.round(v.share * 100)}% as the largest for ${v.years} years${months ? ` (${Math.floor(months / 12)} y ${months % 12} m so far)` : ''}` };
    }
    if (v.id === 'technology') {
      const ts = eraTechs(rules, v.era);
      let n = 0;
      for (const t of ts) if (knows(state, k, t)) n++;
      return { id: v.id, name, value: ts.length ? n / ts.length : 0, text: `${n} of ${ts.length} technologies of the ${rules.tech.eras[v.era].name} era` };
    }
    const P = state.prestige, rank = P?.rank?.[k] || 0, score = P?.score?.[k] || 0;
    const left = Math.max(0, v.end - state.day);
    return { id: v.id, name, value: rank === 1 ? 1 : rank ? 1 / rank : 0, text: `Score ${score.toFixed(1)}, rank #${rank || '–'}; decided on 1 Jan ${v.year} (${Math.ceil(left / 365)} years left)` };
  });
}

// The country closest to each condition: [{ id, name, k, value }].
export function victoryLeaders(state, map, rules) {
  const conds = victoryConditions(state, rules);
  if (!conds.length) return [];
  const alive = state.countries.filter((c) => c.alive && c.cache);
  return conds.map((v) => {
    let best = -1, bv = -1;
    for (const c of alive) {
      const p = progressOne(state, map, rules, c.idx, v);
      if (p > bv) { bv = p; best = c.idx; }
    }
    return { id: v.id, name: VICTORY_KINDS[v.id].name, k: best, value: bv };
  });
}

function progressOne(state, map, rules, k, v) {
  if (v.id === 'conquest') return provincesWithSubjects(state, k) / Math.max(1, Math.ceil(v.share * map.ids.length));
  if (v.id === 'technology') { let n = 0; for (const t of eraTechs(rules, v.era)) if (knows(state, k, t)) n++; return n; }
  if (v.id === 'economy') return state.countries[k].cache.gdp;
  return state.prestige?.score?.[k] || 0;
}

// Monthly, after prestige: has anyone won?
export function monthlyVictory(state, map, rules) {
  const conds = victoryConditions(state, rules);
  if (!conds.length) return null;
  const V = vstate(state);
  if (V.won) return null;
  const C = state.countries;
  let win = null;
  for (const v of conds) {
    if (win) break;
    if (v.id === 'conquest') {
      const need = Math.ceil(v.share * map.ids.length);
      let best = -1, bn = need - 1;
      for (const c of C) if (c.alive && c.cache) { const n = provincesWithSubjects(state, c.idx); if (n > bn) { bn = n; best = c.idx; } }
      if (best >= 0) win = { k: best, id: v.id, why: `owns, with its subjects, ${Math.round(v.share * 100)}% of the world's provinces` };
    } else if (v.id === 'economy') {
      const { world, top } = worldGdp(state);
      const ok = top >= 0 && world > 0 && C[top].cache.gdp / world >= v.share;
      if (!ok) V.econ = null;
      else if (V.econ?.k === top) V.econ.months++;
      else V.econ = { k: top, months: 1 };
      if (V.econ && V.econ.months >= v.years * 12) win = { k: top, id: v.id, why: `held ${Math.round(v.share * 100)}% of world GDP as the largest economy for ${v.years} years` };
    } else if (v.id === 'technology') {
      const ts = eraTechs(rules, v.era);
      if (!ts.length) continue;
      // several on the same month: the one with the most technologies overall
      let best = -1;
      for (const c of C) if (c.alive && ts.every((t) => knows(state, c.idx, t)) && (best < 0 || (c.tfx?.known || 0) > (C[best].tfx?.known || 0))) best = c.idx;
      if (best >= 0) win = { k: best, id: v.id, why: `was the first to master every technology of the ${rules.tech.eras[v.era].name} era` };
    } else if (v.id === 'score' && state.day >= v.end) {
      const r = state.prestige?.rank || [];
      const k = r.indexOf(1);
      if (k >= 0) win = { k, id: v.id, why: `had the highest prestige score (${state.prestige.score[k].toFixed(1)}) on 1 Jan ${v.year}` };
    }
  }
  if (!win) return null;
  V.won = { ...win, day: state.day, name: VICTORY_KINDS[win.id].name, text: `${C[win.k].name} won ${win.id === "economy" ? "an" : "a"} ${VICTORY_KINDS[win.id].name.toLowerCase()} victory: it ${win.why}.` };
  log(state, 'world', V.won.text, { important: true, victory: win.id });
  return V.won;
}

// Shown to the player once (the client sets `seen`).
export function pendingVictory(state) {
  const V = state.victory;
  return V?.won && !V.seen ? V.won : null;
}

export function continueAfterVictory(state) {
  const V = vstate(state);
  V.seen = true; V.continued = true;
}
