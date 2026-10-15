// Optional rigid-body physics (cannon-es). Only loaded by games that call engine.physics().
//
//   const physics = await engine.physics({ gravity: -9.8 });
//   physics.add(groundMesh, { mass: 0 });                 // mass 0 = static (never moves)
//   physics.add(crateMesh, { mass: 1 });                  // shape guessed from the geometry
//   physics.add(ballMesh, { mass: 2, shape: 'sphere', restitution: 0.6 });
//   physics.push(ballMesh, new THREE.Vector3(0, 5, -10)); // instant kick (impulse)
//   physics.onCollide(ballMesh, (other) => …);            // other = the mesh it hit
//
// The engine steps the world every frame and copies body positions onto your meshes.
// Need something fancier? `physics.CANNON` and `physics.world` are the raw cannon-es objects.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export function createPhysics({ gravity = -9.82 } = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  const linked = new Map(); // mesh → body
  const meshOf = new Map(); // body → mesh

  const shapeFor = (mesh, kind) => {
    const geo = mesh.geometry;
    let size;
    if (geo) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      size = geo.boundingBox.getSize(new THREE.Vector3()).multiply(mesh.scale);
    } else {
      // A Group or loaded model: measure everything inside it (world size; keep it unrotated when adding).
      size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    }
    const geoType = geo?.type ?? '';
    const type = kind ?? (geoType.startsWith('Sphere') ? 'sphere' : geoType.startsWith('Plane') ? 'plane' : geoType.startsWith('Cylinder') ? 'cylinder' : 'box');
    if (type === 'sphere') return new CANNON.Sphere(Math.max(size.x, size.y, size.z) / 2);
    if (type === 'cylinder') return new CANNON.Cylinder(size.x / 2, size.x / 2, size.y, 16);
    if (type === 'plane') return new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, 0.05));
    return new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
  };

  return {
    CANNON,
    world,
    /** Give `mesh` a physics body. Options: mass, shape ('box'|'sphere'|'cylinder'|'plane'), friction, restitution, fixedRotation. */
    add(mesh, { mass = 1, shape, friction = 0.4, restitution = 0.2, fixedRotation = false, damping = 0.05 } = {}) {
      const body = new CANNON.Body({
        mass,
        material: new CANNON.Material({ friction, restitution }),
        fixedRotation,
        linearDamping: damping,
        angularDamping: damping,
      });
      mesh.updateMatrixWorld(true);
      // Models/groups: centre the collision shape on the visible model, not on its origin.
      const offset = new CANNON.Vec3();
      if (!mesh.geometry) {
        const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).sub(mesh.getWorldPosition(new THREE.Vector3()));
        offset.set(c.x, c.y, c.z);
      }
      body.addShape(shape instanceof CANNON.Shape ? shape : shapeFor(mesh, shape), offset);
      const p = mesh.getWorldPosition(new THREE.Vector3());
      const q = mesh.getWorldQuaternion(new THREE.Quaternion());
      body.position.set(p.x, p.y, p.z);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      world.addBody(body);
      linked.set(mesh, body);
      meshOf.set(body, mesh);
      return body;
    },
    remove(mesh) {
      const body = linked.get(mesh);
      if (!body) return;
      world.removeBody(body);
      linked.delete(mesh);
      meshOf.delete(body);
    },
    body: (mesh) => linked.get(mesh),
    push(mesh, impulse) {
      const body = linked.get(mesh);
      body?.wakeUp();
      body?.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y, impulse.z));
    },
    setVelocity(mesh, v) {
      const body = linked.get(mesh);
      body?.wakeUp();
      body?.velocity.set(v.x, v.y, v.z);
    },
    teleport(mesh, position) {
      const body = linked.get(mesh);
      if (!body) return;
      body.position.set(position.x, position.y, position.z);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      mesh.position.copy(position);
    },
    onCollide(mesh, fn) {
      const body = linked.get(mesh);
      const handler = (e) => fn(meshOf.get(e.body), e);
      body.addEventListener('collide', handler);
      return () => body.removeEventListener('collide', handler);
    },
    /** Called by the engine every frame. Meshes must be direct children of the scene (no parent transforms). */
    step(dt) {
      world.step(1 / 60, dt, 5);
      for (const [mesh, body] of linked) {
        if (body.mass === 0) continue;
        mesh.position.set(body.position.x, body.position.y, body.position.z);
        mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
    },
  };
}
