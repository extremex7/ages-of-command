// Daily battle resolution. Battles last several days; each day both sides inflict strength
// and organisation damage shaped by unit stats, terrain, combat width, forts, organisation
// and a bounded random factor. A side breaks when its organisation collapses, then retreats
// to a friendly neighbour or surrenders if encircled.
import { TERRAINS, neighbours } from './mapdata.js';
import { atWar, friendly, warBetween } from './relations.js';
import { unitCount, log } from './state.js';
import { randRange } from './rng.js';
import { armyMen } from './military.js';

function sideOf(battle, owner, state) {
  if (battle.att.some((id) => { const a = armyById(state, id); return a && friendly(state, a.owner, owner); })) return 'att';
  if (battle.def.some((id) => { const a = armyById(state, id); return a && friendly(state, a.owner, owner); })) return 'def';
  return null;
}

export function armyById(state, id) {
  return state.armies.find((a) => a.id === id);
}

export function detectBattles(state, map) {
  const byProv = new Map();
  for (const a of state.armies) {
    if (a.prog > 0 && a.path.length) continue; // in transit between provinces
    let arr = byProv.get(a.loc);
    if (!arr) byProv.set(a.loc, (arr = []));
    arr.push(a);
  }
  for (const [p, list] of byProv) {
    if (list.length < 2) continue;
    // join ongoing battle
    let b = state.battles.find((x) => x.prov === p);
    if (b) {
      for (const a of list) {
        if (a.battle) continue;
        const s = sideOf(b, a.owner, state);
        if (s) { b[s].push(a.id); a.battle = b.id; a.path = s === 'def' ? [] : a.path; }
      }
      continue;
    }
    // new battle: defenders are those aligned with the province controller, else the earliest arrival
    const ctl = state.prov.controller[p];
    let def = list.filter((a) => friendly(state, a.owner, ctl));
    if (!def.length) {
      const first = list.reduce((m, a) => (a.arrived < m.arrived ? a : m), list[0]);
      def = list.filter((a) => friendly(state, a.owner, first.owner));
    }
    const lead = def[0].owner;
    const att = list.filter((a) => atWar(state, a.owner, lead) && !def.includes(a));
    if (!att.length) continue;
    const war = warBetween(state, att[0].owner, lead);
    b = {
      id: state.nextId++, prov: p, war: war ? war.id : 0, start: state.day, days: 0,
      att: att.map((a) => a.id), def: def.map((a) => a.id), cas: [0, 0],
      startUnits: [att.reduce((s, a) => s + unitCount(a), 0), def.reduce((s, a) => s + unitCount(a), 0)],
      viaStrait: att.some((a) => a.arrived === state.day && a.lastEdgeKind > 0),
    };
    for (const a of att) a.battle = b.id;
    for (const a of def) { a.battle = b.id; a.path = []; a.prog = 0; }
    state.battles.push(b);
    if (att.some((a) => a.owner === state.player) || def.some((a) => a.owner === state.player)) {
      log(state, 'battle', `Battle of ${map.name[p]} has begun.`, { prov: p });
    }
  }
}

function sideStats(state, ids, role, terrain, rules, p) {
  const U = rules.units, B = rules.balance.combat;
  let units = 0, dmg = 0, tough = 0, org = 0, men = 0;
  const armies = ids.map((id) => armyById(state, id)).filter(Boolean);
  for (const a of armies) {
    const n = unitCount(a);
    units += n;
    org += a.org * n;
    men += armyMen(a, rules);
    for (const t in a.units) {
      const k = a.units[t];
      if (!k) continue;
      const u = U[t];
      const base = role === 'att' ? u.attack * (u.terrain[terrain] ?? 1) : u.defense;
      dmg += k * a.str * base * (0.35 + 0.65 * a.org) * (1 + a.exp * 0.25);
      tough += k * u.toughness;
    }
  }
  if (role === 'def') dmg *= (B.defenderTerrain[terrain] ?? 1) * (1 + B.fortBonus * state.prov.fort[p]);
  const width = B.width[terrain] ?? 10;
  const engaged = units > 0 ? Math.min(1, width / units) : 0;
  return { armies, units, dmg: dmg * engaged, tough: Math.max(0.5, tough * engaged), org: units ? org / units : 0, men, engaged, width };
}

export function resolveBattles(state, map, rules) {
  if (!state.battles.length) return;
  const B = rules.balance.combat;
  const done = [];
  for (const b of state.battles) {
    b.att = b.att.filter((id) => armyById(state, id));
    b.def = b.def.filter((id) => armyById(state, id));
    if (!b.att.length || !b.def.length) { done.push([b, b.att.length ? 'att' : 'def']); continue; }
    const terrain = TERRAINS[map.terrain[b.prov]];
    const A = sideStats(state, b.att, 'att', terrain, rules, b.prov);
    const D = sideStats(state, b.def, 'def', terrain, rules, b.prov);
    let aDmg = A.dmg * randRange(state, 0.85, 1.15);
    const dDmg = D.dmg * randRange(state, 0.85, 1.15);
    if (b.viaStrait && b.days < 5) aDmg *= B.straitAttackPenalty;
    applyDamage(D.armies, (aDmg * B.damage) / D.tough, (aDmg * B.orgDamage) / Math.max(1, D.units), rules, b, 1);
    applyDamage(A.armies, (dDmg * B.damage) / A.tough, (dDmg * B.orgDamage) / Math.max(1, A.units), rules, b, 0);
    b.days++;
    b.lastA = A; b.lastD = D;
    const aBroken = avgOrg(A.armies) < B.breakOrg || A.armies.every((a) => a.str < 0.05);
    const dBroken = avgOrg(D.armies) < B.breakOrg || D.armies.every((a) => a.str < 0.05);
    if (aBroken || dBroken) done.push([b, dBroken && !aBroken ? 'att' : 'def']);
  }
  for (const [b, winner] of done) endBattle(state, map, rules, b, winner);
}

function avgOrg(armies) {
  let o = 0, n = 0;
  for (const a of armies) { const k = unitCount(a); o += a.org * k; n += k; }
  return n ? o / n : 0;
}

function applyDamage(armies, strLoss, orgLoss, rules, b, sideIdx) {
  for (const a of armies) {
    const menBefore = armyMen(a, rules);
    a.str = Math.max(0, a.str - strLoss * (0.7 + 0.3 * (1 - a.org)));
    a.org = Math.max(0, a.org - orgLoss);
    b.cas[sideIdx] += menBefore - armyMen(a, rules);
  }
}

function endBattle(state, map, rules, b, winner) {
  state.battles.splice(state.battles.indexOf(b), 1);
  const win = winner === 'att' ? b.att : b.def, lose = winner === 'att' ? b.def : b.att;
  const winners = win.map((id) => armyById(state, id)).filter(Boolean);
  const losers = lose.map((id) => armyById(state, id)).filter(Boolean);
  const C = state.countries;
  let surrendered = 0;
  for (const a of winners) { a.battle = 0; a.exp = Math.min(1, a.exp + 0.05); }
  for (const a of losers) {
    a.battle = 0; a.path = []; a.prog = 0;
    const to = retreatTarget(state, map, a);
    if (to < 0 || a.str < 0.04) {
      surrendered += Math.round(armyMen(a, rules));
      b.cas[winner === 'att' ? 1 : 0] += armyMen(a, rules);
      state.armies.splice(state.armies.indexOf(a), 1);
    } else {
      a.loc = to; a.arrived = state.day; a.org = Math.min(a.org, 0.1);
    }
  }
  // war score
  const war = state.wars.find((w) => w.id === b.war);
  const winOwner = winners[0]?.owner ?? (winner === 'att' ? -1 : state.prov.controller[b.prov]);
  if (war && winOwner >= 0) {
    const sign = war.attackers.includes(winOwner) ? 1 : -1;
    const loserCas = b.cas[winner === 'att' ? 1 : 0];
    const W = rules.balance.war;
    war.battleScore = Math.max(-W.maxBattleScore, Math.min(W.maxBattleScore, war.battleScore + sign * Math.min(8, 1 + loserCas / W.battleScoreScale / 1000)));
  }
  const A = b.lastA, D = b.lastD;
  const report = {
    id: b.id, day: state.day, prov: b.prov, provName: map.name[b.prov], days: b.days,
    attackers: [...new Set((winner === 'att' ? winners : losers).map((a) => a.owner))].map((k) => C[k].name),
    defenders: [...new Set((winner === 'def' ? winners : losers).map((a) => a.owner))].map((k) => C[k].name),
    winner, casualties: [Math.round(b.cas[0]), Math.round(b.cas[1])], surrendered,
    factors: battleFactors(b, A, D, TERRAINS[map.terrain[b.prov]], state.prov.fort[b.prov], rules),
  };
  if (!report.attackers.length && A) report.attackers = [...new Set(A.armies.map((a) => C[a.owner].name))];
  if (!report.defenders.length && D) report.defenders = [...new Set(D.armies.map((a) => C[a.owner].name))];
  state.reports.push(report);
  if (state.reports.length > 60) state.reports.shift();
  const involved = winners.concat(losers).some((a) => a.owner === state.player);
  if (involved || (A && A.armies.some((a) => a.owner === state.player)) || (D && D.armies.some((a) => a.owner === state.player))) {
    const won = winners.some((a) => a.owner === state.player);
    log(state, 'battle', `Battle of ${map.name[b.prov]} ${won ? 'won' : 'lost'} after ${b.days} days.` +
      (surrendered ? ` ${surrendered.toLocaleString()} troops surrendered.` : ''), { prov: b.prov, report: b.id, important: !won });
  }
}

function battleFactors(b, A, D, terrain, fort, rules) {
  const f = [];
  if (!A || !D) return ['One side had no troops left.'];
  f.push(`Terrain: ${terrain} (defender ×${(rules.balance.combat.defenderTerrain[terrain] ?? 1).toFixed(2)}).`);
  if (fort) f.push(`Fortification level ${fort} (+${Math.round(fort * rules.balance.combat.fortBonus * 100)}% defence).`);
  f.push(`Combat width ${A.width}: attackers engaged ${Math.round(A.engaged * 100)}%, defenders ${Math.round(D.engaged * 100)}%.`);
  f.push(`Units at start: attackers ${b.startUnits[0]}, defenders ${b.startUnits[1]}.`);
  f.push(`Daily damage at the end: attackers ${A.dmg.toFixed(1)}, defenders ${D.dmg.toFixed(1)}.`);
  f.push(`Organisation at the end: attackers ${Math.round(A.org * 100)}%, defenders ${Math.round(D.org * 100)}%.`);
  if (b.viaStrait) f.push('Attackers crossed water and fought at a penalty for the first days.');
  return f;
}

export function retreatTarget(state, map, a) {
  let best = -1, bs = -Infinity;
  for (const n of neighbours(map, a.loc)) {
    const ctl = state.prov.controller[n];
    if (!friendly(state, a.owner, ctl)) continue;
    if (state.armies.some((x) => x.loc === n && atWar(state, x.owner, a.owner))) continue;
    const s = (state.prov.owner[n] === a.owner ? 2 : 1) + state.prov.fort[n] * 0.3;
    if (s > bs) { bs = s; best = n; }
  }
  return best;
}
