---
name: 3d-models
description: Find, download, load, scale and animate 3D models (characters, props, environments), HDRI skies and textures for a Game Lab 3D game from free online libraries (CC0 first), and track their licences. Use when the user wants real 3D models, characters, animations, textures, skies or a themed environment instead of basic shapes.
---

# Use 3D models

The kit doesn't ship a model library: the look of the game is the student's design. Two good routes:
- **Build it from shapes.** Many great puzzle games are just boxes, spheres, tiles and lights. With
  `engine.look` presets, `look.toon` / `look.glow` / `look.glass` materials and good colours (`look.palette`),
  primitives can look deliberate and polished. No downloads, no licences, nothing to break.
- **Download models** that fit the student's concept, from the sources below.

Ask the student what style they want before picking a pack. Stay inside one or two packs per game:
same-pack assets share a style and scale.

## Where to get models (check the licence of every file)
| Source | What | Licence |
|---|---|---|
| kenney.nl/assets | huge low-poly kits: puzzle pieces, city, space, nature, furniture, characters | CC0 |
| quaternius.com | low-poly packs, many **animated characters** (newer packs have glTF; older ones are FBX/OBJ only) | CC0 |
| kaylousberg.itch.io (KayKit), github.com/KayKit-Game-Assets | dungeon, adventurers, city, space packs; rigged characters | CC0 |
| poly.pizza | search engine over thousands of low-poly models | **check each model** (CC0 or CC-BY) |
| polyhaven.com | realistic models, textures, HDRI skies | CC0 |
| ambientcg.com | PBR textures (wood, metal, stone…) | CC0 |
| sketchfab.com | huge library | per model. Many need a login and many are CC-BY. Filter by "Downloadable". |

Prefer **glTF/GLB** files. Packs often include FBX/OBJ too; pick the GLB/glTF folder. If only FBX/OBJ exist,
`three/addons/loaders/FBXLoader.js` and `OBJLoader.js` work, but GLB is easier.

1. Download into `public/assets/models/<pack-or-name>/`. Unzip the archive inside a scratch folder, and copy
   only the model files you use plus their textures (many Kenney `.glb` files load a `Textures/colormap.png`
   next to them: keep that folder).
2. Add a line to `public/assets/CREDITS.md`: file, source URL, author, licence. CC-BY also needs an in-game credit.
3. Inspect it from the terminal: `node scripts/asset-tools/glb-info.mjs public/assets/models/<folder>`
   (animation clip names, triangles, size, external files it needs).
4. Write the path as a plain string in the code (`'/assets/models/…'`): the single-file deploy build only
   packs paths it can find.

## Loading a model
```js
const tree = await engine.assets.model('/assets/models/my-pack/tree.glb');
engine.assets.fit(tree.scene, 3);         // 3 units tall, centred, standing on y = 0
tree.scene.position.set(4, 0, -2);
engine.scene.add(tree.scene);
```
- `model()` caches the download and returns a **fresh copy** every call, so loading the same file 50 times is fine
  (for hundreds of copies use `engine.look.scatter`, which instances them).
- `fit(obj, size, { by: 'max' })` scales by the largest side instead of the height. Packs use very different
  scales, so always `fit()` to the size your game needs.
- Wrap a model in a `THREE.Group` if you need to rotate or offset it independently.

## Animations
```js
const hero = await engine.assets.model('/assets/models/my-pack/character.glb');
const anim = engine.assets.animate(hero);
console.log(anim.names);              // clip names (also printed by glb-info.mjs)
anim.play('Run');                     // loops, cross-fading from the current clip
await anim.once('Attack', { then: 'Idle' });   // plays once, then returns to Idle
```
Clip names differ by pack (`idle`/`walk` vs `Idle`/`Walking_A`). For a character that walks around, the
animator in `src/engine/animator.js` matches names loosely (see the `controllers` skill).

## Skies and textures
- HDRI skies (download a 1k `.hdr` from polyhaven.com into `public/assets/hdri/`): lighting + reflections +
  background in one file: `engine.look.set({ env: '/assets/hdri/<file>.hdr' })`.
- PBR textures (ambientCG / Poly Haven, 1K jpg): `await engine.assets.texture(url, { repeat: 8 })` for colour;
  add `srgb: false` for the normal and roughness maps.

## Troubleshooting
- **Model is invisible**: it may be tiny or huge; call `fit()`. Check that the path starts with `/assets/` and the file is in `public/assets/`.
- **Model is black or white**: the scene has no lights (`engine.look.preset(...)` or `engine.lights()`), or the textures next to a `.glb`/`.gltf` are missing. Copy the whole folder.
- **"Could not load"**: open the browser console. A 404 means a wrong path. Paths are case-sensitive on some systems.
- **"No animation X"**: the error lists the available clips; names are case-sensitive.
- **Slow or a big deploy file**: too many polygons or big files. Choose low-poly packs, keep each file under a few MB, and use few skinned characters at once. The Claude artifact deploy has a 16 MB limit for everything.
