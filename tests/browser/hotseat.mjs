// Hotseat multiplayer: two players pick countries, plan in turn behind the handover screen, a
// proposal from one is answered by the other, a round runs for a week; then the shared mode.
// Usage: node tests/browser/hotseat.mjs [baseUrl]   (requires the dev server and Playwright)
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
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const st = (f, arg) => page.evaluate(f, arg);

await page.goto(base);
await page.evaluate(() => { localStorage.clear(); });
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });

// New Game with two players
await page.click('text=New Game');
await page.selectOption('select.hs-count', '2');
const names = page.locator('input.hs-name');
check(await names.count() === 2, 'two name fields');
await names.nth(0).fill('Alice');
await names.nth(1).fill('Bob');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
check(await page.locator('.pick-banner', { hasText: 'Alice, choose your country' }).count() === 1, 'Alice picks first');
const pick = async (name) => {
  await page.fill('.panel input', name);
  await page.click(`.panel tr.click >> text=${name}`);
  await page.click('button.hs-take');
};
await pick('Brazil');
check(await page.locator('.pick-banner', { hasText: 'Bob, choose your country' }).count() === 1, 'then Bob');
await page.fill('.panel input', 'Brazil');
await page.click('.panel tr.click >> text=Brazil');
check(await page.locator('button.hs-take').isDisabled(), 'a taken country cannot be picked twice');
await pick('Japan');
await page.waitForSelector('.hotseat-cover');
check(await page.locator('.hotseat-cover', { hasText: 'Pass the computer to Alice' }).count() === 1, 'handover screen for Alice');
const ids = await st(() => { const s = window.__client.state; return { A: s.countries.findIndex((c) => c.tag === 'BRA'), B: s.countries.findIndex((c) => c.tag === 'JPN') }; });
check(await st(() => window.__client.state.player) === -1, 'nobody at the screen during the handover');
await page.screenshot({ path: out + 'hotseat-1-handover.png' });

// Alice plans: time cannot run; she moves an army and proposes a pact to Bob
await page.click('button.hs-start');
await page.waitForTimeout(300);
if (await page.locator('.dialog button:has-text("Continue")').count()) await page.click('.dialog button:has-text("Continue")');
check(await st(() => window.__client.state.player) === ids.A, 'Alice leads Brazil');
check(await page.locator('.hotseat-cover').count() === 0, 'the map is shown in her turn');
const day0 = await st(() => window.__client.state.day);
await page.keyboard.press('Space');
await page.waitForTimeout(400);
check(await st(() => window.__client.speed) === 0 && await st(() => window.__client.state.day) === day0, 'time does not run while planning');
const moved = await st(async () => {
  const c = window.__client, s = c.state, m = c.game.map;
  const { orderMove } = await import('./src/core/military.js');
  const { proposeTreaty } = await import('./src/core/diplomacy.js');
  const a = s.armies.find((x) => x.owner === s.player && !(x.sea >= 0));
  let to = -1;
  for (let e = m.adjStart[a.loc]; e < m.adjStart[a.loc + 1]; e++) if (m.adjKind[e] === 0 && s.prov.owner[m.adj[e]] === s.player) { to = m.adj[e]; break; }
  const err = orderMove(s, m, c.game.rules, a.id, to);
  const r = proposeTreaty(s, m, c.game.rules, 'nap', s.player, s.countries.findIndex((x) => x.tag === 'JPN'));
  return { id: a.id, from: a.loc, to, err, pending: r.pending };
});
check(!moved.err && moved.to >= 0, 'army ordered to move');
check(moved.pending, 'the pact waits for Bob');
await page.screenshot({ path: out + 'hotseat-2-alice.png' });
await page.click('button.hs-end');
await page.waitForSelector('.hotseat-cover');
check(await page.locator('.hotseat-cover', { hasText: 'Pass the computer to Bob' }).count() === 1, 'handover screen for Bob');
check(await page.locator('.topbar', { hasText: 'Brazil' }).count() === 0 || await page.locator('.hotseat-cover').isVisible(), 'Alice\'s view is hidden');

// Bob's turn: he is told about the proposal and accepts it in the Diplomacy tab
await page.click('button.hs-start');
await page.waitForSelector('.dialog', { timeout: 3000 });
check(await page.locator('.dialog', { hasText: 'wait for your answer' }).count() === 1, 'Bob is told about the waiting proposal');
await page.click('.dialog button:has-text("Continue")');
check(await st(() => window.__client.state.player) === ids.B, 'Bob leads Japan');
await page.keyboard.press('d');
await page.waitForSelector('text=Proposals to you');
await page.click('.army-card:has-text("Non-aggression pact") button:has-text("Accept")');
check(await st(() => window.__client.state.dip.treaties.some((t) => t.type === 'nap' && [t.a, t.b].includes(window.__client.state.countries.findIndex((c) => c.tag === 'BRA')) && [t.a, t.b].includes(window.__client.state.player))), 'pact signed by Bob\'s answer');
check(await page.locator('.log-item', { hasText: 'ready in' }).count() === 0, 'nothing of Alice\'s in Bob\'s log');
await page.click('button.hs-end');
await page.waitForSelector('.hotseat-cover:has-text("Everyone has planned")');

// the round runs for a week, then Alice's next turn is handed over
await page.screenshot({ path: out + 'hotseat-3-ready.png' });
await page.click('button.hs-run:has-text("A week")');
await page.waitForFunction(() => window.__client.state.hotseat.stage === 'handover' && window.__client.state.hotseat.round === 2, null, { timeout: 30000 });
const after = await st(() => ({ day: window.__client.state.day, speed: window.__client.speed }));
check(after.day === day0 + 7, `ran a week (${after.day - day0} days)`);
check(after.speed === 0, 'stopped at the end of the round');
check(await page.locator('.hotseat-cover', { hasText: 'Pass the computer to Alice' }).count() === 1, 'round 2 starts with Alice');
const army = await st((id) => { const a = window.__client.state.armies.find((x) => x.id === id); return a && { loc: a.loc, path: a.path.length, prog: a.prog }; }, moved.id);
check(army && (army.loc === moved.to || army.prog > 0), `Alice\'s order was carried out during the run (${JSON.stringify({ moved, army })})`);
const slot = await st(() => window.__client.slotInfo().country);
check(/Hotseat: Alice \(Brazil\), Bob \(Japan\)/.test(slot), `save slot label: ${slot}`);
// a save loads back on the handover screen
await st(() => window.__client.quickSave());
await page.waitForTimeout(300);
await page.click('.hotseat-cover button:has-text("Exit to main menu")');
await page.click('text=Load Game');
await page.click('.item:has-text("quicksave") button:has-text("Load")');
await page.waitForSelector('.hotseat-cover');
check(await page.locator('.hotseat-cover', { hasText: 'Pass the computer to Alice' }).count() === 1, 'loaded save opens on the handover screen');
await page.click('.hotseat-cover button:has-text("Exit to main menu")');

// shared screen: F2 passes the controls
await page.click('text=New Game');
await page.selectOption('select.hs-count', '2');
await page.selectOption('select.hs-mode', 'shared');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await pick('Brazil');
await pick('Japan');
await page.waitForTimeout(300);
check(await page.locator('.hotseat-cover').count() === 0, 'no handover screen in the shared mode');
check(await st(() => window.__client.state.player) === ids.A, 'Player 1 starts');
await page.keyboard.press('F2');
check(await st(() => window.__client.state.player) === ids.B, 'F2 switches to Player 2');
await page.keyboard.press('Space');
await page.waitForTimeout(600);
check(await st(() => window.__client.state.day) > day0, 'time runs in the shared mode');
await page.screenshot({ path: out + 'hotseat-4-shared.png' });

await browser.close();
if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
console.log('\nall hotseat checks passed');
