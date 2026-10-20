// National traits, decisions (forming Yugoslavia), objectives and advisors in the interface.
// Usage: node tests/browser/nations.mjs [baseUrl]   (requires the dev server and Playwright)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://localhost:8080/';
const out = new URL('../../build/screens/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'SRB')); c.state.settings.eventRate = 0; c.setTab('country'); });
await page.waitForTimeout(300);
const chips = await page.locator('.chip.trait').count();
check(chips >= 1 && chips <= 3, `national traits shown (${chips})`);
check(!!(await page.locator('.chip.trait').first().getAttribute('data-tip')), 'trait tooltip');
const btn = page.locator('button', { hasText: 'Form Yugoslavia' });
check(await btn.count() === 1 && await btn.isDisabled(), 'Form Yugoslavia shown, not yet possible');
await page.click('button:has-text("Missing provinces")');
await page.waitForTimeout(300);
check(await page.locator('.army-card a').count() > 3, 'missing provinces listed');
// take the region, then form the nation from the decision button
await page.evaluate(async () => {
  const c = window.__client, s = c.state, R = c.game.rules, map = c.game.map;
  const { formableRegion } = await import('./src/core/nations.js');
  const { transferProvince } = await import('./src/core/war.js');
  for (const p of formableRegion(map, R, 'yugoslavia')) transferProvince(s, map, p, s.player);
  s.countries[s.player].stability = 70;
  for (let i = 0; i < 35; i++) c.doTick();
  c.afterTicks(); c.uiDirty = true; c.requestFrame();
});
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__client.state.log.some((l) => /You can now form Yugoslavia/.test(l.text))), 'notified that Yugoslavia can be formed');
check(!(await btn.isDisabled()), 'Form Yugoslavia enabled');
await btn.click();
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__client.state.countries[window.__client.state.player].name) === 'Yugoslavia', 'renamed to Yugoslavia');
check(await page.locator('.side h3', { hasText: 'Yugoslavia' }).count() >= 1 || await page.locator('h3', { hasText: 'Yugoslavia' }).count() >= 1, 'panel shows the new name');
check(await page.locator('.chip.trait', { hasText: 'Brotherhood and unity' }).count() === 1, 'formation trait added');
// objectives come with the months
await page.evaluate(() => { const c = window.__client; for (let i = 0; i < 70; i++) c.doTick(); c.afterTicks(); c.uiDirty = true; c.requestFrame(); });
await page.waitForTimeout(300);
check(await page.locator('.army-card.mission').count() >= 1, `objectives listed (${await page.locator('.army-card.mission').count()})`);
await page.screenshot({ path: out + 'nations-nation-tab.png' });
// advisors in the Government tab
await page.evaluate(() => { const c = window.__client; c.state.countries[c.state.player].treasury = 1000; c.setTab('government'); });
await page.waitForTimeout(300);
check(await page.locator('h3', { hasText: /Advisors \(0 of \d seats\)/ }).count() === 1, 'advisor seats shown');
await page.locator('button', { hasText: /^Hire/ }).first().click();
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__client.state.countries[window.__client.state.player].advisors?.length) === 1, 'advisor hired');
check(await page.locator('h3', { hasText: /Advisors \(1 of \d seats\)/ }).count() === 1, 'seat count updated');
await page.screenshot({ path: out + 'nations-advisors.png' });
await browser.close();
if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
console.log('\nall nation checks passed');
