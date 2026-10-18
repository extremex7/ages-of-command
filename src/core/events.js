// Data-driven domestic events (data/events/*.json). Each month every country checks the events
// whose conditions hold; one may fire, with probability 1/mtth each. AI countries choose an option
// by its "ai" weight; the player gets a dialog and has eventChoiceDays to answer.
import { log } from './state.js';
import { isAtWar, enemiesOf } from './relations.js';
import { rand } from './rng.js';
import { countryNeighbours } from './geo.js';
import { govFamily, monthsToElection, addGovModifier, shiftSupport, checkEffects } from './government.js';
import { addMod } from './diplomacy.js';
import { warScore } from './war.js';

const NUM = ['stability', 'legitimacy', 'approval', 'unemployment', 'inflation', 'foodSat', 'living', 'tax', 'civilShare',
  'warMonths', 'warScore', 'provinces', 'avgDev', 'monthsToElection', 'treasuryMonths'];
const BOOL = ['atWar', 'hasRival', 'rivalNeighbour', 'neighbourAtWar'];
const EFFECTS = ['stability', 'legitimacy', 'treasuryMonths', 'tax', 'civilShare', 'manpower', 'modifier', 'support', 'opinion', 'popShare', 'dev'];
const OPS = { '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '=': (a, b) => a === b };

export function compileEvents(files, politics) {
  const errs = [], list = [], ids = new Set();
  for (const f of files) {
    for (const ev of f.events || []) {
      const where = `event "${ev.id}"`;
      if (!ev.id || ids.has(ev.id)) errs.push(`${where}: missing or duplicate id`);
      ids.add(ev.id);
      if (!ev.title || !ev.text) errs.push(`${where}: needs title and text`);
      if (!(ev.mtth > 0)) errs.push(`${where}: mtth must be a positive number of months`);
      if (!Array.isArray(ev.options) || !ev.options.length) errs.push(`${where}: needs at least one option`);
      checkCond(ev.conditions || {}, where, politics, errs);
      ev.cond = compileCond(ev.conditions || {});
      for (const o of ev.options || []) {
        if (!o.text) errs.push(`${where}: option without text`);
        for (const [k, v] of Object.entries(o.effects || {})) {
          if (!EFFECTS.includes(k)) errs.push(`${where}: unknown effect "${k}"`);
          if (k === 'modifier') {
            if (!v.name || !(v.months > 0)) errs.push(`${where}: modifier needs name and months`);
            checkEffects(v.effects || {}, `${where} modifier`, politics, errs);
          }
          if (k === 'support') for (const f2 of Object.keys(v)) if (!politics.factions[f2]) errs.push(`${where}: unknown faction "${f2}"`);
        }
      }
      list.push(ev);
    }
  }
  if (errs.length) throw new Error('Invalid events:\n' + errs.join('\n'));
  return list;
}

function checkCond(cond, where, politics, errs) {
  for (const [k, v] of Object.entries(cond)) {
    if (k === 'any') { if (!Array.isArray(v)) errs.push(`${where}: "any" must be a list`); else v.forEach((c) => checkCond(c, where, politics, errs)); continue; }
    if (k === 'not') { checkCond(v, where, politics, errs); continue; }
    if (k === 'family' || k === 'gov') continue;
    if (BOOL.includes(k)) { if (typeof v !== 'boolean') errs.push(`${where}: "${k}" must be true or false`); continue; }
    const [base, sub] = k.split('.');
    if (base === 'policy') { if (!politics.policies[sub]) errs.push(`${where}: unknown policy "${sub}"`); continue; }
    if (base === 'support' || base === 'approvalOf') { if (!politics.factions[sub]) errs.push(`${where}: unknown faction "${sub}"`); }
    else if (!NUM.includes(k)) { errs.push(`${where}: unknown condition "${k}"`); continue; }
    if (!Array.isArray(v) || !OPS[v[0]] || typeof v[1] !== 'number') errs.push(`${where}: condition "${k}" must be [op, number]`);
  }
}

// Values the conditions read, computed once per country per month.
export function eventContext(state, map, rules, c, warScores, warring = null) {
  const e = c.econ, g = c.govt, nb = countryNeighbours(state, map).sets[c.idx];
  let warMonths = 0, ws = 0, n = 0;
  for (const w of state.wars) {
    const att = w.attackers.includes(c.idx);
    if (!att && !w.defenders.includes(c.idx)) continue;
    warMonths = Math.max(warMonths, (state.day - w.start) / 30.44);
    const sc = warScores?.get(w) ?? 0;
    ws += att ? sc : -sc; n++;
  }
  let neighbour = -1;
  for (const k of nb) if (warring ? warring.has(k) : isAtWar(state, k)) { neighbour = k; break; }
  return {
    stability: c.stability, legitimacy: g.legitimacy, approval: g.approvalAll,
    unemployment: e?.unemployment ?? 0.05, inflation: e?.inflation ?? 0, foodSat: e?.foodSat ?? 1, living: e?.living ?? 1,
    tax: c.tax, civilShare: c.civilShare, warMonths, warScore: n ? ws / n : 0,
    provinces: c.cache.provinces, avgDev: c.cache.avgDev, monthsToElection: monthsToElection(state, c),
    treasuryMonths: c.ledger?.revenue ? c.treasury / c.ledger.revenue : 0,
    atWar: n > 0, hasRival: c.rival >= 0, rivalNeighbour: c.rival >= 0 && nb.has(c.rival), neighbourAtWar: neighbour >= 0 && !enemiesOf(state, c.idx).has(neighbour),
    rival: c.rival, neighbour,
  };
}

// Conditions as a list of [key, value, base, sub], with nested any/not compiled too.
function compileCond(cond) {
  return Object.entries(cond).map(([k, v]) => {
    if (k === 'any') return [k, v.map(compileCond)];
    if (k === 'not') return [k, compileCond(v)];
    const [base, sub] = k.split('.');
    return [k, v, base, sub];
  });
}

export function conditionsHold(rules, c, cond, ctx) {
  if (!Array.isArray(cond)) cond = compileCond(cond);
  for (const [k, v, base, sub] of cond) {
    if (k === 'any') { if (!v.some((x) => conditionsHold(rules, c, x, ctx))) return false; continue; }
    if (k === 'not') { if (conditionsHold(rules, c, v, ctx)) return false; continue; }
    if (k === 'family') { if (![].concat(v).includes(govFamily(rules, c))) return false; continue; }
    if (k === 'gov') { if (![].concat(v).includes(c.gov)) return false; continue; }
    if (BOOL.includes(k)) { if (ctx[k] !== v) return false; continue; }
    let x;
    if (base === 'policy') { if (c.govt.policies[sub] !== v) return false; continue; }
    if (base === 'support') x = c.govt.support[sub] ?? 0;
    else if (base === 'approvalOf') x = c.govt.approval[sub] ?? 50;
    else x = ctx[k];
    if (!OPS[v[0]](x, v[1])) return false;
  }
  return true;
}

export function fillText(state, s, c, ctx) {
  const C = state.countries;
  return s.replace(/\{country\}/g, c.name).replace(/\{rival\}/g, ctx.rival >= 0 ? C[ctx.rival].name : 'a rival')
    .replace(/\{neighbour\}/g, ctx.neighbour >= 0 ? C[ctx.neighbour].name : 'a neighbouring country');
}

// Runs daily; each country checks its events once every 30 days, on its own day, so the work
// is spread over the month.
export function dailyEvents(state, map, rules) {
  const G = rules.balance.government;
  // unanswered player events resolve with the AI's choice
  for (const p of [...state.pendingEvents]) {
    if (state.day - p.day >= G.eventChoiceDays) resolveEvent(state, map, rules, p, aiChoice(state, rules.events.find((e) => e.id === p.ev)));
  }
  let warring = null, warScores = null;
  for (const c of state.countries) {
    if (!c.alive || !c.govt || (state.day + c.idx) % 30) continue;
    if (!warring) {
      warring = new Set();
      for (const w of state.wars) { for (const x of w.attackers) warring.add(x); for (const x of w.defenders) warring.add(x); }
      warScores = currentWarScores(state, map, rules);
    }
    if (state.pendingEvents.some((p) => p.c === c.idx)) continue;
    const ctx = eventContext(state, map, rules, c, warScores, warring);
    const cand = [];
    let tot = 0;
    for (const ev of rules.events) {
      const last = c.govt.evDay[ev.id];
      if (last != null && state.day - last < (ev.cooldownYears || 0) * 365) continue;
      if (!conditionsHold(rules, c, ev.cond, ctx)) continue;
      const p = 1 / ev.mtth;
      cand.push([ev, p]); tot += p;
    }
    if (!cand.length) continue;
    // one roll per country: fires with the combined chance, then picks one event by weight
    const r = rand(state);
    if (r >= Math.min(0.6, tot)) continue;
    let x = rand(state) * tot, ev = cand[0][0];
    for (const [e, p] of cand) { x -= p; if (x <= 0) { ev = e; break; } }
    c.govt.evDay[ev.id] = state.day;
    const pend = { id: state.nextId++, ev: ev.id, c: c.idx, day: state.day, rival: ctx.rival, neighbour: ctx.neighbour, title: ev.title, text: fillText(state, ev.text, c, ctx) };
    if (c.idx === state.player && !c.automate) state.pendingEvents.push(pend);
    else resolveEvent(state, map, rules, pend, aiChoice(state, ev));
  }
}

function aiChoice(state, ev) {
  const w = ev.options.map((o) => o.ai ?? 1);
  let x = rand(state) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return i; }
  return 0;
}

export function resolveEvent(state, map, rules, pend, option) {
  const ev = rules.events.find((e) => e.id === pend.ev);
  state.pendingEvents = state.pendingEvents.filter((p) => p !== pend);
  const c = state.countries[pend.c];
  if (!ev || !c.alive) return;
  const opt = ev.options[Math.max(0, Math.min(ev.options.length - 1, option))];
  applyEffects(state, map, rules, c, opt.effects || {}, pend);
  log(state, 'event', `${c.name}: ${ev.title}. ${opt.text}.`, { important: c.idx === state.player, country: c.idx });
}

// Describes an option's effects in words, for the event dialog.
export function describeEffects(rules, fx) {
  const out = [], P = rules.politics, sg = (v) => (v > 0 ? '+' : '') + v;
  for (const [k, v] of Object.entries(fx)) {
    if (k === 'stability') out.push(`Stability ${sg(v)}`);
    else if (k === 'legitimacy') out.push(`Legitimacy ${sg(v)}`);
    else if (k === 'treasuryMonths') out.push(`Treasury ${sg(v)} months of revenue`);
    else if (k === 'tax') out.push(`Tax rate ${sg(Math.round(v * 100))} points`);
    else if (k === 'civilShare') out.push(`Civil spending ${sg(Math.round(v * 100))} points of the budget`);
    else if (k === 'manpower') out.push(`Manpower ${sg(Math.round(v * 100))}%`);
    else if (k === 'popShare') out.push(`Population ${sg(+(v * 100).toFixed(2))}%`);
    else if (k === 'dev') out.push(`Development ${sg(v)} in every province`);
    else if (k === 'support') for (const [f, d] of Object.entries(v)) out.push(`${P.factions[f].name} support ${sg(Math.round(d * 100))} points`);
    else if (k === 'opinion') out.push(`Opinion of ${v.target === 'rival' ? 'our rival' : 'them'} ${sg(v.value)}`);
    else if (k === 'modifier') {
      const parts = [];
      for (const [e, x] of Object.entries(v.effects || {})) {
        if (e === 'faction') for (const [f, d] of Object.entries(x)) parts.push(`${P.factions[f].name} approval ${sg(d)}`);
        else if (e === 'taxEff') parts.push(`tax efficiency ${sg(Math.round(x * 100))}%`);
        else if (e === 'coupRisk') parts.push(`coup risk ×${x}`);
        else if (e === 'liberty') parts.push(`liberty ${sg(x)}`);
        else parts.push(`${e} ${typeof x === 'number' && e !== 'manpower' && e !== 'construction' ? sg(x) : '×' + x}`);
      }
      out.push(`"${v.name}" for ${v.months} months: ${parts.join(', ')}`);
    }
  }
  return out;
}

export function applyEffects(state, map, rules, c, fx, ctx = {}) {
  const E = rules.balance.economy, cl = (x, a, b) => Math.max(a, Math.min(b, x));
  for (const [k, v] of Object.entries(fx)) {
    switch (k) {
      case 'stability': c.stability = cl(c.stability + v, 0, 100); break;
      case 'legitimacy': c.govt.legitimacy = cl(c.govt.legitimacy + v, 0, 100); break;
      case 'treasuryMonths': c.treasury += v * Math.max(0, c.ledger?.revenue || 0); break;
      case 'tax': c.tax = cl(c.tax + v, E.minTax, E.maxTax); break;
      case 'civilShare': c.civilShare = cl(c.civilShare + v, 0.3, 0.95); break;
      case 'manpower': c.manpower = Math.max(0, c.manpower * (1 + v)); break;
      case 'modifier': addGovModifier(state, rules, c, v.name, v.months, v.effects || {}); break;
      case 'support': for (const [f, d] of Object.entries(v)) shiftSupport(c, f, d); break;
      case 'opinion': {
        const t = v.target === 'rival' ? ctx.rival : v.target === 'neighbour' ? ctx.neighbour : -1;
        if (t >= 0) addMod(state, c.idx, t, v.value, rules.balance.diplomacy.modDecay, 'Border incident');
        break;
      }
      case 'popShare': case 'dev':
        for (const i of map.ids) {
          if (state.prov.owner[i] !== c.idx) continue;
          if (k === 'popShare') state.prov.pop[i] *= 1 + v;
          else state.prov.dev[i] = Math.min(100, state.prov.dev[i] + v);
        }
        break;
    }
  }
}

// War scores of all current wars (attacker's view), computed once per month for factions,
// events and the AI.
export function currentWarScores(state, map, rules) {
  const m = new Map();
  for (const w of state.wars) m.set(w, warScore(state, map, rules, w));
  return m;
}
