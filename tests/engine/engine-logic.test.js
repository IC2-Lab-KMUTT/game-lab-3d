// Tests for the engine parts that don't need a browser.
import { describe, expect, it, vi } from 'vitest';
import { createEvents } from '../../src/engine/events.js';
import { createPlayers } from '../../src/engine/players.js';
import { bestMove, seek, flee, arrive } from '../../src/engine/ai.js';
import { createTweens, EASE } from '../../src/engine/effects.js';
import { noteToFreq } from '../../src/engine/audio.js';

describe('events', () => {
  it('on / emit / off / once', () => {
    const e = createEvents();
    const fn = vi.fn();
    const off = e.on('x', fn);
    e.emit('x', 1);
    off();
    e.emit('x', 2);
    expect(fn).toHaveBeenCalledExactlyOnceWith(1);
    const once = vi.fn();
    e.once('y', once);
    e.emit('y');
    e.emit('y');
    expect(once).toHaveBeenCalledOnce();
  });
});

describe('players', () => {
  it('rotates turns, skips players who are out, keeps scores', () => {
    const p = createPlayers([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    expect(p.current.name).toBe('A');
    p.get(1).out = true;
    expect(p.next().name).toBe('C');
    expect(p.next().name).toBe('A');
    p.addScore(2, 5);
    expect(p.leader().name).toBe('C');
    p.reset();
    expect(p.get(2).score).toBe(0);
    expect(p.get(1).out).toBe(false);
  });
});

describe('bestMove (minimax)', () => {
  // Nim: take 1–3 sticks; whoever takes the last stick wins. Winning play: leave a multiple of 4.
  const nim = {
    moves: (s) => [1, 2, 3].filter((m) => m <= s.sticks),
    play: (s, m) => (s.sticks -= m),
    undo: (s, m) => (s.sticks += m),
    evaluate: (s) => (s.sticks === 0 ? -1 : 0), // the player to move has lost if nothing is left
    isOver: (s) => s.sticks === 0,
    depth: 8,
  };

  it.each([[5, 1], [6, 2], [7, 3], [9, 1], [10, 2]])('with %i sticks takes %i', (sticks, expected) => {
    expect(bestMove({ sticks }, nim)).toBe(expected);
  });

  it('works with immutable states (no undo)', () => {
    const immutable = { ...nim, undo: undefined, play: (s, m) => ({ sticks: s.sticks - m }) };
    expect(bestMove({ sticks: 6 }, immutable)).toBe(2);
  });
});

describe('steering', () => {
  it('seek moves towards, flee moves away, arrive slows down', () => {
    expect(seek({ x: 0, z: 0 }, { x: 10, z: 0 }, 2)).toEqual({ x: 2, z: 0 });
    expect(flee({ x: 0, z: 0 }, { x: 1, z: 0 }, 2).x).toBe(-2);
    expect(flee({ x: 0, z: 0 }, { x: 10, z: 0 }, 2, 5)).toEqual({ x: 0, z: 0 });
    expect(arrive({ x: 0, z: 0 }, { x: 1, z: 0 }, 4, 2).x).toBeCloseTo(2);
  });
});

describe('tweens', () => {
  it('animates numbers on any object and resolves when done', async () => {
    const tweens = createTweens();
    const obj = { y: 0 };
    const done = tweens.tween(obj, { y: 10 }, { duration: 1, ease: 'linear' });
    tweens.update(0.5);
    expect(obj.y).toBeCloseTo(5);
    tweens.update(0.6);
    expect(obj.y).toBe(10);
    await done;
    expect(tweens.count).toBe(0);
  });

  it('every easing starts at 0 and ends at 1', () => {
    for (const [name, f] of Object.entries(EASE)) {
      expect(f(0), name).toBeCloseTo(0);
      expect(f(1), name).toBeCloseTo(1);
    }
  });
});

describe('audio notes', () => {
  it('converts note names to frequencies', () => {
    expect(noteToFreq('A4')).toBeCloseTo(440);
    expect(noteToFreq('A5')).toBeCloseTo(880);
    expect(noteToFreq('C4')).toBeCloseTo(261.63, 1);
    expect(noteToFreq('Bb2')).toBeCloseTo(116.54, 1);
    expect(noteToFreq(300)).toBe(300);
  });
});
