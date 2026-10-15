import { describe, expect, it } from 'vitest';
import {
  createGame, captureLines, isLegal, legalMoves, play, undo, status, scores, mustPass, clone, index,
  ROWS, COLS, P1, P2, PASS, EMPTY,
} from '../../src/games/orb-othello/logic.js';

const at = (r, c) => index(r, c);
/** Empty board with the given discs: [[row, col, player], …]. */
const board = (discs, current = P1) => createGame({ start: discs, first: current });

describe('start position', () => {
  it('is one 2×2 cross on the equator', () => {
    const g = createGame();
    expect(scores(g)).toEqual({ [P1]: 2, [P2]: 2 });
    expect(g.cells[at(3, 7)]).toBe(P2);
    expect(g.cells[at(3, 8)]).toBe(P1);
    expect(g.cells[at(4, 7)]).toBe(P1);
    expect(g.cells[at(4, 8)]).toBe(P2);
    expect(g.current).toBe(P1);
  });
  it('gives the first player the 4 classic opening moves', () => {
    expect(legalMoves(createGame())).toHaveLength(4);
  });
});

describe('flanking', () => {
  it('captures along a row and flips the discs', () => {
    const g = board([[2, 5, P1], [2, 6, P2], [2, 7, P2]]);
    const e = play(g, at(2, 8));
    expect(e.flipped.sort()).toEqual([at(2, 6), at(2, 7)].sort());
    expect(g.cells[at(2, 6)]).toBe(P1);
    expect(g.current).toBe(P2);
  });
  it('lines are ordered outward from the move (for the cascade)', () => {
    const g = board([[2, 5, P1], [2, 6, P2], [2, 7, P2]]);
    expect(captureLines(g, at(2, 8))).toEqual([[at(2, 7), at(2, 6)]]);
  });
  it('wraps around the planet horizontally (column 15 → 0)', () => {
    const g = board([[3, 14, P1], [3, 15, P2], [3, 0, P2]]);
    expect(isLegal(g, at(3, 1))).toBe(true);
    const e = play(g, at(3, 1));
    expect(e.flipped.sort((a, b) => a - b)).toEqual([at(3, 0), at(3, 15)]);
  });
  it('wraps diagonals around the planet too', () => {
    // from (5,1) going north-west: (4,0) → (3,15) → (2,14)
    const g = board([[2, 14, P1], [3, 15, P2], [4, 0, P2]]);
    const e = play(g, at(5, 1));
    expect(e.flipped.sort((a, b) => a - b)).toEqual([at(3, 15), at(4, 0)]);
  });
  it('does not wrap vertically: columns stop at the polar caps', () => {
    // P2 at the top and bottom of column 3, P1 below/above them: no line crosses the pole.
    const g = board([[0, 3, P2], [7, 3, P1]]);
    expect(isLegal(g, at(1, 3))).toBe(false);
    expect(legalMoves(g)).toEqual([]);
  });
  it('captures in several directions at once', () => {
    const g = board([[2, 2, P1], [3, 3, P2], [4, 2, P1], [4, 3, P2]]);
    const e = play(g, at(5, 3)); // north: (4,3),(3,3)? needs P1 at (2,3) – no. NW: (4,2) is own → nothing
    expect(e).toBeNull();
    const g2 = board([[2, 3, P1], [3, 3, P2], [4, 3, P2], [5, 5, P1], [5, 4, P2]]);
    const e2 = play(g2, at(5, 3));
    expect(e2.flipped.sort((a, b) => a - b)).toEqual([at(3, 3), at(4, 3), at(5, 4)].sort((a, b) => a - b));
    expect(e2.lines).toHaveLength(2);
  });
  it('rejects moves that capture nothing or are on occupied cells', () => {
    const g = createGame();
    expect(play(g, at(0, 0))).toBeNull();
    expect(play(g, at(3, 0))).toBeNull();
    expect(scores(g)).toEqual({ [P1]: 2, [P2]: 2 });
  });
});

describe('ring rule (a line that comes all the way round)', () => {
  const ring = (row, gap, player) => Array.from({ length: COLS }, (_, c) => c).filter((c) => c !== gap).map((c) => [row, c, player]);

  it('closing a ring of 15 opponent discs captures the whole ring, each disc once', () => {
    const g = board(ring(4, 7, P2));
    const lines = captureLines(g, at(4, 7));
    expect(lines).toHaveLength(1); // east and west find the same ring: kept once
    expect(lines[0]).toHaveLength(15);
    const e = play(g, at(4, 7));
    expect(e.flipped).toHaveLength(15);
    expect(scores(g)).toEqual({ [P1]: 16, [P2]: 0 });
  });
  it('a ring of your own discs is not a capture', () => {
    expect(isLegal(board(ring(4, 7, P1)), at(4, 7))).toBe(false);
  });
  it('a ring broken by an empty cell captures only up to your disc', () => {
    // row 4: P1 at col 3, P2 everywhere else except the gap at 7 and an empty cell at 12
    const discs = ring(4, 7, P2).filter(([, c]) => c !== 12 && c !== 3).concat([[4, 3, P1]]);
    const e = play(board(discs), at(4, 7));
    expect(e.flipped.sort((a, b) => a - b)).toEqual([at(4, 4), at(4, 5), at(4, 6)]);
  });
  it('undo restores the ring exactly', () => {
    const g = board(ring(0, 0, P2));
    const before = g.cells.slice();
    play(g, at(0, 0));
    undo(g);
    expect([...g.cells]).toEqual([...before]);
    expect(g.current).toBe(P1);
  });
});

describe('pass and end of game', () => {
  it('a player with no legal move must pass; PASS is refused otherwise', () => {
    // P1 has a move ((3,3) flanks the P2 disc), so passing is not allowed.
    const g = board([[3, 4, P2], [3, 5, P1]]);
    expect(play(g, PASS)).toBeNull();
    // North band full of P2, one P1 disc below it: P1 can't flank anything, P2 can (playing (2,0)).
    const discs = Array.from({ length: COLS }, (_, c) => [0, c, P2]).concat([[1, 0, P1]]);
    const g2 = board(discs, P1);
    expect(legalMoves(g2)).toEqual([]);
    expect(legalMoves(g2, P2).sort((a, b) => a - b)).toEqual([at(2, 0), at(2, 1), at(2, 15)]); // straight + both diagonals
    expect(mustPass(g2)).toBe(true);
    expect(status(g2).over).toBe(false);
    const e = play(g2, PASS);
    expect(e.move).toBe(PASS);
    expect(g2.current).toBe(P2);
    undo(g2);
    expect(g2.current).toBe(P1);
  });
  it('the game ends when neither player can move; most discs wins', () => {
    const g = board([[3, 4, P1], [3, 5, P2], [3, 6, P1]]);
    expect(play(g, at(3, 7))).toBeNull();
    const s = status(board([[0, 0, P1], [0, 1, P1], [5, 5, P2]]));
    expect(s).toEqual({ over: true, scores: { [P1]: 2, [P2]: 1 }, winner: P1 });
    expect(status(board([[0, 0, P1], [5, 5, P2]])).winner).toBe(0);
    expect(status(createGame()).over).toBe(false);
  });
  it('random full games always end with a full or locked board, and undo rewinds everything', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let game = 0; game < 5; game++) {
      const g = createGame();
      const start = g.cells.slice();
      let plies = 0;
      while (!status(g).over) {
        const moves = legalMoves(g);
        expect(play(g, moves.length ? moves[Math.floor(rnd() * moves.length)] : PASS)).not.toBeNull();
        if (++plies > 400) throw new Error('game did not end');
      }
      const s = status(g).scores;
      expect(s[P1] + s[P2] + [...g.cells].filter((v) => v === EMPTY).length).toBe(ROWS * COLS);
      while (undo(g));
      expect([...g.cells]).toEqual([...start]);
      expect(g.current).toBe(P1);
    }
  });
  it('clone is independent', () => {
    const g = createGame();
    const c = clone(g);
    play(c, legalMoves(c)[0]);
    expect(scores(g)).toEqual({ [P1]: 2, [P2]: 2 });
  });
});
