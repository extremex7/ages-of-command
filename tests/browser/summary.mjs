// Achievements and the game summary.
// Usage: node tests/browser/summary.mjs [baseUrl]   (requires the dev server and Playwright)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://localhost:8080/';
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(base);
await page.evaluate(() => { localStorage.clear(); });
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'POL')); c.state.settings.eventRate = 0; });
check(await page.evaluate(() => window.__client.state.record?.tag) === 'POL', 'record started for the player');
// an achievement as it happens: toast, and kept on this device
await page.evaluate(() => { const c = window.__client; c.state.countries[c.state.player].stability = 95; for (let i = 0; i < 35; i++) c.doTick(); c.afterTicks(); });
await page.waitForTimeout(200);
check(await page.locator('.toast', { hasText: 'Achievement: Content people' }).count() === 1, 'achievement toast');
check(await page.evaluate(() => JSON.parse(localStorage.getItem('aoc3.achievements') || '{}').content?.country) === 'Poland', 'achievement saved on this device');
// a year on, the summary has a rank chart and the headline
await page.evaluate(() => { const c = window.__client; for (let i = 0; i < 380; i++) c.doTick(); c.afterTicks(); c.state.record.start.rank += 20; });
await page.click('button[aria-label="Menu"]');
await page.click('.dialog button:has-text("Summary")');
await page.waitForSelector('.rank-chart');
const head = await page.locator('.headline').textContent();
check(/Poland rose from #\d+ to #\d+/.test(head), `headline: ${head}`);
check(await page.locator('.rank-chart polyline').count() === 1, 'rank chart drawn');
check(await page.locator('.dialog .ach.got').count() >= 1, 'achievements of this game listed');
await page.screenshot({ path: '/tmp/claude-0/np/summary.png' });
await page.keyboard.press('Escape');
// game over opens the summary at the end
await page.evaluate(() => { const c = window.__client; c.state.gameOver = { day: c.state.day, reason: 'test' }; c.doTick(); c.afterTicks(); });
await page.waitForTimeout(200);
check(await page.locator('.dialog', { hasText: 'The end of your story' }).count() === 1, 'summary at game over');
await page.click('.dialog button:has-text("Main menu")');
await page.click('text=Achievements');
const got = await page.locator('.ach.got').count();
check(got >= 1, `main menu achievements list (${got} earned)`);
await browser.close();
if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
console.log('\nall summary checks passed');
