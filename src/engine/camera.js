// Camera rigs. Pick one per game (or switch between them).
//
//   engine.camera.orbit({ target: [0, 0, 0], distance: 12 })   drag to rotate, scroll to zoom
//   engine.camera.follow(player, { offset: [0, 6, 8] })         chase camera that trails an object
//   engine.camera.fixed([0, 15, 10], [0, 0, 0])                 static camera looking at a point
//   engine.cameraRig.clear()                                     stop any rig (controllers.js does this)
//
// Helpers for writing your own camera (used by src/engine/controllers.js):
//   damp(current, target, rate, dt)        smooth approach that behaves the same at any frame rate
//   dampAngle(current, target, rate, dt)   same, but takes the short way round (radians)
//   orbitOffset(yaw, pitch, distance)      Vector3 from a target to a camera orbiting it
//   cameraClearance(raycaster, from, to, meshes)  how far the camera can go before hitting a wall
import * as THREE from 'three';

/** Exponential smoothing: higher rate = snappier. Frame-rate independent, unlike lerp(a, b, 0.1). */
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Signed shortest difference between two angles, in -PI..PI. */
export const angleDiff = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export const dampAngle = (current, target, rate, dt) => current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));

/** Offset from the target to a camera at `yaw` (around Y, 0 = behind on +Z) and `pitch` (up from horizontal). */
export function orbitOffset(yaw, pitch, distance, out = new THREE.Vector3()) {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance);
}

/** Distance from `from` towards `to` that is free of `meshes` (minus a little padding), so cameras don't clip into walls. */
export function cameraClearance(raycaster, from, to, meshes, padding = 0.25) {
  const dir = to.clone().sub(from);
  const full = dir.length();
  if (!meshes?.length || full < 1e-6) return full;
  raycaster.set(from, dir.divideScalar(full));
  raycaster.far = full;
  const hit = raycaster.intersectObjects(meshes, true)[0];
  raycaster.far = Infinity;
  return hit ? Math.max(0.3, hit.distance - padding) : full;
}
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const v3 = (a) => (Array.isArray(a) ? new THREE.Vector3(...a) : a.clone());

export function createCameraRigs(camera, canvas, onUpdate) {
  let controls = null;
  let stopFollow = null;

  const clear = () => {
    controls?.dispose();
    controls = null;
    stopFollow?.();
    stopFollow = null;
  };

  return {
    orbit({ target = [0, 0, 0], position, distance = 12, minDistance = 3, maxDistance = 40, autoRotate = false, maxPolarAngle = Math.PI * 0.49 } = {}) {
      clear();
      const t = v3(target);
      camera.position.copy(position ? v3(position) : t.clone().add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(distance)));
      controls = new OrbitControls(camera, canvas);
      controls.target.copy(t);
      Object.assign(controls, { enableDamping: true, minDistance, maxDistance, autoRotate, maxPolarAngle });
      stopFollow = onUpdate(() => controls?.update());
      return controls;
    },
    follow(object, { offset = [0, 6, 8], lookAhead = [0, 1, 0], smooth = 5 } = {}) {
      clear();
      const off = v3(offset);
      const look = v3(lookAhead);
      const want = new THREE.Vector3();
      const target = new THREE.Vector3();
      camera.position.copy(object.position).add(off);
      stopFollow = onUpdate((dt) => {
        want.copy(object.position).add(off);
        camera.position.lerp(want, 1 - Math.exp(-smooth * dt));
        camera.lookAt(target.copy(object.position).add(look));
      });
    },
    fixed(position = [0, 10, 10], lookAt = [0, 0, 0]) {
      clear();
      camera.position.copy(v3(position));
      camera.lookAt(v3(lookAt));
    },
    get controls() {
      return controls;
    },
    clear,
  };
}
