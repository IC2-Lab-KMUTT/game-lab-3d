import { describe, expect, it } from 'vitest';
import { createGame, legalMoves, play, status, index, COLS, P1, P2, PASS } from '../../src/games/orb-othello/logic.js';
import { chooseMove, evaluate } from '../../src/games/orb-othello/ai.js';

const at = (r, c) => index(r, c);
const board = (discs, current = P1) => createGame({ start: discs, first: current });

describe.each(['easy', 'medium', 'hard'])('AI %s', (level) => {
  it('always plays a legal move (or PASS when stuck) through a whole game', () => {
    const g = createGame();
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    while (!status(g).over) {
      const fast = { random, timeLimitMs: 30 };
      const move = g.current === P1 ? chooseMove(g, level, fast) : chooseMove(g, 'easy', fast);
      const legal = legalMoves(g);
      if (legal.length) expect(legal).toContain(move);
      else expect(move).toBe(PASS);
      expect(play(g, move)).not.toBeNull();
    }
  }, 30000);

  it('does not change the game it is given', () => {
    const g = createGame();
    const before = g.cells.slice();
    chooseMove(g, level, { timeLimitMs: 30 });
    expect([...g.cells]).toEqual([...before]);
    expect(g.current).toBe(P1);
    expect(g.history.size).toBe(0);
  });
});

describe('hard AI', () => {
  it('takes a move that wins the game outright (wipes out the opponent)', () => {
    // (2,6) or (4,6) flip one of P2's two discs; only (1,5) flips both (down the column) and ends the game.
    const g = board([[2, 4, P1], [2, 5, P2], [3, 5, P2], [4, 5, P1], [5, 9, P1], [5, 10, P1]]);
    const move = chooseMove(g, 'hard');
    const copy = board([[2, 4, P1], [2, 5, P2], [3, 5, P2], [4, 5, P1], [5, 9, P1], [5, 10, P1]]);
    play(copy, move);
    expect(status(copy).scores[P2]).toBe(0);
  });

  it('closes a ring around the planet when it can', () => {
    const ring = Array.from({ length: COLS }, (_, c) => [4, c, P2]).filter(([, c]) => c !== 9);
    const g = board([...ring, [5, 3, P1], [6, 3, P2], [7, 3, P1]]);
    expect(chooseMove(g, 'hard')).toBe(at(4, 9));
  });

  it('prefers the cap-side band (edge) over the risky band next to it', () => {
    // P1 can play into row 0 (the edge) at (0,3), or into row 1 at (1,10) (next to an empty edge).
    const g = board([[2, 3, P1], [1, 3, P2], [3, 10, P1], [2, 10, P2]]);
    const move = chooseMove(g, 'hard', { depth: 1 });
    expect(move).toBe(at(0, 3));
  });

  it('answers within its time budget, even in a busy middle game', () => {
    const g = createGame();
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 30 && !status(g).over; i++) {
      const m = legalMoves(g);
      play(g, m.length ? m[Math.floor(random() * m.length)] : PASS);
    }
    const t0 = performance.now();
    chooseMove(g, 'hard');
    expect(performance.now() - t0).toBeLessThan(450); // budget 350 ms + one finishing evaluation
  });

  it('evaluation is symmetric: what is good for one side is bad for the other', () => {
    const a = board([[0, 0, P1], [3, 3, P2], [3, 4, P1]], P1);
    const b = board([[0, 0, P1], [3, 3, P2], [3, 4, P1]], P2);
    expect(evaluate(a)).toBe(-evaluate(b));
  });
});
