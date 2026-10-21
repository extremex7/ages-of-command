// Province panel for unowned land: send colonists (rules in src/core/colonies.js).
import { h } from './dom.js';
import { icon } from './icons.js';
import { money, pct, people } from './format.js';
import { colonyPlan, startColony, cancelColony, seaReach, activeColonies, maxColonies } from '../core/colonies.js';
import { computeLedgers } from '../core/economy.js';

export function colonySection(cl, p) {
  const s = cl.state, map = cl.game.map, R = cl.game.rules, me = s.player;
  if (s.prov.owner[p] >= 0 || cl.mode !== 'play') return null;
  const others = (s.colonies || []).filter((x) => x.prov === p);
  const C = s.countries;
  const head = [h('h4', icon('tech_sailing'), ' Unclaimed land'),
    h('p.muted', 'No one rules here. Armies cannot enter; settlers can found a colony.'),
    others.some((x) => x.owner !== me) && h('div.muted', 'Other settlers on the way: ' + others.filter((x) => x.owner !== me).map((x) => `${C[x.owner].name} (${Math.max(0, x.end - s.day)}d)`).join(', '))];
  if (me < 0) return h('div.colony', head);
  const mine = others.find((x) => x.owner === me);
  if (mine) {
    return h('div.colony', head, h('div', `Our colonists arrive in ${Math.max(0, mine.end - s.day)} days (${pct(mine.chance)} chance of success).`),
      h('button', { on: { click: () => { cancelColony(s, R, mine.id); cl.uiDirty = true; cl.requestFrame(); } } }, 'Recall the settlers (half refunded)'));
  }
  const plan = colonyPlan(s, map, R, me, p);
  const can = !plan.why;
  const tip = plan.from >= 0
    ? `${people(plan.settlers)} settlers leave ${map.name[plan.from]}${plan.sea ? ` by sea (${plan.hops} sea zone${plan.hops === 1 ? '' : 's'} away; your ports reach ${seaReach(s, R, me)})` : ' over land'}.\nCost ${money(plan.cost)}, ${plan.days} days, ${pct(plan.chance)} chance of success (terrain, distance, by land or sea).\nColonies at a time: ${activeColonies(s, me)} of ${maxColonies(s, R, me)}.`
    : plan.why;
  return h('div.colony', head,
    plan.from >= 0 && h('div.kv',
      h('span', 'Settlers from'), h('span', `${map.name[plan.from]}${plan.sea ? ' (by sea)' : ''}`),
      h('span', 'Cost and time'), h('span', `${money(plan.cost)}, ${plan.days} days`),
      h('span', 'Chance of success'), h('span', pct(plan.chance))),
    plan.why && h('div.warn', plan.why),
    h('button.primary.colonise-btn', { disabled: !can, tip, on: { click: () => {
      const err = startColony(s, map, R, me, p);
      if (err) cl.toast(err, true); else cl.toast(`Settlers are on their way to ${map.name[p]}.`);
      computeLedgers(s, map, R); cl.uiDirty = true; cl.requestFrame();
    } } }, icon('tech_sailing'), 'Send colonists'));
}
