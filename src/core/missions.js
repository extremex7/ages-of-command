// Missions (national objectives): every country keeps up to `count` objectives drawn from its
// situation: grow the economy, take back a claimed province, form a nation it is close to, ally a
// friendly neighbour, reach the next era, beat its rival, restore order, clear its debts, win
// independence. Each has a deadline and a reward (prestige bonus, money, stability, legitimacy,
// influence, claims). Finished, expired or impossible objectives are replaced by new ones. The AI
// pursues them loosely: a mission naming a country adds to its war motive (ai.js) and an alliance
// mission makes it propose one. Numbers: data/rules/nations.json → missions. See docs/NATIONS.md.
//
// Saved per country (optional): c.missions = [{ id, kind, start, until, from, v, t, p, f, provs,
// reward }] and c.mHist = { kind: day it last ended } (a kind is not offered again for repeatMonths).
import { log, aiLog, logFor, isHuman, humanControls } from './state.js';
import { hashRand } from './natfx.js';
import { civilFromDays } from './calendar.js';
import { allied, atWar } from './relations.js';
import { countryNeighbours } from './geo.js';
import { overlordOf, addClaim, opinion, proposeTreaty, evaluateTreaty, recentlyRefused } from './diplomacy.js';
import { formablesFor, formStatus, holderOf, formableRegion } from './nations.js';

const PRIORITY = { independence: 5, debt: 4, stability: 4, form: 3, claim: 3, rival: 2.5, ally: 2, era: 1.5, gdp: 1 };

function bn(b) {
  const a = Math.abs(b);
  return (b < 0 ? '−' : '') + (a >= 1000 ? (a / 1000).toFixed(2) + 'T' : a >= 100 ? a.toFixed(0) + 'B' : a >= 1 ? a.toFixed(1) + 'B' : (a * 1000).toFixed(0) + 'M');
}

// Objectives country c could take on now (one per kind).
function candidates(state, map, rules, c) {
  const M = rules.nations.missions, C = state.countries, k = c.idx, out = [];
  const nb = countryNeighbours(state, map).sets[k];
  const lord = state.dip ? overlordOf(state, k) : -1;
  if (lord >= 0) out.push({ kind: 'independence', t: lord });
  if (c.treasury < 0 && c.ledger) out.push({ kind: 'debt', from: c.treasury });
  if (c.stability < M.stability.below) out.push({ kind: 'stability', from: c.stability, v: M.stability.target });
  // a claimed province held by someone we are not allied with: the most populous
  let best = -1;
  for (const x of c.claims || []) {
    const o = state.prov.owner[x.p];
    if (o < 0 || o === k || allied(state, k, o) || !C[o].alive) continue;
    if (best < 0 || state.prov.pop[x.p] > state.prov.pop[best]) best = x.p;
  }
  if (best >= 0) out.push({ kind: 'claim', p: best, t: state.prov.owner[best] });
  // the rival's border provinces next to ours
  if (c.rival >= 0 && C[c.rival].alive && nb.has(c.rival)) {
    const provs = [];
    for (const i of countryNeighbours(state, map).border[c.rival]) {
      for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) if (map.adjKind[e] !== 2 && state.prov.owner[map.adj[e]] === k) { provs.push(i); break; }
    }
    provs.sort((a, b) => state.prov.pop[b] - state.prov.pop[a]);
    if (provs.length) out.push({ kind: 'rival', t: c.rival, provs: provs.slice(0, 6) });
  }
  // a nation it is well on the way to forming (only the share of the region is missing)
  for (const { id, st } of formablesFor(state, map, rules, k)) {
    if (st.share >= M.form.minShare && (st.ok || st.why?.startsWith('Own '))) { out.push({ kind: 'form', f: id, from: st.share }); break; }
  }
  // a friendly neighbour to ally: the strongest one that likes us enough
  let ally = -1, ap = -1;
  for (const t of nb) {
    const T = C[t];
    if (!T.alive || allied(state, k, t) || atWar(state, k, t) || t === c.rival || T.rival === k) continue;
    if (opinion(state, map, rules, t, k) < M.ally.minOpinion) continue;
    const pw = T.cache?.armyPower || 0;
    if (pw > ap) { ap = pw; ally = t; }
  }
  if (ally >= 0) out.push({ kind: 'ally', t: ally });
  const era = c.tfx?.era ?? 0;
  if (rules.tech && era < rules.tech.eras.length - 1) out.push({ kind: 'era', v: era + 1 });
  if (c.cache?.gdp > 0) {
    const [lo, hi] = M.gdp.growth;
    out.push({ kind: 'gdp', from: c.cache.gdp, v: c.cache.gdp * (lo + (hi - lo) * hashRand(state, 'm-gdp', k)) });
  }
  return out;
}

// Rewards are fixed when the objective is given (money as an amount, from this month's revenue).
function makeReward(rules, c, kind) {
  const R = rules.nations.missions[kind].reward, rev = Math.max(0, c.ledger?.revenue || 0), out = {};
  for (const [k, v] of Object.entries(R)) {
    if (k === 'moneyMonths') out.money = Math.round(v * rev * 1000) / 1000;
    else out[k] = v;
  }
  return out;
}

export function describeReward(state, r, m) {
  const out = [];
  if (r.prestige) out.push(`prestige +${r.prestige}`);
  if (r.money) out.push(`${bn(r.money)} to the treasury`);
  if (r.stability) out.push(`stability +${r.stability}`);
  if (r.legitimacy) out.push(`legitimacy +${r.legitimacy}`);
  if (r.influence) out.push(`influence +${r.influence}`);
  if (r.claims && m?.t >= 0) out.push(`claims on ${state.countries[m.t].name}'s border provinces`);
  return out.join(', ');
}

// A short title and a sentence for an objective.
export function missionText(state, map, rules, m) {
  const C = state.countries, T = m.t >= 0 ? C[m.t]?.name : '';
  switch (m.kind) {
    case 'gdp': return { title: `Grow the economy to ${bn(m.v)} a year`, text: `Raise the GDP from ${bn(m.from)} to ${bn(m.v)}.` };
    case 'claim': return { title: `Take back ${map.name[m.p]}`, text: `${map.name[m.p]} is ours by right. Own it again.` };
    case 'form': { const F = rules.nations.formables[m.f]; return { title: `Form ${F.name}`, text: `${F.text} Own enough of its region, then use the decision in the Nation tab.` }; }
    case 'ally': return { title: `Ally with ${T}`, text: `Sign an alliance or defensive pact with ${T}, or share a defence bloc.` };
    case 'era': return { title: `Enter the ${rules.tech.eras[m.v].name} era`, text: `Know half the technologies of the ${rules.tech.eras[m.v].name} era (and every era before).` };
    case 'rival': return { title: `Humble ${T}`, text: `Take one of ${T}'s border provinces: ${m.provs.slice(0, 3).map((p) => map.name[p]).join(', ')}${m.provs.length > 3 ? ' or another' : ''}.` };
    case 'stability': return { title: 'Restore order', text: `Raise stability to ${m.v}.` };
    case 'debt': return { title: 'Clear the debt', text: 'Bring the treasury back above zero.' };
    case 'independence': return { title: 'Break free', text: `End our subjection to ${T}.` };
  }
  return { title: m.kind, text: '' };
}

// Progress 0–1, and whether the objective is done or can no longer be done.
export function missionProgress(state, map, rules, c, m) {
  const C = state.countries, k = c.idx, cl = (x) => Math.max(0, Math.min(1, x));
  switch (m.kind) {
    case 'gdp': { const g = c.cache?.gdp || 0; return { p: cl((g - m.from) / Math.max(1e-9, m.v - m.from)), done: g >= m.v }; }
    case 'claim': return { p: state.prov.owner[m.p] === k ? 1 : 0, done: state.prov.owner[m.p] === k };
    case 'form': {
      if (c.formed?.includes(m.f)) return { p: 1, done: true };
      if (holderOf(state, rules, m.f, k) >= 0) return { p: 0, done: false, void: true };
      const st = formStatus(state, map, rules, k, m.f);
      return { p: cl(st.share / st.need), done: false };
    }
    case 'ally': return C[m.t].alive ? { p: allied(state, k, m.t) ? 1 : 0, done: allied(state, k, m.t) } : { p: 0, done: false, void: true };
    case 'era': {
      if ((c.tfx?.era ?? 0) >= m.v) return { p: 1, done: true };
      const ts = rules.tech.byEra[m.v];
      let kn = 0;
      for (const t of ts) if (state.tech.known[k * state.tech.T + t]) kn++;
      return { p: cl(ts.length ? kn / ts.length / 0.5 : 0), done: false };
    }
    case 'rival': {
      const done = m.provs.some((p) => state.prov.owner[p] === k);
      return C[m.t].alive || done ? { p: done ? 1 : 0, done } : { p: 0, done: false, void: true };
    }
    case 'stability': return { p: cl((c.stability - m.from) / Math.max(1, m.v - m.from)), done: c.stability >= m.v };
    case 'debt': return { p: cl(1 - c.treasury / Math.min(-1e-9, m.from)), done: c.treasury >= 0 };
    case 'independence': { const free = !state.dip || overlordOf(state, k) < 0; return { p: free ? 1 : 0, done: free }; }
  }
  return { p: 0, done: false, void: true };
}

function grant(state, map, rules, c, m) {
  const r = m.reward || {};
  if (r.prestige) c.prestigeBonus = (c.prestigeBonus || 0) + r.prestige;
  if (r.money) c.treasury += r.money;
  if (r.stability) c.stability = Math.min(100, c.stability + r.stability);
  if (r.legitimacy && c.govt) c.govt.legitimacy = Math.min(100, c.govt.legitimacy + r.legitimacy);
  if (r.influence && c.influence != null) c.influence = Math.min(rules.balance.diplomacy.influenceCap, c.influence + r.influence);
  if (r.claims && m.t >= 0 && state.dip && state.countries[m.t].alive) {
    for (const i of countryNeighbours(state, map).border[m.t]) {
      for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) if (state.prov.owner[map.adj[e]] === c.idx) { addClaim(state, c.idx, i); break; }
    }
  }
}

// Monthly: progress, rewards, expiry and new objectives (AI countries every third month, staggered).
export function monthlyMissions(state, map, rules) {
  const M = rules.nations?.missions;
  if (!M) return;
  const { y, m: month } = civilFromDays(state.day), mi = y * 12 + month;
  for (const c of state.countries) {
    if (!c.alive || !c.cache) continue;
    const me = humanControls(state, c.idx);
    if (c.missions?.length) {
      const keep = [];
      for (const m of c.missions) {
        const pr = missionProgress(state, map, rules, c, m);
        const tx = () => missionText(state, map, rules, m).title;
        if (pr.done) {
          grant(state, map, rules, c, m);
          (c.mHist ||= {})[m.kind] = state.day;
          if (me) logFor(state, c.idx, 'politics', `Objective complete: ${tx()}. Reward: ${describeReward(state, m.reward, m)}.`, { important: true, mission: m.kind });
          continue;
        }
        if (pr.void || state.day > m.until) {
          (c.mHist ||= {})[m.kind] = state.day;
          if (me) logFor(state, c.idx, 'politics', `Objective ${pr.void ? 'no longer possible' : 'expired'}: ${tx()}.`);
          continue;
        }
        keep.push(m);
      }
      c.missions = keep;
    }
    if (!me && (mi + c.idx) % 3) { aiPursue(state, map, rules, c, mi); continue; }
    if ((c.missions?.length || 0) < M.count) addMission(state, map, rules, c, me);
    if (!me) aiPursue(state, map, rules, c, mi);
  }
}

function addMission(state, map, rules, c, me) {
  const M = rules.nations.missions, active = new Set((c.missions || []).map((m) => m.kind));
  const cands = candidates(state, map, rules, c).filter((x) => !active.has(x.kind) && !(c.mHist?.[x.kind] != null && state.day - c.mHist[x.kind] < M.repeatMonths * 30.44));
  if (!cands.length) return null;
  // weighted by priority: urgent troubles first, ambitions after
  let tot = 0;
  for (const x of cands) tot += PRIORITY[x.kind];
  let r = hashRand(state, 'm-pick', c.idx) * tot, pick = cands[0];
  for (const x of cands) { r -= PRIORITY[x.kind]; if (r <= 0) { pick = x; break; } }
  const m = { id: state.nextId++, ...pick, start: state.day, until: state.day + Math.round(M[pick.kind].years * 365.25), reward: makeReward(rules, c, pick.kind) };
  (c.missions ||= []).push(m);
  if (me) logFor(state, c.idx, 'politics', `New objective: ${missionText(state, map, rules, m).title} (Nation tab). Reward: ${describeReward(state, m.reward, m)}.`, { important: true, mission: m.kind });
  return m;
}

// The AI's loose pursuit: an alliance mission makes it offer an alliance, or else a defensive
// pact, twice a year when the other side would accept (war motives from missions are read by
// ai.js through missionMotive).
function aiPursue(state, map, rules, c, mi) {
  if ((mi + c.idx) % 6) return;
  for (const m of c.missions || []) {
    if (m.kind !== 'ally' || !state.countries[m.t].alive || isHuman(state, m.t)) continue;
    for (const type of ['alliance', 'defensive']) {
      if (recentlyRefused(state, rules, type, c.idx, m.t) || !evaluateTreaty(state, map, rules, type, c.idx, m.t).accept) continue;
      const res = proposeTreaty(state, map, rules, type, c.idx, m.t);
      aiLog(state, c.idx, `Offered ${type === 'alliance' ? 'an alliance' : 'a defensive pact'} to ${state.countries[m.t].name} for its objective: ${res.reason}`);
      break;
    }
  }
}

// Extra war motive against country t from c's objectives: a claim or rival mission against it, or
// a nation to form whose region it holds part of.
export function missionMotive(state, map, rules, c, t) {
  const M = rules.nations?.missions;
  if (!M || !c.missions?.length) return 0;
  for (const m of c.missions) {
    if ((m.kind === 'claim' || m.kind === 'rival') && m.t === t) return M.aiMotive;
    if (m.kind === 'claim' && state.prov.owner[m.p] === t) return M.aiMotive;
    if (m.kind === 'form') for (const p of formableRegion(map, rules, m.f)) if (state.prov.owner[p] === t) return M.aiMotive;
  }
  return 0;
}
