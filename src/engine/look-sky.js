// Cheap stylised sky for engine.look: a gradient dome (top / horizon / bottom colours) with a
// soft sun glow, optional starfield and nebula. Used by look.js; you normally don't call it.
//
//   const sky = createSky();  scene.add(sky.mesh);
//   sky.set({ top: '#3b2c66', horizon: '#ff9a62', bottom: '#5b3a5e', sun: 0.9, stars: 1500 }, sunDirection)
//
// The dome is drawn at infinite distance in the shader, so it never clips against the camera's
// far plane and needs no per-frame "follow the camera" code.
import * as THREE from 'three';
import { random } from './look-data.js';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
    gl_Position = p.xyww; // depth = 1: always behind everything
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 top, horizon, bottom, sunColor, sunDir;
  uniform float sunSize, nebula;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 51.3))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 d = normalize(vDir);
    // soft curves rather than linear bands: most of the sky is near the horizon colour
    float up = pow(max(d.y, 0.0), 0.55);
    float down = pow(max(-d.y, 0.0), 0.4);
    vec3 col = mix(horizon, top, up);
    col = mix(col, bottom, down);
    if (nebula > 0.0) {
      vec3 q = d * 3.0;
      float n = noise(q) * 0.5 + noise(q * 2.1) * 0.25 + noise(q * 4.3) * 0.125;
      float band = exp(-abs(d.y + 0.15 * sin(d.x * 3.0)) * 3.0);
      col += nebula * band * smoothstep(0.35, 0.85, n) * mix(vec3(0.45, 0.15, 0.6), vec3(0.1, 0.35, 0.7), noise(q * 0.7));
    }
    float s = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(s, 6.0) * 0.25 + pow(s, 64.0) * 0.6 + smoothstep(0.9993, 0.9996, s) * 3.0) * sunSize;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createSky() {
  const uniforms = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    bottom: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color('#fff1d6') },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunSize: { value: 0.4 },
    nebula: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'look-sky';

  // Stars: one Points cloud on a far sphere. Bright (> 1) so bloom gives them a twinkle halo.
  let stars = null;
  const makeStars = (count) => {
    if (stars) (stars.geometry.dispose(), mesh.remove(stars));
    stars = null;
    if (!count) return;
    const rand = random(7);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tint = [new THREE.Color('#ffffff'), new THREE.Color('#bcd2ff'), new THREE.Color('#ffe0b8')];
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(rand() * 2 - 1, rand() * 1.1 - 0.1, rand() * 2 - 1).normalize();
      pos.set([v.x, v.y, v.z], i * 3);
      const c = tint[i % 3].clone().multiplyScalar(0.4 + rand() ** 3 * 2.6);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 color; varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
          gl_Position = p.xyww;
          gl_PointSize = 1.0 + 2.0 * clamp(dot(color, vec3(0.33)) - 0.4, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vColor * smoothstep(0.5, 0.1, d), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    stars = new THREE.Points(g, m);
    stars.frustumCulled = false;
    stars.renderOrder = -999;
    mesh.add(stars);
  };

  let starCount = 0;
  return {
    mesh,
    /** Apply sky settings. `sunDir` is a normalised Vector3 pointing towards the sun. */
    set({ top, horizon, bottom, sun = 0.4, stars: count = 0, nebula = 0 } = {}, sunDir, sunColor) {
      uniforms.top.value.set(top);
      uniforms.horizon.value.set(horizon);
      uniforms.bottom.value.set(bottom ?? horizon);
      uniforms.sunSize.value = sun;
      uniforms.nebula.value = nebula;
      if (sunDir) uniforms.sunDir.value.copy(sunDir);
      if (sunColor) uniforms.sunColor.value.set(sunColor);
      if (count !== starCount) makeStars((starCount = count));
    },
  };
}
