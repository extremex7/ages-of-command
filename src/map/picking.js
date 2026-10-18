// Uniform-grid spatial index over province bounding boxes + even-odd point-in-polygon test.
const CELL = 32;

export function buildIndex(map) {
  const cols = Math.ceil(map.width / CELL), rows = Math.ceil(map.height / CELL);
  const cells = Array.from({ length: cols * rows }, () => []);
  for (const i of map.ids) {
    const b = map.bbox;
    const x0 = Math.max(0, Math.floor(b[i * 4] / CELL)), y0 = Math.max(0, Math.floor(b[i * 4 + 1] / CELL));
    const x1 = Math.min(cols - 1, Math.floor(b[i * 4 + 2] / CELL)), y1 = Math.min(rows - 1, Math.floor(b[i * 4 + 3] / CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * cols + x].push(i);
  }
  return { cols, rows, cells };
}

function inside(geo, x, y) {
  const { pts, starts } = geo;
  let c = false;
  for (let r = 0; r < starts.length - 1; r++) {
    const s = starts[r], e = starts[r + 1];
    for (let i = s, j = e - 2; i < e; j = i, i += 2) {
      const yi = pts[i + 1], yj = pts[j + 1];
      if ((yi > y) !== (yj > y)) {
        const xi = pts[i], xj = pts[j];
        if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
    }
  }
  return c;
}

export function pickProvince(map, index, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return -1;
  const cell = index.cells[Math.floor(y / CELL) * index.cols + Math.floor(x / CELL)];
  if (!cell) return -1;
  for (const i of cell) {
    const b = map.bbox;
    if (x < b[i * 4] || x > b[i * 4 + 2] || y < b[i * 4 + 1] || y > b[i * 4 + 3]) continue;
    if (inside(map.fine[i], x, y)) return i;
  }
  return -1;
}
