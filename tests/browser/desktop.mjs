// Desktop launcher check: the game served by the launcher boots, a quicksave lands in the
// launcher's data folder (not localStorage) and is listed again after a reload.
// Usage: node tests/browser/desktop.mjs [baseUrl] [dataDir]   (requires a running launcher)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://127.0.0.1:47110/';
const dataDir = process.argv[3];
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
const info = await page.evaluate(() => fetch('/api/info').then((r) => r.json()));
check(info.app === 'ages-of-command', `launcher answers /api/info (version ${info.version})`);
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'FRA')); });
await page.waitForTimeout(300);
await page.evaluate(() => window.__client.quickSave());
await page.waitForTimeout(300);
const local = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('save')));
check(local.length === 0, `save not written to browser storage (${local.join(', ') || 'none'})`);
if (dataDir) {
  const files = fs.readdirSync(dataDir + '/store');
  const f = files.find((x) => x.includes('quicksave'));
  check(!!f && fs.statSync(dataDir + '/store/' + f).size > 1000, `quicksave file on disk (${f}, ${f && fs.statSync(dataDir + '/store/' + f).size} bytes)`);
}
await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.click('text=Load Game');
await page.waitForTimeout(300);
const listed = await page.evaluate(() => document.body.textContent.includes('quicksave'));
check(listed, 'quicksave listed after reload');
await page.click('.list .item:has-text("quicksave") button:has-text("Load")');
await page.waitForFunction(() => window.__client && window.__client.state, null, { timeout: 20000 });
await page.waitForTimeout(300);
const loaded = await page.evaluate(() => window.__client && window.__client.state && window.__client.state.countries[window.__client.state.player]?.tag);
check(loaded === 'FRA', `quicksave loads (playing ${loaded})`);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
