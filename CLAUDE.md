# Game Lab 3D: project guide for Claude

A starter kit for 3D browser games (Three.js + Vite, plain JavaScript, ES modules), used in a 3.5-hour exam.
**The task: each student (individual work) designs and builds their own 3D puzzle game from scratch.** The student
comes up with the concept, the mechanics and the visuals; they're judged on concept and creativity, mechanics,
and visuals and feel, in a game that actually plays (see the task in `README.md`). The kit provides an engine with
ready services (look presets and post effects, board helpers, effects, audio, AI, physics, controllers), a showcase
game, and deploy/submit tooling. Students hand in a **deployed link** plus a **code zip**, so the game must build and
deploy cleanly (see `docs/DEPLOY.md`).

**Your role:** help the student realise *their* idea. Don't decide the concept, mechanics or look for them, and
don't copy or reskin `orb-othello`. If they're stuck, ask questions and offer a few contrasting directions for
them to choose from and shape. Then build in small, playable steps and let them review each one.

## Commands
- `npm install`: once, after cloning
- `npm run dev`: dev server at http://localhost:5173 with hot reload. Keep it running in its own terminal. If the port is busy Vite picks the next one, so read its output.
- `npm test`: Vitest tests (engine logic, the showcase game, submit tooling, safety guard). Run after logic changes.
- `npm run build`: production build into `dist/` (works from any sub-path)
- `npm run build:single`: one self-contained `dist-single/index.html` (≤15 MiB) for publishing as a Claude Code artifact
- `npm run preview:artifact`: serve that file with artifact-like security rules, to check it before publishing
- `npm run submit`: tests + both builds + `submission/<studentId>_<Student_Name>.zip`. Set `studentId` and `studentName` in `src/config.js` first.

## Layout
```
src/
  main.js            boots the engine, opens CONFIG.startGame or ?game=<id>, else the game menu
  config.js          studentId + studentName, startGame, render settings (quality: auto/low/medium/high)
  style.css          HUD/menu theme (CSS variables at the top)
  engine/            reusable services, shared by every game. Don't put game-specific code here.
    engine.js        renderer, scene, camera, loop, lights()/ground()/sky(), physics() loader
    look.js          engine.look: preset('sunset'|'night'|'neon'|'toon'…), set({bloom, ao, fog, grade…}), palette,
                     toon/glow/glass materials, scatter (instanced dressing), ground styles, auto quality
    controllers.js   thirdPerson / firstPerson / topDown / vehicle: input + movement + camera, tuned game feel
    animator.js      animation state machine for glTF characters: play('run'), locomotion(speed), once('attack')
    input.js         keyboard (isDown/wasPressed/axis/move), mouse delta, pointer lock, gamepad, onClick, pick, pickGround
    camera.js        rigs: orbit / follow / fixed, plus damping helpers
    assets.js        model() glTF/GLB loading, fit(), animate() (play/once), texture(), shadows()
    audio.js         sfx(preset), note(), play(file), music(file), sequence(melody), volumes
    effects.js       tween + EASE, burst (particles), shake, floatText, flash, bloom
    physics.js       cannon-es wrapper: add(mesh,{mass}), push, setVelocity, onCollide, teleport
    ui.js            text, button, panel, select, slider, bar, toast, menu (async)
    players.js       N players, turns, scores, "out" players, human vs AI
    ai.js            bestMove (minimax/alpha-beta for any turn game); seek/flee/arrive/pursue/wander
    board.js         board/puzzle helpers: cellPicker (hover + click → cell), createHistory (undo to the human's turn),
                     instancedPieces, placePiece / flipPiece / cascadeDelays animations
    paths.js         asset URL resolving (sub-paths, single-file build); loadAssetBuffer(path)
    events.js        tiny event bus
  games/
    index.js         GAME REGISTRY: id → { title, description, load }
    _template/       blank starting point. Copy it for a new game.
    orb-othello/     showcase: Othello on a wrapping planet, shader board, flip cascades, alpha-beta AI, themed HUD
public/assets/       the game's files (models, sounds, music, fonts), loaded as '/assets/…'. The few files here belong
                     to orb-othello. Credit everything new in CREDITS.md.
scripts/             build-single, submit, build-id, preview-artifact (Node only, no packages)
docs/                DEPLOY.md (students), GRADING.md (teacher)
tests/               engine/, orb-othello/, guard.test.js, submit.test.js
```

## How a game works
A game is `src/games/<id>/index.js` exporting `default { async setup(engine) { … } }`, registered in `src/games/index.js`.
In `setup`: build the scene, create the HUD, subscribe with `engine.onUpdate((dt, time) => …)`, and use `input`, `audio`, `fx`, `ui`, `look`.
Keep tunable numbers in a `SETTINGS` object at the top of the game file. For a bigger game, split it into files in its folder
(for example `logic.js` with no Three.js, so it can be unit tested, plus `view.js` and `ai.js`), as `orb-othello/` does.
The engine is created once per page; switching games reloads the page (`?game=<id>`), so games don't need cleanup code.
Debug in the browser console: `engine` (and `orb` in the showcase) is on `window` in dev.

Project skills in `.claude/skills/`: `new-game`, `3d-models`, `sound`, `effects-polish`, `controllers`, `physics`, `game-ai`.

Fast path to a good-looking puzzle: `engine.look.preset(...)` first, `board.js` for cells and pieces, shapes with
`look.toon`/`look.glow`/`look.glass` and a `look.palette` (or downloaded models), then spend the time on the
student's own mechanics and juice.

## Conventions
- Build the student's game in **its own folder** under `src/games/`. Read `orb-othello/` for patterns; don't edit it unless asked.
- Use engine services before writing new infrastructure. If something reusable is missing, add it to `src/engine/` with a short header comment, the way the existing files do.
- Match the existing style: small files, plain objects and functions, short comments that explain *why*.
- Pure logic (rules, scoring, AI) goes in files with no Three.js/DOM, with a test in `tests/`.
- After changes: run `npm test`, then reload the browser and actually play. Check the console (F12) for errors.
- Keep it fast on school laptops: low-poly models, few shadow-casting lights, ~100s of meshes (use `look.scatter` for many copies). `quality: 'auto'` steps effects down when FPS drops.

## Assets and licences
- The kit ships no asset library: the look is the student's design. Simple shapes + presets are a valid choice.
- To use models or recorded sounds, download, textures and sounds into `public/assets/<type>/` and load them from there. The game must work offline in the exam room.
- Only use assets that allow reuse: CC0 is preferred (Kenney, Quaternius, KayKit, Poly Pizza CC0, Poly Haven, ambientCG). Add each one to `public/assets/CREDITS.md`.
- Prefer `.glb`/`.gltf` models. Keep each file small (a few MB at most).
- Write asset paths as plain `'/assets/…'` strings in the code: the single-file build embeds only paths it can find. Paths built at runtime must also be listed in an `export const ASSETS = [...]`.

## Deploying and submitting
- Follow `docs/DEPLOY.md`. When the student asks, you may build, run `npm run submit`, and publish `dist-single/index.html` as a Claude Code artifact.
- Steps that need a browser or an account (sharing the artifact, GitHub Pages, Netlify/Vercel Drop, Render) are done by the students: give them the exact clicks. Don't use deploy CLIs or git remotes.
- Set `startGame` in `src/config.js` to the student's game before building, so the deployed link opens straight into it.

## Safety rules (exam computers; these are not optional)
- Only create or edit files **inside this project folder**. Never touch system files, shell config or other folders.
- Never use administrator commands, global installs, pushing to git remotes, piping downloads into a shell, or deleting outside the project.
- Downloading **asset files** (models, images, sounds) into `public/assets/` is fine. Never download and run scripts or executables.
- Don't add npm packages unless the student asks for one; the kit already has three, cannon-es, vite and vitest.
- The game is a static web page: no servers besides Vite, no accounts, no tracking, no network calls at runtime (everything ships in the build).
- A guard hook (`.claude/hooks/guard.mjs`) blocks most of the above. Don't try to work around it. If it blocks something, explain the block to the user. If the block was a false positive (for example, text that only *mentions* a blocked word), use the Write/Edit tools instead of Bash.
