// Advisors: a treasurer, marshal, chancellor, scientist and chief minister, at most one of each,
// in as many seats as the government type allows. Each has a skill (1–5) whose effects scale the
// advisor type's perSkill bonuses, and draws a monthly salary (in the budget, see economy.js).
// They age, are sometimes promoted, retire, and can die in office. Candidates come from a pool that
// is redrawn every poolMonths months from the game seed, the country and the period alone, so the
// pool can be shown at any time without touching the game's random stream. Numbers:
// data/rules/nations.json → advisors. See docs/NATIONS.md.
//
// Saved per country (optional): c.advisors = [{ id, type, name, skill, born, retire, since }] and
// c.advTaken = { e: pool period, ids: [candidates already hired from it] }.
import { log, aiLog } from './state.js';
import { rand, seedState } from './rng.js';
import { civilFromDays } from './calendar.js';
import { isAtWar } from './relations.js';
import { personName } from './commanders.js';
import { advisorSalary, hashRand } from './natfx.js';
import { govEffects } from './government.js';
import { refreshTech } from './technology.js';

function refresh(state, rules, c) {
  if (c.govt) c.govt.fx = govEffects(rules, c);
  if (state.tech && c.tfx) refreshTech(state, rules, c);
}

const monthIndex = (day) => { const { y, m } = civilFromDays(day); return y * 12 + m - 1; };

export function advisorSlots(rules, c) {
  const A = rules.nations?.advisors;
  return A ? A.slots[c.gov] ?? A.defaultSlots : 0;
}

// The advisor type's title in the country's era ("Natural philosopher", later "Chief scientist").
export function advisorTitle(rules, type, era = 0) {
  const T = rules.nations.advisors.types[type];
  let name = T.name;
  for (const [e, n] of Object.entries(T.eraNames || {})) { const i = rules.tech.eras.find((x) => x.id === e)?.i; if (i != null && era >= i) name = n; }
  return name;
}

export function advisorAge(state, a) { return Math.floor((state.day - a.born) / 365.25); }

export function poolPeriod(state, rules) { return Math.floor(monthIndex(state.day) / rules.nations.advisors.poolMonths); }

// The candidates country k can hire now: { cid, type, name, skill, age, retire }.
export function advisorPool(state, map, rules, k) {
  const A = rules.nations?.advisors;
  if (!A) return [];
  const c = state.countries[k], e = poolPeriod(state, rules);
  const st = { rng: seedState(`${state.seed}|advisors|${c.tag}|${k}|${e}`) }, rnd = () => rand(st);
  const types = rules.nations.advisorTypes, shift = Math.floor(rnd() * types.length);
  const taken = c.advTaken?.e === e ? c.advTaken.ids : [];
  const out = [];
  // every candidate is drawn even when already hired, so the others stay the same
  for (let i = 0; i < A.poolSize; i++) {
    const type = i < types.length ? types[(i + shift) % types.length] : types[Math.floor(rnd() * types.length)];
    const r = rnd();
    const skill = Math.min(A.maxSkill, r < 0.45 ? 1 : r < 0.75 ? 2 : r < 0.92 ? 3 : r < 0.985 ? 4 : 5);
    const age = A.minAge + Math.floor(rnd() * (A.maxAge - A.minAge + 1));
    const retire = Math.max(age + 3, A.retireMin + Math.floor(rnd() * (A.retireMax - A.retireMin + 1)));
    const name = personName(map, c, rnd);
    if (!taken.includes(i)) out.push({ cid: i, type, name, skill, age, retire });
  }
  return out;
}

export function hireCost(rules, c, cand) {
  return rules.nations.advisors.hireMonths * advisorSalary(rules, c, cand);
}

export function canHire(state, rules, k, cand) {
  const c = state.countries[k];
  if (!c?.alive) return 'Country does not exist';
  if (!cand) return 'No such candidate';
  const list = c.advisors || [];
  if (list.length >= advisorSlots(rules, c)) return `All ${advisorSlots(rules, c)} seats are taken (dismiss an advisor first)`;
  if (list.some((a) => a.type === cand.type)) return `You already have a ${advisorTitle(rules, cand.type, c.tfx?.era).toLowerCase()}`;
  if (c.treasury < hireCost(rules, c, cand)) return 'Not enough money';
  return null;
}

// Hires candidate cid from country k's pool. Returns the advisor or an error string.
export function hireAdvisor(state, map, rules, k, cid) {
  const c = state.countries[k];
  const cand = advisorPool(state, map, rules, k).find((x) => x.cid === cid);
  const why = canHire(state, rules, k, cand);
  if (why) return why;
  c.treasury -= hireCost(rules, c, cand);
  const e = poolPeriod(state, rules);
  if (c.advTaken?.e !== e) c.advTaken = { e, ids: [] };
  c.advTaken.ids.push(cid);
  const a = { id: state.nextId++, type: cand.type, name: cand.name, skill: cand.skill, born: state.day - Math.round(cand.age * 365.25), retire: cand.retire, since: state.day };
  (c.advisors ||= []).push(a);
  refresh(state, rules, c);
  return a;
}

export function dismissAdvisor(state, rules, k, id) {
  const c = state.countries[k], i = (c.advisors || []).findIndex((a) => a.id === id);
  if (i < 0) return 'No such advisor';
  c.advisors.splice(i, 1);
  refresh(state, rules, c);
  return null;
}

// How much the AI wants each kind of advisor now.
function aiWeight(state, c, type) {
  switch (type) {
    case 'economy': return 1 + ((c.ledger?.net ?? 0) < 0 ? 1 : 0);
    case 'military': return 0.8 + (isAtWar(state, c.idx) ? 1.5 : 0);
    case 'science': return 0.9 + ((c.research?.share ?? 0) > 0.04 ? 0.4 : 0);
    case 'administration': return 0.7 + (c.stability < 45 ? 1 : 0);
    default: return 0.5;
  }
}

// Monthly: ageing, promotion, retirement and death; too many advisors for the seats (after a change
// of government) leave, least skilled first; AI countries hire and, deep in debt, dismiss.
export function monthlyAdvisors(state, map, rules) {
  const A = rules.nations?.advisors;
  if (!A) return;
  const mi = monthIndex(state.day);
  for (const c of state.countries) {
    if (!c.alive) continue;
    const me = c.idx === state.player && !c.automate;
    let changed = false;
    if (c.advisors?.length) {
      const keep = [];
      for (const a of c.advisors) {
        const age = (state.day - a.born) / 365.25, title = advisorTitle(rules, a.type, c.tfx?.era);
        if (age >= a.retire) { changed = true; if (me) log(state, 'politics', `Your ${title.toLowerCase()} ${a.name} has retired at ${Math.floor(age)}.`, { important: true }); continue; }
        if (hashRand(state, 'adv-death', a.id) < A.deathBase * Math.exp((age - 50) / A.deathScale)) { changed = true; if (me) log(state, 'politics', `Your ${title.toLowerCase()} ${a.name} has died in office, aged ${Math.floor(age)}.`, { important: true }); continue; }
        if (a.skill < A.maxSkill && hashRand(state, 'adv-up', a.id) < A.promoteChanceYear / 12) {
          a.skill++; changed = true;
          if (me) log(state, 'politics', `${a.name}, your ${title.toLowerCase()}, has grown in the job: skill ${a.skill}.`);
        }
        keep.push(a);
      }
      const seats = advisorSlots(rules, c);
      if (keep.length > seats) {
        keep.sort((x, y) => y.skill - x.skill);
        for (const a of keep.splice(seats)) if (me) log(state, 'politics', `${a.name} lost the seat on your council under the new government.`, { important: true });
        changed = true;
      }
      c.advisors = keep;
    }
    if (!me && (mi + c.idx) % 3 === 0 && c.ledger) changed = aiAdvisors(state, map, rules, c) || changed;
    if (changed) refresh(state, rules, c);
  }
}

function aiAdvisors(state, map, rules, c) {
  const A = rules.nations.advisors, L = c.ledger, rev = Math.max(0, L.revenue);
  const list = c.advisors || [];
  // deep in debt: let the least useful advisor go
  if (c.treasury < -rev * 3 && L.net < 0 && list.length) {
    const worst = list.slice().sort((x, y) => aiWeight(state, c, x.type) * x.skill - aiWeight(state, c, y.type) * y.skill)[0];
    c.advisors = list.filter((a) => a !== worst);
    aiLog(state, c.idx, `Dismissed ${worst.name} (${advisorTitle(rules, worst.type, c.tfx?.era).toLowerCase()}) to save money.`);
    return true;
  }
  if (list.length >= advisorSlots(rules, c)) return false;
  let best = null;
  for (const cand of advisorPool(state, map, rules, c.idx)) {
    if (list.some((a) => a.type === cand.type)) continue;
    const sal = advisorSalary(rules, c, cand), cost = hireCost(rules, c, cand);
    if (c.treasury - cost < rev * A.aiReserveMonths || L.net + rev * 0.02 - sal <= 0) continue;
    const v = aiWeight(state, c, cand.type) * cand.skill;
    if (!best || v > best.v) best = { cand, v };
  }
  if (!best) return false;
  const a = hireAdvisor(state, map, rules, c.idx, best.cand.cid);
  if (typeof a === 'string') return false;
  aiLog(state, c.idx, `Hired ${a.name} as ${advisorTitle(rules, a.type, c.tfx?.era).toLowerCase()} (skill ${a.skill}).`);
  return false; // hireAdvisor already refreshed the effects
}
