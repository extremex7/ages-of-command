// Rendering benchmark in headless Chromium (software rasteriser — a pessimistic stand-in for
// integrated graphics). Measures boot, frame times while panning/zooming, base-layer renders,
// simulation speed at max speed, and JS heap, for each performance profile at 1366×768.
// Usage: node tests/browser/bench.mjs [baseUrl]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const base = process.argv[2] || 'http://localhost:8080/';
const throttle = +(process.env.CPU_THROTTLE || 1); // e.g. CPU_THROTTLE=4 emulates a ~4x slower CPU
const browser = await pw.chromium.launch({ args: ['--enable-precise-memory-info'] });
const results = [];
for (const profile of ['low', 'balanced', 'high']) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  if (throttle > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  await page.addInitScript((p) => localStorage.setItem('aoc3.settings', JSON.stringify({ profile: p })), profile);
  const t0 = Date.now();
  await page.goto(base);
  await page.waitForSelector('text=New Game');
  const boot = Date.now() - t0;
  const menuHeap = await page.evaluate(() => performance.memory.usedJSHeapSize / 1048576);
  await page.click('text=New Game');
  await page.click('text=Choose country');
  await page.waitForSelector('.pick-banner');
  await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'DEU')); });
  await page.waitForTimeout(500);
  // pan + zoom interaction measured with rAF timestamps
  const interact = await page.evaluate(async () => {
    const c = window.__client, r = c.renderer;
    const times = [];
    let last = performance.now();
    const base0 = r.stats.baseRenders;
    for (let i = 0; i < 180; i++) {
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now(); times.push(now - last); last = now;
      if (i < 60) r.pan(6, 2); else if (i < 120) r.zoomAt(683, 384, 1.02); else r.pan(-8, 0);
      c.requestFrame();
    }
    times.sort((a, b) => a - b);
    return { avgMs: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], baseRenders: r.stats.baseRenders - base0, baseMs: r.stats.baseMs, zoom: r.cam.z };
  });
  // fully zoomed-out world view base render cost
  const world = await page.evaluate(() => { const r = window.__client.renderer; r.fit(); r.invalidate(); r.draw(window.__client.state, window.__client.view); return r.stats.baseMs; });
  // max speed simulation for 5 seconds while rendering; the AI answers events and offers so no dialog pauses the clock
  await page.evaluate(() => { const s = window.__client.state; s.countries[s.player].automate = true; });
  await page.keyboard.press('5');
  await page.waitForTimeout(5000);
  await page.keyboard.press(' ');
  const sim = await page.evaluate(() => ({ days: window.__client.perf.ticks, tickMs: window.__client.perf.tickMs }));
  const heap = await page.evaluate(() => performance.memory.usedJSHeapSize / 1048576);
  // idle check: paused game should schedule no frames
  const idle = await page.evaluate(async () => { const c = window.__client; const f0 = c.perf.frames; await new Promise((r) => setTimeout(r, 1000)); return c.perf.frames - f0; });
  results.push({ profile, bootMs: boot, menuHeapMB: +menuHeap.toFixed(1), fps: +(1000 / interact.avgMs).toFixed(1), p95FrameMs: +interact.p95.toFixed(1),
    baseRenderMs: +interact.baseMs.toFixed(1), worldBaseMs: +world.toFixed(1), simDaysIn5s: sim.days, heapMB: +heap.toFixed(1), framesWhilePausedIdle1s: idle });
  await ctx.close();
}
console.log(`CPU throttle: ${throttle}x`);
console.table(results);
await browser.close();
