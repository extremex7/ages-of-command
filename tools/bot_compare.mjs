// Measures the bot (src/bot/autoplay.js) against the default AI: the same country, scenario and
// seed, played Y years once by the ordinary AI (nobody is the player) and once by the bot as
// the player, under one or more bot profiles. Prints GDP, provinces, population, score, rank and
// technologies at the end, and each profile's average ratio to the default AI.
// Usage: node tools/bot_compare.mjs <scenario> <TAG,TAG,...> [years=15] [seeds=2] [profiles=bot,ai] [first seed=1]
// Profiles: ai (no player: the default AI), auto (automated with the game's settings, no wars
// started), bot (BOT_PROFILE and BOT_EXTRAS), and the variants listed in PROFILES below.
// Runs up to one game per CPU core at a time.
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newGame } from '../src/core/game.js';
import { loadRules, loadMap, readJson } from './load_rules.mjs';
import { tick } from '../src/core/sim.js';
import { Autoplay, BOT_PROFILE } from '../src/bot/autoplay.js';

const PROFILES = {
  auto: { profile: null, extras: { formNations: false } }, // automate with the game's settings
  peace: { profile: { ...BOT_PROFILE, war: false } }, // the bot without starting wars
  bot: { profile: BOT_PROFILE },
  normal: { profile: { ...BOT_PROFILE, difficulty: 'normal' } },
  calm: { profile: { ...BOT_PROFILE, aggression: 1 } },
  max: { profile: { ...BOT_PROFILE, aggression: 2 } },
};

function one(scenarioId, tag, years, seed, prof) {
  const map = loadMap(), rules = loadRules(), scenario = readJson(`data/scenarios/${scenarioId}.json`);
  const g = newGame({ map, scenario, rules, playerTag: prof === 'ai' ? null : tag, seed });
  const k = g.state.countries.findIndex((c) => c.tag === tag);
  const days = Math.round(years * 365.25);
  if (prof === 'ai') for (let d = 0; d < days; d++) tick(g);
  else {
    const P = PROFILES[prof];
    const b = new Autoplay(g, { years, profile: P.profile, extras: P.extras }).start();
    while (!b.step(100000).done);
  }
  const s = g.state, c = s.countries[k];
  return { tag, seed, prof, alive: c.alive, gdp: c.cache.gdp, prov: c.cache.provinces, pop: c.cache.pop, score: s.prestige.score[k], rank: s.prestige.rank[k], techs: c.tfx?.known || 0, wars: s.reports.length };
}

const argv = process.argv.slice(2);
if (argv[0] === '--one') {
  const [, sc, tag, years, seed, prof] = argv;
  process.stdout.write(JSON.stringify(one(sc, tag, +years, seed, prof)));
} else {
  const [sc = 'modern_2026', tags = 'FRA', years = '15', nSeeds = '2', profs = 'bot,ai', first = '1'] = argv;
  const jobs = [];
  for (const tag of tags.split(',')) for (let i = 0; i < +nSeeds; i++) for (const p of profs.split(',')) jobs.push([sc, tag, years, `cmp-${i + +first}`, p]);
  const self = fileURLToPath(import.meta.url), out = [];
  let next = 0;
  const worker = () => new Promise((done) => {
    const go = () => {
      if (next >= jobs.length) return done();
      const j = jobs[next++];
      let buf = '';
      const ch = spawn(process.execPath, [self, '--one', ...j]);
      ch.stdout.on('data', (d) => (buf += d));
      ch.stderr.on('data', (d) => process.stderr.write(d));
      ch.on('close', () => { try { out.push(JSON.parse(buf)); } catch { console.error('failed:', j.join(' ')); } go(); });
    };
    go();
  });
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length, jobs.length)) }, worker));
  const f = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
  console.log(`${sc}, ${years} years, ${nSeeds} seed(s), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log('tag   seed   profile  alive  GDP(B)   prov  pop(M)  score  rank  techs');
  out.sort((a, b) => a.tag.localeCompare(b.tag) || a.seed.localeCompare(b.seed) || a.prof.localeCompare(b.prof));
  for (const r of out) console.log(`${r.tag.padEnd(5)} ${r.seed.padEnd(6)} ${r.prof.padEnd(8)} ${String(r.alive).padEnd(6)} ${f(r.gdp).padStart(7)} ${String(r.prov).padStart(5)} ${f(r.pop / 1e6).padStart(7)} ${f(r.score).padStart(6)} ${String(r.rank).padStart(5)} ${String(r.techs).padStart(6)}`);
  // each profile against the default AI, same tag and seed (geometric mean of the ratios)
  const base = new Map(out.filter((r) => r.prof === 'ai').map((r) => [r.tag + r.seed, r]));
  for (const p of profs.split(',').filter((x) => x !== 'ai')) {
    const pairs = out.filter((r) => r.prof === p && base.has(r.tag + r.seed)).map((r) => [r, base.get(r.tag + r.seed)]);
    if (!pairs.length) continue;
    const gm = (fn) => Math.exp(pairs.reduce((s, [a, b]) => s + Math.log(Math.max(1e-6, fn(a)) / Math.max(1e-6, fn(b))), 0) / pairs.length);
    const better = (fn) => pairs.filter(([a, b]) => fn(a) > fn(b)).length;
    console.log(`${p} vs ai (${pairs.length} pairs): GDP ×${gm((r) => r.gdp).toFixed(3)}, provinces ×${gm((r) => r.prov).toFixed(3)}, population ×${gm((r) => r.pop).toFixed(3)}, score ×${gm((r) => r.score).toFixed(3)} (higher in ${better((r) => r.score)}), rank ${pairs.reduce((s, [a, b]) => s + (b.rank - a.rank), 0) / pairs.length >= 0 ? '+' : ''}${(pairs.reduce((s, [a, b]) => s + (b.rank - a.rank), 0) / pairs.length).toFixed(1)} places`);
  }
}
