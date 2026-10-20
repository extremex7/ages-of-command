// The game summary (Menu → Summary, and at the end of a game) and the achievements list (main
// menu). Figures come from src/core/record.js.
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { flagCanvas } from './flags.js';
import { money, people } from './format.js';
import { openDialog } from './dialogs.js';
import { starBadge } from './leaderboard.js';
import { summary, ACHIEVEMENTS } from '../core/record.js';
import { civilFromDays, formatDate } from '../core/calendar.js';
import { loadAchievements } from './storage.js';

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
}

// World rank over the years (first place at the top), with the star bands behind it.
function rankChart(points) {
  const W = 520, H = 160, L = 34, B = 20, T = 8, Rr = 8;
  const pts = points.filter((p) => p.rank > 0);
  if (pts.length < 2) return h('p.muted', 'The rank history fills in once a year has passed.');
  const d0 = pts[0].day, d1 = pts[pts.length - 1].day || d0 + 1;
  const worst = Math.max(30, ...pts.map((p) => p.rank));
  const x = (d) => L + ((d - d0) / Math.max(1, d1 - d0)) * (W - L - Rr);
  const y = (r) => T + ((r - 1) / (worst - 1)) * (H - T - B);
  const band = (from, to, cls) => to >= from && svg('rect', { x: L, y: y(from) - 2, width: W - L - Rr, height: Math.max(0, y(Math.min(to, worst)) - y(from)) + 4, class: cls });
  const ticks = [1, 10, 25, 50, 100, 150, 200].filter((r) => r <= worst);
  const y0 = civilFromDays(d0).y, y1 = civilFromDays(d1).y;
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rank-chart', role: 'img', 'aria-label': `World rank from ${pts[0].rank} in ${y0} to ${pts[pts.length - 1].rank} in ${y1}` },
    band(1, 10, 'band-gold'), band(11, 25, 'band-silver'), band(26, 50, 'band-bronze'),
    ...ticks.map((r) => svg('text', { x: L - 5, y: y(r) + 4, 'text-anchor': 'end' }, '#' + r)),
    svg('text', { x: L, y: H - 4 }, String(y0)), svg('text', { x: W - Rr, y: H - 4, 'text-anchor': 'end' }, String(y1)),
    svg('polyline', { points: pts.map((p) => `${x(p.day).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' '), class: 'line' }),
    svg('circle', { cx: x(pts[pts.length - 1].day), cy: y(pts[pts.length - 1].rank), r: 4, class: 'dot' }));
}

const ratio = (a, b) => (b > 0 ? a / b : 0);
function change(a, b, fmt) {
  const r = ratio(b, a);
  const tag = !a ? '' : r >= 1.005 ? ` (×${r.toFixed(r < 10 ? 2 : 0)})` : r <= 0.995 ? ` (−${Math.round((1 - r) * 100)}%)` : '';
  return [fmt(a), fmt(b) + tag];
}

export function summaryDialog(cl, { ended = false } = {}) {
  const s = cl.state, S = summary(s);
  if (!S) return null;
  const body = summaryBody(cl, S, ended);
  const w = openDialog(cl,
    h('div.row.spread', h('h3', icon('summary'), ended ? ' The end of your story' : ' Your story so far'), h('button', { on: { click: () => w.remove() } }, 'Close')),
    ...body,
    ended && h('div.row', { style: { marginTop: '0.8em' } },
      h('button', { on: { click: () => w.remove() } }, 'Keep watching'),
      h('button.primary', { on: { click: () => { w.remove(); cl.opts.onExit(); } } }, 'Main menu')));
  w.firstChild.classList.add('wide');
  return w;
}

// The summary's contents (flag line, headline, rank chart, start against now, deeds,
// achievements), shared by the summary and the victory screen.
export function summaryBody(cl, S, ended = false) {
  const s = cl.state;
  const c = s.countries[s.record.k], R = cl.game.rules;
  const eraName = (i) => R.tech?.eras[i]?.name ?? '–';
  const govName = (g) => R.politics?.types[g]?.name ?? g;
  const rows = [
    ['World rank', h('span', starBadge(S.from, true)), S.to ? starBadge(S.to, true) : h('span.bad', 'annexed')],
    ['Prestige', S.start.score.toFixed(1), S.now.score.toFixed(1)],
    ['GDP per year', ...change(S.start.gdp, S.now.gdp, money)],
    ['Share of the world economy', (S.start.share * 100).toFixed(1) + '%', (S.now.share * 100).toFixed(1) + '%'],
    ['Population', ...change(S.start.pop, S.now.pop, people)],
    ['Provinces', String(S.start.prov), String(S.now.prov)],
    ['Technologies', String(S.start.techs), String(S.now.techs)],
    ['Era', eraName(S.start.era), eraName(S.now.era)],
    ['Government', govName(S.start.gov), govName(S.now.gov)],
  ];
  const n = S.n;
  const deeds = [
    `${n.battlesWon} battle${n.battlesWon === 1 ? '' : 's'} won, ${n.battlesLost} lost`,
    `${n.warsWon} war${n.warsWon === 1 ? '' : 's'} won, ${n.warsLost} lost, ${n.whitePeace} white peace${n.whitePeace === 1 ? '' : 's'}`,
    n.coups ? `${n.coups} coup${n.coups === 1 ? '' : 's'} abroad` : null,
    n.resolutions ? `${n.resolutions} council resolution${n.resolutions === 1 ? '' : 's'} passed` : null,
    `Best rank: #${S.best.rank} (${formatDate(S.best.day)})`,
  ].filter(Boolean);
  const points = [...S.hist, ...(S.to ? [{ day: s.day, rank: S.to }] : [])];
  return [
    h('div.row', flagCanvas(c, true), h('div', h('b', c.name), h('div.muted', `${formatDate(S.start.day)} – ${formatDate(s.day)} · ${s.scenarioName}`))),
    h('p.headline', S.headline),
    rankChart(points),
    h('table.t', h('tr', h('th', ''), h('th.n', 'At the start'), h('th.n', ended ? 'At the end' : 'Now')),
      rows.map(([k, a, b]) => h('tr', h('td', k), h('td.n', a), h('td.n', b)))),
    h('ul', deeds.map((d) => h('li', d))),
    h('h4', `Achievements in this game: ${S.achievements.length} of ${S.total}`),
    S.cheated ? h('p.muted', 'Cheats were used in this game, so it earns no achievements.') : null,
    S.achievements.length ? h('div.ach-list', S.achievements.map((a) => achRow(a, formatDate(a.day)))) : h('p.muted', 'None yet. The main menu lists them all.'),
    S.earlier.length ? h('p.muted.small', `Before this, you led ${S.earlier.map((e) => s.countries.find((x) => x.tag === e.tag)?.name ?? e.tag).join(', ')}.`) : null,
  ];
}

function achRow(a, when) {
  return h('div.ach' + (when ? '.got' : ''), { tip: a.text },
    h('span.ach-icon', icon(when ? 'achievements' : 'star')),
    h('div', h('b', a.name), h('div.muted.small', a.text)),
    h('span.muted.small', when || 'Not yet'));
}

// Main menu: every achievement, and where it was first earned on this device.
export function achievementsScreen(app, back) {
  const got = loadAchievements();
  const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
  mount(app, h('div.screen', h('div.menu-card.wide',
    h('h2', icon('achievements'), ' Achievements'),
    h('p.muted', `${n} of ${ACHIEVEMENTS.length} earned on this device. Achievements are earned by the country you lead; games with cheats earn none.`),
    h('div.ach-list.scroll', ACHIEVEMENTS.map((a) => achRow(a, got[a.id] ? `${got[a.id].country}, ${got[a.id].date}` : null))),
    h('div.row', { style: { marginTop: '1em' } }, h('button', { on: { click: back } }, 'Back')))));
}
