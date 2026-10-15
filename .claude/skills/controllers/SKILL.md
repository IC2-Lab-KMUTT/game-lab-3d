---
name: controllers
description: Player movement and cameras for a Game Lab 3D game in minutes: third-person adventure, first-person (FPS) with mouse look, top-down twin-stick shooter, 2.5D platformer, arcade kart/car racing, plus an animation state machine for glTF characters (idle/walk/run blending, jump, one-shot attacks). Covers tuning game feel (acceleration, friction, jump height, coyote time, jump buffer, air control, drift), collisions with level meshes, gamepads, pointer lock, and juice hooks (onJump, onLand, footsteps). Use when the player character should move, jump, drive or look around, when the camera should follow the player, when controls feel floaty, slippery or stiff, or when a character model's animations should play.
---

# Controllers and animator

Don't write movement, jumping, collision and camera code by hand: `src/engine/controllers.js` does all of it in one call,
already tuned to feel good. `src/engine/animator.js` drives a character model's animations.

```js
import { thirdPerson, firstPerson, topDown, vehicle } from '../../engine/controllers.js';
import { animator } from '../../engine/animator.js';
```

## Pick a controller
| game | call | camera |
|---|---|---|
| 3rd-person adventure, collect-a-thon, 3D platformer | `thirdPerson(engine, player, opts)` | orbit (drag mouse / right stick), zoom with wheel |
| fixed-angle chase camera | `thirdPerson(engine, player, { camera: 'follow', followOffset: [0, 6, 8] })` | fixed angle, follows |
| 2.5D side-scroller platformer | `thirdPerson(engine, player, { camera: 'side', floor: null })` | side view; A/D move, W/Space jump, z is locked |
| FPS, walking sim, horror, maze | `firstPerson(engine, { position: [0, 0, 5], colliders })` | the camera is the player; "Click to play" locks the mouse |
| top-down / twin-stick shooter, arena, dungeon | `topDown(engine, player, opts)` | angled overhead, leads towards movement and aim |
| kart, racing, car arena | `vehicle(engine, kart, opts)` | chase cam, wider FOV at speed |

Only one controller should run at a time: call `ctl.destroy()` before creating another.
A controller takes over the camera (it stops any `engine.cameraRig` orbit/follow).

## The player object
Wrap a loaded model in a Group so the Group's origin is at the feet, then hand the Group to the controller:
```js
const robot = await assets.model('/assets/models/my-pack/character.glb');   // see the 3d-models skill
assets.fit(robot.scene, 1.7);              // 1.7 tall, feet at y = 0
const player = new THREE.Group();
player.add(robot.scene);
scene.add(player);
const anim = animator(robot, { engine });  // see Animator below
const ctl = thirdPerson(engine, player, { colliders, animator: anim });
```
Models should face +Z. If yours walks backwards, pass `facing: Math.PI`. A vehicle model faces +Z too.

## Level collision: `colliders` and `floor`
- `colliders`: array of meshes (or groups) you can stand on and bump into. Flat-ish faces are floor (you can stand on
  slopes/ramps), steep faces are walls you slide along. Steps lower than `stepHeight` are walked up (stairs!).
- `floor`: an endless invisible floor at this height (default `0`), so it works with no meshes at all. Set `floor: null`
  when the level has pits or edges to fall off.
- Falling below `killY` (default -20) emits `'fall'` and respawns at `ctl.spawn`. Move the spawn for checkpoints:
  `ctl.spawn.copy(checkpoint.position)`.
- Keep colliders to the level's big pieces (dozens, not thousands): the controller raycasts against them every frame.
- Using physics (`engine.physics()`) instead? Give the player a body and pass it:
  `const body = physics.add(player, { mass: 1, fixedRotation: true, shape: 'box', friction: 0 });`
  `thirdPerson(engine, player, { body, colliders })`. Physics then handles walls; the controller still steers and jumps.

## Reading and reacting (juice!)
```js
ctl.onJump(() => audio.sfx('jump'));
ctl.onLand(({ speed }) => { if (speed > 12) fx.shake(speed * 0.01); fx.burst(player.position, { color: '#ddd', count: 10 }); });
ctl.onStep(() => audio.note(160, { type: 'triangle', duration: 0.04, volume: 0.03 }));   // footsteps
ctl.onFall(() => ui.toast('Whoops!'));
ctl.on('bump', ({ speed }) => fx.shake(speed * 0.02));    // hit a wall (vehicles especially)
ctl.on('fire', ({ origin, direction }) => shoot(origin, direction));   // topDown: click / RT
ctl.on('driftStart', …) / ctl.on('driftEnd', …)            // vehicle
ctl.velocity  ctl.speed  ctl.grounded  ctl.state            // state: idle walk run jump fall (vehicle: idle drive reverse drift air)
ctl.enabled = false                                         // menus, cutscenes, game over: input ignored, gravity continues
ctl.teleport([x, y, z])   ctl.yaw / ctl.pitch (camera angles)   ctl.aim / ctl.aimPoint (topDown)
```

## Tuning the feel
Every number is an option; defaults live in `THIRD_PERSON`, `FIRST_PERSON`, `TOP_DOWN` and `VEHICLE` (exported, read them
for the full list). Put the ones you change in your game's `SETTINGS`:

| feels… | change |
|---|---|
| slippery / on ice | raise `friction` (stopping) and `accel` (starting) |
| stiff / robotic | lower `accel` a bit, lower `turnSpeed` |
| floaty jumps | raise `gravity` (and `jumpHeight` to keep the height) |
| jumps too high / low | `jumpHeight` (in world units). `jumpCut`: how much a short tap shortens the jump |
| can't steer in the air | raise `airControl` (0..1) |
| jumps "don't register" | raise `coyoteTime` (after leaving a ledge) and `jumpBuffer` (before landing) |
| want double jump | `airJumps: 1` |
| too slow / fast | `speed`, `sprintSpeed` (Shift / LB), `crouchSpeed` (FPS, C / Ctrl) |
| camera too close / jittery | `distance`, `pitch`, `cameraSmooth`, `targetHeight`; FPS: `sensitivity`, `bob: 0`, `fov` |
| mouse should be hidden (3rd person) | `pointerLock: true` (click to lock, Esc to release) |
| kart: spins out / won't turn | `grip` (higher = on rails), `driftGrip`, `turnRate`, `fullTurnAt`, `highSpeedTurn` |
| kart: speed | `maxSpeed`, `accel`, `brake`, `reverseSpeed`; `speedFov` for the sense of speed |

Controls (built in): WASD/arrows move, Shift sprint, Space jump (vehicle: handbrake drift), mouse drag or pointer lock to
look. Gamepads work with no setup: left stick, right stick (look/aim), A jump, LB sprint, RT fire / throttle, LT brake.
For your own input: `input.pad()` (stick + buttons), `input.mouse.dx/dy/wheel`, `input.isDown('Mouse0')`,
`input.lockPointer()` / `input.locked` (see the header of `src/engine/input.js`).

## Animator (character animations)
`animator(model, { engine })` finds clips by *state name*, so the same code works for most downloaded characters:
`'idle' 'walk' 'run' 'jump' 'fall' 'land' 'attack' 'hurt' 'death' 'sit' 'crouch' 'wave' 'dance'` match names like
`Idle`, `Running`, `CharacterArmature|Run`, `Punch`, `Sword_Slash`, `Jump_Idle`… (`anim.names` lists the clips).
```js
const anim = animator(robot, { engine, walkSpeed: 2.2, runSpeed: 6 });   // speeds where walk/run look right
anim.play('idle');                         // looping state, cross-fades (fade: 0.2 s)
anim.locomotion(speed);                    // every frame: blends idle → walk → run, speeds clips up so feet don't slide
await anim.once('attack', { speed: 1.4 }); // one-shot on top, then back to whatever was playing
anim.once('death', { hold: true });        // stays on the last frame
anim.cancel('jump');                       // end a one-shot early
anim.has('fall');  anim.state;  anim.timeScale = 0.5;    // slow motion
```
Map unusual names yourself: `animator(model, { engine, map: { run: 'Sprint_Fwd', attack: 'Kick' } })`.
Pass the animator to `thirdPerson`/`topDown` (`animator: anim`) and they drive it: locomotion by speed, a jump one-shot
held until landing, and a fall loop if the model has one. Your own `anim.once('attack')` still plays on top.
Without `engine`, call `anim.update(dt)` yourself. It replaces `assets.animate()` (same `play/once/names/mixer`).

## Testing
Movement math is pure and tested in `tests/engine/controllers.test.js` (`accelerate`, `createJumpTimer`,
`stepVehicle`, `cameraRelative`); clip matching and blending in `tests/engine/animator.test.js`. After tuning, play it:
`npm run dev`, then try jumping onto ledges, walking off edges, running into walls and corners.
