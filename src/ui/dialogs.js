// Non-blocking dialogs (DOM overlays, never browser alert/confirm).
import { h, mount } from './dom.js';
import { formatDate } from '../core/calendar.js';
import { saveGame } from '../core/game.js';
import { listSlots, writeSave, saveSettings } from './storage.js';
import { warScore, evaluatePeace, makePeace, declareWar, demandCost, provinceValue } from '../core/war.js';
import { allied } from '../core/relations.js';
import { people } from './format.js';
import { kvbox } from './panels.js';

function open(cl, ...content) {
  document.querySelector('.dialog-wrap')?.remove();
  const wrap = h('div.dialog-wrap', { on: { mousedown: (e) => { if (e.target === wrap) wrap.remove(); } } }, h('div.dialog', ...content));
  cl.el.append(wrap);
  return wrap;
}

export function menuDialog(cl) {
  const wasSpeed = cl.speed;
  cl.setSpeed(0);
  const w = open(cl, h('h2', 'Menu'),
    h('div.menu-buttons',
      h('button.primary', { on: { click: () => { w.remove(); if (wasSpeed) cl.setSpeed(wasSpeed); } } }, 'Resume'),
      h('button', { disabled: cl.mode !== 'play', on: { click: () => saveDialog(cl) } }, 'Save game'),
      h('button', { on: { click: () => perfDialog(cl) } }, 'Performance profile'),
      h('button', { on: { click: () => helpDialog(cl) } }, 'Controls'),
      h('button.danger', { on: { click: () => { w.remove(); cl.opts.onExit(); } } }, 'Exit to main menu')));
}

export function saveDialog(cl) {
  const s = cl.state;
  const name = h('input', { value: `${s.player >= 0 ? s.countries[s.player].tag : 'OBS'}-${formatDate(s.day).replace(/\s/g, '-')}`, style: { width: '100%' } });
  const msg = h('p.muted');
  const doSave = () => {
    const n = name.value.trim().replace(/[^\w\- ]/g, '').slice(0, 40);
    if (!n) { msg.textContent = 'Enter a name.'; return; }
    const err = writeSave(n, saveGame(cl.game, { savedAt: Date.now(), label: n }), cl.slotInfo());
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
    h('div.row', h('button.primary', { on: { click: doSave } }, 'Save in browser'), h('button', { on: { click: exportFile } }, 'Export file')),
    msg,
    slots.length > 0 && h('div', h('h4', 'Existing saves'), h('div.list', slots.map((sl) => h('div.item', { on: { click: () => (name.value = sl.name) } }, h('b', sl.name), h('span.muted', ` · ${sl.country} · ${sl.date}`))))));
}

function perfDialog(cl) {
  open(cl, h('h2', 'Performance profile'), h('p.muted', 'All profiles use identical gameplay rules.'),
    h('div.menu-buttons', ['low', 'balanced', 'high'].map((p) => h('button' + (cl.data.settings.profile === p ? '.on' : ''), { on: { click: () => {
      cl.data.settings.profile = p; saveSettings(cl.data.settings); cl.renderer.setProfile(p); cl.requestFrame(); document.querySelector('.dialog-wrap')?.remove();
    } } }, { low: 'Low-end: 0.75× render scale, coarse borders, fewer labels', balanced: 'Balanced', high: 'High-end: full display resolution, more labels' }[p]))));
}

function helpDialog(cl) {
  const rows = [['Left click', 'Select province / army (Shift adds armies)'], ['Right click', 'Move selected armies'], ['Drag / arrows', 'Pan map'], ['Wheel / + −', 'Zoom'],
    ['Space', 'Pause / resume'], ['1–5', 'Game speed'], ['P T O V G R Y', 'Map modes'], ['N E M D L I', 'Sidebar tabs'], ['C / H', 'Centre on capital / whole world'], ['Ctrl+S', 'Quick save'], ['Esc', 'Clear selection / close dialog']];
  open(cl, h('h2', 'Controls'), h('table.t', rows.map(([k, v]) => h('tr', h('td', h('b', k)), h('td', v)))));
}

export function reportDialog(cl, id) {
  const r = cl.state.reports.find((x) => x.id === id);
  if (!r) return;
  open(cl, h('h2', `Battle of ${r.provName}`), h('p.muted', `${formatDate(r.day)} · ${r.days} days`),
    kvbox( 'Attackers', r.attackers.join(', '), 'Defenders', r.defenders.join(', '), 'Winner', r.winner === 'att' ? 'Attackers' : 'Defenders',
      'Attacker losses', people(r.casualties[0]), 'Defender losses', people(r.casualties[1]), r.surrendered ? 'Surrendered (encircled)' : '', r.surrendered ? people(r.surrendered) : ''),
    h('h4', 'Why'), h('ul', r.factors.map((f) => h('li', f))));
}

export function declareDialog(cl, target) {
  const s = cl.state, C = s.countries, me = s.player;
  const joiners = [];
  for (const al of s.alliances) if (al.members.includes(target)) for (const m of al.members) if (m !== target && !allied(s, m, me) && !joiners.includes(m) && C[m].alive) joiners.push(m);
  const w = open(cl, h('h2', `Declare war on ${C[target].name}?`),
    h('p', joiners.length ? `Their allies will join the war: ${joiners.map((k) => C[k].name).join(', ')}.` : 'No allies will join them.'),
    h('p.muted', `Their army power: ${C[target].cache.armyPower.toFixed(0)} (yours ${C[me].cache.armyPower.toFixed(0)}). Declaring war costs 3 stability.`),
    h('div.row', h('button.danger', { on: { click: () => {
      const err = declareWar(s, cl.game.map, cl.game.rules, me, target);
      if (err) cl.toast(err, true);
      w.remove(); cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame();
    } } }, 'Declare war'), h('button', { on: { click: () => w.remove() } }, 'Cancel')));
}

export function peaceDialog(cl, war) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules, me = s.player, C = s.countries;
  const att = war.attackers.includes(me);
  const mySide = att ? war.attackers : war.defenders, theirSide = att ? war.defenders : war.attackers;
  const other = att ? war.leaderD : war.leaderA;
  const cands = map.ids.filter((i) => theirSide.includes(s.prov.owner[i]) && mySide.includes(s.prov.controller[i]))
    .sort((a, b) => provinceValue(s, R, b) - provinceValue(s, R, a));
  const chosen = new Set();
  const result = h('div');
  const update = () => {
    const terms = { provinces: [...chosen], to: me };
    const ev = evaluatePeace(s, map, R, war, me, terms);
    cl.view.highlight = [...chosen];
    cl.requestFrame();
    mount(result,
      h('p', `War score (yours): `, h('b', Math.round(ev.score)), ` · demands cost: `, h('b', Math.round(ev.cost))),
      h('p', { className: ev.accept ? 'good' : 'bad' }, (C[other].idx === s.player ? '' : `${C[other].name}: `) + ev.reason),
      h('div.row',
        h('button.primary', { disabled: !ev.accept, on: { click: () => { makePeace(s, map, R, war, me, terms); cl.view.highlight = null; w.remove(); cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame(); } } }, chosen.size ? 'Send demands' : 'Offer white peace'),
        h('button', { on: { click: () => { cl.view.highlight = null; w.remove(); cl.requestFrame(); } } }, 'Cancel')));
  };
  const list = h('div.list', cands.length ? cands.map((p) => {
    const cb = h('input', { type: 'checkbox', on: { change: (e) => { if (e.target.checked) chosen.add(p); else chosen.delete(p); update(); } } });
    return h('label.item', { style: { display: 'flex', gap: '0.5em', alignItems: 'center' } }, cb, h('span', map.name[p]),
      h('span.muted', `${C[s.prov.owner[p]].name} · cost ${Math.round(demandCost(s, map, R, war, [p], att))}`));
  }) : h('div.item.muted', 'You occupy no enemy provinces. Only a white peace is possible.'));
  const w = open(cl, h('h2', `Peace: ${war.name}`), h('p.muted', `Negotiating with ${C[other].name}. Score now ${Math.round(warScore(s, map, R, war) * (att ? 1 : -1))}.`),
    h('h4', 'Demand occupied provinces'), list, result);
  update();
}
