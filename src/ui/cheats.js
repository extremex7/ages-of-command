// Cheat console. Settings → "Enable cheats" must be on, and the game must have been started
// while it was on (state.settings.cheats, saved with the game): a game started earlier never
// accepts cheats. Opened with the ` key or the console button in the top bar.
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { refreshCountryCache } from '../core/state.js';
import { computeLedgers } from '../core/economy.js';
import { grantTech, knows } from '../core/technology.js';
import { declareWar, endWar, transferProvince } from '../core/war.js';
import { people, money } from './format.js';

// Can this game take cheats? Returns null, or the reason it cannot.
export function cheatsBlocked(cl) {
  if (!cl.data.settings.cheats) return 'Cheats are off. Turn on Settings → Gameplay → "Enable cheats", then start a new game.';
  if (!cl.state.settings.cheats) return 'This game was started before cheats were enabled, so cheats do not work in it. Start a new game to use them.';
  if (cl.mode !== 'play' || cl.state.player < 0) return 'Choose a country first.';
  return null;
}

// "5B" -> 5e9; "250k" -> 250000; "1.5M" -> 1.5e6
function amount(s, def) {
  if (s == null || s === '') return def;
  const m = /^(-?[\d.]+)\s*([kmbt]?)$/i.exec(String(s).replace(/,/g, ''));
  if (!m) return NaN;
  return +m[1] * ({ '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase()]);
}

function countryArg(cl, arg) {
  const C = cl.state.countries, a = (arg || '').toLowerCase();
  if (!a) return -1;
  const k = C.findIndex((c) => c.alive && (c.tag.toLowerCase() === a || c.name.toLowerCase() === a));
  return k >= 0 ? k : C.findIndex((c) => c.alive && c.name.toLowerCase().includes(a));
}

const COMMANDS = {
  help: { args: '', desc: 'List the commands', run: () => Object.entries(COMMANDS).map(([n, c]) => `${n}${c.args ? ' ' + c.args : ''} — ${c.desc}`).join('\n') },
  money: { args: '[amount]', desc: 'Add money to the treasury in billions (default 100; also accepts 500M, 2T)', run: (cl, me, [a]) => {
    // money is kept in billions; a bare number means billions too
    const v = /[kmbt]$/i.test(a || '') ? amount(a) / 1e9 : amount(a, 100);
    if (!Number.isFinite(v)) return 'Not an amount: ' + a;
    me.treasury += v; return `Treasury ${money(me.treasury)}.`;
  } },
  manpower: { args: '[amount|max]', desc: 'Set manpower (default: the maximum)', run: (cl, me, [a]) => {
    const v = !a || a === 'max' ? me.cache.maxManpower : amount(a);
    if (!Number.isFinite(v)) return 'Not an amount: ' + a;
    me.manpower = Math.max(0, v); return `Manpower ${people(me.manpower)}.`;
  } },
  influence: { args: '[points]', desc: 'Set influence (default 100)', run: (cl, me, [a]) => {
    const v = amount(a, 100);
    if (!Number.isFinite(v)) return 'Not a number: ' + a;
    me.influence = Math.max(0, v); return `Influence ${Math.floor(me.influence)}.`;
  } },
  stability: { args: '[0-100]', desc: 'Set stability (default 100)', run: (cl, me, [a]) => {
    const v = amount(a, 100);
    if (!Number.isFinite(v)) return 'Not a number: ' + a;
    me.stability = Math.max(0, Math.min(100, v)); return `Stability ${Math.round(me.stability)}.`;
  } },
  research: { args: '', desc: 'Finish the current research project', run: (cl, me) => {
    const R = cl.game.rules, r = me.research;
    if (!r.current) return 'No research project is running.';
    const t = R.tech.idx[r.current];
    grantTech(cl.state, cl.game.map, R, me.idx, t, 'researched (cheat)');
    return `${R.tech.list[t].name} researched.`;
  } },
  tech: { args: '<name|id|all|era>', desc: 'Grant a technology, every technology of your era and earlier ("era"), or all of them', run: (cl, me, args) => {
    const s = cl.state, R = cl.game.rules, T = R.tech, q = args.join(' ').toLowerCase();
    if (!q) return 'Name a technology, or "era" or "all".';
    let list;
    if (q === 'all') list = T.list;
    else if (q === 'era') list = T.list.filter((t) => t.eraI <= (me.tfx?.era ?? 0) + 1);
    else {
      const t = T.list.find((x) => x.id === q.replace(/ /g, '_') || x.name.toLowerCase() === q) || T.list.find((x) => x.name.toLowerCase().includes(q));
      if (!t) return 'No technology called ' + q;
      list = [t];
    }
    let n = 0;
    for (const t of list) if (!knows(s, me.idx, t.i)) { grantTech(s, null, R, me.idx, t.i, 'granted (cheat)'); n++; }
    return n ? `${n} technolog${n === 1 ? 'y' : 'ies'} granted.` : 'Already known.';
  } },
  build: { args: '', desc: 'Finish all your construction projects', run: (cl, me) => {
    let n = 0;
    for (const p of cl.state.construction || []) if (p.owner === me.idx) { p.left = Math.min(p.left, 1); n++; }
    return n ? `${n} project${n === 1 ? '' : 's'} finish tomorrow.` : 'Nothing is being built.';
  } },
  annex: { args: '<country>', desc: 'Take every province of a country', run: (cl, me, args) => {
    const s = cl.state, map = cl.game.map, k = countryArg(cl, args.join(' '));
    if (k < 0) return 'No country called ' + args.join(' ');
    if (k === me.idx) return 'That is you.';
    const name = s.countries[k].name;
    const ps = map.ids.filter((p) => s.prov.owner[p] === k);
    for (const p of ps) transferProvince(s, map, p, me.idx);
    return `Annexed ${name} (${ps.length} provinces).`;
  } },
  war: { args: '<country>', desc: 'Declare war on a country (its allies may join)', run: (cl, me, args) => {
    const k = countryArg(cl, args.join(' '));
    if (k < 0) return 'No country called ' + args.join(' ');
    return declareWar(cl.state, cl.game.map, cl.game.rules, me.idx, k) || `At war with ${cl.state.countries[k].name}.`;
  } },
  peace: { args: '', desc: 'End all your wars with a white peace', run: (cl, me) => {
    const s = cl.state, wars = s.wars.filter((w) => w.attackers.includes(me.idx) || w.defenders.includes(me.idx));
    for (const w of wars) endWar(s, cl.game.map, cl.game.rules, w);
    return wars.length ? `${wars.length} war${wars.length === 1 ? '' : 's'} ended.` : 'You are at peace.';
  } },
  play: { args: '<country>', desc: 'Switch to another country', run: (cl, me, args) => {
    const k = countryArg(cl, args.join(' '));
    if (k < 0) return 'No country called ' + args.join(' ');
    cl.startPlaying(k);
    return `You now lead ${cl.state.countries[k].name}.`;
  } },
  clear: { args: '', desc: 'Clear the console', run: () => null },
};

export function runCheat(cl, line) {
  const why = cheatsBlocked(cl);
  if (why) return why;
  const [name, ...args] = line.trim().split(/\s+/);
  const cmd = COMMANDS[(name || '').toLowerCase()];
  if (!cmd) return `Unknown command "${name}". Type help for the list.`;
  const s = cl.state, me = s.countries[s.player];
  const out = cmd.run(cl, me, args);
  if (name.toLowerCase() !== 'help' && name.toLowerCase() !== 'clear') {
    s.cheated = true; // shown in the save list and the leaderboard
    refreshCountryCache(s, cl.game.map, cl.game.rules);
    computeLedgers(s, cl.game.map, cl.game.rules);
    cl.renderer.invalidate();
    cl.uiDirty = true; cl.requestFrame();
  }
  return out;
}

export function toggleConsole(cl) {
  const old = cl.el.querySelector('.console');
  if (old) { old.remove(); return; }
  const out = h('div.console-out');
  const say = (text, cls = '') => { if (text != null) { out.append(h('div' + cls, text)); out.scrollTop = out.scrollHeight; } };
  const hist = cl._cheatHistory || (cl._cheatHistory = []);
  let pos = hist.length;
  const input = h('input', { placeholder: 'Type a command, for example: money 50B', spellcheck: false, autocomplete: 'off', on: { keydown: (e) => {
    if (e.key === 'Escape' || e.key === '`' || e.code === 'Backquote') { e.preventDefault(); box.remove(); return; }
    if (e.key === 'ArrowUp' && pos > 0) { e.preventDefault(); input.value = hist[--pos]; return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); pos = Math.min(hist.length, pos + 1); input.value = hist[pos] || ''; return; }
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const line = input.value.trim();
    hist.push(line); pos = hist.length; input.value = '';
    say('> ' + line, '.cmd');
    if (line.toLowerCase() === 'clear' && !cheatsBlocked(cl)) { mount(out); return; }
    say(runCheat(cl, line));
  } } });
  const box = h('div.console', h('div.row.spread', h('b', icon('console'), ' Cheat console'), h('button', { on: { click: () => box.remove() } }, icon('close'))), out, input);
  cl.el.append(box);
  const why = cheatsBlocked(cl);
  say(why || 'Cheats are on for this game. Type help for the commands; ` or Esc closes the console.', why ? '.bad' : '.muted');
  input.focus();
}
