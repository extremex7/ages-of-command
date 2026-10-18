// Air forces (Milestone 6): air wings based in provinces, operating within their range. Wings on
// superiority missions fight for control of the air and intercept bombers; support wings (and
// carriers and warships offshore) add close air support and bombardment to land battles; bomber
// wings strike enemy industry every month. Constants: the `air` section of balance.json;
// formulas: docs/NAVY_AIR.md.
//
// A wing is { id, owner, name, base, units, str, exp, mission }: mission is superiority,
// support, bombing or idle.
import { log, ordinal } from './state.js';
import { atWar, friendly, isAtWar, enemiesOf } from './relations.js';
import { portZonesOf } from './mapdata.js';
import { rand } from './rng.js';
import { countryNeighbours } from './geo.js';

export const MISSIONS = ['superiority', 'support', 'bombing', 'idle'];

export function newWing(state, owner, base, units, mission = null) {
  const n = state.wings.reduce((k, w) => k + (w.owner === owner), 0);
  return {
    id: state.nextId++, owner, name: `${ordinal(n + 1)} Air Wing`, base,
    units: Object.fromEntries(Object.entries(units || {}).filter(([, k]) => k > 0)),
    str: 1, exp: 0, mission: mission || 'superiority',
  };
}

export function defaultMission(rules, units) {
  let best = null, bn = -1;
  for (const t in units) if (units[t] > bn) { bn = units[t]; best = t; }
  const role = rules.units[best]?.role;
  return role === 'fighter' ? 'superiority' : role === 'bomber' ? 'idle' : 'support';
}

export function wingCount(w) {
  let n = 0;
  for (const t in w.units) n += w.units[t];
  return n;
}

export function wingRange(w, rules) {
  let r = Infinity;
  for (const t in w.units) if (w.units[t] > 0) r = Math.min(r, rules.units[t].range);
  return r === Infinity ? 0 : r;
}

export function wingStat(w, rules, key, state = null) {
  let p = 0;
  for (const t in w.units) p += w.units[t] * (rules.units[t][key] || 0);
  const tech = state ? state.countries[w.owner].tfx?.mult.combat ?? 1 : 1;
  return p * w.str * tech * (1 + w.exp * 0.2);
}

// cheap distance in km between provinces (equirectangular; fine for ranges)
export function provKm(map, a, b) {
  const la = map.lat[a], lb = map.lat[b];
  let dl = Math.abs(map.lon[a] - map.lon[b]);
  if (dl > 180) dl = 360 - dl;
  const x = dl * Math.cos(((la + lb) * Math.PI) / 360), y = la - lb;
  return 111.2 * Math.sqrt(x * x + y * y);
}

export function inRange(map, rules, w, p) {
  return provKm(map, w.base, p) <= wingRange(w, rules);
}

export function canBase(state, map, k, p) {
  return p >= 0 && map.exists[p] && friendly(state, k, state.prov.controller[p]) && (state.prov.owner[p] === k || friendly(state, k, state.prov.owner[p]));
}

// A newly built wing joins an idle wing of the same type at its base, or forms a new one.
export function commissionWing(state, map, rules, owner, prov, type) {
  let w = state.wings.find((x) => x.owner === owner && x.base === prov && x.units[type] != null && wingCount(x) < 12);
  if (w) {
    const n = wingCount(w);
    w.str = (w.str * n + 1) / (n + 1);
    w.units[type] = (w.units[type] || 0) + 1;
  } else {
    w = newWing(state, owner, prov, { [type]: 1 });
    w.mission = defaultMission(rules, w.units);
    state.wings.push(w);
  }
  return w;
}

export function setMission(state, rules, id, mission) {
  const w = state.wings.find((x) => x.id === id);
  if (!w) return 'No such wing';
  if (!MISSIONS.includes(mission)) return 'Unknown mission';
  if (mission === 'bombing' && wingStat(w, rules, 'bomb') <= 0) return 'This wing has no bombers';
  w.mission = mission;
  return null;
}

export function rebaseWing(state, map, rules, id, p) {
  const w = state.wings.find((x) => x.id === id);
  if (!w) return 'No such wing';
  if (!canBase(state, map, w.owner, p)) return 'Wings can only be based in provinces you or your allies control';
  w.base = p;
  w.str = Math.max(0, w.str - 0.02); // a few days of disruption
  return null;
}

export function mergeWings(state, ids) {
  const list = ids.map((id) => state.wings.find((w) => w.id === id)).filter(Boolean);
  if (list.length < 2) return 'Select at least two wings';
  const base = list[0];
  if (list.some((w) => w.base !== base.base || w.owner !== base.owner)) return 'Wings must share a base';
  let n0 = wingCount(base);
  for (const w of list.slice(1)) {
    const n1 = wingCount(w);
    base.str = (base.str * n0 + w.str * n1) / (n0 + n1);
    for (const t in w.units) base.units[t] = (base.units[t] || 0) + w.units[t];
    n0 += n1;
    state.wings.splice(state.wings.indexOf(w), 1);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// daily: lost bases, repairs, and support for land battles

export function processWings(state, map, rules) {
  if (!state.wings.length) return;
  const A = rules.balance.air;
  for (let i = state.wings.length - 1; i >= 0; i--) {
    const w = state.wings[i];
    if (!canBase(state, map, w.owner, w.base)) {
      const c = state.countries[w.owner];
      const to = canBase(state, map, w.owner, c.capital) ? c.capital : -1;
      if (to < 0) { state.wings.splice(i, 1); continue; }
      w.base = to;
      if (w.owner === state.player) log(state, 'military', `${w.name} lost its base and flew to ${map.name[to]}.`);
    }
    if (!w.fought) w.str = Math.min(1, w.str + A.repairDay);
    w.fought = 0;
  }
}

// Air power each side brings to a land battle in province p: control of the air from wings on
// superiority and support missions in range (and carriers offshore), close air support from
// support wings, and bombardment from warships in the province's waters.
export function battleSupport(state, map, rules, b, attOwner, defOwner) {
  const out = { aAir: 0, dAir: 0, aGround: 0, dGround: 0, aShore: 0, dShore: 0, aWings: [], dWings: [] };
  if (!state.wings.length && !state.fleets.length) return out;
  const p = b.prov;
  for (const w of state.wings) {
    if (w.mission !== 'superiority' && w.mission !== 'support') continue;
    const side = friendly(state, w.owner, attOwner) && atWar(state, w.owner, defOwner) ? 'a'
      : friendly(state, w.owner, defOwner) && atWar(state, w.owner, attOwner) ? 'd' : null;
    if (!side || !inRange(map, rules, w, p)) continue;
    out[side + 'Air'] += wingStat(w, rules, 'air', state) * (w.mission === 'superiority' ? 1 : 0.4);
    if (w.mission === 'support') out[side + 'Ground'] += wingStat(w, rules, 'attack', state);
    out[side + 'Wings'].push(w);
  }
  if (state.fleets.length) {
    const zs = portZonesOf(map, p);
    if (zs.length) for (const f of state.fleets) {
      if (f.port >= 0 || f.battle || !zs.includes(f.zone)) continue;
      const side = friendly(state, f.owner, attOwner) && atWar(state, f.owner, defOwner) ? 'a'
        : friendly(state, f.owner, defOwner) && atWar(state, f.owner, attOwner) ? 'd' : null;
      if (!side) continue;
      const tech = state.countries[f.owner].tfx?.mult.combat ?? 1;
      for (const t in f.units) {
        const u = rules.units[t], n = f.units[t] * f.str * tech;
        if (u.air) { out[side + 'Air'] += n * u.air * 0.5; out[side + 'Ground'] += n * u.air * 0.4; }
        if (u.shore) out[side + 'Shore'] += n * u.shore;
      }
    }
  }
  return out;
}

// Applies one day of air combat over a battle and returns the extra damage each side deals.
export function airCombatDay(state, rules, s) {
  const A = rules.balance.air;
  const tot = s.aAir + s.dAir;
  const shareA = tot > 0 ? s.aAir / tot : 0.5;
  // control of the air decides how much ground attack gets through
  const throughA = tot > 0 ? Math.min(1, shareA * 2) : 1, throughD = tot > 0 ? Math.min(1, (1 - shareA) * 2) : 1;
  const extraA = (s.aGround * throughA + s.aShore) * A.casDamage, extraD = (s.dGround * throughD + s.dShore) * A.casDamage;
  if (tot > 0) {
    for (const w of s.aWings) { w.str = Math.max(0.05, w.str - A.lossDay * (1 - shareA) * (w.mission === 'support' ? 1.5 : 1)); w.fought = 1; }
    for (const w of s.dWings) { w.str = Math.max(0.05, w.str - A.lossDay * shareA * (w.mission === 'support' ? 1.5 : 1)); w.fought = 1; }
  }
  return { extraA, extraD, shareA, tot };
}

// ---------------------------------------------------------------------------------------------
// monthly strategic bombing

export function strategicBombing(state, map, rules) {
  if (!state.wings.length) return;
  const A = rules.balance.air, X = rules.econ;
  for (const w of state.wings) {
    if (w.mission !== 'bombing') continue;
    const bomb = wingStat(w, rules, 'bomb', state) * precision(state, w.owner);
    if (bomb <= 0) continue;
    const range = wingRange(w, rules);
    // the most industrial enemy province in range
    let target = -1, tv = 0;
    for (const i of map.ids) {
      const ctl = state.prov.controller[i];
      if (ctl < 0 || !atWar(state, w.owner, ctl)) continue;
      if (provKm(map, w.base, i) > range) continue;
      let lv = state.prov.infra[i] * 0.5;
      if (state.econ) for (let b = 0; b < X.B; b++) lv += state.econ.bld[i * X.B + b];
      if (lv > tv) { tv = lv; target = i; }
    }
    if (target < 0) continue;
    const owner = state.prov.controller[target];
    // interceptors: enemy fighter wings on superiority within range of the target
    let intercept = 0;
    const stealthy = stealthShare(w, rules);
    for (const v of state.wings) {
      if (v.mission !== 'superiority' || !atWar(state, v.owner, w.owner) || !inRange(map, rules, v, target)) continue;
      intercept += wingStat(v, rules, 'air', state);
      v.str = Math.max(0.05, v.str - A.interceptorLoss); v.fought = 1;
    }
    intercept *= 1 - 0.6 * stealthy;
    const success = bomb / (bomb + intercept * 1.5 + A.groundDefence);
    w.str = Math.max(0.05, w.str - A.bomberLoss * (intercept / (intercept + bomb + 1))); w.fought = 1;
    let destroyed = 0;
    if (state.econ) {
      const hits = Math.floor(bomb * success * A.bombingLevels + rand(state));
      for (let h = 0; h < hits; h++) {
        const lv = [];
        for (let b = 0; b < X.B; b++) if (state.econ.bld[target * X.B + b] > 0) lv.push(b);
        if (!lv.length) break;
        state.econ.bld[target * X.B + lv[Math.floor(rand(state) * lv.length)]]--;
        destroyed++;
      }
    }
    if (success > 0.5 && state.prov.infra[target] > 0 && rand(state) < success) state.prov.infra[target]--;
    state.countries[owner].stability = Math.max(0, state.countries[owner].stability - success * A.bombingStability);
    if (w.owner === state.player || owner === state.player) {
      const msg = w.owner === state.player
        ? `${w.name} bombed ${map.name[target]}: ${destroyed} building level(s) destroyed, ${Math.round(success * 100)}% of bombers got through.`
        : `Enemy bombers struck ${map.name[target]}: ${destroyed} building level(s) destroyed.`;
      log(state, 'war', msg, { prov: target, important: owner === state.player && destroyed > 0 });
    }
  }
}

function stealthShare(w, rules) {
  let s = 0, n = 0;
  for (const t in w.units) { n += w.units[t]; if (rules.units[t].tech === 'stealth') s += w.units[t]; }
  return n ? s / n : 0;
}

// Navigation satellites make bombs land where they are aimed (see strategic.js).
function precision(state, k) {
  const sat = state.countries[k].strat?.sats;
  return 1 + 0.25 * Math.min(1, (sat?.nav || 0) / 4) + 0.15 * Math.min(1, (sat?.recon || 0) / 4);
}

// ---------------------------------------------------------------------------------------------
// AI: fighters fly superiority, attack aircraft support the army, bombers bomb in war; wings
// move to bases near the front.

export function aiWings(state, map, rules, c) {
  const mine = state.wings.filter((w) => w.owner === c.idx);
  if (!mine.length) return;
  const war = isAtWar(state, c.idx);
  let front = null;
  for (const w of mine) {
    const role = rules.units[Object.keys(w.units)[0]]?.role;
    const want = role === 'fighter' ? 'superiority' : role === 'bomber' ? (war ? 'bombing' : 'idle') : 'support';
    if (w.mission !== want) w.mission = want;
    if (!war) continue;
    // move within reach of the enemy: the friendly province nearest any enemy-held province
    front ||= frontBases(state, map, c.idx);
    if (!front.length) continue;
    const range = wingRange(w, rules);
    if (front.some((p) => provKm(map, w.base, p) <= range * 0.8)) continue;
    let best = -1, bd = Infinity;
    for (const p of front) { const d = provKm(map, w.base, p); if (d < bd) { bd = d; best = p; } }
    if (best >= 0) rebaseWing(state, map, rules, w.id, best);
  }
}

function frontBases(state, map, k) {
  const enemies = enemiesOf(state, k);
  const out = [];
  for (const p of countryNeighbours(state, map).border[k] || []) {
    if (state.prov.controller[p] !== k) continue;
    for (let e = map.adjStart[p]; e < map.adjStart[p + 1]; e++) if (enemies.has(state.prov.controller[map.adj[e]])) { out.push(p); break; }
  }
  return out;
}
