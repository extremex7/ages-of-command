// Capitulation: a country at war that has lost most of its provinces and its capital to the enemy
// gives up. Its war ends at once on the enemy's terms, chosen by default rules (see
// docs/MILITARY.md, Capitulation). Applies to every country, the player's included; the player
// is told in a dialog (state.capitulations, read by the client).
//
// - The threshold is the share of the country's own provinces held by enemies of that war, set
//   at New Game (state.settings.capitulation; 0 turns it off; default balance.capitulation.occupied).
// - A war leader whose side has no one else left standing ends the whole war: the enemy leader
//   makes a small loser its subject, or else takes the provinces it occupies (claims first, then
//   the most valuable) up to a war-score budget and a share of each loser's land, plus reparations.
// - A co-belligerent, or a leader whose allies still fight on, leaves the war: the provinces the
//   enemy holds are ceded (up to the same share) to whoever occupies them, and it pays
//   reparations to the enemy leader. A leader's place passes to its strongest remaining ally.
// Checked once a day for countries at war; the cost is a few lookups per war participant.
import { log, aiLog } from './state.js';
import { warScore, demandCost, provinceValue, makePeace, makeSeparatePeace, validatePeace } from './war.js';
import { overlordOf, subjectsOf, hasClaim, signTreaty } from './diplomacy.js';
import { provincesOf } from './geo.js';

const DEF = { occupied: 0.6, minDays: 30, minScore: 60, maxLandShare: 0.5 };
export function capRules(rules) { return { ...DEF, ...(rules.balance.capitulation || {}) }; }

// The occupied share at which countries capitulate in this game (0 = never).
export function capThreshold(state, rules) {
  const v = state.settings?.capitulation;
  return v == null ? capRules(rules).occupied : +v;
}

// How close country k is to capitulating in war w: { share, capital, threshold, would }.
export function capitulationStatus(state, map, rules, w, k) {
  const enemies = w.attackers.includes(k) ? w.defenders : w.attackers;
  const c = state.countries[k], P = state.prov;
  let own = 0, held = 0;
  for (const i of provincesOf(state, map, k)) { own++; if (enemies.includes(P.controller[i])) held++; }
  const share = own ? held / own : 0, thr = capThreshold(state, rules);
  const capital = c.capital >= 0 && enemies.includes(P.controller[c.capital]);
  return { share, capital, threshold: thr, would: thr > 0 && share >= thr && capital };
}

export function dailyCapitulation(state, map, rules) {
  if (!state.wars.length) return;
  const thr = capThreshold(state, rules);
  if (!(thr > 0)) return;
  const R = capRules(rules), C = state.countries;
  for (const w of [...state.wars]) {
    if (!state.wars.includes(w) || w.kind === 'civil' || state.day - w.start < R.minDays) continue;
    for (const k of [...w.attackers, ...w.defenders]) {
      const c = C[k];
      if (!c.alive || !c.cache || c.cache.occupied / Math.max(1, c.cache.provinces) < thr) continue; // cheap test first
      if (!capitulationStatus(state, map, rules, w, k).would) continue;
      capitulate(state, map, rules, w, k);
      break; // the war changed; the next one is checked tomorrow
    }
  }
}

// Default terms for a full peace dictated by `winner` (a war leader) on the side opposite k.
export function capitulationTerms(state, map, rules, w, winner) {
  const R = capRules(rules), C = state.countries, D = rules.balance.diplomacy;
  const att = w.attackers.includes(winner);
  const loser = att ? w.leaderD : w.leaderA;
  const theirSide = att ? w.defenders : w.attackers;
  const budget = Math.max(R.minScore, warScore(state, map, rules, w) * (att ? 1 : -1));
  const PC = D?.peaceCost || {};
  // a small loser becomes a subject instead of losing land
  if (state.dip && PC.subject != null && C[loser].cache.provinces <= D.subjectMaxProvinces && C[loser].cache.gdp < C[winner].cache.gdp * 0.3
    && w.kind !== 'independence' && !validatePeace(state, map, rules, w, winner, { provinces: [], subject: true, to: winner })) {
    return { provinces: [], subject: true, to: winner };
  }
  const cands = map.ids.filter((i) => theirSide.includes(state.prov.owner[i]) && state.prov.controller[i] === winner);
  cands.sort((x, y) => (hasClaim(state, winner, y) - hasClaim(state, winner, x)) || provinceValue(state, rules, y) - provinceValue(state, rules, x));
  const lossCap = new Map();
  for (const k of theirSide) { let v = 0; for (const i of provincesOf(state, map, k)) v += provinceValue(state, rules, i); lossCap.set(k, v * R.maxLandShare); }
  const take = [], lost = new Map(), count = new Map();
  for (const p of cands) {
    const o = state.prov.owner[p], v = provinceValue(state, rules, p);
    // never a loser's last province; past the land share only its first lost province
    if ((count.get(o) || 0) >= (state.countries[o].cache?.provinces || 0) - 1) continue;
    if ((lost.get(o) || 0) + v > lossCap.get(o) && count.get(o)) continue;
    if (demandCost(state, map, rules, w, take.concat(p), att, winner) > budget) continue;
    take.push(p); lost.set(o, (lost.get(o) || 0) + v); count.set(o, (count.get(o) || 0) + 1);
  }
  // a capitulating country always pays reparations as well
  return { provinces: take, to: winner, reparations: !!state.dip };
}

// Provinces of k the enemy holds that it cedes when it leaves the war alone (most valuable last,
// up to the land share).
function separateCession(state, map, rules, w, k) {
  const R = capRules(rules);
  const enemies = w.attackers.includes(k) ? w.defenders : w.attackers;
  const mine = provincesOf(state, map, k);
  let cap = 0;
  for (const i of mine) cap += provinceValue(state, rules, i);
  cap *= R.maxLandShare;
  const held = mine.filter((i) => enemies.includes(state.prov.controller[i]) && i !== state.countries[k].capital)
    .sort((x, y) => provinceValue(state, rules, y) - provinceValue(state, rules, x));
  const out = [];
  let v = 0;
  for (const p of held) { const pv = provinceValue(state, rules, p); if (v + pv > cap) continue; out.push(p); v += pv; }
  return out;
}

export function capitulate(state, map, rules, w, k) {
  const C = state.countries;
  const att = w.attackers.includes(k);
  const side = att ? w.attackers : w.defenders;
  const enemyLeader = att ? w.leaderD : w.leaderA;
  const leader = att ? w.leaderA : w.leaderD;
  const st = capitulationStatus(state, map, rules, w, k);
  const why = `${Math.round(st.share * 100)}% of its provinces and its capital occupied`;
  const involves = w.attackers.includes(state.player) || w.defenders.includes(state.player);
  // allies still fighting: those not themselves beaten and not k's own subjects
  const standing = side.filter((x) => x !== k && C[x].alive && overlordOf(state, x) !== k
    && C[x].cache.occupied / Math.max(1, C[x].cache.provinces) < st.threshold);
  const notice = { day: state.day, war: w.name, country: k, enemy: enemyLeader, why, terms: null, separate: false };
  if (k !== leader || standing.length) {
    // leaves the war alone
    const provinces = separateCession(state, map, rules, w, k);
    if (k === leader) {
      const next = standing.reduce((m, x) => (C[x].cache.armyPower > C[m].cache.armyPower ? x : m), standing[0]);
      if (att) w.leaderA = next; else w.leaderD = next;
    }
    // the capitulating country's subjects leave with it
    const subs = subjectsOf(state, k).filter((s) => side.includes(s));
    makeSeparatePeace(state, map, rules, w, k, { provinces });
    for (const s of subs) if (state.wars.includes(w) && side.includes(s) && s !== (att ? w.leaderA : w.leaderD)) makeSeparatePeace(state, map, rules, w, s, { provinces: [] });
    if (state.dip && C[k].alive && C[enemyLeader].alive) {
      const D = rules.balance.diplomacy;
      signTreaty(state, map, rules, 'reparations', k, enemyLeader, { until: state.day + (D?.reparationsYears ?? 5) * 365, quiet: true });
    }
    notice.terms = { provinces: provinces.map((p) => map.name[p]), reparations: !!state.dip };
    notice.separate = true;
  } else {
    const terms = capitulationTerms(state, map, rules, w, enemyLeader);
    notice.terms = { provinces: (terms.provinces || []).map((p) => map.name[p]), reparations: !!terms.reparations, subject: !!terms.subject };
    makePeace(state, map, rules, w, enemyLeader, terms);
  }
  const t = notice.terms, parts = [];
  if (t.subject) parts.push(`becomes a subject of ${C[enemyLeader].name}`);
  if (t.provinces.length) parts.push(`cedes ${t.provinces.length} province${t.provinces.length === 1 ? '' : 's'}`);
  if (t.reparations) parts.push('pays reparations');
  const text = `${C[k].name} capitulated to ${C[enemyLeader].name} (${why})${parts.length ? ' and ' + parts.join(', ') : ''}.`;
  log(state, 'peace', text, { important: involves || k === state.player });
  aiLog(state, k, `Capitulated in the ${w.name}: ${why}.`);
  notice.text = text;
  if (involves) (state.capitulations ||= []).push(notice);
  return notice;
}
