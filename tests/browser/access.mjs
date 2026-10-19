// Accessibility: colour-blind map colours, text size, keyboard-only play.
// Usage: node tests/browser/access.mjs [baseUrl]   (requires the dev server and Playwright)
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

// settings: colour vision, text size, keyboard-only play
await page.click('text=Settings');
const pick = (label, value) => page.locator('.field', { hasText: label }).locator('select').selectOption(value);
await pick('Colour vision', 'redgreen');
await pick('Text size', '1.3');
await pick('Keyboard-only play', '1');
const root = await page.evaluate(() => ({ cls: document.documentElement.className, fs: parseFloat(getComputedStyle(document.documentElement).fontSize), scale: +getComputedStyle(document.documentElement).getPropertyValue('--ui-scale') }));
check(root.cls.includes('cv-redgreen') && root.cls.includes('kbd-mode'), `root classes (${root.cls})`);
check(Math.abs(root.fs - 13 * root.scale * 1.3) < 0.6, `text 130% (${root.fs}px at interface scale ${root.scale})`);
await page.reload();
await page.waitForSelector('text=New Game', { timeout: 20000 });
check(await page.evaluate(() => document.documentElement.classList.contains('cv-redgreen')), 'settings kept after reload');
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });

await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
check(await page.locator('table.t tr.click').first().getAttribute('tabindex') === '0', 'country list rows can be reached with Tab');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'POL')); c.state.settings.eventRate = 0; });
await page.waitForTimeout(300);
await page.keyboard.press('r'); // military map mode
await page.waitForTimeout(200);
const legend = await page.evaluate(() => [...document.querySelectorAll('.legend i')].map((i) => i.style.background || i.style.backgroundColor));
check(legend.some((c) => /0, 114, 178|0072b2/i.test(c)), `military legend in colour-blind blue (${legend[0]})`);
const col = await page.evaluate(() => { const c = window.__client; return c.renderer.colors[c.state.countries[c.state.player].capital]; });
check(col === '#0072b2', `own provinces drawn in the safe blue (${col})`);
check(await page.locator('.crosshair').isVisible(), 'cross in the middle of the map');

// keyboard: step to an army, select the province under the cross, send the army elsewhere
await page.keyboard.press(']');
await page.waitForTimeout(200);
const sel = await page.evaluate(() => [...window.__client.view.selectedArmies]);
check(sel.length === 1, `] selects an army (${sel})`);
const at = await page.evaluate((id) => window.__client.state.armies.find((a) => a.id === id).loc, sel[0]);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__client.view.selected) === at, 'Enter selects the province under the cross');
const target = await page.evaluate((at) => { const c = window.__client, m = c.game.map, s = c.state; for (let e = m.adjStart[at]; e < m.adjStart[at + 1]; e++) { const q = m.adj[e]; if (s.prov.owner[q] === s.player && m.adjKind[e] === 0) { c.renderer.centerOn(m.x[q], m.y[q], c.renderer.cam.z); return q; } } return -1; }, at);
await page.evaluate((id) => { window.__client.view.selectedArmies = new Set([id]); }, sel[0]);
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(200);
const path = await page.evaluate((id) => window.__client.state.armies.find((a) => a.id === id).path, sel[0]);
check(target >= 0 && path.length > 0 && path[path.length - 1] === target, `Shift+Enter orders the army (${path})`);

// Tab moves the focus; the focus survives the interface being rebuilt while time runs
for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
const f1 = await page.evaluate(() => document.activeElement.tagName);
check(['BUTTON', 'INPUT', 'SELECT', 'A', 'DIV', 'TR'].includes(f1), `Tab focuses a control (${f1})`);
await page.keyboard.press('Escape');
await page.keyboard.press('m');
await page.waitForTimeout(200);
await page.locator('.tabs button').nth(1).focus();
const before = await page.evaluate(() => document.activeElement.textContent);
await page.evaluate(() => { const c = window.__client; for (let i = 0; i < 5; i++) c.doTick(); c.afterTicks(); c.uiDirty = true; c.renderUi(); });
const after = await page.evaluate(() => document.activeElement.textContent);
check(before === after && before.length > 0, `focus kept on "${before}" after a rebuild`);
// an army card can be opened with the keyboard
await page.keyboard.press('Escape');
await page.keyboard.press('m');
await page.waitForTimeout(200);
await page.locator('.army-card').first().focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__client.view.selectedArmies.size) === 1, 'Enter on a focused army card selects it');
await page.screenshot({ path: '/tmp/claude-0/np/access.png' });
await browser.close();
if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
console.log('\nall accessibility checks passed');
