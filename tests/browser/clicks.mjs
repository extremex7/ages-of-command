// Clicks while time runs: the interface redraws several times a second at full speed, and a
// button replaced between mouse down and mouse up never receives the click. Presses each tab
// and a build button the way a person does (about 120 ms between down and up) at speed 5.
// Usage: node tests/browser/clicks.mjs [baseUrl]   (requires the dev server and Playwright)
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
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'FRA')); });
await page.waitForTimeout(300);
// no event dialogs in the way: they pause the game
await page.evaluate(() => { const c = window.__client; c.game.state.settings.eventRate = 0; c.setSpeed(5); });

async function press(locator) {
  let b = null;
  for (let i = 0; i < 20 && !b; i++) b = await locator.boundingBox({ timeout: 1000 }).catch(() => null);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(60);
}
await page.evaluate(() => { window.__log = []; for (const ev of ['pointerdown', 'pointerup', 'click']) document.addEventListener(ev, (e) => window.__log.push(ev + ':' + (e.target.textContent || '').slice(0, 12) + ':' + e.target.isConnected), true); });
const tabs = ['Diplomacy', 'Military', 'Economy', 'Research', 'Government', 'Industry', 'Strategic', 'Nation'];
let hit = 0;
for (let round = 0; round < 3; round++) {
  for (const t of tabs) {
    await press(page.locator('.tabs button', { hasText: t }).first());
    const now = await page.evaluate(() => document.querySelector('.tabs button.on')?.textContent);
    const log = await page.evaluate(() => window.__log.splice(0));
    if (now === t) hit++;
    else console.log('     events', log.join(' | ')), console.log('     missed', t, '(tab is', now + ')', await page.evaluate(() => ({ dialog: !!document.querySelector('.dialog-wrap'), speed: window.__client.speed, top: document.elementFromPoint(100, 60)?.className })));
    while (await page.locator('.dialog .menu-buttons button').count()) { await page.locator('.dialog .menu-buttons button').first().click(); await page.evaluate(() => window.__client.setSpeed(5)); }
  }
}
check(hit === tabs.length * 3, `tab presses while running: ${hit} of ${tabs.length * 3} worked`);
const running = await page.evaluate(() => window.__client.speed);
check(running === 5, `game still running at speed ${running}`);

// build buttons in the province panel
await page.evaluate(() => { const c = window.__client, s = c.state; c.focusProvince(s.countries[s.player].capital); c.setSpeed(5); });
await page.waitForTimeout(300);
let built = 0;
for (let i = 0; i < 6; i++) {
  const q = await page.evaluate(() => JSON.stringify(window.__client.state.construction || []).length);
  await press(page.locator('button', { hasText: 'Farms' }).first());
  const q2 = await page.evaluate(() => JSON.stringify(window.__client.state.construction || []).length);
  if (q2 !== q) built++;
}
check(built === 6, `build presses while running: ${built} of 6 queued`);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
