// Save slots and settings. In a browser they live in localStorage; every access is guarded:
// storage can be full, disabled or unavailable (private windows), and the game must keep working
// without it. In the apps they are files in the player's data folder instead, with no size limit:
// initStorage() reads them all at start, and writes go to memory at once and to disk as well.
// - Desktop app (launcher/, which answers /api/info): files written through its HTTP store API.
// - Android app (android/): files written through the AOCNative bridge the app adds to the page.
const PREFIX = 'aoc3.';
let disk = null; // apps: { files: Map(key -> text), put(k, v) -> Promise<boolean>, remove(k) }

function get(k) {
  if (disk) return disk.files.get(k) ?? null;
  try { return localStorage.getItem(PREFIX + k); } catch { return null; }
}
function set(k, v) {
  if (disk) { disk.files.set(k, v); disk.put(k, v); return true; }
  try { localStorage.setItem(PREFIX + k, v); return true; } catch { return false; }
}
function del(k) {
  if (disk) { disk.files.delete(k); disk.remove(k); return; }
  try { localStorage.removeItem(PREFIX + k); } catch { /* ignore */ }
}

// Detects the desktop or Android app and loads its stored files. Returns the app's info
// ({ app, version, dataDir, platform }) or null in a plain browser.
export async function initStorage() {
  const bridge = typeof window !== 'undefined' ? window.AOCNative : null;
  if (bridge) {
    try {
      const info = JSON.parse(bridge.info());
      disk = {
        files: new Map(Object.entries(JSON.parse(bridge.all()))),
        put: async (k, v) => bridge.put(k, v),
        remove: (k) => bridge.remove(k),
      };
      return info;
    } catch {
      disk = null;
    }
  }
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    if (!r.ok) return null;
    const info = await r.json();
    if (info.app !== 'ages-of-command') return null;
    const all = await (await fetch('/api/store', { cache: 'no-store' })).json();
    const url = (k) => '/api/store/' + encodeURIComponent(k);
    disk = {
      files: new Map(Object.entries(all)),
      put: (k, v) => fetch(url(k), { method: 'PUT', body: v }).then((r) => r.ok, () => false),
      remove: (k) => { fetch(url(k), { method: 'DELETE' }).catch(() => {}); },
    };
    // keep the launcher alive while the window is open (it exits when the game is closed)
    setInterval(() => { fetch('/api/ping', { method: 'POST' }).catch(() => {}); }, 5000);
    return info;
  } catch {
    return null;
  }
}
export function isDesktop() { return !!disk; }

export function loadSettings() {
  const def = { profile: 'balanced', uiScale: 'auto', resolution: 'auto', fpsCap: 0, windowMode: 'windowed', windowSize: null,
    autosaveMonths: 6, autosaveKeep: 3, tooltips: true, resumeAfterEvents: true,
    musicVolume: 0.5, sfxVolume: 0.6, cheats: false, tutorial: 'ask', colorVision: 'normal', textSize: 1, keyboardMode: false };
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
  if (disk) { // wait for the file to reach the disk before reporting success
    if (!(await disk.put('save.' + name, data))) return 'Could not write the save file to disk.';
    disk.files.set('save.' + name, data);
  } else if (!set('save.' + name, data)) return 'Browser storage is full or unavailable. Use "Export file" instead.';
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

// Custom scenarios made in the scenario editor: the index under "scenarios" and each scenario
// (compressed like saves) under "scenario.<id>".
export function listScenarios() {
  try { return JSON.parse(get('scenarios') || '[]'); } catch { return []; }
}
export async function writeScenario(sc, entry) {
  const text = JSON.stringify(sc);
  let data = text;
  if (typeof CompressionStream !== 'undefined') {
    try { data = await gzip(text); } catch { data = text; }
  }
  if (disk) {
    if (!(await disk.put('scenario.' + sc.id, data))) return 'Could not write the scenario file to disk.';
    disk.files.set('scenario.' + sc.id, data);
  } else if (!set('scenario.' + sc.id, data)) return 'Browser storage is full or unavailable. Use "Export file" instead.';
  const list = listScenarios().filter((s) => s.id !== sc.id);
  list.push({ ...entry, size: data.length });
  set('scenarios', JSON.stringify(list));
  return null;
}
export async function readScenario(id) {
  const data = get('scenario.' + id);
  if (!data) return null;
  return JSON.parse(data.startsWith('gz:') ? await gunzip(data) : data);
}
export function deleteScenario(id) {
  del('scenario.' + id);
  set('scenarios', JSON.stringify(listScenarios().filter((s) => s.id !== id)));
}

// Achievements earned in any game on this device: { id: { at, country, scenario, date } }.
export function loadAchievements() {
  try { return JSON.parse(get('achievements') || '{}'); } catch { return {}; }
}
export function saveAchievement(id, info) {
  const all = loadAchievements();
  if (all[id]) return false;
  all[id] = { at: Date.now(), ...info };
  set('achievements', JSON.stringify(all));
  return true;
}
