// Religion, unrest, revolts and golden ages in the panels (docs/RELIGION.md): lines for the
// province panel and the Nation tab, and a section for the Government tab with the religious
// make-up, changing the state religion, war exhaustion, revolts and the golden age outlook.
import { h } from './dom.js';
import { pct, money } from './format.js';
import { formatDate } from '../core/calendar.js';
import { NO_REL, religionMix, conversionRate, stateRelIdx, canChangeReligion, changeReligion } from '../core/religion.js';
import { unrestParts, garrisons, revoltAt, revoltKindName, suppress, canSuppress, suppressCost, revoltPower } from '../core/unrest.js';
import { goldenCheck, crisisCheck } from '../core/ages.js';
import { stabilityParts } from '../core/society.js';

const PART_NAMES = {
  stability: 'Stability', religion: 'Other religion', conquest: 'Recent conquest', separatism: 'Separatism', war: 'War exhaustion',
  tax: 'Taxes', food: 'Hunger', civil: 'Civil spending', garrison: 'Garrison', suppression: 'Crackdown', capital: 'Capital', age: 'Golden or dark age',
};
const sg = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const swatch = (col) => h('b', { style: { color: col } }, '■ ');

function bar(v, color = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: color } }));
}

function refresh(cl) {
  cl.renderer?.invalidate?.();
  cl.uiDirty = true;
  cl.requestFrame();
}

export function unrestTip(parts) {
  if (!parts) return '';
  const rows = Object.entries(parts).filter(([, v]) => v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return 'Unrest moves 15% a month toward the sum of:\n' + rows.map(([k, v]) => `  ${PART_NAMES[k] || k} ${sg(v, 1)}`).join('\n')
    + '\n\nAbove 40 rebels may rise. Lower it with troops in the province, more civil spending, lower taxes, tolerance or a crackdown.';
}

// Province panel: religion with conversion, unrest with its causes, any revolt, and a crackdown.
export function provinceSociety(cl, p) {
  const s = cl.state, R = cl.game.rules, S = R.society, so = s.society, map = cl.game.map;
  if (!S || !so || p < 0 || p >= map.count) return null;
  const own = s.prov.owner[p], c = s.countries[own];
  if (own < 0) {
    const r = so.rel[p];
    return r === NO_REL ? null : h('div.kv', h('span', 'Religion'), h('span', swatch(S.list[r].color), S.list[r].name));
  }
  const r = so.rel[p], st = stateRelIdx(S, c), u = so.unrest[p];
  const parts = unrestParts(s, map, R, p, garrisons(s, map)[p]);
  let relLine = r === NO_REL ? 'None' : [swatch(S.list[r].color), S.list[r].name];
  let relTip = 'The faith most people here follow.';
  if (r !== NO_REL && st >= 0 && r !== st) {
    const rate = conversionRate(s, R, p, c);
    relTip += ` Not the state religion of ${c.name} (${S.list[st].name}): it adds unrest and lowers stability unless tolerated.`;
    relTip += rate > 0 ? `\nConverting: ${pct(so.conv[p])} done, about ${Math.ceil((1 - so.conv[p]) / rate / 12)} more years at this pace. A state religion policy and civil spending speed it up; high unrest stops it.`
      : '\nNo conversion at present (occupied, too restless, or a secular state with low development).';
    relLine = [relLine, h('span.muted', ` (${pct(so.conv[p])} converted)`)];
  }
  const rv = revoltAt(s, p), me = s.player, mine = own === me;
  const why = mine ? canSuppress(s, R, me, p) : null;
  return h('div',
    h('div.kv',
      h('span', { tip: relTip }, 'Religion'), h('span', { tip: relTip }, relLine),
      h('span', { tip: unrestTip(parts) }, 'Unrest'), h('span', { tip: unrestTip(parts), className: u >= S.V.unrest ? 'bad' : u >= 20 ? 'warn' : '' }, `${Math.round(u)} / 100`)),
    h('div', { tip: unrestTip(parts) }, bar(u / 100, u >= S.V.unrest ? 'var(--bad)' : u >= 20 ? 'var(--warn)' : '')),
    rv && revoltLine(cl, rv, p),
    mine && h('div.row', { style: { marginTop: '0.3em' } },
      h('button', { disabled: !!why, tip: (why ? why + '\n\n' : '') + `Crack down: −${S.V.suppressUnrest} unrest now and a further −${S.V.suppressDuration} that fades over about ${Math.round(S.V.suppressDuration / S.V.suppressDecay)} months. Costs ${money(suppressCost(s, R, me))} and ${S.V.suppressLegitimacy} legitimacy.`,
        on: { click: () => { const e = suppress(s, R, me, p); if (e) cl.toast(e, true); else cl.toast(`Crackdown ordered in ${map.name[p]}.`); refresh(cl); } } }, 'Suppress unrest')));
}

function revoltLine(cl, r, p) {
  const s = cl.state, R = cl.game.rules, V = R.society.V, map = cl.game.map;
  const months = r.since >= 0 ? (s.day - r.since) / 30.44 : 0, limit = r.kind === 'separatist' ? V.independenceMonths : V.demandMonths;
  const goal = r.kind === 'separatist' ? 'declare independence' : 'force concessions';
  const status = r.p !== p ? 'Held by the rebels' : r.fight ? 'Fighting your troops' : r.held.includes(p) ? 'Rebels hold the province' : `Rebels besieging: ${pct(r.prog)}`;
  const tip = `${r.name} (${revoltKindName(r.kind)}), ${Math.max(1, Math.round(r.units))} units at ${pct(r.str)} strength, power ${Math.round(revoltPower(s, R, r, map))}.`
    + `\nHolds ${r.held.length} province(s)` + (r.held.length ? `; they ${goal} after ${limit} months of holding land (${Math.floor(months)} so far).` : '.')
    + '\nMove an army into the rebels\' province to fight them; held provinces pay no tax.';
  return h('div.bad', { tip }, `${r.name}: ${status}`);
}

// Nation tab: key/value items for kvbox.
export function countrySociety(cl, k) {
  const s = cl.state, R = cl.game.rules, S = R.society, c = s.countries[k];
  if (!S || !s.society || !c?.soc) return [];
  const st = S.list[stateRelIdx(S, c)], so = c.soc;
  const revolts = s.society.revolts.filter((r) => r.c === k);
  const age = so.age;
  return [
    h('span', { tip: 'The faith of the state. Provinces of other faiths are restless; countries of the same faith like each other.' }, 'State religion'),
    h('span', st ? [swatch(st.color), st.name, h('span.muted', ` (${pct(so.faith ?? 1)} of the people)`)] : '—'),
    h('span', { tip: 'Average unrest, weighted by population. Open the unrest map mode (key 7) to see where.' }, 'Unrest (avg.)'),
    h('span', { className: (so.unrest || 0) >= 25 ? 'bad' : '' }, `${Math.round(so.unrest || 0)}` + (revolts.length ? `, ${revolts.length} revolt(s)` : '')),
    age && h('span', age.kind === 'golden' ? 'Golden age' : 'Dark age'),
    age && h('span', { className: age.kind === 'golden' ? 'good' : 'bad' }, age.kind === 'golden' ? `until ${formatDate(age.until)}` : `since ${formatDate(age.start)}`),
  ];
}

// Government tab section.
export function societySection(cl, k) {
  const s = cl.state, R = cl.game.rules, S = R.society, map = cl.game.map, c = s.countries[k];
  if (!S || !s.society || !c?.soc) return null;
  const so = c.soc, mine = k === s.player, st = stateRelIdx(S, c);
  const mix = religionMix(s, map, R, k), tot = mix.reduce((t, x) => t + x[1], 0) || 1;
  const pol = c.govt?.policies?.religion, pf = S.R.policy[pol] || S.R.policy.tolerant;
  const revolts = s.society.revolts.filter((r) => r.c === k);
  const sp = stabilityParts(s, R, c) || {};
  const G = S.A.golden, D = S.A.dark;
  const gw = goldenCheck(s, R, c), dw = crisisCheck(s, R, c);
  return h('div',
    h('h3', { style: { marginTop: '0.8em' } }, 'Religion and unrest'),
    h('p.muted', `Tolerance is set by the Religion policy above: now ${R.politics.policies.religion?.options[pol]?.name || pol}. Unrest from other faiths ×${pf.unrest}, stability loss ×${pf.stability}, conversion ×${pf.conversion}.`),
    h('table.t.small', mix.slice(0, 6).map(([r, n]) => h('tr',
      h('td', swatch(S.list[r].color), S.list[r].name, r === st ? h('span.muted', ' (state)') : null),
      h('td', { style: { width: '40%' }, tip: pct(n / tot, 1) }, bar(n / tot, S.list[r].color)),
      h('td.n', pct(n / tot)),
      h('td', r !== st && (() => {
        const why = mine ? canChangeReligion(s, map, R, k, S.list[r].id) : 'Not your country';
        return h('button', { disabled: !!why, tip: (why ? why + '\n\n' : '') + `Make ${S.list[r].name} the state religion: −${S.R.changeStability} stability, −${S.R.changeLegitimacy} legitimacy, the clergy is angered for ${S.R.changeMonths} months, and conversion starts over. Once every ${S.R.changeCooldownYears} years.`,
          on: { click: () => { const e = changeReligion(s, map, R, k, S.list[r].id); if (e) cl.toast(e, true); refresh(cl); } } }, 'Adopt');
      })())))),
    h('div.kv',
      h('span', { tip: 'Rises in wars, faster while your land is occupied or the war goes badly; fades in peace. It adds unrest and lowers stability.' }, 'War exhaustion'),
      h('span', { className: (so.warEx || 0) > 30 ? 'bad' : '' }, `${Math.round(so.warEx || 0)} / 100`),
      h('span', { tip: 'What religion, unrest, revolts, war exhaustion and any golden or dark age add to the stability target.' }, 'Effect on stability'),
      h('span', Object.keys(sp).length ? Object.entries(sp).map(([key, v]) => `${{ religion: 'religion', unrest: 'unrest', revolts: 'revolts', war: 'war', age: 'age' }[key]} ${sg(v, 1)}`).join(', ') : 'none')),
    revolts.length > 0 && h('div', h('h4', 'Revolts'), revolts.map((r) => h('div.row.spread',
      h('a', { href: '#', on: { click: (e) => { e.preventDefault(); cl.focusProvince(r.p); } } }, r.name),
      h('span.muted', `${Math.max(1, Math.round(r.units))} units, holds ${r.held.length}`)))),
    h('h4', 'Golden and dark ages'),
    so.age ? h('p', { className: so.age.kind === 'golden' ? 'good' : 'bad' }, so.age.kind === 'golden'
      ? `Golden age since ${formatDate(so.age.start)}, until ${formatDate(so.age.until)} at the latest: research ×${G.research}, growth ×${G.growth}, stability +${G.stabilityBonus}, unrest −${G.unrest}. It ends early if stability falls below ${G.endStability}.`
      : `Dark age since ${formatDate(so.age.start)}: research ×${D.research}, growth ×${D.growth}, stability −${D.stabilityPenalty}, unrest +${D.unrest}. It lifts after ${D.recoverMonths} months with stability of ${D.recoverStability} or more.`) : null,
    h('div.kv',
      h('span', { tip: `Months of stability ${G.stability}+, low unrest, prosperity and rising prestige, in peace and not losing a war. At ${G.momentum} a golden age may begin; a bad month takes away two.` }, 'Golden momentum'),
      h('span', `${so.gold || 0} / ${G.momentum}` + (gw ? ` (not now: ${gw})` : ' (rising)')),
      h('span', { tip: `Months of crisis: stability under ${D.stability}, hunger, runaway inflation, war exhaustion over ${D.warExhaustion} or rebels holding land. At ${D.momentum} a dark age may begin.` }, 'Crisis months'),
      h('span', { className: dw ? 'bad' : '' }, `${so.dark || 0} / ${D.momentum}` + (dw ? ` (${dw})` : ''))));
}
