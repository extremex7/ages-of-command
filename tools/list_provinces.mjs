// Lists map provinces for scenario authoring: id, ISO country, name, centroid lon/lat, area and
// modern population (from the Modern World scenario).
// Usage: node tools/list_provinces.mjs DEU POL ...   (no arguments: one line per ISO code with counts)
import fs from 'node:fs';
const ROOT = new URL('../', import.meta.url);
const w = JSON.parse(fs.readFileSync(new URL('data/map/world.json', ROOT)));
const modern = JSON.parse(fs.readFileSync(new URL('data/scenarios/modern_2026.json', ROOT)));
const isos = process.argv.slice(2);
if (!isos.length) {
  const by = {};
  for (const p of w.provinces) (by[p.iso] ||= []).push(p);
  const names = Object.fromEntries(w.countries.map((c) => [c.iso, c.name]));
  for (const [iso, ps] of Object.entries(by).sort()) console.log(`${iso}\t${ps.length}\t${names[iso] || ''}`);
} else {
  for (const p of w.provinces) if (isos.includes(p.iso)) {
    const m = modern.provinces[p.id];
    console.log(`${p.id}\t${p.iso}\t${p.name}\tlon ${p.lon}\tlat ${p.lat}\tarea ${p.area}\tpop ${m ? Math.round(m[1] / 1000) + 'k' : '-'}`);
  }
}
