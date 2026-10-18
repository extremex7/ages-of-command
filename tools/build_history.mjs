// Builds historical scenarios from the definitions in tools/history/<id>.json (format:
// tools/history/README.md) into data/scenarios/<id>.json, and lists them in
// data/scenarios/index.json. With --economy it then runs tools/build_economy.mjs <id>
// --deposits-from=modern_2026 to seed each scenario's industry (npm run build:history).
//
// Usage: node tools/build_history.mjs [--economy] [id ...]   (no ids: every file in tools/history)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeMap } from '../src/core/game.js';

const ROOT = new URL('../', import.meta.url);
const rd = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT)));
const map = decodeMap(rd('data/map/world.json'));
const modern = rd('data/scenarios/modern_2026.json');
const units = rd('data/rules/units.json');
const techs = rd('data/rules/technologies.json').techs;
const techYear = Object.fromEntries(Object.entries(techs).map(([id, t]) => [id, t.year]));

// GDP in the definitions is in 1990 international dollars; the game's money is roughly
// present-day dollars, so figures are scaled up.
const GDP_SCALE = 2.0;
const DEV_BASE = 400, DEV_GROWTH = 1.06; // the game's output per head: DEV_BASE × DEV_GROWTH^dev
const TERRAIN_DEV = [0, 0, -2, 0, -4, -4]; // plains hills mountains forest desert tundra
const MAX_UPKEEP_SHARE = 0.33;
const ROLE_SHARE = { line: 0.65, support: 0.2, mobile: 0.15 };

function inPolygon(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function matches(rule, i) {
  if (rule.iso && !rule.iso.includes(map.iso[i])) return false;
  if (rule.box) { const [a, b, c, d] = rule.box; if (map.lon[i] < a || map.lat[i] < b || map.lon[i] > c || map.lat[i] > d) return false; }
  if (rule.polygon && !inPolygon(map.lon[i], map.lat[i], rule.polygon)) return false;
  if (rule.names && !rule.names.includes(map.name[i])) return false;
  if (rule.ids && !rule.ids.includes(i)) return false;
  if (rule.exclude && rule.exclude.some((x) => matches(x, i))) return false;
  return true;
}

function regionOf(c) {
  const out = [];
  for (const i of map.ids) if ((c.regions || []).some((r) => matches(r, i))) out.push(i);
  return out;
}

const dist2 = (i, lat, lon) => (map.lat[i] - lat) ** 2 + ((map.lon[i] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;

// The newest unit of each role a country knows at its technology year.
function unitsFor(year) {
  const best = {};
  for (const [id, u] of Object.entries(units)) {
    if (id.startsWith('_')) continue;
    const y = u.tech ? techYear[u.tech] : -1e9;
    if (y == null || y > year) continue;
    const role = u.role || 'line';
    if (!best[role] || y > best[role].y) best[role] = { id, y, men: u.men || 10000 };
  }
  return best;
}

function build(def) {
  const errs = [];
  const tags = new Set();
  for (const c of def.countries) {
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(c.tag)) errs.push(`bad tag ${c.tag}`);
    if (tags.has(c.tag)) errs.push(`duplicate tag ${c.tag}`);
    tags.add(c.tag);
  }
  const owner = new Map(), releases = {};
  for (const c of def.countries) {
    const ps = regionOf(c);
    if (!ps.length) errs.push(`${c.tag}: regions match no province`);
    if (c.dormant) releases[c.tag] = ps;
    else for (const i of ps) owner.set(i, c.tag);
  }
  const provs = Object.fromEntries(def.countries.map((c) => [c.tag, []]));
  for (const [i, t] of owner) provs[t].push(i);
  const startYear = +def.startDate.slice(0, def.startDate.lastIndexOf('-', def.startDate.length - 4));

  const countries = [], provinces = {}, armies = [];
  for (const c of def.countries) {
    const ps = provs[c.tag].sort((a, b) => a - b);
    const rec = {
      tag: c.tag, name: c.name, color: c.color, gov: c.gov, capital: -1,
      aggression: c.aggression ?? 0.3, stability: c.stability ?? 60, flag: c.flag || null,
      techLag: c.techLag || 0,
    };
    if (c.techYear != null) rec.techYear = c.techYear;
    if (c.policies) rec.policies = c.policies;
    if (c.dormant) rec.dormant = true;
    countries.push(rec);
    if (c.dormant) continue;
    if (!ps.length) { errs.push(`${c.tag}: owns no provinces (later countries took them all)`); continue; }
    const [clat, clon] = c.capital || [map.lat[ps[0]], map.lon[ps[0]]];
    const cap = ps.reduce((b, i) => (dist2(i, clat, clon) < dist2(b, clat, clon) ? i : b), ps[0]);
    rec.capital = cap;
    // population follows today's distribution, flattened (cities grew fastest)
    const w = ps.map((i) => Math.max(2000, modern.provinces[i]?.[1] || map.area[i] * 5) ** 0.7);
    const tw = w.reduce((a, b) => a + b, 0);
    const pop = Math.max(0.005, c.pop) * 1e6, gdp = Math.max(0.001, c.gdp) * 1e9 * GDP_SCALE;
    const pcDev = Math.log(Math.max(450, gdp / pop) / DEV_BASE) / Math.log(DEV_GROWTH);
    const pops = ps.map((i, n) => (pop * w[n]) / tw);
    const devs = ps.map((i) => pcDev + (i === cap ? 6 : 0) + (map.coastal[i] ? 2 : 0) + TERRAIN_DEV[map.terrain[i]]);
    const actual = ps.reduce((s, i, n) => s + pops[n] * DEV_BASE * DEV_GROWTH ** devs[n], 0);
    const shift = Math.log(gdp / actual) / Math.log(DEV_GROWTH);
    ps.forEach((i, n) => {
      const dev = Math.max(1, Math.min(100, devs[n] + shift));
      provinces[i] = [c.tag, Math.round(pops[n]), +dev.toFixed(2), i === cap ? 3 : map.terrain[i] === 2 ? 1 : 0];
    });
    // starting forces: armyK thousand men split across the roles the country can field
    const men = (c.armyK || 0) * 1000;
    if (men > 0) {
      const best = unitsFor((c.techYear ?? def.techYear ?? startYear) - (c.techLag || 0));
      const u = {};
      let shareLeft = 0;
      for (const [role, share] of Object.entries(ROLE_SHARE)) if (!best[role]) shareLeft += share;
      for (const [role, share] of Object.entries(ROLE_SHARE)) {
        const b = best[role];
        if (!b) continue;
        const s = role === 'line' ? share + shareLeft : share;
        const n = Math.round((men * s) / b.men);
        if (n > 0) u[b.id] = n;
      }
      // the game's upkeep is paid from taxes: peacetime forces are capped at a third of a
      // typical revenue, so states with huge historical armies still have budgets that balance
      const upkeep = Object.entries(u).reduce((t, [id, n]) => t + n * units[id].upkeep, 0);
      const cap = (MAX_UPKEEP_SHARE * (gdp / 1e9) * 0.22 * 0.85) / 12;
      if (upkeep > cap) for (const id in u) u[id] = Math.floor((u[id] * cap) / upkeep);
      for (const id in u) if (!u[id]) delete u[id];
      if (!Object.keys(u).length && best.line) u[best.line.id] = 1;
      const total = Object.values(u).reduce((a, b) => a + b, 0);
      const sites = [cap, ...ps.filter((i) => i !== cap).sort((a, b) => provinces[b][1] - provinces[a][1])];
      const stacks = Math.max(1, Math.min(sites.length, 12, Math.ceil(total / 10)));
      for (let s = 0; s < stacks; s++) {
        const part = {};
        for (const [id, n] of Object.entries(u)) { const k = Math.floor(n / stacks) + (s < n % stacks ? 1 : 0); if (k) part[id] = k; }
        if (Object.keys(part).length) armies.push({ owner: c.tag, province: sites[s], units: part });
      }
    }
  }
  const known = (t) => tags.has(t) || (errs.push(`unknown tag ${t}`), false);
  const treaties = [
    ...(def.subjects || []).filter(([a, b]) => known(a) && known(b)).map(([a, b]) => ({ type: 'subject', a, b })),
    ...(def.treaties || []).filter((t) => known(t.a) && known(t.b)),
  ];
  const blocs = (def.blocs || []).map((b) => ({ name: b.name, kind: b.kind || 'defense', members: b.members.filter(known) }));
  const rivals = (def.rivals || []).filter(([a, b]) => known(a) && known(b));
  const wars = (def.wars || []).map((w) => ({ ...w, attackers: w.attackers.filter(known), defenders: w.defenders.filter(known) }));
  if (errs.length) throw new Error(`${def.id}:\n  ${errs.join('\n  ')}`);
  const scen = {
    id: def.id, name: def.name, era: def.era, startDate: def.startDate, techYear: def.techYear ?? startYear,
    description: def.description, approximations: def.approximations, autoBudget: true,
    countries, provinces: Object.fromEntries(Object.entries(provinces).sort((a, b) => a[0] - b[0])), armies,
    diplomacy: { note: 'Generated by tools/build_history.mjs from tools/history/' + def.id + '.json.', blocs, treaties, rivals },
    wars, releases,
  };
  const owned = Object.keys(provinces).length;
  console.log(`${def.id}: ${countries.length} countries (${countries.filter((c) => c.dormant).length} dormant), ${owned} of ${map.ids.length} provinces owned, ${armies.length} armies`);
  return scen;
}

const dir = new URL('tools/history/', ROOT);
const argv = process.argv.slice(2), economy = argv.includes('--economy'), named = argv.filter((a) => !a.startsWith('--'));
const ids = named.length ? named : fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const indexPath = new URL('data/scenarios/index.json', ROOT);
const index = JSON.parse(fs.readFileSync(indexPath));
for (const id of ids) {
  const def = JSON.parse(fs.readFileSync(new URL(`${id}.json`, dir)));
  const scen = build(def);
  fs.writeFileSync(new URL(`data/scenarios/${scen.id}.json`, ROOT), JSON.stringify(scen));
  const entry = { id: scen.id, file: `${scen.id}.json`, name: scen.name, era: scen.era, startDate: scen.startDate, description: scen.description, approximations: scen.approximations };
  const k = index.scenarios.findIndex((s) => s.id === scen.id);
  if (k >= 0) index.scenarios[k] = entry; else index.scenarios.push(entry);
}
index.scenarios.sort((a, b) => (b.id === 'modern_2026') - (a.id === 'modern_2026') || a.startDate.localeCompare(b.startDate));
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
if (economy) for (const id of ids) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('build_economy.mjs', import.meta.url)), id, '--deposits-from=modern_2026'], { stdio: 'inherit' });
  if (r.status) process.exit(r.status);
}
