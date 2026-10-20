// World leaderboard: every country ranked by prestige, with star tiers, rank changes over about
// five years and rising stars. Numbers come from src/core/prestige.js.
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { flagCanvas } from './flags.js';
import { money, people } from './format.js';
import { openDialog } from './dialogs.js';
import { STARS, PRESTIGE_WEIGHTS, starOf, rankChange, baseline, prestigeParts } from '../core/prestige.js';
import { civilFromDays } from '../core/calendar.js';

export function starBadge(rank, withRank = false) {
  const st = starOf(rank);
  return h('span.star-badge' + (st ? '.' + st.id : '.none'), { tip: st ? `${st.name}: ranked ${rank} in the world (top ${st.upTo})` : `Ranked ${rank} in the world` },
    st ? icon('star') : null, withRank ? '#' + rank : null);
}

function changeCell(ch) {
  if (!ch.since) return h('span.muted', '–');
  if (!ch.change) return h('span.muted.chg', icon('same'));
  return h('span.chg.' + (ch.change > 0 ? 'good' : 'bad'), icon(ch.change > 0 ? 'up' : 'down'), Math.abs(ch.change));
}

const FILTERS = [['all', 'All countries'], ['stars', 'Star countries'], ['rising', 'Rising stars'], ['near', 'Around you']];

export function leaderboardDialog(cl) {
  const s = cl.state, C = s.countries, P = s.prestige;
  if (!P?.rank) return;
  let filter = 'all';
  const body = h('div.lb-body');
  const base = baseline(s);
  const sinceYear = base ? civilFromDays(base.day).y : null;
  const render = () => {
    const parts = prestigeParts(s);
    let list = C.filter((c) => c.alive && P.rank[c.idx]).sort((a, b) => P.rank[a.idx] - P.rank[b.idx]);
    const ch = new Map(list.map((c) => [c.idx, rankChange(s, c.idx)]));
    if (filter === 'stars') list = list.filter((c) => starOf(P.rank[c.idx]));
    else if (filter === 'rising') list = list.filter((c) => ch.get(c.idx).rising);
    else if (filter === 'near' && s.player >= 0) { const r = P.rank[s.player]; list = list.filter((c) => Math.abs(P.rank[c.idx] - r) <= 10); }
    const row = (c) => {
      const k = c.idx, x = ch.get(k), p = parts[k];
      return h('tr' + (k === s.player ? '.me' : '') + (x.rising ? '.rising' : ''), { on: { click: () => { cl.view.selectedCountry = k; cl.setTab('country'); cl.focusCountry(k); wrap.remove(); } } },
        h('td.n', P.rank[k]), h('td', changeCell(x)), h('td', starBadge(P.rank[k])),
        h('td', flagCanvas(c), ' ', c.name, x.rising ? h('span.rising-tag', { tip: `Rising star: up ${x.change} places since ${sinceYear} (from ${x.from})` }, icon('rising'), 'Rising star') : null),
        h('td.n', { tip: Object.entries(PRESTIGE_WEIGHTS).map(([n, w]) => `${n}: ${Math.round(p[n] * 100)}% × ${w * 100}`).join('\n') + (C[k].prestigeBonus >= 0.05 ? `\nbonus: +${Math.min(15, C[k].prestigeBonus).toFixed(1)} (formed nations, missions)` : '') }, h('b', P.score[k].toFixed(1))),
        h('td.n.opt', money(c.cache.gdp)), h('td.n.opt', people(c.cache.pop)), h('td.n.opt', c.tfx?.known ?? '–'), h('td.n.opt', Math.round(c.stability)));
    };
    mount(body, list.length ? h('table.t.lb',
      h('tr', h('th', 'Rank'), h('th', { tip: sinceYear ? `Change since January ${sinceYear}` : 'Shown after the first year' }, sinceYear ? `Since ${sinceYear}` : 'Change'), h('th', ''), h('th', 'Country'),
        h('th.n', { tip: 'Prestige score (0–100). Hover a score for its parts.' }, 'Prestige'), h('th.n.opt', 'GDP/yr'), h('th.n.opt', 'Population'), h('th.n.opt', 'Techs'), h('th.n.opt', 'Stability')),
      list.map(row)) : h('p.muted', filter === 'rising' ? (sinceYear ? 'No rising stars right now.' : 'Rising stars appear after the first year of play.') : 'No countries.'));
    body.querySelector('tr.me')?.scrollIntoView({ block: 'center' });
  };
  const tabs = h('div.row.lb-filters', FILTERS.map(([id, name]) => h('button' + (id === filter ? '.on' : ''), { on: { click: (e) => {
    filter = id; for (const b of tabs.children) b.classList.toggle('on', b === e.currentTarget); render();
  } } }, name)));
  const me = s.player >= 0 ? s.player : -1;
  const wrap = openDialog(cl,
    h('div.row.spread', h('h3', icon('leaderboard'), ' World leaderboard'), h('button', { on: { click: () => wrap.remove() } }, 'Close')),
    me >= 0 && h('p', 'You: ', starBadge(P.rank[me], true), ` · prestige ${P.score[me].toFixed(1)}`, (() => {
      const x = rankChange(s, me);
      return x.since ? ` · ${x.change > 0 ? 'up' : x.change < 0 ? 'down' : 'no change'}${x.change ? ' ' + Math.abs(x.change) + ' place' + (Math.abs(x.change) === 1 ? '' : 's') : ''} since ${sinceYear}` + (x.rising ? ' · rising star!' : '') : '';
    })()),
    tabs, body,
    h('p.muted.small', `Prestige: economy ${PRESTIGE_WEIGHTS.economy * 100}%, military ${PRESTIGE_WEIGHTS.military * 100}%, technology ${PRESTIGE_WEIGHTS.technology * 100}%, population, prosperity (GDP per person) and stability 10% each, territory 5%, each compared with the world's best. `
      + STARS.map((t, i) => `${t.name}: ranks ${i ? STARS[i - 1].upTo + 1 : 1}–${t.upTo}`).join(', ') + '. A rising star climbed at least 5 places and 30% of its old rank in about five years (for example from 100th to 70th or better).'
      + (s.cheated ? ' Cheats were used in this game.' : '')));
  wrap.firstChild.classList.add('wide', 'lb-dialog');
  render();
}
