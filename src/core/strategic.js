// Strategic capabilities (Milestone 6): nuclear weapons and deterrence, cyber operations,
// satellites and anti-satellite weapons, and (fictional) orbital stations and off-world
// settlements. Each country's capabilities live in c.strat; world-wide consequences (nuclear
// detonations, nuclear winter, orbital debris, fallout) in state.strategic. Constants: the
// `strategic` section of balance.json; formulas: docs/STRATEGIC.md.
import { log, aiLog } from './state.js';
import { atWar, isAtWar, enemiesOf, warBetween } from './relations.js';
import { knowsId, techCost, grantTech, available } from './technology.js';
import { addMod } from './diplomacy.js';
import { rand } from './rng.js';
import { provKm, wingRange, wingStat } from './air.js';

export const SAT_KINDS = ['recon', 'comms', 'nav', 'warning'];
export const SAT_TECH = { recon: 'satellites', comms: 'satellites', nav: 'gps', warning: 'satellites' };
export const PROGRAMMES = { none: 0, minimal: 20, deterrent: 200, large: 1500, massive: 6000 };
export const CYBER_OPS = ['espionage', 'sabotage', 'disruption', 'disinformation'];

export function newStrat() {
  return { warheads: 0, icbm: 0, programme: 'none', launchOnWarning: true, cyber: 0, cyberPower: 0, sats: { recon: 0, comms: 0, nav: 0, warning: 0 }, stations: 0, colonies: 0, project: null, disrupted: 0, launched: 0 };
}

export function newStrategicWorld() {
  return { detonations: 0, winter: 0, debris: 0, fallout: {}, pending: [] };
}

// Installs capabilities from the scenario (countries[].warheads / icbm / sats ...).
export function initStrategic(state, map, rules, scenario) {
  state.strategic = newStrategicWorld();
  const by = new Map((scenario.countries || []).map((c) => [c.tag, c]));
  for (const c of state.countries) {
    c.strat = newStrat();
    const sc = by.get(c.tag) || {};
    const s = c.strat;
    if (sc.warheads && knowsId(state, rules, c.idx, 'atomic_bomb')) { s.warheads = sc.warheads; s.programme = programmeFor(sc.warheads); }
    if (sc.icbm && knowsId(state, rules, c.idx, 'icbm')) s.icbm = sc.icbm;
    if (sc.sats) for (const k of SAT_KINDS) if (sc.sats[k] && knowsId(state, rules, c.idx, SAT_TECH[k])) s.sats[k] = sc.sats[k];
    if (sc.stations && knowsId(state, rules, c.idx, 'orbital_industry')) s.stations = sc.stations;
    if (sc.colonies && knowsId(state, rules, c.idx, 'off_world_settlement')) s.colonies = sc.colonies;
  }
}

// The largest programme the starting arsenal already meets: it is kept (warheads above a programme's
// target are only dismantled under arms control), not built up further.
function programmeFor(n) {
  let best = 'minimal';
  for (const [k, v] of Object.entries(PROGRAMMES)) if (v && n >= v) best = k;
  return best;
}

export function satCount(c) {
  const s = c.strat?.sats;
  return s ? s.recon + s.comms + s.nav + s.warning : 0;
}

// Share of full coverage a satellite constellation gives (0..1).
export function satCover(c, kind, rules) {
  return Math.min(1, (c.strat?.sats?.[kind] || 0) / rules.balance.strategic.satCoverage);
}

export function strategicUpkeep(c, rules) {
  const S = rules.balance.strategic, s = c.strat;
  if (!s) return 0;
  return (s.warheads * S.warheadUpkeep + s.icbm * S.icbmUpkeep + satCount(c) * S.satUpkeep + s.stations * S.stationUpkeep + s.colonies * S.colonyUpkeep) * (c.cache?.priceLevel || 1);
}

// ---------------------------------------------------------------------------------------------
// nuclear weapons

export function canHaveNukes(state, rules, k) { return knowsId(state, rules, k, 'atomic_bomb'); }

export function setProgramme(state, rules, k, level) {
  const c = state.countries[k];
  if (!(level in PROGRAMMES)) return 'Unknown programme';
  if (level !== 'none' && !canHaveNukes(state, rules, k)) return 'Needs the technology Atomic Bomb';
  c.strat.programme = level;
  return null;
}

export function programmeTarget(state, rules, c) {
  let t = PROGRAMMES[c.strat.programme] || 0;
  if (armsControl(state, c.idx)) t = Math.min(t, rules.balance.strategic.armsControlCap);
  return t;
}

export function armsControl(state, k) {
  return state.dip?.treaties.some((t) => t.type === 'arms_control' && (t.a === k || t.b === k)) || false;
}

// Missile tubes on ballistic missile submarines at sea (they survive any first strike).
export function seaLaunchers(state, rules, k) {
  let n = 0;
  for (const f of state.fleets) if (f.owner === k && f.port < 0) for (const t in f.units) n += f.units[t] * (rules.units[t].warheads || 0);
  return n;
}

// How a warhead would reach province p: 'icbm', 'ssbn' or a bomber wing; null if out of reach.
export function delivery(state, map, rules, k, p) {
  const c = state.countries[k], s = c.strat;
  if (s.icbm > 0 && knowsId(state, rules, k, 'icbm')) return { method: 'icbm' };
  if (seaLaunchers(state, rules, k) > 0) return { method: 'ssbn' };
  let best = null;
  for (const w of state.wings) {
    if (w.owner !== k || wingStat(w, rules, 'bomb') <= 0) continue;
    if (provKm(map, w.base, p) <= wingRange(w, rules) && (!best || wingStat(w, rules, 'bomb') > wingStat(best, rules, 'bomb'))) best = w;
  }
  return best ? { method: 'bomber', wing: best } : null;
}

export function hasDeterrent(state, map, rules, k) {
  const s = state.countries[k].strat;
  return !!s && s.warheads > 0 && (s.icbm > 0 || seaLaunchers(state, rules, k) > 0 || state.wings.some((w) => w.owner === k && wingStat(w, rules, 'bomb') > 0));
}

export function canNuke(state, map, rules, k, p) {
  const c = state.countries[k];
  if (!c?.alive) return 'Country does not exist';
  if (!canHaveNukes(state, rules, k)) return 'Needs the technology Atomic Bomb';
  if (c.strat.warheads < 1) return 'No nuclear warheads';
  if (!map.exists[p]) return 'Invalid province';
  const t = state.prov.controller[p];
  if (t < 0 || !atWar(state, k, t)) return 'You can only strike provinces held by an enemy at war with you';
  if (!delivery(state, map, rules, k, p)) return 'No way to deliver it: needs ballistic missiles, missile submarines at sea or bombers in range';
  return null;
}

// Chance the defender's missile defence stops a missile.
export function interceptChance(state, rules, attacker, defender) {
  const S = rules.balance.strategic, C = state.countries;
  let p = 0;
  if (knowsId(state, rules, defender, 'missile_defense')) p += S.missileDefence;
  p += S.warningIntercept * satCover(C[defender], 'warning', rules);
  if (knowsId(state, rules, defender, 'orbital_defense')) p += S.orbitalDefence;
  if (attacker >= 0 && knowsId(state, rules, attacker, 'hypersonic_weapons')) p -= S.hypersonic; // attacker -1: before hypersonic weapons
  return Math.max(0, Math.min(S.maxIntercept, p));
}

// One nuclear strike on province p by country k. Returns null on success or a reason.
export function nuclearStrike(state, map, rules, k, p, { retaliation = false } = {}) {
  const why = canNuke(state, map, rules, k, p);
  if (why) return why;
  const S = rules.balance.strategic, C = state.countries, c = C[k];
  const target = state.prov.controller[p];
  const T = C[target];
  const how = delivery(state, map, rules, k, p);
  c.strat.warheads--;
  if (how.method === 'icbm') c.strat.icbm--;
  const firstUse = !state.strategic.used?.[`${target}>${k}`];
  (state.strategic.used ||= {})[`${k}>${target}`] = state.day;
  let stopped = false;
  if (how.method === 'bomber') {
    let inter = 0;
    for (const v of state.wings) if (v.mission === 'superiority' && atWar(state, v.owner, k) && provKm(map, v.base, p) <= wingRange(v, rules)) inter += wingStat(v, rules, 'air', state);
    stopped = rand(state) < inter / (inter + wingStat(how.wing, rules, 'bomb', state) * 3 + 1);
  } else stopped = rand(state) < interceptChance(state, rules, k, target);
  const name = map.name[p];
  if (stopped) {
    log(state, 'war', `${c.name} launched a nuclear strike on ${name}; it was intercepted.`, { prov: p, important: true });
    afterStrike(state, map, rules, k, target, firstUse, retaliation, 0);
    return null;
  }
  const Y = knowsId(state, rules, k, 'thermonuclear_weapons') ? 1 : S.fissionYield;
  const P = state.prov;
  const killed = P.pop[p] * Math.min(0.85, S.popLoss * Y);
  P.pop[p] -= killed;
  P.dev[p] = Math.max(1, P.dev[p] - S.devLoss * Y);
  P.infra[p] = Math.max(0, P.infra[p] - Math.round(S.infraLoss * Y));
  P.fort[p] = 0;
  if (state.econ) {
    const X = rules.econ;
    for (let b = 0; b < X.B; b++) {
      let L = state.econ.bld[p * X.B + b];
      for (let n = L; n > 0; n--) if (rand(state) < S.buildingLoss * Y) L--;
      state.econ.bld[p * X.B + b] = L;
    }
  }
  for (const a of state.armies) if (a.loc === p && !(a.sea >= 0)) { a.str *= 1 - 0.8 * Y; a.org = 0; }
  for (const w of state.wings) if (w.base === p) w.str *= 1 - 0.9 * Y;
  for (const f of state.fleets) if (f.port === p) f.str *= 1 - 0.7 * Y;
  // fallout drifts into neighbouring provinces
  for (let e = map.adjStart[p]; e < map.adjStart[p + 1]; e++) { const v = map.adj[e]; if (map.adjKind[e] === 0) P.pop[v] *= 1 - S.neighbourPopLoss * Y; }
  state.strategic.fallout[p] = Math.max(state.strategic.fallout[p] || 0, S.falloutMonths);
  state.strategic.detonations++;
  state.strategic.winter += Y;
  state.mapVersion = (state.mapVersion || 0) + 1;
  log(state, 'war', `${c.name} destroyed ${name} with a nuclear weapon: about ${fmtPeople(killed)} killed.`, { prov: p, important: true });
  afterStrike(state, map, rules, k, target, firstUse, retaliation, Y);
  return null;
}

function fmtPeople(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : `${Math.round(n / 1000) * 1000}`;
}

function afterStrike(state, map, rules, k, target, firstUse, retaliation, Y) {
  const S = rules.balance.strategic, C = state.countries;
  // the world condemns first use; the struck country rallies and remembers
  if (firstUse && !retaliation) {
    for (const o of C) if (o.alive && o.idx !== k) addMod(state, o.idx, k, -S.firstUseOpinion, 0.5, 'Nuclear first use');
    C[k].stability = Math.max(0, C[k].stability - S.firstUseStability);
  }
  addMod(state, target, k, -100, 0.2, 'Nuclear attack');
  C[target].stability = Math.max(0, C[target].stability - S.struckStability * Math.max(0.3, Y));
  // a first strike destroys some missiles in their silos, unless early warning lets them launch
  const t = C[target].strat;
  if (t.icbm > 0 && satCover(C[target], 'warning', rules) < 0.5) t.icbm = Math.max(0, Math.floor(t.icbm * (1 - S.counterforce)));
  const war = warBetween(state, k, target);
  if (war && Y > 0) {
    const W = rules.balance.war, sign = war.attackers.includes(k) ? 1 : -1;
    war.battleScore = Math.max(-W.maxBattleScore, Math.min(W.maxBattleScore, war.battleScore + sign * S.strikeWarScore * Y));
  }
  // launch on warning: the victim retaliates the next day if it still can
  if (!retaliation && hasDeterrent(state, map, rules, target) && (target !== state.player || t.launchOnWarning)) {
    if (!state.strategic.pending.some((x) => x.from === target && x.to === k)) state.strategic.pending.push({ from: target, to: k, day: state.day + 1, n: S.retaliationStrikes });
  }
}

// The enemy provinces most worth striking: cities and industry (counter-value), or enemy armies
// in our own territory when `tactical`.
export function strikeTargets(state, map, rules, k, enemy, n, tactical = false) {
  const P = state.prov, out = [];
  if (tactical) {
    const by = new Map();
    for (const a of state.armies) if (a.owner === enemy && !(a.sea >= 0) && P.owner[a.loc] === k) by.set(a.loc, (by.get(a.loc) || 0) + a.str * Object.values(a.units).reduce((x, y) => x + y, 0));
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p);
  }
  for (const i of map.ids) if (P.controller[i] === enemy && P.owner[i] === enemy) out.push(i);
  out.sort((a, b) => P.pop[b] * (1 + P.dev[b] / 50) - P.pop[a] * (1 + P.dev[a] / 50));
  return out.slice(0, n);
}

// Daily: retaliation strikes queued by launch on warning.
export function dailyStrategic(state, map, rules) {
  const W = state.strategic;
  if (!W?.pending.length) return;
  const due = W.pending.filter((x) => x.day <= state.day);
  if (!due.length) return;
  W.pending = W.pending.filter((x) => x.day > state.day);
  for (const r of due) {
    const c = state.countries[r.from];
    if (!c.alive || !atWar(state, r.from, r.to)) continue;
    let fired = 0;
    for (const p of strikeTargets(state, map, rules, r.from, r.to, r.n)) if (!nuclearStrike(state, map, rules, r.from, p, { retaliation: true })) fired++;
    if (fired) aiLog(state, r.from, `Retaliated with ${fired} nuclear strike(s) on ${state.countries[r.to].name}.`);
  }
}

// ---------------------------------------------------------------------------------------------
// cyber operations

export function cyberTech(state, rules, k) {
  if (!knowsId(state, rules, k, 'cyber_warfare')) return 0;
  let f = 1;
  for (const [id, v] of [['machine_learning', 0.3], ['quantum_computing', 0.5], ['general_ai', 1], ['artificial_superintelligence', 1]]) if (knowsId(state, rules, k, id)) f += v;
  return f;
}

export function cyberDefence(state, rules, k) {
  const c = state.countries[k];
  if (!knowsId(state, rules, k, 'internet')) return Infinity; // nothing on the network to attack
  return (c.strat.cyberPower + rules.balance.strategic.cyberBaseDefence) * (knowsId(state, rules, k, 'quantum_encryption') ? 2 : 1);
}

export function canCyber(state, rules, k, target, op) {
  const S = rules.balance.strategic, c = state.countries[k], t = state.countries[target];
  if (!CYBER_OPS.includes(op)) return 'Unknown operation';
  if (!c?.alive || !t?.alive || k === target) return 'Invalid target';
  if (!cyberTech(state, rules, k)) return 'Needs the technology Cyber Warfare';
  if (!knowsId(state, rules, target, 'internet')) return `${t.name} has no networks to attack`;
  const cost = S.cyberCost[op];
  if (c.strat.cyber < cost) return `Needs ${cost} cyber points (you have ${Math.floor(c.strat.cyber)})`;
  return null;
}

export function cyberOdds(state, rules, k, target) {
  const att = state.countries[k].strat.cyberPower, def = cyberDefence(state, rules, target);
  const success = Math.max(0.1, Math.min(0.9, att / (att + def * 1.2)));
  const detect = Math.max(0.1, Math.min(0.9, 0.15 + 0.5 * def / (att + def)));
  return { success, detect };
}

export function cyberOperation(state, map, rules, k, target, op) {
  const why = canCyber(state, rules, k, target, op);
  if (why) return { error: why };
  const S = rules.balance.strategic, C = state.countries, c = C[k], t = C[target];
  c.strat.cyber -= S.cyberCost[op];
  const { success, detect } = cyberOdds(state, rules, k, target);
  const ok = rand(state) < success, seen = rand(state) < detect;
  let what = 'failed';
  if (ok) {
    if (op === 'espionage') {
      // progress towards a technology the target knows and we do not
      const R = rules.tech;
      let pick = null;
      const cur = c.research.current != null ? R.idx[c.research.current] : null;
      if (cur != null && knowsId(state, rules, target, c.research.current)) pick = cur;
      if (pick == null) for (const x of R.list) if (knowsId(state, rules, target, x.id) && available(state, rules, k, x.i) && (pick == null || x.cost < R.list[pick].cost)) pick = x.i;
      if (pick == null) what = 'found nothing new';
      else {
        const gain = techCost(state, map, rules, k, pick) * S.stealShare;
        if (cur === pick) { c.research.progress += gain; what = `stole research on ${R.list[pick].name}`; }
        else if (gain >= techCost(state, map, rules, k, pick) * 0.99) { grantTech(state, map, rules, k, pick, 'espionage'); what = `stole ${R.list[pick].name}`; }
        else { c.research.bank += gain; what = `stole research worth ${Math.round(gain)} points`; }
      }
    } else if (op === 'sabotage') {
      let n = 0;
      if (state.econ) {
        const X = rules.econ, ps = map.ids.filter((i) => state.prov.owner[i] === target);
        for (let h = 0; h < S.sabotageLevels && ps.length; h++) {
          const i = ps[Math.floor(rand(state) * ps.length)];
          for (let b = 0; b < X.B; b++) if (state.econ.bld[i * X.B + b] > 0) { state.econ.bld[i * X.B + b]--; n++; break; }
        }
      }
      what = `sabotaged ${n} industrial site(s)`;
    } else if (op === 'disruption') {
      t.strat.disrupted = Math.max(t.strat.disrupted, S.disruptionMonths);
      t.stability = Math.max(0, t.stability - 2);
      what = `disrupted industry and research for ${S.disruptionMonths} months`;
    } else if (op === 'disinformation') {
      t.stability = Math.max(0, t.stability - S.disinfoStability);
      if (t.govt) t.govt.legitimacy = Math.max(0, t.govt.legitimacy - S.disinfoLegitimacy);
      what = 'spread disinformation';
    }
  }
  if (seen) addMod(state, target, k, -S.cyberOpinion, 1, 'Cyber attack');
  const label = { espionage: 'Cyber espionage', sabotage: 'Cyber sabotage', disruption: 'Network disruption', disinformation: 'Disinformation campaign' }[op];
  if (k === state.player) log(state, 'diplomacy', `${label} against ${t.name}: ${ok ? what : 'failed'}${seen ? '; we were identified' : ''}.`, { important: true });
  else if (target === state.player && (seen || ok)) log(state, 'diplomacy', seen ? `${label} by ${c.name}: ${ok ? what.replace('stole', 'they stole') : 'it failed'}.` : `An unidentified ${label.toLowerCase()} hit us: ${what}.`, { important: true });
  return { ok, seen, what };
}

// ---------------------------------------------------------------------------------------------
// satellites, anti-satellite weapons and space

export function satCost(state, rules, k) { return rules.balance.strategic.satCost * (state.countries[k].cache?.priceLevel || 1); }

export function canLaunch(state, rules, k, kind) {
  const S = rules.balance.strategic, c = state.countries[k];
  if (!SAT_KINDS.includes(kind)) return 'Unknown satellite type';
  if (!knowsId(state, rules, k, 'spaceflight')) return 'Needs the technology Spaceflight';
  if (!knowsId(state, rules, k, SAT_TECH[kind])) return `Needs the technology ${rules.tech.list[rules.tech.idx[SAT_TECH[kind]]].name}`;
  if (c.strat.launched >= S.launchesMonth + c.strat.stations) return 'No more launches this month';
  const cost = satCost(state, rules, k);
  if (c.treasury < cost) return `Costs ${cost.toFixed(1)}B`;
  return null;
}

export function launchSatellite(state, rules, k, kind) {
  const why = canLaunch(state, rules, k, kind);
  if (why) return why;
  const c = state.countries[k];
  c.treasury -= satCost(state, rules, k);
  c.strat.sats[kind]++;
  c.strat.launched++;
  return null;
}

export function canAsat(state, rules, k, target) {
  const t = state.countries[target];
  if (!knowsId(state, rules, k, 'guided_missiles') || !knowsId(state, rules, k, 'satellites')) return 'Needs Guided Missiles and Satellites';
  if (!t?.alive || !atWar(state, k, target)) return 'Only against countries you are at war with';
  if (!satCount(t)) return `${t.name} has no satellites`;
  if (state.countries[k].strat.asatDay === state.day) return 'One anti-satellite strike a day';
  return null;
}

export function asatStrike(state, rules, k, target) {
  const why = canAsat(state, rules, k, target);
  if (why) return why;
  const S = rules.balance.strategic, c = state.countries[k], t = state.countries[target];
  c.strat.asatDay = state.day;
  const laser = knowsId(state, rules, k, 'orbital_defense');
  const kind = ['warning', 'recon', 'nav', 'comms'].find((x) => t.strat.sats[x] > 0);
  const hit = rand(state) < (laser ? S.asatLaser : S.asatHit);
  if (hit) { t.strat.sats[kind]--; state.strategic.debris += laser ? S.debrisLaser : S.debrisKinetic; }
  if (k === state.player || target === state.player) log(state, 'war', `${c.name} fired an anti-satellite weapon at a ${kind} satellite of ${t.name}: ${hit ? 'destroyed' : 'missed'}.`, { important: target === state.player && hit });
  return null;
}

export const SPACE_PROJECTS = {
  station: { name: 'Orbital station', tech: 'orbital_industry', costKey: 'stationCost', monthsKey: 'stationMonths', max: 'maxStations' },
  colony: { name: 'Off-world settlement', tech: 'off_world_settlement', costKey: 'colonyCost', monthsKey: 'colonyMonths', max: 'maxColonies' },
};

export function canStartSpace(state, rules, k, kind) {
  const S = rules.balance.strategic, c = state.countries[k], P = SPACE_PROJECTS[kind];
  if (!P) return 'Unknown project';
  if (!knowsId(state, rules, k, P.tech)) return `Needs the technology ${rules.tech.list[rules.tech.idx[P.tech]].name}`;
  if (c.strat.project) return 'A space project is already under way';
  if ((kind === 'station' ? c.strat.stations : c.strat.colonies) >= S[P.max]) return `At most ${S[P.max]}`;
  const cost = S[P.costKey] * (c.cache?.priceLevel || 1);
  if (c.treasury < cost) return `Costs ${cost.toFixed(0)}B`;
  return null;
}

export function startSpace(state, rules, k, kind) {
  const why = canStartSpace(state, rules, k, kind);
  if (why) return why;
  const S = rules.balance.strategic, c = state.countries[k], P = SPACE_PROJECTS[kind];
  c.treasury -= S[P.costKey] * (c.cache?.priceLevel || 1);
  c.strat.project = { kind, months: S[P.monthsKey] };
  return null;
}

// ---------------------------------------------------------------------------------------------
// monthly

export function monthlyStrategic(state, map, rules) {
  const S = rules.balance.strategic, W = state.strategic;
  const C = state.countries;
  for (const c of C) {
    if (!c.alive) continue;
    const s = c.strat;
    s.launched = 0;
    if (s.disrupted > 0) s.disrupted--;
    s.asteroid = knowsId(state, rules, c.idx, 'asteroid_mining');
    // cyber capability grows with technology and research spending
    const ct = cyberTech(state, rules, c.idx);
    s.cyberPower = ct ? Math.round(ct * Math.sqrt(Math.max(0, c.ledger?.research || 0)) * S.cyberPowerScale * 100) / 100 : 0;
    s.cyber = Math.min(S.cyberMax, s.cyber + s.cyberPower * S.cyberPointsPerPower);
    // warheads and missiles
    const target = programmeTarget(state, rules, c);
    if (s.warheads > target && armsControl(state, c.idx)) s.warheads = Math.max(target, Math.floor(s.warheads * (1 - S.dismantleMonth)));
    if (target > s.warheads && canHaveNukes(state, rules, c.idx)) {
      const pl = c.cache?.priceLevel || 1;
      let n = Math.min(target - s.warheads, Math.ceil(S.buildMonth * (1 + (c.cache?.gdp || 0) / 3000)));
      const iU = rules.econ.gi.uranium;
      if (iU != null && c.econ) n = Math.min(n, Math.floor(c.econ.stock[iU] / S.uraniumPerWarhead));
      n = Math.min(n, Math.floor(Math.max(0, c.treasury - (c.ledger?.revenue || 0)) / (S.warheadCost * pl)));
      if (n > 0) {
        s.warheads += n; c.treasury -= n * S.warheadCost * pl;
        if (iU != null && c.econ) c.econ.stock[iU] -= n * S.uraniumPerWarhead;
        if (s.warheads === n && c.idx !== state.player) log(state, 'world', `${c.name} has built its first nuclear weapons.`, { important: true });
        else if (s.warheads === n) log(state, 'military', 'We have built our first nuclear weapons.', { important: true });
      }
    }
    if (knowsId(state, rules, c.idx, 'icbm') && s.icbm < Math.ceil(s.warheads / S.warheadsPerMissile)) {
      const pl = c.cache?.priceLevel || 1;
      const n = Math.min(Math.ceil(s.warheads / S.warheadsPerMissile) - s.icbm, S.icbmBuildMonth, Math.floor(Math.max(0, c.treasury - (c.ledger?.revenue || 0)) / (S.icbmCost * pl)));
      if (n > 0) { s.icbm += n; c.treasury -= n * S.icbmCost * pl; }
    }
    // space projects
    if (s.project && --s.project.months <= 0) {
      const P = SPACE_PROJECTS[s.project.kind];
      if (s.project.kind === 'station') s.stations++; else s.colonies++;
      if (s.project.kind === 'colony') c.stability = Math.min(100, c.stability + 3);
      log(state, c.idx === state.player ? 'economy' : 'world', `${c.name} completed: ${P.name.toLowerCase()} (fictional technology).`, { important: c.idx === state.player });
      s.project = null;
    }
    // orbital debris destroys satellites
    if (W.debris > 0) for (const k of SAT_KINDS) for (let n = s.sats[k]; n > 0; n--) if (rand(state) < W.debris * S.debrisRisk) s.sats[k]--;
  }
  W.debris *= 1 - S.debrisDecayMonth;
  W.winter *= 1 - S.winterDecayMonth;
  W.farmMult = Math.max(1 - S.winterMaxFarmLoss, 1 - W.winter * S.winterFarmPerYield);
  for (const p of Object.keys(W.fallout)) if (--W.fallout[p] <= 0) delete W.fallout[p];
  aiStrategic(state, map, rules);
}

// ---------------------------------------------------------------------------------------------
// AI: deterrence, programmes, escalation, cyber and space

// Whether the defenders of `t` include a nuclear power able to deliver (used by the war AI).
export function nuclearDeterred(state, map, rules, a, defenders) {
  for (const d of defenders) if (hasDeterrent(state, map, rules, d)) return d;
  return -1;
}

function aiStrategic(state, map, rules) {
  const S = rules.balance.strategic, C = state.countries, W = state.strategic;
  const month = Math.floor((state.day - state.startDay) / 30.44);
  for (const c of C) {
    if (!c.alive || (c.idx === state.player && !c.automate)) continue;
    const s = c.strat;
    // programmes: keep the arsenal; threatened powers with means may start one
    if (canHaveNukes(state, rules, c.idx) && s.programme === 'none' && (c.idx + month) % 12 === 0) {
      const rival = c.rival >= 0 ? C[c.rival] : null;
      if (rival?.strat.warheads > 0 && (c.cache?.gdp || 0) > S.aiProgrammeGdp && c.aggression > 0.35 && rand(state) < 0.25) {
        s.programme = 'minimal';
        aiLog(state, c.idx, `Started a nuclear weapons programme: our rival ${rival.name} has nuclear weapons.`);
      }
    }
    // escalation: only when the country's survival is at stake
    if (s.warheads > 0 && isAtWar(state, c.idx)) {
      const occ = c.cache.provinces ? c.cache.occupied / c.cache.provinces : 0;
      const capLost = c.capital >= 0 && state.prov.controller[c.capital] !== c.idx;
      if (occ > S.aiNukeOccupied || capLost) {
        const enemies = [...enemiesOf(state, c.idx)].filter((e) => C[e].alive);
        // the enemy with most troops on our soil
        const onSoil = new Map();
        for (const a of state.armies) if (enemies.includes(a.owner) && state.prov.owner[a.loc] === c.idx) onSoil.set(a.owner, (onSoil.get(a.owner) || 0) + a.str);
        let foe = enemies[0] ?? -1, fv = 0;
        for (const [o, v] of onSoil) if (v > fv) { fv = v; foe = o; }
        if (foe >= 0) {
          const deterred = hasDeterrent(state, map, rules, foe);
          const chance = S.aiNukeChance * (0.5 + c.aggression) * (deterred ? (capLost && occ > 0.5 ? 0.3 : 0.05) : 1);
          if (rand(state) < chance) {
            // enemy armies on our soil first, then their cities; only targets that can actually be struck
            const tgt = [...strikeTargets(state, map, rules, c.idx, foe, 5, true), ...strikeTargets(state, map, rules, c.idx, foe, 5)].find((p) => !canNuke(state, map, rules, c.idx, p));
            if (tgt != null && !nuclearStrike(state, map, rules, c.idx, tgt)) aiLog(state, c.idx, `Used a nuclear weapon on ${map.name[tgt]}: ${Math.round(occ * 100)}% of our land occupied${capLost ? ', capital lost' : ''}.`);
          }
        }
      }
    }
    // cyber operations against enemies and rivals
    if (cyberTech(state, rules, c.idx) && s.cyber >= S.cyberCost.disinformation && (c.idx + month) % 2 === 0) {
      const enemies = [...enemiesOf(state, c.idx)];
      const target = enemies.length ? enemies[Math.floor(rand(state) * enemies.length)] : c.rival;
      if (target >= 0 && C[target].alive && knowsId(state, rules, target, 'internet')) {
        const behind = (C[target].tfx?.known || 0) > (c.tfx?.known || 0);
        const op = enemies.length ? (s.cyber >= S.cyberCost.sabotage && rand(state) < 0.5 ? 'sabotage' : 'disruption') : behind ? 'espionage' : 'disinformation';
        if (!canCyber(state, rules, c.idx, target, op) && rand(state) < c.aggression + 0.2) {
          const r = cyberOperation(state, map, rules, c.idx, target, op);
          aiLog(state, c.idx, `Cyber operation (${op}) against ${C[target].name}: ${r.ok ? r.what : 'failed'}${r.seen ? ', identified' : ''}.`);
        }
      }
    }
    // satellites: keep a basic constellation when affordable
    if (knowsId(state, rules, c.idx, 'satellites') && (c.cache?.gdp || 0) > S.aiSatGdp && c.treasury > (c.ledger?.revenue || 0) * 4) {
      const want = Math.min(S.satCoverage, Math.floor((c.cache.gdp || 0) / S.aiSatGdp));
      const kind = SAT_KINDS.filter((k) => knowsId(state, rules, c.idx, SAT_TECH[k])).sort((x, y) => s.sats[x] - s.sats[y])[0];
      if (kind && s.sats[kind] < want) launchSatellite(state, rules, c.idx, kind);
    }
    // anti-satellite strikes in war
    // kinetic anti-satellite strikes only while orbit is still fairly clean: debris hurts everyone
    const asatOk = knowsId(state, rules, c.idx, 'orbital_defense') || W.debris < S.aiAsatDebrisMax;
    if (asatOk && isAtWar(state, c.idx)) for (const e of enemiesOf(state, c.idx)) if (!canAsat(state, rules, c.idx, e) && rand(state) < 0.3) { asatStrike(state, rules, c.idx, e); break; }
    // space projects for rich countries
    if (!s.project && c.treasury > (c.ledger?.revenue || 0) * 8) {
      for (const kind of ['station', 'colony']) if (!canStartSpace(state, rules, c.idx, kind)) { startSpace(state, rules, c.idx, kind); aiLog(state, c.idx, `Started a space project: ${SPACE_PROJECTS[kind].name.toLowerCase()}.`); break; }
    }
  }
}
