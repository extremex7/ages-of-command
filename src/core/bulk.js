// Bulk construction for the player (see docs/ECONOMY.md, Bulk construction): queue one building
// or infrastructure in every eligible province of a set (provinces painted on the map, a region,
// or the whole country), with the total cost worked out first; and "build where most needed",
// which turns the largest shortfalls into projects at the best sites, ranked the way the AI ranks
// them (ai.js siteScore, rankProducers). Everything goes through industry.startProject, so the
// usual rules (slots, queue, goods, technology) apply.
import { canBuild, projectCost, startProject } from './industry.js';
import { siteScore, rankProducers, inputAvailability, worldGaps } from './ai.js';
import { provincesOf } from './geo.js';

// Provinces of k in a scope: { type: 'country' } | { type: 'region', iso } | { type: 'list', provs }.
// A region is the present-day country a province lies in (map.iso), the map's admin grouping.
export function scopeProvinces(state, map, k, scope) {
  const own = provincesOf(state, map, k);
  if (!scope || scope.type === 'country') return own;
  if (scope.type === 'region') return own.filter((i) => map.iso[i] === scope.iso);
  const set = new Set(scope.provs || []);
  return own.filter((i) => set.has(i));
}

function queuedHere(state, p, kind, b) {
  let n = 0;
  for (const q of state.construction) if (q.prov === p && q.kind === kind && (kind === 'infra' || q.b === b)) n++;
  return n;
}

// Reasons that only say the money or the queue ran out do not make a site ineligible.
const SOFT = /^Costs|queue is full/;

// The plan for building `kind`/`b` in each of `provs`: eligible sites, best first, the cost of
// each with goods taken from (and missing goods bought over) the stockpile as it runs down, and
// how many fit the treasury and the queue. Nothing is changed.
export function bulkPlan(state, map, rules, k, provs, kind, b = -1) {
  const X = rules.econ, I = rules.balance.industry, c = state.countries[k];
  const sites = [];
  let skipped = 0;
  for (const p of provs) {
    const why = canBuild(state, map, rules, k, p, kind, b);
    if (why && !SOFT.test(why)) { skipped++; continue; }
    let rank;
    if (kind === 'infra') {
      let lv = 0;
      for (let j = 0; j < X.B; j++) lv += state.econ.bld[p * X.B + j];
      rank = lv + 1 / (1 + state.prov.infra[p]);
    } else rank = siteScore(state, map, rules, k, b, p, queuedHere(state, p, kind, b))?.score ?? -1;
    sites.push({ p, rank });
  }
  sites.sort((x, y) => y.rank - x.rank || x.p - y.p);
  const stock = Float64Array.from(c.econ.stock);
  let money = c.treasury, room = I.maxQueue - state.construction.reduce((n, q) => n + (q.owner === k), 0);
  let n = 0, total = 0, all = 0;
  for (const s of sites) {
    const cost = projectCost(state, map, rules, k, s.p, kind, b);
    let prem = 0;
    for (const [g, a] of cost.goods) { if (stock[g] < a) prem += (a - stock[g]) * state.econ.prices[g] * I.missingGoodsPremium; stock[g] = Math.max(0, stock[g] - a); }
    s.cost = cost.money + prem;
    all += s.cost;
    s.ok = room > 0 && money >= s.cost;
    if (s.ok) { room--; money -= s.cost; n++; total += s.cost; }
    else s.why = room <= 0 ? 'queue full' : 'not enough money';
  }
  return { sites, n, total, all, skipped, room: I.maxQueue - state.construction.reduce((x, q) => x + (q.owner === k), 0), treasury: c.treasury };
}

// Starts the projects of a plan that fit. Returns { started, spent, errors }.
export function bulkBuild(state, map, rules, k, provs, kind, b = -1) {
  const plan = bulkPlan(state, map, rules, k, provs, kind, b);
  let started = 0, spent = 0;
  const errors = [];
  for (const s of plan.sites) {
    if (!s.ok) continue;
    const before = state.countries[k].treasury;
    const err = startProject(state, map, rules, k, s.p, kind, b);
    if (err) { errors.push(`${map.name[s.p]}: ${err}`); continue; }
    started++; spent += before - state.countries[k].treasury;
  }
  return { started, spent, errors };
}

// The largest shortfalls of k (need minus production minus what is being built), each with the
// producer the AI would pick (following a missing input up the chain), how many levels would
// close the gap, and the best sites for them. [{ g, good, units, value, b, why, sites, cost }]
export function neededProjects(state, map, rules, k, maxGoods = 3, maxLevels = 6) {
  const X = rules.econ, c = state.countries[k], e = c.econ, A = rules.balance.ai, prices = state.econ.prices;
  if (!e) return [];
  const coming = new Float64Array(X.G);
  for (const p of state.construction) if (p.owner === k && p.kind === 'building') for (const [g, a] of X.buildings[p.b].out) coming[g] += a;
  const gaps = [];
  for (const g of X.goods) {
    const units = e.need[g.i] * (A.buildHeadroom ?? 1) - e.prod[g.i] - coming[g.i];
    if (units > 0.01 && X.producers[g.i].length) gaps.push({ g: g.i, good: g.name, units, value: units * prices[g.i] });
  }
  gaps.sort((a, b) => b.value - a.value);
  const W = worldGaps(state, X), out = [];
  const own = provincesOf(state, map, k);
  // greedy: one level at a time at the best site, counting levels already planned there
  const pickSites = (b, units, per, one) => {
    const extra = new Map(), sites = [];
    let covered = 0;
    while (sites.length < maxLevels && covered < units) {
      let best = -1, bs = 0, be = 0;
      for (const i of own) {
        const r = siteScore(state, map, rules, k, b, i, queuedHere(state, i, 'building', b) + (extra.get(i) || 0));
        if (r && r.score > bs) { bs = r.score; best = i; be = r.eff; }
      }
      if (best < 0) break;
      sites.push(best);
      extra.set(best, (extra.get(best) || 0) + 1);
      covered += per * be * (c.tfx?.bm[b] ?? 1);
      if (one) break; // one bottleneck fix at a time: the chain is re-checked after it
    }
    return sites;
  };
  for (const gap of gaps) {
    if (out.length >= maxGoods) break;
    let pick = null;
    for (const cand of rankProducers(state, map, rules, c, gap.g)) {
      if (c.tfx && !c.tfx.bld[cand]) continue;
      // the missing input first, following the chain as the AI does; if it cannot be built
      // anywhere (no deposit left), the producer itself
      const tries = [];
      let bb = cand, why = '';
      for (let depth = 0; depth < 3; depth++) {
        const inp = inputAvailability(e, X.buildings[bb], coming, W);
        if (!(e.prod[gap.g] > 0 || depth) || inp.f >= (A.bottleneckBelow ?? 0.7) || inp.worst < 0 || !X.producers[inp.worst].length) break;
        why = `${X.goods[inp.worst].name.toLowerCase()} for the ${X.buildings[bb].name.toLowerCase()}`;
        bb = X.producers[inp.worst][0];
        tries.unshift([bb, why]);
      }
      tries.push([cand, '']);
      for (const [b, w] of tries) {
        if (c.tfx && !c.tfx.bld[b]) continue;
        const per = X.buildings[b].out.find(([o]) => o === gap.g)?.[1] || 1;
        const sites = pickSites(b, gap.units, per, !!w);
        if (sites.length) { pick = { b, why: w, sites }; break; }
      }
      if (pick) break;
    }
    if (!pick) continue;
    let cost = 0;
    for (const i of pick.sites) cost += projectCost(state, map, rules, k, i, 'building', pick.b).total;
    out.push({ ...gap, b: pick.b, building: X.buildings[pick.b].name, why: pick.why, sites: pick.sites, cost });
  }
  return out;
}

// Queues the projects of one neededProjects entry. Returns { started, spent, errors }.
export function buildNeeded(state, map, rules, k, entry) {
  let started = 0, spent = 0;
  const errors = [];
  for (const p of entry.sites) {
    const before = state.countries[k].treasury;
    const err = startProject(state, map, rules, k, p, 'building', entry.b);
    if (err) { errors.push(`${map.name[p]}: ${err}`); break; }
    started++; spent += before - state.countries[k].treasury;
  }
  return { started, spent, errors };
}
