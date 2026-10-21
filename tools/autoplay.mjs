// The bot on the command line (needs Node.js 18+): plays the player's country in a save while you
// are away, like the bot window (bot.html, docs/BOT.md), and writes the result as a new save.
//
//   node tools/autoplay.mjs --save <slot name | file> [--data <store folder>] [--years N] [--cpu 0.5]
//                           [--out <file>] [--quiet]
//
// --save   a save slot name from the data folder ("quicksave", "autosave-1450-01-01"…), or a save
//          file (an exported .aoc3.json, or a store file such as save.quicksave.dat).
// --data   the folder holding the saves: the desktop app's "store" folder (or the data folder
//          above it). Default: the desktop app's folder (%APPDATA%\AgesOfCommand on Windows,
//          ~/.config/AgesOfCommand on Linux, ~/Library/Application Support/AgesOfCommand on macOS).
// --years  how long to play (default: until Ctrl+C).
// --cpu    share of one processor core to use, 0.05–1 (default 1).
// --out    write the result to this file (plain JSON, loadable with Load Game → Import) instead of
//          a new slot in the data folder.
// Slots are written as "Bot – <country> <date>" every in-game year and at the end, replacing
// the run's previous one; the save it started from is never changed. Close the game while the
// bot writes to its folder, or at least reopen Load Game afterwards (it re-reads the list).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadGameData, loadSaveText } from '../src/bot/data.js';
import { Autoplay, botSlotName, botSlotInfo } from '../src/bot/autoplay.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) { console.error(`Unexpected argument ${a}`); process.exit(2); }
  const k = a.slice(2);
  if (k === 'quiet' || k === 'help') args[k] = true;
  else args[k] = process.argv[++i];
}
if (args.help || !args.save) {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(args.help ? 0 : 2);
}

// --- the desktop app's store: one file per key, named as launcher/main.go keyFile() does
function keyFile(key) {
  let s = '';
  for (const b of Buffer.from(key, 'utf8')) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9_-]/.test(c) || (c === '.' && s.length > 0)) s += c;
    else s += '~' + b.toString(16).padStart(2, '0');
  }
  return s + '.dat';
}
function defaultStore() {
  const home = os.homedir();
  const base = process.platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'AgesOfCommand', 'store');
}
function storeDir(d) {
  if (!d) return defaultStore();
  return fs.existsSync(path.join(d, 'store')) ? path.join(d, 'store') : d;
}
const store = storeDir(args.data);
const readKey = (k) => { try { return fs.readFileSync(path.join(store, keyFile(k)), 'utf8'); } catch { return null; } };
function writeKey(k, v) { // a temporary file renamed into place, as the launcher does
  const f = path.join(store, keyFile(k));
  fs.writeFileSync(f + '.tmp', v);
  fs.renameSync(f + '.tmp', f);
}
const removeKey = (k) => { try { fs.unlinkSync(path.join(store, keyFile(k))); } catch { /* gone */ } };
const decode = (data) => (data.startsWith('gz:') ? zlib.gunzipSync(Buffer.from(data.slice(3), 'base64')).toString('utf8') : data);
const encode = (text) => 'gz:' + zlib.gzipSync(text).toString('base64');
const slots = () => { try { return JSON.parse(readKey('slots') || '[]'); } catch { return []; } };

// --- the save to play
let text = null, fromSlot = null;
if (fs.existsSync(args.save) && fs.statSync(args.save).isFile()) text = decode(fs.readFileSync(args.save, 'utf8'));
else {
  const data = readKey('save.' + args.save);
  if (data == null) {
    const names = slots().map((s) => s.name);
    console.error(`No save "${args.save}" in ${store}.${names.length ? ' Saves there: ' + names.join(', ') : ''}`);
    process.exit(1);
  }
  text = decode(data);
  fromSlot = args.save;
}

const ROOT = new URL('../', import.meta.url);
const json = async (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT)));
const data = await loadGameData(json);
const game = await loadSaveText(data, text, async (id) => { const v = readKey('scenario.' + id); return v ? JSON.parse(decode(v)) : null; });
const bot = new Autoplay(game, { years: +args.years || 0 }).start();
const say = (...a) => { if (!args.quiet) console.log(...a); };
say(`Bot playing ${bot.from.name} from ${bot.from.date} (${game.state.scenarioName})${bot.years ? ` for ${bot.years} years` : ' until Ctrl+C'}.`);
for (const d of bot.decisions) say('  answered: ' + d);

let mySlot = null;
function save(final) {
  const s = game.state;
  const out = final ? bot.stop(stopReason || 'Stopped.') : bot.save();
  if (args.out) { fs.writeFileSync(args.out, out); return args.out; }
  const list = slots();
  const name = botSlotName(s, list.map((x) => x.name).filter((n) => n !== mySlot).concat(fromSlot ? [fromSlot] : []));
  const enc = encode(out);
  writeKey('save.' + name, enc);
  const fresh = slots().filter((x) => x.name !== name && x.name !== mySlot);
  fresh.unshift({ name, ...botSlotInfo(s), size: enc.length });
  writeKey('slots', JSON.stringify(fresh));
  if (mySlot && mySlot !== name && mySlot !== fromSlot) removeKey('save.' + mySlot);
  mySlot = name;
  return `slot "${name}" in ${store}`;
}

const line = (r) => {
  const n = r.now;
  return `${n.date}: ${n.provinces} provinces, GDP ${n.gdp.toFixed(1)}B, treasury ${n.treasury.toFixed(1)}B, rank #${n.rank}, score ${n.score.toFixed(1)}, ${n.techs} techs, wars won ${r.record.warsWon} lost ${r.record.warsLost}`;
};
let stopReason = null, stopAsked = false;
process.on('SIGINT', () => { if (stopAsked) process.exit(130); stopAsked = true; stopReason = 'Stopped with Ctrl+C.'; say('\nStopping…'); });
const cpu = Math.max(0.05, Math.min(1, +args.cpu || 1));
await bot.run({
  cpu, shouldStop: () => stopAsked,
  onYear: () => { const where = save(false); say(line(bot.report()) + ` (saved, ${where})`); },
});
const where = save(true);
const r = bot.report();
say(`${r.done} ${line(r)}`);
say(`From ${r.from.date}: provinces ${r.from.provinces} → ${r.now.provinces}, GDP ${r.from.gdp.toFixed(1)}B → ${r.now.gdp.toFixed(1)}B, rank #${r.from.rank} → #${r.now.rank}.`);
for (const e of r.events.slice(-15)) say(`  ${e.date}: ${e.text}`);
console.log(`Saved: ${where}`);
