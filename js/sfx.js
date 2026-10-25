// Tiny chiptune sound effects (WebAudio, no files).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('rd_muted') === '1'; } catch {}

function ac() {
  if (muted) return null;
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, { type = 'square', vol = 0.08, at = 0, slide = 0 } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.12) {
  const a = ac(); if (!a) return;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = buf; g.gain.value = vol; s.connect(g).connect(a.destination); s.start();
}

export const sfx = {
  unlock() { ac(); },
  toggle() { muted = !muted; try { localStorage.setItem('rd_muted', muted ? '1' : '0'); } catch {} return muted; },
  get muted() { return muted; },
  click() { tone(660, 0.05, { vol: 0.04 }); },
  tick() { tone(1200, 0.03, { vol: 0.03 }); },
  correct() { tone(523, 0.08); tone(659, 0.08, { at: 0.08 }); tone(784, 0.14, { at: 0.16 }); },
  wrong() { tone(196, 0.25, { type: 'sawtooth', slide: -60 }); },
  whistle() { tone(2100, 0.12, { type: 'triangle', vol: 0.06 }); tone(2300, 0.22, { type: 'triangle', vol: 0.06, at: 0.13 }); },
  hut() { tone(150, 0.06, { vol: 0.1 }); },
  hit() { noise(0.18, 0.18); tone(90, 0.12, { vol: 0.12 }); },
  dive() { tone(300, 0.12, { slide: 300, vol: 0.05 }); },
  bad() { tone(392, 0.15); tone(330, 0.15, { at: 0.15 }); tone(262, 0.3, { at: 0.3 }); },
  great() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, { at: i * 0.09 })); },
};
