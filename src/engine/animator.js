// Animation state machine for glTF characters (an upgrade of assets.animate()).
// You ask for *states* ('idle', 'run', 'jump'); it finds the matching clip, cross-fades,
// plays one-shots on top and returns to what was playing before.
//
//   const robot = await assets.model('/assets/models/RobotExpressive.glb');
//   const anim = animator(robot, { engine });          // engine: updates itself every frame
//   anim.play('idle')                                  // finds 'Idle' (also 'idle', 'CharacterArmature|Idle' …)
//   anim.play('run', { fade: 0.2, speed: 1.2 })        // cross-fade to a looping state
//   anim.locomotion(speed)                             // call every frame: blends idle → walk → run by speed
//   await anim.once('attack')                          // plays 'Punch' once, then back to the previous state
//   anim.once('death', { hold: true })                 // stay on the last frame
//   anim.cancel()                                      // stop a one-shot early (e.g. land during a jump)
//   anim.has('fall') / anim.clipFor('run') / anim.names / anim.state
//
// Options: map (state → clip name, e.g. { run: 'Sprint_Fast' }), fade (default 0.2 s),
// walkSpeed / runSpeed (world units per second at which the walk / run clips look right),
// engine (auto-update) — without it, call anim.update(dt) yourself.
// Same play/once/names/mixer/dispose as assets.animate(), so you can swap one for the other.
import * as THREE from 'three';

// State name → words that clips for it are often called (Mixamo, Quaternius, KayKit, Kenney…).
const SYNONYMS = {
  idle: ['idle', 'breathing', 'stand', 'standing'],
  walk: ['walk', 'walking'],
  run: ['run', 'running', 'sprint', 'jog', 'jogging'],
  jump: ['jump', 'jumping', 'jumpstart'],
  fall: ['fall', 'falling', 'jumpidle', 'jumploop', 'inair', 'airborne'],
  land: ['land', 'landing', 'jumpland'],
  attack: ['attack', 'punch', 'slash', 'swing', 'shoot', 'kick'],
  hurt: ['hurt', 'hit', 'hitreact', 'receivehit', 'damage'],
  death: ['death', 'die', 'dead', 'dying'],
  sit: ['sit', 'sitting', 'drive', 'driving'],
  crouch: ['crouch', 'crouching', 'sneak'],
  wave: ['wave', 'waving', 'hello'],
  dance: ['dance', 'dancing', 'victory', 'cheer'],
};

/** 'CharacterArmature|Run_Fast' → 'runfast'. */
export const normalizeClipName = (name) => name.split('|').pop().toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Best clip in `names` for the state or clip name `wanted`, or null.
 * Tries exact name, then exact/prefix/contains matches of the state and its synonyms; shortest name wins ties.
 */
export function matchClip(names, wanted) {
  if (!wanted) return null;
  if (names.includes(wanted)) return wanted;
  const want = normalizeClipName(wanted);
  const group = Object.entries(SYNONYMS).find(([state, words]) => state === want || words.includes(want));
  const words = [want, ...(group ? [group[0], ...group[1]] : [])];
  const clips = names.map((n) => ({ n, k: normalizeClipName(n) })).sort((a, b) => a.k.length - b.k.length);
  const tests = [(k, w) => k === w, (k, w) => w.length >= 3 && k.startsWith(w), (k, w) => w.length >= 3 && k.includes(w)];
  for (const test of tests) for (const w of words) for (const { n, k } of clips) if (test(k, w)) return n;
  return null;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** How much of idle / walk / run to show at a given speed, and how fast to play walk and run so feet don't slide. */
export function locomotionWeights(speed, { walkSpeed = 2, runSpeed = 5 } = {}) {
  const idle = 1 - clamp01(speed / (walkSpeed * 0.5));
  const run = clamp01((speed - walkSpeed) / Math.max(0.01, runSpeed - walkSpeed));
  return {
    idle,
    walk: (1 - idle) * (1 - run),
    run: (1 - idle) * run,
    walkScale: Math.min(1.6, Math.max(0.6, speed / walkSpeed)),
    runScale: Math.min(1.6, Math.max(0.7, speed / runSpeed)),
  };
}

/** Move `current` towards `target` by at most `step`. */
export const approach = (current, target, step) => (current < target ? Math.min(target, current + step) : Math.max(target, current - step));

/**
 * The pure state logic: one looping "base" state, optionally covered by a one-shot.
 * When the one-shot ends (unless held) the base state shows again.
 */
export function createAnimState(initial = null) {
  let base = initial;
  let shot = null; // { state, hold }
  return {
    get base() {
      return base;
    },
    get shot() {
      return shot?.state ?? null;
    },
    get current() {
      return shot?.state ?? base;
    },
    setBase(state) {
      base = state;
    },
    startShot(state, hold = false) {
      shot = { state, hold };
    },
    /** The one-shot's clip finished: return to base unless it should hold its last frame. */
    finishShot(state) {
      if (shot?.state === state && !shot.hold) shot = null;
    },
    /** Stop the one-shot now (only if it is `state`, when given). Returns true if something was cancelled. */
    cancel(state) {
      if (!shot || (state && shot.state !== state)) return false;
      shot = null;
      return true;
    },
  };
}

export function animator(model, clips, opts = {}) {
  if (!Array.isArray(clips)) [clips, opts] = [model.animations ?? [], clips ?? {}];
  const { map = {}, fade: defaultFade = 0.2, walkSpeed = 2, runSpeed = 5, engine } = opts;
  const mixer = new THREE.AnimationMixer(model.scene ?? model);
  const names = clips.map((c) => c.name);
  const byName = new Map(clips.map((c) => [c.name, c]));
  const sm = createAnimState();
  const slots = new Map(); // clip name → { action, weight }
  const resolved = new Map();
  const warned = new Set();
  const waiting = new Map(); // clip name → resolve() of the once() promise
  let fade = defaultFade;
  let speedScale = 1;
  let loco = null; // { speed } while locomotion() drives the base state

  const clipFor = (state) => {
    if (!resolved.has(state)) resolved.set(state, matchClip(names, map[state] ?? state));
    return resolved.get(state);
  };
  const slot = (clipName) => {
    if (!slots.has(clipName)) {
      const action = mixer.clipAction(byName.get(clipName));
      action.setEffectiveWeight(0);
      slots.set(clipName, { action, weight: 0 });
    }
    return slots.get(clipName);
  };
  const missing = (state) => {
    if (!warned.has(state)) console.warn(`animator: no clip for "${state}". Clips: ${names.join(', ')}`);
    warned.add(state);
  };

  mixer.addEventListener('finished', (e) => {
    for (const [clipName, resolve] of waiting)
      if (slots.get(clipName)?.action === e.action) {
        waiting.delete(clipName);
        const state = sm.shot;
        if (state && clipFor(state) === clipName) sm.finishShot(state);
        resolve(true);
      }
  });

  // Which clips should be visible right now, and how much.
  const targets = () => {
    const t = new Map();
    const add = (state, w, scale = 1) => {
      const c = clipFor(state);
      if (!c || w <= 0) return;
      t.set(c, (t.get(c) ?? 0) + w);
      slot(c).action.timeScale = scale * speedScale;
    };
    if (sm.shot) add(sm.shot, 1, slot(clipFor(sm.shot)).action.timeScale / speedScale);
    else if (loco) {
      const w = locomotionWeights(loco.speed, { walkSpeed, runSpeed });
      // Missing walk or run clip? Use the other one.
      const walk = clipFor('walk') ? 'walk' : 'run';
      const run = clipFor('run') ? 'run' : 'walk';
      add('idle', w.idle);
      add(walk, w.walk, walk === 'walk' ? w.walkScale : w.runScale);
      add(run, w.run, run === 'run' ? w.runScale : w.walkScale);
    } else if (sm.base) add(sm.base, 1, slot(clipFor(sm.base)).action.timeScale / speedScale);
    return t;
  };

  const api = {
    mixer,
    names,
    clipFor,
    has: (state) => !!clipFor(state),
    get state() {
      return sm.current;
    },
    get oneShot() {
      return sm.shot;
    },
    /** Global playback speed (slow motion, hurry-up…). */
    get timeScale() {
      return speedScale;
    },
    set timeScale(v) {
      speedScale = v;
    },

    /** Cross-fade to a looping state. During a one-shot this only changes what comes back afterwards. */
    play(state, { fade: f = defaultFade, speed = 1 } = {}) {
      const c = clipFor(state);
      if (!c) return missing(state);
      loco = null;
      const s = slot(c);
      if (sm.base !== state || !s.action.isRunning()) {
        s.action.setLoop(THREE.LoopRepeat, Infinity);
        s.action.clampWhenFinished = false;
        if (!s.action.isRunning()) s.action.reset().play();
      }
      s.action.timeScale = speed * speedScale;
      sm.setBase(state);
      fade = f;
      return s.action;
    },

    /** Blend idle / walk / run by speed (world units per second). Call every frame. */
    locomotion(speed, { fade: f = defaultFade } = {}) {
      if (!loco) fade = f;
      loco = { speed };
      sm.setBase('move');
    },

    /** Play a state once on top of everything. Resolves true when it finishes, false if interrupted. */
    once(state, { fade: f = 0.1, speed = 1, hold = false } = {}) {
      const c = clipFor(state);
      if (!c) {
        missing(state);
        return Promise.resolve(false);
      }
      for (const [, resolve] of waiting) resolve(false);
      waiting.clear();
      const { action } = slot(c);
      action.reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = speed * speedScale;
      action.play();
      sm.startShot(state, hold);
      fade = f;
      return new Promise((resolve) => waiting.set(c, resolve));
    },

    /** End a one-shot early (only if it is `state`, when given) and fade back to the base state. */
    cancel(state, { fade: f = 0.15 } = {}) {
      if (!sm.cancel(state)) return false;
      fade = f;
      for (const [, resolve] of waiting) resolve(false);
      waiting.clear();
      return true;
    },

    update(dt) {
      const t = targets();
      const step = fade > 0 ? dt / fade : 1;
      for (const [clipName, s] of slots) {
        const target = t.get(clipName) ?? 0;
        s.weight = approach(s.weight, Math.min(1, target), step);
        if (target > 0 && !s.action.isRunning() && s.action.loop !== THREE.LoopOnce) s.action.reset().play();
        s.action.setEffectiveWeight(s.weight);
        // Fully faded-out loops can stop; one-shots stay so they keep their clamped last frame.
        if (s.weight === 0 && target === 0 && s.action.loop !== THREE.LoopOnce) s.action.stop();
      }
      mixer.update(dt);
    },

    dispose() {
      stop?.();
      mixer.stopAllAction();
    },
  };

  const stop = engine?.onUpdate((dt) => api.update(dt));
  api.auto = !!engine; // controllers call update() themselves only when this is false
  return api;
}
