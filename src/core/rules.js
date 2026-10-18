// Validation for data-driven rule files so broken mods fail with a useful message.
const UNIT_NUM = ['men', 'cost', 'upkeep', 'days', 'attack', 'defense', 'speed', 'toughness'];
const TERRAINS = ['plains', 'hills', 'mountains', 'forest', 'desert', 'tundra'];
// unit roles by domain (sea and air units: see docs/NAVY_AIR.md)
export const ROLES = {
  land: ['line', 'support', 'mobile'],
  sea: ['capital', 'screen', 'sub', 'nsub', 'ssbn', 'carrier'],
  air: ['fighter', 'bomber', 'attack', 'drone'],
};
const DOMAIN_NUM = { land: [], sea: ['asw', 'aa', 'stealth', 'raid', 'shore', 'air', 'warheads'], air: ['air', 'bomb', 'range'] };

export function validateRules(rules) {
  const errs = [];
  for (const [k, u] of Object.entries(rules.units)) {
    for (const f of UNIT_NUM) if (!(typeof u[f] === 'number' && u[f] >= 0)) errs.push(`unit "${k}": "${f}" must be a non-negative number`);
    if (!u.name) errs.push(`unit "${k}": missing name`);
    const domain = u.domain || 'land';
    if (!ROLES[domain]) { errs.push(`unit "${k}": domain must be land, sea or air`); continue; }
    if (u.role && !ROLES[domain].includes(u.role)) errs.push(`unit "${k}": role must be one of ${ROLES[domain].join(', ')}`);
    if (domain !== 'land' && !u.role) errs.push(`unit "${k}": sea and air units need a role`);
    for (const f of ['munitions', 'fuel', 'siege', 'group', ...DOMAIN_NUM[domain]]) if (u[f] != null && !(typeof u[f] === 'number' && u[f] >= 0)) errs.push(`unit "${k}": "${f}" must be a non-negative number`);
    if (domain === 'air' && !(u.range > 0)) errs.push(`unit "${k}": air units need a range in km`);
    if (domain === 'land') for (const t of TERRAINS) if (typeof u.terrain?.[t] !== 'number') errs.push(`unit "${k}": terrain.${t} must be a number`);
  }
  const b = rules.balance;
  for (const s of ['economy', 'population', 'combat', 'siege', 'war', 'ai', 'industry', 'government', 'diplomacy', 'research', 'naval', 'air', 'supply', 'strategic']) if (!b?.[s]) errs.push(`balance: missing section "${s}"`);
  if (errs.length) throw new Error('Invalid rules:\n' + errs.join('\n'));
}

export function validateScenario(sc, map) {
  const errs = [];
  if (!sc.id || !sc.name || !sc.startDate) errs.push('scenario needs id, name and startDate');
  const tags = new Set();
  for (const c of sc.countries || []) {
    if (!/^[A-Z0-9_]{2,8}$/.test(c.tag || '')) errs.push(`country tag "${c.tag}" must be 2-8 capitals/digits`);
    if (tags.has(c.tag)) errs.push(`duplicate country tag ${c.tag}`);
    tags.add(c.tag);
    if (!/^#[0-9a-fA-F]{6}$/.test(c.color || '')) errs.push(`country ${c.tag}: color must be #rrggbb`);
  }
  for (const [id, rec] of Object.entries(sc.provinces || {})) {
    if (!map.exists[+id]) errs.push(`province ${id} does not exist on this map`);
    else if (rec[0] != null && !tags.has(rec[0])) errs.push(`province ${id}: unknown owner ${rec[0]}`);
  }
  if (errs.length) throw new Error(`Invalid scenario "${sc.id}":\n` + errs.slice(0, 20).join('\n'));
}
