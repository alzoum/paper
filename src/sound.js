// A synthesized paper rustle, so no audio files need to ship with the app.
let ctx = null; // shared by the page-turn sound and the ambience
let paper = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

function paperBuffer(ac) {
  const len = Math.floor(ac.sampleRate * 0.9);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let slow = 0;
  for (let i = 0; i < len; i++) {
    // Slowly wandering amplitude plus sparse crackles reads as paper fibres.
    slow += (Math.random() - 0.5) * 0.02;
    slow = Math.max(-0.4, Math.min(0.4, slow));
    const crackle = Math.random() < 0.003 ? (Math.random() * 2 - 1) * 2.2 : 0;
    d[i] = (Math.random() * 2 - 1) * (0.6 + slow) + crackle;
  }
  return buf;
}

export function playPageTurn(strength = 1) {
  if (!enabled) return;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    paper ??= paperBuffer(ctx);
    const t = ctx.currentTime;
    const len = 0.42 + Math.random() * 0.12;

    const src = ctx.createBufferSource();
    src.buffer = paper;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.7;
    band.frequency.setValueAtTime(3200 + Math.random() * 1200, t);
    band.frequency.exponentialRampToValueAtTime(1100, t + len);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;

    const gain = ctx.createGain();
    const peak = 0.32 * strength;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak * 0.5, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(peak, t + len * 0.55);
    gain.gain.exponentialRampToValueAtTime(peak * 0.6, t + len * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);

    src.connect(band).connect(hp).connect(gain).connect(ctx.destination);
    src.start(t, Math.random() * 0.3);
    src.stop(t + len + 0.05);
  } catch {
    // Audio is a nicety; never let it break reading.
  }
}

// ---------- ambience: rain, café and fireplace, all synthesized ----------

let ambience = null;
let ambienceVolume = 0.7;
const AMBIENCE_LEVEL = 0.6; // full-volume loudness, kept well under the page-turn sound

function audio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers keep audio asleep until the reader touches the page.
export function resumeAudio() {
  if (ctx?.state === 'suspended') ctx.resume();
}

const noiseCache = {};
function noise(ac, color) {
  if (noiseCache[color]) return noiseCache[color];
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else d[i] = w;
  }
  return (noiseCache[color] = buf);
}

function loop(ac, amb, color) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac, color);
  src.loop = true;
  src.start(0, Math.random() * 3);
  amb.sources.push(src);
  return src;
}

function filter(ac, type, freq, q = 0.7) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gainNode(ac, value) {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

// A very short burst of noise: a raindrop, a crackle.
function burst(ac, out, t, { freq, q = 1, peak, len, type = 'bandpass' }) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac, 'white');
  const f = filter(ac, type, freq, q);
  const g = ac.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 3);
  src.stop(t + len + 0.02);
}

// A soft room for the piano to ring in: a few seconds of decaying noise as an impulse response.
function reverb(ac, seconds = 3.2) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;
  return conv;
}

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Keep a scene's chain of timeouts going until the scene is stopped.
function later(amb, ms, fn) {
  amb.timers.push(
    setTimeout(() => {
      if (amb.live) fn();
    }, ms),
  );
}

const SCENES = {
  // Slow generative piano over a warm pad: four gentle chords, notes drifting from a pentatonic scale.
  music(ac, amb) {
    const bus = gainNode(ac, 1);
    const room = reverb(ac);
    bus.connect(gainNode(ac, 0.55)).connect(amb.out);
    bus.connect(room).connect(gainNode(ac, 0.6)).connect(amb.out);
    const chords = [
      [48, 55, 64, 71], // Cmaj7
      [45, 52, 60, 67], // Am7
      [41, 48, 57, 64], // Fmaj7
      [43, 50, 59, 62], // G
    ];
    const scale = [60, 62, 64, 67, 69, 72, 74, 76, 79];
    let bar = 0;

    const pad = (notes, t, len) => {
      const f = filter(ac, 'lowpass', 700);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 2.5);
      g.gain.setValueAtTime(0.05, t + len - 2);
      g.gain.linearRampToValueAtTime(0.0001, t + len + 1);
      f.connect(g).connect(bus);
      for (const n of notes)
        for (const detune of [-6, 6]) {
          const o = ac.createOscillator();
          o.type = 'triangle';
          o.frequency.value = midiHz(n);
          o.detune.value = detune;
          o.connect(f);
          o.start(t);
          o.stop(t + len + 1.2);
        }
    };

    const piano = (n, t, level = 0.11) => {
      const f = filter(ac, 'lowpass', 2600);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level, t + 0.008);
      g.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      f.connect(g).connect(bus);
      for (const [mult, amp] of [[1, 1], [2, 0.35], [3, 0.12], [4, 0.05]]) {
        const o = ac.createOscillator();
        o.frequency.value = midiHz(n) * mult;
        const og = gainNode(ac, amp);
        o.connect(og).connect(f);
        o.start(t);
        o.stop(t + 3.3);
      }
    };

    const nextBar = () => {
      const chord = chords[bar++ % chords.length];
      const t = ac.currentTime + 0.05;
      pad(chord, t, 8);
      piano(chord[0], t, 0.07);
      later(amb, 8000, nextBar);
    };
    const melody = () => {
      const chord = chords[(bar - 1 + chords.length) % chords.length];
      // Lean on notes that belong to the current chord so it never clashes.
      const fits = scale.filter((n) => chord.some((c) => (n - c) % 12 === 0));
      const pool = Math.random() < 0.7 && fits.length ? fits : scale;
      const t = ac.currentTime + 0.02;
      piano(pool[Math.floor(Math.random() * pool.length)], t);
      if (Math.random() < 0.25) piano(pool[Math.floor(Math.random() * pool.length)], t + 0.35, 0.07);
      later(amb, 900 + Math.random() * 2200, melody);
    };
    nextBar();
    later(amb, 1200, melody);
  },

  // Wind through leaves and birds calling back and forth.
  forest(ac, amb) {
    const wind = gainNode(ac, 0.2);
    loop(ac, amb, 'pink').connect(filter(ac, 'bandpass', 550, 0.5)).connect(wind).connect(amb.out);
    const leaves = gainNode(ac, 0.03);
    loop(ac, amb, 'white').connect(filter(ac, 'highpass', 3500)).connect(leaves).connect(amb.out);
    amb.timers.push(
      setInterval(() => {
        const t = ac.currentTime;
        const gust = 0.1 + Math.random() * 0.3;
        wind.gain.setTargetAtTime(gust, t, 0.8);
        leaves.gain.setTargetAtTime(gust * 0.15, t, 0.5);
      }, 1500),
    );
    const bird = () => {
      const t0 = ac.currentTime;
      const base = 2400 + Math.random() * 1800;
      const notes = 2 + Math.floor(Math.random() * 4);
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = Math.random() * 1.6 - 0.8;
        pan.connect(amb.out);
      }
      for (let i = 0; i < notes; i++) {
        const t = t0 + i * (0.09 + Math.random() * 0.06);
        const o = ac.createOscillator();
        o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t);
        o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), t + 0.07);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(pan || amb.out);
        o.start(t);
        o.stop(t + 0.1);
      }
      later(amb, 1500 + Math.random() * 5000, bird);
    };
    later(amb, 800, bird);
  },

  rain(ac, amb) {
    loop(ac, amb, 'pink').connect(filter(ac, 'highpass', 300)).connect(filter(ac, 'lowpass', 4500)).connect(gainNode(ac, 0.5)).connect(amb.out);
    loop(ac, amb, 'brown').connect(filter(ac, 'lowpass', 350)).connect(gainNode(ac, 0.5)).connect(amb.out);
    amb.timers.push(
      setInterval(() => {
        const t = ac.currentTime;
        for (let i = 0; i < 4; i++)
          if (Math.random() < 0.45)
            burst(ac, amb.out, t + Math.random() * 0.06, { freq: 1800 + Math.random() * 4000, q: 2.5, peak: 0.03 + Math.random() * 0.07, len: 0.02 + Math.random() * 0.05 });
      }, 60),
    );
  },

  fire(ac, amb) {
    const roar = gainNode(ac, 0.9);
    loop(ac, amb, 'brown').connect(filter(ac, 'lowpass', 260)).connect(roar).connect(amb.out);
    loop(ac, amb, 'pink').connect(filter(ac, 'bandpass', 1400, 0.6)).connect(gainNode(ac, 0.05)).connect(amb.out);
    amb.timers.push(
      setInterval(() => {
        const t = ac.currentTime;
        roar.gain.setTargetAtTime(0.6 + Math.random() * 0.6, t, 0.4); // the flames breathe
        const pops = Math.random() < 0.06 ? 3 + Math.floor(Math.random() * 6) : Math.random() < 0.3 ? 1 : 0;
        for (let i = 0; i < pops; i++)
          burst(ac, amb.out, t + Math.random() * 0.18, { type: 'highpass', freq: 900 + Math.random() * 2500, peak: 0.08 + Math.random() * 0.35, len: 0.004 + Math.random() * 0.02 });
      }, 120),
    );
  },

  cafe(ac, amb) {
    loop(ac, amb, 'brown').connect(filter(ac, 'lowpass', 220)).connect(gainNode(ac, 0.35)).connect(amb.out);
    // Murmur: a few voice-band filters whose loudness wanders, like conversations at nearby tables.
    const voices = [280, 450, 700, 1050].map((freq) => {
      const g = gainNode(ac, 0.05);
      loop(ac, amb, 'pink').connect(filter(ac, 'bandpass', freq, 2.2)).connect(g).connect(amb.out);
      return g;
    });
    amb.timers.push(
      setInterval(() => {
        const t = ac.currentTime;
        for (const g of voices) g.gain.setTargetAtTime(Math.random() < 0.25 ? 0.02 : 0.05 + Math.random() * 0.12, t, 0.12);
      }, 220),
    );
    // Now and then a cup meets a saucer.
    const clink = () => {
      const t = ac.currentTime;
      const peak = 0.015 + Math.random() * 0.03;
      for (const [ratio, level] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) {
        const o = ac.createOscillator();
        o.frequency.value = (1900 + Math.random() * 900) * ratio;
        const g = ac.createGain();
        g.gain.setValueAtTime(peak * level, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5 + Math.random() * 0.4);
        o.connect(g).connect(amb.out);
        o.start(t);
        o.stop(t + 1);
      }
      amb.timers.push(setTimeout(clink, 2500 + Math.random() * 7000));
    };
    amb.timers.push(setTimeout(clink, 1500));
  },
};

export function setAmbience(kind) {
  if ((ambience?.kind || 'off') === kind) return;
  stopAmbience();
  if (!SCENES[kind]) return;
  try {
    const ac = audio();
    const out = ac.createGain();
    out.gain.setValueAtTime(0, ac.currentTime);
    out.gain.linearRampToValueAtTime(AMBIENCE_LEVEL * ambienceVolume, ac.currentTime + 1.5);
    out.connect(ac.destination);
    ambience = { kind, out, sources: [], timers: [], live: true };
    SCENES[kind](ac, ambience);
  } catch {
    ambience = null;
  }
}

export function setAmbienceVolume(v) {
  ambienceVolume = v;
  if (!ambience) return;
  const t = ctx.currentTime;
  ambience.out.gain.cancelScheduledValues(t);
  ambience.out.gain.setTargetAtTime(AMBIENCE_LEVEL * v, t, 0.08);
}

export function stopAmbience() {
  if (!ambience) return;
  const { out, sources, timers } = ambience;
  ambience.live = false;
  ambience = null;
  timers.forEach((id) => (clearInterval(id), clearTimeout(id)));
  const t = ctx.currentTime;
  out.gain.cancelScheduledValues(t);
  out.gain.setValueAtTime(out.gain.value, t);
  out.gain.linearRampToValueAtTime(0, t + 0.6);
  setTimeout(() => {
    sources.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    out.disconnect();
  }, 700);
}
