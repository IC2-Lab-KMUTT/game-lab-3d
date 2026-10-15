import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPhysics } from '../../src/engine/physics.js';

const run = (physics, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) physics.step(1 / 60);
};

const ground = () => {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(20, 20));
  g.rotation.x = -Math.PI / 2;
  return g;
};

describe('physics', () => {
  it('a box falls and comes to rest on the ground', () => {
    const physics = createPhysics();
    physics.add(ground(), { mass: 0 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    box.position.set(0, 5, 0);
    physics.add(box, { mass: 1 });
    run(physics, 3);
    expect(box.position.y).toBeCloseTo(0.5, 1);
  });

  it('a group (e.g. a loaded model with feet at y=0) rests on its feet', () => {
    const physics = createPhysics();
    physics.add(ground(), { mass: 0 });
    const model = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    body.position.y = 1; // like assets.fit(): the model's origin is at its feet
    model.add(body);
    model.position.set(0, 3, 0);
    physics.add(model, { mass: 1, fixedRotation: true });
    run(physics, 3);
    expect(model.position.y).toBeCloseTo(0, 1);
  });

  it('reports collisions with the other mesh', () => {
    const physics = createPhysics();
    const floor = ground();
    physics.add(floor, { mass: 0 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5));
    ball.position.set(0, 2, 0);
    physics.add(ball, { mass: 1 });
    let hit = null;
    physics.onCollide(ball, (other) => (hit = other));
    run(physics, 2);
    expect(hit).toBe(floor);
  });
});
