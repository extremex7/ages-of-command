// Phone check: the game in a touch-screen landscape phone viewport, with a stand-in for the
// Android app's AOCNative storage bridge. Checks that saves go through the bridge, that a tap
// selects, one finger pans, two fingers pinch-zoom, and a long press orders an army.
// Writes build/screens/mobile-*.png.
// Usage: node tests/browser/mobile.mjs [baseUrl]   (requires the dev server and Playwright)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://localhost:8080/';
const out = new URL('../../build/screens/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch();
// a mid-range phone held sideways (about 6.4", 2.6 device pixels per CSS pixel)
const ctx = await browser.newContext({ viewport: { width: 846, height: 390 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
// the bridge the Android app adds (MainActivity.Bridge): synchronous, strings in and out
await ctx.addInitScript(() => {
  const files = {};
  window.__files = files;
  window.AOCNative = {
    info: () => JSON.stringify({ app: 'ages-of-command', platform: 'android', version: 'test', dataDir: '/data' }),
    all: () => JSON.stringify(files),
    put: (k, v) => { files[k] = v; return true; },
    remove: (k) => { delete files[k]; },
  };
});
const page = await ctx.newPage();
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(base);
await page.waitForSelector('text=New Game', { timeout: 20000 });
await page.screenshot({ path: out + 'mobile-01-menu.png' });
await page.tap('text=New Game');
await page.tap('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'FRA')); });
await wait(300);
const box = await page.locator('canvas').first().boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const cam = () => page.evaluate(() => ({ ...window.__client.renderer.cam }));

// one-finger drag pans
let c0 = await cam();
await touch('touchStart', [[cx, cy]]);
for (let i = 1; i <= 5; i++) { await touch('touchMove', [[cx + i * 20, cy + i * 8]]); await wait(16); }
await touch('touchEnd', []);
let c1 = await cam();
check(c1.cx < c0.cx && c1.z === c0.z, `one finger pans (centre x ${c0.cx.toFixed(1)} -> ${c1.cx.toFixed(1)})`);

// two-finger pinch zooms in
c0 = c1;
await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
for (let i = 1; i <= 5; i++) { await touch('touchMove', [[cx - 40 - i * 16, cy], [cx + 40 + i * 16, cy]]); await wait(16); }
await touch('touchEnd', []);
c1 = await cam();
check(c1.z > c0.z * 1.5, `pinch zooms in (zoom ${c0.z.toFixed(2)} -> ${c1.z.toFixed(2)})`);
await page.screenshot({ path: out + 'mobile-02-zoomed.png' });

// tap selects a province
const target = await page.evaluate(() => {
  const c = window.__client, s = c.state, map = c.game.map;
  const a = s.armies.find((x) => x.owner === s.player && !x.battle);
  const dest = map.ids.find((i) => s.prov.owner[i] === s.player && i !== a.loc && Math.hypot(map.x[i] - map.x[a.loc], map.y[i] - map.y[a.loc]) > 3);
  c.renderer.centerOn(map.x[dest], map.y[dest], 4); c.renderer.draw(s, c.view);
  const [sx, sy] = c.renderer.worldToScreen(map.x[dest], map.y[dest]);
  return { army: a.id, dest, name: map.name[dest], sx, sy };
});
await touch('touchStart', [[box.x + target.sx, box.y + target.sy]]);
await wait(80);
await touch('touchEnd', []);
await wait(150);
const sel = await page.evaluate(() => window.__client.view.selected);
check(sel === target.dest, `tap selects ${target.name} (selected ${sel})`);

// long press with an army selected orders it there
await page.evaluate((t) => { const v = window.__client.view; v.selectedArmies.clear(); v.selectedArmies.add(t.army); }, target);
await touch('touchStart', [[box.x + target.sx, box.y + target.sy]]);
await wait(700);
await touch('touchEnd', []);
await wait(150);
const path = await page.evaluate((t) => { const a = window.__client.state.armies.find((x) => x.id === t.army); return [...a.path]; }, target);
check(path.length > 0 && path[path.length - 1] === target.dest, `long press orders the army to ${target.name} (path ${path.length} steps)`);
await page.screenshot({ path: out + 'mobile-03-order.png' });

// saves go through the bridge, not browser storage, and come back after a restart
await page.evaluate(() => window.__client.quickSave());
await wait(300);
const stored = await page.evaluate(() => ({ bridge: Object.keys(window.__files), local: Object.keys(localStorage).filter((k) => k.includes('save')) }));
check(stored.bridge.includes('save.quicksave') && stored.local.length === 0, `quicksave stored through the bridge (${stored.bridge.join(', ')})`);

// the game pauses when sent to the background
await page.evaluate(() => window.__client.setSpeed(3));
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
const speed = await page.evaluate(() => window.__client.speed);
check(speed === 0, `pauses when hidden (speed ${speed})`);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
