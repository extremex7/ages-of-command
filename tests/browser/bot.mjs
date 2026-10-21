// The bot window (bot.html, docs/BOT.md) against the dev server (saves in browser storage) or
// the desktop launcher (saves in its data folder):
// - a game is saved, the bot window lists it and plays it for a year;
// - the bot's save is a new slot "Bot – <country> <date>" and the source save is unchanged;
// - a game window opened BEFORE the bot ran lists the bot's save in Load Game (it re-reads the
//   list), saving there keeps the bot's slot, and the bot's save loads with the player in control.
// Usage: node tests/browser/bot.mjs [baseUrl] [dataDir]
//   dev server: node tools/serve.mjs 8080; node tests/browser/bot.mjs http://localhost:8080/
//   launcher:   AgesOfCommand -no-window -data DIR; node tests/browser/bot.mjs http://127.0.0.1:47110/ DIR
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const base = process.argv[2] || 'http://localhost:8080/';
const dataDir = process.argv[3];
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) errors.push(what); };
const watch = (p, tag) => {
  p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
};

// the game window: a new game as France, saved as "mine"
const game = await ctx.newPage();
watch(game, 'game');
await game.goto(base);
await game.waitForSelector('text=New Game', { timeout: 30000 });
const desktop = await game.evaluate(() => fetch('/api/info').then((r) => r.ok && r.json()).then((j) => j?.app === 'ages-of-command', () => false));
console.log(desktop ? 'desktop launcher (data folder)' : 'dev server (browser storage)');
await game.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });
await game.click('text=New Game');
await game.click('text=Choose country');
await game.waitForSelector('.pick-banner');
await game.evaluate(() => { const c = window.__client; c.startPlaying(c.state.countries.findIndex((x) => x.tag === 'FRA')); });
await game.waitForTimeout(300);
const saveErr = await game.evaluate(async () => {
  const { writeSave } = await import('/src/ui/storage.js');
  const { saveGame } = await import('/src/core/game.js');
  const c = window.__client;
  return writeSave('mine', saveGame(c.game, { savedAt: Date.now() }), c.slotInfo());
});
check(!saveErr, `game saved as "mine" ${saveErr || ''}`);
// back to the main menu: this window now holds the slot list as it was before the bot ran
await game.evaluate(() => window.__client.opts.onExit());
await game.waitForSelector('text=Load Game');
const readSlot = (p, name) => p.evaluate(([n, d]) => (d ? fetch('/api/store/' + encodeURIComponent('save.' + n), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null))
  : localStorage.getItem('aoc3.save.' + n)), [name, desktop]);
const before = await readSlot(game, 'mine');
check(!!before && before.length > 1000, `source save stored (${before?.length} chars)`);

// the bot window
const bot = await ctx.newPage();
watch(bot, 'bot');
await bot.goto(base + 'bot.html');
await bot.waitForSelector('#bot-start', { timeout: 30000 });
check(await bot.locator('.list .item[data-slot="mine"]').count() === 1, 'bot window lists the save');
check(await bot.evaluate(() => window.__bot.pick) === 'mine', 'newest save picked by default');
await bot.selectOption('#bot-years', '1');
await bot.selectOption('#bot-cpu', '1');
const t0 = Date.now();
await bot.click('#bot-start');
await bot.waitForSelector('#bot-stop', { timeout: 60000 });
check(await bot.evaluate(() => window.__bot.where) === 'worker', 'bot started, simulation in a Web Worker');
await bot.waitForFunction(() => /Saved as/.test(document.querySelector('#bot-status')?.textContent || ''), null, { timeout: 180000 });
const status = await bot.textContent('#bot-status');
console.log('     ' + status.trim(), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const m = /Saved as "([^"]+)"/.exec(status);
const botSlot = m?.[1];
check(/^Bot – France \d+ \w+ 2027$/.test(botSlot || ''), `bot slot named "${botSlot}"`);
check(/Played the 1 year/.test(status), 'ran the year asked for');
check(await bot.locator('.bot-table').count() === 1, 'progress table shown');
const after = await readSlot(bot, 'mine');
check(after === before, 'source save unchanged');

// a stop request mid-run saves and hands back too
await bot.click('#bot-again');
await bot.waitForSelector('#bot-start');
await bot.selectOption('#bot-years', '0');
await bot.click('.list .item[data-slot="mine"]');
await bot.click('#bot-start');
await bot.waitForSelector('#bot-stop', { timeout: 60000 });
await bot.waitForTimeout(2500);
await bot.click('#bot-stop');
await bot.waitForFunction(() => /Saved as/.test(document.querySelector('#bot-status')?.textContent || ''), null, { timeout: 60000 });
const stopped = await bot.textContent('#bot-status');
check(/^Stopped\./.test(stopped.trim()), `stop saves: ${stopped.trim().slice(0, 80)}`);

// without Web Workers the bot runs on the page itself
const nw = await ctx.newPage();
watch(nw, 'no-worker');
await nw.addInitScript(() => { window.Worker = undefined; });
await nw.goto(base + 'bot.html');
await nw.waitForSelector('#bot-start', { timeout: 30000 });
await nw.click('.list .item[data-slot="mine"]');
await nw.selectOption('#bot-years', '1');
await nw.click('#bot-start');
await nw.waitForFunction(() => /Saved as/.test(document.querySelector('#bot-status')?.textContent || ''), null, { timeout: 180000 });
check(await nw.evaluate(() => window.__bot.where) === 'page', 'without workers the bot runs on the page and saves');
const third = /Saved as "([^"]+)"/.exec(await nw.textContent('#bot-status'))?.[1];
await nw.evaluate(async (n) => { const { deleteSave } = await import('/src/ui/storage.js'); await deleteSave(n); }, third);
await nw.close();

// the game window opened before: Load Game re-reads the list
await game.click('text=Load Game');
await game.waitForSelector('text=Import a save file');
const listed = await game.evaluate(() => [...document.querySelectorAll('.list .item b')].map((b) => b.textContent));
check(listed.includes(botSlot), `game's Load Game lists the bot save (${listed.join(' | ')})`);
check(listed.filter((n) => n.startsWith('Bot – ')).length === 2, 'two bot runs, one slot each');
// saving from the game window keeps the bot's slots
await game.evaluate(async () => {
  const { writeSave } = await import('/src/ui/storage.js');
  await writeSave('another', '{"x":1}', { savedAt: Date.now(), country: 'x' });
});
const slotsNow = await game.evaluate(async (d) => JSON.parse(d ? await fetch('/api/store/slots', { cache: 'no-store' }).then((r) => r.text()) : localStorage.getItem('aoc3.slots')), desktop);
check(slotsNow.some((s) => s.name === botSlot) && slotsNow.some((s) => s.name === 'another') && slotsNow.some((s) => s.name === 'mine'), 'a save from the game window keeps the bot slot in the list');
await game.evaluate(async () => { const { deleteSave } = await import('/src/ui/storage.js'); await deleteSave('another'); });
if (desktop && dataDir) {
  const files = fs.readdirSync(dataDir + '/store').filter((f) => f.startsWith('save.Bot'));
  check(files.length === 2, `bot saves on disk (${files.join(', ')})`);
}
// load the bot save: France, under the player's control
await game.goto(base);
await game.waitForSelector('text=Load Game', { timeout: 30000 });
await game.evaluate(() => { window.__aoc3.settings.tutorial = 'off'; });
await game.click('text=Load Game');
await game.waitForSelector('text=Import a save file');
await game.click(`.list .item:has-text("${botSlot}") button:has-text("Load")`);
await game.waitForFunction(() => window.__client?.state, null, { timeout: 30000 });
const loaded = await game.evaluate(() => { const s = window.__client.state, c = s.countries[s.player]; return { tag: c?.tag, automate: c?.automate, profile: c?.aiProfile ?? null, year: new Date((s.day) * 864e5).getUTCFullYear() }; });
check(loaded.tag === 'FRA' && loaded.automate === false && loaded.profile === null && loaded.year === 2027, `bot save loads with the player in control (${JSON.stringify(loaded)})`);

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
