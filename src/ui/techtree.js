// The technology tree: every technology laid out by era (columns) and field (rows), with a line
// from each prerequisite to the technology it leads to. Drag to pan, wheel or pinch to zoom
// (buttons too); click or tap a technology to see it and research or queue it.
import { h, mount } from './dom.js';
import { icon, hasIcon } from './icons.js';
import { knows, available, queueResearch, setResearch } from '../core/technology.js';
import { openDialog } from './dialogs.js';

const COL = 196, NODE_W = 168, NODE_H = 34, GAP = 8, BAND_PAD = 10, HEAD = 40, LEFT = 150;
const MIN_Z = 0.25, MAX_Z = 2;

// Layout is the same for every country and game: computed once per rules object.
const layouts = new WeakMap();
function layout(T) {
  let L = layouts.get(T);
  if (L) return L;
  const fields = Object.keys(T.fields).filter((f) => T.list.some((t) => t.field === f));
  const cells = new Map();
  for (const t of T.list) {
    const key = t.field + '|' + t.eraI;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  for (const list of cells.values()) list.sort((a, b) => a.year - b.year);
  const pos = new Array(T.list.length);
  const bands = [];
  let y = HEAD;
  for (const f of fields) {
    let rows = 1;
    for (let e = 0; e < T.eras.length; e++) rows = Math.max(rows, (cells.get(f + '|' + e) || []).length);
    const hgt = rows * (NODE_H + GAP) - GAP + BAND_PAD * 2;
    for (let e = 0; e < T.eras.length; e++) {
      (cells.get(f + '|' + e) || []).forEach((t, n) => { pos[t.i] = { x: LEFT + e * COL + (COL - NODE_W) / 2, y: y + BAND_PAD + n * (NODE_H + GAP) }; });
    }
    bands.push({ f, y, h: hgt });
    y += hgt;
  }
  L = { fields, pos, bands, w: LEFT + T.eras.length * COL + 20, h: y + 20 };
  layouts.set(T, L);
  return L;
}

// A curved line from prerequisite a to technology b; within one era it runs round the left side.
function edgePath(a, b) {
  const ay = a.y + NODE_H / 2, by = b.y + NODE_H / 2;
  if (b.x > a.x + 1) {
    const x1 = a.x + NODE_W, x2 = b.x, mx = (x2 - x1) / 2;
    return `M${x1} ${ay}C${x1 + mx} ${ay} ${x2 - mx} ${by} ${x2} ${by}`;
  }
  const x = a.x, out = 18 + Math.min(40, Math.abs(by - ay) / 8);
  return `M${x} ${ay}C${x - out} ${ay} ${x - out} ${by} ${x} ${by}`;
}

export function techIcon(t) { return icon(hasIcon('tech_' + t.id) ? 'tech_' + t.id : 'field_' + t.field); }

export function techTreeDialog(cl, k, tipFor) {
  const s = cl.state, R = cl.game.rules, T = R.tech;
  const mine = k === s.player;
  const L = layout(T);
  const view = cl._treeView || (cl._treeView = { z: 0, x: 0, y: 0 });
  let selected = null;

  const status = (t) => {
    const r = s.countries[k].research;
    return knows(s, k, t.i) ? 'known' : r.current === t.id ? 'current' : r.queue.includes(t.id) ? 'queued' : available(s, R, k, t.i) ? 'avail' : 'locked';
  };

  // world: band backgrounds, era headings, field labels, lines, technologies
  const world = h('div.tt-world', { style: { width: L.w + 'px', height: L.h + 'px' } });
  const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lines.setAttribute('class', 'tt-lines');
  lines.setAttribute('width', L.w); lines.setAttribute('height', L.h);
  const edges = [];
  let svg = '';
  for (const t of T.list) for (const r of t.reqI) {
    svg += `<path d="${edgePath(L.pos[r], L.pos[t.i])}" data-a="${r}" data-b="${t.i}"/>`;
    edges.push([r, t.i]);
  }
  lines.innerHTML = svg;
  const paths = [...lines.children];
  const nodes = T.list.map((t) => h('div.tt-node', {
    style: { left: L.pos[t.i].x + 'px', top: L.pos[t.i].y + 'px', width: NODE_W + 'px', height: NODE_H + 'px' },
    'data-i': t.i,
  }, techIcon(t), h('span', t.name)));
  world.append(
    ...L.bands.map((b, n) => h('div.tt-band' + (n % 2 ? '.odd' : ''), { style: { top: b.y + 'px', height: b.h + 'px', width: L.w + 'px' } },
      h('div.tt-field', icon('field_' + b.f), h('span', T.fields[b.f])))),
    ...T.eras.map((e) => h('div.tt-era', { style: { left: LEFT + e.i * COL + 'px', width: COL + 'px' } }, e.name)),
    lines, ...nodes);

  const vp = h('div.tt-viewport', world);
  const info = h('div.tt-info');

  function apply() {
    view.z = Math.max(MIN_Z, Math.min(MAX_Z, view.z));
    const vw = vp.clientWidth, vh = vp.clientHeight;
    // keep some of the tree in sight
    view.x = Math.min(vw - 80, Math.max(80 - L.w * view.z, view.x));
    view.y = Math.min(vh - 80, Math.max(80 - L.h * view.z, view.y));
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    vp.classList.toggle('far', view.z < 0.55);
  }
  function zoomAt(f, cx, cy) {
    const z = Math.max(MIN_Z, Math.min(MAX_Z, view.z * f));
    view.x = cx - (cx - view.x) * (z / view.z);
    view.y = cy - (cy - view.y) * (z / view.z);
    view.z = z;
    apply();
  }
  function fit() {
    view.z = Math.min(vp.clientWidth / L.w, vp.clientHeight / L.h);
    view.x = (vp.clientWidth - L.w * view.z) / 2; view.y = (vp.clientHeight - L.h * view.z) / 2;
    apply();
  }
  function centreOn(i, z = Math.max(view.z, 0.8)) {
    view.z = z;
    view.x = vp.clientWidth / 2 - (L.pos[i].x + NODE_W / 2) * z;
    view.y = vp.clientHeight / 2 - (L.pos[i].y + NODE_H / 2) * z;
    apply();
  }

  // colours and the highlighted chain of the selected technology
  function paint() {
    const st = T.list.map(status);
    nodes.forEach((n, i) => { n.className = 'tt-node ' + st[i] + (T.list[i].fictional ? ' fict' : ''); });
    const chain = new Set(), next = new Set();
    if (selected != null) {
      const walk = (i) => { if (chain.has(i)) return; chain.add(i); T.list[i].reqI.forEach(walk); };
      walk(selected);
      for (const t of T.list) if (t.reqI.includes(selected)) next.add(t.i);
      nodes[selected].classList.add('sel');
      chain.forEach((i) => i !== selected && nodes[i].classList.add('chain'));
      next.forEach((i) => nodes[i].classList.add('next'));
    }
    paths.forEach((p, n) => {
      const [a, b] = edges[n];
      let c = st[a] === 'known' && st[b] === 'known' ? 'known' : st[a] === 'known' ? 'open' : 'locked';
      if (selected != null && chain.has(a) && chain.has(b)) c += ' chain';
      else if (selected != null && a === selected) c += ' next';
      p.setAttribute('class', c);
    });
    vp.classList.toggle('focus', selected != null);
    showInfo(st);
  }

  function showInfo(st) {
    if (selected == null) {
      mount(info, h('span.muted', mine ? 'Click or tap a technology to see it and research it. Drag to move, scroll or pinch to zoom.'
        : 'Click or tap a technology to see it. Drag to move, scroll or pinch to zoom.'));
      return;
    }
    const t = T.list[selected], state = st[selected];
    const label = { known: 'Known', current: 'Being researched', queued: 'In the queue', avail: 'Available now', locked: 'Needs prerequisites' }[state];
    const act = (fn) => { const e = fn(); if (e) cl.toast(e, true); cl.uiDirty = true; cl.requestFrame(); paint(); };
    mount(info,
      h('div.tt-info-main', techIcon(t), h('div', h('b', t.name), h('span.muted', ' · ' + label),
        h('div.tt-tip', tipFor(cl, k, t.i).split('\n').slice(1).join('\n')))),
      mine && state !== 'known' && h('div.tt-info-btns',
        h('button.primary', { disabled: state !== 'avail' && state !== 'queued', tip: 'Research now (half of the current progress is kept as banked points)',
          on: { click: () => act(() => setResearch(s, R, k, t.id)) } }, 'Research now'),
        h('button', { disabled: state === 'current' || state === 'queued', tip: 'Add to the queue, with any missing prerequisites first',
          on: { click: () => act(() => queueResearch(s, R, k, t.id)) } }, state === 'locked' ? 'Queue with prerequisites' : 'Add to queue')),
      h('button', { tip: 'Close the details', on: { click: () => { selected = null; paint(); } } }, icon('close')));
  }

  // pan (mouse, pen, one finger), pinch (two fingers), wheel zoom, click/tap to select
  const ptrs = new Map();
  let moved = 0, pinch = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    try { vp.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) moved = 0;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });
  vp.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      view.x += dx; view.y += dy; apply();
    } else if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), r = vp.getBoundingClientRect();
      moved = 99;
      zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch.d = d;
    }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (e.type === 'pointerup' && ptrs.size === 0 && moved < 6) {
      const n = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tt-node');
      selected = n ? +n.dataset.i : null;
      paint();
    }
  };
  vp.addEventListener('pointerup', up);
  vp.addEventListener('pointercancel', up);
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  const r = s.countries[k].research;
  const cur = r.current ? T.idx[r.current] : null;
  const zbtn = (name, tip, fn) => h('button.icon-btn', { tip, 'aria-label': tip, on: { click: fn } }, icon(name));
  const wrap = openDialog(cl,
    h('div.row.spread', h('h3', icon('tech_tree'), ` Technology tree: ${s.countries[k].name}`),
      h('div.row',
        zbtn('zoom_out', 'Zoom out', () => zoomAt(1 / 1.25, vp.clientWidth / 2, vp.clientHeight / 2)),
        zbtn('zoom_in', 'Zoom in', () => zoomAt(1.25, vp.clientWidth / 2, vp.clientHeight / 2)),
        zbtn('fit', 'Show the whole tree', fit),
        cur != null && h('button', { tip: 'Centre on the current research project', on: { click: () => { selected = cur; paint(); centreOn(cur); } } }, 'Current project'),
        h('button', { on: { click: () => wrap.remove() } }, 'Close'))),
    h('div.tt-legend.muted', h('i.known'), 'Known', h('i.current'), 'Researching or queued', h('i.avail'), 'Available', h('i.locked'), 'Needs prerequisites',
      h('i.line'), 'Leads to'),
    vp, info);
  wrap.firstChild.classList.add('wide', 'tt-dialog');
  // refresh colours as months pass while the tree is open
  const timer = setInterval(() => { if (!wrap.isConnected) clearInterval(timer); else if (!ptrs.size) paint(); }, 1500);
  paint();
  requestAnimationFrame(() => {
    if (!view.z) {
      // first open: the country's newest known technology, at a readable size
      const known = T.list.filter((t) => knows(s, k, t.i));
      const anchor = cur ?? (known.length ? known[known.length - 1].i : 0);
      centreOn(anchor, 0.9);
    } else apply();
  });
  return wrap;
}
