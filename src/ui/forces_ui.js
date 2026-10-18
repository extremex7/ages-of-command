// Military tab sections for navies and air forces (Milestone 6): fleet and air wing cards with
// their orders. Every number comes from the simulation (src/core/naval.js, air.js, supply.js).
import { h } from './dom.js';
import { money, pct } from './format.js';
import { shipCount, fleetPower, fleetSpeed, orderFleet, mergeFleets, splitFleet, nearestPort, hostileSea, zoneBalance } from '../core/naval.js';
import { MISSIONS, wingCount, wingRange, wingStat, setMission, rebaseWing, mergeWings, canBase } from '../core/air.js';
import { canBuildDepot, buildDepot, removeDepot, maxDepots, depotCost, provinceCapacity } from '../core/supply.js';

const MISSION_NAMES = { superiority: 'Air superiority', support: 'Close air support', bombing: 'Strategic bombing', idle: 'Stand down' };
const MISSION_TIPS = {
  superiority: 'Fights enemy aircraft over battles in range and intercepts bombers.',
  support: 'Attacks enemy troops in land battles within range.',
  bombing: 'Bombs enemy industry and infrastructure in range once a month (needs bombers).',
  idle: 'Stays at its base and repairs.',
};

function bar(v, color = '') {
  return h('div.bar', h('i', { style: { width: Math.max(0, Math.min(100, v * 100)) + '%', background: color } }));
}

function refresh(cl) { cl.uiDirty = true; cl.requestFrame(); }

// where a fleet is, in words
export function fleetPlace(cl, f) {
  const map = cl.game.map;
  if (f.port >= 0) return `In port at ${map.name[f.port]}`;
  return map.sea.zones[f.zone]?.name || 'At sea';
}

export function fleetsSection(cl) {
  const s = cl.state, me = s.player;
  const fleets = s.fleets.filter((f) => f.owner === me);
  const sel = fleets.filter((f) => cl.view.selectedFleets.has(f.id));
  return h('div',
    h('h3', { style: { marginTop: '1em' } }, `Fleets (${fleets.length})`),
    sel.length > 0 && h('div.row', { style: { marginBottom: '0.5em' } },
      h('button', { disabled: sel.length < 2, tip: 'Combine fleets in the same zone or port', on: { click: () => { const e = mergeFleets(s, sel.map((f) => f.id)); if (e) cl.toast(e, true); cl.view.selectedFleets = new Set([sel[0].id]); refresh(cl); } } }, 'Merge'),
      h('button', { disabled: sel.length !== 1, on: { click: () => { const e = splitFleet(s, sel[0].id); if (e) cl.toast(e, true); refresh(cl); } } }, 'Split'),
      h('button', { tip: 'Sail to the nearest friendly port and dock', on: { click: () => {
        for (const f of sel) {
          const p = f.port >= 0 ? f.port : nearestPort(s, cl.game.map, f.owner, f.zone);
          const e = p >= 0 ? orderFleet(s, cl.game.map, cl.game.rules, f.id, { prov: p }) : 'No friendly port in reach';
          if (e) cl.toast(`${f.name}: ${e}`, true);
        }
        refresh(cl);
      } } }, 'Return to port'),
      h('button', { on: { click: () => { for (const f of sel) { f.path = []; f.prog = 0; f.dock = -1; } refresh(cl); } } }, 'Stop'),
      h('span.muted', 'Right-click a sea to sail there, or a port to dock')),
    fleets.length ? fleets.map((f) => fleetCard(cl, f)) : h('p.muted', 'No fleets. Build warships in a coastal province (Navy above).'));
}

function fleetCard(cl, f) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules;
  const sel = cl.view.selectedFleets.has(f.id);
  let status = f.port >= 0 ? 'Docked' : 'Holding at sea';
  if (f.battle) status = 'In a naval battle!';
  else if (f.path.length) status = `Sailing to the ${map.sea.zones[f.path[f.path.length - 1]].name}${f.dock >= 0 ? ` to dock at ${map.name[f.dock]}` : ''} (${f.path.length} zones)`;
  const z = f.port >= 0 ? -1 : f.zone;
  const bal = z >= 0 ? zoneBalance(s, map, R, f.owner, z) : null;
  return h('div.army-card' + (sel ? '.sel' : ''), { on: { click: (e) => {
    if (!e.shiftKey) { cl.view.selectedFleets.clear(); cl.view.selectedArmies.clear(); cl.view.selectedWings.clear(); }
    cl.view.selectedFleets.add(f.id);
    const [x, y] = cl.renderer.fleetXY(f);
    cl.renderer.centerOn(x, y);
    refresh(cl);
  } } },
    h('div.row.spread', h('b', f.name), h('span.muted', fleetPlace(cl, f))),
    h('div.muted', `${Object.entries(f.units).map(([t, n]) => `${n} ${R.units[t].short}`).join(' · ')} · ${shipCount(f)} ships · power ${fleetPower(f, R).toFixed(0)} · ${Math.round(fleetSpeed(f, R, s))} km/day`),
    h('div.row', { style: { gap: '0.4em' } }, h('span.muted', 'Str'), h('div', { style: { flex: 1 }, tip: `Strength ${pct(f.str)}: share of ships fully crewed and undamaged. Repaired in port.` }, bar(f.str)),
      h('span.muted', 'Org'), h('div', { style: { flex: 1 }, tip: `Organisation ${pct(f.org)}: readiness. Lost in battle, recovers over time.` }, bar(f.org, 'var(--blue)'))),
    bal && bal.enemy > 0 && h('div', { className: bal.enemy > bal.own ? 'bad' : 'warn', tip: 'Surface power at sea in this zone: your side against your enemies.' }, `Enemy fleets here: ${bal.own.toFixed(0)} vs ${bal.enemy.toFixed(0)}`),
    h('div', { className: f.battle ? 'bad' : 'muted' }, status));
}

export function wingsSection(cl) {
  const s = cl.state, me = s.player, map = cl.game.map, R = cl.game.rules;
  const wings = s.wings.filter((w) => w.owner === me);
  const sel = wings.filter((w) => cl.view.selectedWings.has(w.id));
  const p = cl.view.selected;
  const rebaseWhy = p < 0 ? 'Select a province first' : canBase(s, map, me, p) ? null : 'Wings can only be based in provinces you or your allies control';
  return h('div',
    h('h3', { style: { marginTop: '1em' } }, `Air wings (${wings.length})`),
    sel.length > 0 && h('div.row', { style: { marginBottom: '0.5em' } },
      h('button', { disabled: sel.length < 2, tip: 'Combine wings at the same base', on: { click: () => { const e = mergeWings(s, sel.map((w) => w.id)); if (e) cl.toast(e, true); cl.view.selectedWings = new Set([sel[0].id]); refresh(cl); } } }, 'Merge'),
      h('button', { disabled: !!rebaseWhy, tip: rebaseWhy || `Move to ${map.name[p]} (a few days of disruption)`, on: { click: () => { for (const w of sel) { const e = rebaseWing(s, map, R, w.id, p); if (e) cl.toast(`${w.name}: ${e}`, true); } refresh(cl); } } }, p >= 0 ? `Rebase to ${map.name[p]}` : 'Rebase'),
      h('span.muted', 'Or right-click a province to rebase')),
    wings.length ? wings.map((w) => wingCard(cl, w)) : h('p.muted', 'No air wings. Build aircraft in a province with infrastructure (Air above).'));
}

function wingCard(cl, w) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules;
  const sel = cl.view.selectedWings.has(w.id);
  const bombers = wingStat(w, R, 'bomb') > 0;
  return h('div.army-card' + (sel ? '.sel' : ''), { on: { click: (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
    if (!e.shiftKey) { cl.view.selectedWings.clear(); cl.view.selectedArmies.clear(); cl.view.selectedFleets.clear(); }
    cl.view.selectedWings.add(w.id);
    cl.view.highlight = rangeProvinces(cl, w);
    cl.renderer.centerOn(map.x[w.base], map.y[w.base]);
    refresh(cl);
  } } },
    h('div.row.spread', h('b', w.name), h('span.muted', `Base: ${map.name[w.base]}`)),
    h('div.muted', `${Object.entries(w.units).map(([t, n]) => `${n} ${R.units[t].short}`).join(' · ')} · ${wingCount(w)} units · range ${Math.round(wingRange(w, R)).toLocaleString()} km`),
    h('div.muted', `Air ${wingStat(w, R, 'air', s).toFixed(1)} · ground attack ${wingStat(w, R, 'attack', s).toFixed(1)}${bombers ? ` · bombing ${wingStat(w, R, 'bomb', s).toFixed(1)}` : ''}`),
    h('div.row', { style: { gap: '0.4em' } }, h('span.muted', 'Str'), h('div', { style: { flex: 1 }, tip: `Strength ${pct(w.str)}: aircraft ready to fly. Losses are replaced slowly at base.` }, bar(w.str))),
    h('div.row', h('span.muted', 'Mission'), h('select', { tip: MISSION_TIPS[w.mission], on: { change: (e) => { const err = setMission(s, R, w.id, e.target.value); if (err) cl.toast(err, true); refresh(cl); } } },
      MISSIONS.map((m) => h('option', { value: m, selected: w.mission === m, disabled: m === 'bombing' && !bombers }, MISSION_NAMES[m])))));
}

// provinces within a wing's range, for the map highlight
function rangeProvinces(cl, w) {
  const map = cl.game.map, R = cl.game.rules;
  const r = wingRange(w, R), out = [];
  const la = map.lat[w.base], lo = map.lon[w.base];
  for (const i of map.ids) {
    let dl = Math.abs(map.lon[i] - lo);
    if (dl > 180) dl = 360 - dl;
    const x = dl * Math.cos(((la + map.lat[i]) * Math.PI) / 360), y = la - map.lat[i];
    if (111.2 * Math.sqrt(x * x + y * y) <= r) out.push(i);
  }
  return out;
}

// Province panel: supply depot controls and what is stationed here.
export function provinceForces(cl, p) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules, me = s.player, C = s.countries;
  const docked = s.fleets.filter((f) => f.port === p);
  const based = s.wings.filter((w) => w.base === p);
  const mine = me >= 0 ? C[me] : null;
  const hasDepot = mine?.depots?.includes(p);
  const why = me >= 0 ? canBuildDepot(s, map, R, me, p) : 'Observer';
  const troops = s.armies.filter((a) => a.loc === p && !(a.sea >= 0)).reduce((t, a) => t + Object.values(a.units).reduce((x, y) => x + y, 0), 0);
  return h('div',
    (docked.length > 0 || based.length > 0) && h('h4', 'Fleets and air wings here'),
    docked.map((f) => h('div.row.spread', h('span', f.name, ` (${C[f.owner].name})`), h('span.muted', `${shipCount(f)} ships`))),
    based.map((w) => h('div.row.spread', h('span', w.name, ` (${C[w.owner].name})`), h('span.muted', `${wingCount(w)} aircraft · ${MISSION_NAMES[w.mission]}`))),
    h('div.muted', { tip: 'Troops beyond this number in one province go short of supply.' }, `Supply capacity: ${Math.round(provinceCapacity(s, R, p))} units${troops ? ` (${troops} here)` : ''}`),
    me >= 0 && s.prov.controller[p] === me && h('div.row', { style: { marginTop: '0.3em' } },
      hasDepot
        ? h('button', { tip: 'Remove this supply depot (frees a slot)', on: { click: () => { const e = removeDepot(s, me, p); if (e) cl.toast(e, true); refresh(cl); } } }, 'Remove supply depot')
        : h('button', { disabled: !!why, tip: why || `Build a supply depot: supplies armies nearby as if they were at home. ${money(depotCost(s, R, me))}; ${(mine.depots || []).length} of ${maxDepots(s, R, me)} depots in use.`, on: { click: () => { const e = buildDepot(s, map, R, me, p); if (e) cl.toast(e, true); refresh(cl); } } }, 'Build supply depot')));
}

// short supply line for an army card
export function supplyLine(cl, a) {
  const R = cl.game.rules, S = R.balance.supply;
  if (a.sea >= 0) {
    const map = cl.game.map, hostile = hostileSea(cl.state, map, R, a.owner, a.sea);
    return h('div', { className: hostile ? 'bad' : 'muted' }, `At sea in the ${map.sea.zones[a.sea].name}${hostile ? ': enemy fleets control these waters, transports are being sunk' : ''}`);
  }
  const v = a.supply ?? 1;
  return h('div.row', { style: { gap: '0.4em' } }, h('span.muted', 'Supply'),
    h('div', { style: { flex: 1 }, tip: `Supply ${pct(v)}. Below ${pct(S.low)} the army loses men to attrition; low supply also weakens it in battle and slows organisation recovery. Build depots near the front.` },
      bar(v, v < S.low ? 'var(--bad)' : v < 0.75 ? 'var(--warn)' : 'var(--good)')));
}

