// Stylised flags drawn from a pattern spec ({pattern, colors}). These are simplified
// placeholders, not accurate flag artwork.
const cache = new Map();

export function flagCanvas(country, big = false) {
  const key = country.tag + (big ? 'b' : '');
  const cached = cache.get(key);
  const c = document.createElement('canvas');
  c.className = big ? 'flag big' : 'flag';
  c.width = big ? 54 : 30; c.height = big ? 36 : 20;
  const g = c.getContext('2d');
  if (cached) { g.drawImage(cached, 0, 0); return c; }
  const f = country.flag || { pattern: 'h', colors: [country.color, '#ffffff'] };
  const cols = f.colors && f.colors.length ? f.colors : [country.color];
  const W = c.width, H = c.height;
  g.fillStyle = cols[0]; g.fillRect(0, 0, W, H);
  if (f.pattern === 'h') cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (H * i) / cols.length, W, H / cols.length + 1); });
  else if (f.pattern === 'v') cols.forEach((col, i) => { g.fillStyle = col; g.fillRect((W * i) / cols.length, 0, W / cols.length + 1, H); });
  else if (f.pattern === 'disc') { g.fillStyle = cols[1] || '#fff'; g.beginPath(); g.arc(W / 2, H / 2, H * 0.3, 0, Math.PI * 2); g.fill(); }
  else if (f.pattern === 'cross') {
    g.fillStyle = cols[1] || '#fff'; g.fillRect(W * 0.3, 0, W * 0.16, H); g.fillRect(0, H * 0.4, W, H * 0.2);
    if (cols[2]) { g.fillStyle = cols[2]; g.fillRect(W * 0.34, 0, W * 0.08, H); g.fillRect(0, H * 0.45, W, H * 0.1); }
  }
  const copy = document.createElement('canvas'); copy.width = W; copy.height = H; copy.getContext('2d').drawImage(c, 0, 0);
  cache.set(key, copy);
  return c;
}
