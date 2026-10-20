// Nation tab sections for docs/NATIONS.md: national traits, decisions (formable nations) and
// objectives (missions); and the advisors section of the Government tab. Reads the simulation and
// changes it only through core functions (formNation, hireAdvisor, dismissAdvisor).
import { h } from './dom.js';
import { money, pct } from './format.js';
import { formatDate } from '../core/calendar.js';
import { refreshCountryCache } from '../core/state.js';
import { computeLedgers } from '../core/economy.js';
import { describeNatFx, nationalFx, advisorSalary } from '../core/natfx.js';
import { formablesFor, formStatus, formNation } from '../core/nations.js';
import { missionText, missionProgress, describeReward } from '../core/missions.js';
import { advisorPool, advisorSlots, advisorTitle, advisorAge, hireAdvisor, hireCost, canHire, dismissAdvisor } from '../core/advisors.js';
import { setFlagScenario } from './flags.js';

function bar(v, color = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: color } }));
}

const head = (t, tip) => h('h3', { style: { marginTop: '0.8em' }, tip }, t);

function refresh(cl) {
  const s = cl.state, R = cl.game.rules;
  refreshCountryCache(s, cl.game.map, R); computeLedgers(s, cl.game.map, R);
  cl.uiDirty = true; cl.requestFrame();
}

export function traitsSection(cl, k) {
  const R = cl.game.rules, c = cl.state.countries[k], N = R.nations;
  if (!N || !c.traits) return null;
  const total = nationalFx(R, c);
  return h('div',
    head('National traits', `Lasting strengths of the country. All bonuses together (traits and advisors): ${describeNatFx(total)}.`),
    c.traits.length ? h('div.row.wrap', c.traits.map((t) => { const T = N.traits[t]; return T && h('span.chip.trait', { tip: `${T.name}\n${T.text}\n\n${describeNatFx(T.effects)}` }, T.name); }))
      : h('p.muted', 'None.'),
    c.prestigeBonus >= 0.05 && h('div.muted.small', { tip: 'From forming nations and completing objectives; added to the prestige score (at most 15) and fading by about 1% a month.' }, `Prestige bonus +${Math.min(15, c.prestigeBonus).toFixed(1)}`),
    c.formed?.length > 0 && h('div.muted.small', `Formed: ${c.formed.map((id) => N.formables[id]?.name || id).join(', ')}`));
}

// Formable nations this country could form, with progress; the player gets the decision button.
export function decisionsSection(cl, k) {
  const s = cl.state, R = cl.game.rules, map = cl.game.map, N = R.nations;
  if (!N || !s.countries[k].alive) return null;
  const mine = k === s.player;
  const list = formablesFor(s, map, R, k);
  if (!list.length) return null;
  cl.view.formOpen ||= {};
  return h('div',
    head('Decisions', 'Nations this country can form. Forming renames the country, changes its flag, adds a national trait, prestige, stability and legitimacy, and claims every province of the region it does not own yet.'),
    list.map(({ id, F }) => {
      const st = formStatus(s, map, R, k, id, true), open = cl.view.formOpen[id];
      const reward = `${N.traits[F.trait]?.name ? `Trait: ${N.traits[F.trait].name} (${describeNatFx(N.traits[F.trait].effects)})\n` : ''}Prestige +${F.prestige || 0}, stability +${N.forming.stability}, legitimacy +${N.forming.legitimacy}\nClaims on the ${st.missing.length} provinces of the region you do not own`;
      return h('div.army-card',
        h('div.row.spread', h('b', { tip: F.text }, F.name), h('span.muted', `${st.own} / ${st.total} provinces`)),
        h('div', { tip: `Needs ${pct(F.need)} of the region (${Math.ceil(F.need * st.total)} provinces)` }, bar(st.share / F.need, st.ok ? 'var(--good, #4caf50)' : '')),
        h('div', { className: st.ok ? 'good' : 'muted' }, st.ok ? 'Ready to form.' : st.why),
        h('div.row', { style: { marginTop: '0.3em' } },
          mine && h('button' + (st.ok ? '.primary' : ''), { disabled: !st.ok, tip: (st.ok ? `Proclaim ${F.name}.\n\n` : `${st.why}\n\n`) + reward,
            on: { click: () => { const e = formNation(s, map, R, k, id); if (e) cl.toast(e, true); else { setFlagScenario(s.scenarioId, [s.countries[k]]); cl.renderer.invalidate(); cl.toast(`You have proclaimed ${F.name}.`); } refresh(cl); } } }, `Form ${F.name}`),
          st.missing.length > 0 && h('button', { on: { click: () => { cl.view.formOpen[id] = !open; cl.uiDirty = true; cl.requestFrame(); } } }, open ? 'Hide missing provinces' : `Missing provinces (${st.missing.length})`)),
        open && h('div.small', st.missing.slice(0, 24).map((p, i) => [i ? ', ' : '', h('a', { href: '#', tip: `Held by ${s.countries[s.prov.owner[p]]?.name || 'nobody'}`, on: { click: (e) => { e.preventDefault(); cl.focusProvince(p); } } }, map.name[p])]),
          st.missing.length > 24 ? h('span.muted', ` and ${st.missing.length - 24} more`) : null));
    }));
}

// Current objectives with progress, deadline and reward.
export function missionsSection(cl, k) {
  const s = cl.state, R = cl.game.rules, map = cl.game.map, c = s.countries[k];
  if (!R.nations?.missions || !c.alive) return null;
  const list = c.missions || [];
  return h('div',
    head('Objectives', 'National objectives drawn from the country\'s situation. Each has a deadline and a reward; new ones replace those finished or expired, about one a month (every third month for AI countries).'),
    list.length ? list.map((m) => {
      const t = missionText(s, map, R, m), pr = missionProgress(s, map, R, c, m);
      return h('div.army-card.mission',
        h('div.row.spread', h('b', { tip: t.text }, t.title), h('span.muted', `by ${formatDate(m.until)}`)),
        h('div.muted.small', t.text),
        h('div', { tip: pct(pr.p) }, bar(pr.p, 'var(--blue)')),
        h('div.small', h('span.muted', 'Reward: '), describeReward(s, m.reward, m)),
        m.kind === 'claim' && h('a', { href: '#', on: { click: (e) => { e.preventDefault(); cl.focusProvince(m.p); } } }, 'Show on map'));
    }) : h('p.muted', 'No objectives yet: new ones come at the start of a month.'));
}

// Government tab: advisor seats and candidates.
export function advisorsSection(cl, k) {
  const s = cl.state, R = cl.game.rules, map = cl.game.map, c = s.countries[k], A = R.nations?.advisors;
  if (!A || !c.alive) return null;
  const mine = k === s.player, era = c.tfx?.era ?? 0, list = c.advisors || [], seats = advisorSlots(R, c);
  const fxOf = (a) => describeNatFx(Object.fromEntries(Object.entries(A.types[a.type].perSkill).map(([e, v]) => [e, v * a.skill])));
  return h('div',
    head(`Advisors (${list.length} of ${seats} seats)`, `A ${R.politics.types[c.gov]?.name.toLowerCase() || 'government'} has ${seats} seats, one advisor of each kind at most. Salary: (${A.salaryBase} + ${A.salaryRevenueShare * 100}% of revenue) × skill a month; hiring costs ${A.hireMonths} months of salary. Advisors age, can be promoted, retire and die.`),
    list.length ? h('table.t.small', list.map((a) => h('tr',
      h('td', { tip: `${A.types[a.type].text}\n${fxOf(a)}\nIn office since ${formatDate(a.since)}; retires at ${a.retire}.` }, h('b', advisorTitle(R, a.type, era)), ' ', a.name),
      h('td.n', { tip: 'Skill (1 to 5)' }, '★'.repeat(a.skill)),
      h('td.n.muted', `${advisorAge(s, a)} yrs`),
      h('td.n', { tip: 'Monthly salary' }, money(advisorSalary(R, c, a))),
      mine && h('td', h('button', { tip: 'Dismiss (no refund)', on: { click: () => { dismissAdvisor(s, R, k, a.id); refresh(cl); } } }, '×')))))
      : h('p.muted', 'No advisors.'),
    mine && h('div', h('div.muted', { style: { marginTop: '0.4em' } }, `Candidates (new ones every ${A.poolMonths} months)`),
      h('table.t.small', advisorPool(s, map, R, k).map((cand) => {
        const why = canHire(s, R, k, cand), cost = hireCost(R, c, cand);
        return h('tr',
          h('td', { tip: `${A.types[cand.type].text}\n${fxOf(cand)}\nRetires at ${cand.retire}.` }, h('b', advisorTitle(R, cand.type, era)), ' ', cand.name),
          h('td.n', '★'.repeat(cand.skill)), h('td.n.muted', `${cand.age} yrs`),
          h('td.n', { tip: 'Monthly salary' }, money(advisorSalary(R, c, cand))),
          h('td', h('button', { disabled: !!why, tip: why || `Hire for ${money(cost)}, then ${money(advisorSalary(R, c, cand))} a month`, on: { click: () => { const r = hireAdvisor(s, map, R, k, cand.cid); if (typeof r === 'string') cl.toast(r, true); refresh(cl); } } }, `Hire ${money(cost)}`)));
      }))));
}
