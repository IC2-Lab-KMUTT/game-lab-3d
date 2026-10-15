// Tests for the pure parts of engine.look (src/engine/look-data.js): palettes, preset merging,
// quality stepping and seeded scattering.
import { describe, expect, it } from 'vitest';
import {
  PALETTES, PRESETS, PRESET_NAMES, QUALITY, QUALITY_LEVELS, palette, mergeLook, resolvePreset,
  lowerQuality, createQualityGovernor, random, scatterPoints,
} from '../../src/engine/look-data.js';

const HEX = /^#[0-9a-f]{6}$/i;

describe('palettes', () => {
  it('every palette has 5 valid hex colours', () => {
    for (const [name, p] of Object.entries(PALETTES)) {
      expect(p, name).toHaveLength(5);
      for (const c of p) expect(c, name).toMatch(HEX);
    }
  });
  it('palette() returns a copy and explains unknown names', () => {
    const p = palette('candy');
    p[0] = 'oops';
    expect(palette('candy')[0]).toMatch(HEX);
    expect(() => palette('nope')).toThrow(/candy/);
  });
});

describe('presets', () => {
  it('has the documented presets', () => {
    for (const n of ['sunny', 'sunset', 'night', 'neon', 'space', 'toon', 'studio', 'fog-forest']) expect(PRESET_NAMES).toContain(n);
  });
  it('resolvePreset fills in every key from the defaults', () => {
    for (const n of PRESET_NAMES) {
      const p = resolvePreset(n);
      expect(p.sun.intensity, n).toBeGreaterThan(0);
      expect(p.sky.top, n).toMatch(HEX);
      expect(typeof p.exposure, n).toBe('number');
    }
    expect(resolvePreset('sunset').sun.softness).toBe(PRESETS.sunset.sun.softness);
    expect(resolvePreset('sunset').sun.shadowSize).toBe(20); // not in the preset → default
    expect(() => resolvePreset('nope')).toThrow(/sunny/);
  });
  it('resolvePreset returns fresh objects', () => {
    resolvePreset('night').sun.color = '#000000';
    expect(resolvePreset('night').sun.color).not.toBe('#000000');
  });
});

describe('mergeLook', () => {
  it('merges nested objects and replaces values', () => {
    const m = mergeLook({ sun: { color: '#fff', intensity: 2 }, vignette: 0.2 }, { sun: { intensity: 3 }, vignette: 0.5 });
    expect(m).toEqual({ sun: { color: '#fff', intensity: 3 }, vignette: 0.5 });
  });
  it('false switches an effect off, an object switches it back on with defaults', () => {
    const off = mergeLook(resolvePreset('sunny'), { bloom: false });
    expect(off.bloom).toBe(false);
    const on = mergeLook(off, { bloom: { strength: 2 } });
    expect(on.bloom.strength).toBe(2);
    expect(on.bloom.threshold).toBeTypeOf('number'); // came from the defaults
  });
  it('ignores undefined and does not mutate its inputs', () => {
    const a = { grade: { saturation: 1 } };
    const m = mergeLook(a, { grade: { contrast: 2 }, fog: undefined });
    expect(a.grade).toEqual({ saturation: 1 });
    expect('fog' in m).toBe(false);
  });
});

describe('quality', () => {
  it('levels get cheaper going down', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high']);
    expect(QUALITY.low.ao).toBe(0); // no ambient occlusion on low
    expect(QUALITY.low.pixelRatio).toBeLessThan(QUALITY.high.pixelRatio);
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('low')).toBeNull();
  });
  const run = (gov, fps, seconds) => {
    const changes = [];
    for (let t = 0; t < seconds; t += 1 / fps) {
      const c = gov.sample(1 / fps);
      if (c) changes.push(c);
    }
    return changes;
  };
  it('steps down while slow, never below low', () => {
    const gov = createQualityGovernor({ start: 'high', minFps: 45, window: 2, warmup: 1 });
    expect(run(gov, 20, 12)).toEqual(['medium', 'low']);
    expect(gov.level).toBe('low');
  });
  it('stays put when fast enough', () => {
    const gov = createQualityGovernor({ start: 'high' });
    expect(run(gov, 60, 10)).toEqual([]);
  });
  it('ignores windows with a long hitch (loading, tab switch)', () => {
    const gov = createQualityGovernor({ start: 'high', window: 2, warmup: 0 });
    gov.sample(1.5); // one huge frame, would read as < 45 fps
    for (let i = 0; i < 30; i++) expect(gov.sample(1 / 60)).toBeNull();
    expect(gov.level).toBe('high');
  });
});

describe('scatter', () => {
  it('random() is deterministic per seed', () => {
    const a = random(5), b = random(5), c = random(6);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
  it('places points inside circles, rings and rectangles', () => {
    for (const p of scatterPoints({ count: 200, area: 5, center: [10, -3] })) expect(Math.hypot(p.x - 10, p.z + 3)).toBeLessThanOrEqual(5);
    for (const p of scatterPoints({ count: 200, area: { inner: 3, outer: 4 } })) {
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(r).toBeLessThanOrEqual(4);
    }
    for (const p of scatterPoints({ count: 200, area: [4, 2] })) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
    }
  });
  it('respects the scale range, the seed and minDistance', () => {
    const pts = scatterPoints({ count: 50, area: 20, scale: [0.5, 2], seed: 3, minDistance: 2 });
    for (const p of pts) expect(p.scale >= 0.5 && p.scale <= 2).toBe(true);
    expect(scatterPoints({ count: 50, area: 20, scale: [0.5, 2], seed: 3, minDistance: 2 })).toEqual(pts);
    let close = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 2) close++;
    expect(close).toBeLessThan(3); // best effort: a few retries per point
  });
});
