---
name: effects-polish
description: Make a Game Lab 3D game look and feel polished: the look API (presets for sky, lighting, fog and post effects such as bloom, ambient occlusion, vignette and colour grading), palettes, glow/toon/glass materials, scattering scenery, quality settings, plus juice (tweens, particle bursts, screen shake, floating text, flashes), camera feel and HUD styling. Use when the user wants visual effects, a theme, a mood (sunset, night, neon, cartoon…), juice, or says the game looks plain, cheap, flat or like a tech demo.
---

# Effects and polish

Two halves: **the look** (`engine.look`: how every frame is lit and coloured) and **the juice** (`engine.fx`: how actions feel).
`look.get()` returns the settings in effect, so a tuned look can be copied into the game.

## 1. Pick a preset, then tune
Do this first, in `setup`, instead of `engine.lights()` / `engine.sky()`. One line gives a sky, sun + shadows, sky lighting, fog, bloom, ambient occlusion, a colour grade and a vignette that already work together.
```js
const { look } = engine;
look.preset('sunset');   // sunny  sunset  night  neon  space  toon  studio  fog-forest
```
Then change only what the game needs. `look.set` keeps everything else; `false` (or 0) turns an effect off:
```js
look.preset('night', { fog: { near: 10, far: 40 } });               // preset + changes in one call
look.set({ sun: { elevation: 15, azimuth: -60, color: '#ffb36b' } }); // low warm sun = long shadows
look.set({ bloom: { strength: 1, threshold: 0.6 } });   // more glow (lower threshold = more things glow)
look.set({ grade: { saturation: 1.3, contrast: 1.1, tint: '#ffd2a8', shadows: '#2a0a4a' } });
look.set({ vignette: 0.5, tiltShift: 0.4, grain: 0.3, aberration: 0.4 }); // lens looks, 0..1
look.set({ ao: false, fog: false, exposure: 1.2 });
look.set({ sky: { top: '#1d2f5a', horizon: '#ff9a62', stars: 800 } });   // or sky: '#10131f' for a flat colour
look.set({ materials: 'toon' });   // every standard material becomes cel-shaded (back with 'standard')
console.log(look.get());           // all current values: tune in the console, paste into the game
```
Which preset: bright/friendly → `sunny` or `toon`; warm/emotional → `sunset`; spooky/stealth → `night` or `fog-forest`; arcade/sci-fi → `neon` or `space`; puzzle/board/product → `studio`.
Rules of thumb: tune **sun angle and colour first**, then fog distance to fit the level size (fog `far` ≈ 2–3× the camera distance), then grade. Change one thing, reload, look.

## 2. Colours that go together
```js
const [dark, mid, main, accent, light] = look.palette('candy');
```
Palettes: `meadow candy sunset ocean forest neon desert space toybox pastel autumn ice lava mono` (`look.palettes`).
Use one palette for the whole game (objects, ground, HUD CSS variables in `src/style.css`). Pick one that matches the preset (`neon` palette + `neon` preset).

## 3. Materials
```js
look.glow('#05d9e8', 3)              // emissive: blooms. Coins, lasers, crystals, eyes, lamps. 2–5 is typical
look.toon('#ff6b9d')                 // cartoon bands (one material); look.set({ materials: 'toon' }) does the whole scene
look.glass({ color: '#bde0fe' })     // see-through. Costs an extra scene render: use for a few hero objects only
new THREE.MeshStandardMaterial({ color, flatShading: true })   // low-poly look; cheap and deliberate
```
Glow only shows when bloom is on (every preset has it). In dark presets (`night`, `neon`, `space`) glowing things are the stars of the frame: give pickups and enemies `look.glow`.

## 4. Fill the scene: ground + scatter
Empty floors look like tech demos. Dress them:
```js
const ground = look.ground({ style: 'island', size: 30, color: '#6a9f4b' });  // plain grid checker noise gradient island
look.scatter(treeModel, { count: 40, area: { inner: 6, outer: 14 }, scale: [0.8, 1.4], seed: 3, minDistance: 1.5 });
look.scatter(grassTuft, { count: 400, area: 14, castShadow: false, colorJitter: 0.25 });
look.scatter(rock, { count: 20, area: [30, 30], on: ground, align: 'normal' });  // sit on (and tilt to) a surface
```
`scatter` takes a mesh or a whole model/group (e.g. from `assets.model`) and draws all copies with `InstancedMesh`: hundreds of objects for a few draw calls. Copies are static (no animation, no physics); move the returned group, not the copies. Same `seed` = same layout every reload. Use three sizes: a few big things (trees, ruins), some medium (rocks, bushes), many small (grass, flowers, pebbles), and leave open space where the player plays.

## 5. Big levels, highlights
```js
look.followShadow(player);              // the sun's shadow box follows the player (crisp shadows in big worlds)
look.set({ sun: { shadowSize: 30 } });  // bigger box = blurrier shadows; keep it as small as the visible area
look.outline([chest], '#ffd166');       // glowing outline for hover/selection; look.outline(null) clears
look.sun, look.hemi, look.rim           // the lights themselves, if you need to animate them (day/night cycle)
```

## 6. Quality (school laptops)
`CONFIG.settings.quality` in `src/config.js`: `'auto'` (default) starts at high and steps down to medium, then low, when the frame rate stays under ~45 fps. `'low'` = pixel ratio 1, no ambient occlusion, FXAA, 1024 shadow map. Read the level in use with `look.quality`; force one with `look.quality = 'low'`; `look.fps` gives the frame rate for an on-screen counter.
Cost, most to least expensive: glass, ambient occlusion (`ao`), extra point lights, many shadow-casting objects, bloom, everything else (grade, vignette, fog are almost free). If it stutters: `look.set({ ao: false })`, `castShadow: false` on scattered small things, fewer point lights.

## Juice toolkit (`engine.fx`)
```js
await fx.tween(mesh.position, { y: 2 }, { duration: 0.4, ease: 'outBack' });  // tweens any numeric properties
fx.tween(mesh.scale, { x: 1, y: 1, z: 1 }, { duration: 0.5, ease: 'outElastic' }); // pop-in from scale 0.01
fx.tween(mesh.material, { opacity: 0 }, { duration: 1 });  // the material needs transparent: true
fx.burst(position, { color: '#ffd166', count: 40, speed: 4, life: 0.8 });  // particles
fx.shake(0.3);                     // camera shake on hits and explosions
fx.floatText('+10', position, { color: '#7CFC00' });
fx.flash('#ff0000');               // damage flash
fx.bloom({ strength: 0.7, threshold: 0.8 });  // same as look.set({ bloom: … }) (older games use this)
```
Eases: `linear inQuad outQuad inOutQuad inOutSine outBack outElastic outBounce`.
Tweens return promises, so chain them: `await fx.tween(a…); await fx.tween(b…);`.
Tween look values too: `fx.tween(look.sun, { intensity: 0.3 }, { duration: 2 })` for a dusk, or `fx.tween(engine.renderer, { toneMappingExposure: 2 }, { duration: 0.2 })` for a flash of light.

## Make every action feel good
For each player action, combine **sound + motion + particles**. A pickup, for example, gets `audio.sfx('coin')`, `fx.burst`, `fx.floatText` and a pop tween.
Big moments (win, death, level up) also get shake/flash, a slow-motion tween, or a camera move.

## Big moments: slow motion
```js
fx.slowMo(0.3, 0.6);           // time runs at 30% for 0.6 real seconds, then eases back (tweens, particles, onUpdate)
engine.timeScale = 0.5;        // or set it yourself; 1 = normal
look.set({ aberration: 0.9 }); // a chromatic "punch": tween it back to 0 over ~0.8 s
```
Stack them for the one moment that matters most (a ring closure, a boss kill): slowMo + flash + shake + a music duck (see `sound`). Keep it under a second; big moments that drag stop feeling big.

## Space scenes (`src/engine/space.js`)
```js
import { bakeSpaceSky, atmosphere, lensFlare } from '../../engine/space.js';
scene.background = bakeSpaceSky(renderer, { size: 1024, seed: 3 });     // nebula + stars, drawn ONCE into a cube map
const atmo = atmosphere(5, { thickness: 0.1 }); scene.add(atmo.mesh);   // glow round a planet of radius 5
atmo.setLight(sunDirection);                                            // blue lit limb, sunset band, dim night side
const flare = lensFlare({ color: '#9cc4ff' }); scene.add(flare.group);  // glow, rays, streak and ghosts
engine.onUpdate(() => flare.update(camera, starDirection, { occluder: { center: planetPos, radius: 5.2 } }));
```
- Baking is the trick for anything made of many noise layers (skies, planet surfaces): paint it once into a texture at load and the per-frame cost is one texture read. `orb-othello/planet.js` bakes a whole planet (continents, ice, clouds, city lights) that way.
- In shaders, never `pow()` a value that can go negative (or a varying that can land a hair outside 0..1 with MSAA): the result is NaN, and bloom smears one NaN pixel over the whole screen (black frame).
- Scale heavy effects with `look.quality`: `orb-othello` turns bloom off on `low` (no post passes at all) and uses a CSS vignette instead of the post one.

## Other polish
- **Camera**: `engine.cameraRig.follow(obj, { offset: [0, 8, 8], smooth: 5 })` for action games; a high 3/4 view shows off the ground dressing. Orbit for board games and sandboxes.
- **HUD**: `ui.text(…, pos, { big: true })`, `ui.bar(...)`, `ui.toast(...)`. Restyle through `src/style.css` with the palette colours.
- **Older calls still work**: `engine.lights()`, `engine.ground()`, `engine.sky()`. Don't mix them with a preset in the same game; the preset is better.
- **Look at it**: after each change, reload and actually look (and squint: is the player the brightest/most saturated thing?). Subtract effects before adding more.
