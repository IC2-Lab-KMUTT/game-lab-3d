// Cosmic rules: black holes, supernova stars, tectonic shifts, the night side, and the async AI.
import { describe, expect, it } from 'vitest';
import {
  createGame, play, undo, legalMoves, isLegal, captureLines, status, scores, mustPass, nextShift, nightColumns, asleep,
  index, rowOf, colOf, ROWS, COLS, P1, P2, HOLE, PASS, EMPTY, TECTONIC_EVERY, NIGHT_WIDTH, HOLE_PAIRS, STAR_PAIRS, RULE_NAMES,
} from '../../src/games/orb-othello/logic.js';
import { chooseMove, chooseMoveAsync } from '../../src/games/orb-othello/ai.js';

const at = (r, c) => index(r, c);
const mirror = (i) => index(ROWS - 1 - rowOf(i), colOf(i) + COLS / 2);
const cellsOf = (g, v) => [...g.cells].map((x, i) => (x === v ? i : -1)).filter((i) => i >= 0);
const starsOf = (g) => [...g.stars].map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
/** A random game to the end; returns the game. */
function randomGame(rules, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = createGame({ rules, seed });
  for (let n = 0; !status(g).over; n++) {
    const m = legalMoves(g);
    expect(play(g, m.length ? m[Math.floor(rnd() * m.length)] : PASS)).not.toBeNull();
    if (n > 600) throw new Error('game did not end');
  }
  return g;
}

describe('classic stays classic', () => {
  it('no rules: no holes, no stars, no shifts, nobody asleep', () => {
    const g = createGame();
    expect(cellsOf(g, HOLE)).toEqual([]);
    expect(starsOf(g)).toEqual([]);
    expect(nextShift(g)).toBeNull();
    expect(nightColumns(g)).toEqual([]);
  });
});

describe('black holes', () => {
  it('come in mirrored pairs, off the cap bands, away from the opening cross', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const g = createGame({ rules: { holes: true }, seed });
      const holes = cellsOf(g, HOLE);
      expect(holes).toHaveLength(HOLE_PAIRS * 2);
      for (const h of holes) {
        expect(holes).toContain(mirror(h));
        expect(rowOf(h)).toBeGreaterThan(0);
        expect(rowOf(h)).toBeLessThan(ROWS - 1);
      }
      expect(scores(g)).toEqual({ [P1]: 2, [P2]: 2 });
      expect(legalMoves(g)).toHaveLength(4);
    }
  });
  it('cannot be played and stop lines (so a ring through one never closes)', () => {
    const g = createGame({ start: [[2, 3, P1], [2, 4, P2], [2, 6, P1]] });
    g.rules.holes = true;
    g.cells[at(2, 5)] = HOLE;
    expect(isLegal(g, at(2, 5))).toBe(false);
    expect(captureLines(g, at(2, 5))).toEqual([]);
    // P1 at (2,6) can't flank (2,4) across the hole at (2,5)
    const g2 = createGame({ start: [[2, 4, P2], [2, 6, P1]] });
    g2.cells[at(2, 5)] = HOLE;
    expect(isLegal(g2, at(2, 3))).toBe(false);
    // a ring of 14 enemy discs + 1 hole: closing is impossible
    const ring = Array.from({ length: COLS }, (_, c) => [4, c, P2]).filter(([, c]) => c !== 0 && c !== 8);
    const g3 = createGame({ start: ring });
    g3.cells[at(4, 8)] = HOLE;
    expect(isLegal(g3, at(4, 0))).toBe(false);
  });
  it('are not counted in the score', () => {
    const g = createGame({ rules: { holes: true }, seed: 5 });
    expect(scores(g)[P1] + scores(g)[P2]).toBe(4);
  });
});

describe('supernova stars', () => {
  it('are placed in mirrored pairs on empty cells', () => {
    const g = createGame({ rules: { nova: true, holes: true }, seed: 7 });
    const stars = starsOf(g);
    expect(stars).toHaveLength(STAR_PAIRS * 2);
    for (const s of stars) {
      expect(g.cells[s]).toBe(EMPTY);
      expect(stars).toContain(mirror(s));
    }
  });
  it('playing on a star flips every touching enemy disc too, once; undo restores it all', () => {
    // P1 plays (3,3): the normal capture is (3,4) [flanked by (3,5)]; the nova adds (2,2), (2,3), (4,4) and wraps nothing else.
    const g = createGame({ start: [[3, 4, P2], [3, 5, P1], [2, 2, P2], [2, 3, P2], [4, 4, P2], [5, 5, P2]] });
    g.rules.nova = true;
    g.stars[at(3, 3)] = 1;
    const before = g.cells.slice();
    const e = play(g, at(3, 3));
    expect(e.star).toBe(true);
    expect(e.nova.sort((a, b) => a - b)).toEqual([at(2, 2), at(2, 3), at(4, 4)]);
    expect(e.flipped.sort((a, b) => a - b)).toEqual([at(2, 2), at(2, 3), at(3, 4), at(4, 4)]);
    expect(g.cells[at(5, 5)]).toBe(P2); // not touching
    expect(g.stars[at(3, 3)]).toBe(0); // used up
    undo(g);
    expect([...g.cells]).toEqual([...before]);
    expect(g.stars[at(3, 3)]).toBe(1);
  });
  it('a star cell still needs a legal capture', () => {
    const g = createGame({ start: [[2, 2, P2], [5, 5, P1]] });
    g.rules.nova = true;
    g.stars[at(3, 3)] = 1;
    expect(play(g, at(3, 3))).toBeNull();
  });
  it('the hard AI grabs a star that wins big', () => {
    const g = createGame({ start: [[3, 4, P2], [3, 5, P1], [2, 2, P2], [2, 3, P2], [2, 4, P2], [4, 2, P2], [4, 3, P2], [4, 4, P2], [6, 10, P2], [6, 11, P1]] });
    g.rules.nova = true;
    g.stars[at(3, 3)] = 1;
    expect(chooseMove(g, 'hard', { timeLimitMs: 200 })).toBe(at(3, 3));
  });
});

describe('tectonic shifts', () => {
  it('slide one inner band every few plies, carrying its discs; nextShift predicts it exactly', () => {
    const g = createGame({ rules: { tectonic: true }, seed: 42 });
    let s = 9;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 4 * TECTONIC_EVERY && !status(g).over; n++) {
      const predicted = nextShift(g);
      expect(predicted.row).toBeGreaterThan(0);
      expect(predicted.row).toBeLessThan(ROWS - 1);
      expect([-2, -1, 1, 2]).toContain(predicted.k);
      const m = legalMoves(g);
      const e = play(g, m.length ? m[Math.floor(rnd() * m.length)] : PASS);
      if (predicted.in === 1) {
        expect(e.shift).toEqual({ row: predicted.row, k: predicted.k });
      } else expect(e.shift).toBeNull();
    }
  });
  it('moves the band and undo puts it back', () => {
    const g = createGame({ rules: { tectonic: true }, seed: 3 });
    const { row, k } = nextShift(g);
    // fill the shifting band with a recognisable pattern (and keep moves possible)
    g.cells[index(row, 0)] = P1;
    g.cells[index(row, 1)] = P2;
    g.stars[index(row, 2)] = 1;
    const snapshot = () => [g.cells.slice(), g.stars.slice()].map((a) => [...a]);
    const history = [];
    while (g.ply < TECTONIC_EVERY) {
      history.push(snapshot());
      const m = legalMoves(g);
      play(g, m.length ? m[0] : PASS);
    }
    expect(g.cells[index(row, k)]).toBe(P1);
    expect(g.cells[index(row, 1 + k)]).toBe(P2);
    expect(g.stars[index(row, 2 + k)]).toBe(1);
    while (g.ply) {
      undo(g);
      expect(snapshot()).toEqual(history.pop());
    }
  });
});

describe('night side', () => {
  it('covers NIGHT_WIDTH columns and drifts one column per ply', () => {
    const g = createGame({ rules: { night: true }, seed: 4 });
    const a = nightColumns(g);
    expect(a).toHaveLength(NIGHT_WIDTH);
    play(g, legalMoves(g)[0]);
    expect(nightColumns(g)).toEqual(a.map((c) => (c + 1) % COLS));
  });
  it('sleeping discs cannot be flipped: lines through them capture nothing', () => {
    const g = createGame({ start: [[2, 3, P1], [2, 4, P2]] });
    g.rules.night = true;
    g.nightOffset = 4; // night = columns 4..8 at ply 0
    expect(asleep(g, at(2, 4))).toBe(true);
    expect(isLegal(g, at(2, 5))).toBe(false);
    g.nightOffset = 10; // daylight over column 4
    g._night = null;
    expect(isLegal(g, at(2, 5))).toBe(true);
  });
  it('closing a whole ring wakes it: sleepers on the ring flip too', () => {
    const ring = Array.from({ length: COLS }, (_, c) => [3, c, P2]).filter(([, c]) => c !== 0);
    const g = createGame({ start: [...ring, [4, 0, P1]] });
    g.rules.night = true;
    g.nightOffset = 4; // columns 4..8 asleep
    expect(isLegal(g, index(3, 0))).toBe(true);
    const e = play(g, index(3, 0));
    expect(e.flipped).toHaveLength(COLS - 1);
    expect(scores(g)[P2]).toBe(0);
  });
  it('a board locked only by the night is not over: the player passes and the night moves on', () => {
    // Only capture: P1 (2,5)… flanking (2,4) which is asleep. In daylight it would be legal.
    const g = createGame({ start: [[2, 3, P1], [2, 4, P2]] });
    g.rules.night = true;
    g.nightOffset = 4;
    expect(legalMoves(g)).toEqual([]);
    expect(status(g).over).toBe(false);
    expect(mustPass(g)).toBe(true);
  });
});

describe('every rule together', () => {
  it.each([1, 2, 3])('random full games end, keep the disc count right and undo to the start (seed %i)', (seed) => {
    const rules = Object.fromEntries(RULE_NAMES.map((n) => [n, true]));
    const g = randomGame(rules, seed);
    const start = createGame({ rules, seed });
    const s = scores(g);
    expect(s[P1] + s[P2] + cellsOf(g, EMPTY).length + HOLE_PAIRS * 2).toBe(ROWS * COLS);
    while (undo(g));
    expect([...g.cells]).toEqual([...start.cells]);
    expect([...g.stars]).toEqual([...start.stars]);
    expect(g.ply).toBe(0);
  });
  it('the AIs play legal moves with all rules on', () => {
    const rules = Object.fromEntries(RULE_NAMES.map((n) => [n, true]));
    const g = createGame({ rules, seed: 8 });
    for (let n = 0; n < 40 && !status(g).over; n++) {
      const move = chooseMove(g, n % 2 ? 'hard' : 'medium', { timeLimitMs: 20 });
      const legal = legalMoves(g);
      if (legal.length) expect(legal).toContain(move);
      else expect(move).toBe(PASS);
      play(g, move);
    }
  });
});

describe('async AI', () => {
  it('gives the same answer as the blocking search for a fixed depth', async () => {
    const g = createGame({ rules: { nova: true, holes: true }, seed: 6 });
    for (let n = 0; n < 8; n++) play(g, legalMoves(g)[0] ?? PASS);
    const opts = { depth: 3, timeLimitMs: 5000 };
    expect(await chooseMoveAsync(g, 'hard', opts)).toBe(chooseMove(g, 'hard', opts));
  });
  it('never blocks for long: each slice stays short', async () => {
    const g = createGame();
    for (let n = 0; n < 20; n++) play(g, legalMoves(g)[n % legalMoves(g).length] ?? PASS);
    let worst = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
    }, 1);
    const move = await chooseMoveAsync(g, 'hard', { timeLimitMs: 250 });
    clearInterval(timer);
    expect(legalMoves(g)).toContain(move);
    expect(worst).toBeLessThan(60); // ~8 ms slices; generous for slow CI machines
  });
  it('can be cancelled', async () => {
    const g = createGame();
    for (let n = 0; n < 12; n++) play(g, legalMoves(g)[0] ?? PASS);
    let stop = false;
    setTimeout(() => (stop = true), 20);
    expect(await chooseMoveAsync(g, 'hard', { timeLimitMs: 2000, cancelled: () => stop })).toBeUndefined();
  });
});
