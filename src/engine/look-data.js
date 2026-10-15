// The data behind engine.look: presets, palettes, quality levels and the small pure helpers
// that combine them. No Three.js or DOM here, so it is unit tested (tests/engine/look.test.js).
//
//   PRESETS.sunset            the settings one look.preset('sunset') applies
//   palette('candy')          5 colours that go together, dark → light where it makes sense
//   mergeLook(a, b)           deep-merge settings; `false` turns an effect off
//   QUALITY.low               what each quality level allows (pixel ratio, AO, AA, shadow map)
//   createQualityGovernor()   watches frame times and says when to step quality down
//   random(seed)              seeded random numbers, so scattered scenes look the same every load
//   scatterPoints({...})      where to put scattered things (positions, rotations, scales)

// ---------- palettes ----------
// Curated so any colour works next to any other. Use [0] for dark accents/ground shadows,
// the middle ones for objects, [4] for highlights.
export const PALETTES = {
  meadow: ['#2f5d3a', '#6a9f4b', '#c9d86b', '#f4c95d', '#f08a4b'],
  candy: ['#6c5ce7', '#ff6b9d', '#ffc2d4', '#7ae7c7', '#ffe066'],
  sunset: ['#2b1b3d', '#6b2d5c', '#d1495b', '#f79256', '#fbd1a2'],
  ocean: ['#03256c', '#2541b2', '#1768ac', '#06bee1', '#e0fbfc'],
  forest: ['#1b2f23', '#2f5233', '#5c8d50', '#a3b18a', '#e9d8a6'],
  neon: ['#0b0221', '#ff2a6d', '#05d9e8', '#d1f7ff', '#f5d300'],
  desert: ['#6b4226', '#c97b3a', '#e8b86d', '#f2deb0', '#4f8a8b'],
  space: ['#0b0c2a', '#2e1a5e', '#7b2cbf', '#c77dff', '#ffd6ff'],
  toybox: ['#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#e63946'],
  pastel: ['#a2d2ff', '#bde0fe', '#ffafcc', '#ffc8dd', '#cdb4db'],
  autumn: ['#582f0e', '#936639', '#c2501f', '#e9a03b', '#f6e7cb'],
  ice: ['#0d1b2a', '#415a77', '#778da9', '#c8d9e6', '#f0f8ff'],
  lava: ['#1a0a0a', '#5c1a1b', '#c1121f', '#ff7b00', '#ffd000'],
  mono: ['#16161a', '#45454d', '#8a8a94', '#c9c9d1', '#f4f4f6'],
};

/** A copy of a named palette (so editing it can't change the original). */
export function palette(name) {
  const p = PALETTES[name];
  if (!p) throw new Error(`No palette "${name}". Try one of: ${Object.keys(PALETTES).join(', ')}`);
  return [...p];
}

// ---------- presets ----------
// Every key is optional; look.set() takes the same shape. Colours are CSS strings.
//   sky:   { top, horizon, bottom, sun (glow size 0..1), stars (count), nebula (0..1) } or a colour string (flat)
//   env:   'sky' (lighting from the sky colours) | 'room' (neutral studio) | '/assets/hdri/x.hdr' | false
//   sun:   { color, intensity, elevation°, azimuth°, softness (shadow blur), shadowSize }
//   rim:   back light that outlines silhouettes { color, intensity } (no shadows, cheap)
//   hemi:  { sky, ground, intensity } ambient fill; shadows take this colour
//   fog:   { color (default sky horizon), near, far } or false
//   bloom: { strength, radius, threshold } or false. Only things brighter than threshold glow.
//   ao:    { intensity, radius } ambient occlusion (darkens creases/contact) or false
//   grade: { saturation, contrast, brightness, tint, tintAmount, shadows } colour grading
//   vignette 0..1, grain 0..1, aberration 0..1, tiltShift 0..1 (diorama blur at top/bottom)
//   exposure, toneMapping: 'aces' | 'agx' | 'neutral' | 'none'
//   materials: 'toon' swaps every standard material for a cel-shaded one (false restores)
const BASE = {
  sky: { top: '#3f86d9', horizon: '#bfe0f7', bottom: '#7f9fba', sun: 0.4, stars: 0, nebula: 0 },
  env: 'sky',
  envIntensity: 0.35,
  sun: { color: '#fff1d6', intensity: 3.2, elevation: 50, azimuth: 35, softness: 3, shadowSize: 20 },
  rim: { color: '#9ec5ff', intensity: 0.5 },
  hemi: { sky: '#bcd4ff', ground: '#4a3f35', intensity: 0.4 },
  fog: { near: 30, far: 90 },
  bloom: { strength: 0.35, radius: 0.5, threshold: 1 },
  ao: { intensity: 1, radius: 0.5 },
  grade: { saturation: 1.15, contrast: 1.08, brightness: 0, tint: '#ffffff', tintAmount: 0, shadows: '#000000' },
  vignette: 0.25,
  grain: 0,
  aberration: 0,
  tiltShift: 0,
  exposure: 1,
  toneMapping: 'aces',
  materials: 'standard',
};

export const PRESETS = {
  sunny: {},
  sunset: {
    sky: { top: '#3b2c66', horizon: '#ff9a62', bottom: '#5b3a5e', sun: 0.9 },
    envIntensity: 0.8,
    sun: { color: '#ffb36b', intensity: 3.2, elevation: 14, azimuth: -60, softness: 4 },
    rim: { color: '#ff7aa8', intensity: 1.2 },
    hemi: { sky: '#8f7bd6', ground: '#5a2e3a', intensity: 0.9 },
    fog: { near: 25, far: 85 },
    bloom: { strength: 0.6, radius: 0.6, threshold: 0.9 },
    grade: { saturation: 1.12, contrast: 1.08, tint: '#ffd2a8', tintAmount: 0.15, shadows: '#3a1a4a' },
    vignette: 0.35,
  },
  night: {
    sky: { top: '#060a1f', horizon: '#1d2f5a', bottom: '#0a1024', sun: 0.15, stars: 1500 },
    envIntensity: 0.5,
    sun: { color: '#9db8ff', intensity: 1.3, elevation: 45, azimuth: 130, softness: 5 },
    rim: { color: '#6f8cff', intensity: 0.8 },
    hemi: { sky: '#3a4f8f', ground: '#141a2e', intensity: 0.7 },
    fog: { near: 18, far: 70 },
    bloom: { strength: 0.9, radius: 0.6, threshold: 0.6 },
    grade: { saturation: 1.05, contrast: 1.1, tint: '#a9c1ff', tintAmount: 0.2, shadows: '#0c1640' },
    vignette: 0.45,
    exposure: 1.1,
  },
  neon: {
    sky: { top: '#0b0221', horizon: '#3d0a52', bottom: '#12041f', sun: 0, stars: 400 },
    envIntensity: 0.6,
    sun: { color: '#b48cff', intensity: 1.2, elevation: 60, azimuth: 20, softness: 3 },
    rim: { color: '#05d9e8', intensity: 2.2 },
    hemi: { sky: '#ff2a6d', ground: '#1a0633', intensity: 0.35 },
    fog: { near: 15, far: 60 },
    bloom: { strength: 1.1, radius: 0.55, threshold: 0.45 },
    grade: { saturation: 1.25, contrast: 1.18, tint: '#ff9be0', tintAmount: 0.15, shadows: '#2a0a4a' },
    vignette: 0.5,
    aberration: 0.35,
    toneMapping: 'agx',
    exposure: 1.2,
  },
  space: {
    sky: { top: '#02010a', horizon: '#160b33', bottom: '#02010a', sun: 0.25, stars: 3000, nebula: 0.8 },
    env: 'room',
    envIntensity: 0.25,
    sun: { color: '#fff4e0', intensity: 3.2, elevation: 30, azimuth: 70, softness: 1.5 },
    rim: { color: '#c77dff', intensity: 1.6 },
    hemi: { sky: '#3b2a7a', ground: '#05030f', intensity: 0.35 },
    fog: false,
    bloom: { strength: 0.7, radius: 0.5, threshold: 1 },
    grade: { saturation: 1.15, contrast: 1.15, shadows: '#120630' },
    vignette: 0.45,
  },
  toon: {
    sky: { top: '#4fb3ff', horizon: '#d6f1ff', bottom: '#9fd3ff', sun: 0.5 },
    env: 'room',
    envIntensity: 0.35,
    sun: { color: '#ffffff', intensity: 2.8, elevation: 55, azimuth: 40, softness: 1 },
    hemi: { sky: '#d8ecff', ground: '#8a6f9e', intensity: 1.1 },
    fog: { near: 40, far: 110 },
    bloom: { strength: 0.25, radius: 0.4, threshold: 1.1 },
    ao: false,
    grade: { saturation: 1.3, contrast: 1.05, shadows: '#2a2060' },
    vignette: 0.15,
    toneMapping: 'neutral',
    materials: 'toon',
  },
  studio: {
    sky: { top: '#d9dde4', horizon: '#eef0f3', bottom: '#c9ccd2', sun: 0 },
    env: 'room',
    envIntensity: 0.7,
    sun: { color: '#ffffff', intensity: 1.8, elevation: 60, azimuth: 30, softness: 8 },
    hemi: { sky: '#ffffff', ground: '#9a9aa5', intensity: 0.35 },
    fog: { near: 30, far: 120 },
    bloom: { strength: 0.15, radius: 0.4, threshold: 1.6 },
    ao: { intensity: 1.4, radius: 0.6 },
    grade: { saturation: 1.02, contrast: 1.04 },
    vignette: 0.2,
    toneMapping: 'neutral',
  },
  'fog-forest': {
    sky: { top: '#6f8a7c', horizon: '#c3cfb4', bottom: '#5d6e5a', sun: 0.6 },
    envIntensity: 0.55,
    sun: { color: '#ffe2a8', intensity: 2.2, elevation: 28, azimuth: -30, softness: 6 },
    rim: { color: '#ffd59a', intensity: 0.6 },
    hemi: { sky: '#cfe0c0', ground: '#2e3a26', intensity: 0.7 },
    fog: { near: 14, far: 60 },
    bloom: { strength: 0.45, radius: 0.7, threshold: 0.9 },
    grade: { saturation: 1, contrast: 1.12, tint: '#e6f0c8', tintAmount: 0.2, shadows: '#16301f' },
    vignette: 0.4,
    tiltShift: 0.25,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep merge for look settings: objects merge key by key, anything else replaces.
 * `false` replaces too (that is how an effect is switched off), and turning a `false`
 * back on with an object starts from `defaults[key]` so missing values get sane numbers.
 */
export function mergeLook(a, b, defaults = BASE) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b ?? {})) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      const start = isPlainObject(a?.[key]) ? a[key] : isPlainObject(defaults?.[key]) ? defaults[key] : {};
      out[key] = mergeLook(start, value, defaults?.[key]);
    } else out[key] = value;
  }
  return out;
}

/** The full settings for a preset name (always a complete, fresh object). */
export function resolvePreset(name) {
  if (!PRESETS[name]) throw new Error(`No look preset "${name}". Try one of: ${PRESET_NAMES.join(', ')}`);
  return mergeLook(BASE, PRESETS[name]);
}

// ---------- quality ----------
// What each level may spend. 'auto' starts at high and steps down while the frame rate is low.
export const QUALITY_LEVELS = ['low', 'medium', 'high'];
export const QUALITY = {
  low: { pixelRatio: 1, ao: 0, aa: 'fxaa', msaa: 0, shadowMap: 1024, stars: 0.5 },
  medium: { pixelRatio: 1.5, ao: 0.5, aa: 'smaa', msaa: 0, shadowMap: 2048, stars: 1 }, // ao 0.5 = half resolution
  high: { pixelRatio: 2, ao: 1, aa: 'msaa', msaa: 4, shadowMap: 2048, stars: 1 },
};

/** One level lower, or null at the bottom. */
export const lowerQuality = (level) => QUALITY_LEVELS[QUALITY_LEVELS.indexOf(level) - 1] ?? null;

/**
 * Watches real frame times. Every `window` seconds it averages the FPS; if that is below
 * `minFps` it returns the next lower level (once per call). Windows containing a long
 * hitch (loading, tab switch) are thrown away so they don't punish the quality.
 */
export function createQualityGovernor({ start = 'high', minFps = 45, window = 2, warmup = 1.5, hitch = 0.25 } = {}) {
  let level = start;
  let elapsed = -warmup;
  let frames = 0;
  let hitched = false;
  return {
    get level() {
      return level;
    },
    /** Feed the unclamped frame time in seconds. Returns the new level when it changes, else null. */
    sample(dt) {
      if (dt > hitch) hitched = true;
      elapsed += dt;
      if (elapsed <= 0) return null; // warming up
      frames++;
      if (elapsed < window) return null;
      const fps = frames / elapsed;
      const bad = !hitched && fps < minFps;
      elapsed = 0;
      frames = 0;
      hitched = false;
      const lower = bad ? lowerQuality(level) : null;
      if (lower) level = lower;
      return lower;
    },
  };
}

// ---------- scatter ----------
/** Small fast seeded random generator (mulberry32). Returns () => number in [0, 1). */
export function random(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Positions for scattered things.
 *   area: number = circle radius | [width, depth] = rectangle | { inner, outer } = ring
 *   center: [x, z], scale: [min, max], minDistance: keep things apart (tries a few times)
 * Returns [{ x, z, rotation, scale }].
 */
export function scatterPoints({ count = 50, area = 10, center = [0, 0], scale = [0.8, 1.2], seed = 1, minDistance = 0 } = {}) {
  const rand = random(seed);
  const [cx, cz] = center;
  const pick = () => {
    if (Array.isArray(area)) return [(rand() - 0.5) * area[0], (rand() - 0.5) * area[1]];
    const inner = typeof area === 'number' ? 0 : area.inner ?? 0;
    const outer = typeof area === 'number' ? area : area.outer;
    // sqrt keeps the density even across the disc instead of bunching at the centre
    const r = Math.sqrt(inner * inner + rand() * (outer * outer - inner * inner));
    const a = rand() * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const points = [];
  const min2 = minDistance * minDistance;
  for (let i = 0; i < count; i++) {
    let p = pick();
    for (let tries = 0; min2 > 0 && tries < 12 && points.some((q) => (q.x - cx - p[0]) ** 2 + (q.z - cz - p[1]) ** 2 < min2); tries++) p = pick();
    const [smin, smax] = Array.isArray(scale) ? scale : [scale, scale];
    points.push({ x: cx + p[0], z: cz + p[1], rotation: rand() * Math.PI * 2, scale: smin + rand() * (smax - smin) });
  }
  return points;
}

export { BASE as LOOK_DEFAULTS };
