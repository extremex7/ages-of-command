// Adds starting navies, air forces and strategic capabilities to a scenario from its forces
// table, tools/forces/<scenario>.csv (real counts of ships, aircraft, warheads, launchers and
// satellites per country; format: tools/forces/README.md).
//
// Each count becomes units of the newest type of that role the country knows at its technology
// year (a unit stands for `group` ships or aircraft, see data/rules/units.json). Fleets dock in
// the country's largest ports, ballistic missile submarines go to sea, air wings sit at the
// capital and the largest cities. Naval and air upkeep is capped at a share of a typical tax
// revenue, as tools/build_history.mjs does for armies.
//
// Usage: node tools/build_forces.mjs [id ...]   (no ids: every table in tools/forces)
import fs from 'node:fs';
import { decodeMap } from '../src/core/game.js';
import { portZonesOf } from '../src/core/mapdata.js';

const ROOT = new URL('../', import.meta.url);
const rd = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT)));
const map = decodeMap(rd('data/map/world.json'), rd('data/map/seas.json'));
const units = Object.fromEntries(Object.entries(rd('data/rules/units.json')).filter(([k]) => !k.startsWith('_')));
const techs = rd('data/rules/technologies.json').techs;

const MAX_SHARE = 0.15; // naval + air upkeep, as a share of a typical monthly tax revenue
const COLS = {
  carriers: ['sea', 'carrier'], capital: ['sea', 'capital'], screens: ['sea', 'screen'], subs: ['sea', 'sub'],
  nsubs: ['sea', 'nsub'], ssbns: ['sea', 'ssbn'], fighters: ['air', 'fighter'], bombers: ['air', 'bomber'],
  attack: ['air', 'attack'], drones: ['air', 'drone'],
};
const SAT_SPLIT = { recon: 0.4, comms: 0.3, nav: 0.15, warning: 0.15 };
const SAT_TECH = { recon: 'satellites', comms: 'satellites', nav: 'gps', warning: 'satellites' };

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const v = l.split(',');
    const row = {};
    head.forEach((h, k) => { row[h] = h === 'tag' || h === 'note' ? v[k] : +(v[k] || 0); });
    return row;
  });
}

// Technologies known at a year, with prerequisites (fictional ones only in fictional scenarios).
function knownAt(year, fictional, extra = []) {
  const known = new Set();
  const add = (id) => { if (known.has(id) || !techs[id]) return; known.add(id); for (const r of techs[id].req || []) add(r); };
  for (const [id, t] of Object.entries(techs)) if ((!t.fictional || fictional) && t.year <= year) add(id);
  for (const id of extra) add(id);
  return known;
}

function newestUnit(known, domain, role) {
  let best = null, by = -Infinity;
  for (const [id, u] of Object.entries(units)) {
    if ((u.domain || 'land') !== domain || u.role !== role) continue;
    if (u.tech && !known.has(u.tech)) continue;
    const y = u.tech ? techs[u.tech].year : -1e9;
    if (y > by) { by = y; best = id; }
  }
  return best;
}

function build(id) {
  const path = new URL(`data/scenarios/${id}.json`, ROOT);
  const scen = JSON.parse(fs.readFileSync(path));
  const rows = parseCsv(fs.readFileSync(new URL(`tools/forces/${id}.csv`, ROOT), 'utf8'));
  const startYear = +scen.startDate.slice(0, scen.startDate.lastIndexOf('-', scen.startDate.length - 4));
  const byTag = new Map(scen.countries.map((c) => [c.tag, c]));
  const provs = new Map();
  for (const [i, rec] of Object.entries(scen.provinces)) {
    if (!rec[0]) continue;
    if (!provs.has(rec[0])) provs.set(rec[0], []);
    provs.get(rec[0]).push(+i);
  }
  const fleets = [], wings = [], errs = [];
  const summary = { countries: 0, ships: 0, wings: 0, warheads: 0 };
  for (const c of scen.countries) { delete c.warheads; delete c.icbm; delete c.sats; }
  for (const row of rows) {
    const c = byTag.get(row.tag);
    if (!c) { errs.push(`unknown tag ${row.tag}`); continue; }
    if (c.dormant) continue;
    const ps = provs.get(row.tag) || [];
    if (!ps.length) continue;
    const year = (c.techYear ?? scen.techYear ?? startYear) - (c.techLag || 0);
    const known = knownAt(year, !!scen.fictional, c.techs || []);
    // units per column
    const want = {};
    for (const [col, [domain, role]] of Object.entries(COLS)) {
      const n = row[col] || 0;
      if (!n) continue;
      const u = newestUnit(known, domain, role);
      if (!u) continue;
      const g = units[u].group || 1;
      const k = Math.round(n / g) || (n >= g / 2 ? 1 : 0);
      if (k) want[u] = (want[u] || 0) + k;
    }
    // upkeep cap
    const gdp = ps.reduce((s, i) => s + (scen.provinces[i][1] * 400 * 1.06 ** scen.provinces[i][2]) / 1e9, 0);
    const cap = (MAX_SHARE * gdp * 0.22 * 0.85) / 12;
    const up = Object.entries(want).reduce((s, [u, n]) => s + n * units[u].upkeep, 0);
    if (up > cap) for (const u in want) want[u] = Math.max(units[u].domain === 'sea' && ['carrier', 'ssbn'].includes(units[u].role) ? 1 : 0, Math.floor((want[u] * cap) / up));
    for (const u in want) if (!want[u]) delete want[u];
    // ports: coastal provinces by size, preferring different sea zones
    const value = (i) => scen.provinces[i][1] * (1 + scen.provinces[i][2] / 50);
    const ports = ps.filter((i) => portZonesOf(map, i).length).sort((a, b) => value(b) - value(a));
    const sites = [];
    for (const p of ports) { if (sites.length >= 3) break; if (!sites.some((q) => portZonesOf(map, q)[0] === portZonesOf(map, p)[0])) sites.push(p); }
    const sea = Object.entries(want).filter(([u]) => units[u].domain === 'sea');
    if (sea.length && sites.length) {
      const surface = sea.filter(([u]) => units[u].role !== 'ssbn');
      const share = sites.length === 1 ? [1] : sites.length === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
      const parts = sites.map(() => ({}));
      for (const [u, n] of surface) {
        let left = n;
        share.forEach((sh, k) => { const m = k === share.length - 1 ? left : Math.round(n * sh); if (m > 0) { parts[k][u] = m; left -= m; } });
      }
      parts.forEach((p, k) => { if (Object.keys(p).length) fleets.push({ owner: row.tag, port: sites[k], units: p }); });
      const ssbn = sea.filter(([u]) => units[u].role === 'ssbn');
      if (ssbn.length) fleets.push({ owner: row.tag, zone: portZonesOf(map, sites[0])[0], units: Object.fromEntries(ssbn), name: 'Deterrent Patrol' });
      summary.ships += sea.reduce((s, [u, n]) => s + n * (units[u].group || 1), 0);
    }
    // air bases: capital and the largest cities; 6 units per wing, larger wings for very large air
    // forces so no country starts with more than about 6 wings of a type (keeps the daily air pass cheap)
    const air = Object.entries(want).filter(([u]) => units[u].domain === 'air');
    if (air.length) {
      const bases = [c.capital >= 0 && scen.provinces[c.capital]?.[0] === row.tag ? c.capital : null, ...ps.slice().sort((a, b) => value(b) - value(a))].filter((x) => x != null);
      const uniq = [...new Set(bases)].slice(0, 4);
      let b = 0;
      for (const [u, n] of air) {
        const size = Math.max(6, Math.ceil(n / 6));
        for (let left = n; left > 0; left -= size) {
          const k = Math.min(size, left);
          const role = units[u].role;
          wings.push({ owner: row.tag, base: uniq[b++ % uniq.length], units: { [u]: k }, mission: role === 'fighter' ? 'superiority' : role === 'bomber' ? 'idle' : 'support' });
          summary.wings++;
        }
      }
    }
    // strategic capabilities
    if (row.warheads && known.has('atomic_bomb')) { c.warheads = row.warheads; summary.warheads += row.warheads; }
    if (row.icbms && known.has('icbm')) c.icbm = row.icbms;
    if (row.satellites && known.has('satellites')) {
      const s = {};
      let left = row.satellites;
      for (const [k, sh] of Object.entries(SAT_SPLIT)) {
        if (!known.has(SAT_TECH[k])) continue;
        const n = Math.min(left, Math.max(k === 'recon' ? 1 : 0, Math.round(row.satellites * sh)));
        if (n) { s[k] = n; left -= n; }
      }
      if (left > 0) s.recon = (s.recon || 0) + left;
      c.sats = s;
    }
    if (row.stations) c.stations = row.stations;
    if (row.colonies) c.colonies = row.colonies;
    summary.countries++;
  }
  if (errs.length) throw new Error(`${id}:\n  ${errs.join('\n  ')}`);
  scen.fleets = fleets;
  scen.wings = wings;
  fs.writeFileSync(path, JSON.stringify(scen));
  console.log(`${id}: forces for ${summary.countries} countries: ${fleets.length} fleets (${summary.ships} ships), ${summary.wings} air wings, ${summary.warheads} warheads`);
}

const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ids = named.length ? named : fs.readdirSync(new URL('tools/forces/', ROOT)).filter((f) => f.endsWith('.csv')).map((f) => f.slice(0, -4));
for (const id of ids) build(id);
