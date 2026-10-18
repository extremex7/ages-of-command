import test from 'node:test';
import assert from 'node:assert/strict';
import { game, tagIdx, provOf, borderPair } from './helpers.mjs';
import { declareWar } from '../src/core/war.js';
import { aiTick } from '../src/core/ai.js';
import { signTreaty, validateTreaty, addMod } from '../src/core/diplomacy.js';
import { countryNeighbours } from '../src/core/ai.js';
import { industryMonth } from '../src/core/industry.js';
import { compileEvents, conditionsHold, eventContext, applyEffects } from '../src/core/events.js';
import { newWing } from '../src/core/air.js';
import {
  nuclearStrike, canNuke, setProgramme, delivery, hasDeterrent, nuclearDeterred, dailyStrategic, monthlyStrategic, programmeTarget, armsControl,
  cyberOdds, cyberOperation, canCyber, cyberTech, launchSatellite, canLaunch, satCost, satCount, asatStrike, canAsat, strikeTargets,
} from '../src/core/strategic.js';

const quiet = (seed = 'strat') => game({ seed, settings: { aiAggression: 0 } });
const forget = (g, k, id) => { g.state.tech.known[k * g.state.tech.T + g.rules.tech.idx[id]] = 0; };

test('nuclear strike destroys population and is refused without warheads or delivery', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  const p = state.countries[D].capital;
  assert.match(canNuke(state, map, rules, A, p), /enemy at war/, 'not at war');
  declareWar(state, map, rules, A, D);
  assert.equal(delivery(state, map, rules, A, p).method, 'icbm');
  // make interception impossible so the strike lands
  forget(g, D, 'missile_defense');
  state.countries[D].strat.sats.warning = 0;
  const pop0 = state.prov.pop[p], w0 = state.countries[A].strat.warheads, icbm0 = state.countries[A].strat.icbm;
  const det0 = state.strategic.detonations;
  assert.equal(nuclearStrike(state, map, rules, A, p), null);
  assert.ok(state.prov.pop[p] < pop0 * 0.9, `population ${pop0} -> ${state.prov.pop[p]}`);
  assert.equal(state.countries[A].strat.warheads, w0 - 1);
  assert.equal(state.countries[A].strat.icbm, icbm0 - 1);
  assert.equal(state.strategic.detonations, det0 + 1);
  assert.ok(state.strategic.fallout[p] > 0, 'fallout');
  assert.ok(state.strategic.winter > 0);
  // no warheads
  state.countries[A].strat.warheads = 0;
  assert.match(nuclearStrike(state, map, rules, A, p), /No nuclear warheads/);
  // warheads but no missiles, submarines at sea or bombers in range
  state.countries[A].strat.warheads = 10;
  state.countries[A].strat.icbm = 0;
  state.fleets = state.fleets.filter((f) => f.owner !== A);
  state.wings = state.wings.filter((w) => w.owner !== A);
  assert.match(nuclearStrike(state, map, rules, A, p), /No way to deliver/);
  assert.equal(state.countries[A].strat.warheads, 10, 'nothing spent on a refused strike');
  // a bomber in range can deliver; one far away cannot
  const far = provOf(g, 'IND').sort((x, y) => map.lat[x] - map.lat[y])[0];
  state.wings.push(newWing(state, A, far, { heavy_bomber: 6 }, 'idle'));
  assert.equal(delivery(state, map, rules, A, p), null, 'heavy bombers in the far south are out of range');
  state.wings.push(newWing(state, A, borderPair(g, 'IND', 'PAK')[0], { heavy_bomber: 6 }, 'idle'));
  assert.equal(delivery(state, map, rules, A, p).method, 'bomber');
  // a country without the technology
  const B = tagIdx(g, 'BRA');
  forget(g, B, 'atomic_bomb');
  assert.match(canNuke(state, map, rules, B, p), /Atomic Bomb/);
});

test('launch on warning: the victim of a nuclear strike retaliates the next day', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  declareWar(state, map, rules, A, D);
  assert.ok(hasDeterrent(state, map, rules, D));
  const wD = state.countries[D].strat.warheads;
  assert.equal(nuclearStrike(state, map, rules, A, strikeTargets(state, map, rules, A, D, 1)[0]), null);
  assert.deepEqual(state.strategic.pending.map((x) => [x.from, x.to]), [[D, A]]);
  dailyStrategic(state, map, rules);
  assert.equal(state.countries[D].strat.warheads, wD, 'not before the next day');
  state.day++;
  dailyStrategic(state, map, rules);
  assert.equal(state.countries[D].strat.warheads, wD - rules.balance.strategic.retaliationStrikes, 'retaliation fired');
  assert.equal(state.strategic.pending.length, 0);
  assert.ok(state.aiLog.some((l) => l.text.startsWith('Retaliated')));
  // retaliation does not trigger a further automatic exchange
  assert.ok(!state.strategic.pending.some((x) => x.from === A));
});

test('launch on warning: the player can turn it off', () => {
  const g = game({ seed: 'low', player: 'PAK', settings: { aiAggression: 0 } });
  const { state, map, rules } = g;
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  declareWar(state, map, rules, A, D);
  state.countries[D].strat.launchOnWarning = false;
  nuclearStrike(state, map, rules, A, strikeTargets(state, map, rules, A, D, 1)[0]);
  assert.equal(state.strategic.pending.length, 0);
});

test('arms control treaty caps arsenals and dismantles warheads above the cap', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const usa = tagIdx(g, 'USA'), rus = tagIdx(g, 'RUS'), bra = tagIdx(g, 'BRA');
  const cap = rules.balance.strategic.armsControlCap;
  assert.match(validateTreaty(state, map, rules, 'arms_control', usa, bra) || '', /no nuclear weapons/);
  assert.equal(validateTreaty(state, map, rules, 'arms_control', usa, rus), null);
  for (const k of [usa, rus]) assert.equal(setProgramme(state, rules, k, 'massive'), null);
  assert.ok(programmeTarget(state, rules, state.countries[usa]) > cap);
  signTreaty(state, map, rules, 'arms_control', usa, rus, { quiet: true });
  assert.ok(armsControl(state, usa) && armsControl(state, rus) && !armsControl(state, bra));
  assert.equal(programmeTarget(state, rules, state.countries[usa]), cap);
  const w0 = state.countries[usa].strat.warheads;
  monthlyStrategic(state, map, rules);
  const w1 = state.countries[usa].strat.warheads;
  assert.ok(w1 < w0 && w1 >= cap, `${w0} -> ${w1}`);
  for (let m = 0; m < 200; m++) monthlyStrategic(state, map, rules);
  assert.equal(state.countries[usa].strat.warheads, cap, 'dismantled down to the cap, not below');
  assert.equal(state.countries[rus].strat.warheads, cap);
});

test('cyber operations: odds follow cyber power and defence; no tech, no operation', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const A = tagIdx(g, 'USA'), D = tagIdx(g, 'IRN');
  const sA = state.countries[A].strat, sD = state.countries[D].strat;
  sA.cyberPower = 10; sD.cyberPower = 0;
  const strong = cyberOdds(state, rules, A, D);
  sA.cyberPower = 1;
  const weak = cyberOdds(state, rules, A, D);
  assert.ok(strong.success > weak.success, `${strong.success} > ${weak.success}`);
  assert.ok(strong.detect < weak.detect, 'a stronger attacker is harder to identify');
  sA.cyberPower = 10; sD.cyberPower = 20;
  assert.ok(cyberOdds(state, rules, A, D).success < strong.success, 'defence lowers success');
  // quantum encryption doubles the defence
  sD.cyberPower = 0;
  const qe = D * state.tech.T + rules.tech.idx.quantum_encryption;
  state.tech.known[qe] = 0;
  const plain = cyberOdds(state, rules, A, D).success;
  state.tech.known[qe] = 1;
  assert.ok(cyberOdds(state, rules, A, D).success < plain, 'encryption makes attacks harder');
  state.tech.known[qe] = 0;
  // cyber power grows with technology
  monthlyStrategic(state, map, rules);
  assert.ok(cyberTech(state, rules, A) >= 1 && sA.cyberPower > 0);
  forget(g, A, 'cyber_warfare');
  assert.equal(cyberTech(state, rules, A), 0);
  sA.cyber = 100;
  assert.match(canCyber(state, rules, A, D, 'sabotage'), /Cyber Warfare/);
  assert.match(cyberOperation(state, map, rules, A, D, 'sabotage').error, /Cyber Warfare/);
  state.tech.known[A * state.tech.T + rules.tech.idx.cyber_warfare] = 1;
  sA.cyber = 0;
  assert.match(canCyber(state, rules, A, D, 'sabotage'), /cyber points/);
});

test('cyber operations: success rates over many attempts match the odds', () => {
  const g = quiet('cyber');
  const { state, map, rules } = g;
  const A = tagIdx(g, 'USA'), D = tagIdx(g, 'IRN');
  const rate = (power) => {
    let ok = 0;
    state.countries[A].strat.cyberPower = power;
    for (let i = 0; i < 300; i++) { state.countries[A].strat.cyber = 100; if (cyberOperation(state, map, rules, A, D, 'disinformation').ok) ok++; }
    return ok / 300;
  };
  state.countries[D].strat.cyberPower = 5;
  const lo = rate(0.5), hi = rate(50);
  assert.ok(hi > lo + 0.3, `success ${lo} vs ${hi}`);
  assert.ok(Math.abs(hi - cyberOdds(state, rules, A, D).success) < 0.1);
});

test('satellites: launching costs money, needs the technology and is limited per month', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const k = tagIdx(g, 'IND'), c = state.countries[k];
  c.treasury = 100;
  const t0 = c.treasury, n0 = satCount(c), cost = satCost(state, rules, k);
  assert.ok(cost > 0);
  assert.equal(launchSatellite(state, rules, k, 'recon'), null);
  assert.ok(Math.abs(c.treasury - (t0 - cost)) < 1e-9);
  assert.equal(satCount(c), n0 + 1);
  assert.match(canLaunch(state, rules, k, 'death_ray'), /Unknown/);
  for (let i = 1; i < rules.balance.strategic.launchesMonth; i++) assert.equal(launchSatellite(state, rules, k, 'comms'), null);
  assert.match(launchSatellite(state, rules, k, 'comms'), /launches this month/);
  monthlyStrategic(state, map, rules);
  assert.equal(canLaunch(state, rules, k, 'comms'), null, 'a new month');
  c.treasury = 0;
  assert.match(canLaunch(state, rules, k, 'comms'), /Costs/);
  c.treasury = 100;
  forget(g, k, 'gps');
  assert.match(canLaunch(state, rules, k, 'nav'), /GPS|Global Positioning|Needs/);
  forget(g, k, 'spaceflight');
  assert.match(canLaunch(state, rules, k, 'recon'), /Spaceflight/);
});

test('ASAT: anti-satellite strikes destroy satellites and leave debris', () => {
  const g = quiet('asat');
  const { state, map, rules } = g;
  const A = tagIdx(g, 'IND'), D = tagIdx(g, 'PAK');
  assert.match(canAsat(state, rules, A, D), /at war/);
  declareWar(state, map, rules, A, D);
  const n0 = satCount(state.countries[D]);
  assert.ok(n0 > 0);
  assert.equal(asatStrike(state, rules, A, D), null);
  assert.match(canAsat(state, rules, A, D), /a day/);
  let hits = 0;
  for (let d = 0; d < 40 && satCount(state.countries[D]) > 0; d++) { state.day++; asatStrike(state, rules, A, D); }
  hits = n0 - satCount(state.countries[D]);
  assert.equal(satCount(state.countries[D]), 0, 'all shot down');
  assert.ok(hits === n0);
  assert.ok(Math.abs(state.strategic.debris - hits * rules.balance.strategic.debrisKinetic) < 1e-9, `debris ${state.strategic.debris}`);
  assert.match(canAsat(state, rules, A, D), /no satellites/);
  // heavy debris destroys satellites of uninvolved countries over time
  state.strategic.debris = 200;
  const usa = state.countries[tagIdx(g, 'USA')];
  const u0 = satCount(usa);
  for (let m = 0; m < 6; m++) monthlyStrategic(state, map, rules);
  assert.ok(satCount(usa) < u0, `US satellites ${u0} -> ${satCount(usa)}`);
});

test('nuclear winter: many detonations lower farm output worldwide', () => {
  const farmOutput = (g, tag) => {
    const k = tagIdx(g, tag), X = g.rules.econ;
    const goods = new Set();
    for (const b of X.buildings) if (b.fertility) for (const [o] of b.out) goods.add(o);
    let s = 0;
    for (const o of goods) s += g.state.countries[k].econ.prod[o];
    return s;
  };
  const a = quiet('winter'), b = quiet('winter');
  const { state, map, rules } = b;
  const usa = tagIdx(b, 'USA'), rus = tagIdx(b, 'RUS');
  declareWar(state, map, rules, usa, rus);
  forget(b, rus, 'missile_defense');
  state.countries[rus].strat.sats.warning = 0;
  const targets = strikeTargets(state, map, rules, usa, rus, 60);
  for (const p of targets) assert.equal(nuclearStrike(state, map, rules, usa, p, { retaliation: true }), null);
  assert.ok(state.strategic.detonations >= 60);
  assert.ok(state.strategic.winter > 50);
  monthlyStrategic(state, map, rules);
  monthlyStrategic(a.state, a.map, a.rules);
  assert.ok(state.strategic.farmMult < 0.85, `farm multiplier ${state.strategic.farmMult}`);
  assert.equal(a.state.strategic.farmMult, 1);
  industryMonth(a.state, a.map, a.rules);
  industryMonth(state, map, rules);
  const fa = farmOutput(a, 'BRA'), fb = farmOutput(b, 'BRA');
  assert.ok(fb < fa * 0.9, `Brazilian farm output ${fa.toFixed(2)} -> ${fb.toFixed(2)}`);
});

test('AI deterrence: an AI without a deterrent does not attack a nuclear power', () => {
  // Afghanistan, made strong, aggressive and hostile, against Pakistan
  const run = (pakNukes) => {
    const g = game({ seed: 'deter', settings: { aiAggression: 4 } });
    const { state, map, rules } = g;
    const A = tagIdx(g, 'AFG'), T = tagIdx(g, 'PAK');
    for (const c of state.countries) { c.aggression = 0; c.strat.warheads = 0; c.strat.icbm = 0; }
    state.fleets = []; state.wings = [];
    const a = state.countries[A], t = state.countries[T];
    a.aggression = 1; a.stability = 90; a.rival = T;
    a.cache.armyPower = 1e6; t.cache.armyPower = 1;
    for (const k of state.countries.map((c) => c.idx)) if (k !== A) state.countries[k].cache.armyPower = Math.min(state.countries[k].cache.armyPower, 1);
    if (pakNukes) { t.strat.warheads = 100; t.strat.icbm = 20; }
    addMod(state, A, T, -200, 0, 'Border war');
    // friendly with every other neighbour, so Pakistan is the only candidate
    for (const k of countryNeighbours(state, map).sets[A]) if (k !== T) addMod(state, A, k, 200, 0, 'Old friends');
    state.day += 61;
    const deterred = nuclearDeterred(state, map, rules, A, [T]);
    for (let d = 0; d < 240 && !state.wars.length; d++) {
      state.day++;
      aiTick(state, map, rules);
      for (const c of state.countries) if (c.idx !== A) c.aggression = 0;
      a.cache.armyPower = 1e6; a.stability = 90;
    }
    return { deterred, war: state.wars.find((w) => w.attackers.includes(A) && w.defenders.includes(T)) };
  };
  const free = run(false);
  assert.equal(free.deterred, -1);
  assert.ok(free.war, 'without nuclear weapons Pakistan is attacked');
  const nuke = run(true);
  assert.ok(nuke.deterred >= 0, 'nuclearDeterred names the nuclear defender');
  assert.equal(nuke.war, undefined, 'Pakistan with a deterrent is left alone');
});

test('events: strategic conditions and effects', () => {
  const g = quiet();
  const { state, map, rules } = g;
  const usa = state.countries[tagIdx(g, 'USA')], bra = state.countries[tagIdx(g, 'BRA')];
  const ctx = (c) => eventContext(state, map, rules, c, null);
  assert.ok(conditionsHold(rules, usa, { hasNukes: true, warheads: ['>', 1000] }, ctx(usa)));
  assert.ok(conditionsHold(rules, bra, { hasNukes: false, satellites: ['>=', 0] }, ctx(bra)));
  assert.ok(conditionsHold(rules, usa, { worldNukes: ['<', 1] }, ctx(usa)));
  const w0 = usa.strat.warheads, s0 = satCount(bra);
  applyEffects(state, map, rules, usa, { warheads: -100, cyber: 30 });
  assert.equal(usa.strat.warheads, w0 - 100);
  assert.equal(usa.strat.cyber, 30);
  applyEffects(state, map, rules, bra, { satellites: 3, stations: 1, colonies: 1 });
  assert.equal(satCount(bra), s0 + 3);
  assert.equal(bra.strat.stations, 0, 'orbital stations need a fictional technology');
  assert.equal(bra.strat.colonies, 0);
  // a country without the atomic bomb cannot be given warheads by an event
  forget(g, bra.idx, 'atomic_bomb');
  applyEffects(state, map, rules, bra, { warheads: 10 });
  assert.equal(bra.strat.warheads, 0);
  assert.doesNotThrow(() => compileEvents([{ events: [] }], rules.politics));
});
