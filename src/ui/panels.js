// Sidebar tabs and the province panel. Each render reads current game state; nothing here
// is decorative — every number shown comes from the simulation.
import { h, mount } from './dom.js';
import { flagCanvas } from './flags.js';
import { money, signedMoney, people, pct } from './format.js';
import { formatDate } from '../core/calendar.js';
import { TERRAINS } from '../core/mapdata.js';
import { computeLedgers } from '../core/economy.js';
import { recruit, recruitCost, canRecruit, mergeArmies, splitArmy, armyMen, siegeDays, bestUnits, modernizeCost, modernizeArmy } from '../core/military.js';
import { canUseUnit, eraOf } from '../core/technology.js';
import { researchTab } from './research_ui.js';
import { unitCount, provinceGdp } from '../core/state.js';
import { canDeclareWar } from '../core/war.js';
import { declareDialog } from './dialogs.js';
import { economyTab, industryTab, provinceEconomy, embargoButton } from './economy_ui.js';
import { diplomacyTab, relationsSection } from './diplomacy_ui.js';
import { governmentTab } from './government_ui.js';
import { govType } from '../core/government.js';
import { portZonesOf } from '../core/mapdata.js';
import { fleetsSection, wingsSection, provinceForces, supplyLine, expLine } from './forces_ui.js';
import { strategicTab, nuclearButton } from './strategic_ui.js';
import { commandSection, generalLine } from './command_ui.js';
import { leavePlans } from '../core/plans.js';
import { intelSection } from './intel_ui.js';
import { sanctionsRow } from './council_ui.js';
import { colonySection } from './colony_ui.js';
import { expRules } from '../core/experience.js';

export const TABS = [
  { id: 'country', name: 'Nation', key: 'n', tip: 'Overview of the selected country, or yours, and your relations with it.' },
  { id: 'government', name: 'Government', key: 'b', tip: 'Government type, factions, elections, policies and reforms.' },
  { id: 'economy', name: 'Economy', key: 'e', tip: 'Budget, taxes, tariffs, indicators and history.' },
  { id: 'industry', name: 'Industry', key: 'u', tip: 'Goods, production, construction and trade.' },
  { id: 'research', name: 'Research', key: 'a', tip: 'Technologies, research spending and the technology tree.' },
  { id: 'military', name: 'Military', key: 'm', tip: 'Recruit units; manage armies, fleets and air wings; battle reports.' },
  { id: 'strategic', name: 'Strategic', key: 'z', tip: 'Nuclear weapons, cyber operations, satellites and space.' },
  { id: 'diplomacy', name: 'Diplomacy', key: 'd', tip: 'Proposals, wars and peace, treaties, organisations, relations.' },
  { id: 'log', name: 'Events', key: 'l', tip: 'Notification history.' },
  { id: 'ai', name: 'AI', key: 'i', tip: 'AI decisions with reasons, and performance timings.' },
];

// grid of label/value pairs; plain strings are wrapped so each becomes a grid cell
export function kvbox(...items) {
  return h('div.kv', items.flat().filter((x) => x !== false && x != null).map((x) => (x instanceof Node ? x : h('span', String(x)))));
}

function bar(v, cls = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: cls } }));
}

export function renderPanel(cl, el) {
  const fn = { country: countryTab, government: governmentTab, economy: economyTab, industry: industryTab, research: researchTab, military: militaryTab, strategic: strategicTab, diplomacy: diplomacyTab, log: logTab, ai: aiTab }[cl.tab];
  mount(el, fn(cl));
}

function countryTab(cl) {
  const s = cl.state, C = s.countries;
  const k = cl.view.selectedCountry >= 0 ? cl.view.selectedCountry : s.player;
  if (k < 0) return h('p.muted', 'Select a province to see its country.');
  const c = C[k], K = c.cache, L = c.ledger;
  const nArmies = s.armies.filter((a) => a.owner === k);
  const units = nArmies.reduce((t, a) => t + unitCount(a), 0);
  const wars = s.wars.filter((w) => w.attackers.includes(k) || w.defenders.includes(k));
  const allies = s.alliances.filter((a) => a.members.includes(k));
  const g = c.govt, P = cl.game.rules.politics;
  const mine = k === s.player;
  const why = s.player >= 0 && !mine ? canDeclareWar(s, cl.game.map, s.player, k) : 'n/a';
  return h('div',
    h('div.row', flagCanvas(c, true), h('div', h('h3', c.name), h('div.muted', govType(cl.game.rules, c).name + (g ? ` · ${P.factions[g.ruling]?.name || ''} govern` : '')))),
    !c.alive && h('p.bad', 'This country no longer exists.'),
    kvbox(
      'Capital', c.capital >= 0 ? h('a', { href: '#', on: { click: (e) => { e.preventDefault(); cl.focusProvince(c.capital); } } }, cl.game.map.name[c.capital]) : '—',
      'Population', people(K.pop),
      'GDP (annual)', money(K.gdp),
      'GDP per person', '$' + Math.round((K.gdp * 1e9) / Math.max(1, K.pop)).toLocaleString(),
      'Development (avg.)', K.avgDev.toFixed(1),
      c.tfx && 'Era', c.tfx && h('a', { href: '#', tip: `${c.tfx.known} technologies known. Open the Research tab.`, on: { click: (e) => { e.preventDefault(); cl.setTab('research'); } } }, eraOf(cl.game.rules, c).name),
      'Provinces', K.provinces + (K.occupied ? ` (${K.occupied} occupied)` : ''),
      'Treasury', money(c.treasury),
      'Monthly balance', L ? signedMoney(L.net) : '—',
      'Tax rate', pct(c.tax),
      'Stability', Math.round(c.stability),
      g && 'Approval / legitimacy', g && `${Math.round(g.approvalAll)} / ${Math.round(g.legitimacy)}`,
      'Manpower', people(c.manpower),
      'Army', `${units} units in ${nArmies.length} armies`,
      'Organisations', allies.length ? allies.map((a) => a.name).join(', ') : 'None',
      'At war', wars.length ? wars.map((w) => w.name).join(', ') : 'No'),
    h('div', { tip: 'Stability' }, bar(c.stability / 100, c.stability < 35 ? 'var(--bad)' : '')),
    !mine && s.player >= 0 && c.alive && h('div.row', { style: { marginTop: '0.8em' } },
      h('button.danger', { disabled: !!why, tip: why || `Declare war on ${c.name}`, on: { click: () => declareDialog(cl, k) } }, 'Declare war…'),
      h('button', { on: { click: () => { cl.renderer.mode = 'diplomacy'; cl.renderer.focus = k; cl.renderer.invalidate(); cl.renderModes(); } } }, 'Show relations'),
      embargoButton(cl, k)),
    !mine && c.alive && sanctionsRow(cl, k),
    c.alive && relationsSection(cl, k),
    c.alive && intelSection(cl, k),
    !mine && c.alive && h('div.row', { style: { marginTop: '0.5em' } },
      h('button', { tip: 'Take control of this country from now on. The country you leave is run by the AI.', on: { click: () => { cl.setSpeed(0); cl.startPlaying(k); } } }, `Play as ${c.name}`)),
    mine && h('p.note', 'Tip: right-click a province with armies selected to move them. Space pauses, keys 1–5 set speed.'));
}

const DOMAINS = [['land', 'Army'], ['sea', 'Navy'], ['air', 'Air']];

function militaryTab(cl) {
  const s = cl.state, me = s.player, map = cl.game.map, R = cl.game.rules;
  if (me < 0) return h('div', h('p.muted', 'Observer mode.'), reportsList(cl));
  const c = s.countries[me];
  const domain = cl.view.milDomain || 'land';
  const sel = cl.view.selected;
  const ok = (p) => p >= 0 && s.prov.owner[p] === me && s.prov.controller[p] === me && (domain !== 'sea' || portZonesOf(map, p).length > 0);
  let site = ok(sel) ? sel : ok(c.capital) ? c.capital : -1;
  if (site < 0 && domain === 'sea') site = map.ids.find((i) => ok(i)) ?? -1;
  const inDomain = (t) => (R.units[t].domain || 'land') === domain;
  const usable = Object.keys(R.units).filter((t) => inDomain(t) && (!s.tech || canUseUnit(s, R, me, t)));
  const newest = new Set(Object.values(s.tech ? bestUnits(s, R, me, domain) : {}));
  const locked = Object.keys(R.units).filter((t) => inDomain(t) && !usable.includes(t));
  // warships and aircraft: only the newest type of each role unless asked (a modern navy does not build galleys)
  const showOld = domain === 'land' || cl.view.showOldUnits;
  const listed = showOld ? usable : usable.filter((t) => newest.has(t));
  const recruitRow = listed.map((t) => [t, R.units[t]]).map(([t, u]) => {
    const cost = recruitCost(s, R, me, t);
    const why = site < 0 ? 'No coastal province with a port' : canRecruit(s, map, R, me, site, t);
    const stats = domain === 'land' ? `Attack ${u.attack}, defence ${u.defense}, speed ${u.speed} km/day, ${u.men.toLocaleString()} men`
      : domain === 'sea' ? `Attack ${u.attack}, defence ${u.defense}${u.raid ? `, raiding ${u.raid}` : ''}${u.asw ? `, anti-submarine ${u.asw}` : ''}, ${u.speed} km/day, one unit = ${u.group || 1} ships`
        : `Air ${u.air || 0}, ground attack ${u.attack || 0}${u.bomb ? `, bombing ${u.bomb}` : ''}, range ${(u.range || 0).toLocaleString()} km, one unit = ${u.group || 1} aircraft`;
    return h('tr',
      h('td', { tip: `${u.name} (${u.role || 'line'})${u.fictional ? ' — fictional technology' : ''}\n${stats}\nUpkeep ${money(u.upkeep * c.cache.priceLevel)}/month` }, u.name, newest.has(t) ? null : h('span.muted', ' (outdated)')),
      h('td.n', money(cost.money)), h('td.n', people(cost.men)), h('td.n', cost.days + 'd'),
      h('td', h('button', { disabled: !!why, tip: why || `Recruit in ${map.name[site]}`, on: { click: () => { const e = recruit(s, map, R, me, site, t); if (e) cl.toast(e, true); cl.uiDirty = true; cl.requestFrame(); } } }, '+')));
  });
  const queue = s.recruit.filter((r) => r.owner === me);
  const armies = s.armies.filter((a) => a.owner === me);
  const selected = armies.filter((a) => cl.view.selectedArmies.has(a.id));
  const siteNote = domain === 'sea' ? 'Shipyard' : domain === 'air' ? 'Airfield' : 'Training site';
  return h('div',
    h('div.row', DOMAINS.map(([d, n]) => h('button' + (d === domain ? '.on' : ''), { on: { click: () => { cl.view.milDomain = d; cl.uiDirty = true; cl.requestFrame(); } } }, n))),
    h('h3', 'Recruit'),
    h('div.muted', `${siteNote}: ${site >= 0 ? map.name[site] : 'none'} (select one of your provinces to change${domain === 'sea' ? '; must be coastal' : ''})`),
    h('table.t', h('tr', h('th', 'Unit'), h('th.n', 'Cost'), h('th.n', 'Men'), h('th.n', 'Time'), h('th', '')), recruitRow),
    listed.length < usable.length && h('a', { href: '#', on: { click: (e) => { e.preventDefault(); cl.view.showOldUnits = true; cl.uiDirty = true; cl.requestFrame(); } } }, `Show ${usable.length - listed.length} older types`),
    locked.length > 0 && h('div.muted', { style: { marginTop: '0.3em', fontSize: '0.9em' } }, 'Not yet available: ' + locked.map((t) => `${R.units[t].name} (${R.tech.list[R.tech.unitTech[t]].name})`).join(', ')),
    queue.length > 0 && h('div.muted', { style: { marginTop: '0.4em' } }, `In training: ${queue.map((r) => `${R.units[r.type].short} ${r.days}d`).join(', ')}`),
    h('h3', { style: { marginTop: '1em' } }, `Armies (${armies.length})`),
    h('div.muted.expertise', { tip: `Military expertise comes from battles and won wars and raises the damage of every army and fleet, up to +${Math.round(expRules(R).expertise.cap * 100)}%. It fades by ${Math.round(expRules(R).expertise.peaceDecay * 100)}% a month in peacetime.` },
      `Military expertise: +${((c.expertise || 0) * 100).toFixed(1)}% combat`),
    selected.length > 0 && h('div.row', { style: { marginBottom: '0.5em' } },
      h('button', { disabled: selected.length < 2, on: { click: () => { const e = mergeArmies(s, selected.map((a) => a.id)); if (e) cl.toast(e, true); cl.view.selectedArmies = new Set([selected[0].id]); cl.uiDirty = true; } } }, 'Merge'),
      h('button', { disabled: selected.length !== 1, on: { click: () => { const e = splitArmy(s, selected[0].id); if (e) cl.toast(e, true); cl.uiDirty = true; } } }, 'Split'),
      h('button', { on: { click: () => { leavePlans(s, selected.map((a) => a.id)); for (const a of selected) { a.path = []; a.prog = 0; } cl.uiDirty = true; } } }, 'Stop'),
      modernizeButton(cl, selected),
      h('span.muted', 'Right-click the map to move; overseas targets are reached by sea')),
    commandSection(cl, selected),
    armies.length ? armies.map((a) => armyCard(cl, a)) : h('p.muted', 'No armies.'),
    fleetsSection(cl),
    wingsSection(cl),
    reportsList(cl));
}

// Re-equips the selected armies with the newest unit of each role.
function modernizeButton(cl, armies) {
  const s = cl.state, R = cl.game.rules;
  if (!s.tech) return null;
  const costs = armies.map((a) => modernizeCost(s, R, a));
  const money_ = costs.reduce((t, m) => t + m.money, 0), units = costs.reduce((t, m) => t + m.units, 0);
  const men = costs.reduce((t, m) => t + m.men, 0);
  const plan = [...new Set(costs.flatMap((m) => m.plan.map(([f, to]) => `${R.units[f].name} → ${R.units[to].name}`)))];
  return h('button', { disabled: !units, tip: units ? `Re-equip ${units} outdated units: ${plan.join(', ')}\nCost ${money(money_)}${men ? ` and ${people(men)} more men` : ''}; organisation drops to 30%.` : 'Nothing to modernise: these armies have the newest equipment you can field.',
    on: { click: () => { for (const a of armies) { const e = modernizeArmy(s, R, a.id); if (e && costs.length === 1) cl.toast(e, true); } cl.uiDirty = true; cl.requestFrame(); } } }, 'Modernise');
}

function armyCard(cl, a) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules;
  const sel = cl.view.selectedArmies.has(a.id);
  let status = 'Holding';
  if (a.battle) status = 'In battle!';
  else if (a.path.length) {
    const dest = a.path[a.path.length - 1];
    const sea = a.path.filter((n) => n >= map.count).length;
    status = `Moving to ${dest >= map.count ? 'the ' + map.sea.zones[dest - map.count].name : map.name[dest]} (${a.path.length} steps${sea ? `, ${sea} by sea` : ''})`;
  }
  else if (s.prov.siegeBy[a.loc] === a.owner) status = `Besieging (${pct(s.prov.siege[a.loc])})`;
  const u = a.units;
  return h('div.army-card' + (sel ? '.sel' : ''), { on: { click: (e) => {
    if (!e.shiftKey) { cl.view.selectedArmies.clear(); cl.view.selectedFleets.clear(); cl.view.selectedWings.clear(); }
    cl.view.selectedArmies.add(a.id);
    const [x, y] = cl.renderer.armyXY(a);
    cl.renderer.centerOn(x, y);
    cl.view.selected = a.loc;
    cl.uiDirty = true; cl.requestFrame();
  } } },
    h('div.row.spread', h('b', a.name), h('span.muted', map.name[a.loc])),
    h('div.muted', `${Object.entries(u).map(([t, n]) => `${n} ${R.units[t].short}`).join(' · ')} · ${people(armyMen(a, R))} men`),
    h('div.row', { style: { gap: '0.4em' } }, h('span.muted', 'Str'), h('div', { style: { flex: 1 }, tip: `Strength ${pct(a.str)}: share of full manpower. Reinforced monthly in friendly territory.` }, bar(a.str)),
      h('span.muted', 'Org'), h('div', { style: { flex: 1 }, tip: `Organisation ${pct(a.org)}: combat readiness. Lost in battle, recovers daily.` }, bar(a.org, 'var(--blue)'))),
    expLine(cl, a),
    generalLine(cl, a),
    supplyLine(cl, a),
    h('div', { className: a.battle ? 'bad' : 'muted' }, status));
}

function reportsList(cl) {
  const s = cl.state;
  const C = s.countries;
  const me = s.player;
  const reps = s.reports.filter((r) => me < 0 || r.attackers.includes(C[me].name) || r.defenders.includes(C[me].name)).slice(-10).reverse();
  return h('div', h('h3', { style: { marginTop: '1em' } }, 'Battle reports'),
    reps.length ? h('table.t', reps.map((r) => h('tr.click', { on: { click: () => cl.openReport(r.id) } },
      h('td', formatDate(r.day)), h('td', r.provName), h('td', { className: (r.winner === 'att' ? r.attackers : r.defenders).includes(C[me]?.name) ? 'good' : me >= 0 ? 'bad' : '' }, r.winner === 'att' ? 'Attacker won' : 'Defender won'))))
      : h('p.muted', 'No battles yet.'));
}

function logTab(cl) {
  const s = cl.state;
  const items = s.log.slice(-120).reverse();
  return h('div', h('h3', 'Events'), items.length ? items.map((l) => h('div.log-item' + (l.important ? '.imp' : '') + (l.prov != null || l.report ? '.click' : ''),
    { on: { click: () => { if (l.report) cl.openReport(l.report); else if (l.prov != null) cl.focusProvince(l.prov); } } },
    h('span.d', formatDate(l.day)), l.text)) : h('p.muted', 'Nothing has happened yet.'));
}

function aiTab(cl) {
  const s = cl.state, C = s.countries, g = cl.game.profile, r = cl.renderer.stats, pf = cl.perf;
  const ft = pf.frameTimes.length ? pf.frameTimes.reduce((a, b) => a + b, 0) / pf.frameTimes.length : 0;
  return h('div',
    h('h3', 'Performance'),
    kvbox(
      'Last tick (sim)', g ? `${g.total.toFixed(2)} ms (daily ${g.daily.toFixed(2)}, AI ${g.ai.toFixed(2)}, monthly ${g.monthly.toFixed(2)})` : '—',
      'Average tick at this speed', pf.tickMs ? pf.tickMs.toFixed(2) + ' ms' : '—',
      'Frame draw (avg)', ft.toFixed(2) + ' ms',
      'Base map render', `${r.baseMs.toFixed(1)} ms (${r.baseRenders} renders)`,
      'Provinces / armies / wars', `${cl.game.map.ids.length} / ${s.armies.length} / ${s.wars.length}`,
      'Profile', cl.data.settings.profile),
    h('h3', { style: { marginTop: '1em' } }, 'AI decisions'),
    s.aiLog.slice(-60).reverse().map((l) => h('div.log-item', h('span.d', formatDate(l.day)), h('b', C[l.c].name + ': '), l.text)));
}

export function renderProvince(cl, el) {
  const s = cl.state, p = cl.view.selected, map = cl.game.map, R = cl.game.rules;
  if (p < 0 || cl.mode === 'pick') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const C = s.countries, own = s.prov.owner[p], ctl = s.prov.controller[p];
  const E = R.balance.economy;
  const here = s.armies.filter((a) => a.loc === p && !(a.sea >= 0));
  const me = s.player;
  const canRec = me >= 0 && own === me && ctl === me;
  const battle = s.battles.find((b) => b.prov === p);
  mount(el,
    h('button.close', { on: { click: () => { cl.view.selected = -1; cl.uiDirty = true; cl.requestFrame(); } } }, '×'),
    h('h3', map.name[p]),
    h('div.row', own >= 0 && flagCanvas(C[own]), h('a', { href: '#', on: { click: (e) => { e.preventDefault(); cl.view.selectedCountry = own; cl.setTab('country'); } } }, C[own]?.name ?? 'Unclaimed')),
    ctl !== own && ctl >= 0 && h('div.bad', `Occupied by ${C[ctl].name}`),
    kvbox(
      'Terrain', h('span', { tip: 'Estimated from location (see README). Affects movement, combat width and defence.' }, TERRAINS[map.terrain[p]]),
      'Area', Math.round(map.area[p]).toLocaleString() + ' km²',
      'Population', people(s.prov.pop[p]),
      'Development', s.prov.dev[p].toFixed(1),
      'GDP (annual)', money(provinceGdp(s, p, E)),
      'Fortification', String(s.prov.fort[p]),
      'Coastal', map.coastal[p] ? 'Yes' : 'No',
      'Province ID', String(p)),
    s.prov.siegeBy[p] >= 0 && h('div', h('div.warn', `Siege by ${C[s.prov.siegeBy[p]].name}: ${pct(s.prov.siege[p])} (base ${Math.round(siegeDays(s, R, p))} days for one unit)`), bar(s.prov.siege[p], 'var(--warn)')),
    battle && h('div.bad', `Battle in progress (day ${battle.days})`),
    nuclearButton(cl, p),
    provinceEconomy(cl, p),
    colonySection(cl, p),
    here.length > 0 && h('h4', 'Armies here'),
    here.map((a) => h('div.row.spread', h('span', flagCanvas(C[a.owner]), ' ', a.name), h('span.muted', `${unitCount(a)} units · ${pct(a.org)} org`))),
    provinceForces(cl, p),
    canRec && h('div', h('h4', 'Recruit here'), h('div.row', Object.entries(R.units).filter(([t, u]) => (!s.tech || canUseUnit(s, R, me, t)) && (u.domain !== 'sea' || portZonesOf(map, p).length > 0)).map(([t, u]) => {
      const why = canRecruit(s, map, R, me, p, t);
      const cost = recruitCost(s, R, me, t);
      return h('button', { disabled: !!why, tip: why || `${u.name}: ${money(cost.money)}, ${people(cost.men)} men, ${cost.days} days`, on: { click: () => { const e = recruit(s, map, R, me, p, t); if (e) cl.toast(e, true); cl.uiDirty = true; cl.requestFrame(); } } }, '+' + u.short);
    }))));
}

