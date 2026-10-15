<img src="public/assets/icon.svg" width="64" height="64" alt="">

# Game Lab 3D

A starter kit for making **your own 3D puzzle game** in the browser, in a 3.5-hour exam. This is individual work.

## The task
Design and build **your own 3D puzzle game, from scratch**:

1. **Concept.** Come up with the game idea yourself: what the puzzle is, what the player does, and how they
   win or fail. It must be your own idea, not a copy or reskin of an existing game or of the showcase.
2. **Mechanics.** Design the rules and interactions: how pieces move or change, what makes it challenging,
   how it gets harder (levels, limits, new rules), and what makes it surprising or satisfying.
3. **Visuals and sound.** Decide the look and feel: setting, mood, colours, shapes or models, lighting,
   effects and sound.
4. **Build it.** Turn it into a playable game: a start screen that explains how to play, the puzzle itself,
   feedback for every action, and a win/lose or level-complete moment.
5. **Ship it.** Deploy it and hand in the link plus your code zip (section 5).

You're judged on your **concept and creativity**, your **mechanics**, and your **visuals and feel**, in a game
that actually plays. Use AI tools to help you build it, but the ideas must be yours.

The kit has already made the technical choices for you (engine, rendering, effects, sound, menus, AI helpers,
deploy and submit), so you can spend the time on the game.

## 1. Get it running (5 minutes)
You need **Node.js 20.19 or newer** (`node -v` to check) and git.
```bash
git clone https://github.com/IC2-Lab-KMUTT/game-lab-3d.git
cd game-lab-3d
npm install      # once
npm run dev      # then open the address it prints (usually http://localhost:5173)
```
The game menu opens with the showcase game and the blank template. Leave that terminal running: the page
reloads by itself whenever you save a file. `npm test` (in a second terminal) checks the logic.

## 2. Make your game
1. Copy `src/games/_template/` to `src/games/<your-game>/`.
2. Add it to `src/games/index.js`.
3. Set `studentId`, `studentName` and `startGame: '<your-game>'` in `src/config.js`.
4. Build it.

**Orb Othello** (`orb-othello/`) is a showcase of what the kit can do: rules that wrap round a planet,
optional rule variants, cinematic effects, adaptive music, a computer opponent, themed menus. Read it to learn
how things are done (rules in `logic.js`, AI in `ai.js`, visuals in `view.js`); don't copy it.

What the engine gives you (`src/engine/`):

| Service | Examples |
|---|---|
| `look` | `look.preset('sunset')` / `'night'` / `'neon'` / `'toon'`…, `look.set({ bloom, fog, ao, vignette })`, palettes, glow/toon/glass materials, `scatter` for many copies |
| `board` | for board/puzzle games: hover + click on cells, undo history, place/flip/cascade animations |
| `input` | `isDown('Space')`, `move()` for WASD/arrows, mouse, gamepad, `onClick`, `pick(objects)` |
| `fx` | `tween`, particle `burst`, `shake`, `floatText`, `flash`, slow motion |
| `audio` | `sfx('coin')`, sound files, music and adaptive music layers, little synth melodies |
| `ui` | score text, bars, buttons, menus, toasts |
| `assets` | load `.glb` models, scale them with `fit()`, play animations |
| `ai` | `bestMove` for turn-based opponents (also time-sliced, so the page never freezes) |
| `physics()` | falling, bouncing, stacking, throwing (cannon-es) |
| controllers, `animator` | if your puzzle has a character that walks or a camera you fly: movement + camera, animation states |
| `players` | turns, scores, eliminated players |

## 3. Using AI tools
Open **Claude Code** in this folder. It reads `CLAUDE.md`, which explains the project to it, and it has skills
for this kit: **new-game**, **3d-models**, **sound**, **effects-polish**, **controllers**, **physics** and **game-ai**.
Start by describing *your* concept, mechanics and look in plain words, then build it step by step: for example
"the board is a floating cube of tiles; clicking a tile rotates its whole row, and the goal is to make every
face one colour", "make it look like neon glass at night", or "add an undo button and a move counter".
Then **play the result and review the changes**. You're the designer.

## 4. Models, sounds and music
A puzzle game can look great with simple shapes, good colours and a look preset. If you want models or real
sounds, download them yourself and use only assets you're allowed to reuse (**CC0** is best): kenney.nl,
quaternius.com, KayKit, poly.pizza (check each model's licence), polyhaven.com, ambientcg.com, freesound.org
(filter by CC0). Save them in `public/assets/…` and list each one in `public/assets/CREDITS.md`.

## 5. Deploy and submit
You hand in **a link to your deployed game** and **a zip of your code**. Full steps: [`docs/DEPLOY.md`](docs/DEPLOY.md). Leave 20 minutes for it.
```bash
npm run submit   # tests, builds, and writes submission/<studentId>_<Student_Name>.zip
```
Then publish `dist-single/index.html` as a Claude Code artifact, or use GitHub Pages (or Netlify Drop,
Vercel Drop, Render). The small "build …" label in the game's corner must match your zip's build ID.

## 6. Safety rules
This project includes guard rails (`.claude/settings.json` and `.claude/hooks/guard.mjs`) that stop AI tools from damaging the computer. With them in place, Claude Code:
- only edits files inside this folder
- won't run administrator commands, global installs, pushes to git remotes, or scripts downloaded from the internet
- can't switch on "bypass permissions" mode

Please don't remove these files. While you develop, the game runs only on your own computer (`localhost`); it goes public only when you deploy it.
