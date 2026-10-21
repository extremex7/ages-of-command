// The bot's simulation side for the bot window: loads the game data, runs a save with Autoplay
// and reports back through post(message). Runs in a Web Worker (src/bot/worker.js), so a
// minimised or hidden window keeps its speed and the window stays responsive, or on the page
// itself where workers are missing. Storage stays with the page (src/bot/page.js).
//
// In:  { cmd: 'start', text, scenario?, years, cpu }  { cmd: 'cpu', cpu }  { cmd: 'stop' }
// Out: { type: 'status', text }  { type: 'started', report }  { type: 'progress', report, speed }
//      { type: 'save', text, info, final, report }  { type: 'error', text }
import { loadGameData, loadSaveText } from './data.js';
import { Autoplay, botSlotInfo } from './autoplay.js';

const ROOT = new URL('../../', import.meta.url); // the game folder

async function json(path) {
  const r = await fetch(new URL(path, ROOT));
  if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
  return r.json();
}

// a pause that also lets messages (stop, CPU changes) in; 0 ms without timer clamping
function rest(ms) {
  if (ms > 1) return new Promise((r) => setTimeout(r, ms));
  return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
}

export function createRunner(post) {
  let data = null, bot = null, stopAsked = false, cpu = 1, running = false;
  const report = () => {
    const r = bot.report(), eras = bot.game.rules.tech?.eras || [];
    r.from.eraName = eras[r.from.era]?.name || ''; r.now.eraName = eras[r.now.era]?.name || '';
    return r;
  };
  const save = (final) => {
    const s = bot.game.state;
    const text = final ? bot.stop(stopAsked ? 'Stopped.' : 'Finished.') : bot.save();
    post({ type: 'save', text, info: botSlotInfo(s), final, report: report() });
  };
  async function start(msg) {
    if (running) return post({ type: 'error', text: 'The bot is already running.' });
    running = true; stopAsked = false; cpu = msg.cpu ?? 1;
    try {
      if (!data) { post({ type: 'status', text: 'Loading the map and rules…' }); data = await loadGameData(json); }
      post({ type: 'status', text: 'Loading the save…' });
      const game = await loadSaveText(data, msg.text, async () => msg.scenario || null);
      bot = new Autoplay(game, { years: msg.years || 0 }).start();
    } catch (e) {
      running = false;
      return post({ type: 'error', text: String(e?.message || e) });
    }
    post({ type: 'started', report: report() });
    let last = 0, lastDay = bot.game.state.day, lastT = performance.now();
    try {
      await bot.run({
        cpu: () => cpu, rest, shouldStop: () => stopAsked,
        onSlice: () => {
          const t = performance.now();
          if (t - last < 500) return;
          const s = bot.game.state, speed = ((s.day - lastDay) * 1000) / Math.max(1, t - lastT);
          last = lastT = t; lastDay = s.day;
          post({ type: 'progress', report: report(), speed });
        },
        onYear: () => save(false),
      });
      save(true);
    } catch (e) {
      post({ type: 'error', text: `The simulation stopped with an error: ${e?.message || e}` });
      try { save(true); } catch { /* nothing to save */ }
    }
    running = false;
  }
  return {
    handle(msg) {
      if (msg.cmd === 'start') start(msg);
      else if (msg.cmd === 'stop') stopAsked = true;
      else if (msg.cmd === 'cpu') cpu = msg.cpu;
    },
  };
}
