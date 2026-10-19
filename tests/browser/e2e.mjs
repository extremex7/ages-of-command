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
while (await page.locator('.dialog .menu-buttons button').count()) { await page.locator('.dialog .menu-buttons button').first().click(); await page.waitForTimeout(100); }
await page.evaluate(() => window.__client.setSpeed(0)); // the game resumes after event decisions; these steps need it paused
// economy: industry tab, build in the capital, economy tab, embargo, economic map modes
await page.keyboard.press('u');
await page.waitForTimeout(200);
await page.screenshot({ path: out + '07-industry.png' });
const before = await page.evaluate(() => { const c = window.__client, s = c.state; c.focusProvince(s.countries[s.player].capital); return s.construction.filter((p) => p.owner === s.player).length; });
await page.waitForTimeout(300);
await page.locator('.prov-panel .build-grid button:not([disabled])').first().click();
const built = await page.evaluate(() => { const s = window.__client.state; return s.construction.filter((p) => p.owner === s.player).map((p) => p.kind + ':' + p.b); });
console.log('construction queue', before, '->', built.length, built.slice(-1));
if (built.length !== before + 1) errors.push('build button did not queue a project');
await page.screenshot({ path: out + '08-province-build.png' });
await page.keyboard.press('e');
await page.waitForTimeout(200);
await page.screenshot({ path: out + '09-economy.png' });
const emb = await page.evaluate(() => {
  const c = window.__client, s = c.state;
  c.view.selectedCountry = s.countries.findIndex((x) => x.tag === 'DEU'); c.setTab('country');
  return true;
});
await page.waitForTimeout(200);
await page.click('.panel button:has-text("Embargo")');
const embargoed = await page.evaluate(() => { const s = window.__client.state; return s.countries[s.player].econ.embargo.map((k) => s.countries[k].tag); });
console.log('embargoes', embargoed);
if (!embargoed.includes('DEU')) errors.push('embargo button did not work');
for (const [k, n] of [['x', '10-resources'], ['k', '11-industry'], ['f', '12-infrastructure']]) { await page.keyboard.press(k); await page.waitForTimeout(300); await page.screenshot({ path: out + n + '.png' }); }
// politics and diplomacy: government tab, a policy change, diplomacy tab, relations, map modes, events
await page.evaluate(() => { const c = window.__client; c.view.selectedCountry = -1; c.setTab('government'); });
await page.waitForTimeout(200);
await page.screenshot({ path: out + '13-government.png' });
const pol = await page.evaluate(() => { const s = window.__client.state; return JSON.stringify(s.countries[s.player].govt.policies); });
await page.locator('.panel .row button:not(.on):not([disabled])').first().click();
const pol2 = await page.evaluate(() => { const s = window.__client.state; return JSON.stringify(s.countries[s.player].govt.policies); });
console.log('policy changed', pol !== pol2);
if (pol === pol2) errors.push('policy button did not change a policy');
await page.keyboard.press('d');
await page.waitForTimeout(200);
await page.screenshot({ path: out + '14-diplomacy.png' });
await page.evaluate(() => { const c = window.__client, s = c.state; c.view.selectedCountry = s.countries.findIndex((x) => x.tag === 'ITA'); c.setTab('country'); });
await page.waitForTimeout(200);
await page.screenshot({ path: out + '15-relations.png' });
const imp = page.locator('.panel button:has-text("Improve relations")');
if (await imp.count()) { const dis = await imp.first().isDisabled(); if (!dis) await imp.first().click(); }
const boosts = await page.evaluate(() => window.__client.state.dip.mods.filter((m) => m.why === 'Improved relations').length);
console.log('improve-relations modifiers', boosts);
for (const [k, n] of [['y', '16-diplomacy-map'], ['j', '17-government-map']]) { await page.keyboard.press(k); await page.waitForTimeout(300); await page.screenshot({ path: out + n + '.png' }); }
const evOk = await page.evaluate(() => {
  const c = window.__client, s = c.state, R = c.game.rules;
  const ev = R.events.find((e) => e.options?.length > 1) || R.events[0];
  s.pendingEvents.push({ id: s.nextId++, ev: ev.id, c: s.player, day: s.day, title: ev.title, text: ev.text });
  c.openEvent(s.pendingEvents[s.pendingEvents.length - 1]);
  return ev.id;
});
await page.waitForTimeout(300);
await page.screenshot({ path: out + '18-event.png' });
console.log('event dialog for', evOk, 'open', await page.locator('.dialog').count());
await page.locator('.dialog .menu-buttons button').first().click();
const pend = await page.evaluate(() => window.__client.state.pendingEvents.length);
console.log('pending events after choosing', pend);
// research: Research tab, queue a technology, technology tree, technology map mode
await page.evaluate(() => { const c = window.__client; c.view.selectedCountry = -1; c.setTab('research'); });
await page.waitForTimeout(200);
await page.screenshot({ path: out + '20-research.png' });
const q0 = await page.evaluate(() => { const s = window.__client.state; const r = s.countries[s.player].research; return (r.current ? 1 : 0) + r.queue.length; });
await page.locator('.panel button:has-text("Start")').first().click();
const q1 = await page.evaluate(() => { const s = window.__client.state; return s.countries[s.player].research.current; });
console.log('research project', q1, '(projects before:', q0 + ')');
if (!q1) errors.push('research Start button did not set a project');
await page.click('.panel button:has-text("Technology tree")');
await page.waitForTimeout(300);
await page.screenshot({ path: out + '21-tech-tree.png' });
if (!(await page.locator('.dialog .tt-node').count())) errors.push('technology tree is empty');
await page.keyboard.press('Escape');
await page.keyboard.press('q'); await page.waitForTimeout(300); await page.screenshot({ path: out + '22-technology-map.png' });
// declare-war dialog shows joiners and consequences (cancelled)
await page.evaluate(() => { const c = window.__client, s = c.state; c.view.selectedCountry = s.countries.findIndex((x) => x.tag === 'ESP'); c.setTab('country'); });
await page.waitForTimeout(150);
const dw = page.locator('.panel button:has-text("Declare war")');
if (await dw.count() && !(await dw.first().isDisabled())) { await dw.first().click(); await page.waitForTimeout(200); await page.screenshot({ path: out + '19-declare.png' }); await page.keyboard.press('Escape'); }
// map modes + zoom
for (const k of ['t', 'o', 'v', 'g', 'r', 'y', 'j', 'p']) { await page.keyboard.press(k); await page.waitForTimeout(150); }
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
// a historical scenario: 1914, play as Germany, check era units and run a month
await page.click('text=Menu');
await page.click('text=Exit to main menu');
await page.click('text=New Game');
await page.click('.list .item:has-text("Great War")');
await page.waitForTimeout(150);
await page.screenshot({ path: out + '23-new-game-1914.png' });
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
const h1914 = await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'GER')); c.setTab('military'); const s = c.state; return { era: c.game.rules.tech.eras[s.countries[s.player].tfx.era].id, units: [...new Set(s.armies.filter((a) => a.owner === s.player).flatMap((a) => Object.keys(a.units)))] }; });
console.log('1914 Germany', h1914);
if (h1914.era !== 'great_war' || h1914.units.includes('armor')) errors.push('1914 starts with the wrong era or units');
await page.waitForTimeout(300);
await page.screenshot({ path: out + '24-military-1914.png' });
await page.evaluate(() => { const s = window.__client.state; s.countries[s.player].automate = true; });
await page.keyboard.press('5'); await page.waitForTimeout(3000); await page.keyboard.press(' ');
while (await page.locator('.dialog .menu-buttons button').count()) { await page.locator('.dialog .menu-buttons button').first().click(); await page.waitForTimeout(100); }
await page.evaluate(() => window.__client.setSpeed(0)); // the game resumes after event decisions; these steps need it paused
await page.keyboard.press('p'); await page.waitForTimeout(300);
await page.screenshot({ path: out + '25-1914-running.png' });
console.log('1914 fired', await page.evaluate(() => Object.keys(window.__client.state.fired).join(' ')));
const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
console.log('boot ms', bootMs, 'JS heap MB', mem);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
