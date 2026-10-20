// War declarations, war score, peace negotiation and territorial transfer.
import { atWar, allied, touchRelations, warBetween, hasAccess, isAtWar } from './relations.js';
import { log, refreshCountryCache, provinceGdp, aiLog } from './state.js';
import { overlordOf, subjectsOf, defendersOf, treatiesBetween, removeTreaty, breakTreatiesForWar, treatiesBrokenByWar, TREATIES,
  opinion, addMod, addClaim, hasClaim, signTreaty, forgetCountry } from './diplomacy.js';
import { recordPeace } from './record.js';
import { warExpertise } from './experience.js';

export function canDeclareWar(state, map, a, b) {
  const C = state.countries;
  if (a === b) return 'Cannot declare war on yourself';
  if (!C[a]?.alive || !C[b]?.alive) return 'Country does not exist';
  if (atWar(state, a, b)) return 'Already at war';
  const o = state.dip ? overlordOf(state, a) : -1;
  if (o >= 0 && o !== b) return `You are a subject of ${C[o].name}; only a war of independence against it is possible`;
  if (state.dip && overlordOf(state, b) === a) return `${C[b].name} is your subject; release it first`;
  if (o !== b && allied(state, a, b)) return 'You are allied; leave the alliance first';
  const t = C[a].truces[b];
  if (t != null && t > state.day) return `Truce in force for ${t - state.day} more days`;
  return null;
}

// Who joins a war declared by a on b: [defenders], with b first.
export function warJoiners(state, a, b) {
  const C = state.countries;
  const defenders = [b];
  const add = (m) => {
    if (m === a || defenders.includes(m) || !C[m]?.alive || allied(state, m, a)) return;
    defenders.push(m);
  };
  // defence blocs of the target: every member not also allied to the attacker joins
  for (const al of state.alliances) {
    if (al.kind === 'economic' || !al.members.includes(b)) continue;
    for (const m of al.members) add(m);
  }
  if (state.dip) {
    for (const m of defendersOf(state, b)) add(m);
    for (const d of [...defenders]) for (const s of subjectsOf(state, d)) add(s);
  }
  return defenders;
}

// What declaring war would cost the attacker, in words, for the declaration dialog.
export function warConsequences(state, map, rules, a, b) {
  const C = state.countries, D = rules.balance.diplomacy, out = [];
  if (!state.dip) return out;
  for (const t of treatiesBrokenByWar(state, a, b)) {
    const grave = t.type === 'nap' || t.type === 'guarantee';
    out.push(grave ? `Breaks your ${TREATIES[t.type].name.toLowerCase()}: reputation −${D.breakReputation[t.type]}, stability −${D.breakStability}, and every country thinks less of you.`
      : `Ends your ${TREATIES[t.type].name.toLowerCase()}.`);
  }
  if (!warJustified(state, a, b)) out.push(`Unprovoked war: reputation −${D.warDeclarationReputation}. (No claim on their land and they are not your rival.)`);
  const calls = state.dip.treaties.filter((t) => t.type === 'alliance' && (t.a === a || t.b === a)).map((t) => (t.a === a ? t.b : t.a)).filter((p) => !allied(state, p, b));
  if (calls.length) out.push(`Your allies will be called to arms: ${calls.map((k) => C[k].name).join(', ')}.`);
  return out;
}

export function warJustified(state, a, b) {
  const C = state.countries;
  if (!state.dip) return true;
  if (overlordOf(state, a) === b || C[a].rival === b) return true;
  return C[a].claims.some((x) => state.prov.owner[x.p] === b);
}

export function declareWar(state, map, rules, a, b) {
  const why = canDeclareWar(state, map, a, b);
  if (why) return why;
  const C = state.countries;
  const indep = state.dip && overlordOf(state, a) === b;
  const justified = warJustified(state, a, b);
  if (state.dip) breakTreatiesForWar(state, map, rules, a, b);
  const defenders = warJoiners(state, a, b);
  const attackers = [a];
  if (state.dip) for (const s of subjectsOf(state, a)) if (C[s].alive && !defenders.includes(s)) attackers.push(s);
  const war = {
    id: state.nextId++, name: indep ? `${C[a].name} War of Independence` : `${C[a].name}–${C[b].name} War`, attackers, defenders,
    leaderA: a, leaderD: b, start: state.day, battleScore: 0, kind: indep ? 'independence' : 'war', justified,
  };
  state.wars.push(war);
  touchRelations(state);
  if (state.dip) {
    clearTreatiesAcross(state, war);
    const D = rules.balance.diplomacy;
    if (!justified) C[a].reputation = Math.max(-100, C[a].reputation - D.warDeclarationReputation);
    addMod(state, b, a, D.declaredWarOpinion, D.modDecay, 'Declared war on us');
    for (const d of defenders.slice(1)) addMod(state, d, a, D.attackedAllyOpinion, D.modDecay, 'Attacked our ally');
  }
  C[a].stability = Math.max(0, C[a].stability - 3);
  const joined = defenders.slice(1).map((k) => C[k].name);
  const involvesPlayer = war.attackers.includes(state.player) || defenders.includes(state.player);
  log(state, 'war', `${C[a].name} declared war on ${C[b].name}.` + (joined.length ? ` Joining the defence: ${joined.join(', ')}.` : ''),
    { important: involvesPlayer, war: war.id });
  if (state.dip) callToArms(state, map, rules, war);
  return null;
}

// Treaties between the two sides other than the ones the attacker broke lapse without penalty.
function clearTreatiesAcross(state, war) {
  for (const x of war.attackers) for (const y of war.defenders) for (const t of treatiesBetween(state, x, y)) {
    if (!TREATIES[t.type].peaceOnly) removeTreaty(state, t);
  }
}

// The attacker's alliance partners are asked to join. AI allies answer by opinion; the player gets an offer.
function callToArms(state, map, rules, war) {
  const C = state.countries, a = war.leaderA, b = war.leaderD, D = rules.balance.diplomacy;
  const partners = state.dip.treaties.filter((t) => t.type === 'alliance' && (t.a === a || t.b === a)).map((t) => (t.a === a ? t.b : t.a));
  for (const p of partners) {
    if (!C[p].alive || war.attackers.includes(p) || war.defenders.includes(p) || allied(state, p, b)) continue;
    if (p === state.player && !C[p].automate) {
      state.offers.push({ id: state.nextId++, kind: 'call', war: war.id, from: a, to: p, day: state.day });
      continue;
    }
    const oa = opinion(state, map, rules, p, a), ob = opinion(state, map, rules, p, b);
    if (oa > D.callToArmsOpinion && ob < 20 && C[p].stability > 35 && !isAtWar(state, p)) {
      joinWar(state, map, rules, war, p, 'A');
      aiLog(state, p, `Answered ${C[a].name}'s call to arms against ${C[b].name}: opinion of ${C[a].name} ${Math.round(oa)}, of ${C[b].name} ${Math.round(ob)}.`);
    } else {
      addMod(state, a, p, -20, D.modDecay, 'Refused our call to arms');
      addMod(state, a, p, -10, D.modDecay, 'Refused our call to arms', 't');
      aiLog(state, p, `Refused ${C[a].name}'s call to arms against ${C[b].name}: opinion of ${C[a].name} ${Math.round(oa)} (needs ${D.callToArmsOpinion}), of ${C[b].name} ${Math.round(ob)}.`);
    }
  }
}

export function joinWar(state, map, rules, war, k, side) {
  const C = state.countries;
  if (!state.wars.includes(war)) return 'The war is over';
  if (war.attackers.includes(k) || war.defenders.includes(k)) return 'Already in this war';
  const other = side === 'A' ? war.defenders : war.attackers;
  if (other.some((x) => allied(state, x, k))) return 'You are allied to the other side';
  (side === 'A' ? war.attackers : war.defenders).push(k);
  touchRelations(state);
  clearTreatiesAcross(state, war);
  log(state, 'war', `${C[k].name} joined the ${war.name} on the side of ${C[side === 'A' ? war.leaderA : war.leaderD].name}.`, { important: k === state.player || war.attackers.includes(state.player) || war.defenders.includes(state.player) });
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

// Cost in war score of taking `provinces` from the losing side. Provinces the taker lost in
// an earlier peace (claims) cost less: reclaiming them is easier to justify.
export function demandCost(state, map, rules, war, provinces, takerIsAttacker, taker = -1) {
  const loserSide = takerIsAttacker ? war.defenders : war.attackers;
  const lv = sideValue(state, map, rules, loserSide) || 1;
  const disc = rules.balance.diplomacy?.claimDiscount ?? 1;
  let v = 0;
  for (const p of provinces) v += provinceValue(state, rules, p) * (taker >= 0 && state.dip && hasClaim(state, taker, p) ? disc : 1);
  return (v / lv) * 100 * 1.15;
}

// War score cost of the non-territorial terms.
export function termsCost(state, map, rules, war, from, terms) {
  const fromAtt = war.attackers.includes(from);
  const PC = rules.balance.diplomacy?.peaceCost || {};
  let cost = demandCost(state, map, rules, war, terms.provinces || [], fromAtt, terms.to ?? from);
  if (terms.reparations) cost += PC.reparations;
  if (terms.subject) cost += PC.subject;
  if (terms.independence) cost += PC.independence;
  return cost;
}

// Validates a peace proposal. terms = { provinces: [ids], to: countryIdx, reparations, subject,
// independence } (all empty = white peace)
export function validatePeace(state, map, rules, war, from, terms) {
  if (!state.wars.includes(war)) return 'War is over';
  const fromAtt = war.attackers.includes(from);
  if (!fromAtt && !war.defenders.includes(from)) return 'Not a participant';
  if (from !== war.leaderA && from !== war.leaderD) return 'Only war leaders negotiate the peace; others can make a separate peace';
  const winnerSide = fromAtt ? war.attackers : war.defenders;
  const loserSide = fromAtt ? war.defenders : war.attackers;
  const loser = fromAtt ? war.leaderD : war.leaderA;
  for (const p of terms.provinces || []) {
    if (!map.exists[p]) return 'Invalid province';
    if (!loserSide.includes(state.prov.owner[p])) return `${map.name[p]} does not belong to the other side`;
    if (!winnerSide.includes(state.prov.controller[p])) return `${map.name[p]} must be occupied by your side`;
  }
  const C = state.countries, D = rules.balance.diplomacy;
  if (terms.subject) {
    if (!state.dip) return 'Not available';
    if (terms.independence) return 'Cannot combine independence with subjugation';
    if (overlordOf(state, from) >= 0) return 'A subject cannot take subjects';
    if (overlordOf(state, loser) >= 0 || subjectsOf(state, loser).length) return `${C[loser].name} already has an overlord or subjects`;
    const left = C[loser].cache.provinces - (terms.provinces || []).filter((p) => state.prov.owner[p] === loser).length;
    if (left > D.subjectMaxProvinces) return `${C[loser].name} is too large to become a subject (${left} provinces, max ${D.subjectMaxProvinces})`;
  }
  if (terms.independence && !(war.kind === 'independence' && from === war.leaderA && overlordOf(state, from) === war.leaderD)) return 'Only a subject fighting its overlord can win independence';
  return null;
}

// Would the leader of the other side accept? Returns { accept, reason, cost, score }.
export function evaluatePeace(state, map, rules, war, from, terms) {
  const why = validatePeace(state, map, rules, war, from, terms);
  if (why) return { accept: false, reason: why, cost: 0, score: 0 };
  const fromAtt = war.attackers.includes(from);
  const score = warScore(state, map, rules, war) * (fromAtt ? 1 : -1); // proposer's perspective
  const provinces = terms.provinces || [];
  const cost = termsCost(state, map, rules, war, from, terms);
  const months = (state.day - war.start) / 30;
  const W = rules.balance.war;
  if (!provinces.length && !terms.reparations && !terms.subject && !terms.independence) {
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
  const loser = fromAtt ? war.leaderD : war.leaderA;
  const transferred = [];
  for (const p of terms.provinces || []) {
    const was = state.prov.owner[p];
    transferProvince(state, map, p, to);
    transferred.push(map.name[p]);
    if (state.dip && was >= 0 && C[was].alive) {
      addClaim(state, was, p);
      addMod(state, was, to, rules.balance.diplomacy.grievanceOpinion, rules.balance.diplomacy.grievanceDecay, 'Took our land');
    }
  }
  const parts = [];
  if (transferred.length) parts.push(`${C[loser].name} ceded ${transferred.length} province(s) to ${C[to].name} (${transferred.slice(0, 4).join(', ')}${transferred.length > 4 ? '…' : ''})`);
  if (state.dip && C[loser].alive) {
    const D = rules.balance.diplomacy;
    if (terms.reparations) {
      signTreaty(state, map, rules, 'reparations', loser, from, { until: state.day + D.reparationsYears * 365, quiet: true });
      parts.push(`${C[loser].name} pays reparations for ${D.reparationsYears} years`);
    }
    if (terms.subject) {
      for (const t of [...state.dip.treaties]) if ((t.a === loser || t.b === loser) && !TREATIES[t.type].peaceOnly) removeTreaty(state, t);
      for (const al of state.alliances) if (al.members.includes(loser)) al.members = al.members.filter((m) => m !== loser);
      signTreaty(state, map, rules, 'subject', from, loser, { quiet: true });
      parts.push(`${C[loser].name} becomes a subject of ${C[from].name}`);
    }
    if (terms.independence) {
      for (const t of [...state.dip.treaties]) if (t.type === 'subject' && t.a === loser && t.b === from) removeTreaty(state, t);
      parts.push(`${C[from].name} wins its independence`);
    }
    const gained = transferred.length || terms.reparations || terms.subject || terms.independence;
    if (gained && C[from].govt) { C[from].govt.glory = Math.min(1, C[from].govt.glory + 0.4); C[loser].govt.glory = Math.max(-1, C[loser].govt.glory - 0.4); }
  }
  const won = !!(transferred.length || terms.reparations || terms.subject || terms.independence);
  recordPeace(state, war, from, won);
  if (won) warExpertise(state, rules, fromAtt ? war.attackers : war.defenders, fromAtt ? war.defenders : war.attackers, (state.day - war.start) / 365);
  endWar(state, map, rules, war);
  log(state, 'peace', parts.length ? `Peace: ${parts.join('; ')}.` : `White peace between ${C[war.leaderA].name} and ${C[war.leaderD].name}.`,
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
  settleAfterPeace(state, map, rules);
}

// Occupations and battles that no longer have a war behind them end; stray armies go home.
function settleAfterPeace(state, map, rules) {
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
    if (own === a.owner || hasAccess(state, a.owner, own) || atWar(state, own, a.owner)) continue;
    const cap = state.countries[a.owner].capital;
    if (cap >= 0) { a.loc = cap; a.path = []; a.prog = 0; }
  }
}

// ---------------------------------------------------------------------------------------------
// separate peace: a participant other than the war leaders leaves the war

// The participant's own war score against the enemy side, -100..100: what it occupies of the
// enemy leader's land minus what the enemy side occupies of its own land.
export function separateScore(state, map, rules, war, c) {
  const att = war.attackers.includes(c);
  const enemySide = att ? war.defenders : war.attackers;
  const enemyLeader = att ? war.leaderD : war.leaderA;
  const cv = sideValue(state, map, rules, [c]) || 1, ev = sideValue(state, map, rules, [enemyLeader]) || 1;
  const lost = occupiedValue(state, map, rules, enemySide, [c]) / cv;
  const won = occupiedValue(state, map, rules, [c], [enemyLeader]) / ev;
  return Math.max(-100, Math.min(100, (won - lost) * 100));
}

// terms.provinces: the participant's own provinces, occupied by the enemy, that it cedes.
export function validateSeparatePeace(state, map, rules, war, c, terms) {
  if (!state.wars.includes(war)) return 'War is over';
  if (c === war.leaderA || c === war.leaderD) return 'War leaders negotiate a full peace';
  const att = war.attackers.includes(c);
  if (!att && !war.defenders.includes(c)) return 'Not a participant';
  const enemySide = att ? war.defenders : war.attackers;
  for (const p of terms.provinces || []) {
    if (state.prov.owner[p] !== c) return `${map.name[p]} is not yours to cede`;
    if (!enemySide.includes(state.prov.controller[p])) return `${map.name[p]} is not occupied by the enemy`;
  }
  return null;
}

export function evaluateSeparatePeace(state, map, rules, war, c, terms) {
  const why = validateSeparatePeace(state, map, rules, war, c, terms);
  if (why) return { accept: false, reason: why, score: 0, offered: 0 };
  const score = separateScore(state, map, rules, war, c);
  const cv = sideValue(state, map, rules, [c]) || 1;
  let offered = 0;
  for (const p of terms.provinces || []) offered += (provinceValue(state, rules, p) / cv) * 100;
  // the enemy leader lets a weak participant go if it is paid in land for its gains
  const needed = Math.max(0, -score - 10);
  const accept = offered >= needed * 0.8;
  return { accept, score, offered, needed,
    reason: accept ? 'They agree to a separate peace.' : `They hold the upper hand against you (score ${Math.round(score)}) and want more land (offered ${Math.round(offered)}, need about ${Math.round(needed * 0.8)}).` };
}

export function makeSeparatePeace(state, map, rules, war, c, terms) {
  const C = state.countries;
  const att = war.attackers.includes(c);
  const enemySide = att ? war.defenders : war.attackers;
  const enemyLeader = att ? war.leaderD : war.leaderA;
  const ceded = [];
  for (const p of terms.provinces || []) {
    const ctl = state.prov.controller[p];
    transferProvince(state, map, p, enemySide.includes(ctl) ? ctl : enemyLeader);
    ceded.push(map.name[p]);
    if (state.dip) addClaim(state, c, p);
  }
  const side = att ? war.attackers : war.defenders;
  side.splice(side.indexOf(c), 1);
  const T = rules.balance.war.truceDays;
  for (const e of enemySide) { C[c].truces[e] = state.day + T; C[e].truces[c] = state.day + T; }
  if (state.dip) addMod(state, att ? war.leaderA : war.leaderD, c, -25, rules.balance.diplomacy.modDecay, 'Abandoned us in war');
  touchRelations(state);
  settleAfterPeace(state, map, rules);
  log(state, 'peace', `${C[c].name} made a separate peace with ${C[enemyLeader].name}${ceded.length ? `, ceding ${ceded.length} province(s)` : ''} and left the ${war.name}.`,
    { important: war.attackers.includes(state.player) || war.defenders.includes(state.player) || c === state.player });
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
  if (state.fleets) { state.fleets = state.fleets.filter((f) => f.owner !== c); state.fleetVer = (state.fleetVer || 0) + 1; }
  if (state.wings) state.wings = state.wings.filter((w) => w.owner !== c);
  state.recruit = state.recruit.filter((r) => r.owner !== c);
  for (const al of state.alliances) al.members = al.members.filter((m) => m !== c);
  for (const w of [...state.wars]) {
    w.attackers = w.attackers.filter((x) => x !== c);
    w.defenders = w.defenders.filter((x) => x !== c);
    if (w.leaderA === c && w.attackers.length) w.leaderA = w.attackers[0];
    if (w.leaderD === c && w.defenders.length) w.leaderD = w.defenders[0];
  }
  forgetCountry(state, c);
  state.offers = state.offers.filter((o) => o.from !== c && o.to !== c);
  if (state.pendingEvents) state.pendingEvents = state.pendingEvents.filter((p) => p.c !== c);
  touchRelations(state);
  log(state, 'war', `${C[c].name} has ceased to exist.`, { important: true });
  if (c === state.player) state.gameOver = { day: state.day, reason: `${C[c].name} was annexed.` };
  for (const w of [...state.wars]) if (!w.attackers.length || !w.defenders.length) state.wars.splice(state.wars.indexOf(w), 1);
}

export { warBetween };
