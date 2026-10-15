// Othello on a planet: pure rules, no Three.js / DOM (unit tested in tests/orb-othello/).
//
// The board is the planet's surface between about ±60° latitude: ROWS latitude bands × COLS
// longitude columns. Row 0 is the northern band (next to the north cap), column 0 is longitude 0.
// Why 8 × 16: 16 columns of 22.5° and 8 rows of 15° give cells that are close to square
// (equator 22° × 15°, near the caps 14° × 15°), so discs stay readable everywhere, and
// 128 cells (2× classic Othello) is long enough for comebacks yet fits in a ~15-minute game.
//
// Longitude WRAPS: a row is a ring around the planet, and diagonals spiral round it too. Columns
// stop at the polar caps. So there are no corners; the bands next to the caps play like edges
// (a disc there can only be flanked along its ring).
//
// RING RULE (the wrap-around edge case): a line that runs all the way round a ring comes back to
// the cell being played. That cell counts as yours, so if your move is the only gap in a ring of
// opponent discs, you close the ring and capture all of them (both directions find the same discs;
// each is flipped once).
//
// COSMIC RULES (all optional, any combination; createGame({ rules: { holes: true, … } })):
//   holes     Black holes: a few cells (in point-symmetric pairs) are voids. Nobody can play there
//             and lines stop at them, so a ring through a hole can never be closed.
//   nova      Supernova stars: a few empty cells hold a star. Play there (it must still be a legal
//             move) and the star bursts: every enemy disc touching that cell flips too.
//   tectonic  Every TECTONIC_EVERY plies one inner band slides 1–2 columns round the planet, carrying
//             its discs, stars and holes. Which band and which way is fixed by the game's seed, so the
//             HUD (and the AI) can see the next shift coming.
//   night     The night side (NIGHT_WIDTH columns) moves one column per ply. Discs on the night side
//             are asleep: they can't be flipped, so a line through one of them captures nothing.
//             Except a ring: closing a whole ring wakes it (otherwise night would make rings impossible,
//             since every ring passes through the night).
//
//   const g = createGame({ rules, seed });  g.cells[i] = 0 empty | 1 Ember | 2 Frost | 3 hole
//   legalMoves(g)  →  [cell…]          (empty when the player must pass)
//   play(g, cell | PASS) → { player, move, lines, flipped, nova, shift } or null if illegal
//   undo(g)       status(g) → { over, scores, winner }   clone(g)
//   nextShift(g) → { row, k, in }      asleep(g, cell)    nightColumns(g)
import { createHistory } from '../../engine/board.js';

export const ROWS = 8;
export const COLS = 16;
export const EMPTY = 0;
export const P1 = 1; // Ember: moves first
export const P2 = 2; // Frost
export const HOLE = 3;
export const PASS = -1;
// [dRow, dCol]: N, NE, E, SE, S, SW, W, NW
export const DIRS = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];

export const RULE_NAMES = ['tectonic', 'holes', 'nova', 'night'];
export const TECTONIC_EVERY = 6; // plies between shifts (3 moves each)
export const HOLE_PAIRS = 3;
export const STAR_PAIRS = 2;
export const NIGHT_WIDTH = 5; // of 16 columns: a bit under a third of the planet sleeps

export const other = (p) => 3 - p;
export const index = (r, c, cols = COLS) => r * cols + (((c % cols) + cols) % cols);
export const rowOf = (i, cols = COLS) => Math.floor(i / cols);
export const colOf = (i, cols = COLS) => i % cols;

/** Small seeded generator (mulberry32), so a seed always gives the same holes, stars and shifts. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One classic 2×2 Othello cross on the equator. Playtested against two crosses on opposite sides:
 * with two, about half of all games locked up early (each cross turned one colour, so nobody could
 * flank anything with half the planet still empty). With one, the front grows round the planet
 * until it meets itself from the other side, which is where the wrap-around tactics start.
 */
export function startPosition(rows = ROWS, cols = COLS) {
  const r = rows / 2 - 1;
  const c = cols / 2 - 1;
  return [[r, c, P2], [r, c + 1, P1], [r + 1, c, P1], [r + 1, c + 1, P2]];
}

/**
 * Cells for holes and stars, in pairs mirrored through the planet's centre ((r, c) ↔ (rows-1-r, c+cols/2)),
 * so neither side starts closer to them. Never on the cap-side bands (they'd spoil the edge play),
 * never touching the opening cross or each other.
 */
export function cosmicCells(g, pairs, rand) {
  const { rows, cols, cells } = g;
  const taken = [];
  const near = (a, b) => {
    const dr = Math.abs(rowOf(a, cols) - rowOf(b, cols));
    const dc = Math.abs(colOf(a, cols) - colOf(b, cols));
    return dr <= 1 && Math.min(dc, cols - dc) <= 1;
  };
  const busy = (i) => cells[i] !== EMPTY || g.stars[i] || taken.some((j) => near(i, j)) || [...cells].some((v, j) => v !== EMPTY && near(i, j));
  const out = [];
  for (let tries = 0; out.length < pairs * 2 && tries < 500; tries++) {
    const r = 1 + Math.floor(rand() * (rows - 2));
    const c = Math.floor(rand() * cols);
    const a = index(r, c, cols);
    const b = index(rows - 1 - r, c + cols / 2, cols);
    if (a === b || busy(a) || busy(b) || near(a, b)) continue;
    taken.push(a, b);
    out.push(a, b);
  }
  return out;
}

export function createGame({ rows = ROWS, cols = COLS, start = startPosition(rows, cols), first = P1, rules = {}, seed = 1 } = {}) {
  const g = {
    rows, cols, cells: new Int8Array(rows * cols), stars: new Uint8Array(rows * cols),
    current: first, history: createHistory(), ply: 0, seed: seed >>> 0,
    rules: Object.fromEntries(RULE_NAMES.map((n) => [n, !!rules[n]])),
  };
  for (const [r, c, p] of start) g.cells[index(r, c, cols)] = p;
  const rand = rng(g.seed);
  if (g.rules.holes) for (const i of cosmicCells(g, HOLE_PAIRS, rand)) g.cells[i] = HOLE;
  if (g.rules.nova) for (const i of cosmicCells(g, STAR_PAIRS, rand)) g.stars[i] = 1;
  g.nightOffset = Math.floor(rand() * cols);
  return g;
}

export function clone(g) {
  return { ...g, cells: g.cells.slice(), stars: g.stars.slice(), rules: { ...g.rules }, history: createHistory(), _night: null, _moves: null };
}

// ---------- night ----------
/** First night column at a given ply (the night side drifts one column per ply). */
const nightStart = (g, ply = g.ply) => (((g.nightOffset ?? 0) + ply) % g.cols + g.cols) % g.cols;
/** The night columns right now (empty list without the night rule). */
export function nightColumns(g, ply = g.ply) {
  if (!g.rules?.night) return [];
  const s = nightStart(g, ply);
  return Array.from({ length: NIGHT_WIDTH }, (_, k) => (s + k) % g.cols);
}
/** Per-column 1 = asleep, cached per ply (the move generator asks for it a lot). */
function nightMask(g) {
  if (!g.rules?.night) return null;
  if (g._night?.ply === g.ply) return g._night.mask;
  const mask = new Uint8Array(g.cols);
  for (const c of nightColumns(g)) mask[c] = 1;
  g._night = { ply: g.ply, mask };
  return mask;
}
/** Is the disc on cell i asleep (can't be flipped) right now? */
export const asleep = (g, i) => !!nightMask(g)?.[colOf(i, g.cols)];

// ---------- tectonic ----------
/** The n-th shift (n = 1, 2, …): { row, k }. Inner bands only; k is ±1 or ±2 columns. */
export function shiftAt(g, n) {
  const r = rng((g.seed ^ Math.imul(n, 0x9e3779b1)) >>> 0);
  r();
  const row = 1 + Math.floor(r() * (g.rows - 2));
  const k = (r() < 0.5 ? -1 : 1) * (r() < 0.6 ? 1 : 2);
  return { row, k };
}
/** The next shift and how many plies until it happens (1 = right after the current move). null without the rule. */
export function nextShift(g) {
  if (!g.rules?.tectonic) return null;
  const n = Math.floor(g.ply / TECTONIC_EVERY) + 1;
  return { ...shiftAt(g, n), in: n * TECTONIC_EVERY - g.ply, n };
}
/** Slide row `row` by k columns (east = +), carrying discs, holes and stars. */
export function rotateRow(g, row, k) {
  const { cols } = g;
  const base = row * cols;
  const cells = g.cells.slice(base, base + cols);
  const stars = g.stars.slice(base, base + cols);
  for (let c = 0; c < cols; c++) {
    const to = base + ((((c + k) % cols) + cols) % cols);
    g.cells[to] = cells[c];
    g.stars[to] = stars[c];
  }
}

// ---------- moves ----------
/**
 * The lines `player` would capture by playing on empty cell `i`: a list of cell lists, each ordered
 * outward from `i` (handy for cascade animations). Empty list = not a legal move.
 */
export function captureLines(g, i, player = g.current) {
  const { rows, cols, cells } = g;
  if (cells[i] !== EMPTY) return [];
  const night = nightMask(g);
  const r0 = rowOf(i, cols);
  const c0 = colOf(i, cols);
  const opp = other(player);
  const lines = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let asleepOnLine = false;
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < rows) {
      const j = index(r, c, cols);
      if (j === i) {
        // went all the way round the ring: the new disc closes it (and wakes any sleepers on it)
        if (line.length) lines.push(line);
        break;
      }
      const v = cells[j];
      if (v === opp) {
        line.push(j);
        if (night && night[colOf(j, cols)]) asleepOnLine = true;
      } else {
        if (v === player && line.length && !asleepOnLine) lines.push(line);
        break; // own disc, empty or hole: the line ends (a sleeping enemy on it spoils the capture)
      }
      r += dr;
      c += dc;
    }
  }
  // A full ring is found going east AND west: keep it once.
  if (lines.length > 1) {
    const seen = new Set();
    return lines.filter((l) => {
      const key = [...l].sort((a, b) => a - b).join(',');
      return seen.has(key) ? false : seen.add(key);
    });
  }
  return lines;
}

/** Fast yes/no version of captureLines (used for move lists and the AI). */
export function isLegal(g, i, player = g.current) {
  const { rows, cols, cells } = g;
  if (cells[i] !== EMPTY) return false;
  const night = nightMask(g);
  const r0 = rowOf(i, cols);
  const c0 = colOf(i, cols);
  const opp = other(player);
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    let n = 0;
    let asleepOnLine = false;
    while (r >= 0 && r < rows) {
      const j = index(r, c, cols);
      if (j === i) {
        if (n > 0) return true; // a ring closure: legal even through the night
        break;
      }
      const v = cells[j];
      if (v === opp) {
        n++;
        if (night && night[colOf(j, cols)]) asleepOnLine = true;
      } else {
        if (v === player && n > 0 && !asleepOnLine) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return false;
}

export function legalMoves(g, player = g.current) {
  const moves = [];
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === EMPTY && isLegal(g, i, player)) moves.push(i);
  return moves;
}

/** Enemy discs a supernova on cell i would flip (its 8 neighbours, round the ring; asleep ones are spared). */
export function novaCells(g, i, player = g.current) {
  const { rows, cols, cells } = g;
  const opp = other(player);
  const out = [];
  const r0 = rowOf(i, cols);
  for (const [dr, dc] of DIRS) {
    const r = r0 + dr;
    if (r < 0 || r >= rows) continue;
    const j = index(r, colOf(i, cols) + dc, cols);
    if (cells[j] === opp && !asleep(g, j)) out.push(j);
  }
  return out;
}

/** After every ply: count it, and slide a band if a tectonic shift is due. Returns the shift or null. */
function advance(g) {
  g.ply++;
  if (!g.rules.tectonic || g.ply % TECTONIC_EVERY) return null;
  const s = shiftAt(g, g.ply / TECTONIC_EVERY);
  rotateRow(g, s.row, s.k);
  return s;
}

/** Play a cell (or PASS, only allowed when there is no legal move). Returns the history entry or null. */
export function play(g, move) {
  const player = g.current;
  if (move === PASS) {
    if (legalMoves(g, player).length) return null;
    g.current = other(player);
    const shift = advance(g);
    return g.history.push({ player, move: PASS, lines: [], flipped: [], nova: [], shift });
  }
  const lines = captureLines(g, move, player);
  if (!lines.length) return null;
  const flipped = [...new Set(lines.flat())];
  let nova = [];
  const star = !!g.stars[move];
  if (star) {
    nova = novaCells(g, move, player).filter((j) => !flipped.includes(j));
    flipped.push(...nova);
    g.stars[move] = 0;
  }
  g.cells[move] = player;
  for (const j of flipped) g.cells[j] = player;
  g.current = other(player);
  const shift = advance(g);
  return g.history.push({ player, move, lines, flipped, nova, star, shift });
}

/** Take back the last move (or pass). Returns its entry, or undefined. */
export function undo(g) {
  const e = g.history.pop();
  if (!e) return undefined;
  if (e.shift) rotateRow(g, e.shift.row, -e.shift.k); // undo the slide first: the cells below are pre-shift
  g.ply--;
  if (e.move !== PASS) {
    g.cells[e.move] = EMPTY;
    for (const j of e.flipped) g.cells[j] = other(e.player);
    if (e.star) g.stars[e.move] = 1;
  }
  g.current = e.player;
  return e;
}

export function scores(g) {
  const s = { [P1]: 0, [P2]: 0 };
  for (const v of g.cells) if (v === P1 || v === P2) s[v]++;
  return s;
}

/** Would `player` have a move if nobody were asleep? (night: the game isn't over while dawn could help) */
function movesIgnoringNight(g, player) {
  const saved = g.rules.night;
  g.rules.night = false;
  const n = legalMoves(g, player).length;
  g.rules.night = saved;
  return n;
}

/**
 * Over: neither player can move. With the night rule a locked board may unlock when the night moves on,
 * so the game only ends once nobody could move even in daylight, or after a full turn of the night of passes.
 */
export function isOver(g) {
  if (legalMoves(g, P1).length || legalMoves(g, P2).length) return false;
  if (!g.rules.night) return true;
  if (!movesIgnoringNight(g, P1) && !movesIgnoringNight(g, P2)) return true;
  const e = g.history.entries;
  return e.length >= g.cols && e.slice(-g.cols).every((x) => x.move === PASS);
}

/** over: the game has ended. winner: P1 | P2 | 0 (draw) | null (still playing). */
export function status(g) {
  const s = scores(g);
  const over = isOver(g);
  return { over, scores: s, winner: over ? (s[P1] === s[P2] ? 0 : s[P1] > s[P2] ? P1 : P2) : null };
}

/** The player to move has no move, but the game goes on: they must pass. */
export const mustPass = (g) => !legalMoves(g).length && !isOver(g);
