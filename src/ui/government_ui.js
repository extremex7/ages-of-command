// Government tab: type, legitimacy, factions and their approval, elections, coup and revolution
// risk, policies, reforms and active modifiers. Shows the selected country (read-only) or yours.
import { h } from './dom.js';
import { pct } from './format.js';
import { formatDate } from '../core/calendar.js';
import { refreshCountryCache } from '../core/state.js';
import { computeLedgers } from '../core/economy.js';
import { advisorsSection } from './nation_ui.js';
import {
  govType, factionTargets, coupChance, revolutionChance, disgruntled, canSetPolicy, setPolicy, canReform, reformGovernment, monthsToElection,
} from '../core/government.js';

const sg = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);

function bar(v, color = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: color } }));
}

function effectsText(rules, fx) {
  const P = rules.politics, out = [];
  for (const [k, v] of Object.entries(fx || {})) {
    if (k === 'faction') for (const [f, d] of Object.entries(v)) out.push(`${P.factions[f].name} approval ${sg(d)}`);
    else if (k === 'manpower' || k === 'construction' || k === 'coupRisk') out.push(`${{ manpower: 'Manpower', construction: 'Construction cost', coupRisk: 'Coup risk' }[k]} ×${v}`);
    else if (k === 'taxEff') out.push(`Tax efficiency ${sg(v * 100)}%`);
    else if (k === 'liberty') out.push(`Liberty ${sg(v, 2)}`);
    else out.push(`${k[0].toUpperCase() + k.slice(1)} ${sg(v)}`);
  }
  return out.length ? out.join('\n') : 'No effects (the baseline)';
}

const DRIVER_NAMES = { tax: 'low taxes', services: 'civil spending', defence: 'military spending', prosperity: 'prosperity', peace: 'peace', glory: 'military glory', liberty: 'liberty', order: 'order', faith: 'religion', planning: 'state planning' };

export function governmentTab(cl) {
  const s = cl.state, C = s.countries, R = cl.game.rules, P = R.politics, G = R.balance.government;
  const k = cl.view.selectedCountry >= 0 ? cl.view.selectedCountry : s.player;
  if (k < 0) return h('p.muted', 'Select a country to see its government.');
  const c = C[k], g = c.govt, T = govType(R, c);
  const mine = k === s.player;
  const targets = factionTargets(s, R, c, null, null, true);
  const parts = g.stabilityParts || {};
  const coup = coupChance(R, c), rev = revolutionChance(R, c), dis = disgruntled(R, c);
  const next = monthsToElection(s, c);
  const refresh = () => { refreshCountryCache(s, cl.game.map, R); computeLedgers(s, cl.game.map, R); cl.uiDirty = true; cl.requestFrame(); };
  const factions = P.factionIds.slice().sort((a, b) => g.support[b] - g.support[a]);
  return h('div',
    h('h3', `${c.name}: ${T.name}`),
    !mine && h('p.muted', 'Viewing another country (read-only).'),
    h('div.kv',
      h('span', { tip: `Family: ${P.families[T.family].name}. Governments of the same family like each other; see the diplomacy opinion breakdown.` }, 'Form'), h('span', P.families[T.family].name),
      h('span', { tip: T.electionYears ? 'In a democracy the faction that wins the election governs.' : 'Fixed by the form of government.' }, 'Ruling faction'), h('span', P.factions[g.ruling]?.name || g.ruling),
      h('span', { tip: `Moves 5% a month toward ${T.legitimacy} (type) + policies + ${G.legitimacyApproval} × (approval − 50). Elections add ${G.electionLegitimacy}.` }, 'Legitimacy'), h('span', Math.round(g.legitimacy) + ' / 100'),
      h('span', { tip: 'Support-weighted average approval of all factions.' }, 'Approval'), h('span', { className: g.approvalAll < 35 ? 'bad' : '' }, Math.round(g.approvalAll) + ' / 100'),
      h('span', { tip: 'Contributions of the government to the stability target this month: type and policies, (approval − 50) × ' + G.approvalStability + ', (legitimacy − 70) × ' + G.legitimacyStability + '.' }, 'Stability effect'),
      h('span', `type ${sg(parts.government || 0, 1)}, approval ${sg(parts.approval || 0, 1)}, legitimacy ${sg(parts.legitimacy || 0, 1)}`),
      T.electionYears ? h('span', 'Next election') : null, T.electionYears ? h('span', `${formatDate(g.nextElection)} (${Math.max(0, Math.round(next))} months)`) : null,
      g.lastVotes ? h('span', 'Last election') : null, g.lastVotes ? h('span', `${formatDate(g.lastElection)}: ` + Object.entries(g.lastVotes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, v]) => `${P.factions[f].name} ${pct(v)}`).join(', ')) : null,
      h('span', { tip: `Monthly chance: ${G.coupBase} × coup risk ${g.fx.coupRisk.toFixed(2)} × military strength (support ×4, max 1) × how far military approval is below ${G.coupApproval} × how far stability is below ${G.coupStability}.` }, 'Coup risk'),
      h('span', { className: coup > 0.005 ? 'bad' : '' }, coup > 0 ? pct(coup, 1) + ' a month' : 'none'),
      h('span', { tip: `Only below stability ${G.revolutionStability}, when more than ${pct(G.revolutionShare)} of the people back factions with approval under ${G.revolutionApproval} (now ${pct(dis.share)}${dis.leader ? ', led by the ' + P.factions[dis.leader].name : ''}).` }, 'Revolution risk'),
      h('span', { className: rev > 0 ? 'bad' : '' }, rev > 0 ? pct(rev, 1) + ' a month' : 'none')),
    h('h3', { style: { marginTop: '0.8em' } }, 'Factions'),
    h('table.t.small',
      h('tr', h('th', 'Faction'), h('th', 'Support'), h('th.n', 'Approval'), h('th.n', { tip: 'Where approval is heading' }, 'Target')),
      factions.map((f) => {
        const F = P.factions[f], t = targets[f];
        const tip = `${F.name} want: ` + Object.entries(F.weights).map(([d, w]) => `${w < 0 ? 'less ' : ''}${DRIVER_NAMES[d]}`).join(', ')
          + `\n\nTarget ${Math.round(t.target)} = ${G.approvalBase} + ${G.approvalSpread} × tanh(sum)` + (t.inPower ? ` + ${t.inPower} in power` : '') + (t.extra ? ` ${sg(t.extra)} policies and events` : '')
          + '\n' + t.parts.map(([d, v]) => `  ${DRIVER_NAMES[d]} ${sg(v, 2)}`).join('\n');
        return h('tr', h('td', { tip }, h('b', { style: { color: F.color } }, '■ '), F.name, g.ruling === f ? h('span.muted', ' (ruling)') : null),
          h('td', { style: { width: '35%' }, tip: pct(g.support[f], 1) }, bar(g.support[f] * 2, F.color)),
          h('td.n', { className: g.approval[f] < 30 ? 'bad' : g.approval[f] > 65 ? 'good' : '' }, Math.round(g.approval[f])),
          h('td.n.muted', Math.round(t.target)));
      })),
    h('h3', { style: { marginTop: '0.8em' } }, 'Policies'),
    mine && h('p.muted', `Changing a policy costs ${G.policyLegitimacyCost} legitimacy and ${G.policyStabilityCost} stability, then waits ${G.policyCooldownDays} days.`),
    P.policyIds.map((grp) => h('div', { style: { marginBottom: '0.4em' } }, h('div.muted', P.policies[grp].name),
      h('div.row.wrap', Object.entries(P.policies[grp].options).map(([o, opt]) => {
        const on = g.policies[grp] === o;
        const why = mine ? canSetPolicy(s, R, k, grp, o) : 'Not your country';
        return h('button' + (on ? '.on' : ''), { disabled: !on && !!why, tip: `${opt.name}\n${effectsText(R, opt.effects)}` + (!on && why ? `\n\n${why}` : ''),
          on: { click: () => { if (on) return; const e = setPolicy(s, R, k, grp, o); if (e) cl.toast(e, true); refresh(); } } }, opt.name);
      })))),
    (T.reformsTo || []).length > 0 && h('div', h('h3', { style: { marginTop: '0.8em' } }, 'Reform the government'),
      mine && h('p.muted', `A reform costs ${G.reformStabilityCost} stability, sets legitimacy to ${G.reformLegitimacy} and resets policies; one every ${Math.round(G.reformCooldownDays / 365)} years, in peacetime.`),
      h('div.row.wrap', T.reformsTo.map((to) => {
        const why = mine ? canReform(s, R, k, to) : 'Not your country';
        const N = P.types[to];
        return h('button', { disabled: !!why, tip: `${N.name} (${P.families[N.family].name.toLowerCase()})\nStability ${sg(N.stability)}, legitimacy ${N.legitimacy}, tax efficiency ×${N.taxEff}, manpower ×${N.manpower}, liberty ${N.liberty}` + (N.electionYears ? `, elections every ${N.electionYears} years` : ', no elections') + (why ? `\n\n${why}` : ''),
          on: { click: () => { const e = reformGovernment(s, R, k, to); if (e) cl.toast(e, true); refresh(); } } }, N.name);
      }))),
    advisorsSection(cl, k),
    h('h3', { style: { marginTop: '0.8em' } }, 'Active modifiers'),
    g.mods.length ? h('table.t.small', g.mods.map((m) => h('tr', h('td', { tip: effectsText(R, m.effects) }, m.name), h('td.muted', `until ${formatDate(m.until)}`)))) : h('p.muted', 'None.'),
    mine && s.pendingEvents.some((p) => p.c === k) && h('div', { style: { marginTop: '0.8em' } }, s.pendingEvents.filter((p) => p.c === k).map((p) => h('button.primary', { on: { click: () => cl.openEvent(p) } }, `Decide: ${p.title}`))));
}
