// Data-driven events (data/events/*.json): domestic, world and historical events. Each month
// every country checks the events whose conditions hold. Historical events (with a date window,
// country tags, a scenario or "once") roll individually with probability 1 − e^(−1/mtth) and
// fire before random events, which share one roll per country. Events can also be triggered
// directly by another event. AI countries choose an option by its "ai" weight (strongly
// preferring the historical option in the "historical" setting); the player gets a dialog and
// has eventChoiceDays to answer. Formats: docs/MODDING.md.
import { log, newArmy, pickCapital, refreshCountryCache, isHuman, humanControls, impFor } from './state.js';
import { isAtWar, enemiesOf, atWar, allied, touchRelations } from './relations.js';
import { rand } from './rng.js';
import { countryNeighbours } from './geo.js';
import { govFamily, monthsToElection, addGovModifier, shiftSupport, checkEffects, changeGovernment } from './government.js';
import { addMod, overlordOf, signTreaty, validateTreaty, recordOrder, treatiesBetween, removeTreaty, addClaim, TREATIES, opinion, unionProblem, formUnion } from './diplomacy.js';
import { warScore, canDeclareWar, declareWar, joinWar, makePeace, makeSeparatePeace, transferProvince } from './war.js';
import { parseDate, civilFromDays } from './calendar.js';
import { grantTech, knows, knowsId, techCost, refreshTech } from './technology.js';
import { satCount, SAT_KINDS, SAT_TECH } from './strategic.js';
import { computeLedgers } from './economy.js';

const NUM = ['stability', 'legitimacy', 'approval', 'unemployment', 'inflation', 'foodSat', 'living', 'tax', 'civilShare',
  'warMonths', 'warScore', 'provinces', 'avgDev', 'monthsToElection', 'treasuryMonths', 'year', 'warheads', 'satellites', 'worldNukes'];
const BOOL = ['atWar', 'hasRival', 'rivalNeighbour', 'neighbourAtWar', 'independent', 'hasNukes', 'hasHeir'];
// conditions naming countries (tags), technologies, ISO codes or events
const TAGCOND = ['exists', 'notExists', 'atWarWith', 'notAtWarWith', 'warBetween', 'allied', 'subjectOf', 'strongerThan'];
const OTHERCOND = ['hasTech', 'notTech', 'ownsAll', 'ownsAny', 'fired', 'notFired'];
const EFFECTS = ['stability', 'legitimacy', 'treasuryMonths', 'tax', 'civilShare', 'manpower', 'modifier', 'support', 'opinion', 'popShare', 'dev',
  'war', 'joinWar', 'peace', 'annex', 'transfer', 'release', 'government', 'rename', 'treaty', 'breakTreaties', 'rival', 'techs', 'research', 'trigger', 'claims',
  'warheads', 'satellites', 'cyber', 'stations', 'colonies', 'union'];
const OPS = { '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '=': (a, b) => a === b };

export function compileEvents(files, politics) {
  const errs = [], list = [], ids = new Set();
  for (const f of files) {
    for (const ev of f.events || []) {
      const where = `event "${ev.id}"`;
      if (!ev.id || ids.has(ev.id)) errs.push(`${where}: missing or duplicate id`);
      ids.add(ev.id);
      if (!ev.title || !ev.text) errs.push(`${where}: needs title and text`);
      if (!(ev.mtth >= 0)) errs.push(`${where}: mtth must be a number of months (0 = as soon as possible)`);
      ev.hist = !!(ev.date || ev.tags || ev.scenario || ev.once);
      if (ev.date) {
        if (!Array.isArray(ev.date) || ev.date.length !== 2) errs.push(`${where}: date must be [from, to]`);
        else try { ev.dayFrom = ev.date[0] ? parseDate(ev.date[0]) : -Infinity; ev.dayTo = ev.date[1] ? parseDate(ev.date[1]) : Infinity; } catch { errs.push(`${where}: bad date`); }
      }
      if (ev.tags && !Array.isArray(ev.tags)) errs.push(`${where}: tags must be a list`);
      if (ev.scenario && !Array.isArray(ev.scenario)) errs.push(`${where}: scenario must be a list`);
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
          if (k === 'government' && !politics.types[v]) errs.push(`${where}: unknown government type "${v}"`);
          if (k === 'treaty' && (!TREATIES[v.type] || TREATIES[v.type].peaceOnly || !v.with)) errs.push(`${where}: treaty needs a proposable type and "with"`);
          if ((k === 'war' && !v.target) || (k === 'joinWar' && !v.ally) || (k === 'peace' && !v.with) || (k === 'release' && !v.tag) || (k === 'transfer' && !v.from)) errs.push(`${where}: effect "${k}" is missing its country`);
          if (k === 'trigger' && !v.event) errs.push(`${where}: trigger needs "event"`);
          if (k === 'union' && !v.with) errs.push(`${where}: union needs "with" (a tag, or "heir")`);
        }
      }
      list.push(ev);
    }
  }
  for (const ev of list) for (const o of ev.options || []) {
    const t = o.effects?.trigger;
    if (t && !ids.has(t.event)) errs.push(`event "${ev.id}": trigger names unknown event "${t.event}"`);
  }
  if (errs.length) throw new Error('Invalid events:\n' + errs.join('\n'));
  return list;
}

function checkCond(cond, where, politics, errs) {
  for (const [k, v] of Object.entries(cond)) {
    if (k === 'any') { if (!Array.isArray(v)) errs.push(`${where}: "any" must be a list`); else v.forEach((c) => checkCond(c, where, politics, errs)); continue; }
    if (k === 'not') { checkCond(v, where, politics, errs); continue; }
    if (k === 'family' || k === 'gov') continue;
    if (TAGCOND.includes(k)) {
      const ok = k === 'warBetween' ? Array.isArray(v) && v.length === 2 : typeof v === 'string' || (Array.isArray(v) && v.length && (k === 'exists' || k === 'notExists'));
      if (!ok) errs.push(`${where}: condition "${k}" needs a country tag${k === 'warBetween' ? ' pair' : ''}`);
      continue;
    }
    if (OTHERCOND.includes(k)) { if (typeof v !== 'string') errs.push(`${where}: condition "${k}" needs an id`); continue; }
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
  // heir: a much weaker neighbouring monarchy that likes us and could join us in a personal union
  let heir = -1;
  if (state.dip && rules.balance.deals && /monarchy/.test(c.gov)) {
    for (const k of nb) if (/monarchy/.test(state.countries[k].gov) && !unionProblem(state, map, rules, c.idx, k) && opinion(state, map, rules, k, c.idx) >= 20) { heir = k; break; }
  }
  return {
    stability: c.stability, legitimacy: g.legitimacy, approval: g.approvalAll,
    unemployment: e?.unemployment ?? 0.05, inflation: e?.inflation ?? 0, foodSat: e?.foodSat ?? 1, living: e?.living ?? 1,
    tax: c.tax, civilShare: c.civilShare, warMonths, warScore: n ? ws / n : 0,
    provinces: c.cache.provinces, avgDev: c.cache.avgDev, monthsToElection: monthsToElection(state, c),
    treasuryMonths: c.ledger?.revenue ? c.treasury / c.ledger.revenue : 0,
    atWar: n > 0, hasRival: c.rival >= 0, rivalNeighbour: c.rival >= 0 && nb.has(c.rival), neighbourAtWar: neighbour >= 0 && !enemiesOf(state, c.idx).has(neighbour),
    independent: !state.dip || overlordOf(state, c.idx) < 0, year: civilFromDays(state.day).y,
    warheads: c.strat?.warheads || 0, hasNukes: (c.strat?.warheads || 0) > 0, satellites: c.strat ? satCount(c) : 0, worldNukes: state.strategic?.detonations || 0,
    rival: c.rival, neighbour, heir, hasHeir: heir >= 0, state, map,
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
    if (TAGCOND.includes(k) || OTHERCOND.includes(k)) { if (!worldCond(rules, c, k, v, ctx)) return false; continue; }
    if (base === 'policy') { if (c.govt.policies[sub] !== v) return false; continue; }
    if (base === 'support') x = c.govt.support[sub] ?? 0;
    else if (base === 'approvalOf') x = c.govt.approval[sub] ?? 50;
    else x = ctx[k];
    if (!OPS[v[0]](x, v[1])) return false;
  }
  return true;
}

// Country index of a scenario tag, or -1 (cached per state: the country list never changes).
const tagCache = new WeakMap();
export function tagIndex(state, tag) {
  let m = tagCache.get(state);
  if (!m) { m = new Map(state.countries.map((c) => [c.tag, c.idx])); tagCache.set(state, m); }
  return m.get(tag) ?? -1;
}

function alive(state, tag) {
  const k = tagIndex(state, tag);
  return k >= 0 && state.countries[k].alive ? k : -1;
}

// Conditions about other countries, technologies, territory and event history.
function worldCond(rules, c, k, v, ctx) {
  const state = ctx.state, map = ctx.map;
  switch (k) {
    case 'exists': return [].concat(v).every((t) => alive(state, t) >= 0);
    case 'notExists': return [].concat(v).every((t) => alive(state, t) < 0);
    case 'atWarWith': { const t = alive(state, v); return t >= 0 && atWar(state, c.idx, t); }
    case 'notAtWarWith': { const t = alive(state, v); return t < 0 || !atWar(state, c.idx, t); }
    case 'warBetween': { const a = alive(state, v[0]), b = alive(state, v[1]); return a >= 0 && b >= 0 && atWar(state, a, b); }
    case 'allied': { const t = alive(state, v); return t >= 0 && t !== c.idx && allied(state, c.idx, t); }
    case 'subjectOf': { const t = alive(state, v); return t >= 0 && !!state.dip && overlordOf(state, c.idx) === t; }
    case 'strongerThan': { const t = alive(state, v); return t >= 0 && (c.cache?.armyPower || 0) > (state.countries[t].cache?.armyPower || 0); }
    case 'hasTech': return !!state.tech && rules.tech.idx[v] != null && knows(state, c.idx, rules.tech.idx[v]);
    case 'notTech': return !state.tech || rules.tech.idx[v] == null || !knows(state, c.idx, rules.tech.idx[v]);
    case 'ownsAll': case 'ownsAny': {
      let any = false, all = true, seen = false;
      for (const i of map.ids) {
        if (map.iso[i] !== v) continue;
        seen = true;
        if (state.prov.owner[i] === c.idx) any = true; else all = false;
      }
      return k === 'ownsAny' ? any : seen && all;
    }
    case 'fired': return state.fired?.[v] != null;
    case 'notFired': return state.fired?.[v] == null;
  }
  return false;
}

// Whether event ev may fire for country c at all (scenario, tags, date window, once, cooldown).
function eligible(state, ev, c) {
  if (ev.scenario && !ev.scenario.includes(state.scenarioId)) return false;
  if (ev.hist && state.settings.historicalEvents === 'off' && (ev.scenario || ev.tags)) return false;
  if (ev.tags && !ev.tags.includes(c.tag)) return false;
  if (ev.date && (state.day < ev.dayFrom || state.day > ev.dayTo)) return false;
  if (ev.once && state.fired?.[ev.id] != null) return false;
  const last = c.govt.evDay[ev.id];
  if (last != null && state.day - last < (ev.cooldownYears || 0) * 365) return false;
  return true;
}

export function fillText(state, s, c, ctx) {
  const C = state.countries;
  return s.replace(/\{country\}/g, c.name).replace(/\{rival\}/g, ctx.rival >= 0 ? C[ctx.rival].name : 'a rival')
    .replace(/\{neighbour\}/g, ctx.neighbour >= 0 ? C[ctx.neighbour].name : 'a neighbouring country')
    .replace(/\{heir\}/g, ctx.heir >= 0 ? C[ctx.heir].name : 'a neighbouring crown');
}

// Runs daily; each country checks its events once every 30 days, on its own day, so the work
// is spread over the month. Triggered events are handled the next day.
export function dailyEvents(state, map, rules) {
  const G = rules.balance.government;
  // unanswered player events resolve with the AI's choice (in a hotseat game taking turns the
  // time to decide starts when the human first sees the event, see hotseat.js)
  for (const p of [...state.pendingEvents]) {
    if (state.hotseat?.mode === 'turns' && p.seen == null) continue;
    if (state.day - (p.seen ?? p.day) >= G.eventChoiceDays) resolveEvent(state, map, rules, p, aiChoice(state, rules.events.find((e) => e.id === p.ev)));
  }
  let warring = null, warScores = null;
  const prep = () => {
    if (warring) return;
    warring = new Set();
    for (const w of state.wars) { for (const x of w.attackers) warring.add(x); for (const x of w.defenders) warring.add(x); }
    warScores = currentWarScores(state, map, rules);
  };
  if (state.eventQueue?.length) {
    const q = state.eventQueue;
    state.eventQueue = [];
    for (const it of q) {
      const c = state.countries[it.c], ev = rules.events.find((e) => e.id === it.ev);
      if (!c?.alive || !c.govt || !ev) continue;
      if (ev.scenario && !ev.scenario.includes(state.scenarioId)) continue;
      if (ev.once && state.fired?.[ev.id] != null) continue;
      prep();
      const ctx = eventContext(state, map, rules, c, warScores, warring);
      if (conditionsHold(rules, c, ev.cond, ctx)) fire(state, map, rules, c, ev, ctx);
    }
  }
  const rate = state.settings.eventRate ?? 1;
  const lists = eventLists(state, rules);
  for (const c of state.countries) {
    if (!c.alive || !c.govt || (state.day + c.idx) % 30) continue;
    if (state.pendingEvents.some((p) => p.c === c.idx)) continue;
    // the context (war scores, neighbours…) is built only when a roll succeeds
    let ctx0 = null;
    const ctxOf = () => { if (!ctx0) { prep(); ctx0 = eventContext(state, map, rules, c, warScores, warring); } return ctx0; };
    // historical events: each rolls on its own and the first to succeed fires
    let fired = false;
    for (const ev of lists.hist.get(c.tag) || lists.histAny) {
      if (!eligible(state, ev, c)) continue;
      // the roll comes before the (costlier) conditions; the odds are the same either way
      const p = ev.mtth > 0 ? 1 - Math.exp(-1 / ev.mtth) : 1;
      if (p < 1 && rand(state) >= p) continue;
      if (!conditionsHold(rules, c, ev.cond, ctxOf())) continue;
      fire(state, map, rules, c, ev, ctxOf());
      fired = true;
      break;
    }
    if (fired) continue;
    // one roll per country: fires with the combined chance of the events whose conditions
    // hold, then picks one by weight. Rolling against the chance of all eligible events first
    // skips the conditions in most months without changing the odds.
    let all = 0;
    for (const ev of lists.rand) if (eligible(state, ev, c)) all += rate / Math.max(0.5, ev.mtth);
    if (!all) continue;
    const r = rand(state);
    if (r >= Math.min(0.6, all)) continue;
    const cand = [];
    let tot = 0;
    for (const ev of lists.rand) {
      if (!eligible(state, ev, c) || !conditionsHold(rules, c, ev.cond, ctxOf())) continue;
      const p = rate / Math.max(0.5, ev.mtth);
      cand.push([ev, p]); tot += p;
    }
    if (!cand.length || r >= Math.min(0.6, tot)) continue;
    let x = rand(state) * tot, ev = cand[0][0];
    for (const [e, p] of cand) { x -= p; if (x <= 0) { ev = e; break; } }
    fire(state, map, rules, c, ev, ctxOf());
  }
}

// The events that can ever apply in this game, split into historical events per country tag
// (in file order) and random events. Cached per game and rule set.
const listCache = new WeakMap();
function eventLists(state, rules) {
  const key = `${state.scenarioId}|${state.settings.historicalEvents ?? 'historical'}`;
  let x = listCache.get(state);
  if (x && x.key === key && x.events === rules.events) return x;
  const inGame = rules.events.filter((ev) => !ev.scenario || ev.scenario.includes(state.scenarioId));
  const hist = inGame.filter((ev) => ev.hist && !(state.settings.historicalEvents === 'off' && (ev.scenario || ev.tags)));
  const byTag = new Map();
  for (const c of state.countries) byTag.set(c.tag, hist.filter((ev) => !ev.tags || ev.tags.includes(c.tag)));
  x = { key, events: rules.events, hist: byTag, histAny: hist.filter((ev) => !ev.tags), rand: inGame.filter((ev) => !ev.hist) };
  listCache.set(state, x);
  return x;
}

function fire(state, map, rules, c, ev, ctx) {
  c.govt.evDay[ev.id] = state.day;
  (state.fired ||= {})[ev.id] ??= state.day;
  const pend = { id: state.nextId++, ev: ev.id, c: c.idx, day: state.day, rival: ctx.rival, neighbour: ctx.neighbour, heir: ctx.heir ?? -1, title: ev.title, text: fillText(state, ev.text, c, ctx) };
  if (ev.news && !isHuman(state, c.idx)) log(state, 'event', `${c.name}: ${ev.title}.`, { important: true, country: c.idx });
  if (humanControls(state, c.idx)) state.pendingEvents.push(pend);
  else resolveEvent(state, map, rules, pend, aiChoice(state, ev));
}

function aiChoice(state, ev) {
  const hist = (state.settings.historicalEvents ?? 'historical') === 'historical';
  const w = ev.options.map((o) => (o.ai ?? 1) * (hist && o.historical ? 6 : 1));
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
  log(state, 'event', `${c.name}: ${ev.title}. ${opt.text}.`, { important: impFor(state, c.idx), country: c.idx });
}

// Describes an option's effects in words, for the event dialog.
export function describeEffects(rules, fx, state = null) {
  const out = [], P = rules.politics, sg = (v) => (v > 0 ? '+' : '') + v;
  const name = (tag) => { const k = state ? tagIndex(state, tag) : -1; return k >= 0 ? state.countries[k].name : tag; };
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
    else if (k === 'opinion') out.push(`Opinion of ${v.target === 'rival' ? 'our rival' : v.target === 'neighbour' ? 'them' : name(v.target)} ${sg(v.value)}`);
    else if (k === 'war') out.push(`War with ${name(v.target)}`);
    else if (k === 'joinWar') out.push(`Join ${name(v.ally)}'s wars`);
    else if (k === 'peace') out.push(`Peace with ${name(v.with)}`);
    else if (k === 'annex') out.push(`Annex ${name(v)}`);
    else if (k === 'transfer') out.push(v.to ? `${name(v.from)} cedes land to ${name(v.to)}` : `Take ${v.border ? 'border ' : ''}provinces from ${name(v.from)}`);
    else if (k === 'release') out.push(`${name(v.tag)} becomes independent`);
    else if (k === 'government') out.push(`Government becomes ${P.types[v]?.name || v}`);
    else if (k === 'rename') out.push(`Renamed ${v.name || ''}`.trim());
    else if (k === 'treaty') out.push(`${TREATIES[v.type]?.name || v.type} with ${name(v.with)}`);
    else if (k === 'breakTreaties') out.push(`End treaties with ${name(v)}`);
    else if (k === 'rival') out.push(`${name(v)} becomes our rival`);
    else if (k === 'techs') out.push(`Gain ${v.map((id) => rules.tech?.list[rules.tech.idx[id]]?.name || id).join(', ')}`);
    else if (k === 'research') out.push(`Research ${sg(Math.round(v * 100))}% of the current project`);
    else if (k === 'claims') out.push(`Claims on ${name(v)}'s border provinces`);
    else if (k === 'union') out.push(v.junior ? `Personal union under ${name(v.with)}` : `Personal union with ${v.with === 'heir' ? 'them' : name(v.with)} under our crown`);
    else if (k === 'warheads') out.push(`Nuclear warheads ${sg(v)}`);
    else if (k === 'satellites') out.push(`Satellites ${sg(v)}`);
    else if (k === 'cyber') out.push(`Cyber points ${sg(v)}`);
    else if (k === 'stations') out.push(`Orbital stations ${sg(v)}`);
    else if (k === 'colonies') out.push(`Off-world settlements ${sg(v)}`);
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
        const t = v.target === 'rival' ? ctx.rival : v.target === 'neighbour' ? ctx.neighbour : alive(state, v.target);
        if (t >= 0) addMod(state, c.idx, t, v.value, rules.balance.diplomacy.modDecay, v.why || 'Border incident');
        break;
      }
      case 'union': {
        // { with: tag or "heir", junior: true when we are the junior partner }
        const t = v.with === 'heir' ? ctx.heir ?? -1 : alive(state, v.with);
        if (t < 0 || t === c.idx || !state.dip) break;
        const [sr, jr] = v.junior ? [t, c.idx] : [c.idx, t];
        if (!unionProblem(state, map, rules, sr, jr)) formUnion(state, map, rules, sr, jr);
        break;
      }
      case 'warheads': if (knowsId(state, rules, c.idx, 'atomic_bomb')) c.strat.warheads = Math.max(0, c.strat.warheads + v); break;
      case 'satellites': {
        // added or removed one at a time, spread over the kinds the country can build
        const kinds = SAT_KINDS.filter((x) => knowsId(state, rules, c.idx, SAT_TECH[x]));
        for (let n = 0; n < Math.abs(v) && kinds.length; n++) {
          const pick = kinds.slice().sort((a, b) => (v > 0 ? c.strat.sats[a] - c.strat.sats[b] : c.strat.sats[b] - c.strat.sats[a]))[0];
          c.strat.sats[pick] = Math.max(0, c.strat.sats[pick] + Math.sign(v));
        }
        break;
      }
      case 'cyber': c.strat.cyber = Math.max(0, Math.min(rules.balance.strategic.cyberMax, c.strat.cyber + v)); break;
      case 'stations': if (knowsId(state, rules, c.idx, 'orbital_industry')) c.strat.stations = Math.max(0, Math.min(rules.balance.strategic.maxStations, c.strat.stations + v)); break;
      case 'colonies': if (knowsId(state, rules, c.idx, 'off_world_settlement')) c.strat.colonies = Math.max(0, Math.min(rules.balance.strategic.maxColonies, c.strat.colonies + v)); break;
      default: historicalEffect(state, map, rules, c, k, v); break;
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

// Effects that change wars, borders, governments, treaties and technology.
function historicalEffect(state, map, rules, c, k, v) {
  const C = state.countries, me = c.idx;
  const note = (text) => log(state, 'event', text, { important: impFor(state, me) });
  switch (k) {
    case 'war': {
      const t = alive(state, v.target);
      if (t < 0 || t === me || atWar(state, me, t)) break;
      const wars = state.wars.filter((w) => w.attackers.includes(t) || w.defenders.includes(t));
      if (wars.length) {
        const w = wars[0];
        const why = joinWar(state, map, rules, w, me, w.attackers.includes(t) ? 'D' : 'A');
        if (why) note(`${c.name} could not join the war against ${C[t].name}: ${why}.`);
      } else {
        const why = declareWar(state, map, rules, me, t);
        if (why) note(`${c.name} did not go to war with ${C[t].name}: ${why}.`);
      }
      break;
    }
    case 'joinWar': {
      const a = alive(state, v.ally);
      if (a < 0) break;
      for (const w of [...state.wars]) {
        if (w.attackers.includes(me) || w.defenders.includes(me)) continue;
        if (w.attackers.includes(a)) joinWar(state, map, rules, w, me, 'A');
        else if (w.defenders.includes(a)) joinWar(state, map, rules, w, me, 'D');
      }
      break;
    }
    case 'peace': {
      const t = alive(state, v.with);
      if (t < 0) break;
      const w = state.wars.find((x) => (x.attackers.includes(me) && x.defenders.includes(t)) || (x.defenders.includes(me) && x.attackers.includes(t)));
      if (!w) break;
      const meLead = me === w.leaderA || me === w.leaderD, tLead = t === w.leaderA || t === w.leaderD;
      if (meLead && tLead) makePeace(state, map, rules, w, me, {});
      else if (!meLead) makeSeparatePeace(state, map, rules, w, me, {});
      else makeSeparatePeace(state, map, rules, w, t, {});
      break;
    }
    case 'annex': {
      const t = alive(state, v);
      if (t < 0 || t === me) break;
      const ps = map.ids.filter((i) => state.prov.owner[i] === t);
      note(`${c.name} annexed ${C[t].name}.`);
      for (const p of ps) transferProvince(state, map, p, me);
      refreshCountryCache(state, map, rules);
      break;
    }
    case 'transfer': {
      const from = alive(state, v.from), to = v.to ? alive(state, v.to) : me;
      if (from < 0 || to < 0 || from === to) break;
      const nb = new Set();
      if (v.border) for (const i of map.ids) if (state.prov.owner[i] === to) for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) nb.add(map.adj[e]);
      const ps = map.ids.filter((i) => state.prov.owner[i] === from && (!v.border || nb.has(i)) && (!v.iso || v.iso.includes(map.iso[i]))
        && (!v.names || v.names.includes(map.name[i])) && (!v.box || (map.lon[i] >= v.box[0] && map.lat[i] >= v.box[1] && map.lon[i] <= v.box[2] && map.lat[i] <= v.box[3])));
      for (const p of ps) transferProvince(state, map, p, to);
      if (ps.length) { note(`${C[from].name} ceded ${ps.length} province(s) to ${C[to].name}.`); refreshCountryCache(state, map, rules); }
      break;
    }
    case 'release': releaseCountry(state, map, rules, v.tag, [].concat(v.from || [])); break;
    case 'government': if (rules.politics.types[v] && c.gov !== v) { changeGovernment(state, rules, c, v); note(`${c.name} is now a ${rules.politics.types[v].name.toLowerCase()}.`); } break;
    case 'rename':
      if (v.name) c.name = v.name;
      if (v.color && /^#[0-9a-fA-F]{6}$/.test(v.color)) c.color = v.color;
      state.mapVersion = (state.mapVersion || 0) + 1;
      break;
    case 'treaty': {
      const t = alive(state, v.with);
      if (t < 0 || t === me) break;
      const [a, b] = recordOrder(v.type, me, t);
      if (!validateTreaty(state, map, rules, v.type, a, b)) signTreaty(state, map, rules, v.type, a, b);
      break;
    }
    case 'breakTreaties': {
      const t = alive(state, v);
      if (t < 0) break;
      for (const tr of treatiesBetween(state, me, t)) if (!TREATIES[tr.type].peaceOnly) removeTreaty(state, tr);
      // and leave any defence bloc both belong to
      for (const al of state.alliances) if (al.kind !== 'economic' && al.members.includes(me) && al.members.includes(t)) {
        al.members = al.members.filter((m) => m !== me);
        note(`${c.name} left the ${al.name}.`);
      }
      state.alliances = state.alliances.filter((al) => al.members.length > 1);
      touchRelations(state);
      break;
    }
    case 'rival': { const t = alive(state, v); if (t >= 0 && t !== me) c.rival = t; break; }
    case 'techs': for (const id of v) { const t = rules.tech.idx[id]; if (t != null) grantTech(state, map, rules, me, t, 'acquired'); } break;
    case 'research': {
      const r = c.research, t = r?.current ? rules.tech.idx[r.current] : null;
      if (t != null) r.progress += techCost(state, map, rules, me, t) * v;
      break;
    }
    case 'trigger': {
      const t = v.tag ? alive(state, v.tag) : me;
      if (t >= 0) (state.eventQueue ||= []).push({ c: t, ev: v.event });
      break;
    }
    case 'claims': {
      const t = alive(state, v);
      if (t < 0) break;
      for (const i of map.ids) {
        if (state.prov.owner[i] !== t) continue;
        for (let e = map.adjStart[i]; e < map.adjStart[i + 1]; e++) if (state.prov.owner[map.adj[e]] === me) { addClaim(state, me, i); break; }
      }
      break;
    }
  }
}

// A dormant (or existing) country takes the provinces of `from` that its scenario regions name
// (state.releases), gets a capital, a treasury and an army sized from its population.
export function releaseCountry(state, map, rules, tag, from) {
  const k = tagIndex(state, tag);
  if (k < 0) return 'Unknown country';
  const C = state.countries, c = C[k];
  const fromIdx = from.map((t) => alive(state, t)).filter((x) => x >= 0);
  const ps = (state.releases?.[tag] || []).filter((p) => map.exists[p] && state.prov.owner[p] >= 0 && state.prov.owner[p] !== k && (!fromIdx.length || fromIdx.includes(state.prov.owner[p])));
  if (!ps.length) return 'Nothing to release';
  const wasAlive = c.alive;
  for (const p of ps) transferProvince(state, map, p, k);
  if (!wasAlive) {
    c.alive = true;
    c.truces = {};
    for (const f of fromIdx) { c.truces[f] = state.day + rules.balance.war.truceDays; C[f].truces[k] = state.day + rules.balance.war.truceDays; }
    if (c.econ) c.econ.embargo = [];
  }
  c.capital = pickCapital(state, map, k);
  touchRelations(state);
  refreshTech(state, rules, c);
  refreshCountryCache(state, map, rules);
  computeLedgers(state, map, rules);
  if (!wasAlive) {
    c.treasury = Math.max(c.treasury, (c.ledger?.revenue || 0) * 3);
    c.manpower = c.cache.maxManpower * 0.5;
    const types = Object.entries(rules.units).filter(([id]) => !rules.tech.unitTech[id] || knows(state, k, rules.tech.unitTech[id]));
    const yr = (id) => (rules.tech.unitTech[id] == null ? -1e9 : rules.tech.list[rules.tech.unitTech[id]].year);
    const line = types.filter(([, u]) => (u.role || 'line') === 'line').sort((a, b) => yr(b[0]) - yr(a[0]))[0];
    const n = Math.max(1, Math.min(12, Math.round(c.cache.pop / 4e6)));
    if (line && c.capital >= 0) state.armies.push(newArmy(state, k, c.capital, { [line[0]]: n }));
  }
  log(state, 'event', `${c.name} ${wasAlive ? 'gained' : 'declared independence with'} ${ps.length} province(s).`, { important: true });
  return null;
}

// War scores of all current wars (attacker's view), computed once per month for factions,
// events and the AI.
export function currentWarScores(state, map, rules) {
  const m = new Map();
  for (const w of state.wars) m.set(w, warScore(state, map, rules, w));
  return m;
}
