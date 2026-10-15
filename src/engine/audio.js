// Sound: instant synthesized effects (no files needed), audio files, and simple music loops.
//
//   audio.sfx('coin')                    presets: click coin jump hit explosion powerup laser win lose
//   audio.note(440, { type: 'square' })  play one synth note (frequency in Hz, or a name like 'C4')
//   await audio.play('/assets/sounds/boom.ogg', { volume: 0.8 })   play a file (mp3/ogg/wav)
//   audio.music('/assets/music/theme.mp3')                          loop a music file
//   audio.sequence({ bpm: 110, notes: ['C4', 'E4', 'G4', null] })   loop a little synth melody
//   audio.setVolume('music', 0.3)        channels: master, sfx, music
//
// Adaptive music (layers that crossfade with the action, see musicLayers below):
//   const m = await audio.musicLayers({ calm: '/assets/music/a.ogg', intense: '/assets/music/b.ogg' })
//   m.setIntensity(0.8)   m.duck(0.3, 1.2)   m.muffle(700)   m.muffle(null)   m.stop()
//
// Browsers block sound until the player clicks or presses a key; the engine unlocks it then.
import { loadAssetBuffer } from './paths.js';

const NOTE_INDEX = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
/** 'A4' → 440, 'C#5' → 554.4 …, numbers pass through. */
export function noteToFreq(note) {
  if (typeof note === 'number') return note;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`Bad note "${note}"`);
  const semis = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

// Each preset is a list of tones: [startFreq, endFreq, duration, wave, delay?] or 'noise'.
const PRESETS = {
  click: [[900, 600, 0.05, 'square']],
  coin: [[988, 988, 0.08, 'square'], [1319, 1319, 0.25, 'square', 0.08]],
  jump: [[250, 700, 0.18, 'square']],
  hit: [['noise', 0.12], [200, 60, 0.15, 'sawtooth']],
  explosion: [['noise', 0.6], [120, 30, 0.5, 'sawtooth']],
  powerup: [[300, 900, 0.35, 'triangle'], [450, 1350, 0.35, 'square', 0.05]],
  laser: [[1400, 200, 0.2, 'sawtooth']],
  win: [[523, 523, 0.15, 'triangle'], [659, 659, 0.15, 'triangle', 0.15], [784, 784, 0.4, 'triangle', 0.3]],
  lose: [[392, 392, 0.2, 'triangle'], [330, 330, 0.2, 'triangle', 0.2], [262, 200, 0.5, 'triangle', 0.4]],
};

export function createAudio() {
  let ctx = null;
  const gains = {};
  const buffers = new Map();
  let musicSource = null;
  let sequenceTimer = null;
  let layers = null; // the running musicLayers controller
  const volumes = { master: 0.8, sfx: 0.8, music: 0.5 };

  const init = () => {
    if (ctx) return ctx;
    ctx = new AudioContext();
    gains.master = ctx.createGain();
    gains.master.connect(ctx.destination);
    for (const ch of ['sfx', 'music']) {
      gains[ch] = ctx.createGain();
      gains[ch].connect(gains.master);
    }
    for (const ch in volumes) gains[ch].gain.value = volumes[ch];
    return ctx;
  };

  const unlock = () => init().state === 'suspended' && ctx.resume();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const tone = (from, to, duration, type = 'sine', { delay = 0, volume = 0.3, channel = 'sfx' } = {}) => {
    init();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(noteToFreq(from), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, noteToFreq(to)), t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(gains[channel]);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  };

  const noise = (duration, { delay = 0, volume = 0.3 } = {}) => {
    init();
    const t = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ctx.createBufferSource();
    const env = ctx.createGain();
    env.gain.value = volume;
    src.buffer = buffer;
    src.connect(env).connect(gains.sfx);
    src.start(t);
  };

  const loadBuffer = async (url) => {
    init();
    if (!buffers.has(url))
      buffers.set(
        url,
        loadAssetBuffer(url) // paths.js: works under a sub-path and in the single-file build
          .then((b) => ctx.decodeAudioData(b))
          .catch((err) => {
            buffers.delete(url);
            throw new Error(`Could not load sound "${url}" (${err.message})`);
          }),
      );
    return buffers.get(url);
  };

  return {
    get context() {
      return init();
    },
    sfx(name, { volume = 0.3, pitch = 1 } = {}) {
      const preset = PRESETS[name];
      if (!preset) throw new Error(`No sfx "${name}". Presets: ${Object.keys(PRESETS).join(', ')}`);
      for (const [a, b, c, d, delay = 0] of preset) {
        if (a === 'noise') noise(b, { volume });
        else tone(a * pitch, b * pitch, c, d, { delay, volume });
      }
    },
    presets: Object.keys(PRESETS),
    note(note, { type = 'triangle', duration = 0.3, delay = 0, volume = 0.25, channel = 'sfx' } = {}) {
      tone(note, note, duration, type, { delay, volume, channel });
    },
    preload: (...urls) => Promise.all(urls.map(loadBuffer)),
    async play(url, { volume = 1, loop = false, rate = 1, channel = 'sfx' } = {}) {
      const buffer = await loadBuffer(url);
      const src = ctx.createBufferSource();
      const env = ctx.createGain();
      src.buffer = buffer;
      src.loop = loop;
      src.playbackRate.value = rate;
      env.gain.value = volume;
      src.connect(env).connect(gains[channel]);
      src.start();
      return { stop: () => src.stop(), source: src };
    },
    /**
     * Several looping tracks that play together; you set how loud each one is. Each track loops with a
     * crossfade of `xfade` seconds (no clicks or gaps at the seam). Starts with the first layer audible.
     * Returns { setIntensity(x, seconds), mix({ name: level }, seconds), duck(depth, hold), muffle(hz|null, s), stop(fade) }.
     * setIntensity(0..1) fades from the first layer (0) to the last (1), equal-power.
     */
    async musicLayers(tracks, { volume = 1, xfade = 3, fadeIn = 2 } = {}) {
      this.stopMusic();
      init();
      const names = Object.keys(tracks);
      const buffers = await Promise.all(names.map((n) => loadBuffer(tracks[n])));
      const out = ctx.createGain(); // volume
      const duck = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = 0.5;
      out.gain.setValueAtTime(0.0001, ctx.currentTime);
      out.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + fadeIn);
      filter.connect(duck).connect(out).connect(gains.music);
      const timers = [];
      const ramp = (param, value, seconds) => {
        const t = ctx.currentTime;
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(value, t + Math.max(0.01, seconds));
      };
      const level = {};
      const nodes = names.map((name, k) => {
        const g = ctx.createGain();
        g.gain.value = level[name] = k === 0 ? 1 : 0;
        g.connect(filter);
        // crossfaded loop: each copy fades in while the previous one fades out
        const buf = buffers[k];
        const len = buf.duration;
        const fade = Math.min(xfade, len / 4);
        let at = ctx.currentTime + 0.05;
        const schedule = () => {
          while (at < ctx.currentTime + 6) {
            const src = ctx.createBufferSource();
            const env = ctx.createGain();
            src.buffer = buf;
            src.connect(env).connect(g);
            env.gain.setValueAtTime(0, at);
            env.gain.linearRampToValueAtTime(1, at + fade);
            env.gain.setValueAtTime(1, at + len - fade);
            env.gain.linearRampToValueAtTime(0, at + len);
            src.start(at);
            src.stop(at + len + 0.05);
            at += len - fade;
          }
          timers[k] = setTimeout(schedule, 2000);
        };
        schedule();
        return g;
      });
      const ctl = {
        names,
        get levels() {
          return { ...level };
        },
        mix(levels, seconds = 2) {
          names.forEach((n, k) => n in levels && ramp(nodes[k].gain, (level[n] = levels[n]), seconds));
        },
        setIntensity(x, seconds = 3) {
          const t = Math.min(1, Math.max(0, x)) * (names.length - 1);
          const levels = {};
          names.forEach((n, k) => {
            const d = Math.abs(t - k);
            levels[n] = d >= 1 ? 0 : Math.cos((d * Math.PI) / 2); // equal power between neighbours
          });
          ctl.mix(levels, seconds);
        },
        /** Dip the music to `depth` (0..1 of its level) for `hold` seconds, then recover: big moments read clearer. */
        duck(depth = 0.35, hold = 0.8, { attack = 0.08, release = 1.2 } = {}) {
          const t = ctx.currentTime;
          duck.gain.cancelScheduledValues(t);
          duck.gain.setValueAtTime(duck.gain.value, t);
          duck.gain.linearRampToValueAtTime(depth, t + attack);
          duck.gain.setValueAtTime(depth, t + attack + hold);
          duck.gain.linearRampToValueAtTime(1, t + attack + hold + release);
        },
        /** Low-pass the music (menus, pause: it sounds far away). null opens it back up. */
        muffle(hz = 800, seconds = 1) {
          const t = ctx.currentTime;
          filter.frequency.cancelScheduledValues(t);
          filter.frequency.setValueAtTime(filter.frequency.value, t);
          filter.frequency.exponentialRampToValueAtTime(hz ?? 20000, t + Math.max(0.01, seconds));
        },
        setVolume(v, seconds = 0.3) {
          ramp(out.gain, v, seconds);
        },
        stop(fade = 0.6) {
          timers.forEach(clearTimeout);
          const t = ctx.currentTime;
          out.gain.cancelScheduledValues(t);
          out.gain.setValueAtTime(out.gain.value, t);
          out.gain.linearRampToValueAtTime(0, t + fade);
          setTimeout(() => out.disconnect(), fade * 1000 + 100);
          if (layers === ctl) layers = null;
        },
      };
      layers = ctl;
      return ctl;
    },
    /** The running musicLayers controller, or null. */
    get layers() {
      return layers;
    },
    async music(url, { volume = 1 } = {}) {
      this.stopMusic();
      musicSource = await this.play(url, { volume, loop: true, channel: 'music' });
      return musicSource;
    },
    /** Loop a melody. notes: note names / Hz, or null for a rest. One note per step (steps = 1/8 notes by default). */
    sequence({ bpm = 120, notes, type = 'square', stepsPerBeat = 2, volume = 0.12, length } = {}) {
      this.stopMusic();
      let step = 0;
      const stepMs = 60000 / bpm / stepsPerBeat;
      sequenceTimer = setInterval(() => {
        const n = notes[step++ % notes.length];
        if (n !== null && n !== undefined) tone(n, n, length ?? stepMs / 1000, type, { volume, channel: 'music' });
      }, stepMs);
    },
    stopMusic() {
      musicSource?.stop();
      musicSource = null;
      layers?.stop();
      clearInterval(sequenceTimer);
    },
    setVolume(channel, v) {
      volumes[channel] = v;
      if (gains[channel]) gains[channel].gain.value = v;
    },
    getVolume: (channel) => volumes[channel],
  };
}
