// AI helpers. No Three.js or DOM required (steering works on any {x, z} objects).
//
// TURN-BASED (board games, card games…): describe your game with 4–5 functions and get
// the best move from a depth-limited minimax search (negamax + alpha-beta pruning).
//
//   const move = bestMove(state, {
//     moves: (s) => [...legal moves...],
//     play: (s, m) => …apply m to s…,      // mutate in place…
//     undo: (s, m) => …revert m…,          // …and revert (fast). Or omit undo and return a new state from play.
//     evaluate: (s) => number,              // score from the point of view of the player TO MOVE (+ = good for them)
//     isOver: (s) => boolean,               // optional
//     depth: 3, timeLimitMs: 800,
//   });
//   const move = await bestMoveAsync(state, { ...same options, sliceMs: 8 });
//     Same search, but it pauses every `sliceMs` so the page keeps animating while the computer
//     thinks (no Web Worker needed). timeLimitMs counts thinking time only, not the pauses.
//     Don't change `state` while it runs (search a copy); `cancelled: () => bool` stops it early.
//     In a game, pass `pause: () => new Promise(requestAnimationFrame)` with sliceMs ~5: one slice per
//     frame, after the frame is drawn, so the frame rate stays smooth while the computer thinks.
//
// REAL-TIME (enemies, NPCs): steering behaviours return a velocity to add to a character.
//   enemy.velocity = seek(enemy.position, player.position, 3);
//   flee / arrive / wander / pursue below.

export function bestMove(state, { moves, play, undo, evaluate, isOver = () => false, depth = 3, timeLimitMs = 1000, order } = {}) {
  const deadline = performance.now() + timeLimitMs;
  let timedOut = false;

  const apply = (s, m) => {
    const r = play(s, m);
    return undo ? s : r;
  };

  function negamax(s, d, alpha, beta) {
    if (performance.now() > deadline) timedOut = true;
    if (d === 0 || timedOut || isOver(s)) return evaluate(s);
    let list = moves(s);
    if (!list.length) return evaluate(s);
    if (order) list = order(s, list);
    let best = -Infinity;
    for (const m of list) {
      const next = apply(s, m);
      const score = -negamax(next, d - 1, -beta, -alpha);
      if (undo) undo(s, m);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Iterative deepening: always have an answer, go deeper while there is time.
  let list = moves(state);
  if (order) list = order(state, list);
  let bestSoFar = list[0];
  for (let d = 1; d <= depth; d++) {
    let best = -Infinity;
    let bestAtDepth = list[0];
    for (const m of list) {
      const next = apply(state, m);
      const score = -negamax(next, d - 1, -Infinity, Infinity);
      if (undo) undo(state, m);
      if (timedOut) break;
      if (score > best) [best, bestAtDepth] = [score, m];
    }
    if (timedOut) break;
    bestSoFar = bestAtDepth;
    // Search the best move first next time — makes pruning much more effective.
    list = [bestAtDepth, ...list.filter((m) => m !== bestAtDepth)];
  }
  return bestSoFar;
}

// The same search written as generators: `yield` = "my time slice is used up, let the page breathe".
function* searchGen(state, { moves, play, undo, evaluate, isOver = () => false, depth = 3, order }, clock) {
  const apply = (s, m) => {
    const r = play(s, m);
    return undo ? s : r;
  };
  function* negamax(s, d, alpha, beta) {
    if (clock.due()) yield;
    if (d === 0 || clock.out() || isOver(s)) return evaluate(s);
    let list = moves(s);
    if (!list.length) return evaluate(s);
    if (order) list = order(s, list);
    let best = -Infinity;
    for (const m of list) {
      const next = apply(s, m);
      const score = -(yield* negamax(next, d - 1, -beta, -alpha));
      if (undo) undo(s, m);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  let list = moves(state);
  if (order) list = order(state, list);
  let bestSoFar = list[0];
  for (let d = 1; d <= depth; d++) {
    let best = -Infinity;
    let bestAtDepth = list[0];
    for (const m of list) {
      const next = apply(state, m);
      const score = -(yield* negamax(next, d - 1, -Infinity, Infinity));
      if (undo) undo(state, m);
      if (clock.out()) break;
      if (score > best) [best, bestAtDepth] = [score, m];
    }
    if (clock.out()) break;
    bestSoFar = bestAtDepth;
    list = [bestAtDepth, ...list.filter((m) => m !== bestAtDepth)];
  }
  return bestSoFar;
}

/** Give the browser a turn (render a frame, handle input). MessageChannel avoids setTimeout's 4 ms clamp. */
const breathe = () =>
  new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') return setTimeout(resolve, 0);
    const ch = new MessageChannel();
    ch.port1.onmessage = () => (ch.port1.close(), resolve());
    ch.port2.postMessage(0);
  });

/**
 * bestMove, time-sliced: resolves with the move (or undefined if `cancelled()` became true).
 * Thinking time (timeLimitMs) is counted without the pauses, so the strength matches bestMove.
 */
export async function bestMoveAsync(state, { timeLimitMs = 1000, sliceMs = 8, cancelled, pause = breathe, ...options } = {}) {
  let used = 0;
  let sliceStart = performance.now();
  let out = false;
  const clock = {
    due: () => performance.now() - sliceStart > sliceMs,
    out: () => out || (out = used + performance.now() - sliceStart > timeLimitMs),
  };
  const it = searchGen(state, options, clock);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
    used += performance.now() - sliceStart;
    await pause();
    if (cancelled?.()) return undefined;
    sliceStart = performance.now();
  }
}

/** Pick a random element. */
export const randomChoice = (list) => list[Math.floor(Math.random() * list.length)];

// ---- steering (all on the XZ ground plane; y is ignored) ----
const flat = (from, to) => {
  const x = to.x - from.x;
  const z = to.z - from.z;
  return { x, z, d: Math.hypot(x, z) };
};

/** Velocity towards target at `speed`. */
export function seek(pos, target, speed) {
  const { x, z, d } = flat(pos, target);
  return d < 1e-6 ? { x: 0, z: 0 } : { x: (x / d) * speed, z: (z / d) * speed };
}

/** Velocity away from threat, only while closer than `radius`. */
export function flee(pos, threat, speed, radius = Infinity) {
  const { x, z, d } = flat(threat, pos);
  return d > radius || d < 1e-6 ? { x: 0, z: 0 } : { x: (x / d) * speed, z: (z / d) * speed };
}

/** Like seek, but slows down inside `slowRadius` and stops at the target. */
export function arrive(pos, target, speed, slowRadius = 2) {
  const { d } = flat(pos, target);
  return seek(pos, target, speed * Math.min(1, d / slowRadius));
}

/** Aim at where a moving target will be (target.velocity = {x, z}). */
export function pursue(pos, target, targetVelocity, speed) {
  const { d } = flat(pos, target);
  const t = d / Math.max(speed, 1e-6);
  return seek(pos, { x: target.x + targetVelocity.x * t, z: target.z + targetVelocity.z * t }, speed);
}

/** Random wandering. Keep `state` between frames: const w = {}; wander(w, speed, dt). */
export function wander(state, speed, dt, turnRate = 2) {
  state.angle = (state.angle ?? Math.random() * Math.PI * 2) + (Math.random() - 0.5) * turnRate * dt * 2 * Math.PI;
  return { x: Math.cos(state.angle) * speed, z: Math.sin(state.angle) * speed };
}
