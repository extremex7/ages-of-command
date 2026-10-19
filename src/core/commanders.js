// Generals: each army can be led by one. A general's skill (1–5) raises the army's damage, and
// up to three traits add their own effects (attack, defence, terrain, speed, organisation,
// supply, sieges). Generals gain experience in battle, can rise in skill and pick up traits,
// and can fall with a beaten army. Numbers and traits: balance.json → commanders. See
// docs/MILITARY.md (Generals).
//
// A general leading an army is stored on it (a.gen); unassigned generals wait in the
// country's pool (c.generals).
import { log } from './state.js';
import { rand } from './rng.js';

const randInt = (state, lo, hi) => lo + Math.floor(rand(state) * (hi - lo + 1));

// Surnames by region, picked from the capital's position. Initials are added in front.
const NAMES = {
  anglo: ['Harris', 'Walker', 'Bennett', 'Hughes', 'Carter', 'Mitchell', 'Fletcher', 'Lawson', 'Reid', 'Hayes', 'Morgan', 'Sutton', 'Grant', 'Pierce', 'Dalton', 'Ward'],
  west: ['Moreau', 'Lefèvre', 'Brandt', 'Keller', 'Rossi', 'Bianchi', 'de Vries', 'Janssen', 'Navarro', 'Ortega', 'Almeida', 'Weber', 'Lindqvist', 'Nyberg', 'Dubois', 'Conti'],
  slavic: ['Petrov', 'Volkov', 'Kowalski', 'Novak', 'Horvat', 'Sokolov', 'Dvořák', 'Popescu', 'Ivanov', 'Zielinski', 'Kuznetsov', 'Marković', 'Bondarenko', 'Orlov', 'Szabó', 'Georgiev'],
  arab: ['Haddad', 'Mansour', 'Khalil', 'Nasser', 'Saleh', 'Rahman', 'Aziz', 'Farouk', 'Yilmaz', 'Demir', 'Karimi', 'Hosseini', 'Tahir', 'Jaber', 'Suleiman', 'Hamdan'],
  africa: ['Okafor', 'Mensah', 'Diallo', 'Banda', 'Mwangi', 'Ndlovu', 'Traoré', 'Kamara', 'Abebe', 'Osei', 'Mutua', 'Keita', 'Adeyemi', 'Phiri', 'Toure', 'Moyo'],
  south: ['Thapa', 'Singh', 'Sharma', 'Rana', 'Gurung', 'Khan', 'Chaudhry', 'Rao', 'Patil', 'Bose', 'Iyer', 'Malik', 'Perera', 'Ahmed', 'Joshi', 'Verma'],
  east: ['Zhang', 'Wang', 'Li', 'Chen', 'Liu', 'Tanaka', 'Sato', 'Yamamoto', 'Kim', 'Park', 'Choi', 'Zhao', 'Takeda', 'Lee', 'Huang', 'Matsuda'],
  southeast: ['Nguyen', 'Tran', 'Santos', 'Reyes', 'Suharto', 'Wijaya', 'Prasetyo', 'Somchai', 'Aung', 'Tan', 'Lim', 'Rahman', 'Pham', 'Cruz', 'Bautista', 'Hidayat'],
  latin: ['García', 'Rodríguez', 'Fernández', 'López', 'Silva', 'Pereira', 'Gómez', 'Herrera', 'Castro', 'Vargas', 'Morales', 'Rojas', 'Mendoza', 'Ramos', 'Torres', 'Souza'],
};
const ANGLO = new Set(['USA', 'GBR', 'CAN', 'AUS', 'NZL', 'IRL', 'CSA', 'ENG']);

function region(map, c) {
  if (ANGLO.has(c.tag.split('_')[0])) return 'anglo';
  const p = c.capital;
  if (p < 0) return 'west';
  const lat = map.lat[p], lon = map.lon[p];
  if (lon < -30) return lat > 30 ? 'anglo' : 'latin';
  if (lat < 15 && lon < 52) return 'africa';
  if (lon < 20 && lat > 35) return 'west';
  if (lon < 60 && lat > 43) return 'slavic';
  if (lon < 63) return 'arab';
  if (lon < 92 && lat < 38) return 'south';
  if (lat < 22 || lon > 150) return 'southeast';
  if (lon < 90) return 'slavic';
  return 'east';
}

const LETTERS = 'ABCDEFGHJKLMNPRSTV';

// A new general for country c: skill 1–3 (higher rarer), one random trait.
export function newGeneral(state, map, rules, c) {
  const K = rules.balance.commanders, names = NAMES[region(map, c)];
  const traits = Object.keys(K.traits);
  const r = rand(state);
  const g = {
    id: state.nextId++, name: `${LETTERS[randInt(state, 0, LETTERS.length - 1)]}. ${names[randInt(state, 0, names.length - 1)]}`,
    skill: r < 0.6 ? 1 : r < 0.9 ? 2 : 3, xp: 0, traits: [traits[randInt(state, 0, traits.length - 1)]], wins: 0, losses: 0,
  };
  return g;
}

export function hireCost(rules, c) {
  const K = rules.balance.commanders;
  return Math.max(K.hireCostMin, (c.ledger?.revenue ?? 0) * K.hireCostRevenueShare);
}

// The most generals a country may keep (leading or waiting).
export function maxGenerals(state, rules, k) {
  let n = 0;
  for (const a of state.armies) if (a.owner === k) n++;
  return n + rules.balance.commanders.spare;
}

export function generalCount(state, k) {
  let n = state.countries[k].generals?.length || 0;
  for (const a of state.armies) if (a.owner === k && a.gen) n++;
  return n;
}

export function hireGeneral(state, map, rules, k) {
  const c = state.countries[k];
  if (generalCount(state, k) >= maxGenerals(state, rules, k)) return 'You have a general for every army already';
  const cost = hireCost(rules, c);
  if (c.treasury < cost) return 'Not enough money';
  c.treasury -= cost;
  const g = newGeneral(state, map, rules, c);
  (c.generals ||= []).push(g);
  return g;
}

// Puts general id (from the pool, or from another army) in command of army a; a's previous
// general goes back to the pool. id = 0 relieves a's general.
export function assignGeneral(state, armyId, id) {
  const a = state.armies.find((x) => x.id === armyId);
  if (!a) return 'No such army';
  const c = state.countries[a.owner];
  c.generals ||= [];
  if (a.gen?.id === id) return null;
  let g = null;
  if (id) {
    const i = c.generals.findIndex((x) => x.id === id);
    if (i >= 0) g = c.generals.splice(i, 1)[0];
    else {
      const other = state.armies.find((x) => x.owner === a.owner && x.gen?.id === id);
      if (!other) return 'No such general';
      g = other.gen; other.gen = null;
    }
  }
  if (a.gen) c.generals.push(a.gen);
  a.gen = g;
  return null;
}

// Combined trait and skill effects of an army's general (all 1 without one).
const NONE = { attack: 1, defense: 1, speed: 1, orgRecovery: 1, orgLoss: 1, supply: 0, siege: 1, terrain: null };
export function generalFx(rules, a) {
  const g = a.gen;
  if (!g) return NONE;
  if (g.fx && g.fxKey === g.skill + g.traits.join()) return g.fx;
  const K = rules.balance.commanders, s = 1 + K.skillBonus * g.skill;
  const fx = { attack: s, defense: s, speed: 1, orgRecovery: 1, orgLoss: 1, supply: 0, siege: 1, terrain: {} };
  for (const t of g.traits) {
    const T = K.traits[t];
    if (!T) continue;
    for (const key of ['attack', 'defense', 'speed', 'orgRecovery', 'orgLoss', 'siege']) if (T[key]) fx[key] *= T[key];
    if (T.supply) fx.supply = Math.max(fx.supply, T.supply);
    if (T.terrain) for (const [tr, v] of Object.entries(T.terrain)) fx.terrain[tr] = (fx.terrain[tr] || 1) * v;
  }
  // derived: not saved (save.js drops `fx`)
  Object.defineProperty(g, 'fx', { value: fx, writable: true, configurable: true, enumerable: false });
  g.fxKey = g.skill + g.traits.join();
  return fx;
}

export function describeTrait(rules, t) {
  return rules.balance.commanders.traits[t] || { name: t, text: '' };
}

// After a battle: experience for both sides; a skill level every `xpPerSkill × skill`; a new
// trait now and then; the general of a beaten army may fall.
export function battleExperience(state, rules, winners, losers, terrain, role) {
  const K = rules.balance.commanders;
  const gain = (a, xp, won) => {
    const g = a.gen;
    if (!g) return;
    if (won) g.wins++; else g.losses++;
    g.xp += xp;
    while (g.skill < K.maxSkill && g.xp >= K.xpPerSkill * g.skill) {
      g.xp -= K.xpPerSkill * g.skill; g.skill++;
      if (g.traits.length < K.maxTraits && rand(state) < K.traitChance) {
        const fit = Object.entries(K.traits).filter(([id, T]) => !g.traits.includes(id) && (!T.terrain || T.terrain[terrain]) && (!T.role || T.role === role(a)));
        if (fit.length) g.traits.push(fit[randInt(state, 0, fit.length - 1)][0]);
      }
      if (a.owner === state.player) log(state, 'military', `General ${g.name} of the ${a.name} rose to skill ${g.skill}.`);
    }
  };
  for (const a of winners) gain(a, K.xpWin, true);
  for (const a of losers) {
    gain(a, K.xpLoss, false);
    if (a.gen && rand(state) < K.fallChance) {
      if (a.owner === state.player) log(state, 'military', `General ${a.gen.name} fell leading the ${a.name}.`, { important: true });
      a.gen = null;
    }
  }
}

// Monthly: armies without a general take the best one waiting; the AI hires generals for
// leaderless armies when it can spare the money. The first call gives every army a general.
export function monthlyCommanders(state, map, rules) {
  const K = rules.balance.commanders;
  if (!K) return;
  const first = !state.commanders;
  state.commanders = 1;
  const leaderless = new Map();
  for (const a of state.armies) if (!a.gen && a.sea < 0) { const l = leaderless.get(a.owner); if (l) l.push(a); else leaderless.set(a.owner, [a]); }
  for (const [k, list] of leaderless) {
    const c = state.countries[k];
    if (!c.alive) continue;
    c.generals ||= [];
    // the largest armies first
    list.sort((x, y) => unitsOf(y) - unitsOf(x));
    for (const a of list) {
      if (c.generals.length) {
        c.generals.sort((x, y) => y.skill - x.skill);
        a.gen = c.generals.shift();
      } else if (first) a.gen = newGeneral(state, map, rules, c);
      else if (k !== state.player && c.ledger && c.treasury > hireCost(rules, c) + Math.max(0, c.ledger.revenue) * K.aiReserveMonths
        && generalCount(state, k) < maxGenerals(state, rules, k)) {
        c.treasury -= hireCost(rules, c);
        a.gen = newGeneral(state, map, rules, c);
      }
    }
  }
}

function unitsOf(a) { let n = 0; for (const t in a.units) n += a.units[t]; return n; }
