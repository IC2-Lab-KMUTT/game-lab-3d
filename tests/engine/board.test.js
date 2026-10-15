import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHistory, cascadeDelays, placePiece, flipPiece, stopPiece } from '../../src/engine/board.js';
import { createTweens } from '../../src/engine/effects.js';

describe('createHistory', () => {
  it('pushes, pops and reports the last entry', () => {
    const h = createHistory();
    h.push({ player: 0, move: 'a' });
    h.push({ player: 1, move: 'b' });
    expect(h.size).toBe(2);
    expect(h.last.move).toBe('b');
    expect(h.pop().move).toBe('b');
    expect(h.size).toBe(1);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.pop()).toBeUndefined();
  });

  it('stepsBackTo: how far to rewind so the human is to move again (vs AI)', () => {
    const h = createHistory();
    for (const [player, move] of [[0, 1], [1, 2], [0, 3], [1, 4]]) h.push({ player, move });
    expect(h.stepsBackTo((e) => e.player === 0)).toBe(2); // undo the AI reply and the human's move
    h.push({ player: 1, move: 'pass' }); // the human had to pass, the AI moved again
    expect(h.stepsBackTo((e) => e.player === 0 && e.move !== 'pass')).toBe(3);
    expect(h.stepsBackTo((e) => e.player === 7)).toBe(0);
  });
});

describe('cascadeDelays', () => {
  it('times each line outward from the move, a step per cell', () => {
    const d = cascadeDelays([[10, 11, 12], [20]], { start: 0.1, step: 0.05 });
    expect(d.get(10)).toBeCloseTo(0.1);
    expect(d.get(12)).toBeCloseTo(0.2);
    expect(d.get(20)).toBeCloseTo(0.1);
  });
  it('a cell on two lines gets the earlier time', () => {
    const d = cascadeDelays([[1, 2, 3], [3]], { step: 1 });
    expect(d.get(3)).toBe(0);
    expect(d.size).toBe(3);
  });
});

// The piece animations only need engine.THREE and engine.fx (tween/cancelTweens): drive them by hand.
const fakeEngine = () => {
  const tweens = createTweens();
  return { THREE, fx: { tween: tweens.tween, cancelTweens: tweens.cancel }, run: (s) => { for (let t = 0; t < s; t += 1 / 60) tweens.update(1 / 60); } };
};

describe('piece animations', () => {
  it('placePiece drops the piece onto its spot and restores its scale', async () => {
    const engine = fakeEngine();
    const p = new THREE.Object3D();
    p.position.set(1, 2, 3);
    const done = placePiece(engine, p, { up: new THREE.Vector3(0, 1, 0), drop: 1 });
    expect(p.position.y).toBeCloseTo(3); // starts above
    engine.run(1);
    await done;
    expect(p.position.toArray()).toEqual([1, 2, 3]);
    expect(p.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('flipPiece ends half a turn round the axis, back in place, and calls onFlip once', async () => {
    const engine = fakeEngine();
    const p = new THREE.Object3D();
    let flips = 0;
    const done = flipPiece(engine, p, { axis: new THREE.Vector3(1, 0, 0), onFlip: () => flips++ });
    engine.run(1);
    await done;
    expect(flips).toBe(1);
    expect(p.position.length()).toBeCloseTo(0);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion);
    expect(up.y).toBeCloseTo(-1); // upside down: the other colour shows
  });

  it('stopPiece leaves the piece where the game put it (e.g. after undo)', async () => {
    const engine = fakeEngine();
    const p = new THREE.Object3D();
    const done = flipPiece(engine, p, { axis: new THREE.Vector3(1, 0, 0) });
    engine.run(0.1);
    stopPiece(engine, p);
    p.position.set(5, 5, 5);
    p.quaternion.identity();
    await done;
    engine.run(1);
    expect(p.position.toArray()).toEqual([5, 5, 5]);
    expect(p.quaternion.w).toBe(1);
  });
});
