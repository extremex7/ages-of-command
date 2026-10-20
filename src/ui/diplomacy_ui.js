// Diplomacy tab and the relations section of a foreign country. Opinions and acceptance chances
// are computed by the same functions the AI uses, and every tooltip lists their parts.
import { councilSection } from './council_ui.js';
import { h } from './dom.js';
import { flagCanvas } from './flags.js';
import { formatDate } from '../core/calendar.js';
import { atWar, allied } from '../core/relations.js';
import { countryNeighbours } from '../core/geo.js';
import { warScore, makePeace, joinWar, separateScore, makeSeparatePeace } from '../core/war.js';
import {
  TREATIES, PROPOSABLE, opinion, trust, evaluateTreaty, proposeTreaty, recordOrder, validateTreaty, treatiesOf, treatiesBetween, cancelTreaty, canCancel,
  canImprove, improveRelations, acceptTreatyOffer, declineOffer, applyToBloc, leaveBloc, canJoinBloc, overlordOf, subjectsOf, treatyCount, addMod, seniorOf, juniorsOf,
} from '../core/diplomacy.js';
import { describeTerms } from '../core/ai.js';
import { dealsSection, dealsTab } from './deals_ui.js';

const sg = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));
const opClass = (v) => (v >= 30 ? 'good' : v <= -30 ? 'bad' : v < 0 ? 'warn' : '');

function partsTip(title, total, parts) {
  return `${title}: ${sg(total)}\n` + (parts.length ? parts.map(([t, v]) => `  ${t} ${sg(v)}`).join('\n') : '  (nothing)');
}

export function opinionCell(cl, a, b) {
  const s = cl.state, parts = [];
  const v = opinion(s, cl.game.map, cl.game.rules, a, b, parts);
  return h('span', { className: opClass(v), tip: partsTip(`Opinion of ${s.countries[a].name} toward ${s.countries[b].name} (−100…100)`, v, parts) }, sg(v));
}

function trustCell(cl, a, b) {
  const s = cl.state, parts = [];
  const v = trust(s, cl.game.rules, a, b, parts);
  return h('span', { className: v < 35 ? 'bad' : v > 65 ? 'good' : '', tip: partsTip(`Trust of ${s.countries[a].name} in ${s.countries[b].name} (0…100, base 50)`, v - 50, parts) }, String(Math.round(v)));
}

function done(cl, msg, bad = false) {
  if (msg) cl.toast(msg, bad);
  cl.uiDirty = true; cl.renderer.invalidate(); cl.requestFrame();
}

function treatyLabel(s, t, me) {
  const C = s.countries, other = t.a === me ? t.b : t.a;
  const T = TREATIES[t.type];
  if (T.mutual) return `${T.name} with ${C[other].name}`;
  return {
    access: t.a === me ? `Military access granted to ${C[t.b].name}` : `Military access through ${C[t.a].name}`,
    guarantee: t.a === me ? `Guaranteeing ${C[t.b].name}` : `Guaranteed by ${C[t.a].name}`,
    subject: t.a === me ? `Overlord of ${C[t.b].name}` : `Subject of ${C[t.a].name}`,
    reparations: t.a === me ? `Paying reparations to ${C[t.b].name}` : `Receiving reparations from ${C[t.a].name}`,
    union: t.a === me ? `Personal union: ${C[t.b].name} is the junior partner` : `Personal union under ${C[t.a].name}`,
  }[t.type];
}

// ---------------------------------------------------------------------------------------------
// Diplomacy tab

export function diplomacyTab(cl) {
  const s = cl.state, C = s.countries, me = s.player, map = cl.game.map, R = cl.game.rules, D = R.balance.diplomacy;
  const out = [];
  if (me >= 0) {
    const c = C[me];
    out.push(h('div.kv',
      h('span', { tip: `Gained monthly (${D.influenceBase} + more for larger economies, up to ${D.influenceCap}). Spent to improve relations.` }, 'Influence'), h('span', Math.floor(c.influence) + ' / ' + D.influenceCap),
      h('span', { tip: 'Falls when you break treaties or start unprovoked wars; recovers slowly toward 0. Every country\'s opinion and trust of you depends on it.' }, 'Reputation'), h('span', { className: c.reputation < -10 ? 'bad' : '' }, sg(c.reputation)),
      h('span', { tip: 'Your declared rival: −35 opinion toward them. The AI picks its own rivals by threat, opinion and lost land.' }, 'Rival'), h('span', c.rival >= 0 ? C[c.rival].name : 'None'),
      h('span', { tip: `Treaties count against a limit of ${D.maxTreaties} (peace-treaty obligations do not).` }, 'Treaties'), h('span', `${treatyCount(s, me)} / ${D.maxTreaties}`),
      h('span', { tip: 'Provinces taken from you in peace treaties during the last ' + D.claimYears + ' years. Reclaiming them is cheaper in peace talks, and your opinion of their holder is lower.' }, 'Claims'), h('span', String(c.claims.length))));
    out.push(offersSection(cl));
    out.push(dealsTab(cl));
  }
  out.push(warsSection(cl));
  out.push(councilSection(cl));
  if (me >= 0) {
    out.push(h('h3', { style: { marginTop: '1em' } }, 'Treaties'));
    const ts = treatiesOf(s, me);
    out.push(ts.length ? h('table.t.small', ts.map((t) => {
      const why = canCancel(s, R, t, me);
      const early = s.day - t.start < D.minTreatyDays && !TREATIES[t.type].peaceOnly;
      return h('tr', h('td', { tip: TREATIES[t.type].tip }, treatyLabel(s, t, me)), h('td.muted', t.until >= 0 ? 'until ' + formatDate(t.until) : 'since ' + formatDate(t.start)),
        h('td', h('button', { disabled: !!why, tip: why || (early ? `Signed less than ${D.minTreatyDays} days ago: ending it now costs ${(D.breakReputation[t.type] || 0) / 2} reputation.` : 'End this treaty. The other side\'s opinion of you falls a little.'),
          on: { click: () => done(cl, cancelTreaty(s, map, R, t, me), true) } }, (t.type === 'subject' || t.type === 'union') && t.a === me ? 'Release' : 'End')));
    })) : h('p.muted', 'No treaties. Select a country to propose one.'));
    out.push(blocsSection(cl));
    out.push(relationsTable(cl));
  }
  return h('div', out);
}

function offersSection(cl) {
  const s = cl.state, C = s.countries, me = s.player, map = cl.game.map, R = cl.game.rules;
  const offers = s.offers.filter((o) => o.to === me);
  if (!offers.length) return null;
  const remove = (o) => { s.offers = s.offers.filter((x) => x !== o); };
  return h('div', h('h3', 'Proposals to you'), offers.map((o) => {
    const war = o.war != null ? s.wars.find((w) => w.id === o.war) : null;
    let title, desc, accept;
    if (o.kind === 'treaty') {
      title = `${C[o.from].name} proposes: ${TREATIES[o.type].name}`;
      desc = TREATIES[o.type].tip + (o.type === 'access' ? ` (you would grant ${C[o.from].name} access)` : '');
      accept = () => acceptTreatyOffer(s, map, R, o);
    } else if (o.kind === 'call') {
      if (!war) return null;
      title = `${C[o.from].name} calls you to arms`;
      desc = `Join the ${war.name} as their ally. Refusing lowers their opinion of you and their trust.`;
      accept = () => { remove(o); return joinWar(s, map, R, war, me, 'A'); };
    } else if (o.kind === 'separate') {
      if (!war) return null;
      title = `${C[o.from].name} asks for a separate peace`;
      desc = o.terms.provinces.length ? `They would cede ${o.terms.provinces.length} province(s): ${o.terms.provinces.slice(0, 4).map((p) => map.name[p]).join(', ')}` : 'They leave the war; nothing changes hands.';
      accept = () => { remove(o); makeSeparatePeace(s, map, R, war, o.from, o.terms); return null; };
    } else {
      if (!war) return null;
      title = `${C[o.from].name}: ${war.name}`;
      const t = o.terms;
      desc = t.provinces.length ? `They demand ${t.provinces.length} province(s): ${t.provinces.slice(0, 5).map((p) => map.name[p]).join(', ')}${t.provinces.length > 5 ? '…' : ''}` : '';
      if (t.reparations || t.subject || t.independence || t.union) desc += (desc ? '; ' : '') + describeTerms(s, { ...t, provinces: [] });
      desc ||= 'White peace (no changes).';
      accept = () => { remove(o); makePeace(s, map, R, war, o.from, o.terms); return null; };
    }
    return h('div.army-card', h('b', title), h('div', desc),
      h('div.row', h('button.primary', { on: { click: () => done(cl, accept(), true) } }, 'Accept'),
        h('button', { on: { click: () => {
          declineOffer(s, map, R, o);
          if (o.kind === 'call') addMod(s, o.from, me, -20, R.balance.diplomacy.modDecay, 'Refused our call to arms');
          done(cl);
        } } }, 'Decline')));
  }));
}

function warsSection(cl) {
  const s = cl.state, C = s.countries, me = s.player, map = cl.game.map, R = cl.game.rules;
  const wars = me >= 0 ? s.wars.filter((w) => w.attackers.includes(me) || w.defenders.includes(me)) : s.wars;
  const out = [h('h3', me >= 0 ? 'Your wars' : 'Wars')];
  if (!wars.length) out.push(h('p.muted', 'At peace.'));
  for (const w of wars) {
    const score = warScore(s, map, R, w);
    const mySide = me >= 0 ? (w.attackers.includes(me) ? 1 : -1) : 1;
    const leader = me === w.leaderA || me === w.leaderD;
    let action = null;
    if (me >= 0 && leader) action = h('button', { on: { click: () => cl.openPeace(w) } }, 'Negotiate peace…');
    else if (me >= 0) {
      const own = Math.round(separateScore(s, map, R, w, me));
      action = h('div', h('div.muted', `Peace is negotiated by the war leaders (${C[w.leaderA].name} and ${C[w.leaderD].name}).`),
        h('button', { tip: `Leave the war on your own. Your own score against ${C[mySide > 0 ? w.leaderD : w.leaderA].name}: ${own}. If you are losing they will want land.`, on: { click: () => cl.openSeparatePeace(w) } }, 'Separate peace…'));
    }
    out.push(h('div.army-card',
      h('div.row.spread', h('b', w.name), h('span.muted', 'since ' + formatDate(w.start))),
      h('div', h('span.muted', 'Attackers: '), w.attackers.map((k) => C[k].name).join(', ')),
      h('div', h('span.muted', 'Defenders: '), w.defenders.map((k) => C[k].name).join(', ')),
      h('div', { tip: 'War score: share of the enemy economy you occupy, minus what they occupy of yours, plus battle results (max ±30). Positive favours you.' },
        h('span.muted', 'War score: '), h('b', { className: score * mySide >= 0 ? 'good' : 'bad' }, Math.round(score * mySide))),
      action && h('div', { style: { marginTop: '0.4em' } }, action)));
  }
  return h('div', out);
}

function blocsSection(cl) {
  const s = cl.state, C = s.countries, me = s.player, map = cl.game.map, R = cl.game.rules;
  return h('div', h('h3', { style: { marginTop: '1em' } }, 'Organisations'),
    h('table.t.small', s.alliances.filter((b) => b.members.length).map((b) => {
      const member = b.members.includes(me);
      const why = member ? null : canJoinBloc(s, R, b, me);
      return h('tr',
        h('td', { tip: (b.kind === 'economic' ? 'Economic bloc: members trade without tariffs.' : 'Defence bloc: members defend each other and may enter each other\'s territory.') + `\nMembers: ${b.members.map((k) => C[k].name).join(', ')}` }, b.name),
        h('td.muted', `${b.kind === 'economic' ? 'customs union' : 'defence'}, ${b.members.length} members`),
        h('td', member
          ? h('button', { tip: b.kind === 'economic' ? 'Leave: members\' opinion of you falls.' : 'Leave: reputation −5 and members\' opinion of you falls.', on: { click: () => done(cl, leaveBloc(s, R, b, me), true) } }, 'Leave')
          : h('button', { disabled: !!why, tip: why || `Members vote: each votes yes if its opinion of you is above ${R.balance.diplomacy.blocVoteOpinion}; ${Math.round(R.balance.diplomacy.blocVoteShare * 100)}% must agree.`,
            on: { click: () => { const r = applyToBloc(s, map, R, b, me); done(cl, r.reason, !r.ok); } } }, 'Apply')));
    })));
}

function relationsTable(cl) {
  const s = cl.state, C = s.countries, me = s.player, map = cl.game.map;
  const set = new Set(countryNeighbours(s, map).sets[me]);
  for (const t of treatiesOf(s, me)) set.add(t.a === me ? t.b : t.a);
  if (C[me].rival >= 0) set.add(C[me].rival);
  for (const c of C) if (c.alive && c.rival === me) set.add(c.idx);
  const list = [...set].filter((k) => C[k].alive && k !== me).sort((a, b) => C[b].cache.armyPower - C[a].cache.armyPower);
  return h('div', h('h3', { style: { marginTop: '1em' } }, 'Relations'),
    h('p.muted', 'Neighbours, treaty partners and rivals. Hover a number for its breakdown; click a row to open the country.'),
    h('table.t.small',
      h('tr', h('th', 'Country'), h('th.n', { tip: 'Their opinion of you' }, 'Them'), h('th.n', { tip: 'Your opinion of them' }, 'You'), h('th.n', { tip: 'Their trust in you' }, 'Trust'), h('th.n', { tip: 'Army power relative to yours' }, 'Army'), h('th', 'Status')),
      list.map((k) => {
        const c = C[k];
        const st = atWar(s, me, k) ? h('span.bad', 'War') : allied(s, me, k) ? h('span.good', 'Allied') : (c.truces[me] ?? 0) > s.day ? h('span.warn', 'Truce')
          : C[me].rival === k || c.rival === me ? h('span.bad', 'Rival') : h('span.muted', treatiesBetween(s, me, k).map((t) => TREATIES[t.type].name).join(', ') || 'Peace');
        return h('tr.click', { on: { click: () => { cl.view.selectedCountry = k; cl.setTab('country'); cl.focusCountry(k); } } },
          h('td', flagCanvas(c), ' ', c.name), h('td.n', opinionCell(cl, k, me)), h('td.n', opinionCell(cl, me, k)), h('td.n', trustCell(cl, k, me)),
          h('td.n', (c.cache.armyPower / Math.max(1, C[me].cache.armyPower)).toFixed(2) + '×'), h('td', st));
      })));
}

// ---------------------------------------------------------------------------------------------
// Relations with a foreign country (shown in the Nation tab)

// key/value grid: bare strings become cells (adjacent text nodes would merge into one grid cell)
const kv = (...items) => h('div.kv', items.filter((x) => x !== false && x != null).map((x) => (typeof x === 'string' ? h('span', x) : x)));

export function relationsSection(cl, k) {
  const s = cl.state, C = s.countries, me = s.player, map = cl.game.map, R = cl.game.rules, D = R.balance.diplomacy;
  const c = C[k];
  if (!c.alive) return null;
  const ov = overlordOf(s, k), subs = subjectsOf(s, k);
  const info = kv(
    'Their rival', c.rival >= 0 ? C[c.rival].name : 'None',
    ov >= 0 && 'Overlord', ov >= 0 && C[ov].name,
    subs.length > 0 && 'Subjects', subs.length > 0 && subs.map((x) => C[x].name).join(', '),
    seniorOf(s, k) >= 0 && 'In personal union under', seniorOf(s, k) >= 0 && C[seniorOf(s, k)].name,
    juniorsOf(s, k).length > 0 && 'Junior partners', juniorsOf(s, k).length > 0 && juniorsOf(s, k).map((x) => C[x].name).join(', '),
    'Reputation', h('span', { className: c.reputation < -10 ? 'bad' : '' }, sg(c.reputation)));
  if (me < 0 || me === k) return h('div', h('h4', 'Diplomacy'), info);
  const between = treatiesBetween(s, me, k);
  const why = canImprove(s, R, me, k);
  const proposals = PROPOSABLE.map((type) => {
    const [a, b] = recordOrder(type, me, k);
    const invalid = validateTreaty(s, map, R, type, a, b);
    let tip, cls = '';
    if (invalid) tip = invalid;
    else if (type === 'guarantee') tip = `${TREATIES[type].tip}\nNeeds no acceptance.`;
    else {
      const ev = evaluateTreaty(s, map, R, type, me, k);
      tip = `${TREATIES[type].tip}\n${ev.accept ? 'They would accept' : 'They would refuse'} (score ${sg(ev.score)}):\n` + ev.reasons.map(([t, v]) => `  ${t} ${sg(v)}`).join('\n');
      cls = ev.accept ? '.good-btn' : '';
    }
    const label = { alliance: 'Alliance', defensive: 'Defensive pact', nap: 'Non-aggression', access: 'Ask access', guarantee: 'Guarantee', trade: 'Trade deal' }[type];
    return h('button' + cls, { disabled: !!invalid, tip, on: { click: () => { const r = proposeTreaty(s, map, R, type, me, k); done(cl, r.reason, !r.ok); } } }, label);
  });
  const isRival = C[me].rival === k;
  return h('div',
    h('h4', 'Relations'),
    kv(
      'Their opinion of you', opinionCell(cl, k, me),
      'Your opinion of them', opinionCell(cl, me, k),
      'Their trust in you', trustCell(cl, k, me),
      'Treaties with you', between.length ? between.map((t) => treatyLabel(s, t, me)).join(', ') : 'None'),
    info,
    h('div.row.wrap', { style: { marginTop: '0.5em' } }, proposals),
    h('div.row.wrap', { style: { marginTop: '0.4em' } },
      h('button', { disabled: !!why, tip: why || `Spend ${D.improveCost} influence: their opinion of you +${D.improveOpinion}, fading by ${D.improveDecay} a month (stacks up to +${D.improveOpinion * 3}).`, on: { click: () => done(cl, improveRelations(s, R, me, k), true) } }, `Improve relations (${D.improveCost})`),
      h('button', { tip: isRival ? 'Stop treating them as a rival.' : `Declare them your rival: your opinion of them ${D.rivalOpinion}, theirs of you ${D.rivalledByOpinion}. Wars against a rival do not cost reputation.`,
        on: { click: () => { C[me].rival = isRival ? -1 : k; done(cl); } } }, isRival ? 'Drop rivalry' : 'Make rival')),
    dealsSection(cl, k));
}

export function embargoAllowed(s, me, k) {
  return !treatiesBetween(s, me, k).some((t) => t.type === 'trade');
}
