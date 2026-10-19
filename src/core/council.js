// World council: from 1920 (the League of Nations; the United Nations from 1945) every country
// votes on resolutions:
//   - sanctions on a country: arms (munitions, machinery, electronics), energy (coal, oil, gas,
//     fuel, uranium) or full (all trade), kept by every country that did not vote against;
//   - a ceasefire in a war: one year without fighting (the war goes on on paper, peace can be
//     signed, and fighting resumes when it ends);
//   - a demilitarised zone between two countries: neither may station troops in the provinces
//     along their shared border for ten years.
// The five countries with the highest prestige when the council is founded (and again when the
// League becomes the UN) are permanent members and can veto. A resolution passes with more yes than no votes and no veto. Countries may
// also impose arms or energy sanctions on their own (c.econ.sanctions).
// Numbers: balance.json → council. See docs/DIPLOMACY.md (World council).
import { log, aiLog } from './state.js';
import { rand } from './rng.js';
import { touchRelations, allied, atWar } from './relations.js';
import { opinion, addMod } from './diplomacy.js';
import { warScore } from './war.js';
import { civilFromDays } from './calendar.js';
import { neighbours } from './mapdata.js';
import { tradePartners } from './industry.js';

export const RES_KINDS = ['sanction', 'ceasefire', 'dmz'];
export const SANCTION_LEVELS = ['arms', 'energy', 'full'];
export const SANCTION_NAMES = { arms: 'Arms sanctions', energy: 'Energy sanctions', full: 'Full sanctions' };

const year = (state) => civilFromDays(state.day).y;

export function inCeasefire(state, w) { return w.ceasefire != null && w.ceasefire > state.day; }

export function councilActive(state, rules) {
  const K = rules.balance.council;
  return !!K && year(state) >= K.fromYear && !!state.dip;
}

export function councilName(state, rules) {
  return year(state) >= rules.balance.council.unYear ? 'United Nations' : 'League of Nations';
}

export function councilOf(state) {
  return (state.council ||= { pending: [], active: [], permanent: [], lastAi: -1e9, lastBy: {}, nextId: 1 });
}

// Goods each sanction level blocks (indices), from balance.council.sanctionGoods.
export function sanctionGoods(rules, level) {
  const X = rules.econ, ids = rules.balance.council?.sanctionGoods?.[level];
  return ids ? ids.filter((id) => id in X.gi).map((id) => X.gi[id]) : [];
}

function permanentMembers(state) {
  const P = state.prestige;
  if (!P?.rank) return [];
  return state.countries.filter((c) => c.alive && P.rank[c.idx] >= 1 && P.rank[c.idx] <= 5).map((c) => c.idx);
}

// Why `by` cannot propose `res` now, or null.
export function canPropose(state, map, rules, by, res) {
  const K = rules.balance.council, C = state.countries;
  if (!councilActive(state, rules)) return `The world council meets from ${K.fromYear}`;
  if (!RES_KINDS.includes(res.kind)) return 'Unknown resolution';
  const W = councilOf(state);
  if (state.day - (W.lastBy[by] ?? -1e9) < K.proposeCooldownDays) return `You can propose one resolution every ${Math.round(K.proposeCooldownDays / 30)} months`;
  if (by === state.player && C[by].influence < K.proposeInfluence) return `Needs ${K.proposeInfluence} influence`;
  const same = (r) => r.kind === res.kind && r.target === res.target && r.war === res.war && r.a === res.a && r.b === res.b;
  if (W.pending.some(same)) return 'Already being voted on';
  if (res.kind === 'sanction') {
    if (!C[res.target]?.alive || res.target === by) return 'Pick a country';
    if (!SANCTION_LEVELS.includes(res.level)) return 'Pick arms, energy or full sanctions';
    if (W.active.some((r) => r.kind === 'sanction' && r.target === res.target && r.level === res.level)) return 'Those sanctions are already in force';
  } else if (res.kind === 'ceasefire') {
    const w = state.wars.find((x) => x.id === res.war);
    if (!w) return 'Pick a war';
    if (inCeasefire(state, w)) return 'A ceasefire is already in force';
  } else if (res.kind === 'dmz') {
    if (!C[res.a]?.alive || !C[res.b]?.alive || res.a === res.b) return 'Pick two countries';
    if (!dmzProvinces(state, map, res.a, res.b).length) return 'They share no land border';
    if (W.active.some((r) => r.kind === 'dmz' && ((r.a === res.a && r.b === res.b) || (r.a === res.b && r.b === res.a)))) return 'A demilitarised zone is already in force';
  }
  return null;
}

const resKey = (r) => `${r.kind}:${r.target ?? -1}:${r.level || ''}:${r.war || 0}:${r.a ?? -1}:${r.b ?? -1}`;

export function describeRes(state, rules, r) {
  const C = state.countries;
  if (r.kind === 'sanction') return `${SANCTION_NAMES[r.level]} on ${C[r.target].name}`;
  if (r.kind === 'ceasefire') return `Ceasefire in the ${r.warName}`;
  return `Demilitarised zone between ${C[r.a].name} and ${C[r.b].name}`;
}

export function propose(state, map, rules, by, res) {
  const why = canPropose(state, map, rules, by, res);
  if (why) return { error: why };
  const K = rules.balance.council, W = councilOf(state);
  if (by === state.player) state.countries[by].influence -= K.proposeInfluence;
  W.lastBy[by] = state.day;
  const r = { id: W.nextId++, kind: res.kind, target: res.target ?? -1, level: res.level, war: res.war ?? 0, a: res.a ?? -1, b: res.b ?? -1, by, day: state.day, voteDay: state.day + K.voteDays, votes: {} };
  if (r.kind === 'ceasefire') r.warName = state.wars.find((w) => w.id === r.war).name;
  W.pending.push(r);
  const text = `${state.countries[by].name} proposes to the ${councilName(state, rules)}: ${describeRes(state, rules, r)}. Vote within ${K.voteDays} days (Diplomacy tab).`;
  log(state, 'diplomacy', text, { important: state.player >= 0 && by !== state.player, council: r.id });
  return { res: r };
}

export function castVote(state, k, id, vote) {
  const r = councilOf(state).pending.find((x) => x.id === id);
  if (!r) return 'No such resolution';
  if (!['yes', 'no', 'abstain'].includes(vote)) return 'Vote yes, no or abstain';
  r.votes[k] = vote;
  return null;
}

function powerOf(c) { return (c.cache?.armyPower || 0) + (c.cache?.navyPower || 0) + (c.cache?.airPower || 0); }

// How an AI country votes, with a score (positive = yes).
export function aiVote(state, map, rules, k, r) {
  const C = state.countries;
  let s = 0;
  if (r.kind === 'sanction') {
    const t = r.target;
    if (k === t) return 'no';
    if (allied(state, k, t)) return 'no';
    s = -0.5 * opinion(state, map, rules, k, t) + 0.15 * opinion(state, map, rules, k, r.by) - 15;
    if (atWar(state, k, t)) s += 40;
    if (C[t].reputation < -30) s += 15;
    if (state.wars.some((w) => w.leaderA === t && w.justified === false && w.kind !== 'civil')) s += 15;
    // sanctions on a big trading partner hurt the voter too
    if (tradePartners(state, k, 5)?.some(([j]) => j === t)) s -= 20;
  } else if (r.kind === 'ceasefire') {
    const w = state.wars.find((x) => x.id === r.war);
    if (!w) return 'abstain';
    const sc = warScore(state, map, rules, w);
    const side = w.attackers.includes(k) ? 1 : w.defenders.includes(k) ? -1 : 0;
    if (side) return sc * side > 10 ? 'no' : 'yes';
    // outsiders want peace, unless they side with whoever is winning
    s = 15;
    const winner = sc > 10 ? w.leaderA : sc < -10 ? w.leaderD : -1;
    if (winner >= 0 && (allied(state, k, winner) || opinion(state, map, rules, k, winner) > 50)) s -= 40;
  } else {
    if (k === r.a || k === r.b) {
      // the weaker side wants the zone
      const other = k === r.a ? r.b : r.a;
      return powerOf(C[k]) <= powerOf(C[other]) ? 'yes' : 'no';
    }
    s = 10;
    for (const p of [r.a, r.b]) if (allied(state, k, p)) s -= powerOf(C[p]) > powerOf(C[p === r.a ? r.b : r.a]) ? 25 : -10;
  }
  // a vote against takes real opposition; mild doubts abstain
  return s > 10 ? 'yes' : s < -25 ? 'no' : 'abstain';
}

// Tally: every alive country's vote (the player's as cast, abstaining otherwise).
export function tally(state, map, rules, r) {
  const W = councilOf(state), out = { yes: 0, no: 0, abstain: 0, veto: [], votes: {} };
  for (const c of state.countries) {
    if (!c.alive) continue;
    const v = r.votes[c.idx] ?? (c.idx === state.player ? 'abstain' : aiVote(state, map, rules, c.idx, r));
    out.votes[c.idx] = v; out[v]++;
    if (v === 'no' && W.permanent.includes(c.idx)) out.veto.push(c.idx);
  }
  out.passes = out.yes > out.no && !out.veto.length;
  return out;
}

// Border provinces of a and b along their shared land border (both sides).
export function dmzProvinces(state, map, a, b) {
  const P = state.prov, out = [];
  for (const i of map.ids) {
    const o = P.owner[i];
    if (o !== a && o !== b) continue;
    const other = o === a ? b : a;
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) if (map.adjKind[e] !== 2 && P.owner[map.adj[e]] === other) { out.push(i); break; }
  }
  return out;
}

function apply(state, map, rules, r, t) {
  const K = rules.balance.council, C = state.countries, W = councilOf(state);
  if (r.kind === 'sanction') {
    const comply = Object.entries(t.votes).filter(([k, v]) => v !== 'no' && +k !== r.target).map(([k]) => +k);
    W.active.push({ kind: 'sanction', target: r.target, level: r.level, comply, until: state.day + K.sanctionYears * 365, id: r.id });
    for (const k of comply) if (t.votes[k] === 'yes') addMod(state, r.target, k, -K.sanctionOpinion, rules.balance.diplomacy.modDecay, 'Voted to sanction us');
  } else if (r.kind === 'ceasefire') {
    const w = state.wars.find((x) => x.id === r.war);
    if (!w) return;
    w.ceasefire = state.day + K.ceasefireDays;
    touchRelations(state);
    // fighting stops: battles between the two sides end where they stand
    state.battles = state.battles.filter((b) => b.war !== w.id);
    for (const a of state.armies) if (a.battle && !state.battles.some((b) => b.id === a.battle)) a.battle = 0;
  } else {
    const provs = dmzProvinces(state, map, r.a, r.b);
    W.active.push({ kind: 'dmz', a: r.a, b: r.b, provs, until: state.day + K.dmzYears * 365, id: r.id });
    touchRelations(state);
    clearDmz(state, map, provs, [r.a, r.b]);
  }
}

// Armies of the parties leave the zone for the nearest province of their own outside it.
function clearDmz(state, map, provs, parties) {
  const zone = new Set(provs);
  for (const a of state.armies) {
    if (!parties.includes(a.owner) || !zone.has(a.loc) || a.sea >= 0) continue;
    const seen = new Set([a.loc]), q = [a.loc];
    let to = state.countries[a.owner].capital;
    while (q.length) {
      const i = q.shift();
      if (!zone.has(i) && state.prov.controller[i] === a.owner) { to = i; break; }
      for (const n of neighbours(map, i)) if (!seen.has(n) && seen.size < 400) { seen.add(n); q.push(n); }
    }
    if (to >= 0) { a.loc = to; a.path = []; a.prog = 0; a.battle = 0; }
  }
}

// Provinces where a country may not go: DMZs it is party to. Used by relations.canEnter.
export function dmzBlock(state) {
  const W = state.council;
  if (!W?.active.length) return null;
  let m = null;
  for (const r of W.active) if (r.kind === 'dmz') for (const p of r.provs) { m ||= new Map(); (m.get(p) || m.set(p, []).get(p)).push(r.a, r.b); }
  return m;
}

// Partial trade bans for the market: [country, partner, level] for every active sanction,
// council ones and the ones countries impose on their own.
export function sanctionPairs(state) {
  const out = [];
  for (const r of state.council?.active || []) if (r.kind === 'sanction') for (const k of r.comply) out.push([k, r.target, r.level]);
  for (const c of state.countries) if (c.alive && c.econ?.sanctions) for (const [t, lv] of Object.entries(c.econ.sanctions)) out.push([c.idx, +t, lv]);
  return out;
}

export function setSanction(state, k, target, level) {
  const e = state.countries[k].econ;
  e.sanctions ||= {};
  if (!level) delete e.sanctions[target]; else e.sanctions[target] = level;
}

// Monthly: permanent members, votes that are due, expiring resolutions, AI proposals.
export function monthlyCouncil(state, map, rules) {
  if (!councilActive(state, rules)) return;
  const K = rules.balance.council, W = councilOf(state), C = state.countries;
  // permanent seats go to the five most prestigious countries when the council is founded, and
  // again when the League of Nations becomes the United Nations
  const era = councilName(state, rules);
  W.permanent = W.permanent.filter((k) => C[k].alive);
  if (W.era !== era || !W.permanent.length) { W.era = era; W.permanent = permanentMembers(state); }
  for (const r of W.pending.filter((x) => x.voteDay <= state.day)) {
    W.pending.splice(W.pending.indexOf(r), 1);
    if (r.kind === 'ceasefire' && !state.wars.some((w) => w.id === r.war)) continue;
    if ((r.target >= 0 && !C[r.target]?.alive) || (r.a >= 0 && (!C[r.a]?.alive || !C[r.b]?.alive))) continue;
    const t = tally(state, map, rules, r);
    if (t.passes) apply(state, map, rules, r, t);
    const how = t.passes ? 'passed' : t.veto.length ? `vetoed by ${t.veto.map((k) => C[k].name).join(', ')}` : 'failed';
    const mine = state.player >= 0 && [r.target, r.a, r.b, r.by].includes(state.player);
    const inWar = r.kind === 'ceasefire' && state.wars.find((w) => w.id === r.war && (w.attackers.includes(state.player) || w.defenders.includes(state.player)));
    log(state, 'diplomacy', `${councilName(state, rules)}: ${describeRes(state, rules, r)} ${how} (${t.yes} yes, ${t.no} no, ${t.abstain} abstained).`, { important: mine || !!inWar });
    (W.history ||= []).push({ id: r.id, key: resKey(r), day: state.day, text: describeRes(state, rules, r), how, yes: t.yes, no: t.no });
    if (W.history.length > 20) W.history.shift();
  }
  // expiry
  let touched = false;
  W.active = W.active.filter((r) => {
    if (r.until > state.day && (r.kind !== 'sanction' || C[r.target]?.alive)) return true;
    if (r.kind === 'dmz') touched = true;
    return false;
  });
  for (const w of state.wars) if (w.ceasefire != null && w.ceasefire <= state.day) {
    delete w.ceasefire; touched = true;
    log(state, 'war', `The ceasefire in the ${w.name} has ended; fighting may resume.`, { important: w.attackers.includes(state.player) || w.defenders.includes(state.player), war: w.id });
  }
  if (touched) touchRelations(state);
  aiProposals(state, map, rules);
}

// AI: one resolution every few months at most, from the most prestigious country without a
// stake in it: a ceasefire in a long war, sanctions on an aggressor or a pariah, a DMZ between
// two countries under a ceasefire.
function aiProposals(state, map, rules) {
  const K = rules.balance.council, W = councilOf(state), C = state.countries, A = K.ai;
  if (state.day - W.lastAi < A.everyDays || rand(state) > A.chance) return;
  const rank = state.prestige?.rank || [];
  const byRank = C.filter((c) => c.alive && c.idx !== state.player && rank[c.idx] > 0).sort((a, b) => rank[a.idx] - rank[b.idx]);
  const tryRes = (res, stake) => {
    for (const c of byRank.slice(0, 15)) {
      if (stake.includes(c.idx)) continue;
      if (res.kind === 'sanction' && (allied(state, c.idx, res.target) || opinion(state, map, rules, c.idx, res.target) > 0)) continue;
      if (canPropose(state, map, rules, c.idx, res)) continue;
      // not again within two years of the same resolution failing
      if ((W.history || []).some((h) => h.key === resKey(res) && h.how !== 'passed' && state.day - h.day < 730)) return false;
      const out = propose(state, map, rules, c.idx, res);
      if (out.res) { W.lastAi = state.day; aiLog(state, c.idx, `Proposed to the world council: ${describeRes(state, rules, out.res)}.`); return true; }
    }
    return false;
  };
  for (const w of state.wars) {
    if (w.kind === 'civil' || inCeasefire(state, w) || state.day - w.start < A.ceasefireAfterDays) continue;
    if (tryRes({ kind: 'ceasefire', war: w.id }, [...w.attackers, ...w.defenders])) return;
  }
  for (const w of state.wars) {
    if (w.justified !== false || state.day - w.start > 365) continue;
    if (tryRes({ kind: 'sanction', target: w.leaderA, level: C[w.leaderA].reputation < -50 ? 'full' : 'arms' }, [w.leaderA])) return;
  }
  for (const c of C) if (c.alive && c.reputation < A.pariahReputation && tryRes({ kind: 'sanction', target: c.idx, level: 'arms' }, [c.idx])) return;
  for (const w of state.wars) if (inCeasefire(state, w) && tryRes({ kind: 'dmz', a: w.leaderA, b: w.leaderD }, [w.leaderA, w.leaderD])) return;
}
