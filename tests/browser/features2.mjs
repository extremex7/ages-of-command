// Later features: generals and battle plans in the Military tab, the civil-war choice.
// Usage: node tests/browser/features2.mjs [baseUrl]   (requires the dev server and Playwright)
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

async function newGame(tag) {
  await page.waitForSelector('text=New Game', { timeout: 20000 });
  await page.click('text=New Game');
  await page.click('text=Choose country');
  await page.waitForSelector('.pick-banner');
  await page.evaluate((t) => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === t)); c.state.settings.eventRate = 0; }, tag);
}
const toMenu = async () => { await page.evaluate(() => { document.querySelector('.dialog-wrap')?.remove(); window.__client.opts.onExit(); }); };

// 1. generals and plans
await newGame('IND');
await page.evaluate(() => { const c = window.__client; for (let i = 0; i < 35; i++) { c.doTick(); } c.afterTicks(); });
await page.keyboard.press('m');
await page.waitForTimeout(300);
const gen = await page.locator('.army-card >> text=Gen.').count();
check(gen > 0, `army cards show their generals (${gen})`);
await page.locator('.army-card').first().click();
await page.waitForTimeout(200);
check(await page.locator('.command select').count() >= 2, 'command section: general and front pickers');
await page.selectOption('.command select >> nth=1', { label: 'Pakistan' });
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__client.state.plans?.some((p) => p.kind === 'front')), 'a front plan is made from the picker');
await page.click('.command button:has-text("Plan attack")');
const target = await page.evaluate(async () => {
  const c = window.__client, s = c.state, map = c.game.map, k = s.countries.findIndex((x) => x.tag === 'PAK');
  const { declareWar } = await import('/src/core/war.js');
  declareWar(s, map, c.game.rules, s.player, k);
  const p = map.ids.find((i) => s.prov.owner[i] === k);
  const [sx, sy] = c.renderer.worldToScreen(map.x[p], map.y[p]);
  return { p, sx, sy };
});
await page.evaluate(({ sx, sy }) => window.__client.rightClick(sx, sy), target);
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__client.state.plans?.some((p) => p.kind === 'attack')), 'right-click in plan mode draws an attack arrow');
await page.evaluate(() => { window.__client.uiDirty = true; window.__client.requestFrame(); }); await page.waitForTimeout(400);
check(await page.locator('.command button:has-text("Execute")').count() === 1, 'the plan can be executed from the list');
await page.screenshot({ path: '/tmp/claude-0/features2-plans.png' });

// 2. intelligence: build a network in Pakistan from its Nation tab
await page.evaluate(() => { const c = window.__client, s = c.state; c.view.selectedCountry = s.countries.findIndex((x) => x.tag === 'PAK'); c.setTab('country'); });
await page.waitForSelector('text=Intelligence', { timeout: 3000 });
await page.click('label:has-text("Build network") input');
check(await page.evaluate(() => { const s = window.__client.state; return s.countries[s.player].spy.building.length === 1; }), 'a spy network is started from the Nation tab');
check(await page.locator('button:has-text("Stage a coup")').isDisabled(), 'operations wait for the network');
await page.evaluate(() => { const c = window.__client, s = c.state; c.view.selectedCountry = s.player; c.setTab('country'); });
await page.waitForTimeout(300);
check(await page.locator('label:has-text("Counter-intelligence")').count() === 1, 'own Nation tab: counter-intelligence');

// 3. world council and sanctions
await page.evaluate(() => { const c = window.__client, s = c.state; c.view.selectedCountry = s.countries.findIndex((x) => x.tag === 'BGD'); c.setTab('country'); });
await page.waitForSelector('text=Propose DMZ', { timeout: 3000 });
await page.selectOption('select:has(option[value="energy"]) >> nth=0', 'energy');
check(await page.evaluate(() => { const s = window.__client.state, k = s.countries.findIndex((x) => x.tag === 'BGD'); return s.countries[s.player].econ.sanctions?.[k] === 'energy'; }), 'own energy sanctions set from the Nation tab');
await page.evaluate(() => { const s = window.__client.state; s.countries[s.player].influence = 50; window.__client.uiDirty = true; window.__client.requestFrame(); });
await page.waitForTimeout(300);
await page.click('button:has-text("Propose to council")');
await page.evaluate(() => window.__client.setTab('diplomacy'));
await page.waitForSelector('text=United Nations', { timeout: 3000 });
check(await page.locator('text=Expected:').count() >= 1, 'the Diplomacy tab shows the vote with its expected result');
await page.click('.item button:has-text("Yes")');
check(await page.evaluate(() => { const s = window.__client.state; return s.council.pending.some((r) => r.votes[s.player] === 'yes'); }), 'the player votes');
await page.screenshot({ path: '/tmp/claude-0/features2-council.png' });

// 4. civil war: the player is asked which side to lead
await page.evaluate(async () => {
  const c = window.__client, s = c.state, k = s.player;
  const { startCivilWar } = await import('/src/core/civilwar.js');
  startCivilWar(s, c.game.map, c.game.rules, k, 'test');
  c.doTick(); c.afterTicks();
});
await page.waitForSelector('text=Which side do you lead?', { timeout: 5000 });
check(true, 'civil war asks the player to choose a side');
await page.click('.dialog button:has-text("Join the")');
check(await page.evaluate(() => window.__client.state.countries[window.__client.state.player].tag.includes('_R')), 'the player can take over the rebels');
await toMenu();

console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nall ok');
await browser.close();
process.exit(errors.length ? 1 : 0);
