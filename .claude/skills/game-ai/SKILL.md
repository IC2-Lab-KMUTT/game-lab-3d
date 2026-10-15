---
name: game-ai
description: Add computer-controlled opponents or characters to a Game Lab 3D game: minimax/alpha-beta for turn-based games, steering (chase, flee, wander, pursue) for real-time enemies and NPCs, simple state-machine behaviours, and difficulty levels. Use when the user wants an AI player, enemies, bots or NPCs.
---

# Game AI

`src/engine/ai.js` has two toolkits. Neither needs Three.js, so AI code can be unit tested.

## Turn-based: `bestMove(state, options)`
Works for any game where players alternate moves (board, card or puzzle games). Describe your game in 4–5 functions:
```js
import { bestMove } from '../../engine/ai.js';
const move = bestMove(game, {
  moves: (g) => g.legalMoves(),
  play: (g, m) => g.play(m),     // mutate…
  undo: (g, m) => g.undo(),      // …and revert. Or omit undo and make play return a NEW state.
  evaluate: (g) => score,        // from the view of the player TO MOVE: + good for them, − bad
  isOver: (g) => g.finished,
  depth: 4, timeLimitMs: 700,    // iterative deepening: always answers within the time limit
  order: (g, moves) => moves,    // optional: most promising first, which makes it much faster
});
```
- **Don't freeze the page while it thinks**: `await bestMoveAsync(game, { ...same options, sliceMs: 5, pause: () => new Promise(requestAnimationFrame), cancelled: () => stale })` runs the same search in small slices, one per frame, so animations keep playing (no Web Worker needed). `timeLimitMs` counts thinking time only. `orb-othello/ai.js → chooseMoveAsync` uses it.
- **Write the evaluation first** and test it, because it decides how smart the AI is. `orb-othello/ai.js` is a worked example: position weights, mobility and stable discs, with difficulty levels.
- If a player has just won, `evaluate` should return a big negative number (the player to move has lost).
- Give the AI a **clone** of the game state, so the search can't break the real game.
- Check immediate wins and blocks before searching (for example a `urgentMove(state)` helper). It's cheap and stops silly blunders.
- With more than 2 players, negamax is only approximate. A greedy one-move-lookahead is often good enough.

## Real-time: steering
```js
import { seek, flee, arrive, pursue, wander } from '../../engine/ai.js';
const v = seek(enemy.position, player.position, speed);   // returns {x, z} velocity
enemy.position.x += v.x * dt;
enemy.position.z += v.z * dt;
```
- `flee(pos, threat, speed, radius)` runs away only while the threat is closer than `radius`.
- `arrive` slows down near the target. `pursue` aims where a moving target will be. `wander(stateObj, speed, dt)` gives random roaming.
- Combine behaviours by adding velocities: `seek` toward a goal plus `flee` from danger.
- **Behaviour states**: `let mode = 'patrol'`, switch to `'chase'` when the player is within 6 units, and back again when they're far away. A simple `if`/`switch` in `onUpdate` is enough.
- Face the movement direction with `mesh.rotation.y = Math.atan2(v.x, v.z)`.

## Difficulty
- Turn-based: lower the `depth`, shorten `timeLimitMs`, or play a random legal move X % of the time.
- Real-time: change the speed, the reaction delay, or the vision radius. Ramp up over time.
- Expose it in the UI: `ui.select('Difficulty', [['easy','Easy'], ['hard','Hard']], 'easy', setDifficulty)`.

## Test it
Put AI logic in its own file and test it in `tests/` (does it take a win? does it block? is it always legal? is it fast enough?). See `tests/orb-othello/ai.test.js` and `tests/engine/engine-logic.test.js`.
