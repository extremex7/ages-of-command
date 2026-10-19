// The world council in the Diplomacy tab (votes, resolutions in force, proposals), and the
// sanctions controls in a foreign country's Nation tab. Rules in src/core/council.js.
import { h } from './dom.js';
import { formatDate } from '../core/calendar.js';
import {
  councilActive, councilName, councilOf, canPropose, propose, castVote, tally, describeRes,
  SANCTION_LEVELS, SANCTION_NAMES, setSanction, inCeasefire,
} from '../core/council.js';

const refresh = (cl) => { cl.uiDirty = true; cl.requestFrame(); };
const say = (cl, r, ok) => { cl.toast(r.error || ok, !!r.error); refresh(cl); };

export function councilSection(cl) {
  const s = cl.state, R = cl.game.rules, map = cl.game.map, C = s.countries, me = s.player, K = R.balance.council;
  if (!K || !councilActive(s, R)) return null;
  const W = councilOf(s);
  const out = [h('h3', { style: { marginTop: '1em' } }, councilName(s, R)),
    h('p.muted', { tip: 'Permanent members can veto. A resolution passes with more yes than no votes and no veto.' },
      `Permanent members: ${W.permanent.map((k) => C[k].name).join(', ') || 'chosen at the next session'}.`)];
  if (W.pending.length) {
    out.push(h('h4', 'Votes'));
    for (const r of W.pending) {
      const t = tally(s, map, R, r), mine = r.votes[me];
      out.push(h('div.item', h('div', h('b', describeRes(s, R, r)), h('span.muted', ` · proposed by ${C[r.by].name}, vote closes ${formatDate(r.voteDay)}`)),
        h('div.muted', { tip: 'How the other countries would vote today. Votes are counted when the vote closes.' },
          `Expected: ${t.yes} yes, ${t.no} no, ${t.abstain} abstain${t.veto.length ? ` · veto: ${t.veto.map((k) => C[k].name).join(', ')}` : ''} → ${t.passes ? 'passes' : 'fails'}`),
        me >= 0 && h('div.row', ['yes', 'no', 'abstain'].map((v) => h('button' + (mine === v ? '.on' : ''), { on: { click: () => { castVote(s, me, r.id, v); refresh(cl); } } }, v[0].toUpperCase() + v.slice(1))))));
    }
  }
  const active = W.active.filter((r) => r.kind !== 'sanction' || C[r.target].alive);
  const cease = s.wars.filter((w) => inCeasefire(s, w));
  if (active.length || cease.length) {
    out.push(h('h4', 'In force'));
    for (const r of active) out.push(h('div.muted', r.kind === 'sanction' ? `${SANCTION_NAMES[r.level]} on ${C[r.target].name} (${r.comply.length} countries) until ${formatDate(r.until)}` : `Demilitarised zone between ${C[r.a].name} and ${C[r.b].name} (${r.provs.length} provinces) until ${formatDate(r.until)}`));
    for (const w of cease) out.push(h('div.muted', `Ceasefire in the ${w.name} until ${formatDate(w.ceasefire)}`));
  }
  if (me >= 0) {
    const wars = s.wars.filter((w) => !inCeasefire(s, w));
    if (wars.length) {
      out.push(h('h4', 'Propose a ceasefire'), h('div', wars.map((w) => {
        const why = canPropose(s, map, R, me, { kind: 'ceasefire', war: w.id });
        return h('div.row.spread', h('span', w.name), h('button', { disabled: !!why, tip: why || `Costs ${K.proposeInfluence} influence. One year without fighting; the war goes on on paper.`,
          on: { click: () => say(cl, propose(s, map, R, me, { kind: 'ceasefire', war: w.id }), 'Ceasefire proposed.') } }, 'Propose'));
      })));
    }
    out.push(h('p.muted', 'Sanctions and demilitarised zones are proposed from a country\'s Nation tab.'));
  }
  if (W.history?.length) out.push(h('h4', 'Recent votes'), h('div', W.history.slice(-5).reverse().map((x) => h('div.muted', `${formatDate(x.day)}: ${x.text} ${x.how} (${x.yes}–${x.no})`))));
  return h('div', out);
}

// Nation tab of a foreign country: own sanctions, and council proposals about it.
export function sanctionsRow(cl, k) {
  const s = cl.state, R = cl.game.rules, map = cl.game.map, me = s.player, C = s.countries;
  if (me < 0 || k === me || !C[k].alive || !C[me].econ) return null;
  const cur = C[me].econ.sanctions?.[k] || '';
  const parts = [h('select', { tip: 'Your own trade sanctions: arms (munitions, machinery, electronics) or energy (coal, oil, gas, fuel, uranium). Use Embargo to stop all trade. Their opinion of you falls.',
    on: { change: (e) => { setSanction(s, me, k, e.target.value); refresh(cl); } } },
  h('option', { value: '', selected: !cur }, 'No sanctions'),
  ['arms', 'energy'].map((lv) => h('option', { value: lv, selected: cur === lv }, SANCTION_NAMES[lv])))];
  if (R.balance.council && councilActive(s, R)) {
    const K = R.balance.council;
    const sel = h('select', SANCTION_LEVELS.map((lv) => h('option', { value: lv }, SANCTION_NAMES[lv])));
    const why = canPropose(s, map, R, me, { kind: 'sanction', target: k, level: 'arms' });
    parts.push(sel, h('button', { disabled: !!why && !/already in force/.test(why), tip: why || `Ask the ${councilName(s, R)} to sanction ${C[k].name} (costs ${K.proposeInfluence} influence). Every country that does not vote against applies them for ${K.sanctionYears} years.`,
      on: { click: () => say(cl, propose(s, map, R, me, { kind: 'sanction', target: k, level: sel.value }), 'Sanctions proposed to the council.') } }, 'Propose to council'));
    const dz = canPropose(s, map, R, me, { kind: 'dmz', a: me, b: k });
    parts.push(h('button', { disabled: !!dz, tip: dz || `Ask the council for a demilitarised zone along your border with ${C[k].name}: neither side may keep troops there for ${K.dmzYears} years.`,
      on: { click: () => say(cl, propose(s, map, R, me, { kind: 'dmz', a: me, b: k }), 'Demilitarised zone proposed to the council.') } }, 'Propose DMZ'));
  }
  return h('div.row', { style: { marginTop: '0.4em', flexWrap: 'wrap' } }, parts);
}
