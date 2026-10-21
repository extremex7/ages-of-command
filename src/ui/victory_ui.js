// Victory: the score in the top bar, the progress dialog, the victory (or defeat) screen with
// "Continue playing", and the capitulation notice. Rules in src/core/victory.js and
// src/core/capitulation.js.
import { h } from './dom.js';
import { icon } from './icons.js';
import { flagCanvas } from './flags.js';
import { openDialog } from './dialogs.js';
import { summaryBody } from './summary.js';
import { summary } from '../core/record.js';
import { formatDate } from '../core/calendar.js';
import { victoryConditions, victoryProgress, victoryLeaders, continueAfterVictory } from '../core/victory.js';

// Top-bar stat: the prestige score, with the victory progress in the tooltip.
export function scoreStat(cl) {
  const s = cl.state, k = s.player;
  if (k < 0 || s.prestige?.score?.[k] == null) return null; // a new country (rebels) is scored next month
  const R = cl.game.rules, map = cl.game.map;
  const conds = victoryConditions(s, R);
  const prog = conds.length ? victoryProgress(s, map, R, k) : [];
  const won = s.victory?.won;
  const tip = [`Score ${s.prestige.score[k].toFixed(1)} (prestige, rank #${s.prestige.rank[k]}).`,
    conds.length ? 'Victory conditions:' : 'Sandbox game: no victory conditions.',
    ...prog.map((p) => `${p.name}: ${p.text} (${Math.round(p.value * 100)}%)`),
    won ? `Decided: ${won.text}` : null, 'Click for details.'].filter(Boolean).join('\n');
  const best = prog.length ? Math.max(...prog.map((p) => p.value)) : null;
  return h('div.stat.score-stat', { tip, on: { click: () => victoryOverview(cl) } },
    h('b', icon('leaderboard'), s.prestige.score[k].toFixed(1)), h('span', best != null && !won ? `Score · ${Math.round(best * 100)}%` : 'Score'));
}

// Every condition: your progress and who is closest.
export function victoryOverview(cl) {
  const s = cl.state, R = cl.game.rules, map = cl.game.map, C = s.countries;
  const conds = victoryConditions(s, R);
  const mine = s.player >= 0 ? victoryProgress(s, map, R, s.player) : [];
  const leaders = victoryLeaders(s, map, R);
  const won = s.victory?.won;
  const w = openDialog(cl,
    h('div.row.spread', h('h3', icon('leaderboard'), ' Victory'), h('button', { on: { click: () => w.remove() } }, 'Close')),
    s.player >= 0 && s.prestige?.score?.[s.player] != null && h('p', `Your score: ${s.prestige.score[s.player].toFixed(1)} (prestige, world rank #${s.prestige.rank[s.player]}).`),
    !conds.length ? h('p.muted', 'This is a sandbox game: no victory conditions were chosen at New Game. Play as long as you like.')
      : h('table.t.victory-table', h('tr', h('th', 'Condition'), h('th', 'You'), h('th', 'Closest')),
        conds.map((v, i) => h('tr',
          h('td', h('b', mine[i]?.name ?? v.id)),
          h('td', mine[i] ? h('div', h('div.bar', h('i', { style: { width: Math.round(mine[i].value * 100) + '%' } })), h('div.muted.small', mine[i].text)) : '–'),
          h('td', leaders[i]?.k >= 0 ? h('span', flagCanvas(C[leaders[i].k]), ' ', C[leaders[i].k].name) : '–')))),
    won && h('p.headline', won.text + ` (${formatDate(won.day)})`),
    won && !s.victory.continued && h('button.primary', { on: { click: () => { w.remove(); victoryDialog(cl, won); } } }, 'Show the victory screen'));
  return w;
}

// The end of the race: a victory for the player, or another country's. Pauses the game; the
// player may continue playing (no further victories are checked) or leave.
export function victoryDialog(cl, won) {
  const s = cl.state, C = s.countries, mine = won.k === s.player;
  cl.setSpeed(0);
  s.victory.seen = true;
  const S = s.record ? summary(s) : null;
  const w = openDialog(cl,
    h('div.row.spread', h('h3', icon(mine ? 'achievements' : 'leaderboard'), mine ? ` ${won.name} victory!` : ` ${C[won.k].name} has won`)),
    h('div.row', flagCanvas(C[won.k], true), h('div', h('b', C[won.k].name), h('div.muted', `${formatDate(won.day)} · ${s.scenarioName}`))),
    h('p.headline', mine ? `You have won. ${won.text}` : `${won.text} The game is lost, but the world goes on.`),
    ...(S ? summaryBody(cl, S, true) : []),
    h('div.row', { style: { marginTop: '0.8em' } },
      h('button.primary', { on: { click: () => { continueAfterVictory(s); w.remove(); cl.uiDirty = true; cl.requestFrame(); } } }, 'Continue playing'),
      h('button', { on: { click: () => { continueAfterVictory(s); w.remove(); cl.opts.onExit(); } } }, 'Main menu')));
  w.firstChild.classList.add('wide', 'victory-dialog');
  return w;
}

// A country of a war the player is in capitulated (perhaps the player's own).
export function capitulationDialog(cl, n) {
  const s = cl.state, C = s.countries, me = s.player;
  const mine = n.country === me, won = !mine && n.enemy === me;
  const t = n.terms || {};
  const w = openDialog(cl,
    h('h3', icon('wars'), mine ? ` ${C[me].name} capitulates` : ` ${C[n.country].name} capitulates`),
    h('div.row', flagCanvas(C[n.country], true), h('div', h('b', n.war), h('div.muted', formatDate(n.day)))),
    h('p', mine ? `With ${n.why.replaceAll('its', 'our')}, the government has given up the fight. Our part in the war is over on the enemy's terms.`
      : won ? `With ${n.why}, ${C[n.country].name} has given up. Our terms were applied.`
        : `With ${n.why}, ${C[n.country].name} has given up the fight.`),
    h('ul',
      t.subject && h('li', `${C[n.country].name} becomes a subject of ${C[n.enemy].name}.`),
      t.provinces?.length ? h('li', `Ceded: ${t.provinces.slice(0, 8).join(', ')}${t.provinces.length > 8 ? ` and ${t.provinces.length - 8} more` : ''}.`) : h('li', 'No land changes hands.'),
      t.reparations && h('li', `Reparations to ${C[n.enemy].name}.`),
      n.separate ? h('li', 'Its allies fight on.') : h('li', 'The war is over.')),
    h('button.primary', { on: { click: () => { w.remove(); cl.autoResume?.(); } } }, 'OK'));
  return w;
}
