// bestMoveAsync (time-sliced search) must find the same moves as bestMove, and give the page room to breathe.
import { describe, expect, it } from 'vitest';
import { bestMove, bestMoveAsync } from '../../src/engine/ai.js';

// Nim: take 1–3 from a pile; whoever takes the last one wins. Winning move: leave a multiple of 4.
const nim = (pile) => ({ pile, toMove: 1 });
const options = {
  moves: (s) => [1, 2, 3].filter((n) => n <= s.pile),
  play: (s, m) => ((s.pile -= m), (s.toMove = -s.toMove)),
  undo: (s, m) => ((s.pile += m), (s.toMove = -s.toMove)),
  evaluate: (s) => (s.pile === 0 ? -1 : 0), // the player to move with nothing left has lost
  isOver: (s) => s.pile === 0,
  depth: 12,
  timeLimitMs: 2000,
};

describe('bestMoveAsync', () => {
  it.each([5, 6, 7, 9, 10, 11])('finds the same winning Nim move as bestMove (pile %i)', async (pile) => {
    const sync = bestMove(nim(pile), options);
    expect(await bestMoveAsync(nim(pile), { ...options, sliceMs: 0.05 })).toBe(sync);
    expect((pile - sync) % 4).toBe(0);
  });
  it('pauses between slices with the given pause function, and can be cancelled', async () => {
    let pauses = 0;
    const pause = () => (pauses++, Promise.resolve());
    await bestMoveAsync(nim(15), { ...options, sliceMs: 0.01, pause });
    expect(pauses).toBeGreaterThan(0);
    expect(await bestMoveAsync(nim(15), { ...options, sliceMs: 0.01, pause, cancelled: () => true })).toBeUndefined();
  });
});
