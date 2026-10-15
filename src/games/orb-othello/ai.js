// Computer opponents for Orb Othello. Pure (no Three.js), unit tested in tests/orb-othello/ai.test.js.
//   chooseMove(game, 'easy' | 'medium' | 'hard') → cell index, or PASS when there is no legal move.
//   await chooseMoveAsync(game, level, { cancelled })   same, time-sliced so the page never freezes
//
// Hard = the engine's alpha-beta search (src/engine/ai.js → bestMove) with iterative deepening and a
// time budget of ~0.35 s of thinking. The cosmic rules need no special search code: holes, stars,
// tectonic shifts and the night all happen inside play()/undo(), so the search sees them coming.
// What it values, adapted to a sphere:
// - There are no corners. The cap-side bands (rows 0 and ROWS-1) act like edges: a disc there can
//   only be flanked along its own ring, so they're strong; once that ring is full they can never flip.
// - The band next to them is risky while the edge cells above it are empty: it hands the opponent the
//   edge (like the "X squares" of classic Othello). Its penalty disappears once those cells are filled.
// - Mobility (having more moves than the opponent) and few frontier discs (discs next to empty cells,
//   which give the opponent moves) matter most in the middle game; disc count only at the very end.
// - Supernova stars the opponent could take next are a threat; ones we can take are a chance.
// - A disc next to a black hole can't be flanked across it, so it's a little safer.
import { bestMove, bestMoveAsync } from '../../engine/ai.js';
import { clone, legalMoves, play, undo, other, index, rowOf, colOf, isOver as gameOver, PASS, EMPTY, HOLE } from './logic.js';

export const LEVELS = {
  easy: { label: 'Easy' },
  medium: { label: 'Medium', depth: 2, timeLimitMs: 200 },
  hard: { label: 'Hard', depth: 12, timeLimitMs: 350 },
};

const EDGE = 6; // a disc on a cap-side band
const NEXT_TO_EDGE = -3; // …and on the band next to it, while the edge cells beside it are empty
const STABLE_RING = 4; // extra per disc on a completely filled cap-side band
const MOBILITY = 3;
const FRONTIER = 1;
const ENDGAME_EMPTIES = 14; // from here on, disc count starts to matter
const STAR = 4; // a supernova within reach (ours +, theirs −)
const BY_HOLE = 1; // per black hole touching the disc

/** Moves for both players, cached on the state until the next play/undo (the search asks often). */
function movesOf(g) {
  if (!g._moves) {
    const mine = legalMoves(g, g.current);
    g._moves = { mine, theirs: legalMoves(g, other(g.current)) };
  }
  return g._moves;
}
const isOver = (g) => {
  const m = movesOf(g);
  if (m.mine.length || m.theirs.length) return false;
  if (m.over === undefined) m.over = gameOver(g); // night rule: maybe not over yet (dawn may help)
  return m.over;
};

/** Value of each cell's position for its owner (positional part of the evaluation). */
function cellWeight(g, i) {
  const { rows, cols, cells } = g;
  const r = rowOf(i, cols);
  if (r === 0 || r === rows - 1) return EDGE;
  let w = 1;
  if (g.rules?.holes) {
    const c = colOf(i, cols);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (cells[index(r + dr, c + dc, cols)] === HOLE) w += BY_HOLE;
  }
  if (r === 1 || r === rows - 2) {
    const er = r === 1 ? 0 : rows - 1;
    const c = colOf(i, cols);
    const open = cells[index(er, c - 1, cols)] === EMPTY || cells[index(er, c, cols)] === EMPTY || cells[index(er, c + 1, cols)] === EMPTY;
    return open ? NEXT_TO_EDGE : w;
  }
  return w;
}

/** Score from the point of view of the player to move (+ = good for them). */
export function evaluate(g, { mobility = true } = {}) {
  const { rows, cols, cells } = g;
  const me = g.current;
  let discDiff = 0;
  let empties = 0;
  let positional = 0;
  let frontier = 0;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v === EMPTY) {
      empties++;
      continue;
    }
    if (v === HOLE) continue;
    const s = v === me ? 1 : -1;
    discDiff += s;
    positional += s * cellWeight(g, i);
    if (mobility) {
      const r = rowOf(i, cols);
      const c = colOf(i, cols);
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        if (cells[index(rr, c - 1, cols)] === EMPTY || cells[index(rr, c, cols)] === EMPTY || cells[index(rr, c + 1, cols)] === EMPTY) {
          frontier += s;
          break;
        }
      }
    }
  }
  if (isOver(g)) return discDiff > 0 ? 10000 + discDiff : discDiff < 0 ? -10000 + discDiff : 0;
  // A full cap-side ring can't be flanked any more: those discs are permanent.
  for (const r of [0, rows - 1]) {
    let full = true;
    let diff = 0;
    for (let c = 0; c < cols && full; c++) {
      const v = cells[index(r, c, cols)];
      if (v === EMPTY) full = false;
      else diff += v === me ? 1 : -1;
    }
    if (full) positional += diff * STABLE_RING;
  }
  let score = positional;
  if (mobility) {
    const m = movesOf(g);
    score += MOBILITY * (m.mine.length - m.theirs.length) - FRONTIER * frontier;
    if (g.rules?.nova) {
      for (const i of m.mine) if (g.stars[i]) score += STAR;
      for (const i of m.theirs) if (g.stars[i]) score -= STAR;
    }
  }
  if (empties <= ENDGAME_EMPTIES) score += discDiff * (ENDGAME_EMPTIES + 1 - empties);
  return score;
}

/** Moves for the search: the legal moves, PASS when stuck, nothing when the game is over. */
const searchMoves = (g) => {
  const m = movesOf(g);
  return m.mine.length ? m.mine : isOver(g) ? [] : [PASS];
};
const searchPlay = (g, m) => {
  play(g, m);
  g._moves = null;
};
const searchUndo = (g) => {
  undo(g);
  g._moves = null;
};

/** Greedy with noise: most flips, some taste for edges, often just a random move. */
function easyMove(g, moves, random) {
  if (random() < 0.35) return moves[Math.floor(random() * moves.length)];
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const e = play(g, m);
    const s = e.flipped.length + 0.3 * cellWeight(g, m) + random() * 3;
    undo(g);
    if (s > bestScore) [best, bestScore] = [m, s];
  }
  return best;
}

/**
 * Pick a move for the player to move. `game` is not changed (we search on a copy of its cells).
 * options: { random } (for tests), { timeLimitMs, depth } override the level.
 */
function prepare(game, level, { random = Math.random, ...override }) {
  const g = clone(game);
  const moves = legalMoves(g);
  if (!moves.length) return { now: PASS };
  if (moves.length === 1) return { now: moves[0] };
  if (level === 'easy') return { now: easyMove(g, moves, random) };
  const cfg = { ...LEVELS[level] ?? LEVELS.hard, ...override };
  const useMobility = level !== 'medium';
  // Strong-looking moves first (stars, edges), so alpha-beta can skip more of the tree.
  const weight = (s, m) => cellWeight(s, m) + (s.stars[m] ? 8 : 0);
  const order = (s, list) => (list.length < 2 ? list : list.map((m) => [m, weight(s, m)]).sort((a, b) => b[1] - a[1]).map(([m]) => m));
  const search = {
    moves: searchMoves,
    play: searchPlay,
    undo: searchUndo,
    evaluate: (s) => evaluate(s, { mobility: useMobility }),
    isOver,
    order,
    depth: cfg.depth,
    timeLimitMs: cfg.timeLimitMs,
  };
  return { g, search };
}

export function chooseMove(game, level = 'hard', options = {}) {
  const { now, g, search } = prepare(game, level, options);
  return now ?? bestMove(g, search);
}

/** Like chooseMove, but thinks in ~8 ms slices so animations keep running. Resolves undefined if cancelled. */
export async function chooseMoveAsync(game, level = 'hard', { cancelled, sliceMs = 8, pause, ...options } = {}) {
  const { now, g, search } = prepare(game, level, options);
  if (now !== undefined) return now;
  return bestMoveAsync(g, { ...search, cancelled, sliceMs, ...(pause && { pause }) });
}
