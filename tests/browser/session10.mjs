// Side panel toggle, leaderboard, tutorial (offer, steps, "don't ask again") and cheats (only
// in games started while cheats were enabled).
// Usage: node tests/browser/session10.mjs [baseUrl]   (requires the dev server and Playwright)
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
await page.evaluate(() => localStorage.clear());
await page.goto(base);

async function newGame(tag = 'FRA') {
  await page.waitForSelector('text=New Game', { timeout: 20000 });
  await page.click('text=New Game');
  await page.click('text=Choose country');
  await page.waitForSelector('.pick-banner');
  await page.evaluate((t) => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === t)); c.state.settings.eventRate = 0; }, tag);
}
const toMenu = async () => { await page.evaluate(() => { document.querySelector('.dialog-wrap')?.remove(); window.__client.opts.onExit(); }); };

// 1. tutorial offer on a new game; skip it and turn it off
await newGame();
await page.waitForSelector('text=Would you like a tutorial?', { timeout: 5000 });
check(true, 'a new game offers the tutorial');
await page.click('text=Start the tutorial');
const count = await page.evaluate(() => document.querySelector('.tut-head').textContent);
check(/1 of (\d+)/.test(count) && +/of (\d+)/.exec(count)[1] >= 20, `tutorial starts (${/\d+ of \d+/.exec(count)[0]})`);
let pointed = 0, steps = 0;
for (;;) {
  steps++;
  if (await page.evaluate(() => document.querySelector('.tut-spot').style.display !== 'none')) pointed++;
  const next = page.locator('.tutorial button:has-text("Next")');
  if (!(await next.count())) break;
  await next.click(); await page.waitForTimeout(80);
}
check(steps >= 20 && pointed >= 15, `every step shows (${steps} steps, ${pointed} point at the screen)`);
const tbl = await page.evaluate(() => { const c = window.__client; c.startTutorial(); const i = [...document.querySelectorAll('.tut-head option')].findIndex((o) => o.value === 'Economy'); return i; });
await page.selectOption('.tut-head select', 'Economy');
for (let k = 0; k < 6 && !(await page.locator('.tut-table').count()); k++) await page.click('.tutorial button:has-text("Next")');
const rows = await page.locator('.tut-table tr').count();
const nb = await page.evaluate(() => window.__client.game.rules.econ.buildings.length);
check(rows === nb + 1, `the buildings step lists all ${nb} buildings`);
await page.click('.tutorial button:has-text("Skip tutorial")');
check(!(await page.locator('.tutorial').count()), 'Skip closes the tutorial');
await toMenu();
await newGame();
await page.waitForSelector('text=Would you like a tutorial?');
await page.click("text=Don't ask again");
check(await page.evaluate(() => window.__aoc3.settings.tutorial) === 'off', '"Don\'t ask again" turns the tutorial off in the settings');
await toMenu();
await newGame();
await page.waitForTimeout(600);
check(!(await page.locator('text=Would you like a tutorial?').count()), 'with the tutorial off, a new game does not ask');

// 2. side panel
await page.click('.side-toggle');
check(await page.evaluate(() => document.querySelector('.sidebar').classList.contains('hidden')), 'the side panel hides');
await page.keyboard.press('Tab');
check(await page.evaluate(() => !document.querySelector('.sidebar').classList.contains('hidden')), 'Tab shows it again');
await page.keyboard.press('Tab');
await page.locator('.tabs button', { hasText: 'Economy' }).count();
await page.evaluate(() => window.__client.setTab('economy'));
check(await page.evaluate(() => !document.querySelector('.sidebar').classList.contains('hidden')), 'opening a tab shows the side panel');

// 3. leaderboard
await page.click('button[aria-label="Leaderboard"]');
const lb = await page.locator('.lb-dialog tr').count();
const alive = await page.evaluate(() => window.__client.state.countries.filter((c) => c.alive).length);
check(lb === alive + 1, `leaderboard lists all ${alive} countries`);
check(await page.locator('.lb-dialog tr.me').count() === 1, 'your country is highlighted');
await page.click('.lb-filters button:has-text("Star countries")');
check(await page.locator('.lb-dialog tr').count() === 51, 'star countries: the top 50');
await page.click('.lb-dialog button:has-text("Close")');

// 4. cheats: this game started with cheats off
await page.evaluate(() => { window.__aoc3.settings.cheats = true; window.__client.uiDirty = true; });
await page.waitForTimeout(300);
await page.keyboard.press('`');
await page.waitForSelector('.console');
await page.fill('.console input', 'money 50B');
await page.press('.console input', 'Enter');
const out1 = await page.locator('.console-out').textContent();
const t0 = await page.evaluate(() => window.__client.state.countries[window.__client.state.player].treasury);
check(/started before cheats were enabled/.test(out1), 'a game started before cheats were enabled refuses them');
await page.keyboard.press('Escape');
// a game started now accepts them
await toMenu();
await newGame('NPL');
await page.click('button[aria-label="Cheat console"]');
const run = async (cmd) => { await page.fill('.console input', cmd); await page.press('.console input', 'Enter'); return (await page.locator('.console-out > div').last().textContent()); };
const before = await page.evaluate(() => window.__client.state.countries[window.__client.state.player].treasury);
check(/Treasury/.test(await run('money 50B')), 'money works');
const after = await page.evaluate(() => window.__client.state.countries[window.__client.state.player].treasury);
check(Math.abs(after - before - 50) < 1e-6, `treasury +50B (${before.toFixed(1)} -> ${after.toFixed(1)})`);
check(/granted/.test(await run('tech fusion power')), 'tech grants a technology');
check(/Annexed Bhutan/.test(await run('annex BTN')), 'annex takes a country');
check(await page.evaluate(() => !window.__client.state.countries.find((c) => c.tag === 'BTN').alive), 'Bhutan is gone');
check(/At war/.test(await run('war IND')), 'war declares war');
check(/ended/.test(await run('peace')), 'peace ends it');
check(/Unknown command/.test(await run('fly')), 'unknown commands are explained');
check(await page.evaluate(() => window.__client.state.cheated === true && window.__client.state.settings.cheats === true), 'the game is marked as cheated');
void t0;

await browser.close();
if (errors.length) { console.log('\n' + errors.length + ' problem(s)'); process.exit(1); }
console.log('\nall checks passed');
