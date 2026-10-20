// Non-blocking dialogs (DOM overlays, never browser alert/confirm).
import { h, mount } from './dom.js';
import { formatDate } from '../core/calendar.js';
import { saveGame } from '../core/game.js';
import { listSlots, writeSave, isDesktop } from './storage.js';
import { warScore, evaluatePeace, makePeace, declareWar, demandCost, provinceValue, warJoiners, warConsequences,
  evaluateSeparatePeace, makeSeparatePeace, separateScore, validatePeace, validateSeparatePeace } from '../core/war.js';
import { overlordOf } from '../core/diplomacy.js';
import { resolveEvent, describeEffects } from '../core/events.js';
import { people, money } from './format.js';
import { kvbox } from './panels.js';
import { settingsForm } from './settings.js';
import { summaryDialog } from './summary.js';
import { summary } from '../core/record.js';
import { humanControls } from '../core/state.js';
import { offerToHuman, humanOf } from '../core/hotseat.js';

export function openDialog(cl, ...content) { return open(cl, ...content); }

function open(cl, ...content) {
  document.querySelector('.dialog-wrap')?.remove();
  const wrap = h('div.dialog-wrap', { on: { mousedown: (e) => { if (e.target === wrap) wrap.remove(); } } }, h('div.dialog', ...content));
  cl.el.append(wrap);
  // keyboard: the dialog takes the focus (its first control), and gives it back when closed
  const back = document.activeElement;
  wrap.querySelector('.dialog').querySelector('input, select, textarea, button:not(.close), [tabindex]')?.focus({ preventScroll: true });
  new MutationObserver((m, obs) => { if (!wrap.isConnected) { obs.disconnect(); if (back?.isConnected) back.focus({ preventScroll: true }); } }).observe(cl.el, { childList: true });
  return wrap;
}

export function menuDialog(cl) {
  const wasSpeed = cl.speed;
  cl.setSpeed(0);
  const w = open(cl, h('h2', 'Menu'),
    h('div.menu-buttons',
      h('button.primary', { on: { click: () => { w.remove(); if (wasSpeed) cl.setSpeed(wasSpeed); } } }, 'Resume'),
      h('button', { disabled: cl.mode !== 'play', on: { click: () => saveDialog(cl) } }, 'Save game'),
      h('button', { disabled: !summary(cl.state), tip: 'How your country has done since you took over, and the achievements earned.', on: { click: () => summaryDialog(cl) } }, 'Summary'),
      h('button', { on: { click: () => settingsDialog(cl) } }, 'Settings'),
      h('button', { on: { click: () => helpDialog(cl) } }, 'Controls'),
      h('button', { disabled: cl.mode !== 'play', on: { click: () => { w.remove(); cl.startTutorial(); } } }, 'Tutorial'),
      h('button.danger', { on: { click: () => { w.remove(); cl.opts.onExit(); } } }, 'Exit to main menu')));
}

export function saveDialog(cl) {
  const s = cl.state;
  const name = h('input', { value: `${s.player >= 0 ? s.countries[s.player].tag : 'OBS'}-${formatDate(s.day).replace(/\s/g, '-')}`, style: { width: '100%' } });
  const msg = h('p.muted');
  const doSave = async () => {
    const n = name.value.trim().replace(/[^\w\- ]/g, '').slice(0, 40);
    if (!n) { msg.textContent = 'Enter a name.'; return; }
    const err = await writeSave(n, saveGame(cl.game, { savedAt: Date.now(), label: n }), cl.slotInfo());
    msg.textContent = err || `Saved "${n}".`;
    msg.className = err ? 'bad' : 'good';
  };
  const exportFile = () => {
    const blob = new Blob([saveGame(cl.game, { savedAt: Date.now() })], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${name.value.trim() || 'aoc3-save'}.aoc3.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const slots = listSlots();
  open(cl, h('h2', 'Save game'),
    h('div.field', h('label', 'Save name'), name),
    h('div.row', h('button.primary', { on: { click: doSave } }, isDesktop() ? 'Save' : 'Save in browser'), h('button', { on: { click: exportFile } }, 'Export file')),
    msg,
    slots.length > 0 && h('div', h('h4', 'Existing saves'), h('div.list', slots.map((sl) => h('div.item', { on: { click: () => (name.value = sl.name) } }, h('b', sl.name), h('span.muted', ` · ${sl.country} · ${sl.date}`))))));
}

export function settingsDialog(cl) {
  open(cl, h('h2', 'Settings'), settingsForm(cl.data.settings, (key) => cl.applySetting(key)));
}

function helpDialog(cl) {
  const rows = [['Left click', 'Select province / army (Shift adds armies)'], ['Right click', 'Move selected armies'], ['Drag / arrows', 'Pan map'], ['Wheel / + −', 'Zoom'],
    ['Space', 'Pause / resume'], ['1–5', 'Game speed'], ['P T O V G X K F R Y J Q', 'Map modes'], ['N B E U A M D L I', 'Sidebar tabs'], ['C / H', 'Centre on capital / whole world'], ['Tab or \\', 'Hide / show the side panel (with keyboard-only play on, Tab moves between buttons and \\ hides the panel)'],
    ['Enter / Shift+Enter', 'Select the province under the cross in the middle of the map / send the selected forces there'], ['[ and ]', 'Previous / next of your armies, fleets and air wings'], ['`', 'Cheat console (when cheats are enabled)'], ['Ctrl+S', 'Quick save'], ['F11', 'Full screen on / off'], ['Esc', 'Clear selection / close dialog'],
    ['Touch', 'Drag to pan, pinch to zoom, tap to select, press and hold to order']];
  open(cl, h('h2', 'Controls'), h('table.t', rows.map(([k, v]) => h('tr', h('td', h('b', k)), h('td', v)))));
}

export function reportDialog(cl, id) {
  const r = cl.state.reports.find((x) => x.id === id);
  if (!r) return;
  open(cl, h('h2', r.naval ? `Naval battle in the ${r.provName}` : `Battle of ${r.provName}`), h('p.muted', `${formatDate(r.day)} · ${r.days} days`),
    kvbox( 'Attackers', r.attackers.join(', '), 'Defenders', r.defenders.join(', '), 'Winner', r.winner === 'att' ? 'Attackers' : 'Defenders',
      'Attacker losses', people(r.casualties[0]), 'Defender losses', people(r.casualties[1]), r.surrendered ? 'Surrendered (encircled)' : '', r.surrendered ? people(r.surrendered) : ''),
    h('h4', 'Why'), h('ul', r.factors.map((f) => h('li', f))));
}

export function declareDialog(cl, target) {
  const s = cl.state, C = s.countries, me = s.player, R = cl.game.rules;
  const joiners = warJoiners(s, me, target).slice(1);
  const cons = warConsequences(s, cl.game.map, R, me, target);
  const w = open(cl, h('h2', `Declare war on ${C[target].name}?`),
    h('p', joiners.length ? `Joining their defence (blocs, alliances, defensive pacts, guarantees, subjects): ${joiners.map((k) => C[k].name).join(', ')}.` : 'No one will join them.'),
    h('p.muted', `Their army power: ${C[target].cache.armyPower.toFixed(0)}${joiners.length ? ` (with allies ${(C[target].cache.armyPower + joiners.reduce((a, k) => a + C[k].cache.armyPower, 0)).toFixed(0)})` : ''}; yours ${C[me].cache.armyPower.toFixed(0)}. Declaring war costs 3 stability.`),
    cons.length > 0 && h('ul', cons.map((x) => h('li.warn', x))),
    h('div.row', h('button.danger', { on: { click: () => {
      const err = declareWar(s, cl.game.map, R, me, target);
      if (err) cl.toast(err, true);
      w.remove(); cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame();
    } } }, 'Declare war'), h('button', { on: { click: () => w.remove() } }, 'Cancel')));
}

export function peaceDialog(cl, war) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules, me = s.player, C = s.countries, PC = R.balance.diplomacy.peaceCost;
  const att = war.attackers.includes(me);
  const mySide = att ? war.attackers : war.defenders, theirSide = att ? war.defenders : war.attackers;
  const other = att ? war.leaderD : war.leaderA;
  const cands = map.ids.filter((i) => theirSide.includes(s.prov.owner[i]) && mySide.includes(s.prov.controller[i]))
    .sort((a, b) => provinceValue(s, R, b) - provinceValue(s, R, a));
  const chosen = new Set();
  const extra = { reparations: false, subject: false, independence: false };
  const result = h('div');
  // a human enemy leader (hotseat) answers in their own turn
  const human = humanControls(s, other);
  const send = (terms) => { const err = offerToHuman(s, 'peace', war, me, other, terms); cl.toast(err || `Terms sent: ${humanOf(s, other).name} answers in their turn.`, !!err); };
  const update = () => {
    const terms = { provinces: [...chosen], to: me, ...extra };
    const ev = evaluatePeace(s, map, R, war, me, terms);
    if (human) { const why = validatePeace(s, map, R, war, me, terms); Object.assign(ev, { accept: !why, reason: why || `${humanOf(s, other).name} decides in their turn (your score covers ${Math.round(ev.score)} of ${Math.round(ev.cost)}).` }); }
    cl.view.highlight = [...chosen];
    cl.requestFrame();
    const any = chosen.size || extra.reparations || extra.subject || extra.independence;
    mount(result,
      h('p', `War score (yours): `, h('b', Math.round(ev.score)), ` · demands cost: `, h('b', Math.round(ev.cost))),
      h('p', { className: ev.accept ? 'good' : 'bad' }, (C[other].idx === s.player ? '' : `${C[other].name}: `) + ev.reason),
      h('div.row',
        h('button.primary', { disabled: !ev.accept, on: { click: () => { if (human) send(terms); else makePeace(s, map, R, war, me, terms); cl.view.highlight = null; w.remove(); cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame(); } } }, any ? 'Send demands' : 'Offer white peace'),
        h('button', { on: { click: () => { cl.view.highlight = null; w.remove(); cl.requestFrame(); } } }, 'Cancel')));
  };
  const check = (key, label, tip) => h('label.item', { style: { display: 'flex', gap: '0.5em', alignItems: 'center' }, tip },
    h('input', { type: 'checkbox', on: { change: (e) => { extra[key] = e.target.checked; update(); } } }), h('span', label), h('span.muted', `cost ${PC[key]}`));
  const list = h('div.list', cands.length ? cands.map((p) => {
    const cb = h('input', { type: 'checkbox', on: { change: (e) => { if (e.target.checked) chosen.add(p); else chosen.delete(p); update(); } } });
    return h('label.item', { style: { display: 'flex', gap: '0.5em', alignItems: 'center' } }, cb, h('span', map.name[p]),
      h('span.muted', `${C[s.prov.owner[p]].name} · cost ${Math.round(demandCost(s, map, R, war, [p], att, me))}`));
  }) : h('div.item.muted', 'You occupy no enemy provinces.'));
  const D = R.balance.diplomacy;
  const indep = war.kind === 'independence' && me === war.leaderA && overlordOf(s, me) === war.leaderD;
  const w = open(cl, h('h2', `Peace: ${war.name}`), h('p.muted', `Negotiating with ${C[other].name}. Score now ${Math.round(warScore(s, map, R, war) * (att ? 1 : -1))}.`),
    h('h4', 'Demand occupied provinces'), list,
    h('h4', 'Other terms'),
    h('div.list',
      indep ? check('independence', 'Independence', `${C[other].name} releases you from subject status.`) : null,
      check('reparations', `Reparations (${Math.round(D.reparationsShare * 100)}% of their tax for ${D.reparationsYears} years)`, 'Paid monthly from their tax revenue into your treasury.'),
      !indep && check('subject', `Make ${C[other].name} a subject`, `They follow you into wars, cannot sign treaties, leave their organisations and pay ${Math.round(D.subjectTribute * 100)}% of their tax as tribute. Only for countries of up to ${D.subjectMaxProvinces} provinces.`)),
    result);
  update();
}

// A participant who is not a war leader leaves the war on its own, ceding occupied land if needed.
export function separatePeaceDialog(cl, war) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules, me = s.player, C = s.countries;
  const att = war.attackers.includes(me);
  const enemySide = att ? war.defenders : war.attackers, leader = att ? war.leaderD : war.leaderA;
  const lost = map.ids.filter((i) => s.prov.owner[i] === me && enemySide.includes(s.prov.controller[i]));
  const chosen = new Set();
  const result = h('div');
  const update = () => {
    const terms = { provinces: [...chosen] };
    const ev = evaluateSeparatePeace(s, map, R, war, me, terms);
    const human = humanControls(s, leader); // a human leader (hotseat) answers in their own turn
    if (human) { const why = validateSeparatePeace(s, map, R, war, me, terms); Object.assign(ev, { accept: !why, reason: why || 'They decide in their turn.' }); }
    cl.view.highlight = [...chosen]; cl.requestFrame();
    mount(result, h('p', { className: ev.accept ? 'good' : 'bad' }, `${C[leader].name}: ${ev.reason}`),
      h('div.row',
        h('button.primary', { disabled: !ev.accept, on: { click: () => { if (human) { const err = offerToHuman(s, 'separate', war, me, leader, terms); cl.toast(err || 'Request sent.', !!err); } else makeSeparatePeace(s, map, R, war, me, terms); cl.view.highlight = null; w.remove(); cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame(); } } }, 'Make separate peace'),
        h('button', { on: { click: () => { cl.view.highlight = null; w.remove(); cl.requestFrame(); } } }, 'Cancel')));
  };
  const w = open(cl, h('h2', `Separate peace with ${C[leader].name}`),
    h('p.muted', `You leave the ${war.name}; your allies fight on and think less of you. Your own score: ${Math.round(separateScore(s, map, R, war, me))}.`),
    h('h4', 'Cede occupied provinces (optional)'),
    h('div.list', lost.length ? lost.map((p) => h('label.item', { style: { display: 'flex', gap: '0.5em', alignItems: 'center' } },
      h('input', { type: 'checkbox', on: { change: (e) => { if (e.target.checked) chosen.add(p); else chosen.delete(p); update(); } } }), h('span', map.name[p]))) : h('div.item.muted', 'The enemy occupies none of your provinces.')),
    result);
  update();
}

// The player's country has split in a civil war: keep leading the government, or take over the rebels.
export function civilWarDialog(cl, { gov, rebel }) {
  const s = cl.state, C = s.countries, g = C[gov], r = C[rebel];
  if (!g || !r?.alive) return;
  const side = (k, label, tip) => h('button', { tip, on: { click: () => { w.remove(); if (s.player !== k) cl.startPlaying(k); cl.autoResume(); } } }, label);
  const w = open(cl, h('h2', `Civil war in ${g.name}`),
    h('p', `The ${r.name} has risen against your government, taking ${r.cache?.provinces ?? 0} province(s) and ${money(r.treasury)} of the treasury. Which side do you lead?`),
    h('p.muted', 'The government wins by retaking every rebel province. The rebels win with a war score of 60, or by holding out for 5 years.'),
    h('div.row',
      side(gov, `Lead the government (${g.cache?.provinces ?? 0} provinces)`, 'Keep playing your country and crush the rising.'),
      side(rebel, `Join the ${r.name}`, 'Play as the rebels from here on.')));
}

// A domestic event for the player: the text, and each option with its effects spelled out.
export function eventDialog(cl, pend) {
  const s = cl.state, R = cl.game.rules;
  const ev = R.events.find((e) => e.id === pend.ev);
  if (!ev) return;
  if (cl.speed) cl.autoPause();
  const left = R.balance.government.eventChoiceDays - (s.day - (pend.seen ?? pend.day));
  const w = open(cl, h('h2', pend.title), h('p', pend.text),
    h('p.muted', `If you do not decide within ${left} days, your advisers choose for you.`),
    h('div.menu-buttons', ev.options.map((o, i) => h('button', { on: { click: () => {
      resolveEvent(s, cl.game.map, R, pend, i);
      w.remove(); cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame();
      cl.autoResume();
    } } }, h('b', o.text), h('div.muted', { style: { fontSize: '0.85em', whiteSpace: 'normal' } }, describeEffects(R, o.effects || {}, s).join(' · ') || 'No effects')))));
}
