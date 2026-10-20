// Religion: a religion per province (state.society.rel, one byte each) and a state religion per
// country (c.soc.rel). Seeded at the start of a game from data/rules/society.json (rules by
// scenario year and location, see docs/RELIGION.md), converted slowly toward the state religion,
// and read by unrest (unrest.js), stability, opinion and the AI. Everything here is optional
// state created lazily (ensureSociety in society.js), so older saves load without a migration.
import { log, aiLog } from './state.js';
import { civilFromDays } from './calendar.js';
import { knowsId } from './technology.js';
import { addGovModifier } from './government.js';
import { isAtWar } from './relations.js';

export const NO_REL = 255;

// Validates society.json into rules.society: religion list and index, compiled rules, tuning.
export function compileSociety(json, techIdx = null) {
  if (!json) return null;
  const errs = [];
  const fam = json.families || {}, rel = json.religions || {};
  const list = Object.entries(rel).filter(([k]) => !k.startsWith('_')).map(([id, r], i) => ({ id, i, ...r }));
  if (!list.length) errs.push('society: needs religions');
  if (list.length >= NO_REL) errs.push('society: at most 254 religions');
  const idx = Object.fromEntries(list.map((r) => [r.id, r.i]));
  for (const r of list) {
    if (!r.name) errs.push(`religion "${r.id}": missing name`);
    if (!fam[r.family]) errs.push(`religion "${r.id}": unknown family "${r.family}"`);
    if (!/^#[0-9a-fA-F]{6}$/.test(r.color || '')) errs.push(`religion "${r.id}": color must be #rrggbb`);
    if (r.tech && techIdx && techIdx[r.tech] == null) errs.push(`religion "${r.id}": unknown technology "${r.tech}"`);
  }
  const rule = (x, where) => {
    if (idx[x.rel] == null) errs.push(`${where}: unknown religion "${x.rel}"`);
    if (x.box && !(Array.isArray(x.box) && x.box.length === 4)) errs.push(`${where}: box must be [lonMin, latMin, lonMax, latMax]`);
    if (x.share != null && !(x.share > 0 && x.share <= 1)) errs.push(`${where}: share must be in (0, 1]`);
    return { ...x, r: idx[x.rel], iso: x.iso ? new Set(x.iso) : null, names: x.names ? new Set(x.names) : null, tags: x.tags ? new Set(x.tags) : null, capitalIso: x.capitalIso ? new Set(x.capitalIso) : null };
  };
  const provinceRules = (json.provinceRules || []).map((x, n) => rule(x, `provinceRules[${n}]`));
  const stateRules = (json.stateRules || []).map((x, n) => rule(x, `stateRules[${n}]`));
  for (const s of ['religion', 'unrest', 'revolts', 'ages']) if (!json[s]) errs.push(`society: missing section "${s}"`);
  if (errs.length) throw new Error('Invalid rules:\nsociety: ' + errs.join('\nsociety: '));
  return { families: fam, list, idx, provinceRules, stateRules, R: json.religion, U: json.unrest, V: json.revolts, A: json.ages };
}

// A fixed pseudo-random number in [0, 1) per province, for rules that cover a share of provinces.
export function provHash(i) {
  let h = Math.imul(i + 0x9e37, 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const inYear = (x, y) => (x.from == null || y >= x.from) && (x.to == null || y < x.to);

// Majority religion of every province in a given year (Uint8Array of religion indices).
export function seedProvinces(map, S, year) {
  const rel = new Uint8Array(map.count).fill(NO_REL);
  const rules = S.provinceRules.filter((x) => inYear(x, year));
  for (const i of map.ids) {
    let r = NO_REL;
    for (const x of rules) {
      if (x.iso && !x.iso.has(map.iso[i])) continue;
      if (x.names && !x.names.has(map.name[i])) continue;
      if (x.box) { const [a, b, c, d] = x.box, lo = map.lon[i], la = map.lat[i]; if (lo < a || lo > c || la < b || la > d) continue; }
      if (x.share != null && provHash(i) >= x.share) continue;
      r = x.r;
    }
    rel[i] = r;
  }
  return rel;
}

// State religion of a country at the start: a state rule, else the most common religion of its
// heartland (or of the land it would get when released).
export function seedStateReligion(state, map, S, c, year, rel) {
  let r = -1;
  const capIso = c.capital >= 0 ? map.iso[c.capital] : null;
  for (const x of S.stateRules) {
    if (!inYear(x, year)) continue;
    if (x.scenario && !x.scenario.includes(state.scenarioId)) continue;
    if (x.tags && !x.tags.has(c.tag)) continue;
    if (x.capitalIso && !x.capitalIso.has(capIso)) continue;
    r = x.r;
  }
  if (r < 0) {
    // the faith of the heartland: the owned provinces in the capital's modern country (so a
    // colonial empire keeps the religion of its metropole), else all of its land
    const n = new Float64Array(S.list.length);
    for (const i of map.ids) if (state.prov.owner[i] === c.idx && rel[i] !== NO_REL && map.iso[i] === capIso) n[rel[i]] += state.prov.pop[i] + 1;
    if (!n.some((v) => v > 0)) for (const i of map.ids) if (state.prov.owner[i] === c.idx && rel[i] !== NO_REL) n[rel[i]] += state.prov.pop[i] + 1;
    if (!n.some((v) => v > 0)) for (const i of state.releases?.[c.tag] || []) if (rel[i] !== NO_REL && rel[i] != null) n[rel[i]] += 1;
    let best = -1;
    n.forEach((v, k) => { if (v > 0 && (best < 0 || v > n[best])) best = k; });
    r = best >= 0 ? best : S.idx.animist ?? 0;
  }
  return S.list[r].id;
}

// The scenario may fix religions itself: "religion": { "states": { TAG: id }, "provinces": { id: [province ids] } }.
export function applyScenarioReligion(state, map, S, scenario, rel) {
  const sr = scenario?.religion;
  if (!sr) return;
  for (const [id, ps] of Object.entries(sr.provinces || {})) if (S.idx[id] != null) for (const p of ps) if (map.exists[p]) rel[p] = S.idx[id];
  for (const c of state.countries) { const id = sr.states?.[c.tag]; if (id && S.idx[id] != null) c.soc.rel = id; }
}

// --- religion relations

export function relFamily(S, r) { return r == null || r === NO_REL ? null : S.list[r].family; }

// How strongly a province of religion r resents a state of religion s (0 = same faith).
export function mismatch(S, r, s) {
  if (r === s || r === NO_REL || s == null) return 0;
  const fr = S.list[r].family, fs = S.list[s].family;
  if (fr === 'secular' || fs === 'secular') return S.R.secular;
  return fr === fs ? S.R.sameFamily : 1;
}

export function policyFx(S, c) {
  return S.R.policy[c.govt?.policies?.religion] || S.R.policy.tolerant;
}

export function stateRelIdx(S, c) { return c.soc ? S.idx[c.soc.rel] ?? -1 : -1; }

// Opinion term between two countries' state religions (diplomacy.js).
export function religionOpinion(state, rules, a, b) {
  const S = rules.society;
  if (!S || !state.society) return 0;
  const A = state.countries[a], B = state.countries[b];
  const ra = stateRelIdx(S, A), rb = stateRelIdx(S, B);
  if (ra < 0 || rb < 0) return 0;
  if (ra === rb) return S.list[ra].family === 'secular' ? 0 : S.R.sameOpinion;
  const fa = S.list[ra].family, fb = S.list[rb].family;
  if (fa === 'secular' || fb === 'secular') return 0;
  if (fa === fb) return S.R.familyOpinion;
  const zeal = (c) => c.govt?.policies?.religion === 'state' || c.gov === 'theocracy';
  return zeal(A) || zeal(B) ? S.R.zealOpinion : 0;
}

// --- religious make-up

// People of each religion in country k, as [[religion index, people], ...] largest first.
export function religionMix(state, map, rules, k) {
  const S = rules.society, rel = state.society?.rel;
  if (!S || !rel) return [];
  const n = new Float64Array(S.list.length);
  for (const i of map.ids) if (state.prov.owner[i] === k && rel[i] !== NO_REL) n[rel[i]] += state.prov.pop[i];
  return [...n].map((v, r) => [r, v]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

// --- conversion

// Monthly conversion progress of one province toward its owner's state religion (0 when none).
export function conversionRate(state, rules, i, c) {
  const S = rules.society, so = state.society, R = S.R;
  const r = so.rel[i], s = stateRelIdx(S, c);
  if (s < 0 || r === s) return 0;
  if (state.prov.controller[i] !== c.idx) return 0;
  const u = so.unrest[i];
  if (u >= R.conversionUnrestStop) return 0;
  // a secular state does not proselytise: secularisation is a slow drift of developed provinces
  const toSec = S.list[s].family === 'secular';
  let rate = 1 / (R.conversionYears * 12) * policyFx(S, c).conversion * Math.max(0.3, c.civilShare / R.civilRef);
  if (r !== NO_REL && S.list[r].family === S.list[s].family) rate *= R.sameFamilyConversion;
  if (toSec) rate *= Math.max(0, (state.prov.dev[i] - 40) / 40);
  else if (r !== NO_REL && S.list[r].family === 'secular') rate *= 0.4;
  rate *= (1 - u / R.conversionUnrestStop) * (0.6 + 0.8 * provHash(i * 7 + 3));
  return rate;
}

export function monthlyConversion(state, map, rules) {
  const so = state.society, S = rules.society, C = state.countries;
  const converted = new Map();
  for (const i of map.ids) {
    const o = state.prov.owner[i];
    if (o < 0) continue;
    const c = C[o];
    const rate = conversionRate(state, rules, i, c);
    if (rate <= 0) { if (so.conv[i] > 0) so.conv[i] = Math.max(0, so.conv[i] - 0.01); continue; }
    so.conv[i] += rate;
    if (so.conv[i] >= 1) {
      so.conv[i] = 0;
      so.rel[i] = stateRelIdx(S, c);
      converted.set(o, (converted.get(o) || 0) + 1);
      if (o === state.player) log(state, 'event', `${map.name[i]} has converted to ${S.list[so.rel[i]].name}.`, { prov: i, country: o });
    }
  }
  if (converted.size) so.ver = (so.ver || 0) + 1;
}

// --- changing the state religion

export function canChangeReligion(state, map, rules, k, id) {
  const S = rules.society, R = S?.R, c = state.countries[k];
  if (!S || !state.society) return 'Religion is not part of this game';
  if (!c?.alive) return 'Country does not exist';
  const r = S.idx[id];
  if (r == null) return 'Unknown religion';
  if (c.soc.rel === id) return 'Already the state religion';
  if (c.gov === 'theocracy') return 'A theocracy cannot change its faith';
  const t = S.list[r].tech;
  if (t && state.tech && rules.tech?.idx[t] != null && !knowsId(state, rules, k, t)) return `Needs the technology ${rules.tech.list[rules.tech.idx[t]].name}`;
  const mix = religionMix(state, map, rules, k), tot = mix.reduce((s, x) => s + x[1], 0);
  const share = (mix.find((x) => x[0] === r)?.[1] || 0) / Math.max(1, tot);
  if (share < R.changeMinShare) return `Needs ${Math.round(R.changeMinShare * 100)}% of the people to follow it (now ${Math.round(share * 100)}%)`;
  const wait = (c.soc.relDay ?? -1e9) + R.changeCooldownYears * 365 - state.day;
  if (wait > 0) return `The faith was changed recently; possible again in ${Math.ceil(wait / 365)} year(s)`;
  return null;
}

export function changeReligion(state, map, rules, k, id) {
  const why = canChangeReligion(state, map, rules, k, id);
  if (why) return why;
  const S = rules.society, R = S.R, c = state.countries[k];
  const was = S.list[S.idx[c.soc.rel]]?.name || c.soc.rel;
  c.soc.rel = id;
  c.soc.relDay = state.day;
  c.stability = Math.max(0, c.stability - R.changeStability);
  if (c.govt) {
    c.govt.legitimacy = Math.max(0, c.govt.legitimacy - R.changeLegitimacy);
    addGovModifier(state, rules, c, 'Change of faith', R.changeMonths, { faction: { clergy: R.changeClergy } });
  }
  // conversion toward the old faith is lost
  for (const i of map.ids) if (state.prov.owner[i] === k) state.society.conv[i] = 0;
  state.society.ver = (state.society.ver || 0) + 1;
  log(state, 'politics', `${c.name} has made ${S.list[S.idx[id]].name} its state religion in place of ${was}.`, { important: true, country: k });
  return null;
}

// AI, once every few years: adopt the faith most of the people follow when hardly anyone follows
// the state religion (only in peace and when stable enough to bear the cost), keeping to the same
// family of faiths unless the rulers are pagan or the people have become secular.
export function aiReligion(state, map, rules, c) {
  const S = rules.society;
  if ((c.idx + civilFromDays(state.day).y) % 5 || civilFromDays(state.day).m !== 3) return;
  if (c.stability < 40 || isAtWar(state, c.idx) || c.gov === 'theocracy') return;
  const mix = religionMix(state, map, rules, c.idx), tot = mix.reduce((s, x) => s + x[1], 0);
  if (!mix.length || tot <= 0) return;
  const mine = (mix.find((x) => x[0] === stateRelIdx(S, c))?.[1] || 0) / tot;
  const [top, n] = mix[0];
  if (mine >= 0.12 || top === stateRelIdx(S, c) || n / tot < 0.6) return;
  // rulers keep their family of faiths; only pagan rulers take up a world religion of their people
  const was = relFamily(S, stateRelIdx(S, c)), to = S.list[top].family;
  if (was !== 'pagan' && was !== to && to !== 'secular') return;
  const id = S.list[top].id;
  if (!changeReligion(state, map, rules, c.idx, id)) aiLog(state, c.idx, `Adopted ${S.list[top].name} as the state religion: only ${Math.round(mine * 100)}% followed the old faith, ${Math.round(n / tot * 100)}% follow this one.`);
}
