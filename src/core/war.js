// War declarations, war score, peace negotiation and territorial transfer.
import { atWar, allied, touchRelations, warBetween } from './relations.js';
import { log, refreshCountryCache, provinceGdp } from './state.js';

export function canDeclareWar(state, map, a, b) {
  const C = state.countries;
  if (a === b) return 'Cannot declare war on yourself';
  if (!C[a]?.alive || !C[b]?.alive) return 'Country does not exist';
  if (atWar(state, a, b)) return 'Already at war';
  if (allied(state, a, b)) return 'You are allied; leave the alliance first';
  const t = C[a].truces[b];
  if (t != null && t > state.day) return `Truce in force for ${t - state.day} more days`;
  return null;
}

export function declareWar(state, map, rules, a, b) {
  const why = canDeclareWar(state, map, a, b);
  if (why) return why;
  const C = state.countries;
  const defenders = [b];
  // defensive alliances: every ally of the target that is not also allied to the attacker joins
  for (const al of state.alliances) {
    if (!al.members.includes(b)) continue;
    for (const m of al.members) {
      if (m === b || defenders.includes(m) || !C[m].alive) continue;
      if (allied(state, m, a)) continue;
      defenders.push(m);
    }
  }
  const war = {
    id: state.nextId++, name: `${C[a].name}–${C[b].name} War`, attackers: [a], defenders,
    leaderA: a, leaderD: b, start: state.day, battleScore: 0,
  };
  state.wars.push(war);
  touchRelations(state);
  // break alliances the attacker had with defenders (none possible here) and lower stability
  C[a].stability = Math.max(0, C[a].stability - 3);
  const joined = defenders.slice(1).map((k) => C[k].name);
  const involvesPlayer = war.attackers.includes(state.player) || defenders.includes(state.player);
  log(state, 'war', `${C[a].name} declared war on ${C[b].name}.` + (joined.length ? ` Allies joining: ${joined.join(', ')}.` : ''),
    { important: involvesPlayer, war: war.id });
  return null;
}

// Value of a province for war score: share of economic weight inside its owner's realm.
export function provinceValue(state, rules, p) {
  return provinceGdp(state, p, rules.balance.economy) + state.prov.pop[p] / 2e6 + 0.5;
}

function sideValue(state, map, rules, side) {
  let total = 0;
  for (const i of map.ids) if (side.includes(state.prov.owner[i])) total += provinceValue(state, rules, i);
  return total;
}

function occupiedValue(state, map, rules, holders, owners) {
  let v = 0;
  for (const i of map.ids) {
    if (owners.includes(state.prov.owner[i]) && holders.includes(state.prov.controller[i])) v += provinceValue(state, rules, i);
  }
  return v;
}

// War score from the attackers' perspective, -100..100.
export function warScore(state, map, rules, war) {
  const dv = sideValue(state, map, rules, war.defenders) || 1;
  const av = sideValue(state, map, rules, war.attackers) || 1;
  const occA = (occupiedValue(state, map, rules, war.attackers, war.defenders) / dv) * 100;
  const occD = (occupiedValue(state, map, rules, war.defenders, war.attackers) / av) * 100;
  return Math.max(-100, Math.min(100, occA - occD + war.battleScore));
}

// Cost in war score of taking `provinces` from the losing side.
export function demandCost(state, map, rules, war, provinces, takerIsAttacker) {
  const loserSide = takerIsAttacker ? war.defenders : war.attackers;
  const lv = sideValue(state, map, rules, loserSide) || 1;
  let v = 0;
  for (const p of provinces) v += provinceValue(state, rules, p);
  return (v / lv) * 100 * 1.15;
}

// Validates a peace proposal. terms = { provinces: [ids], to: countryIdx } (empty = white peace)
export function validatePeace(state, map, rules, war, from, terms) {
  if (!state.wars.includes(war)) return 'War is over';
  const fromAtt = war.attackers.includes(from);
  if (!fromAtt && !war.defenders.includes(from)) return 'Not a participant';
  const winnerSide = fromAtt ? war.attackers : war.defenders;
  const loserSide = fromAtt ? war.defenders : war.attackers;
  for (const p of terms.provinces || []) {
    if (!map.exists[p]) return 'Invalid province';
    if (!loserSide.includes(state.prov.owner[p])) return `${map.name[p]} does not belong to the other side`;
    if (!winnerSide.includes(state.prov.controller[p])) return `${map.name[p]} must be occupied by your side`;
  }
  return null;
}

// Would the leader of the other side accept? Returns { accept, reason, cost, score }.
export function evaluatePeace(state, map, rules, war, from, terms) {
  const why = validatePeace(state, map, rules, war, from, terms);
  if (why) return { accept: false, reason: why, cost: 0, score: 0 };
  const fromAtt = war.attackers.includes(from);
  const score = warScore(state, map, rules, war) * (fromAtt ? 1 : -1); // proposer's perspective
  const provinces = terms.provinces || [];
  const cost = demandCost(state, map, rules, war, provinces, fromAtt);
  const months = (state.day - war.start) / 30;
  const W = rules.balance.war;
  if (!provinces.length) {
    // white peace: accepted when the receiver is not clearly winning, or the war has dragged on
    const recvScore = -score;
    const willing = recvScore < 10 + Math.max(0, months - W.exhaustionDays / 30) * 2 || recvScore < 0;
    return { accept: willing, reason: willing ? 'They accept a white peace.' : `They are winning (war score ${Math.round(recvScore)}) and refuse.`, cost: 0, score };
  }
  const accept = cost <= score;
  return {
    accept, cost, score,
    reason: accept ? 'Demands are justified by the war situation.' : `Demands cost ${Math.round(cost)} war score but you only have ${Math.round(score)}.`,
  };
}

export function makePeace(state, map, rules, war, from, terms) {
  const C = state.countries;
  const fromAtt = war.attackers.includes(from);
  const to = terms.to != null ? terms.to : from;
  const transferred = [];
  for (const p of terms.provinces || []) {
    transferProvince(state, map, p, to);
    transferred.push(map.name[p]);
  }
  endWar(state, map, rules, war);
  const loser = fromAtt ? war.leaderD : war.leaderA;
  log(state, 'peace', transferred.length
    ? `Peace: ${C[loser].name} ceded ${transferred.length} province(s) to ${C[to].name} (${transferred.slice(0, 4).join(', ')}${transferred.length > 4 ? '…' : ''}).`
    : `White peace between ${C[war.leaderA].name} and ${C[war.leaderD].name}.`,
  { important: war.attackers.includes(state.player) || war.defenders.includes(state.player) });
}

export function endWar(state, map, rules, war) {
  const idx = state.wars.indexOf(war);
  if (idx < 0) return;
  state.wars.splice(idx, 1);
  const T = rules.balance.war.truceDays;
  const C = state.countries;
  for (const a of war.attackers) for (const d of war.defenders) {
    C[a].truces[d] = state.day + T; C[d].truces[a] = state.day + T;
  }
  touchRelations(state);
  // occupations not settled by the treaty end; battles of this war stop
  for (const i of map.ids) {
    const o = state.prov.owner[i], c = state.prov.controller[i];
    if (c !== o && !atWar(state, o, c)) { state.prov.controller[i] = o; state.prov.siege[i] = 0; state.prov.siegeBy[i] = -1; }
  }
  for (const b of [...state.battles]) {
    const any = state.armies.find((a) => a.id === b.att[0]);
    const other = state.armies.find((a) => a.id === b.def[0]);
    if (!any || !other || !atWar(state, any.owner, other.owner)) {
      state.battles.splice(state.battles.indexOf(b), 1);
      for (const a of state.armies) if (a.battle === b.id) a.battle = 0;
    }
  }
  expelTroops(state, map);
  state.mapVersion = (state.mapVersion || 0) + 1;
  refreshCountryCache(state, map, rules);
}

// Armies left in territory they no longer have access to are sent home.
function expelTroops(state, map) {
  for (const a of state.armies) {
    const own = state.prov.owner[a.loc];
    if (own === a.owner || allied(state, own, a.owner) || atWar(state, own, a.owner)) continue;
    const cap = state.countries[a.owner].capital;
    if (cap >= 0) { a.loc = cap; a.path = []; a.prog = 0; }
  }
}

export function transferProvince(state, map, p, to) {
  const from = state.prov.owner[p];
  state.prov.owner[p] = to;
  state.prov.controller[p] = to;
  state.prov.siege[p] = 0; state.prov.siegeBy[p] = -1;
  state.mapVersion = (state.mapVersion || 0) + 1;
  const C = state.countries;
  if (from >= 0 && C[from].capital === p) {
    let best = -1, bv = -1;
    for (const i of map.ids) if (state.prov.owner[i] === from && state.prov.pop[i] > bv) { bv = state.prov.pop[i]; best = i; }
    C[from].capital = best;
  }
  if (from >= 0 && !map.ids.some((i) => state.prov.owner[i] === from)) eliminate(state, map, from);
}

export function eliminate(state, map, c) {
  const C = state.countries;
  C[c].alive = false;
  state.armies = state.armies.filter((a) => a.owner !== c);
  state.recruit = state.recruit.filter((r) => r.owner !== c);
  for (const al of state.alliances) al.members = al.members.filter((m) => m !== c);
  for (const w of [...state.wars]) {
    w.attackers = w.attackers.filter((x) => x !== c);
    w.defenders = w.defenders.filter((x) => x !== c);
    if (w.leaderA === c && w.attackers.length) w.leaderA = w.attackers[0];
    if (w.leaderD === c && w.defenders.length) w.leaderD = w.defenders[0];
  }
  touchRelations(state);
  log(state, 'war', `${C[c].name} has ceased to exist.`, { important: true });
  if (c === state.player) state.gameOver = { day: state.day, reason: `${C[c].name} was annexed.` };
  for (const w of [...state.wars]) if (!w.attackers.length || !w.defenders.length) state.wars.splice(state.wars.indexOf(w), 1);
}

export { warBetween };
