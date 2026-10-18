// Diplomatic relationship queries. Wars and alliances change rarely, so a C×C relation matrix
// is cached per state and rebuilt only when state.relVersion changes.
const cache = new WeakMap();
const HOSTILE = 1, ALLIED = 2, COBELLIGERENT = 4;

function matrix(state) {
  let m = cache.get(state);
  const ver = state.relVersion || 0;
  const C = state.countries.length;
  if (m && m.ver === ver && m.C === C) return m;
  const rel = new Uint8Array(C * C);
  for (const a of state.alliances) {
    for (const x of a.members) for (const y of a.members) if (x !== y) rel[x * C + y] |= ALLIED;
  }
  for (const w of state.wars) {
    for (const x of w.attackers) {
      for (const y of w.defenders) { rel[x * C + y] |= HOSTILE; rel[y * C + x] |= HOSTILE; }
      for (const y of w.attackers) if (x !== y) rel[x * C + y] |= COBELLIGERENT;
    }
    for (const x of w.defenders) for (const y of w.defenders) if (x !== y) rel[x * C + y] |= COBELLIGERENT;
  }
  m = { ver, C, rel };
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
  if (ctl === country || own === country) return true;
  if (atWar(state, country, ctl) || atWar(state, country, own)) return true;
  return friendly(state, country, ctl) && friendly(state, country, own);
}
