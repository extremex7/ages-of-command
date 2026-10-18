// Save slots and settings in localStorage. Every access is guarded: storage can be full,
// disabled or unavailable (private windows), and the game must keep working without it.
const PREFIX = 'aoc3.';

function get(k) { try { return localStorage.getItem(PREFIX + k); } catch { return null; } }
function set(k, v) { try { localStorage.setItem(PREFIX + k, v); return true; } catch { return false; } }
function del(k) { try { localStorage.removeItem(PREFIX + k); } catch { /* ignore */ } }

export function loadSettings() {
  const def = { profile: 'balanced', uiScale: 1, autosaveMonths: 6, autosaveKeep: 3, tooltips: true };
  try { return { ...def, ...JSON.parse(get('settings') || '{}') }; } catch { return def; }
}
export function saveSettings(s) { set('settings', JSON.stringify(s)); }

export function listSlots() {
  try { return JSON.parse(get('slots') || '[]'); } catch { return []; }
}
function writeSlots(list) { return set('slots', JSON.stringify(list)); }

// Saves are gzip-compressed (about 4× smaller) when the browser supports CompressionStream,
// stored as base64 with a "gz:" prefix; older plain-JSON slots still load.
async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'gz:' + btoa(s);
}
async function gunzip(data) {
  const s = atob(data.slice(3));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function writeSave(name, text, info) {
  let data = text;
  if (typeof CompressionStream !== 'undefined') {
    try { data = await gzip(text); } catch { data = text; }
  }
  const ok = set('save.' + name, data);
  if (!ok) return 'Browser storage is full or unavailable. Use "Export file" instead.';
  const list = listSlots().filter((s) => s.name !== name);
  list.unshift({ name, ...info, size: data.length });
  writeSlots(list);
  return null;
}
export async function readSave(name) {
  const data = get('save.' + name);
  if (data && data.startsWith('gz:')) return gunzip(data);
  return data;
}
export function deleteSave(name) { del('save.' + name); writeSlots(listSlots().filter((s) => s.name !== name)); }

export function rotateAutosaves(keep) {
  const list = listSlots();
  const autos = list.filter((s) => s.name.startsWith('autosave-')).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  for (const s of autos.slice(Math.max(0, keep))) deleteSave(s.name);
}
