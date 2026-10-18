// Canvas 2D map renderer.
// Static geometry becomes Path2D objects once. The expensive base layer (province fills,
// borders, coastline) is drawn into an offscreen cache and only re-rendered when colours
// change or the camera settles after a pan/zoom; while moving, the cached bitmap is
// transformed instead. Dynamic overlays (selection, armies, labels) are cheap and drawn on top.
import { provinceColors } from './modes.js';
import { hex } from './modes.js';

const OCEAN = '#9fb7c6', OCEAN_DARK = '#1d2833';

export const PROFILES = {
  low: { renderScale: 0.75, maxDpr: 1, fineZoom: 1.6, provinceBorders: 1.4, labels: 'few', settleMs: 200, uiMs: 500, smoothZoom: false, margin: 0.15 },
  balanced: { renderScale: 1, maxDpr: 1.5, fineZoom: 0.9, provinceBorders: 0.9, labels: 'normal', settleMs: 120, uiMs: 250, smoothZoom: true, margin: 0.25 },
  high: { renderScale: 1, maxDpr: 3, fineZoom: 0.55, provinceBorders: 0.6, labels: 'many', settleMs: 80, uiMs: 120, smoothZoom: true, margin: 0.3 },
};

function ringsPath(geo) {
  const p = new Path2D();
  const { pts, starts } = geo;
  for (let r = 0; r < starts.length - 1; r++) {
    const s = starts[r], e = starts[r + 1];
    p.moveTo(pts[s], pts[s + 1]);
    for (let k = s + 2; k < e; k += 2) p.lineTo(pts[k], pts[k + 1]);
    p.closePath();
  }
  return p;
}

function linesInto(path, lines) {
  for (const l of lines) {
    path.moveTo(l[0], l[1]);
    for (let k = 2; k < l.length; k += 2) path.lineTo(l[k], l[k + 1]);
  }
}

export class MapRenderer {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.map = map;
    this.profile = PROFILES.balanced;
    this.cam = { cx: map.width / 2, cy: map.height * 0.42, z: 1 };
    this.paths = { fine: new Array(map.count), coarse: new Array(map.count) };
    this.cache = document.createElement('canvas');
    this.cacheCtx = this.cache.getContext('2d', { alpha: false });
    this.cacheCam = null;
    this.colorsDirty = true;
    this.lastMove = 0;
    this.mode = 'political';
    this.focus = -1;
    this.dark = false;
    this.armyHits = [];
    this.stats = { baseMs: 0, frameMs: 0, baseRenders: 0 };
    this.allBorders = {};
    for (const lod of ['fine', 'coarse']) {
      const p = new Path2D();
      for (const b of map.borders) linesInto(p, b[lod]);
      this.allBorders[lod] = p;
    }
    this.resize();
  }

  path(i, lod) {
    let p = this.paths[lod][i];
    if (!p) p = this.paths[lod][i] = ringsPath(this.map[lod][i]);
    return p;
  }

  setProfile(name) {
    this.profile = PROFILES[name] || PROFILES.balanced;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this.profile.maxDpr) * this.profile.renderScale;
    this.dpr = dpr;
    this.vw = Math.max(1, r.width); this.vh = Math.max(1, r.height);
    this.canvas.width = Math.round(this.vw * dpr);
    this.canvas.height = Math.round(this.vh * dpr);
    const m = this.profile.margin;
    this.cache.width = Math.round(this.vw * (1 + 2 * m) * dpr);
    this.cache.height = Math.round(this.vh * (1 + 2 * m) * dpr);
    this.minZ = Math.min(this.vw / this.map.width, this.vh / this.map.height) * 0.9;
    this.cam.z = Math.max(this.cam.z, this.minZ);
    this.cacheCam = null;
  }

  fit() {
    this.cam.z = Math.max(this.minZ, this.vw / this.map.width);
    this.cam.cx = this.map.width / 2; this.cam.cy = this.map.height * 0.45;
    this.clampCam();
  }

  clampCam() {
    const c = this.cam;
    c.z = Math.max(this.minZ, Math.min(60, c.z));
    const hw = this.vw / 2 / c.z, hh = this.vh / 2 / c.z;
    c.cx = Math.max(Math.min(hw, this.map.width / 2), Math.min(this.map.width - Math.min(hw, this.map.width / 2), c.cx));
    c.cy = Math.max(Math.min(hh, this.map.height / 2), Math.min(this.map.height - Math.min(hh, this.map.height / 2), c.cy));
  }

  screenToWorld(sx, sy) {
    const c = this.cam;
    return [(sx - this.vw / 2) / c.z + c.cx, (sy - this.vh / 2) / c.z + c.cy];
  }

  worldToScreen(x, y) {
    const c = this.cam;
    return [(x - c.cx) * c.z + this.vw / 2, (y - c.cy) * c.z + this.vh / 2];
  }

  pan(dx, dy) {
    this.cam.cx -= dx / this.cam.z; this.cam.cy -= dy / this.cam.z;
    this.clampCam(); this.lastMove = performance.now();
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.cam.z *= factor;
    this.clampCam();
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.cam.cx += wx - nx; this.cam.cy += wy - ny;
    this.clampCam(); this.lastMove = performance.now();
  }

  centerOn(x, y, z) {
    this.cam.cx = x; this.cam.cy = y;
    if (z) this.cam.z = z;
    this.clampCam(); this.lastMove = performance.now();
  }

  invalidate() { this.colorsDirty = true; }

  lod() { return this.cam.z >= this.profile.fineZoom ? 'fine' : 'coarse'; }

  // Re-renders the cached base layer for the current camera.
  renderBase(state) {
    const t0 = performance.now();
    const map = this.map, ctx = this.cacheCtx, c = this.cam, dpr = this.dpr, m = this.profile.margin;
    const W = this.cache.width, H = this.cache.height;
    if (this.colorsDirty || !this.colors) {
      this.colors = provinceColors(this.mode, state, map, this.focus, this.rules);
      this.buildCountryBorders(state);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.dark ? OCEAN_DARK : OCEAN;
    ctx.fillRect(0, 0, W, H);
    const ox = this.vw * m, oy = this.vh * m;
    const z = c.z * dpr;
    ctx.setTransform(z, 0, 0, z, (ox + this.vw / 2 - c.cx * c.z) * dpr, (oy + this.vh / 2 - c.cy * c.z) * dpr);
    const vx0 = c.cx - (this.vw / 2 + ox) / c.z, vx1 = c.cx + (this.vw / 2 + ox) / c.z;
    const vy0 = c.cy - (this.vh / 2 + oy) / c.z, vy1 = c.cy + (this.vh / 2 + oy) / c.z;
    const lod = this.lod();
    const vis = [];
    const bb = map.bbox;
    for (const i of map.ids) {
      if (bb[i * 4 + 2] < vx0 || bb[i * 4] > vx1 || bb[i * 4 + 3] < vy0 || bb[i * 4 + 1] > vy1) continue;
      vis.push(i);
    }
    // coastline halo: thick stroke under the fills only survives along coasts
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.dark ? 'rgba(160,190,210,0.35)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3.2 / c.z;
    for (const i of vis) if (map.coastal[i]) ctx.stroke(this.path(i, lod));
    // fills grouped by colour
    const groups = new Map();
    for (const i of vis) {
      const col = this.colors[i];
      let g = groups.get(col);
      if (!g) groups.set(col, (g = []));
      g.push(i);
    }
    // a hairline stroke in the fill colour hides anti-aliasing seams between neighbours
    ctx.lineWidth = 0.9 / c.z;
    for (const [col, list] of groups) {
      ctx.fillStyle = col; ctx.strokeStyle = col;
      for (const i of list) { const p = this.path(i, lod); ctx.fill(p, 'evenodd'); ctx.stroke(p); }
    }
    // occupation stripes
    if (this.mode === 'political') {
      for (const i of vis) {
        const ctl = state.prov.controller[i];
        if (ctl < 0 || ctl === state.prov.owner[i]) continue;
        ctx.save();
        ctx.clip(this.path(i, lod), 'evenodd');
        ctx.fillStyle = this.stripes(state.countries[ctl].color, c.z);
        ctx.fill(this.path(i, lod));
        ctx.restore();
      }
    }
    if (c.z >= this.profile.provinceBorders * 0.5) {
      ctx.strokeStyle = this.dark ? 'rgba(0,0,0,0.35)' : 'rgba(40,40,40,0.28)';
      ctx.lineWidth = 0.6 / c.z;
      ctx.stroke(this.allBorders[lod]);
    }
    ctx.strokeStyle = this.dark ? 'rgba(10,10,10,0.85)' : 'rgba(30,30,30,0.75)';
    ctx.lineWidth = Math.min(2.2, 0.9 + c.z * 0.25) / c.z;
    ctx.stroke(this.countryBorders[lod]);
    this.cacheCam = { cx: c.cx, cy: c.cy, z: c.z };
    this.colorsDirty = false;
    this.stats.baseMs = performance.now() - t0;
    this.stats.baseRenders++;
  }

  stripes(color, z) {
    this._stripes = this._stripes || new Map();
    let p = this._stripes.get(color);
    if (!p) {
      const s = document.createElement('canvas'); s.width = s.height = 8;
      const g = s.getContext('2d');
      g.strokeStyle = color; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
      p = this.cacheCtx.createPattern(s, 'repeat');
      this._stripes.set(color, p);
    }
    p.setTransform(new DOMMatrix().scale(1 / z, 1 / z));
    return p;
  }

  buildCountryBorders(state) {
    const owner = state.prov.owner;
    this.countryBorders = {};
    for (const lod of ['fine', 'coarse']) {
      const p = new Path2D();
      for (const b of this.map.borders) if (owner[b.a] !== owner[b.b]) linesInto(p, b[lod]);
      this.countryBorders[lod] = p;
    }
    this.countryLabels = computeCountryLabels(state, this.map);
  }

  // Draws one frame. `view` carries hover/selection and visible armies.
  draw(state, view) {
    const t0 = performance.now();
    const now = t0;
    const c = this.cam;
    const needBase = this.colorsDirty || !this.cacheCam ||
      ((this.cacheCam.cx !== c.cx || this.cacheCam.cy !== c.cy || this.cacheCam.z !== c.z) && now - this.lastMove > this.profile.settleMs);
    if (needBase) this.renderBase(state);
    const ctx = this.ctx, dpr = this.dpr, m = this.profile.margin, cc = this.cacheCam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.dark ? OCEAN_DARK : OCEAN;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // place cached bitmap: cache pixel (u,v) shows world ((u/dpr - ox - vw/2)/cc.z + cc.cx, ...)
    const s = c.z / cc.z;
    const ox = this.vw * m, oy = this.vh * m;
    const tx = ((cc.cx - c.cx) * c.z + this.vw / 2 - (ox + this.vw / 2) * s) * dpr;
    const ty = ((cc.cy - c.cy) * c.z + this.vh / 2 - (oy + this.vh / 2) * s) * dpr;
    ctx.imageSmoothingEnabled = s !== 1;
    ctx.setTransform(s, 0, 0, s, tx, ty);
    ctx.drawImage(this.cache, 0, 0);
    // world-space overlays
    ctx.setTransform(c.z * dpr, 0, 0, c.z * dpr, (this.vw / 2 - c.cx * c.z) * dpr, (this.vh / 2 - c.cy * c.z) * dpr);
    const lod = this.lod();
    if (view.selectedCountry >= 0 && this.mode === 'political') {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      for (const i of this.map.ids) if (state.prov.owner[i] === view.selectedCountry && this.onScreen(i)) ctx.fill(this.path(i, lod), 'evenodd');
    }
    if (view.highlight) {
      ctx.fillStyle = 'rgba(255,230,120,0.35)';
      for (const i of view.highlight) ctx.fill(this.path(i, lod), 'evenodd');
    }
    if (view.hover >= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fill(this.path(view.hover, lod), 'evenodd');
    }
    if (view.selected >= 0) {
      ctx.strokeStyle = '#fff8d0'; ctx.lineWidth = 2.2 / c.z; ctx.lineJoin = 'round';
      ctx.stroke(this.path(view.selected, lod));
    }
    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(state, view);
    this.drawArmies(state, view);
    this.stats.frameMs = performance.now() - t0;
    return needBase;
  }

  onScreen(i) {
    const c = this.cam, b = this.map.bbox;
    const hw = this.vw / 2 / c.z, hh = this.vh / 2 / c.z;
    return !(b[i * 4 + 2] < c.cx - hw || b[i * 4] > c.cx + hw || b[i * 4 + 3] < c.cy - hh || b[i * 4 + 1] > c.cy + hh);
  }

  drawLabels(state, view) {
    const ctx = this.ctx, c = this.cam, map = this.map;
    const density = this.profile.labels;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (c.z < 2.6 && this.countryLabels && (this.mode === 'political' || this.mode === 'diplomacy')) {
      const min = density === 'few' ? 11 : density === 'many' ? 8 : 9.5;
      for (const L of this.countryLabels) {
        const size = Math.min(26, L.size * c.z);
        if (size < min) continue;
        const [sx, sy] = this.worldToScreen(L.x, L.y);
        if (sx < -100 || sy < -30 || sx > this.vw + 100 || sy > this.vh + 30) continue;
        ctx.font = `600 ${size.toFixed(1)}px system-ui, sans-serif`;
        ctx.lineWidth = Math.max(2, size / 5);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.fillStyle = 'rgba(25,25,30,0.85)';
        const name = state.countries[L.c].name.toUpperCase();
        ctx.strokeText(name, sx, sy); ctx.fillText(name, sx, sy);
      }
    }
    if (c.z >= 2.2) {
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(20,20,25,0.8)';
      const pad = density === 'few' ? 30 : density === 'many' ? 6 : 14;
      for (const i of map.ids) {
        const bw = (map.bbox[i * 4 + 2] - map.bbox[i * 4]) * c.z;
        if (bw < 40) continue;
        const [sx, sy] = this.worldToScreen(map.x[i], map.y[i]);
        if (sx < 0 || sy < 0 || sx > this.vw || sy > this.vh) continue;
        const name = map.name[i];
        if (ctx.measureText(name).width + pad > bw) continue;
        ctx.fillText(name, sx, sy + 12);
      }
    }
  }

  drawArmies(state, view) {
    const ctx = this.ctx, map = this.map, C = state.countries, c = this.cam;
    this.armyHits = [];
    if (c.z < 0.5 && !view.showAllArmies) {
      // at world zoom only the player's and selected armies are drawn, to keep it readable
    }
    const stackOffset = new Map();
    const battleProvs = new Set(state.battles.map((b) => b.prov));
    // movement paths of selected armies
    for (const a of state.armies) {
      if (!view.selectedArmies.has(a.id) || !a.path.length) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      let [sx, sy] = this.worldToScreen(map.x[a.loc], map.y[a.loc]);
      ctx.moveTo(sx, sy);
      for (const p of a.path) { [sx, sy] = this.worldToScreen(map.x[p], map.y[p]); ctx.lineTo(sx, sy); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const small = c.z < 0.6;
    for (const a of state.armies) {
      const mineOrSel = a.owner === state.player || view.selectedArmies.has(a.id) || a.owner === view.selectedCountry;
      if (small && !mineOrSel && !battleProvs.has(a.loc)) continue;
      let [sx, sy] = this.worldToScreen(map.x[a.loc], map.y[a.loc]);
      if (a.path.length && a.prog > 0) {
        const [nx, ny] = this.worldToScreen(map.x[a.path[0]], map.y[a.path[0]]);
        sx += (nx - sx) * a.prog; sy += (ny - sy) * a.prog;
      }
      if (sx < -30 || sy < -20 || sx > this.vw + 30 || sy > this.vh + 20) continue;
      const k = stackOffset.get(a.loc) || 0;
      stackOffset.set(a.loc, k + 1);
      sy -= 8 + k * 15;
      let n = 0;
      for (const t in a.units) n += a.units[t];
      const label = String(n);
      const w = small ? 14 : 22 + label.length * 5, h = small ? 9 : 14;
      const x = sx - w / 2, y = sy - h / 2;
      const sel = view.selectedArmies.has(a.id);
      ctx.fillStyle = C[a.owner].color;
      ctx.strokeStyle = sel ? '#fff8d0' : 'rgba(0,0,0,0.75)';
      ctx.lineWidth = sel ? 2.5 : 1;
      roundRect(ctx, x, y, w, h, 3); ctx.fill(); ctx.stroke();
      if (!small) {
        // organisation bar
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x + 2, y + h - 3, w - 4, 2);
        ctx.fillStyle = '#7fd36f'; ctx.fillRect(x + 2, y + h - 3, (w - 4) * a.org, 2);
        const [r, g, b] = hex(C[a.owner].color);
        ctx.fillStyle = r * 0.3 + g * 0.59 + b * 0.11 > 150 ? '#111' : '#fff';
        ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, sx, sy - 1);
      }
      if (a.battle) {
        ctx.strokeStyle = '#ffdf5a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 9, y - 1); ctx.lineTo(x - 2, y + h + 1); ctx.moveTo(x - 2, y - 1); ctx.lineTo(x - 9, y + h + 1); ctx.stroke();
      }
      this.armyHits.push({ id: a.id, x: x - 2, y: y - 2, w: w + 4, h: h + 4 });
    }
  }

  armyAt(sx, sy) {
    for (let k = this.armyHits.length - 1; k >= 0; k--) {
      const h = this.armyHits[k];
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return h.id;
    }
    return 0;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// Country label anchors: area-weighted centre of each country's largest land-connected block.
export function computeCountryLabels(state, map) {
  const owner = state.prov.owner;
  const seen = new Uint8Array(map.count);
  const best = new Map();
  for (const i of map.ids) {
    if (seen[i] || owner[i] < 0) continue;
    const o = owner[i];
    const stack = [i]; seen[i] = 1;
    let area = 0, sx = 0, sy = 0;
    const members = [];
    while (stack.length) {
      const u = stack.pop();
      members.push(u);
      const a = map.area[u];
      area += a; sx += map.x[u] * a; sy += map.y[u] * a;
      for (let e = map.adjStart[u]; e < map.adjStart[u + 1]; e++) {
        const v = map.adj[e];
        if (!seen[v] && owner[v] === o && map.adjKind[e] === 0) { seen[v] = 1; stack.push(v); }
      }
    }
    const cur = best.get(o);
    if (!cur || area > cur.area) {
      // snap to the member province nearest the weighted centre so labels stay on land
      const cx = sx / area, cy = sy / area;
      let near = members[0], nd = Infinity;
      for (const u of members) { const d = (map.x[u] - cx) ** 2 + (map.y[u] - cy) ** 2; if (d < nd) { nd = d; near = u; } }
      const blend = members.length > 2 ? 0.5 : 1;
      best.set(o, { c: o, area, x: cx + (map.x[near] - cx) * blend, y: cy + (map.y[near] - cy) * blend });
    }
  }
  // size in world units: grows with the square root of area (km² -> map units ≈ 9.8 km)
  return [...best.values()].map((L) => ({ ...L, size: Math.sqrt(L.area) / 9.8 / 5.5 }));
}
