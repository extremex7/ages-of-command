// Intelligence: the player's spy network in a foreign country (its Nation tab) and their own
// counter-intelligence (own Nation tab). Rules in src/core/espionage.js.
import { h } from './dom.js';
import { money, pct } from './format.js';
import { SPY_OPS, SPY_OP_NAMES, spyOf, setBuilding, canSpy, spyOdds, spyOperation, networkIn, intelUpkeep } from '../core/espionage.js';

function bar(v, color = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: color } }));
}

const OP_TIPS = {
  steal: 'Progress on a technology they know and you do not (the one you are researching, if they know it).',
  sabotage: 'Knocks out industrial buildings in their provinces.',
  destabilise: 'Money for their opposition: their stability and legitimacy fall.',
  coup: 'Overthrows a shaky government (stability under 40) and installs one like yours. A country with at most half your population becomes your puppet (subject).',
};

export function intelSection(cl, k) {
  const s = cl.state, R = cl.game.rules, E = R.balance.espionage, me = s.player, map = cl.game.map;
  if (!E || me < 0) return null;
  const refresh = () => { cl.uiDirty = true; cl.requestFrame(); };
  const mine = spyOf(s.countries[me]);
  if (k === me) {
    const foreign = s.countries.filter((c) => c.alive && c.idx !== me && (c.spy?.nets[me] || 0) >= 1);
    return h('div', h('h4', 'Intelligence'),
      h('div.row', h('label', { tip: 'Counter-intelligence slows foreign spy networks here and catches more of their agents.' },
        h('input', { type: 'checkbox', checked: mine.counter, on: { change: (e) => { mine.counter = e.target.checked; refresh(); } } }), ' Counter-intelligence')),
      h('p.muted', `Service cost: ${money(intelUpkeep(s, R, s.countries[me]))}/month. Networks being built: ${mine.building.length} of ${E.maxBuilding}.`),
      foreign.length > 0 && h('p.muted', `Suspected foreign networks: ${foreign.map((c) => c.name).join(', ')}.`));
  }
  const t = s.countries[k];
  const net = networkIn(s, me, k), building = mine.building.includes(k);
  const ops = SPY_OPS.map((op) => {
    const why = canSpy(s, R, me, k, op);
    const odds = spyOdds(s, R, me, k, op);
    return h('button', { disabled: !!why, tip: `${OP_TIPS[op]}\nCosts ${E.opCost[op]} network points.${why ? `\n${why}` : `\nSuccess ${pct(odds.success)}, risk of being caught ${pct(odds.detect)}.`}`,
      on: { click: () => { const r = spyOperation(s, map, R, me, k, op); cl.toast(r.error || `${SPY_OP_NAMES[op]}: ${r.ok ? r.what : 'failed'}${r.seen ? '; our agents were caught' : ''}.`, !!r.error || !r.ok); refresh(); } } }, SPY_OP_NAMES[op]);
  });
  return h('div', h('h4', 'Intelligence'),
    h('div.row', { style: { gap: '0.4em' } }, h('span.muted', `Network ${Math.floor(net)}`), h('div', { style: { flex: 1 }, tip: `Your spy network in ${t.name}: grows ${E.growth} a month while you build it (less against counter-intelligence), fades ${E.decay} a month otherwise.` }, bar(net / 100, 'var(--blue)'))),
    h('div.row',
      h('label', { tip: `Build a network in ${t.name}. Each network being built costs ${pct(E.networkCostShare, 1)} of tax revenue a month.` },
        h('input', { type: 'checkbox', checked: building, on: { change: (e) => { const err = setBuilding(s, R, me, k, e.target.checked); if (err) cl.toast(err, true); refresh(); } } }), ' Build network')),
    h('div.row', { style: { flexWrap: 'wrap' } }, ops));
}
