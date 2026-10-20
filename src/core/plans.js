// Battle plans: a group of armies given one order that the game carries out day by day.
//
// - Front: the armies spread along the provinces facing an enemy country and hold that line,
//   the most threatened provinces first, and are moved again as the line shifts.
// - Attack: an arrow from the armies to a target province. While the plan is being prepared,
//   the armies gain a planning bonus to attack (up to `planMaxBonus`, over `planPrepDays`).
//   Once it is executed they advance together, one province at a time along the arrow, each
//   step only once the province ahead has been taken; the bonus wears off as they go.
//
// state.plans = [{ id, owner, kind: 'front' | 'attack', armies: [ids], enemy, target, path,
// step, status: 'prep' | 'go', prep }]. An army belongs to one plan at most; giving it any
// other order takes it out of its plan. See docs/MILITARY.md (Battle plans).
import { log, logFor } from './state.js';
import { atWar, friendly, canEnter } from './relations.js';
import { findPath } from './pathfind.js';
import { orderMove, armySpeed } from './military.js';

const plansOf = (state) => (state.plans ||= []);

export function planOf(state, armyId) {
  for (const p of state.plans || []) if (p.armies.includes(armyId)) return p;
  return null;
}

// Removes armies from whatever plans they are in (and drops plans left empty).
export function leavePlans(state, ids) {
  if (!state.plans?.length) return;
  const set = new Set(ids);
  for (const p of state.plans) p.armies = p.armies.filter((id) => !set.has(id));
  state.plans = state.plans.filter((p) => p.armies.length);
}

function ownArmies(state, k, ids) {
  return ids.map((id) => state.armies.find((a) => a.id === id)).filter((a) => a && a.owner === k && a.sea < 0);
}

// Provinces held by k's side that touch, over land, a province controlled by `enemy`.
export function frontProvinces(state, map, k, enemy) {
  const P = state.prov, out = [];
  for (const i of map.ids) {
    if (!friendly(state, k, P.controller[i])) continue;
    for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) {
      if (map.adjKind[e] === 2) continue;
      if (P.controller[map.adj[e]] === enemy) { out.push(i); break; }
    }
  }
  return out;
}

export function makeFront(state, map, rules, k, ids, enemy) {
  const list = ownArmies(state, k, ids);
  if (!list.length) return 'Select your armies first';
  if (!state.countries[enemy]?.alive || enemy === k) return 'Pick a country to face';
  if (!frontProvinces(state, map, k, enemy).length) return `You have no border with ${state.countries[enemy].name}`;
  leavePlans(state, list.map((a) => a.id));
  const p = { id: state.nextId++, owner: k, kind: 'front', armies: list.map((a) => a.id), enemy, status: 'go', prep: 0 };
  plansOf(state).push(p);
  holdFront(state, map, rules, p);
  return p;
}

export function makeAttack(state, map, rules, k, ids, target) {
  const list = ownArmies(state, k, ids);
  if (!list.length) return 'Select your armies first';
  if (!map.exists[target]) return 'Pick a province to attack';
  if (!canEnter(state, k, target)) return `You can only plan an attack on a country you are at war with (or have military access to)`;
  const lead = list.reduce((m, a) => (unitsOf(a) > unitsOf(m) ? a : m), list[0]);
  const path = findPath(map, state, k, lead.loc, target, armySpeed(lead, rules, state), 6000, rules);
  if (!path || !path.length || path.some((n) => n >= map.count)) return 'No land route to that province';
  leavePlans(state, list.map((a) => a.id));
  for (const a of list) if (!a.battle) { a.path = []; a.prog = 0; } // they wait where they are while the plan is prepared
  const p = { id: state.nextId++, owner: k, kind: 'attack', armies: list.map((a) => a.id), target, path, step: 0, status: 'prep', prep: 0, from: lead.loc };
  plansOf(state).push(p);
  return p;
}

export function executePlan(state, id) {
  const p = (state.plans || []).find((x) => x.id === id);
  if (!p) return 'No such plan';
  p.status = 'go';
  return null;
}

export function cancelPlan(state, id) {
  state.plans = (state.plans || []).filter((x) => x.id !== id);
}

// Extra attack for an army in an attack plan: the planning done before it set off.
export function planBonus(state, rules, a) {
  if (!state.plans?.length) return 0;
  const p = planOf(state, a.id);
  return p && p.kind === 'attack' ? p.prep * rules.balance.commanders.planMaxBonus : 0;
}

function holdFront(state, map, rules, p) {
  const P = state.prov, list = ownArmies(state, p.owner, p.armies).filter((a) => !a.battle);
  const front = frontProvinces(state, map, p.owner, p.enemy);
  if (!front.length || !list.length) return;
  // the most threatened provinces first: enemy units next door
  const threat = new Map(front.map((i) => [i, 0]));
  for (const a of state.armies) {
    if (a.owner !== p.enemy && !(atWar(state, a.owner, p.owner) && friendly(state, a.owner, p.enemy))) continue;
    for (let e = map.adjStart[a.loc]; e < map.adjStart[a.loc + 1]; e++) if (threat.has(map.adj[e])) threat.set(map.adj[e], threat.get(map.adj[e]) + unitsOf(a));
  }
  const order = [...front].sort((x, y) => threat.get(y) - threat.get(x) || P.pop[y] - P.pop[x]);
  const onLine = new Set(front), held = new Set(), free = [], idle = [];
  // armies on (or heading to) any province of the line stay there; the others are sent
  for (const a of list) {
    const at = a.path.length ? a.path[a.path.length - 1] : a.loc;
    if (onLine.has(at) && !held.has(at)) { held.add(at); if (!threat.get(at)) idle.push(a); } else free.push(a);
  }
  const open = order.filter((i) => !held.has(i)).slice(0, free.length + idle.length);
  const nearest = (a, cands) => {
    let best = -1, bd = Infinity;
    cands.forEach((i, j) => { const d = (map.x[i] - map.x[a.loc]) ** 2 + (map.y[i] - map.y[a.loc]) ** 2; if (d < bd) { bd = d; best = j; } });
    return best;
  };
  for (const a of free) {
    if (!open.length) break;
    const j = nearest(a, open);
    orderMove(state, map, rules, a.id, open[j]);
    open.splice(j, 1);
  }
  // threatened provinces still uncovered: shift armies from quiet parts of the line
  for (const i of open.filter((x) => threat.get(x) > 0)) {
    if (!idle.length) break;
    let best = 0, bd = Infinity;
    idle.forEach((a, j) => { const d = (map.x[i] - map.x[a.loc]) ** 2 + (map.y[i] - map.y[a.loc]) ** 2; if (d < bd) { bd = d; best = j; } });
    orderMove(state, map, rules, idle[best].id, i);
    idle.splice(best, 1);
  }
}

function advance(state, map, rules, p) {
  const P = state.prov, list = ownArmies(state, p.owner, p.armies);
  const ours = (i) => friendly(state, p.owner, P.controller[i]);
  // skip steps already taken (by anyone on our side)
  while (p.step < p.path.length - 1 && ours(p.path[p.step]) && list.every((a) => a.loc === p.path[p.step] || a.battle)) p.step++;
  const way = p.path[p.step];
  if (p.step === p.path.length - 1 && ours(way) && list.some((a) => a.loc === way)) {
    logFor(state, p.owner, 'military', `Attack on ${map.name[p.target]} succeeded.`, { prov: p.target });
    cancelPlan(state, p.id);
    return;
  }
  for (const a of list) {
    if (a.battle || a.loc === way) continue;
    const dest = a.path.length ? a.path[a.path.length - 1] : -1;
    if (dest !== way) orderMove(state, map, rules, a.id, way);
  }
}

// Daily: preparation, and the moves of every plan (fronts are re-checked every 5 days).
export function dailyPlans(state, map, rules) {
  if (!state.plans?.length) return;
  const K = rules.balance.commanders;
  for (const p of [...state.plans]) {
    p.armies = p.armies.filter((id) => state.armies.some((a) => a.id === id && a.owner === p.owner));
    if (!p.armies.length || !state.countries[p.owner].alive) { cancelPlan(state, p.id); continue; }
    if (p.kind === 'front') {
      if (!state.countries[p.enemy]?.alive) { cancelPlan(state, p.id); continue; }
      if ((state.day + p.id) % 5 === 0) holdFront(state, map, rules, p);
    } else if (p.status === 'prep') p.prep = Math.min(1, p.prep + 1 / K.planPrepDays);
    else {
      p.prep = Math.max(0, p.prep - K.planDecayDay);
      advance(state, map, rules, p);
    }
  }
}

function unitsOf(a) { let n = 0; for (const t in a.units) n += a.units[t]; return n; }
