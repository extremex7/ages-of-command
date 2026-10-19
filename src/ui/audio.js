// Music and sound effects, synthesised in the browser with the Web Audio API: no audio files.
// The music is generated live from a mood (chords, tempo, instruments and drum patterns) that
// follows the player's country: calm in peace, brighter when prospering, uneasy when unstable,
// martial at war, dark in a crisis. Mood changes take effect at the next bar.
// Browsers only allow sound after the first click or key press, so nothing plays before that.
let ctx = null, musicBus = null, sfxBus = null, echo = null, noise = null;
let vol = { music: 0.5, sfx: 0.6 };
let mood = 'menu', wanted = 'menu';
let timer = 0, nextBar = 0, bar = 0, melodyNote = 0;

// Moods. Chords are semitones from the root (one chord a bar); drums are 16-step patterns
// (x = hit, o = soft hit, . = rest).
const MAJOR = [0, 2, 4, 5, 7, 9, 11], DORIAN = [0, 2, 3, 5, 7, 9, 10], HARM = [0, 2, 3, 5, 7, 8, 11], PHRYG = [0, 1, 3, 5, 7, 8, 10];
const MOODS = {
  menu: { bpm: 64, root: 50, scale: DORIAN, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]],
    pad: 0.5, cutoff: 1100, arp: 'q', arpGain: 0.12, bass: 'w', melody: 0.3, drums: null },
  peace: { bpm: 72, root: 48, scale: MAJOR, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 7]],
    pad: 0.45, cutoff: 1400, arp: 'e', arpGain: 0.1, bass: 'h', melody: 0.4, drums: null },
  prosperity: { bpm: 92, root: 55, scale: MAJOR, chords: [[0, 4, 7, 12], [-1, 2, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 5]],
    pad: 0.4, cutoff: 1900, arp: 'e', arpGain: 0.11, bass: 'q', melody: 0.55,
    drums: { kick: 'x.......x.......', snare: '....o.......o...', hat: 'o.o.o.o.o.o.o.o.' } },
  tension: { bpm: 78, root: 45, scale: HARM, chords: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0, 5], [-5, -1, 2, 7]],
    pad: 0.5, cutoff: 900, arp: 'e', arpGain: 0.08, bass: 'q', melody: 0.2,
    drums: { kick: 'x.........x.....', snare: null, hat: '..o...o...o...o.' } },
  war: { bpm: 108, root: 50, scale: HARM, chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]],
    pad: 0.4, cutoff: 1300, arp: 's', arpGain: 0.07, bass: 'e', melody: 0.45,
    drums: { kick: 'x...x...x...x...', snare: '....x.......x.oo', hat: 'o.o.o.o.o.o.o.o.' } },
  crisis: { bpm: 60, root: 49, scale: PHRYG, chords: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 1, 4]],
    pad: 0.55, cutoff: 700, arp: null, arpGain: 0, bass: 'w', melody: 0.15,
    drums: { kick: 'x..x............', snare: null, hat: null } },
};
export const MOOD_LIST = Object.keys(MOODS);
export const MOOD_NAMES = { menu: 'Main menu', peace: 'Peace', prosperity: 'Prosperity', tension: 'Unrest', war: 'War', crisis: 'Crisis' };

const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  buildGraph(new AC());
  applyVolumes();
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
  return true;
}

function buildGraph(context) {
  ctx = context;
  const master = ctx.createDynamicsCompressor();
  master.connect(ctx.destination);
  musicBus = ctx.createGain(); sfxBus = ctx.createGain();
  musicBus.connect(master); sfxBus.connect(master);
  // a soft echo instead of reverb: two nodes, cheap on slow machines
  echo = ctx.createDelay(1);
  echo.delayTime.value = 0.32;
  const fb = ctx.createGain(); fb.gain.value = 0.3;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2200;
  echo.connect(tone); tone.connect(fb); fb.connect(echo); tone.connect(musicBus);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// Renders `seconds` of a mood's music (at full music volume) without playing it: for previews
// and tests. Returns an AudioBuffer.
export async function renderMood(name, seconds = 20) {
  const saved = { ctx, musicBus, sfxBus, echo, noise, mood, bar };
  buildGraph(new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100));
  musicBus.gain.value = 0.3;
  mood = name; bar = 0;
  const M = MOODS[name], beat = 60 / M.bpm;
  for (let t = 0.05; t < seconds; t += beat * 4) { playBar(M, bar % M.chords.length, t, beat); bar++; }
  const buf = await ctx.startRendering();
  ({ ctx, musicBus, sfxBus, echo, noise, mood, bar } = saved);
  return buf;
}

function applyVolumes() {
  if (!ctx) return;
  // a gentle curve: 50% on the slider is comfortably quiet
  musicBus.gain.setTargetAtTime(0.3 * vol.music * vol.music, ctx.currentTime, 0.3);
  sfxBus.gain.setTargetAtTime(0.5 * vol.sfx * vol.sfx, ctx.currentTime, 0.05);
  if (vol.music > 0) startMusic(); else stopMusic();
}

// Sets the volumes (0–1) from the settings, and starts sound after the first click or key press.
export function setupAudio(settings) {
  setVolumes(settings);
  const unlock = () => {
    if (!ensure()) return;
    ctx.resume();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  // button clicks
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('button');
    if (!b || b.disabled) return;
    sfx(b.closest('.tabs') || b.closest('.modes') ? 'tab' : b.closest('.build-grid') ? 'build' : 'click');
  }, true);
}

export function setVolumes(s) {
  vol = { music: s.musicVolume ?? 0.5, sfx: s.sfxVolume ?? 0.6 };
  applyVolumes();
}

export function setMood(m) { if (MOODS[m]) wanted = m; }
export function currentMood() { return wanted; }

// ---- music ----

function startMusic() {
  if (timer || !ctx) return;
  nextBar = ctx.currentTime + 0.1;
  timer = setInterval(schedule, 120);
}
function stopMusic() { clearInterval(timer); timer = 0; }

function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  if (nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.05;
  while (nextBar < ctx.currentTime + 0.5) {
    if (bar % 4 === 0 && wanted !== mood) { mood = wanted; bar = 0; }
    const M = MOODS[mood];
    const beat = 60 / M.bpm, len = beat * 4;
    playBar(M, bar % M.chords.length, nextBar, beat);
    nextBar += len; bar++;
  }
}

function playBar(M, ci, t0, beat) {
  const chord = M.chords[ci], root = M.root, len = beat * 4;
  // pad: the chord an octave up, two slightly detuned voices per note
  for (const n of chord) for (const det of [-6, 6]) voice('sawtooth', freq(root + 12 + n), t0, len * 1.05, M.pad * 0.035, 0.5, 1.4, M.cutoff, det, true);
  // bass
  const bn = root - 12 + chord[0];
  const bstep = { w: 4, h: 2, q: 1, e: 0.5 }[M.bass] || 4;
  for (let b = 0; b < 4; b += bstep) voice('triangle', freq(b % 2 && bstep < 1 ? bn + 12 : bn), t0 + b * beat, Math.min(bstep, 2) * beat * 0.95, 0.22, 0.01, 0.2, 600);
  // arpeggio
  if (M.arp) {
    const step = { q: 1, e: 0.5, s: 0.25 }[M.arp];
    const tones = [...chord, chord[0] + 12, chord[1] + 12];
    for (let b = 0, n = 0; b < 4; b += step, n++) {
      const up = n % (tones.length * 2 - 2);
      const idx = up < tones.length ? up : tones.length * 2 - 2 - up;
      voice('triangle', freq(root + 12 + tones[idx]), t0 + b * beat, step * beat * 1.6, M.arpGain, 0.005, 0.08, 3000, 0, true);
    }
  }
  // melody: a random walk on the scale, mostly chord tones on strong beats
  if (Math.random() < M.melody * 1.6) {
    const scale = M.scale;
    for (let b = 0; b < 4;) {
      const d = [0.5, 1, 1, 1.5, 2][Math.floor(Math.random() * 5)];
      if (Math.random() < M.melody + 0.25) {
        if (b === 0 || Math.random() < 0.3) melodyNote = chord[Math.floor(Math.random() * chord.length)];
        else {
          const i = scale.indexOf(((melodyNote % 12) + 12) % 12);
          const j = Math.max(0, Math.min(scale.length - 1, (i < 0 ? 0 : i) + (Math.random() < 0.5 ? -1 : 1)));
          melodyNote = Math.floor(melodyNote / 12) * 12 + scale[j];
        }
        melodyNote = Math.max(-5, Math.min(19, melodyNote));
        voice(mood === 'war' ? 'sawtooth' : 'triangle', freq(root + 24 + melodyNote), t0 + b * beat, d * beat * 0.9, mood === 'war' ? 0.05 : 0.1, 0.03, 0.25, 2400, 0, true, true);
      }
      b += d;
    }
  }
  // drums
  if (M.drums) {
    const sixteenth = beat / 4;
    for (let i = 0; i < 16; i++) {
      const t = t0 + i * sixteenth;
      const k = M.drums.kick?.[i], s = M.drums.snare?.[i], hh = M.drums.hat?.[i];
      if (k && k !== '.') kick(t, k === 'x' ? 0.5 : 0.25);
      if (s && s !== '.') snare(t, s === 'x' ? 0.18 : 0.08);
      if (hh && hh !== '.') hat(t, hh === 'x' ? 0.06 : 0.03);
    }
  }
}

// one note: oscillator -> lowpass -> envelope -> music bus (and the echo)
function voice(type, f, t, dur, gain, attack, release, cutoff, detune = 0, wet = false, vibrato = false) {
  const o = ctx.createOscillator(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  flt.type = 'lowpass'; flt.frequency.value = cutoff;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  g.gain.linearRampToValueAtTime(0, t + dur + release);
  o.connect(flt); flt.connect(g); g.connect(musicBus);
  if (wet) g.connect(echo);
  if (vibrato) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5; lg.gain.value = 6;
    lfo.connect(lg); lg.connect(o.detune);
    lfo.start(t); lfo.stop(t + dur + release + 0.05);
  }
  o.start(t); o.stop(t + dur + release + 0.05);
}

function kick(t, gain, bus = musicBus) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.4);
}
function noiseHit(t, gain, type, f, dur, bus) {
  const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise; flt.type = type; flt.frequency.value = f;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt); flt.connect(g); g.connect(bus);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}
const snare = (t, gain) => noiseHit(t, gain, 'bandpass', 1800, 0.18, musicBus);
const hat = (t, gain) => noiseHit(t, gain, 'highpass', 7000, 0.05, musicBus);

// ---- sound effects ----

function tone(type, f, t, dur, gain, f2 = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
}

const SFX = {
  click: (t) => tone('triangle', 1400, t, 0.05, 0.25, 900),
  tab: (t) => { tone('sine', 700, t, 0.06, 0.25); tone('sine', 1050, t + 0.03, 0.06, 0.15); },
  build: (t) => { tone('sine', 190, t, 0.18, 0.5, 80); noiseHit(t, 0.15, 'lowpass', 900, 0.12, sfxBus); },
  research: (t) => [0, 4, 7, 12].forEach((n, i) => tone('triangle', freq(72 + n), t + i * 0.09, 0.35, 0.22)),
  notify: (t) => { tone('sine', 988, t, 0.4, 0.25); tone('sine', 1319, t + 0.12, 0.5, 0.2); },
  event: (t) => [0, 7, 12].forEach((n, i) => tone('sine', freq(76 + n), t + i * 0.12, 0.7, 0.2)),
  war: (t) => { tone('sawtooth', 110, t, 1.1, 0.18); tone('sawtooth', 165, t + 0.05, 1.0, 0.12); kick(t, 0.8, sfxBus); kick(t + 0.45, 0.6, sfxBus); },
  peace: (t) => [0, 4, 7, 11, 14].forEach((n, i) => tone('sine', freq(72 + n), t + i * 0.1, 1.2, 0.15)),
  victory: (t) => [0, 4, 7, 12].forEach((n, i) => tone('square', freq(67 + n), t + i * 0.08, 0.25, 0.07)),
  defeat: (t) => [12, 8, 5, 0].forEach((n, i) => tone('triangle', freq(60 + n), t + i * 0.14, 0.45, 0.2)),
  explosion: (t) => { noiseHit(t, 0.6, 'lowpass', 500, 1.6, sfxBus); tone('sine', 70, t, 1.2, 0.5, 30); },
  error: (t) => tone('square', 150, t, 0.16, 0.08, 120),
};
let lastSfx = 0;

export function sfx(name) {
  if (!ctx || ctx.state !== 'running' || vol.sfx <= 0 || !SFX[name]) return;
  const now = ctx.currentTime;
  if (now - lastSfx < 0.03) return; // one at a time for bursts of clicks
  lastSfx = now;
  SFX[name](now + 0.005);
}

// The mood for a country, from its wars, stability, finances and growth.
export function moodFor(state, k) {
  if (k < 0) return 'peace';
  const c = state.countries[k];
  if (!c?.alive) return 'crisis';
  const atWar = state.wars.some((w) => w.attackers.includes(k) || w.defenders.includes(k));
  const net = c.ledger?.net ?? 0, gdp = c.ledger?.gdpMonth ?? 1;
  const debt = c.treasury < -gdp * 2;
  if (c.stability < 30 || (debt && c.stability < 50)) return 'crisis';
  if (atWar) return 'war';
  if (c.stability < 50 || debt) return 'tension';
  if (c.stability >= 65 && net > 0) return 'prosperity';
  return 'peace';
}
