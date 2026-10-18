// End-to-end check in headless Chromium: boots the game, starts a campaign, recruits,
// moves an army, runs time, saves and reloads. Writes screenshots to build/screens/.
// Usage: node tests/browser/e2e.mjs [baseUrl]   (requires the dev server and Playwright)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://localhost:8080/';
const out = new URL('../../build/screens/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const t0 = Date.now();
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
const bootMs = Date.now() - t0;
await page.screenshot({ path: out + '01-menu.png' });
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.waitForTimeout(400);
await page.screenshot({ path: out + '02-pick.png' });
// choose France from the list
await page.fill('.panel input', 'France');
await page.click('.panel tr.click >> text=France');
await page.waitForSelector('text=Play as France');
await page.click('text=Play as France');
await page.waitForTimeout(500);
await page.screenshot({ path: out + '03-play.png' });
const r = await page.evaluate(() => {
  const c = window.__client, s = c.state;
  return { player: s.countries[s.player].name, armies: s.armies.filter((a) => a.owner === s.player).length, day: s.day };
});
console.log('playing', r);
// recruit infantry via the military tab
await page.keyboard.press('m');
await page.waitForTimeout(200);
await page.locator('.panel table.t button').first().click();
const queued = await page.evaluate(() => window.__client.state.recruit.filter((x) => x.owner === window.__client.state.player).length);
console.log('queued recruits', queued);
// select first army and order it to move to a neighbouring province via the client API
const moved = await page.evaluate(() => {
  const c = window.__client, s = c.state, map = c.game.map;
  const a = s.armies.find((x) => x.owner === s.player);
  let target = -1;
  for (let e = map.adjStart[a.loc]; e < map.adjStart[a.loc + 1]; e++) { const v = map.adj[e]; if (s.prov.owner[v] === s.player) { target = v; break; } }
  c.view.selectedArmies.add(a.id);
  const [sx, sy] = c.renderer.worldToScreen(map.x[target], map.y[target]);
  return { id: a.id, from: a.loc, target, sx, sy };
});
await page.mouse.click(moved.sx, moved.sy + 0, { button: 'right' });
const pathLen = await page.evaluate((id) => window.__client.state.armies.find((a) => a.id === id).path.length, moved.id);
console.log('move order path length', pathLen);
// run time at max speed for a few seconds
await page.keyboard.press('5');
await page.waitForTimeout(4000);
await page.keyboard.press(' ');
const after = await page.evaluate((id) => {
  const c = window.__client, s = c.state;
  const a = s.armies.find((x) => x.id === id);
  return { day: s.day, loc: a?.loc, treasury: s.countries[s.player].treasury, ticks: c.perf.ticks, tickMs: c.perf.tickMs, frame: c.perf.frameTimes.slice(-30), base: c.renderer.stats };
}, moved.id);
console.log('after run: days advanced', after.day - r.day, 'army at', after.loc, 'target', moved.target, 'tick ms', after.tickMs.toFixed(2), 'base render ms', after.base.baseMs.toFixed(1));
await page.screenshot({ path: out + '04-after.png' });
// map modes + zoom
for (const k of ['t', 'o', 'v', 'g', 'r', 'y', 'p']) { await page.keyboard.press(k); await page.waitForTimeout(150); }
await page.mouse.move(683, 400);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
await page.waitForTimeout(400);
await page.screenshot({ path: out + '05-zoom.png' });
// save and reload through the UI storage
await page.keyboard.press('Control+s');
await page.waitForTimeout(200);
const saved = await page.evaluate(() => localStorage.getItem('aoc3.save.quicksave')?.length || 0);
console.log('quicksave bytes', saved);
await page.click('text=Menu');
await page.click('text=Exit to main menu');
await page.click('text=Load Game');
await page.click('.list .item >> text=Load');
await page.waitForTimeout(600);
const loaded = await page.evaluate(() => ({ day: window.__client.state.day, player: window.__client.state.player }));
console.log('loaded', loaded, 'matches saved day', loaded.day === after.day);
await page.screenshot({ path: out + '06-loaded.png' });
const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
console.log('boot ms', bootMs, 'JS heap MB', mem);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
