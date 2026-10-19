// Real flags and the event pause. For every scenario: each country's flag file loads (none
// falls back to the pattern flag by accident), and a screenshot of the country list is saved.
// Then an event that needs a decision pauses a running game, and the game runs again at the
// same speed once the decision is made (or stays paused with "Stay paused" set).
// Usage: node tests/browser/flags.mjs [baseUrl] [screenshotDir]   (requires the dev server and Playwright)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://localhost:8080/';
const shots = process.argv[3] || null;
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const failed = [];
page.on('requestfailed', (r) => failed.push(r.url()));
page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url() + ' ' + r.status()); });

const scenarios = ['Modern World', 'Height of Rome', 'Rise of Empires', 'Concert of Europe', 'A House Divided', 'The Great War', 'The Gathering Storm', 'Cold War', 'Flashpoint 2035', 'Orbital Age 2085'];
for (const name of scenarios) {
  await page.goto(base);
  await page.waitForSelector('text=New Game', { timeout: 20000 });
  await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; }); // no tutorial offer in tests
  await page.click('text=New Game');
  await page.locator('.list .item', { hasText: name }).first().click();
  await page.click('text=Choose country');
  await page.waitForSelector('.pick-banner');
  // wait for every flag of the scenario to load
  const res = await page.evaluate(async () => {
    const c = window.__client, { flagCanvas } = await import('./src/ui/flags.js');
    const idx = await (await fetch('data/flags/index.json')).json(), sc = idx.scenarios[c.state.scenarioId] || {};
    // a tag set to null in the index keeps its pattern flag on purpose (ancient and invented states)
    const none = c.state.countries.filter((x) => !(x.tag in sc) && !idx.default[x.tag]).map((x) => x.tag);
    const pattern = c.state.countries.filter((x) => x.tag in sc && !sc[x.tag]).length;
    for (const x of c.state.countries) flagCanvas(x);
    await new Promise((r) => setTimeout(r, 1500)); // let the flag images load
    return { n: c.state.countries.length, none, pattern };
  });
  check(res.none.length === 0, `${name}: ${res.n - res.pattern} real flags, ${res.pattern} pattern flags by choice${res.none.length ? ' (not: ' + res.none.join(' ') + ')' : ''}`);
  const missing = failed.filter((u) => u.includes('/data/flags/'));
  check(missing.length === 0, `${name}: all ${res.n} flag files load${missing.length ? ' (missing ' + missing.slice(0, 5).join(', ') + ')' : ''}`);
  failed.length = 0;
  if (shots) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/flags-${name.replace(/\W+/g, '_')}.png` });
  }
}

// Event decisions: pause, then resume at the speed the game was running at.
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; }); // no tutorial offer in tests
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'FRA')); c.game.state.settings.eventRate = 0; });
async function fireEvent() {
  await page.evaluate(() => {
    const c = window.__client, s = c.state, ev = c.game.rules.events.find((e) => e.options && e.options.length >= 2 && !e.scenario);
    s.pendingEvents.push({ c: s.player, ev: ev.id, title: 'Test event', text: 'A decision is needed.', day: s.day });
    c.setSpeed(3);
  });
  await page.waitForSelector('.dialog .menu-buttons button', { timeout: 10000 });
}
await fireEvent();
check(await page.evaluate(() => window.__client.speed) === 0, 'an event pauses the running game');
await page.locator('.dialog .menu-buttons button').first().click();
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__client.speed) === 3, 'after the decision the game runs again at speed 3');
await page.evaluate(() => { window.__client.data.settings.resumeAfterEvents = false; });
await fireEvent();
await page.locator('.dialog .menu-buttons button').first().click();
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__client.speed) === 0, 'with "Stay paused" set the game stays paused');
await page.evaluate(() => { window.__client.data.settings.resumeAfterEvents = true; });

await browser.close();
if (errors.length) { console.log('\n' + errors.length + ' problem(s)'); process.exit(1); }
console.log('\nall checks passed');
