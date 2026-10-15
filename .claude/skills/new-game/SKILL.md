---
name: new-game
description: Start or restructure a student's own 3D puzzle game in Game Lab 3D: turn the student's concept into a plan, create the game folder from the template, register it, choose turn-based or real-time structure, menus and game states, local multiplayer, scoring and win/lose conditions. Use when the user describes a game idea or wants to begin building.
---

# Start a new game

The exam task is a **3D puzzle game the student designs from scratch**: the concept, the visuals and the
mechanics are theirs. Before writing code, get the student to say (or write down in a few lines):
- **Concept:** what is the puzzle, what does the player do, how do they win or fail?
- **Mechanics:** the rules, what makes it get harder (levels, limits, timers, new pieces), what's surprising.
- **Visuals and sound:** the setting, mood, colours and style.

If they're stuck, ask questions and offer a few different directions to react to, but let them choose and
shape the idea; don't hand them a finished concept or a reskin of `orb-othello`. Then build it in small,
playable steps.

## 1. Create it
1. Copy `src/games/_template/` to `src/games/<id>/`. Use a short kebab-case id, for example `space-golf`.
2. Add it to `src/games/index.js`: `'<id>': { title, description, load: () => import('./<id>/index.js') }`.
3. Set `CONFIG.startGame = '<id>'` in `src/config.js`, so the dev server opens it directly.
4. Run `npm run dev`, open the URL Vite prints, and check that the template cube appears.

## 2. Pick the closest example to learn from
| The idea is… | Read |
|---|---|
| turn based: board, puzzle, strategy, vs computer | `orb-othello/` (pure rules in `logic.js`, AI in `ai.js`, visuals in `view.js`/`planet.js`, HUD in `hud.js`) |
| things that fall, bounce, stack or get thrown | the `physics` skill |
| a character that walks/runs on the board (e.g. a Sokoban-style puzzle) | the `controllers` skill |
| a mood/look (sky, lighting, glow, fog, toon) | the `effects-polish` skill (`engine.look` presets) |
| models, sounds and music | the `3d-models` and `sound` skills (shapes + presets, or downloaded CC0 assets) |

## 3. Shape of a game file
```js
const SETTINGS = { /* every tunable number lives here */ };

export default {
  async setup(engine) {
    const { THREE, scene, input, audio, fx, ui, assets } = engine;
    // world: engine.look.preset('sunset'), look.ground(), shapes or downloaded models, look.scatter(...)
    // board: cellPicker / createHistory / placePiece from engine/board.js (section 5)
    // HUD: ui.text / ui.bar / ui.button
    // state: let state = 'menu';  // 'menu' | 'playing' | 'over'
    const start = () => { /* reset everything */ state = 'playing'; };
    const gameOver = async (title) => {
      state = 'over';
      await ui.menu({ title, text: '…', buttons: ['Play again'] });
      start();
    };
    engine.onUpdate((dt, time) => {
      if (state !== 'playing') return;
      // movement, rules, collisions, win/lose checks
    });
    await ui.menu({ title: 'My Game', text: 'How to play…', buttons: ['Start'] });
    start();
  },
};
```
- Movement is `speed * dt`, so it runs at the same speed on every computer.
- Write a `start()` that fully resets the state, so "Play again" works.
- For collisions without physics, compare distances (`a.position.distanceTo(b.position) < r`).

## 4. Players
- **Local multiplayer on one keyboard**: `input.move('wasd')` for player 1 and `input.move('arrows')` for player 2.
- **Turns / hot-seat**: `createPlayers([...])` from `src/engine/players.js` provides `current`, `next()`, scores, and `out` for eliminated players.
- **Computer opponents**: see the `game-ai` skill.
- Online multiplayer is out of scope: the exam rules allow no servers.

## 5. Board and puzzle games: `src/engine/board.js`
Ready-made pieces for anything with cells and pieces (see `orb-othello/` for all of them in use):
```js
import { cellPicker, createHistory, instancedPieces, placePiece, flipPiece, cascadeDelays } from '../../engine/board.js';
const picker = cellPicker(engine, { targets: [boardMesh], cellAt: (hit) => cellId, onHover: (cell) => …, onPick: (cell) => … });
const history = createHistory();   // push({ player, move }); vs AI: undo history.stepsBackTo((e) => e.player === human) moves
const pieces = instancedPieces(engine, geometry, materials, 64);   // pieces.at(i) moves like a mesh; one draw call for all
await placePiece(engine, pieces.at(i), { up });                     // drop in with a squash
flipPiece(engine, pieces.at(j), { axis, up, delay, onFlip: () => audio.play(…) });  // hop + half turn
const delays = cascadeDelays(capturedLines, { step: 0.08 });        // cell → delay, so captures ripple outward
```
`createHistory` and `cascadeDelays` have no Three.js, so your pure `logic.js` can use them and be tested.

## 6. Finish
- Fill in `studentId` and `studentName` in `src/config.js` and keep `startGame` pointing at the game: the deployed link opens it directly.
- Deploy and submit following `docs/DEPLOY.md` (`npm run submit`, then a Claude artifact or a fallback host). Leave 20 minutes for it.
- Give the game a start menu explaining the controls, a visible goal, feedback for every action (sound + effect), and an end screen.
- Run `npm test`. Add tests if you wrote pure logic. Play the game start to finish twice, and check the browser console for errors.
