// Web Audio synthesis for sound-pack-v1 (backend/core/src/sounds.ts): every id s1:<family>:<pitch>
// is a short recipe, so no audio files are fetched and the same id always sounds the same.
import { SOUND_PITCHES, soundAsset } from '@cognimetric/core';

let ctx: AudioContext | null = null;
function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

type Out = { c: AudioContext; t: number; dest: AudioNode };

function env(o: Out, start: number, attack: number, hold: number, release: number, peak = 0.3) {
  const g = o.c.createGain();
  g.gain.setValueAtTime(0.0001, o.t + start);
  g.gain.exponentialRampToValueAtTime(peak, o.t + start + attack);
  g.gain.setValueAtTime(peak, o.t + start + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + start + attack + hold + release);
  g.connect(o.dest);
  return g;
}

function tone(o: Out, type: OscillatorType, f: number, start: number, dur: number, opts: { to?: number; peak?: number; attack?: number; release?: number } = {}) {
  const osc = o.c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, o.t + start);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, o.t + start + dur);
  const attack = opts.attack ?? 0.01;
  const release = opts.release ?? Math.max(0.05, dur * 0.6);
  osc.connect(env(o, start, attack, Math.max(0, dur - attack - release), release, opts.peak ?? 0.25));
  osc.start(o.t + start);
  osc.stop(o.t + start + dur + 0.05);
  return osc;
}

function noise(o: Out, start: number, dur: number, filter: BiquadFilterType, f: number, peak = 0.4) {
  const len = Math.ceil(o.c.sampleRate * dur);
  const buf = o.c.createBuffer(1, len, o.c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = o.c.createBufferSource();
  src.buffer = buf;
  const bq = o.c.createBiquadFilter();
  bq.type = filter;
  bq.frequency.value = f;
  src.connect(bq);
  bq.connect(env(o, start, 0.002, 0, dur, peak));
  src.start(o.t + start);
}

const RECIPES: Record<string, (o: Out, m: number) => void> = {
  bell: (o, m) => { for (const [k, p] of [[1, 0.25], [2.4, 0.1], [3.9, 0.06]] as const) tone(o, 'sine', 660 * m * k, 0, 1.2, { peak: p, release: 1.1 }); },
  chime: (o, m) => { for (const [i, k] of [1, 1.25, 1.5].entries()) tone(o, 'sine', 990 * m * k, i * 0.18, 0.7, { peak: 0.18, release: 0.6 }); },
  doorbell: (o, m) => { tone(o, 'triangle', 660 * m, 0, 0.5, { peak: 0.3 }); tone(o, 'triangle', 524 * m, 0.45, 0.7, { peak: 0.3 }); },
  phone: (o, m) => { for (let i = 0; i < 8; i++) tone(o, 'square', i % 2 ? 480 * m : 400 * m, i * 0.07, 0.06, { peak: 0.08, release: 0.02 }); for (let i = 0; i < 8; i++) tone(o, 'square', i % 2 ? 480 * m : 400 * m, 0.7 + i * 0.07, 0.06, { peak: 0.08, release: 0.02 }); },
  whistle: (o, m) => { tone(o, 'sine', 1200 * m, 0, 0.7, { to: 1900 * m, peak: 0.2, release: 0.2 }); },
  siren: (o, m) => { tone(o, 'sine', 600 * m, 0, 0.55, { to: 950 * m, peak: 0.2, release: 0.1 }); tone(o, 'sine', 950 * m, 0.55, 0.55, { to: 600 * m, peak: 0.2, release: 0.2 }); },
  drip: (o, m) => { for (let i = 0; i < 3; i++) tone(o, 'sine', 1500 * m, i * 0.3, 0.09, { to: 500 * m, peak: 0.3, release: 0.06 }); },
  slide: (o, m) => { tone(o, 'triangle', 260 * m, 0, 0.9, { to: 880 * m, peak: 0.25, release: 0.25 }); },
  drum: (o, m) => { for (let i = 0; i < 3; i++) { tone(o, 'sine', 160 * m, i * 0.28, 0.22, { to: 50 * m, peak: 0.6, release: 0.2 }); noise(o, i * 0.28, 0.03, 'lowpass', 1200 * m, 0.15); } },
  knock: (o, m) => { for (const s of [0, 0.18, 0.36]) noise(o, s, 0.07, 'bandpass', 380 * m, 0.9); },
  clap: (o, m) => { for (const s of [0, 0.35]) noise(o, s, 0.12, 'highpass', 1400 * m, 0.5); },
  tick: (o, m) => { for (let i = 0; i < 5; i++) tone(o, 'square', 2200 * m, i * 0.22, 0.015, { peak: 0.12, attack: 0.002, release: 0.01 }); },
  horn: (o, m) => { tone(o, 'sawtooth', 220 * m, 0, 0.8, { peak: 0.1, attack: 0.03, release: 0.15 }); tone(o, 'sawtooth', 277 * m, 0, 0.8, { peak: 0.1, attack: 0.03, release: 0.15 }); },
  buzzer: (o, m) => { tone(o, 'square', 110 * m, 0, 0.9, { peak: 0.1, attack: 0.01, release: 0.05 }); },
  alarm: (o, m) => { for (let i = 0; i < 4; i++) tone(o, 'square', 1000 * m, i * 0.25, 0.14, { peak: 0.08, release: 0.03 }); },
  engine: (o, m) => {
    const lfo = o.c.createOscillator();
    const depth = o.c.createGain();
    lfo.frequency.value = 9;
    depth.gain.value = 12 * m;
    const osc = tone(o, 'sawtooth', 55 * m, 0, 1.1, { peak: 0.18, attack: 0.1, release: 0.3 });
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(o.t);
    lfo.stop(o.t + 1.2);
  },
};

/** Plays a sound-pack-v1 id now. Unknown ids are silent rather than wrong. */
export function playSound(id: string) {
  const a = soundAsset(id);
  const recipe = a && RECIPES[a.family];
  if (!recipe) return;
  const c = audio();
  const master = c.createGain();
  master.gain.value = 0.9;
  master.connect(c.destination);
  recipe({ c, t: c.currentTime + 0.02, dest: master }, SOUND_PITCHES[a.pitch] ?? 1);
}

/** A neutral test tone for the "turn your sound on" check; not one of the test sounds. */
export function playTestTone() {
  const c = audio();
  const o: Out = { c, t: c.currentTime + 0.02, dest: c.destination };
  tone(o, 'sine', 440, 0, 0.35, { peak: 0.2 });
  tone(o, 'sine', 554, 0.3, 0.35, { peak: 0.2 });
}
