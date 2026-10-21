// Victory conditions and screen, capitulation notice, army experience, bulk construction (with the
// map brush), build where most needed, auto-managed economy, and colonies.
// Usage: node tests/browser/session23.mjs [baseUrl]   (requires the dev server and Playwright)
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
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(base);
await page.evaluate(() => { localStorage.clear(); });
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });

// --- New Game: victory conditions and capitulation
await page.click('text=New Game');
await page.check('.victory-conquest');
await page.check('.victory-tech');
await page.selectOption('.victory-setup .field select', '0.8');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
const set = await page.evaluate(() => window.__client.state.settings);
check(set.victory?.conquest === 0.5 && set.victory.tech === 'future' && !set.victory.economy && set.capitulation === 0.8, `settings ${JSON.stringify(set.victory)} cap ${set.capitulation}`);
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'POL')); c.state.settings.eventRate = 0; });
await page.waitForTimeout(300);
check(await page.locator('.topbar .score-stat').count() === 1, 'score shown in the top bar');
await page.click('.topbar .score-stat');
await page.waitForSelector('.victory-table');
check(await page.locator('.victory-table tr').count() === 3, 'two conditions with progress');
await page.keyboard.press('Escape');

// --- army experience on the card
await page.evaluate(() => { const c = window.__client; const a = c.state.armies.find((x) => x.owner === c.state.player); a.exp = 0.6; c.setTab('military'); });
await page.waitForTimeout(300);
check(await page.locator('.army-card .exp-line', { hasText: 'Veteran' }).count() >= 1, 'veteran army shown on its card');
check(await page.locator('.expertise').count() === 1, 'national expertise shown');

// --- bulk construction: whole country, then the brush
await page.evaluate(() => { const c = window.__client; c.state.countries[c.state.player].treasury = 5000; c.setTab('industry'); });
await page.waitForSelector('.bulk');
await page.selectOption('.bulk-scope', 'country');
await page.waitForTimeout(200);
const q0 = await page.evaluate(() => window.__client.state.construction.filter((p) => p.owner === window.__client.state.player).length);
const label = await page.locator('.bulk-go').textContent();
await page.click('.bulk-go');
await page.waitForTimeout(200);
const q1 = await page.evaluate(() => window.__client.state.construction.filter((p) => p.owner === window.__client.state.player).length);
const n = +(/Queue (\d+)/.exec(label)?.[1] || 0);
check(n > 0 && q1 === q0 + n, `${label}: queue ${q0} -> ${q1}`);
// cancel them again so the brush has room
await page.evaluate(() => { const c = window.__client, s = c.state; s.construction = s.construction.filter((p) => p.owner !== s.player); c.uiDirty = true; });
await page.click('.bulk button:has-text("Paint")');
const box = await page.locator('canvas.map-canvas').boundingBox();
await page.evaluate(() => { const c = window.__client; c.renderer.cam.z = 2.5; c.focusProvince(c.state.countries[c.state.player].capital); c.view.selected = -1; });
await page.waitForTimeout(300);
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx - 120, cy - 10);
await page.mouse.down();
for (let i = 0; i <= 20; i++) await page.mouse.move(cx - 120 + i * 12, cy - 10 + i * 3);
await page.mouse.up();
await page.waitForTimeout(300);
const painted = await page.evaluate(() => window.__client.view.brush?.provs.size || 0);
check(painted >= 2, `brush painted ${painted} provinces`);
const opt = await page.locator('.bulk-scope option').first().textContent();
check(new RegExp(`Painted provinces \\(${painted}\\)`).test(opt), `scope lists the painted set: ${opt}`);
await page.keyboard.press('Escape');
check(await page.evaluate(() => !window.__client.view.brush.on), 'Esc stops painting');
await page.click('.bulk-go');
await page.waitForTimeout(200);
const q2 = await page.evaluate(() => window.__client.state.construction.filter((p) => p.owner === window.__client.state.player).length);
check(q2 >= 1 && q2 <= painted, `painted provinces queued: ${q2}`);
// build where most needed
const needs = await page.locator('.need-card').count();
check(needs >= 1, `${needs} shortfalls offered`);
if (needs) {
  await page.locator('.need-card button').first().click();
  await page.waitForTimeout(200);
  const q3 = await page.evaluate(() => window.__client.state.construction.filter((p) => p.owner === window.__client.state.player).length);
  check(q3 > q2, `most needed queued: ${q2} -> ${q3}`);
}
await page.check('.auto-econ input');
check(await page.evaluate(() => window.__client.state.countries[window.__client.state.player].autoEconomy === true), 'auto-manage economy on');

// --- capitulation notice
await page.evaluate(() => { const c = window.__client, s = c.state; const k = s.player, e = s.countries.findIndex((x) => x.tag === 'BLR');
  s.capitulations = [{ day: s.day, war: 'Test War', country: e, enemy: k, why: '70% of its provinces and its capital occupied', terms: { provinces: ['Minsk'], reparations: true }, separate: false }];
  c.afterTicks(); });
await page.waitForTimeout(200);
check(await page.locator('.dialog', { hasText: 'Belarus capitulates' }).count() === 1, 'capitulation dialog');
await page.click('.dialog button:has-text("OK")');

// --- a victory: the screen, then continue playing
await page.evaluate(() => { const c = window.__client, s = c.state; s.settings.victory.conquest = 0.004; for (let i = 0; i < 40; i++) c.doTick(); c.afterTicks(); });
await page.waitForTimeout(300);
const vd = page.locator('.victory-dialog');
check(await vd.count() === 1, 'victory screen');
check(await vd.locator('.rank-chart, .muted').count() >= 1 && await vd.locator('button:has-text("Continue playing")').count() === 1, 'summary and continue button');
await vd.locator('button:has-text("Continue playing")').click();
const after = await page.evaluate(() => { const c = window.__client; c.setSpeed(5); return { cont: c.state.victory.continued, over: !!c.state.gameOver }; });
await page.waitForTimeout(500);
const d1 = await page.evaluate(() => window.__client.state.day);
await page.waitForTimeout(500);
const d2 = await page.evaluate(() => window.__client.state.day);
check(after.cont && !after.over && d2 > d1, 'the game goes on after the victory');
await page.screenshot({ path: '/tmp/claude-0/np/session23-play.png' });

// --- colonies in Height of Rome
await page.evaluate(() => window.__client.setSpeed(0));
await page.click('.topbar button[aria-label="Menu"]');
await page.click('text=Exit to main menu');
await page.click('text=New Game');
await page.click('.list .item >> text=Height of Rome');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
const target = await page.evaluate(() => {
  const c = window.__client, s = c.state, m = c.game.map;
  c.startPlaying(s.countries.findIndex((x) => x.tag === 'ROM'));
  s.countries[s.player].treasury = 100;
  for (const i of m.ids) {
    if (s.prov.owner[i] !== s.player || s.prov.pop[i] < 1e5) continue;
    for (let e = m.adjStart[i]; e < m.adjStart[i + 1]; e++) if (s.prov.owner[m.adj[e]] < 0) { c.selectProvince(m.adj[e]); return m.adj[e]; }
  }
  return -1;
});
await page.waitForTimeout(300);
check(target >= 0 && await page.locator('.prov-panel', { hasText: 'Unclaimed land' }).count() === 1, 'unowned province panel');
await page.click('.colonise-btn');
await page.waitForTimeout(200);
check(await page.evaluate(() => (window.__client.state.colonies || []).length) === 1, 'colonists sent');
check(await page.locator('.prov-panel', { hasText: 'Our colonists arrive' }).count() === 1, 'progress in the panel');
await page.evaluate(() => window.__client.setTab('industry'));
await page.waitForTimeout(200);
check(await page.locator('text=Colonies under way').count() === 1, 'colonies listed in the Industry tab');
await page.screenshot({ path: '/tmp/claude-0/np/session23-colony.png' });
await browser.close();
if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
console.log('\nall session 23 checks passed');
