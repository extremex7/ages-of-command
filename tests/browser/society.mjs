// Browser check for religion, unrest and revolts (docs/RELIGION.md): starts a 1444 campaign as the
// Ottomans, opens the religion (6) and unrest (7) map modes and their legends, starts a revolt in
// an Ottoman province, and checks the province panel (religion, unrest, revolt, Suppress), the
// Nation tab line and the Government tab section, with no page errors. Screenshots go to
// build/screens/society-*.png.
// Usage: node tests/browser/society.mjs [baseUrl]   (requires the dev server and Playwright)
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
const errors = [], fails = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });
await page.click('text=New Game');
// the 1444 start, if the menu lists it, has Orthodox provinces under a Sunni state
const has1444 = await page.locator('text=Rise of Empires').count();
if (has1444) await page.locator('text=Rise of Empires').first().click();
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
const who = has1444 ? 'Ottoman' : 'France';
await page.fill('.panel input', who);
await page.locator('.panel tr.click', { hasText: who }).first().click();
await page.locator(`text=/Play as .*${who}/`).first().click();
await page.waitForTimeout(500);

await page.keyboard.press('6');
await page.waitForTimeout(300);
const leg6 = await page.locator('.legend').innerText();
check(await page.evaluate(() => window.__client.renderer.mode) === 'religion', 'key 6 opens the religion map');
check(/state religion/i.test(leg6) && leg6.split('\n').length >= 3, 'religion legend lists faiths: ' + leg6.split('\n').slice(0, 4).join(', '));
await page.screenshot({ path: out + 'society-religion.png' });

// a revolt in the player's most restless province, through the game's own modules
const info = await page.evaluate(async () => {
  const c = window.__client, s = c.state, map = c.game.map, R = c.game.rules;
  const U = await import('./src/core/unrest.js');
  let p = -1;
  for (const i of map.ids) if (s.prov.owner[i] === s.player && i !== s.countries[s.player].capital && (p < 0 || s.society.unrest[i] > s.society.unrest[p])) p = i;
  s.society.unrest[p] = 70;
  const r = U.startRevolt(s, map, R, p, 'popular', 'test');
  c.view.selected = p; c.uiDirty = true; c.requestFrame();
  return { p, name: map.name[p], revolt: r?.name };
});
console.log('revolt', info);
await page.keyboard.press('7');
await page.waitForTimeout(400);
const leg7 = await page.locator('.legend').innerText();
check(/calm/i.test(leg7) && /rebel/i.test(leg7), 'unrest legend: ' + leg7.replace(/\n/g, ', '));
const prov = await page.locator('.prov-panel').innerText();
check(/Religion/.test(prov) && /Unrest/.test(prov), 'province panel shows religion and unrest');
check(prov.includes(info.revolt), 'province panel shows the revolt');
const supp = page.locator('.prov-panel button', { hasText: 'Suppress unrest' });
check(await supp.count() === 1, 'Suppress button present');
const before = await page.evaluate((p) => window.__client.state.society.unrest[p], info.p);
await supp.click();
const after = await page.evaluate((p) => window.__client.state.society.unrest[p], info.p);
check(after < before, `suppress lowers unrest (${Math.round(before)} -> ${Math.round(after)})`);
await page.evaluate((p) => { const c = window.__client, map = c.game.map; c.renderer.centerOn(map.x[p], map.y[p], 3); c.requestFrame(); }, info.p);
await page.waitForTimeout(400);
await page.screenshot({ path: out + 'society-unrest.png' });

await page.keyboard.press('n');
await page.waitForTimeout(200);
check(/State religion/.test(await page.locator('.panel').first().innerText()), 'Nation tab shows the state religion');
await page.keyboard.press('b');
await page.waitForTimeout(200);
const gov = await page.locator('.panel').first().innerText();
check(/Religion and unrest/.test(gov) && /Golden momentum/.test(gov) && /War exhaustion/.test(gov), 'Government tab has the religion and unrest section');
check(gov.includes(info.revolt), 'Government tab lists the revolt');
await page.screenshot({ path: out + 'society-government.png' });

// a month of play with the revolt running, in the unrest and political maps
await page.evaluate(() => { const c = window.__client; c.renderer.mode = 'political'; c.renderer.invalidate(); c.setSpeed(5); });
await page.waitForTimeout(2500);
await page.evaluate(() => window.__client.setSpeed(0));
check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
if (fails.length) { console.log(`${fails.length} check(s) failed`); process.exit(1); }
console.log('society browser check passed');
