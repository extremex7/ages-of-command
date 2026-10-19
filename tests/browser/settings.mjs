// Settings: the main-menu settings screen and the in-game settings dialog apply each setting
// at once (interface scale, graphics quality, map resolution, frame rate limit, tooltips) and keep
// them after a reload. Writes build/screens/settings-*.png.
// Usage: node tests/browser/settings.mjs [baseUrl]   (requires the dev server and Playwright)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://localhost:8080/';
const out = new URL('../../build/screens/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const field = (label) => page.locator(`.settings .field:has(> label:text-is("${label}"))`).locator('select');
const scale = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim());

await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
check(await scale() === '1', `auto interface scale at 1366×768 is 1 (${await scale()})`);
await page.setViewportSize({ width: 2560, height: 1440 });
await page.waitForTimeout(100);
check(await scale() === '1.85', `auto scale grows on a large window (${await scale()})`);
await page.setViewportSize({ width: 1366, height: 768 });
await page.click('text=Settings');
await page.screenshot({ path: out + 'settings-01-menu.png' });
check(await page.locator('.settings .field', { hasText: 'Window size' }).count() === 0, 'no window size choice in a browser');
await field('Interface scale').selectOption('1.3');
check(await scale() === '1.3', `interface scale applies at once (${await scale()})`);
await field('Graphics quality').selectOption('low');
await field('Map resolution').selectOption('0.5');
await field('Frame rate limit').selectOption('30');
await page.reload();
await page.waitForSelector('text=New Game');
const saved = await page.evaluate(() => { const s = window.__aoc3.settings; return [s.uiScale, s.profile, s.resolution, s.fpsCap].join(','); });
check(saved === '1.3,low,0.5,30', `settings kept after a reload (${saved})`);

// in game
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'JPN')); });
await page.waitForTimeout(200);
const canvasW = () => page.evaluate(() => window.__client.canvas.width);
check(await canvasW() === 1366, `map drawn at half the screen's pixels (${await canvasW()} px wide on a 2× screen)`);
// frame rate limit: count frames over a second of running time
await page.evaluate(() => window.__client.setSpeed(2));
const f0 = await page.evaluate(() => window.__client.perf.frames);
await page.waitForTimeout(1000);
const f1 = await page.evaluate(() => window.__client.perf.frames);
check(f1 - f0 <= 33, `frame rate limit 30 holds (${f1 - f0} frames in a second)`);
await page.evaluate(() => window.__client.setSpeed(0));
await page.click('text=Menu');
await page.click('.dialog button:has-text("Settings")');
await page.screenshot({ path: out + 'settings-02-ingame.png' });
await field('Map resolution').selectOption('1');
check(await canvasW() === 2732, `map resolution 100% applies in game (${await canvasW()} px)`);
await field('Interface scale').selectOption('auto');
check(await scale() === '1', `back to auto scale (${await scale()})`);
await field('Frame rate limit').selectOption('0');
await field('Graphics quality').selectOption('balanced');
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
