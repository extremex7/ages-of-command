// Diplomacy deals in the interface: the Deals buttons of a foreign country (loan dialog with the
// lender's answer, ultimatum dialog, personal union and rebel funding), and the Diplomacy tab's
// offers waiting for the player (an AI ultimatum, refused) and its loans and casus belli.
// Usage: node tests/browser/deals.mjs [baseUrl]   (requires the dev server and Playwright)
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
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => {
  const c = window.__client, s = c.state;
  c.startPlaying(s.countries.findIndex((x) => x.tag === 'FRA'));
  s.settings.eventRate = 0;
  for (let i = 0; i < 3; i++) c.doTick();
  c.afterTicks();
  s.countries[s.player].treasury = 5000; s.countries[s.player].influence = 100;
});
const openCountry = (tag) => page.evaluate((t) => { const c = window.__client, s = c.state; c.view.selectedCountry = s.countries.findIndex((x) => x.tag === t); c.setTab('country'); }, tag);

// 1. the Deals section of Spain
await openCountry('ESP');
await page.waitForSelector('h4:has-text("Deals")', { timeout: 3000 });
for (const b of ['Loan…', 'Send money…', 'Province deal…', 'Ultimatum…', 'Personal union']) check(await page.locator(`button:has-text("${b}")`).count() >= 1, `Deals button "${b}"`);
check(await page.locator('text=Fund unrest').count() === 1, 'rebel funding picker');
const unionTip = await page.locator('button:has-text("Personal union")').getAttribute('data-tip');
check(/would (accept|refuse)|not much weaker|influence/.test(unionTip || ''), 'the union button explains the answer');

// 2. loan dialog: the lender's answer with reasons, then offering it
await page.click('button:has-text("Loan…")');
await page.waitForSelector('.dialog h2:has-text("Loan")');
check(/would (accept|refuse)/.test(await page.locator('.dialog').innerText()), 'loan dialog shows their answer');
check(await page.locator('.dialog li').count() > 0, 'with its reasons');
await page.click('.dialog button:has-text("Offer the loan")');
await page.waitForTimeout(200);
const loans = await page.evaluate(() => (window.__client.state.dip.loans || []).length);
console.log('     loans after the offer:', loans);

// 3. ultimatum dialog (Spain is a NATO ally, so it is refused outright; Algeria is not)
await page.click('button:has-text("Ultimatum…")');
await page.waitForSelector('.dialog h2:has-text("Ultimatum")');
check(/Not against an ally/.test(await page.locator('.dialog').innerText()), 'no ultimatums to allies');
await page.evaluate(() => document.querySelector('.dialog-wrap')?.remove());
await openCountry('DZA');
await page.waitForSelector('h4:has-text("Deals")', { timeout: 3000 });
await page.click('button:has-text("Ultimatum…")');
await page.waitForSelector('.dialog h2:has-text("Ultimatum")');
const ult = await page.locator('.dialog').innerText();
check(/strength/.test(ult) && /would (accept|refuse)/.test(ult), 'ultimatum dialog weighs the balance of force');
await page.evaluate(() => document.querySelector('.dialog-wrap')?.remove());

// 4. an AI ultimatum to the player waits in the Diplomacy tab; refusing gives them a casus belli
await page.evaluate(async () => {
  const c = window.__client, s = c.state, { issueDemand } = await import('/src/core/deals.js');
  const deu = s.countries.findIndex((x) => x.tag === 'RUS');
  s.countries[deu].influence = 100;
  window.__dem = issueDemand(s, c.game.map, c.game.rules, deu, s.player, { kind: 'money', amount: 1 });
  c.setTab('diplomacy');
});
await page.waitForSelector('text=Ultimatum from Russia', { timeout: 3000 });
check(await page.locator('h3:has-text("Loans")').count() === 1, 'Diplomacy tab lists loans');
await page.click('.army-card:has-text("Ultimatum from") button:has-text("Refuse")');
await page.waitForTimeout(300);
check(await page.locator('text=may attack you without penalty').count() === 1, 'the casus belli against you is listed');

// 5. a personal union shows in the treaties
await page.evaluate(async () => {
  const c = window.__client, s = c.state, { formUnion } = await import('/src/core/diplomacy.js');
  formUnion(s, c.game.map, c.game.rules, s.player, s.countries.findIndex((x) => x.tag === 'MCO'));
  c.uiDirty = true; c.requestFrame();
});
await page.waitForTimeout(400);
check(await page.locator('text=Personal union: Monaco is the junior partner').count() >= 1, 'the union is in the treaty list');
check(await page.locator('h3:has-text("Personal unions")').count() === 1, 'and in the unions list');

console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nall ok');
await browser.close();
process.exit(errors.length ? 1 : 0);
