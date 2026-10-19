// Milestone 6 check in headless Chromium: navies, air wings, supply, the Strategic tab and the
// naval and supply map modes, in the Modern World and both future scenarios. Writes screenshots
// to build/screens/ (m6-*.png).
// Usage: node tests/browser/m6.mjs [baseUrl]   (requires the dev server and Playwright)
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

async function start(scenario, tag) {
  await page.goto(base);
  await page.waitForSelector('text=New Game', { timeout: 20000 });
  await page.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; }); // no tutorial offer in tests
  await page.click('text=New Game');
  if (scenario) await page.click(`.list .item:has-text("${scenario}")`);
  await page.waitForTimeout(150);
  await page.click('text=Choose country');
  await page.waitForSelector('.pick-banner');
  await page.evaluate((t) => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === t)); }, tag);
  await page.waitForTimeout(300);
}

// --- Modern World as the United States
await start(null, 'USA');
await page.keyboard.press('m');
await page.waitForTimeout(200);
const mil = await page.evaluate(() => ({ cards: document.querySelectorAll('.panel .army-card').length, text: document.querySelector('.panel').textContent }));
check(/Fleets \(\d+\)/.test(mil.text) && /Air wings \(\d+\)/.test(mil.text), 'military tab lists fleets and air wings');
await page.screenshot({ path: out + 'm6-01-military.png' });
// navy recruitment list
await page.click('.panel button:has-text("Navy")');
await page.waitForTimeout(150);
const navy = await page.evaluate(() => [...document.querySelectorAll('.panel table.t td:first-child')].map((x) => x.textContent));
check(navy.some((n) => /Carrier|Destroyer|Submarine/.test(n)), `navy recruit list shows warships (${navy.slice(0, 4).join(', ')})`);
await page.click('.panel button:has-text("Air")');
await page.waitForTimeout(150);
const air = await page.evaluate(() => [...document.querySelectorAll('.panel table.t td:first-child')].map((x) => x.textContent));
check(air.some((n) => /Fighter|Bomber|Drone/.test(n)), `air recruit list shows aircraft (${air.slice(0, 4).join(', ')})`);
// select a docked fleet and right-click open sea to sail
const order = await page.evaluate(() => {
  const c = window.__client, s = c.state, map = c.game.map;
  const f = s.fleets.find((x) => x.owner === s.player && x.port >= 0 && !x.battle);
  c.view.selectedFleets.clear(); c.view.selectedFleets.add(f.id);
  // a neighbouring zone of the fleet's zone
  const S = map.sea, z = S.adj[S.start[f.zone]];
  const zz = S.zones[z];
  c.renderer.centerOn(zz.x, zz.y, 1.5);
  c.renderer.draw(s, c.view);
  const [sx, sy] = c.renderer.worldToScreen(zz.x, zz.y);
  return { id: f.id, zone: z, name: zz.name, sx, sy };
});
const r0 = await page.locator('canvas').first().boundingBox();
await page.mouse.click(r0.x + order.sx, r0.y + order.sy, { button: 'right' });
const sail = await page.evaluate((o) => { const f = window.__client.state.fleets.find((x) => x.id === o.id); return { path: [...f.path], port: f.port }; }, order);
check(sail.path.length > 0 && sail.path[sail.path.length - 1] === order.zone, `right-click orders the fleet to the ${order.name} (path ${sail.path.join(',')})`);
// wing mission change through the card's select
const wingOk = await page.evaluate(() => {
  const c = window.__client, s = c.state;
  const w = s.wings.find((x) => x.owner === s.player);
  c.view.selectedWings.add(w.id); c.uiDirty = true; c.requestFrame();
  return w.id;
});
await page.waitForTimeout(200);
const sel = page.locator('.panel .army-card select').first();
await sel.selectOption('support');
const mission = await page.evaluate(() => { const s = window.__client.state; return s.wings.find((x) => x.owner === s.player).mission; });
check(mission === 'support', `wing mission set from the card (${mission})`);
await page.screenshot({ path: out + 'm6-02-fleets.png' });
// amphibious move: an army ordered to Hawaii goes by sea
const amph = await page.evaluate(() => {
  const c = window.__client, s = c.state, map = c.game.map;
  const a = s.armies.find((x) => x.owner === s.player && !x.battle);
  const p = map.ids.find((i) => map.name[i] === 'Hawaii');
  c.view.selectedFleets.clear(); c.view.selectedWings.clear(); c.view.selectedArmies.clear(); c.view.selectedArmies.add(a.id);
  c.renderer.centerOn(map.x[p], map.y[p], 3); c.renderer.draw(s, c.view);
  const [sx, sy] = c.renderer.worldToScreen(map.x[p], map.y[p]);
  return { id: a.id, p, sx, sy };
});
await page.mouse.click(r0.x + amph.sx, r0.y + amph.sy, { button: 'right' });
const apath = await page.evaluate((o) => { const s = window.__client.state, map = window.__client.game.map; const a = s.armies.find((x) => x.id === o.id); return { sea: a.path.filter((n) => n >= map.count).length, last: a.path[a.path.length - 1] }; }, amph);
check(apath.sea > 0 && apath.last === amph.p, `army ordered to Hawaii sails (${apath.sea} sea zones on the route)`);
await page.evaluate(() => { const c = window.__client; c.renderer.fit(); c.requestFrame(); });
await page.keyboard.press('5'); await page.waitForTimeout(700); await page.keyboard.press(' ');
while (await page.locator('.dialog .menu-buttons button').count()) { await page.locator('.dialog .menu-buttons button').first().click(); await page.waitForTimeout(100); }
await page.evaluate(() => window.__client.setSpeed(0)); // the game resumes after event decisions; these steps need it paused
const atSea = await page.evaluate((o) => { const a = window.__client.state.armies.find((x) => x.id === o.id); return a ? a.sea : null; }, amph);
check(atSea != null, `army still exists after sailing a while (at sea: ${atSea >= 0})`);
await page.screenshot({ path: out + 'm6-02b-amphibious.png' });
// map modes
for (const [key, mode] of [['s', 'naval'], ['w', 'supply']]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => window.__client.renderer.mode);
  check(m === mode, `${mode} map mode opens with key ${key}`);
  await page.evaluate(() => { const r = window.__client.renderer; r.fit(); r.invalidate(); window.__client.requestFrame(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + `m6-03-${mode}.png` });
}
await page.keyboard.press('p');
// strategic tab
await page.keyboard.press('z');
await page.waitForTimeout(200);
const strat = await page.evaluate(() => document.querySelector('.panel').textContent);
check(/Nuclear weapons/.test(strat) && /Warheads/.test(strat) && /Satellites and space/.test(strat), 'Strategic tab shows the arsenal and satellites');
await page.screenshot({ path: out + 'm6-04-strategic.png' });
// launch a satellite from the tab
const before = await page.evaluate(() => { const s = window.__client.state; return s.countries[s.player].strat.sats.recon; });
await page.locator('.panel table.t tr:has-text("Reconnaissance") button').click();
const after = await page.evaluate(() => { const s = window.__client.state; return s.countries[s.player].strat.sats.recon; });
check(after === before + 1, `satellite launched (${before} -> ${after})`);
// war with Russia: the province panel offers a nuclear strike behind a confirmation dialog
const target = await page.evaluate(async () => {
  const c = window.__client, s = c.state, map = c.game.map;
  const k = s.countries.findIndex((x) => x.tag === 'RUS');
  const { declareWar } = await import('/src/core/war.js');
  const err = declareWar(s, map, c.game.rules, s.player, k);
  if (err) throw new Error(err);
  const p = map.ids.find((i) => s.prov.owner[i] === k && s.prov.controller[i] === k && map.name[i] === 'Moskva') ?? map.ids.find((i) => s.prov.owner[i] === k);
  c.focusProvince(p);
  return { p, pop: s.prov.pop[p] };
});
await page.waitForTimeout(300);
const btn = page.locator('button:has-text("Nuclear strike")');
check(await btn.count() === 1 && !(await btn.isDisabled()), 'province panel offers a nuclear strike in war');
await btn.click();
await page.waitForSelector('.dialog');
await page.screenshot({ path: out + 'm6-05-strike-dialog.png' });
await page.click('.dialog button:has-text("Cancel")');
const still = await page.evaluate((t) => window.__client.state.prov.pop[t.p], target);
check(still === target.pop, 'cancelling the strike changes nothing');
// run a few weeks of the war at max speed and make sure nothing breaks
await page.evaluate(() => { const s = window.__client.state; s.countries[s.player].automate = true; });
await page.keyboard.press('5'); await page.waitForTimeout(2500); await page.keyboard.press(' ');
while (await page.locator('.dialog .menu-buttons button').count()) { await page.locator('.dialog .menu-buttons button').first().click(); await page.waitForTimeout(100); }
await page.evaluate(() => window.__client.setSpeed(0)); // the game resumes after event decisions; these steps need it paused
await page.keyboard.press('m'); await page.waitForTimeout(200);
await page.screenshot({ path: out + 'm6-06-war.png' });

// --- the future scenarios
for (const [name, tag, shot] of [['Flashpoint', 'CHN', 'm6-07-flashpoint.png'], ['Orbital Age', 'USA', 'm6-08-orbital.png']]) {
  await start(name, tag);
  const info = await page.evaluate(() => { const c = window.__client, s = c.state; return { id: s.scenarioId, fleets: s.fleets.filter((f) => f.owner === s.player).length, wings: s.wings.filter((w) => w.owner === s.player).length, warheads: s.countries[s.player].strat.warheads }; });
  check(info.fleets > 0 && info.wings > 0, `${info.id}: ${tag} starts with ${info.fleets} fleets, ${info.wings} wings, ${info.warheads} warheads`);
  await page.keyboard.press('z'); await page.waitForTimeout(200);
  await page.evaluate(() => { const s = window.__client.state; s.countries[s.player].automate = true; });
  await page.keyboard.press('5'); await page.waitForTimeout(2000); await page.keyboard.press(' ');
  while (await page.locator('.dialog .menu-buttons button').count()) { await page.locator('.dialog .menu-buttons button').first().click(); await page.waitForTimeout(100); }
  await page.evaluate(() => window.__client.setSpeed(0)); // the game resumes after event decisions; these steps need it paused
  await page.screenshot({ path: out + shot });
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
