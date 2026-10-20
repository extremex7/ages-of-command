import test from 'node:test';
import assert from 'node:assert/strict';
import { game, data, tagIdx } from './helpers.mjs';
import { tick, runDays } from '../src/core/sim.js';
import { saveGame, loadGame } from '../src/core/game.js';
import { isHuman, humanControls, logFor, impFor, importantTo, visibleTo, log } from '../src/core/state.js';
import { startHotseat, beginTurn, endTurn, startRun, runOver, endRun, switchHuman, moveHuman, offerToHuman, newsFor, logOf, humanOf } from '../src/core/hotseat.js';
import { proposeTreaty, acceptTreatyOffer } from '../src/core/diplomacy.js';
import { declareWar, makePeace, eliminate } from '../src/core/war.js';
import { summary, recordOf, bump } from '../src/core/record.js';

function hotseat(tags = ['BRA', 'JPN'], opts = {}, seed = 'hs') {
  const g = game({ seed });
  const err = startHotseat(g.state, tags.map((t, i) => ({ k: tagIdx(g, t), name: `P${i + 1}` })), opts);
  assert.equal(err, null);
  return g;
}

// runs the simulation stage until it is over; returns the days run
function runRound(g, run) {
  const s = g.state, from = s.day;
  startRun(s, run);
  for (let i = 0; i < 400 && !runOver(s); i++) tick(g);
  endRun(s);
  return s.day - from;
}

test('hotseat: setup checks and who is human', () => {
  const g = game({ seed: 'hs0' }), s = g.state, A = tagIdx(g, 'BRA'), B = tagIdx(g, 'JPN');
  assert.match(startHotseat(s, [{ k: A }]), /2 to 8/);
  assert.match(startHotseat(s, [{ k: A }, { k: A }]), /different/);
  assert.equal(s.hotseat, undefined);
  // single player: isHuman is the old state.player test
  assert.ok(!isHuman(s, A));
  s.player = A;
  assert.ok(isHuman(s, A) && !isHuman(s, B) && humanControls(s, A));
  assert.equal(impFor(s, A, B), true);
  assert.equal(impFor(s, B), false);
  assert.equal(startHotseat(s, [{ k: A, name: 'Ana' }, { k: B, name: '' }]), null);
  assert.deepEqual(s.hotseat.humans.map((H) => H.name), ['Ana', 'Player 2']);
  assert.equal(s.player, -1, 'nobody at the screen before the first handover');
  assert.ok(isHuman(s, A) && isHuman(s, B) && !isHuman(s, tagIdx(g, 'USA')));
  assert.deepEqual(impFor(s, B, tagIdx(g, 'USA')), [B]);
});

test('hotseat: turns hand over, then the simulation runs a week, a month or until an event', () => {
  const g = hotseat(['BRA', 'JPN', 'IND']), s = g.state, [A, B, C] = s.hotseat.humans.map((H) => H.k);
  assert.equal(s.hotseat.stage, 'handover');
  const t = beginTurn(s);
  assert.equal(t.human.k, A);
  assert.equal(s.player, A);
  assert.equal(s.hotseat.stage, 'plan');
  assert.equal(endTurn(s), 'handover');
  assert.equal(s.player, -1);
  beginTurn(s); assert.equal(s.player, B); endTurn(s);
  beginTurn(s); assert.equal(s.player, C);
  assert.equal(endTurn(s), 'ready');
  const day0 = s.day;
  assert.equal(runRound(g, 'week'), 7);
  assert.equal(s.hotseat.round, 2);
  assert.equal(s.hotseat.turn, 0);
  assert.equal(s.hotseat.stage, 'handover');
  const n = runRound(g, 'month');
  assert.ok(n >= 28 && n <= 31, `a month is ${n} days`);
  // until the next event: stops at the first decision for a human (a war on one of them here)
  const day1 = s.day;
  startRun(s, 'event');
  tick(g);
  assert.ok(!runOver(s));
  assert.equal(declareWar(s, g.map, g.rules, tagIdx(g, 'ARG'), A), null);
  tick(g);
  assert.ok(runOver(s), 'a war on a human ends the run');
  assert.equal(s.day, day1 + 2);
  endRun(s);
  assert.ok(s.day > day0);
});

test('hotseat: the AI never runs a human country; events wait for their human', () => {
  const g = hotseat(['BRA', 'JPN'], {}, 'hs2'), s = g.state, [A, B] = s.hotseat.humans.map((H) => H.k);
  s.settings.eventRate = 3;
  const tax = [s.countries[A].tax, s.countries[B].tax];
  beginTurn(s); endTurn(s); beginTurn(s); endTurn(s);
  startRun(s, 'event'); s.hotseat.runUntil = s.day + 500; s.hotseat.run = 'week'; // a long run that ignores events
  for (let i = 0; i < 500; i++) tick(g);
  assert.ok(!s.aiLog.some((l) => l.c === A || l.c === B), 'no AI decisions for human countries');
  assert.deepEqual([s.countries[A].tax, s.countries[B].tax], tax);
  const mine = s.pendingEvents.filter((p) => p.c === A || p.c === B);
  assert.ok(mine.length >= 1, 'events for the humans are waiting');
  assert.ok(mine.some((p) => s.day - p.day > 30), 'not expired while unseen');
  endRun(s);
  // seen in its human's turn, it expires 30 days later like in single player
  const p = mine[0], H = humanOf(s, p.c);
  s.hotseat.turn = s.hotseat.humans.indexOf(H);
  const t = beginTurn(s);
  assert.ok(t.events.includes(p) && p.seen === s.day);
  endTurn(s);
  for (let i = 0; i < 31; i++) tick(g);
  assert.ok(!s.pendingEvents.includes(p), 'resolved by the advisers once seen and left unanswered');
});

test('hotseat: offers between two humans wait for the receiver', () => {
  const g = hotseat(['BRA', 'JPN'], {}, 'hs3'), s = g.state, [A, B] = s.hotseat.humans.map((H) => H.k);
  beginTurn(s);
  const r = proposeTreaty(s, g.map, g.rules, 'nap', A, B);
  assert.ok(r.ok && r.pending, r.reason);
  const o = s.offers.find((x) => x.to === B && x.kind === 'treaty');
  assert.ok(o);
  endTurn(s);
  const t = beginTurn(s);
  assert.equal(s.player, B);
  assert.ok(t.offers.includes(o));
  assert.equal(acceptTreatyOffer(s, g.map, g.rules, o), null);
  assert.ok(s.dip.treaties.some((x) => x.type === 'nap' && [x.a, x.b].includes(A) && [x.a, x.b].includes(B)));
  endTurn(s);
  // peace between two humans is an offer too
  assert.equal(declareWar(s, g.map, g.rules, A, B), null);
  const war = s.wars.find((w) => w.leaderA === A && w.leaderD === B);
  assert.equal(offerToHuman(s, 'peace', war, A, B, { provinces: [] }), null);
  assert.match(offerToHuman(s, 'peace', war, A, B, { provinces: [] }), /Already/);
  // months of running do not expire it before B has seen it
  runRound(g, 'month'); runRound(g, 'month');
  const po = s.offers.find((x) => x.kind === 'peace' && x.from === A && x.to === B);
  assert.ok(po, 'peace offer still waiting');
  makePeace(s, g.map, g.rules, war, po.from, po.terms);
  assert.ok(!s.wars.includes(war));
});

test('hotseat: per-human log, news and records; no achievements', () => {
  const g = hotseat(['BRA', 'JPN'], {}, 'hs4'), s = g.state, [A, B] = s.hotseat.humans.map((H) => H.k);
  logFor(s, A, 'military', 'secret for A', { important: true });
  log(s, 'world', 'news for all', { important: true });
  log(s, 'war', 'about B', { important: impFor(s, B) });
  const a = s.log.find((l) => l.text === 'secret for A'), all = s.log.find((l) => l.text === 'news for all'), b = s.log.find((l) => l.text === 'about B');
  assert.ok(visibleTo(a, A) && !visibleTo(a, B));
  assert.ok(importantTo(all, A) && importantTo(all, B));
  assert.ok(importantTo(b, B) && !importantTo(b, A) && visibleTo(b, A));
  assert.ok(logOf(s, B).includes(b) && !logOf(s, B).includes(a));
  const HA = humanOf(s, A), HB = humanOf(s, B);
  assert.deepEqual(newsFor(s, HB).map((l) => l.text), ['news for all', 'about B']);
  // records for both, kept apart, no achievements even when earned
  s.countries[A].stability = 95;
  runDays(g, 40);
  assert.ok(HA.record && HB.record && HA.record.k === A && HB.record.k === B);
  assert.equal(Object.keys(HA.record.ach).length, 0);
  assert.ok(!s.log.some((l) => l.achievement));
  assert.equal(s.record, undefined);
  assert.equal(summary(s, B).k, B);
  assert.match(summary(s, A).headline, /Brazil/);
  // a battle counted for the human who fought it only
  recordOf(s, A).n.battlesWon = 0;
  bump(s, 'battlesWon', 1, A);
  assert.deepEqual([HA.record.n.battlesWon, HB.record.n.battlesWon], [1, 0]);
});

test('hotseat: shared mode switches the human at the controls; country changes', () => {
  const g = hotseat(['BRA', 'JPN', 'IND'], { mode: 'shared' }, 'hs5'), s = g.state, [A, B, C] = s.hotseat.humans.map((H) => H.k);
  assert.equal(s.player, A);
  assert.equal(switchHuman(s).k, B); assert.equal(s.player, B);
  switchHuman(s); switchHuman(s); assert.equal(s.player, A);
  assert.match(moveHuman(s, A, B), /Another player/);
  const ARG = tagIdx(g, 'ARG');
  assert.equal(moveHuman(s, A, ARG), null);
  assert.equal(s.player, ARG);
  assert.ok(isHuman(s, ARG) && !isHuman(s, A) && isHuman(s, C));
  assert.equal(recordOf(s, ARG).earlier[0].tag, 'BRA');
});

test('hotseat: a defeated human is out; the game ends when every human is', () => {
  const g = hotseat(['BRA', 'JPN'], {}, 'hs6'), s = g.state, [A, B] = s.hotseat.humans.map((H) => H.k);
  eliminate(s, g.map, A);
  assert.ok(humanOf(s, A).out != null && !s.gameOver);
  // their turns are skipped
  endRun(s);
  assert.equal(s.hotseat.humans[s.hotseat.turn].k, B);
  beginTurn(s);
  assert.equal(endTurn(s), 'ready', 'only B plays');
  eliminate(s, g.map, B);
  assert.match(s.gameOver.reason, /Every human player/);
});

test('hotseat: saves keep the players and whose turn it is; old saves still load', () => {
  const g = hotseat(['BRA', 'JPN'], { run: 'week' }, 'hs7'), s = g.state, [A, B] = s.hotseat.humans.map((H) => H.k);
  beginTurn(s); endTurn(s); beginTurn(s);
  assert.equal(s.player, B);
  const again = loadGame(saveGame(g), data()).state;
  assert.deepEqual(again.hotseat.humans.map((H) => [H.k, H.name]), [[A, 'P1'], [B, 'P2']]);
  assert.equal(again.hotseat.turn, 1);
  assert.equal(again.hotseat.stage, 'handover', 'a turn is never reopened without the handover screen');
  assert.equal(again.player, -1);
  assert.equal(again.hotseat.run, 'week');
  // a single-player save has no hotseat and keeps its player
  const sp = game({ seed: 'hs7b', player: 'POL' });
  runDays(sp, 5);
  const back = loadGame(saveGame(sp), data()).state;
  assert.equal(back.hotseat, undefined);
  assert.equal(back.player, tagIdx(sp, 'POL'));
  // a damaged human list is repaired or dropped
  const bad = JSON.parse(saveGame(g));
  bad.hotseat.humans = [{ k: 99999 }];
  assert.equal(loadGame(JSON.stringify(bad), data()).state.hotseat, undefined);
});
