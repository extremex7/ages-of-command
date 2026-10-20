// Diplomatic relationship queries. Wars, blocs and treaties change rarely, so a C×C relation
// matrix is cached per state and rebuilt only when state.relVersion changes.
import { dmzBlock } from './council.js';

const cache = new WeakMap();
const HOSTILE = 1, ALLIED = 2, COBELLIGERENT = 4, ACCESS = 8;
// treaty types that make two countries allies (mutual defence, shared access)
export const ALLIANCE_TYPES = ['alliance', 'defensive', 'subject', 'union'];

function matrix(state) {
  let m = cache.get(state);
  const ver = state.relVersion || 0;
  const C = state.countries.length;
  if (m && m.ver === ver && m.C === C) return m;
  const rel = new Uint8Array(C * C);
  const trade = new Array(C).fill(null);
  const addTrade = (x, y) => { (trade[x] ||= []).includes(y) || trade[x].push(y); };
  for (const a of state.alliances) {
    const eco = a.kind === 'economic';
    for (const x of a.members) for (const y of a.members) {
      if (x === y) continue;
      if (eco) addTrade(x, y); else rel[x * C + y] |= ALLIED;
    }
  }
  for (const t of state.dip?.treaties || []) {
    const { a, b } = t;
    if (a >= C || b >= C) continue;
    if (ALLIANCE_TYPES.includes(t.type)) { rel[a * C + b] |= ALLIED; rel[b * C + a] |= ALLIED; }
    else if (t.type === 'access') rel[b * C + a] |= ACCESS; // a grants b access
    else if (t.type === 'trade') { addTrade(a, b); addTrade(b, a); }
  }
  for (const w of state.wars) {
    const cease = w.ceasefire != null && w.ceasefire > state.day; // a council ceasefire: no fighting, still at war on paper
    for (const x of w.attackers) {
      if (!cease) for (const y of w.defenders) { rel[x * C + y] |= HOSTILE; rel[y * C + x] |= HOSTILE; }
      for (const y of w.attackers) if (x !== y) rel[x * C + y] |= COBELLIGERENT;
    }
    for (const x of w.defenders) for (const y of w.defenders) if (x !== y) rel[x * C + y] |= COBELLIGERENT;
  }
  // enemies are never allies (a subject fighting for independence)
  for (const w of state.wars) for (const x of w.attackers) for (const y of w.defenders) { rel[x * C + y] &= ~ALLIED; rel[y * C + x] &= ~ALLIED; }
  m = { ver, C, rel, trade, dmz: dmzBlock(state) };
  cache.set(state, m);
  return m;
}

export function touchRelations(state) {
  state.relVersion = (state.relVersion || 0) + 1;
}

export function atWar(state, a, b) {
  if (a < 0 || b < 0 || a === b) return false;
  const m = matrix(state);
  return (m.rel[a * m.C + b] & HOSTILE) !== 0;
}

// Same country, a member of the same defence bloc, or a bilateral alliance, defensive pact or
// overlord–subject relation.
export function allied(state, a, b) {
  if (a < 0 || b < 0) return false;
  if (a === b) return true;
  const m = matrix(state);
  return (m.rel[a * m.C + b] & ALLIED) !== 0;
}

// Same country, ally, or fighting on the same side of a war.
export function friendly(state, a, b) {
  if (a < 0 || b < 0) return false;
  if (a === b) return true;
  const m = matrix(state);
  return (m.rel[a * m.C + b] & (ALLIED | COBELLIGERENT)) !== 0;
}

// Fighting on the same side of some war.
export function cobelligerent(state, a, b) {
  if (a < 0 || b < 0 || a === b) return false;
  const m = matrix(state);
  return (m.rel[a * m.C + b] & COBELLIGERENT) !== 0;
}

// Whether armies of `a` may pass through territory of `b` in peacetime.
export function hasAccess(state, a, b) {
  if (a < 0 || b < 0) return false;
  if (a === b) return true;
  const m = matrix(state);
  return (m.rel[a * m.C + b] & (ALLIED | COBELLIGERENT | ACCESS)) !== 0;
}

// Countries with which `a` trades tariff-free (trade agreements and economic blocs); null if none.
export function tradeLinks(state) {
  return matrix(state).trade;
}

export function isAtWar(state, c) {
  for (const w of state.wars) if (w.attackers.includes(c) || w.defenders.includes(c)) return true;
  return false;
}

export function warBetween(state, a, b) {
  for (const w of state.wars) {
    if ((w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a))) return w;
  }
  return null;
}

export function enemiesOf(state, c) {
  const out = new Set();
  for (const w of state.wars) {
    if (w.attackers.includes(c)) w.defenders.forEach((x) => out.add(x));
    else if (w.defenders.includes(c)) w.attackers.forEach((x) => out.add(x));
  }
  return out;
}

// Whether an army of `country` may move into province p.
export function canEnter(state, country, p) {
  const own = state.prov.owner[p], ctl = state.prov.controller[p];
  if (own < 0) return false;
  const dmz = matrix(state).dmz;
  if (dmz && dmz.get(p)?.includes(country)) return false; // a demilitarised zone it is party to
  if (ctl === country || own === country) return true;
  if (atWar(state, country, ctl) || atWar(state, country, own)) return true;
  return hasAccess(state, country, ctl) && hasAccess(state, country, own);
}
