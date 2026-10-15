---
name: physics
description: Add rigid-body physics to a Game Lab 3D game with the built-in cannon-es wrapper: gravity, falling/stacking/bouncing objects, throwing, pushing, collisions, ragdoll-ish chaos, marble or golf games. Use when objects should fall, bounce, collide, roll or be thrown realistically.
---

# Physics

Physics is optional and loads only when a game asks for it:
```js
const physics = await engine.physics({ gravity: -9.82 });

const ground = engine.ground();
physics.add(ground, { mass: 0 });             // mass 0 = static: never moves

const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
crate.position.set(0, 5, 0);
scene.add(crate);                              // add to the scene first
physics.add(crate, { mass: 1, friction: 0.4, restitution: 0.2 });   // shape is guessed from the geometry
```
The engine steps the world every frame and copies each body's position and rotation onto its mesh.

## API
| call | does |
|---|---|
| `add(mesh, { mass, shape, friction, restitution, fixedRotation, damping })` | shape: `'box' 'sphere' 'cylinder' 'plane'`, or a `physics.CANNON` shape |
| `push(mesh, {x,y,z})` | instant kick (impulse) |
| `setVelocity(mesh, {x,y,z})` | set the speed directly (throwing, jumping) |
| `teleport(mesh, position)` | move it and stop it (respawning) |
| `onCollide(mesh, (otherMesh, event) => …)` | collision callback; `event.contact.getImpactVelocityAlongNormal()` gives the hit strength |
| `remove(mesh)` | take it out of the simulation (also `scene.remove(mesh)`) |
| `physics.world`, `physics.CANNON` | raw cannon-es for anything else (constraints, raycasts) |

## Patterns
- **Throw from the camera**: `input.pick([], event)` aims `input.raycaster`, then call `setVelocity(ball, ray.direction × speed)`.
- **Player character on physics**: use a sphere body with `fixedRotation: true`, call `setVelocity` from `input.move()` (keep the current y velocity), and jump when grounded.
- **Imported models**: give the body a simple shape (box or sphere) matching the model's size. Put the model inside a mesh or group that the body drives, and don't use the detailed geometry as a shape.
- **Hit sounds**: in `onCollide`, play `audio.sfx('hit', { volume: impact / 40 })`, rate-limited so it doesn't spam.
- **Clean up**: cap the number of spawned bodies (remove the oldest), as the playground does with balls.
- Physics meshes must be **direct children of the scene** (no transformed parent groups).
