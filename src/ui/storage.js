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

export function writeSave(name, data, info) {
  const ok = set('save.' + name, data);
  if (!ok) return 'Browser storage is full or unavailable. Use "Export file" instead.';
  const list = listSlots().filter((s) => s.name !== name);
  list.unshift({ name, ...info, size: data.length });
  writeSlots(list);
  return null;
}
export function readSave(name) { return get('save.' + name); }
export function deleteSave(name) { del('save.' + name); writeSlots(listSlots().filter((s) => s.name !== name)); }

export function rotateAutosaves(keep) {
  const list = listSlots();
  const autos = list.filter((s) => s.name.startsWith('autosave-')).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  for (const s of autos.slice(Math.max(0, keep))) deleteSave(s.name);
}
