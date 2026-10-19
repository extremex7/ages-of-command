// The scenario editor: start from a scenario, paint a new country, save it, and play it.
// Usage: node tests/browser/editor.mjs [baseUrl]   (requires the dev server and Playwright)
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
await page.waitForSelector('text=Scenario Editor', { timeout: 20000 });
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });
await page.click('text=Scenario Editor');
await page.fill('input[placeholder="Name of the new scenario"]', 'Test World');
await page.click('button:has-text("New scenario from this")');
await page.waitForSelector('text=Brush country');
check(await page.locator('.topbar >> text=Scenario editor').count() === 1, 'editor screen open');

// a new country, painted over three provinces of France by clicking the map
await page.fill('input[placeholder="Name of a new country"]', 'Occitania');
await page.click('button:has-text("Add country")');
await page.waitForTimeout(300);
const tag = await page.evaluate(() => window.__client.editor.brush);
check(tag === 'OCC', `new country is the brush (${tag})`);
const provs = await page.evaluate(() => {
  const c = window.__client, s = c.state, fr = s.countries.findIndex((x) => x.tag === 'FRA');
  return c.game.map.ids.filter((i) => s.prov.owner[i] === fr && c.game.map.y[i] > 0).slice(0, 3);
});
for (const p of provs) {
  const [sx, sy] = await page.evaluate((p) => { const c = window.__client; c.focusProvince(p); c.view.selected = -1; return c.renderer.worldToScreen(c.game.map.x[p], c.game.map.y[p]); }, p);
  await page.waitForTimeout(100);
  await page.mouse.click(sx, sy);
}
const owned = await page.evaluate(([provs, tag]) => provs.filter((p) => window.__client.editor.sc.provinces[p][0] === tag).length, [provs, tag]);
check(owned >= 2, `painted provinces by clicking (${owned} of ${provs.length})`);
const shown = await page.evaluate((tag) => { const s = window.__client.state, k = s.countries.findIndex((x) => x.tag === tag); return window.__client.game.map.ids.filter((i) => s.prov.owner[i] === k).length; }, tag);
check(shown === owned, 'the map shows the painted provinces');
// country fields
await page.click('button:has-text("Select")');
await page.evaluate((tag) => { const c = window.__client; c.view.selectedCountry = c.state.countries.findIndex((x) => x.tag === tag); c.uiDirty = true; c.requestFrame(); }, tag);
await page.waitForTimeout(200);
await page.selectOption('.ed-country select >> nth=0', { label: 'Absolute monarchy' });
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/claude-0/np/editor-country.png' });
const gov = await page.evaluate((tag) => window.__client.editor.sc.countries.find((c) => c.tag === tag).gov, tag);
check(gov === 'abs_monarchy', `government field (${gov})`);
// save and play
await page.click('button:has-text("Save and play")');
await page.waitForSelector('text=Choose country →', { timeout: 10000 });
check(await page.locator('.list .item.sel >> text=Test World').count() === 1, 'saved scenario selected in New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
const ok = await page.evaluate((tag) => { const c = window.__client; const k = c.state.countries.findIndex((x) => x.tag === tag); c.startPlaying(k); for (let i = 0; i < 40; i++) c.doTick(); c.afterTicks(); return c.state.countries[k].alive && c.state.scenarioId; }, tag);
check(ok === 'custom_test_world', `plays as the new country (${ok})`);
// the scenario survives a reload and can be edited again
await page.goto(base);
await page.waitForSelector('text=Scenario Editor', { timeout: 20000 });
await page.click('text=Scenario Editor');
check(await page.locator('.list >> text=Test World').count() === 1, 'custom scenario listed after reload');
await page.click('.list >> text=Test World');
await page.click('button:has-text("Edit")');
await page.waitForSelector('text=Brush country');
check(await page.evaluate(() => window.__client.editor.sc.countries.some((c) => c.tag === 'OCC')), 'reopened with its new country');
await page.screenshot({ path: '/tmp/claude-0/np/editor.png' });
await browser.close();
if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
console.log('\nall editor checks passed');
