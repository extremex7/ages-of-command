// The bot (src/bot/autoplay.js) and handing a human country to the AI (src/core/automate.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { game, data, tagIdx } from './helpers.mjs';
import { saveGame, loadGame } from '../src/core/game.js';
import { runDays } from '../src/core/sim.js';
import { humanControls } from '../src/core/state.js';
import { handToAI, handBack, settlePending } from '../src/core/automate.js';
import { proposeLoan } from '../src/core/deals.js';
import { recordOf } from '../src/core/record.js';
import { Autoplay, botProblem, botSlotName, BOT_PROFILE } from '../src/bot/autoplay.js';
import { startHotseat } from '../src/core/hotseat.js';

// a game with the player at FRA and something waiting for them: an event, a treaty proposal and
// a loan offer
function waiting(seed = 'bot') {
  const g = game({ player: 'FRA', seed }), s = g.state, k = s.player, R = g.rules;
  const ev = R.events.find((e) => e.options?.length > 1 && !e.triggered);
  s.pendingEvents.push({ id: s.nextId++, ev: ev.id, c: k, day: s.day, rival: -1, neighbour: -1, heir: -1, title: ev.title, text: '' });
  const DEU = tagIdx(g, 'DEU');
  s.offers.push({ id: s.nextId++, kind: 'treaty', type: 'nap', from: tagIdx(g, 'BRA'), to: k, day: s.day });
  s.countries[DEU].treasury = 1e4;
  proposeLoan(s, g.map, R, DEU, k, { role: 'lend', amount: s.countries[k].ledger.revenue, rate: 0.03, months: 24 });
  return g;
}

test('bot: answers what waits for the player, runs months without stalling, and hands control back', () => {
  const g = waiting(), s = g.state, k = s.player, c = s.countries[k];
  c.autoEconomy = true; // the player's own setting, kept
  assert.ok(s.pendingEvents.some((p) => p.c === k));
  assert.ok(s.offers.some((o) => o.to === k));
  assert.ok(s.dip.pending.some((o) => o.to === k));
  const bot = new Autoplay(g, { years: 0.5 }).start();
  assert.ok(c.automate && !humanControls(s, k));
  assert.deepEqual(c.aiProfile, BOT_PROFILE);
  assert.ok(bot.decisions.length >= 3, bot.decisions.join('; '));
  assert.ok(!s.pendingEvents.some((p) => p.c === k) && !s.offers.some((o) => o.to === k) && !s.dip.pending.some((o) => o.to === k));
  const from = s.day;
  let n = 0;
  for (; n < 100 && !bot.step(30).done; n++) {
    // nothing queues for the player while the AI runs the country
    assert.ok(!s.pendingEvents.some((p) => p.c === k) && !s.offers.some((o) => o.to === k) && !s.dip.pending.some((o) => o.to === k));
  }
  assert.ok(s.day - from >= 182 && s.day - from <= 184, `ran ${s.day - from} days`);
  assert.match(bot.finished(), /0.5 year/);
  const text = bot.stop();
  assert.equal(c.automate, false);
  assert.equal(c.autoEconomy, true);
  assert.equal(c.aiProfile, undefined);
  assert.ok(humanControls(s, k));
  const r = bot.report();
  assert.equal(r.from.date, '1 Jan 2026');
  assert.ok(r.now.day > r.from.day && r.now.gdp > 0 && r.years > 0.49);
  // the save loads with the country under the player's control
  const back = loadGame(text, data());
  assert.equal(back.state.player, k);
  assert.equal(back.state.countries[k].automate, false);
  assert.equal(back.state.countries[k].aiProfile, undefined);
});

test('bot: saves made while it plays have the player in control, and do not change the run', () => {
  const run = (withSaves) => {
    const g = game({ player: 'TUR', seed: 'det' });
    const bot = new Autoplay(g, { years: 0.25 }).start();
    while (!bot.step(10).done) {
      if (withSaves) {
        const mid = JSON.parse(bot.save());
        assert.equal(mid.countries[mid.player].automate, false);
        assert.equal(mid.countries[mid.player].aiProfile, undefined);
        assert.ok(g.state.countries[g.state.player].automate, 'still playing after a save');
      }
    }
    const out = JSON.parse(bot.stop());
    delete out.savedAt;
    return out;
  };
  const a = run(false), b = run(true), c = run(false);
  assert.deepEqual(b, a, 'saving along the way does not change the game');
  assert.deepEqual(c, a, 'the same save and seed give the same game');
});

test('bot: deterministic from a loaded save, and the source text is never modified', () => {
  const g = game({ player: 'BRA', seed: 'src' });
  runDays(g, 20);
  const src = saveGame(g, { savedAt: 1 });
  const play = () => {
    const bot = new Autoplay(loadGame(src, data()), { years: 0.2 }).start();
    while (!bot.step(1000).done);
    const out = JSON.parse(bot.stop());
    delete out.savedAt;
    return out;
  };
  const h = crypto.createHash('sha1').update(src).digest('hex');
  assert.deepEqual(play(), play());
  assert.equal(crypto.createHash('sha1').update(src).digest('hex'), h);
});

test('bot: refuses observer and hotseat games; slot names never reuse a taken name', () => {
  const obs = game({ seed: 'obs' });
  assert.match(botProblem(obs.state), /observer/);
  assert.throws(() => new Autoplay(obs), /observer/);
  const hs = game({ seed: 'hs' });
  startHotseat(hs.state, [{ k: tagIdx(hs, 'FRA') }, { k: tagIdx(hs, 'DEU') }]);
  assert.match(botProblem(hs.state), /hotseat/);
  const g = game({ player: 'FRA', seed: 'n' });
  const name = botSlotName(g.state);
  assert.equal(name, 'Bot – France 1 Jan 2026');
  assert.equal(botSlotName(g.state, [name]), name + ' (2)');
  assert.equal(botSlotName(g.state, [name, name + ' (2)']), name + ' (3)');
});

test('automate: hand over and back without a profile; no achievements and nothing waiting while automated', () => {
  const g = game({ player: 'FRA', seed: 'aw' }), s = g.state, k = s.player;
  const h = handToAI(s, g.map, g.rules, k, null);
  assert.ok(s.countries[k].automate && s.countries[k].aiProfile === undefined);
  handBack(s, h);
  assert.ok(!s.countries[k].automate);
  // achievements: none while automated
  const R = recordOf(s);
  handToAI(s, g.map, g.rules, k, BOT_PROFILE);
  runDays(g, 70);
  assert.deepEqual(Object.keys(R.ach), []);
  assert.deepEqual(settlePending(s, g.map, g.rules, k), [], 'nothing waits for an automated player');
});

test('CLI: tools/autoplay.mjs writes a new slot and leaves the source slot alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-bot-')), store = path.join(dir, 'store');
  fs.mkdirSync(store);
  const g = game({ player: 'POL', seed: 'cli' });
  const enc = 'gz:' + zlib.gzipSync(saveGame(g, { savedAt: 1 })).toString('base64');
  fs.writeFileSync(path.join(store, 'save.mine.dat'), enc);
  fs.writeFileSync(path.join(store, 'slots.dat'), JSON.stringify([{ name: 'mine', savedAt: 1, country: 'Poland', date: '1 Jan 2026' }]));
  execFileSync(process.execPath, [new URL('../tools/autoplay.mjs', import.meta.url).pathname, '--save', 'mine', '--data', dir, '--years', '0.2', '--quiet']);
  assert.equal(fs.readFileSync(path.join(store, 'save.mine.dat'), 'utf8'), enc, 'source save unchanged');
  const slots = JSON.parse(fs.readFileSync(path.join(store, 'slots.dat'), 'utf8'));
  assert.equal(slots.length, 2);
  assert.match(slots[0].name, /^Bot – Poland \d+ \w+ 2026$/);
  assert.ok(slots[0].bot);
  assert.ok(slots.some((x) => x.name === 'mine'));
  const files = fs.readdirSync(store).filter((f) => f.startsWith('save.'));
  assert.equal(files.length, 2, files.join(', '));
  const text = zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(store, files.find((f) => f !== 'save.mine.dat')), 'utf8').slice(3), 'base64')).toString();
  const back = loadGame(text, data());
  assert.equal(back.state.countries[back.state.player].tag, 'POL');
  assert.equal(back.state.countries[back.state.player].automate, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
