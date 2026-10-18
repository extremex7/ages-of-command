// Strategic tab (Milestone 6): nuclear programme and deterrence, cyber operations, satellites,
// anti-satellite weapons and space projects, and the world's nuclear state. The nuclear strike
// itself is ordered from the province panel (nuclearButton), always behind a confirmation.
import { h } from './dom.js';
import { money, people, pct } from './format.js';
import { openDialog } from './dialogs.js';
import { kvbox } from './panels.js';
import { atWar } from '../core/relations.js';
import { knowsId } from '../core/technology.js';
import {
  SAT_KINDS, PROGRAMMES, CYBER_OPS, SPACE_PROJECTS, satCount, satCover, strategicUpkeep, canHaveNukes, setProgramme, programmeTarget, armsControl,
  seaLaunchers, hasDeterrent, canNuke, delivery, interceptChance, nuclearStrike, canCyber, cyberOdds, cyberOperation, cyberDefence, satCost, canLaunch,
  launchSatellite, canAsat, asatStrike, canStartSpace, startSpace,
} from '../core/strategic.js';

const SAT_NAMES = { recon: 'Reconnaissance', comms: 'Communications', nav: 'Navigation', warning: 'Early warning' };
const SAT_TIPS = {
  recon: 'Better intelligence in land battles (combat bonus at full coverage).',
  comms: 'Faster organisation recovery for armies.',
  nav: 'Faster army movement.',
  warning: 'Raises the chance of intercepting incoming missiles and lets your missiles launch before an enemy first strike destroys them.',
};
const OP_NAMES = { espionage: 'Espionage', sabotage: 'Sabotage', disruption: 'Disruption', disinformation: 'Disinformation' };
const OP_TIPS = {
  espionage: 'Steal research towards a technology they know and you do not.',
  sabotage: 'Wreck industrial buildings in their provinces.',
  disruption: 'Slow their industry and research for some months and cost stability.',
  disinformation: 'Cut their stability and government legitimacy.',
};
const PROG_NAMES = { none: 'None', minimal: 'Minimal', deterrent: 'Deterrent', large: 'Large', massive: 'Massive' };

function refresh(cl) { cl.uiDirty = true; cl.requestFrame(); }

export function strategicTab(cl) {
  const s = cl.state, me = s.player;
  if (me < 0) return h('div', h('p.muted', 'Observer mode.'), worldSection(cl));
  return h('div', nuclearSection(cl), cyberSection(cl), spaceSection(cl), worldSection(cl));
}

function nuclearSection(cl) {
  const s = cl.state, me = s.player, R = cl.game.rules, map = cl.game.map, c = s.countries[me], st = c.strat;
  const S = R.balance.strategic;
  if (!canHaveNukes(s, R, me)) return h('div', h('h3', 'Nuclear weapons'), h('p.muted', `Needs the technology ${R.tech.list[R.tech.idx.atomic_bomb].name}.`));
  const target = programmeTarget(s, R, c);
  const ac = armsControl(s, me);
  const deliveryText = [st.icbm > 0 && knowsId(s, R, me, 'icbm') && `${st.icbm} ballistic missiles`, seaLaunchers(s, R, me) > 0 && `${seaLaunchers(s, R, me)} submarine missile tubes at sea`,
    s.wings.some((w) => w.owner === me && Object.keys(w.units).some((t) => R.units[t].bomb > 0)) && 'bombers'].filter(Boolean);
  return h('div',
    h('h3', 'Nuclear weapons'),
    kvbox(
      'Warheads', String(st.warheads),
      'Programme target', `${target}${ac ? ` (arms control caps it at ${S.armsControlCap}; warheads above it are dismantled)` : st.warheads > target ? ' (warheads above it are kept, not replaced)' : ''}`,
      'Delivery', deliveryText.length ? deliveryText.join(', ') : 'None: warheads cannot reach a target',
      'Deterrent', hasDeterrent(s, map, R, me) ? 'Yes: enemies weigh retaliation before attacking you' : 'No',
      'Missile defence', h('span', { tip: 'Missile defence technology, early-warning satellites and orbital defences add to it; enemy hypersonic weapons lower it.' }, `about ${pct(interceptChance(s, R, me, me))} of incoming missiles intercepted`),
      'Upkeep of strategic forces', money(strategicUpkeep(c, R)) + '/month'),
    h('div.row', { style: { marginTop: '0.4em' } }, h('span.muted', 'Programme'),
      h('select', { tip: `Warheads are built each month towards the target (${money(S.warheadCost * c.cache.priceLevel)} and ${S.uraniumPerWarhead} uranium each); missiles follow once you know Intercontinental Ballistic Missiles.`, on: { change: (e) => { const err = setProgramme(s, R, me, e.target.value); if (err) cl.toast(err, true); refresh(cl); } } },
        Object.entries(PROGRAMMES).map(([k, n]) => h('option', { value: k, selected: st.programme === k }, `${PROG_NAMES[k]} (${n} warheads)`)))),
    h('label.row', { tip: 'If you are struck, you retaliate the next day against the attacker\'s cities with whatever can still fly. Turning this off avoids escalation but weakens deterrence.' },
      h('input', { type: 'checkbox', checked: st.launchOnWarning, on: { change: (e) => { st.launchOnWarning = e.target.checked; refresh(cl); } } }), ' Launch on warning (automatic retaliation)'),
    h('p.note', 'To order a strike, select a province held by an enemy you are at war with; the province panel has the button. Every strike asks for confirmation.'));
}

function cyberSection(cl) {
  const s = cl.state, me = s.player, R = cl.game.rules, map = cl.game.map, c = s.countries[me], st = c.strat, S = R.balance.strategic;
  if (!knowsId(s, R, me, 'cyber_warfare')) return h('div', h('h3', 'Cyber operations'), h('p.muted', 'Needs the technology Cyber Warfare.'));
  const t = cl.view.selectedCountry;
  const valid = t >= 0 && t !== me && s.countries[t]?.alive;
  const odds = valid ? cyberOdds(s, R, me, t) : null;
  return h('div',
    h('h3', { style: { marginTop: '1em' } }, 'Cyber operations'),
    kvbox(
      'Cyber points', `${Math.floor(st.cyber)} of ${S.cyberMax}`,
      'Offensive power', st.cyberPower.toFixed(2) + ' (grows with research spending and technology)',
      'Our defence', Number.isFinite(cyberDefence(s, R, me)) ? cyberDefence(s, R, me).toFixed(1) : 'No networks to attack'),
    valid
      ? h('div', h('div.muted', `Target: ${s.countries[t].name}. Success ${pct(odds.success)}, chance of being identified ${pct(odds.detect)}.`),
        h('div.row', CYBER_OPS.map((op) => {
          const why = canCyber(s, R, me, t, op);
          return h('button', { disabled: !!why, tip: why || `${OP_TIPS[op]}\nCosts ${S.cyberCost[op]} cyber points. If identified, their opinion of you falls.`, on: { click: () => {
            const r = cyberOperation(s, map, R, me, t, op);
            if (r.error) cl.toast(r.error, true);
            else cl.toast(`${OP_NAMES[op]}: ${r.ok ? r.what : 'failed'}${r.seen ? ' (we were identified)' : ''}`, !r.ok);
            refresh(cl);
          } } }, OP_NAMES[op]);
        })))
      : h('p.muted', 'Select another country on the map to target it.'));
}

function spaceSection(cl) {
  const s = cl.state, me = s.player, R = cl.game.rules, c = s.countries[me], st = c.strat, S = R.balance.strategic;
  const space = knowsId(s, R, me, 'spaceflight');
  const enemies = s.countries.filter((o) => o.alive && atWar(s, me, o.idx) && satCount(o) > 0);
  return h('div',
    h('h3', { style: { marginTop: '1em' } }, 'Satellites and space'),
    !space && h('p.muted', 'Needs the technology Spaceflight.'),
    h('table.t', h('tr', h('th', 'Satellites'), h('th.n', 'In orbit'), h('th.n', 'Coverage'), h('th', '')),
      SAT_KINDS.map((k) => {
        const why = canLaunch(s, R, me, k);
        return h('tr', h('td', { tip: SAT_TIPS[k] }, SAT_NAMES[k]), h('td.n', String(st.sats[k])), h('td.n', pct(satCover(c, k, R))),
          h('td', h('button', { disabled: !!why, tip: why || `Launch one for ${money(satCost(s, R, me))}`, on: { click: () => { const e = launchSatellite(s, R, me, k); if (e) cl.toast(e, true); refresh(cl); } } }, 'Launch')));
      })),
    space && h('div.muted', `Launches this month: ${st.launched} of ${S.launchesMonth + st.stations}. Satellites cost ${money(S.satUpkeep * c.cache.priceLevel)}/month each.`),
    enemies.length > 0 && h('div', h('h4', 'Anti-satellite strikes'), h('div.row', enemies.map((o) => {
      const why = canAsat(s, R, me, o.idx);
      return h('button.danger', { disabled: !!why, tip: why || `Fire at one of ${o.name}'s ${satCount(o)} satellites. Debris from kinetic hits threatens every country's satellites.`, on: { click: () => { const e = asatStrike(s, R, me, o.idx); if (e) cl.toast(e, true); refresh(cl); } } }, `${o.name} (${satCount(o)})`);
    }))),
    h('h4', 'Space projects (fictional technology)'),
    kvbox('Orbital stations', `${st.stations} of ${S.maxStations}`, 'Off-world settlements', `${st.colonies} of ${S.maxColonies}`,
      'Under way', st.project ? `${SPACE_PROJECTS[st.project.kind].name}: ${st.project.months} months left` : 'Nothing'),
    h('div.row', Object.entries(SPACE_PROJECTS).map(([k, P]) => {
      const why = canStartSpace(s, R, me, k);
      return h('button', { disabled: !!why, tip: why || `${P.name}: ${money(S[P.costKey] * c.cache.priceLevel)}, ${S[P.monthsKey]} months. ${k === 'station' ? 'Each station adds a launch a month, +3% industrial output and +3% research (more mining with asteroid mining).' : 'Each settlement adds +6% research and +3 stability when founded.'}`, on: { click: () => { const e = startSpace(s, R, me, k); if (e) cl.toast(e, true); refresh(cl); } } }, `Start ${P.name.toLowerCase()}`);
    })));
}

function worldSection(cl) {
  const s = cl.state, W = s.strategic, C = s.countries;
  if (!W) return null;
  const powers = C.filter((c) => c.alive && c.strat?.warheads > 0).sort((a, b) => b.strat.warheads - a.strat.warheads);
  return h('div',
    h('h3', { style: { marginTop: '1em' } }, 'World'),
    kvbox(
      'Nuclear detonations', String(W.detonations),
      'Farm output (nuclear winter)', pct(W.farmMult ?? 1),
      'Orbital debris', W.debris.toFixed(2),
      'Provinces with fallout', String(Object.keys(W.fallout).length),
      'Nuclear powers', powers.length ? powers.slice(0, 10).map((c) => `${c.name} ${c.strat.warheads}`).join(', ') + (powers.length > 10 ? '…' : '') : 'None'));
}

// Province panel: the strike button and its confirmation.
export function nuclearButton(cl, p) {
  const s = cl.state, me = s.player, R = cl.game.rules, map = cl.game.map;
  if (me < 0 || !s.countries[me].strat?.warheads) return null;
  const ctl = s.prov.controller[p];
  if (ctl < 0 || !atWar(s, me, ctl)) return null;
  const why = canNuke(s, map, R, me, p);
  return h('button.danger', { disabled: !!why, tip: why || 'Order a nuclear strike on this province', on: { click: () => strikeDialog(cl, p) } }, 'Nuclear strike…');
}

function strikeDialog(cl, p) {
  const s = cl.state, me = s.player, R = cl.game.rules, map = cl.game.map, C = s.countries;
  const ctl = s.prov.controller[p];
  const how = delivery(s, map, R, me, p);
  const retaliate = hasDeterrent(s, map, R, ctl);
  const first = !s.strategic.used?.[`${ctl}>${me}`];
  const was = cl.speed;
  cl.setSpeed(0);
  const w = openDialog(cl,
    h('h2', `Nuclear strike on ${map.name[p]}?`),
    h('p', `About ${people(s.prov.pop[p])} people live here. A strike kills a large share of them, wrecks buildings and infrastructure, destroys forces in the province and spreads fallout to its neighbours.`),
    h('ul',
      h('li', `Delivery: ${how.method === 'icbm' ? 'ballistic missile' : how.method === 'ssbn' ? 'submarine-launched missile' : `bombers of ${how.wing.name} (enemy fighters may shoot them down)`}; ${pct(interceptChance(s, R, me, ctl))} chance a missile is intercepted.`),
      first && h('li.warn', 'This would be first use: every country\'s opinion of you falls and your stability drops.'),
      retaliate && h('li.warn', `${C[ctl].name} has a deterrent and will retaliate against your cities.`),
      h('li', 'Each detonation adds to nuclear winter, cutting farm output worldwide.')),
    h('div.row',
      h('button.danger', { on: { click: () => { const e = nuclearStrike(s, map, R, me, p); if (e) cl.toast(e, true); w.remove(); refresh(cl); } } }, 'Launch'),
      h('button.primary', { on: { click: () => { w.remove(); if (was) cl.setSpeed(was); } } }, 'Cancel')));
}
