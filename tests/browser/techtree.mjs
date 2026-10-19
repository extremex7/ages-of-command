// Top-bar points, the technology tree (lines, pan, zoom, pinch, select and queue) and sound
// (every music mood renders audibly, moods follow the country, the Sound settings exist).
// Usage: node tests/browser/techtree.mjs [baseUrl]   (requires the dev server and Playwright)
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
await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; }); // no tutorial offer in tests
await page.click('text=New Game');
await page.click('text=Choose country');
await page.waitForSelector('.pick-banner');
await page.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'FRA')); c.game.state.settings.eventRate = 0; });
await page.waitForTimeout(300);

// top bar
const top = await page.locator('.topbar').textContent();
check(/Influence/.test(top) && /Research/.test(top), 'top bar shows Influence and Research');
const inf = await page.evaluate(() => Math.floor(window.__client.state.countries[window.__client.state.player].influence));
check(top.includes(inf + 'Influence'), `influence value ${inf} shown`);
await page.locator('.topbar .stat', { hasText: 'Influence' }).click();
check(await page.evaluate(() => window.__client.tab) === 'diplomacy', 'clicking Influence opens the Diplomacy tab');
await page.locator('.topbar .stat', { hasText: 'Research' }).click();
check(await page.evaluate(() => window.__client.tab) === 'research', 'clicking Research opens the Research tab');

// technology tree
await page.click('text=Technology tree');
await page.waitForSelector('.tt-node');
const counts = await page.evaluate(() => ({ nodes: document.querySelectorAll('.tt-node').length, lines: document.querySelectorAll('.tt-lines path').length,
  techs: window.__client.game.rules.tech.list.length, reqs: window.__client.game.rules.tech.list.reduce((n, t) => n + t.reqI.length, 0),
  icons: document.querySelectorAll('.tt-node .icon svg').length }));
check(counts.nodes === counts.techs && counts.icons === counts.techs, `${counts.nodes} technologies, each with an icon`);
check(counts.lines === counts.reqs, `${counts.lines} prerequisite lines`);
const tf = () => page.evaluate(() => document.querySelector('.tt-world').style.transform);
const vp = await page.locator('.tt-viewport').boundingBox();
const t0 = await tf();
await page.mouse.move(vp.x + 300, vp.y + 200); await page.mouse.down(); await page.mouse.move(vp.x + 500, vp.y + 260, { steps: 6 }); await page.mouse.up();
const t1 = await tf();
check(t1 !== t0, 'dragging pans the tree');
await page.mouse.wheel(0, 400); await page.waitForTimeout(100);
const z = (t) => +/scale\(([\d.]+)\)/.exec(t)[1];
const t2 = await tf();
check(z(t2) < z(t1), `wheel zooms out (${z(t1).toFixed(2)} -> ${z(t2).toFixed(2)})`);
// two-finger pinch with touch pointer events
const zp = await page.evaluate(() => {
  const el = document.querySelector('.tt-viewport'), r = el.getBoundingClientRect();
  const ev = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1 }));
  ev('pointerdown', 1, 300, 200); ev('pointerdown', 2, 400, 200);
  for (let i = 1; i <= 5; i++) { ev('pointermove', 1, 300 - i * 20, 200); ev('pointermove', 2, 400 + i * 20, 200); }
  ev('pointerup', 1, 200, 200); ev('pointerup', 2, 500, 200);
  return document.querySelector('.tt-world').style.transform;
});
check(z(zp) > z(t2) * 1.5, `pinch zooms in (${z(t2).toFixed(2)} -> ${z(zp).toFixed(2)})`);
await page.click('button[aria-label="Show the whole tree"]');
const nb = await page.locator('.tt-node', { hasText: 'Fusion Power' }).boundingBox();
await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
const info = await page.locator('.tt-info').textContent();
check(/Fusion Power/.test(info) && /Requires/.test(info), 'clicking a technology shows its details');
const hl = await page.evaluate(() => ({ chain: document.querySelectorAll('.tt-lines path.chain').length, sel: document.querySelectorAll('.tt-node.sel').length }));
check(hl.sel === 1 && hl.chain > 3, `its prerequisite chain is highlighted (${hl.chain} lines)`);
await page.locator('.tt-info button', { hasText: /queue/i }).click();
const cur = await page.evaluate(() => { const r = window.__client.state.countries[window.__client.state.player].research; return [r.current, ...r.queue]; });
check(cur.includes('fusion_power'), `queueing it queues its prerequisites first (${cur.join(', ')})`);
await page.locator('.tt-dialog button', { hasText: 'Close' }).click();

// sound
const snd = await page.evaluate(async () => {
  const a = await import('./src/ui/audio.js');
  const out = {};
  for (const m of a.MOOD_LIST) {
    const buf = await a.renderMood(m, 6), d = buf.getChannelData(0);
    let s = 0, p = 0; for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; p = Math.max(p, Math.abs(d[i])); }
    out[m] = { rms: Math.sqrt(s / d.length), peak: p };
  }
  const c = window.__client, st = c.state, me = st.player;
  const was = a.moodFor(st, me);
  const enemy = st.countries.findIndex((x) => x.tag === 'DEU' || x.tag === 'GER');
  st.wars.push({ attackers: [enemy], defenders: [me] });
  const war = a.moodFor(st, me);
  st.wars.pop();
  const stab = st.countries[me].stability; st.countries[me].stability = 20;
  const crisis = a.moodFor(st, me); st.countries[me].stability = stab;
  return { out, was, war, crisis };
});
for (const [m, r] of Object.entries(snd.out)) check(r.rms > 0.01 && r.peak < 1, `music "${m}" renders (rms ${r.rms.toFixed(3)}, peak ${r.peak.toFixed(2)})`);
check(snd.war === 'war' && snd.crisis === 'crisis', `mood follows the country (${snd.was} in peace, ${snd.war} at war, ${snd.crisis} at stability 20)`);
await page.click('.topbar button:has-text("Menu")');
await page.click('.dialog button:has-text("Settings")');
const st = await page.locator('.dialog').textContent();
check(/Music/.test(st) && /Sound effects/.test(st), 'Settings has Music and Sound effects volumes');

await browser.close();
if (errors.length) { console.log('\n' + errors.length + ' problem(s)'); process.exit(1); }
console.log('\nall checks passed');
