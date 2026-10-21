// Diplomacy: opinions, trust, reputation, influence, treaties, blocs, rivals and claims.
// Opinions are not stored: they are computed from the current state (governments, treaties,
// wars, borders, rivalries, embargoes) plus a sparse list of decaying modifiers, so they always
// explain themselves. Constants: balance.json → diplomacy. See docs/DIPLOMACY.md.
import { religionOpinion } from './religion.js';
import { log, logFor, humanControls, impFor } from './state.js';
import { atWar, allied, touchRelations, enemiesOf, isAtWar, cobelligerent } from './relations.js';
import { countryNeighbours } from './geo.js';
import { govFamily } from './government.js';

// a/b meaning per type. Mutual treaties are symmetric; directed ones read "a … b".
export const TREATIES = {
  alliance: { name: 'Alliance', mutual: true, tip: 'Both join each other\'s defensive wars, and are called to arms when the other attacks.' },
  defensive: { name: 'Defensive pact', mutual: true, tip: 'Both join each other\'s defensive wars.' },
  nap: { name: 'Non-aggression pact', mutual: true, tip: 'Declaring war on the other breaks the pact: large reputation and stability cost.' },
  access: { name: 'Military access', mutual: false, tip: 'The grantor lets the other country\'s armies pass through its territory.' },
  guarantee: { name: 'Guarantee of independence', mutual: false, tip: 'The guarantor joins any war declared on the guaranteed country.' },
  trade: { name: 'Trade agreement', mutual: true, tip: 'No tariffs on goods traded between the two countries.' },
  arms_control: { name: 'Arms control treaty', mutual: true, tip: 'Both nuclear powers cap their arsenals (see docs/STRATEGIC.md) and dismantle warheads above the cap.' },
  subject: { name: 'Subject', mutual: false, peaceOnly: true, tip: 'The subject follows its overlord into wars, cannot sign treaties and pays tribute.' },
  reparations: { name: 'Reparations', mutual: false, peaceOnly: true, tip: 'The payer transfers part of its tax revenue to the recipient each month.' },
  // made by a diplomatic offer, a peace treaty or an event (src/core/deals.js); like the other
  // peace-treaty obligations it does not count toward the treaty limit
  union: { name: 'Personal union', mutual: false, peaceOnly: true, tip: 'One ruler for both crowns: the junior partner keeps its name and economy but follows the senior partner\'s foreign policy and joins its wars. It can be integrated after years of good relations, or break away when relations sour.' },
};
export const PROPOSABLE = ['alliance', 'defensive', 'nap', 'access', 'guarantee', 'trade', 'arms_control'];

export function initDiplomacy(state, map, rules, scenario = null) {
  state.dip = { treaties: [], mods: [], refused: {}, modVer: 0 };
  for (const c of state.countries) {
    c.influence = c.influence ?? 10;
    c.reputation = c.reputation ?? 0;
    c.rival = c.rival ?? -1;
    c.claims = c.claims || [];
  }
  for (const a of state.alliances) a.kind = a.kind || 'defense';
  const D = scenario?.diplomacy;
  if (!D) return;
  const idx = new Map(state.countries.map((c) => [c.tag, c.idx]));
  for (const b of D.blocs || []) {
    const members = b.members.map((t) => idx.get(t)).filter((x) => x != null);
    if (members.length > 1) state.alliances.push({ id: state.nextId++, name: b.name, members, kind: b.kind || 'defense' });
  }
  for (const t of D.treaties || []) {
    const a = idx.get(t.a), b = idx.get(t.b);
    if (a == null || b == null || !TREATIES[t.type]) continue;
    if (!validateTreaty(state, map, rules, t.type, a, b)) signTreaty(state, map, rules, t.type, a, b, { quiet: true });
  }
  for (const r of D.rivals || []) {
    const a = idx.get(r[0]), b = idx.get(r[1]);
    if (a != null && b != null) {
      state.countries[a].rival = b;
      // the scenario's enmities fade over about a decade unless events renew them
      addMod(state, a, b, -50, 0.4, 'Historic enmity');
    }
  }
  touchRelations(state);
}

// ---------------------------------------------------------------------------------------------
// treaty index

// Rebuilt when the treaty list is replaced (load, elimination); kept up to date in place when a
// treaty is signed or removed.
const tIndex = new WeakMap();
function index(state) {
  let x = tIndex.get(state);
  if (x && x.list === state.dip.treaties) return x;
  const byKey = new Map(), byCountry = new Map();
  x = { list: state.dip.treaties, byKey, byCountry };
  for (const t of state.dip.treaties) indexAdd(x, t);
  tIndex.set(state, x);
  return x;
}

function indexAdd(x, t) {
  x.byKey.set(key(t.type, t.a, t.b), t);
  for (const k of [t.a, t.b]) { if (!x.byCountry.has(k)) x.byCountry.set(k, []); x.byCountry.get(k).push(t); }
}

function key(type, a, b) {
  if (TREATIES[type]?.mutual && a > b) [a, b] = [b, a];
  return `${type}:${a}:${b}`;
}

export function findTreaty(state, type, a, b) {
  return index(state).byKey.get(key(type, a, b)) || null;
}

export function treatiesOf(state, k) {
  return index(state).byCountry.get(k) || [];
}

const NONE = [];
export function treatiesBetween(state, a, b) {
  const l = treatiesOf(state, a);
  let out = NONE;
  for (const t of l) if ((t.a === a && t.b === b) || (t.a === b && t.b === a)) { if (out === NONE) out = []; out.push(t); }
  return out;
}

export function overlordOf(state, k) {
  for (const t of treatiesOf(state, k)) if (t.type === 'subject' && t.b === k) return t.a;
  return -1;
}

export function subjectsOf(state, k) {
  return treatiesOf(state, k).filter((t) => t.type === 'subject' && t.a === k).map((t) => t.b);
}

// Personal unions: the senior partner is t.a, the junior t.b.
export function seniorOf(state, k) {
  for (const t of treatiesOf(state, k)) if (t.type === 'union' && t.b === k) return t.a;
  return -1;
}

export function juniorsOf(state, k) {
  return treatiesOf(state, k).filter((t) => t.type === 'union' && t.a === k).map((t) => t.b);
}

// The country whose foreign policy k follows: its overlord or its senior union partner, or -1.
export function followsOf(state, k) {
  const o = overlordOf(state, k);
  return o >= 0 ? o : seniorOf(state, k);
}

// Treaties that count toward the limit (peace-treaty obligations do not).
export function treatyCount(state, k) {
  return treatiesOf(state, k).filter((t) => !TREATIES[t.type].peaceOnly).length;
}

// Countries that join a war declared on `k`: guarantors, alliance and defensive-pact partners,
// its overlord and its subjects, and its personal-union partners.
export function defendersOf(state, k) {
  const out = [];
  for (const t of treatiesOf(state, k)) {
    if (t.type === 'alliance' || t.type === 'defensive') out.push(t.a === k ? t.b : t.a);
    else if (t.type === 'guarantee' && t.b === k) out.push(t.a);
    else if (t.type === 'subject' || t.type === 'union') out.push(t.a === k ? t.b : t.a);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// validation, signing and cancelling

// Treaty record order: for access the grantor comes first, for guarantee the guarantor.
// proposal(type, from, to) → [a, b]
export function recordOrder(type, from, to) {
  return type === 'access' ? [to, from] : [from, to];
}

// Returns null if the treaty may be signed, otherwise the reason it may not.
export function validateTreaty(state, map, rules, type, a, b) {
  const C = state.countries, D = rules.balance.diplomacy;
  const T = TREATIES[type];
  if (!T) return 'Unknown treaty type';
  if (a === b) return 'Cannot sign a treaty with yourself';
  if (!C[a]?.alive || !C[b]?.alive) return 'Country does not exist';
  if (atWar(state, a, b)) return 'You are at war';
  if (findTreaty(state, type, a, b)) return `${T.name} already in force`;
  if ((type === 'subject' || type === 'union') && (followsOf(state, b) >= 0 || subjectsOf(state, b).length || juniorsOf(state, b).length)) return `${C[b].name} already has an overlord, a senior partner, subjects or junior partners`;
  if (type === 'union' && followsOf(state, a) >= 0) return `${C[a].name} follows the foreign policy of ${C[followsOf(state, a)].name}`;
  if (type !== 'subject' && type !== 'union') {
    for (const k of [a, b]) {
      const o = overlordOf(state, k);
      if (o >= 0 && o !== (k === a ? b : a)) return `${C[k].name} is a subject of ${C[o].name} and cannot sign treaties`;
      const s = seniorOf(state, k);
      if (s >= 0 && s !== (k === a ? b : a)) return `${C[k].name} is in a personal union under ${C[s].name}, which runs its foreign policy`;
    }
  }
  if (!T.peaceOnly) {
    for (const k of [a, b]) if (treatyCount(state, k) >= D.maxTreaties) return `${C[k].name} already has the maximum of ${D.maxTreaties} treaties`;
  }
  const bloc = sharedBloc(state, a, b);
  switch (type) {
    case 'alliance': case 'defensive': {
      if (allied(state, a, b)) return bloc ? `Already allies through ${bloc.name}` : 'Already allies';
      for (const [x, y] of [[a, b], [b, a]]) {
        for (const e of enemiesOf(state, x)) if (allied(state, y, e)) return `${C[x].name} is at war with ${C[e].name}, an ally of ${C[y].name}`;
      }
      break;
    }
    case 'nap': if (allied(state, a, b)) return 'Allies do not need a non-aggression pact'; break;
    case 'access': if (allied(state, a, b)) return 'Allies already have military access'; break;
    case 'guarantee':
      if (isAtWar(state, b)) return `Cannot guarantee ${C[b].name} while it is at war`;
      if (allied(state, a, b)) return 'Allies already defend each other';
      if (C[b].cache && C[a].cache && C[a].cache.armyPower < C[b].cache.armyPower * 0.5) return `${C[a].name} is too weak to guarantee ${C[b].name}`;
      break;
    case 'trade':
      if (C[a].econ?.embargo.includes(b) || C[b].econ?.embargo.includes(a)) return 'An embargo is in force';
      { const eb = sharedBloc(state, a, b, 'economic'); if (eb) return `Both already trade freely in ${eb.name}`; }
      break;
    case 'arms_control':
      for (const k of [a, b]) if (!(C[k].strat?.warheads > 0)) return `${C[k].name} has no nuclear weapons`;
      break;
  }
  return null;
}

export function sharedBloc(state, a, b, kind = null) {
  for (const al of state.alliances) if ((!kind || (al.kind || 'defense') === kind) && al.members.includes(a) && al.members.includes(b)) return al;
  return null;
}

export function signTreaty(state, map, rules, type, a, b, { until = -1, quiet = false } = {}) {
  const t = { id: state.nextId++, type, a, b, start: state.day, until };
  const x = index(state);
  state.dip.treaties.push(t);
  indexAdd(x, t);
  touchRelations(state);
  if (!quiet) {
    const C = state.countries;
    const txt = TREATIES[type].mutual
      ? `${C[a].name} and ${C[b].name} signed a ${TREATIES[type].name.toLowerCase()}.`
      : { access: `${C[a].name} granted military access to ${C[b].name}.`, guarantee: `${C[a].name} guaranteed the independence of ${C[b].name}.`,
        subject: `${C[b].name} became a subject of ${C[a].name}.`, reparations: `${C[a].name} must pay reparations to ${C[b].name}.`,
        union: `${C[a].name} and ${C[b].name} formed a personal union under the crown of ${C[a].name}.` }[type];
    log(state, 'diplomacy', txt, { important: impFor(state, a, b) });
  }
  return t;
}

export function canCancel(state, rules, t, by) {
  if (!state.dip.treaties.includes(t)) return 'Treaty is no longer in force';
  if (by !== t.a && by !== t.b) return 'Not a party to this treaty';
  if (t.type === 'subject' && by === t.b) return 'Subjects can only break free by winning a war of independence';
  if (t.type === 'reparations' && by === t.a) return 'Reparations cannot be stopped by the payer';
  if (t.type === 'union' && by === t.b) return 'A junior partner leaves a union by breaking away (when its opinion of the senior partner is low enough)';
  return null;
}

// Ending a treaty early (before minTreatyDays) costs half its breaking penalty in reputation.
export function cancelTreaty(state, map, rules, t, by) {
  const why = canCancel(state, rules, t, by);
  if (why) return why;
  const D = rules.balance.diplomacy, C = state.countries;
  const other = by === t.a ? t.b : t.a;
  const early = state.day - t.start < D.minTreatyDays && !TREATIES[t.type].peaceOnly;
  if (early) C[by].reputation = clampRep(C[by].reputation - (D.breakReputation[t.type] || 0) / 2);
  if (!TREATIES[t.type].peaceOnly) addMod(state, other, by, early ? -20 : -10, D.modDecay, 'Ended a treaty with us');
  removeTreaty(state, t);
  const what = t.type === 'subject' ? `${C[t.a].name} released ${C[t.b].name}.` : t.type === 'union' ? `${C[t.a].name} dissolved its personal union with ${C[t.b].name}.` : `${C[by].name} ended its ${TREATIES[t.type].name.toLowerCase()} with ${C[other].name}${early ? ' early (reputation lost)' : ''}.`;
  log(state, 'diplomacy', what, { important: impFor(state, by, other) });
  return null;
}

export function removeTreaty(state, t) {
  const x = index(state);
  const i = state.dip.treaties.indexOf(t);
  if (i < 0) return;
  state.dip.treaties.splice(i, 1);
  x.byKey.delete(key(t.type, t.a, t.b));
  for (const k of [t.a, t.b]) { const l = x.byCountry.get(k); if (l) l.splice(l.indexOf(t), 1); }
  touchRelations(state);
}

// Treaties broken by `a` declaring war on `b`, with what breaking them costs.
export function treatiesBrokenByWar(state, a, b) {
  return treatiesBetween(state, a, b).filter((t) => t.type === 'nap' || (t.type === 'guarantee' && t.a === a) || t.type === 'trade' || t.type === 'access');
}

export function breakTreatiesForWar(state, map, rules, a, b) {
  const D = rules.balance.diplomacy, C = state.countries;
  for (const t of treatiesBetween(state, a, b)) {
    if (TREATIES[t.type].peaceOnly) continue; // subjects and reparations last until the peace
    const grave = t.type === 'nap' || (t.type === 'guarantee' && t.a === a);
    if (grave) {
      C[a].reputation = clampRep(C[a].reputation - (D.breakReputation[t.type] || 0));
      C[a].stability = Math.max(0, C[a].stability - D.breakStability);
      addMod(state, b, a, D.brokeTreatyOpinion, D.grievanceDecay, 'Broke a treaty with us');
      addMod(state, b, a, D.brokeTreatyTrust, D.grievanceDecay, 'Broke a treaty with us', 't');
      for (const k of state.countries) if (k.alive && k.idx !== a && k.idx !== b) addMod(state, k.idx, a, -10, D.modDecay, 'Breaks its treaties');
      log(state, 'diplomacy', `${C[a].name} broke its ${TREATIES[t.type].name.toLowerCase()} with ${C[b].name}.`, { important: true });
    }
    removeTreaty(state, t);
  }
}

function clampRep(v) { return Math.max(-100, Math.min(100, v)); }

// ---------------------------------------------------------------------------------------------
// opinion modifiers (sparse, decaying)

// Adds v to a's opinion of b (or trust, kind 't'). Repeated causes replace the old value with the
// stronger one, except improvements, which stack up to 3× the base value.
export function addMod(state, a, b, v, decay, why, kind = 'o') {
  if (a === b || a < 0 || b < 0) return;
  const m = state.dip.mods.find((x) => x.a === a && x.b === b && x.why === why && x.k === kind);
  if (m) {
    if (why === 'Improved relations') m.v = Math.min(Math.abs(v) * 3, m.v + v);
    else if (Math.abs(v) > Math.abs(m.v)) m.v = v;
    m.d = decay;
  } else state.dip.mods.push({ a, b, v, d: decay, why, k: kind });
  state.dip.modVer = (state.dip.modVer || 0) + 1;
}

const mIndex = new WeakMap();
function modIndex(state) {
  const ver = state.dip.modVer || 0;
  let x = mIndex.get(state);
  if (x && x.ver === ver && x.mods === state.dip.mods) return x;
  const map = new Map();
  for (const m of state.dip.mods) {
    const k = m.a * 4096 + m.b;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  x = { ver, map, mods: state.dip.mods };
  mIndex.set(state, x);
  return x;
}

export function modsOf(state, a, b) {
  return modIndex(state).map.get(a * 4096 + b) || [];
}

// ---------------------------------------------------------------------------------------------
// opinion and trust

// a's opinion of b, -100..100. With parts = [], the contributions are pushed as [label, value].
export function opinion(state, map, rules, a, b, parts = null) {
  if (a === b) return 100;
  const D = rules.balance.diplomacy, P = rules.politics, C = state.countries, A = C[a], B = C[b];
  let v = 0;
  const add = (label, x) => { if (!x) return; v += x; if (parts) parts.push([label, x]); };
  add('Governments', P.families[govFamily(rules, A)]?.opinion[govFamily(rules, B)] || 0);
  for (const t of treatiesBetween(state, a, b)) {
    let x = D.treatyOpinion[t.type] || 0;
    if (t.type === 'subject') x = t.b === a ? D.treatyOpinion.subject : 10;
    if (t.type === 'reparations') x = t.a === a ? -15 : 5;
    add(TREATIES[t.type].name, x);
  }
  const bloc = sharedBloc(state, a, b);
  if (bloc) add(bloc.name, D.blocOpinion);
  if (atWar(state, a, b)) add('At war', D.warOpinion);
  else {
    const tr = A.truces[b];
    if (tr != null && tr > state.day) add('Recent war', D.truceOpinion * Math.min(1, (tr - state.day) / rules.balance.war.truceDays));
  }
  const nb = map ? countryNeighbours(state, map).sets[a]?.has(b) : false;
  const al = allied(state, a, b);
  if (nb && !al) add('Shared border', D.borderFriction);
  if (A.rival === b) add('Our rival', D.rivalOpinion);
  if (B.rival === a) add('Treats us as a rival', D.rivalledByOpinion);
  if (nb && !al && A.cache && B.cache) {
    const ratio = B.cache.armyPower / Math.max(1, A.cache.armyPower);
    if (ratio > 1.5) add('Military threat', -Math.min(D.threatOpinionMax, 8 * (ratio - 1.5)) * (0.5 + B.aggression));
  }
  if (A.econ && B.econ && (A.econ.embargo.includes(b) || B.econ.embargo.includes(a))) add('Embargo', D.embargoOpinion);
  else if (A.econ && B.econ && (A.econ.sanctions?.[b] || B.econ.sanctions?.[a])) add('Sanctions', D.embargoOpinion / 2);
  if (cobelligerent(state, a, b)) add('Common enemy', D.commonEnemyOpinion);
  if (A.rival >= 0 && A.rival === B.rival) add('Common rival', D.commonRivalOpinion);
  let n = 0;
  for (const cl of A.claims) if (state.prov.owner[cl.p] === b) n++;
  if (n) add('Holds our former land', -Math.min(D.claimOpinionMax, -D.claimOpinion * n));
  add('Religion', religionOpinion(state, rules, a, b));
  add('Reputation', B.reputation * D.reputationOpinion);
  for (const m of modsOf(state, a, b)) if (m.k === 'o') add(m.why, m.v);
  return Math.max(-100, Math.min(100, v));
}

// How far a trusts b to keep agreements, 0..100.
export function trust(state, rules, a, b, parts = null) {
  if (a === b) return 100;
  const B = state.countries[b];
  let v = 50;
  const add = (label, x) => { if (!x) return; v += x; if (parts) parts.push([label, x]); };
  add('Reputation', B.reputation * 0.4);
  let oldest = Infinity;
  for (const t of treatiesBetween(state, a, b)) if (!TREATIES[t.type].peaceOnly) oldest = Math.min(oldest, t.start);
  if (oldest < Infinity) add('Kept treaties with us', Math.min(20, ((state.day - oldest) / 365) * 2));
  if (allied(state, a, b)) add('Allies', 10);
  for (const m of modsOf(state, a, b)) if (m.k === 't') add(m.why, m.v);
  return Math.max(0, Math.min(100, v));
}

// ---------------------------------------------------------------------------------------------
// proposals

const BASE = { alliance: -40, defensive: -25, nap: -10, access: -15, trade: -5, guarantee: 0, arms_control: -5 };

// Would `to` accept `type` proposed by `from`? Returns { accept, score, reasons: [[text, value]] }.
export function evaluateTreaty(state, map, rules, type, from, to) {
  const [a, b] = recordOrder(type, from, to);
  const invalid = validateTreaty(state, map, rules, type, a, b);
  if (invalid) return { accept: false, score: -999, reasons: [[invalid, 0]], invalid };
  const C = state.countries, F = C[from], T = C[to];
  const reasons = [];
  let score = 0;
  const add = (text, x) => { x = Math.round(x); if (!x) return; score += x; reasons.push([text, x]); };
  if (type === 'guarantee') return { accept: true, score: 1, reasons: [['A guarantee needs no acceptance', 0]] };
  if (T.rival === from) return { accept: false, score: -100, reasons: [['They consider you their rival', -100]] };
  add({ alliance: 'Alliances are a big commitment', defensive: 'Defensive pacts are a commitment', nap: 'Reluctance to tie their hands', access: 'Foreign troops on their soil', trade: '', arms_control: 'Verification and lost flexibility' }[type] || 'Base', BASE[type]);
  const op = opinion(state, map, rules, to, from);
  add('Their opinion of you', op * 0.5);
  add('Their trust in you', (trust(state, rules, to, from) - 50) * 0.3);
  const fp = F.cache?.armyPower || 0, tp = Math.max(1, T.cache?.armyPower || 0);
  const nb = countryNeighbours(state, map).sets[to]?.has(from);
  const fam = govFamily(rules, T), ffam = govFamily(rules, F);
  if (type === 'alliance' || type === 'defensive') {
    const R = T.rival;
    if (R >= 0 && (F.rival === R || opinion(state, map, rules, from, R) < -20)) add('You share their rival', 25);
    if (R >= 0 && countryNeighbours(state, map).sets[from]?.has(R)) add('You border their rival', 5);
    if (fp < tp * 0.2) add('You would add little strength', -15);
    else if (fp > tp) add('Your military strength', 10 * Math.min(2, fp / tp - 1));
    if (type === 'alliance' && isAtWar(state, from)) add('You are at war', -20);
    if (F.rival >= 0 && opinion(state, map, rules, to, F.rival) > 30) add(`Friendly with ${C[F.rival].name}`, -30);
    if (fam === 'democracy' && ffam !== 'democracy') add('Their public opposes ties with a non-democracy', -10);
  } else if (type === 'nap') {
    if (nb && fp > tp * 0.8) add('Secures their border', 15);
    if (T.rival >= 0 && T.rival !== from) add('Lets them focus on their rival', 8);
    if (isAtWar(state, to)) add('They are at war and want calm borders', 10);
  } else if (type === 'access') {
    if (isAtWar(state, from)) {
      const theirEnemies = [...enemiesOf(state, from)].filter((e) => opinion(state, map, rules, to, e) > -20);
      if (theirEnemies.length) add('Would drag them into your war', -20);
    }
    if (op < 30) add('Not close enough to you', -10);
  } else if (type === 'trade') {
    const gf = F.cache?.gdp || 0, gt = Math.max(1, T.cache?.gdp || 0);
    add('Size of your market', 12 * Math.min(1, gf / gt));
    if (nb) add('Neighbours', 8);
    const r = T.govt?.ruling;
    if (r === 'business') add('Business-friendly government', 10);
    if (r === 'nationalists') add('Protectionist government', -8);
    if (T.govt?.policies.economy === 'planned') add('Planned economy', -10);
  } else if (type === 'arms_control') {
    const cap = rules.balance.strategic.armsControlCap, mine = T.strat.warheads, theirs = F.strat.warheads;
    add('Slows a costly arms race', 15);
    if (theirs > cap) add('Caps their arsenal', 10);
    if (mine > cap && theirs <= cap) add(`We would have to cut to ${cap} warheads`, -20);
    if (T.rival === from) add('They are our rival', -10);
  }
  return { accept: score > 0, score, reasons };
}

// Proposes a treaty. AI recipients answer at once; the player gets an offer in the Diplomacy tab.
export function proposeTreaty(state, map, rules, type, from, to) {
  if (!PROPOSABLE.includes(type)) return { ok: false, reason: 'Only possible in a peace treaty' };
  const [a, b] = recordOrder(type, from, to);
  const invalid = validateTreaty(state, map, rules, type, a, b);
  if (invalid) return { ok: false, reason: invalid };
  const C = state.countries;
  if (type === 'guarantee') {
    signTreaty(state, map, rules, type, a, b);
    addMod(state, b, a, 10, rules.balance.diplomacy.modDecay, 'Guaranteed our independence');
    return { ok: true, reason: 'Guarantee issued.' };
  }
  if (humanControls(state, to)) {
    if (!state.offers.some((o) => o.kind === 'treaty' && o.type === type && o.from === from && o.to === to)) {
      state.offers.push({ id: state.nextId++, kind: 'treaty', type, from, to, day: state.day });
    }
    return { ok: true, pending: true, reason: 'Proposal sent.' };
  }
  const ev = evaluateTreaty(state, map, rules, type, from, to);
  if (ev.accept) signTreaty(state, map, rules, type, a, b);
  else state.dip.refused[`${type}:${from}:${to}`] = state.day;
  const top = ev.reasons.slice().sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 3).map(([t, v]) => `${t} ${v > 0 ? '+' : ''}${v}`).join(', ');
  return { ok: ev.accept, ev, reason: ev.accept ? `${C[to].name} accepted (${top}).` : `${C[to].name} refused (${top}).` };
}

export function recentlyRefused(state, rules, type, from, to) {
  const d = state.dip.refused[`${type}:${from}:${to}`];
  return d != null && state.day - d < rules.balance.diplomacy.refusalCooldownDays;
}

// The player accepts an AI proposal.
export function acceptTreatyOffer(state, map, rules, offer) {
  const [a, b] = recordOrder(offer.type, offer.from, offer.to);
  const why = validateTreaty(state, map, rules, offer.type, a, b);
  state.offers = state.offers.filter((o) => o !== offer);
  if (why) return why;
  signTreaty(state, map, rules, offer.type, a, b);
  return null;
}

export function declineOffer(state, map, rules, offer) {
  state.offers = state.offers.filter((o) => o !== offer);
  if (offer.kind === 'treaty') {
    state.dip.refused[`${offer.type}:${offer.from}:${offer.to}`] = state.day;
    addMod(state, offer.from, offer.to, -5, rules.balance.diplomacy.modDecay, 'Rejected our proposal');
  }
}

// Spends influence to raise b's opinion of a.
export function canImprove(state, rules, a, b) {
  const D = rules.balance.diplomacy, C = state.countries;
  if (a === b || !C[b]?.alive) return 'Choose another country';
  if (atWar(state, a, b)) return 'Not while at war';
  if (C[a].influence < D.improveCost) return `Needs ${D.improveCost} influence (you have ${Math.floor(C[a].influence)})`;
  const m = modsOf(state, b, a).find((x) => x.why === 'Improved relations');
  if (m && m.v >= D.improveOpinion * 3) return 'Relations cannot be improved further for now';
  return null;
}

export function improveRelations(state, rules, a, b) {
  const why = canImprove(state, rules, a, b);
  if (why) return why;
  const D = rules.balance.diplomacy;
  state.countries[a].influence -= D.improveCost;
  addMod(state, b, a, D.improveOpinion, D.improveDecay, 'Improved relations');
  return null;
}

// ---------------------------------------------------------------------------------------------
// blocs (international organisations)

export function canJoinBloc(state, rules, bloc, k) {
  const C = state.countries;
  if (!C[k]?.alive) return 'Country does not exist';
  if (bloc.members.includes(k)) return 'Already a member';
  if (overlordOf(state, k) >= 0) return 'Subjects cannot join organisations';
  if (bloc.kind !== 'economic') {
    if (isAtWar(state, k)) return 'Not while at war';
    const other = state.alliances.find((b) => b !== bloc && b.kind !== 'economic' && b.members.includes(k));
    if (other) return `Already in ${other.name}`;
    for (const m of bloc.members) if (C[m].rival === k) return `${C[m].name} treats you as a rival`;
  }
  return null;
}

// Members vote: yes when their opinion of the applicant clears blocVoteOpinion. Passes with
// blocVoteShare of the votes. Returns { ok, yes, no, reason }.
export function applyToBloc(state, map, rules, bloc, k) {
  const why = canJoinBloc(state, rules, bloc, k);
  if (why) return { ok: false, reason: why };
  const D = rules.balance.diplomacy, C = state.countries;
  let yes = 0, no = 0;
  const against = [];
  for (const m of bloc.members) {
    if (!C[m].alive) continue;
    if (opinion(state, map, rules, m, k) > D.blocVoteOpinion) yes++;
    else { no++; against.push(C[m].name); }
  }
  const ok = yes >= (yes + no) * D.blocVoteShare;
  if (ok) {
    bloc.members.push(k);
    touchRelations(state);
    log(state, 'diplomacy', `${C[k].name} joined ${bloc.name} (${yes} votes for, ${no} against).`, { important: true });
  } else {
    logFor(state, k, 'diplomacy', `${bloc.name} rejected the membership application of ${C[k].name} (${yes} for, ${no} against).`, { important: true });
  }
  return { ok, yes, no, reason: ok ? `Accepted: ${yes} for, ${no} against.` : `Rejected: ${yes} for, ${no} against${against.length ? ` (${against.slice(0, 4).join(', ')}${against.length > 4 ? '…' : ''})` : ''}. Needs ${Math.round(D.blocVoteShare * 100)}%.` };
}

export function leaveBloc(state, rules, bloc, k) {
  if (!bloc.members.includes(k)) return 'Not a member';
  const C = state.countries, D = rules.balance.diplomacy;
  bloc.members = bloc.members.filter((m) => m !== k);
  if (bloc.kind !== 'economic') C[k].reputation = clampRep(C[k].reputation - 5);
  for (const m of bloc.members) addMod(state, m, k, -15, D.modDecay, `Left ${bloc.name}`);
  touchRelations(state);
  log(state, 'diplomacy', `${C[k].name} left ${bloc.name}.`, { important: true });
  return null;
}

// ---------------------------------------------------------------------------------------------
// casus belli: a temporary justification for war on one country (a refused ultimatum, a
// defaulted loan, detected support for rebels). Stored lazily in state.dip.cbs as
// { a, b, until, why }: a may declare war on b without the unprovoked-war penalty.

export function addCasusBelli(state, a, b, days, why) {
  if (a === b || a < 0 || b < 0) return;
  const l = (state.dip.cbs ||= []);
  const x = l.find((c) => c.a === a && c.b === b);
  if (x) { x.until = Math.max(x.until, state.day + days); x.why = why; } else l.push({ a, b, until: state.day + days, why });
}

export function casusBelli(state, a, b) {
  for (const x of state.dip?.cbs || []) if (x.a === a && x.b === b && x.until > state.day) return x;
  return null;
}

export function casusBelliOf(state, a) {
  return (state.dip?.cbs || []).filter((x) => x.a === a && x.until > state.day);
}

// Why `junior` cannot join `senior` in a personal union (null if it can): sizes, existing
// overlords and partners. Shared by the diplomatic offer, peace terms (inPeace: the two are
// still at war while the treaty is negotiated) and events.
export function unionProblem(state, map, rules, senior, junior, inPeace = false) {
  const C = state.countries, X = rules.balance.deals;
  if (!X) return 'Personal unions are off';
  if (senior === junior || !C[senior]?.alive || !C[junior]?.alive) return 'Choose another country';
  if (!inPeace && atWar(state, senior, junior)) return 'You are at war';
  if (findTreaty(state, 'union', senior, junior)) return 'Already in a personal union';
  if (followsOf(state, junior) >= 0 || subjectsOf(state, junior).length || juniorsOf(state, junior).length) return `${C[junior].name} already has an overlord, a senior partner, subjects or junior partners`;
  if (followsOf(state, senior) >= 0) return `${C[senior].name} follows the foreign policy of ${C[followsOf(state, senior)].name}`;
  const S = C[senior], J = C[junior];
  if (J.cache?.provinces > X.unionMaxProvinces) return `${J.name} is too large for a personal union (${J.cache.provinces} provinces, max ${X.unionMaxProvinces})`;
  const share = unionStrengthShare(S, J);
  if (share > X.unionMaxPowerShare) return `${J.name} is not much weaker than ${S.name} (${Math.round(share * 100)}% of its strength, max ${Math.round(X.unionMaxPowerShare * 100)}%)`;
  return null;
}

// Junior's strength relative to the senior: the mean of the army and economy ratios.
export function unionStrengthShare(S, J) {
  const ra = (J.cache?.armyPower || 0) / Math.max(1, S.cache?.armyPower || 0), rg = (J.cache?.gdp || 0) / Math.max(1e-6, S.cache?.gdp || 0);
  return (Math.min(3, ra) + Math.min(3, rg)) / 2;
}

// Forms the union: the junior leaves its own treaties (except with the senior) and defence blocs.
export function formUnion(state, map, rules, senior, junior, { quiet = false } = {}) {
  for (const t of [...treatiesOf(state, junior)]) if (!TREATIES[t.type].peaceOnly && t.a !== senior && t.b !== senior) removeTreaty(state, t);
  for (const al of state.alliances) if (al.kind !== 'economic' && al.members.includes(junior)) al.members = al.members.filter((m) => m !== junior);
  return signTreaty(state, map, rules, 'union', senior, junior, { quiet });
}

// ---------------------------------------------------------------------------------------------
// claims (provinces lost in peace treaties) and monthly upkeep

export function addClaim(state, k, p) {
  const c = state.countries[k];
  if (!c.claims.some((x) => x.p === p)) c.claims.push({ p, day: state.day });
}

export function hasClaim(state, k, p) {
  return state.countries[k].claims.some((x) => x.p === p);
}

export function monthlyDiplomacy(state, map, rules) {
  const D = rules.balance.diplomacy, C = state.countries;
  for (const c of C) {
    if (!c.alive) continue;
    const gdp = c.cache?.gdp || 0;
    c.influence = Math.min(D.influenceCap, c.influence + D.influenceBase + Math.min(D.influenceMaxMonth, Math.sqrt(gdp) * D.influencePerSqrtGdp));
    if (c.reputation) c.reputation = c.reputation > 0 ? Math.max(0, c.reputation - D.reputationRecoveryMonth) : Math.min(0, c.reputation + D.reputationRecoveryMonth);
    const maxAge = D.claimYears * 365;
    c.claims = c.claims.filter((x) => state.day - x.day < maxAge && state.prov.owner[x.p] !== c.idx && state.prov.owner[x.p] >= 0);
    if (c.rival >= 0 && !C[c.rival].alive) c.rival = -1;
  }
  let changed = false;
  for (const m of state.dip.mods) {
    m.v = m.v > 0 ? Math.max(0, m.v - m.d) : Math.min(0, m.v + m.d);
    changed = true;
  }
  state.dip.mods = state.dip.mods.filter((m) => m.v !== 0 && C[m.a].alive && C[m.b].alive);
  if (changed) state.dip.modVer = (state.dip.modVer || 0) + 1;
  for (const t of [...state.dip.treaties]) {
    if (t.until >= 0 && state.day >= t.until) {
      removeTreaty(state, t);
      if (t.type === 'reparations') log(state, 'diplomacy', `${C[t.a].name} finished paying reparations to ${C[t.b].name}.`, { important: impFor(state, t.a, t.b) });
    }
  }
  for (const k of Object.keys(state.dip.refused)) if (state.day - state.dip.refused[k] > D.refusalCooldownDays) delete state.dip.refused[k];
}

// Monthly payments under reparations and subject treaties, as [payer, recipient, share of tax].
export function transferShares(state, rules) {
  const D = rules.balance.diplomacy, out = [];
  for (const t of state.dip?.treaties || []) {
    if (t.type === 'reparations') out.push([t.a, t.b, D.reparationsShare]);
    else if (t.type === 'subject') out.push([t.b, t.a, D.subjectTribute]);
  }
  return out;
}

// Removes every treaty, modifier and rivalry of an eliminated country.
export function forgetCountry(state, k) {
  if (!state.dip) return;
  state.dip.treaties = state.dip.treaties.filter((t) => t.a !== k && t.b !== k);
  state.dip.mods = state.dip.mods.filter((m) => m.a !== k && m.b !== k);
  state.dip.modVer = (state.dip.modVer || 0) + 1;
  if (state.dip.cbs) state.dip.cbs = state.dip.cbs.filter((x) => x.a !== k && x.b !== k);
  for (const c of state.countries) if (c.rival === k) c.rival = -1;
  touchRelations(state);
}
