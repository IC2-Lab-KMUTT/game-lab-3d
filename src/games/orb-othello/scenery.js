// Everything around the board that makes it a place: the baked starfield sky with a distant gas giant,
// ice-crystal crowns and auroras on the poles, a tilted ring system, a moon, a few satellites and the
// blue companion star (rim light + lens flare). Decoration only: nothing here can be clicked.
import * as THREE from 'three';
import { bakeSpaceSky, lensFlare } from '../../engine/space.js';

const noClick = (o) => ((o.raycast = () => {}), o);

/** Grey crater field on a canvas (equirectangular), for the moon. */
function craterTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#8f8aa3';
  g.fillRect(0, 0, 512, 256);
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = 20 + r() * 216, rad = 2 + r() ** 3 * 26;
    const gr = g.createRadialGradient(x - rad * 0.2, y - rad * 0.2, rad * 0.2, x, y, rad);
    gr.addColorStop(0, 'rgba(60,55,75,0.55)');
    gr.addColorStop(0.8, 'rgba(70,65,85,0.25)');
    gr.addColorStop(0.92, 'rgba(210,205,225,0.35)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, rad, rad * 0.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const auroraShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vPos;
    void main() { vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uStrength;
    uniform vec3 uColA, uColB;
    varying vec2 vUv;
    varying vec3 vPos;
    void main() {
      float a = atan(vPos.z, vPos.x);
      // hanging curtains: folds that drift round the pole, bright at the foot, fading upward
      float folds = 0.5 + 0.5 * sin(a * 7.0 + uTime * 0.35 + 2.0 * sin(a * 3.0 - uTime * 0.2));
      float rays = 0.6 + 0.4 * sin(a * 61.0 + sin(a * 13.0 + uTime) * 3.0);
      // clamp: with MSAA, varyings can land a hair outside 0..1, and pow() of a negative is NaN (bloom turns that black)
      float y = clamp(vUv.y, 0.0, 1.0);
      float foot = smoothstep(0.0, 0.08, y) * pow(1.0 - y, 1.6);
      vec3 col = mix(uColA, uColB, smoothstep(0.1, 0.8, y));
      gl_FragColor = vec4(col * folds * rays * foot * uStrength, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const ringShader = {
  vertexShader: /* glsl */ `
    varying vec3 vLocal;
    varying vec3 vWorld;
    void main() {
      vLocal = position;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uLight, uColA, uColB, uNormal;
    uniform float uInner, uOuter, uPlanetR, uOpacity;
    varying vec3 vLocal;
    varying vec3 vWorld;
    float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
    float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
    void main() {
      float r = length(vLocal.xy);
      float t = (r - uInner) / (uOuter - uInner);
      // many thin ringlets of different density, a clear gap (like Cassini's) two thirds out
      float dens = 0.35 + 0.65 * n1(t * 38.0) * n1(t * 9.0 + 3.0);
      dens *= smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.85, t);
      dens *= 1.0 - 0.6 * smoothstep(0.03, 0.0, abs(t - 0.66));
      vec3 col = mix(uColA, uColB, n1(t * 6.0));
      float lit = 0.35 + 0.65 * abs(dot(uNormal, uLight));
      // the planet's shadow falls across the rings behind it
      vec3 p = vWorld;
      float along = dot(p, uLight);
      float off = length(p - uLight * along);
      float shadow = along < 0.0 ? smoothstep(uPlanetR * 0.92, uPlanetR * 1.05, off) : 1.0;
      // see-through where the rings pass in front of the planet, so they never hide the board
      vec3 dir = normalize(vWorld - cameraPosition);
      float closest = length(cross(-cameraPosition, dir));
      float inFront = dot(vWorld - cameraPosition, dir) < dot(-cameraPosition, dir) ? 1.0 : 0.0;
      float veil = 1.0 - inFront * smoothstep(uPlanetR * 1.3, uPlanetR * 0.98, closest) * 0.93;
      gl_FragColor = vec4(col * lit * (0.25 + 0.75 * shadow), dens * uOpacity * veil);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * cfg: { radius, latMax, quality, colors: { crystal, auroraA, auroraB, ringA, ringB, companion } }
 * Returns { update(t, camera, keyLight, starDir), setAurora(colorA, colorB, strength), flare, ring, … }
 */
export function createScenery(engine, cfg) {
  const { scene, renderer } = engine;
  const { radius: R, latMax, colors } = cfg;
  const low = cfg.quality === 'low';

  // ---------- sky: drawn once into a cube map ----------
  scene.background = bakeSpaceSky(renderer, {
    size: low ? 512 : 1024, seed: 4, base: '#010106',
    nebula: ['#40206e', '#0d4a6a', '#7a2c4a'], nebulaStrength: 0.5, stars: 1.1,
    giant: false, // tried a distant gas giant: it read as a flat blob and pulled the eye off the board
  });

  // ---------- polar crowns: hexagonal ice spires, one instanced draw call ----------
  const spire = new THREE.LatheGeometry([new THREE.Vector2(0, -0.3), new THREE.Vector2(0.26, -0.3), new THREE.Vector2(0.3, 0.85), new THREE.Vector2(0.21, 1.15), new THREE.Vector2(0, 1.65)], 6);
  {
    // darker at the foot, bright at the tip (vertex colours), so they read as lit ice
    const pos = spire.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) col.fill(0.35 + 0.65 * THREE.MathUtils.smoothstep(pos.getY(i), -0.3, 1.65), i * 3, i * 3 + 3);
    spire.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const crystalMat = new THREE.MeshStandardMaterial({ color: colors.crystal, vertexColors: true, emissive: colors.crystalGlow, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.1, flatShading: true, envMap: cfg.env ?? null, envMapIntensity: 0.55 });
  const perPole = 54;
  const crystals = noClick(new THREE.InstancedMesh(spire, crystalMat, perPole * 2));
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const lean = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  let k = 0;
  for (const sgn of [1, -1]) {
    for (let i = 0; i < perPole; i++) {
      const crown = i < 30; // a ring of spires round the cap's rim, the rest scattered towards the pole
      const lat = crown ? latMax + 0.11 + rnd() * 0.06 : latMax + 0.2 + Math.sqrt(rnd()) * (Math.PI / 2 - latMax - 0.2);
      const lon = crown ? (i / 30) * Math.PI * 2 + rnd() * 0.12 : rnd() * Math.PI * 2;
      const n = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat) * sgn, Math.cos(lat) * Math.sin(lon));
      q.setFromUnitVectors(up, n);
      // lean towards the pole (away from the board) and twist
      const towardPole = new THREE.Vector3(0, sgn, 0).sub(n.clone().multiplyScalar(n.y * sgn)).normalize();
      const axis = new THREE.Vector3().crossVectors(n, towardPole).normalize();
      lean.setFromAxisAngle(axis, crown ? 0.35 + rnd() * 0.2 : (rnd() - 0.5) * 0.5);
      const s = crown ? 0.22 + rnd() * rnd() * 0.36 : 0.18 + rnd() * rnd() * 0.55;
      m.compose(n.clone().multiplyScalar(R - 0.04), lean.clone().multiply(q).multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28)), new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s));
      crystals.setMatrixAt(k, m);
      crystals.setColorAt(k++, tint.set(colors.crystal).offsetHSL((rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.2));
    }
  }
  scene.add(crystals);
  // one tall monolith on each pole: the landmark
  for (const sgn of [1, -1]) {
    const mono = noClick(new THREE.Mesh(spire, crystalMat));
    mono.position.set(0, sgn * (R - 0.1), 0);
    mono.scale.set(0.7, 1.05, 0.7);
    if (sgn < 0) mono.rotation.x = Math.PI;
    scene.add(mono);
  }

  // ---------- auroras: additive curtains hanging round each pole ----------
  const auroraUniforms = { uTime: { value: 0 }, uStrength: { value: 0.75 }, uColA: { value: new THREE.Color(colors.auroraA) }, uColB: { value: new THREE.Color(colors.auroraB) } };
  const auroras = [1, -1].map((sgn) => {
    const lat = latMax + 0.18;
    const r0 = R * Math.cos(lat) * 1.02;
    const geo = new THREE.CylinderGeometry(r0 * 1.45, r0, 1.6, 96, 1, true);
    geo.translate(0, 0.8, 0);
    const mesh = noClick(new THREE.Mesh(geo, new THREE.ShaderMaterial({ ...auroraShader, uniforms: auroraUniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
    mesh.position.y = sgn * R * Math.sin(lat) * 1.0;
    if (sgn < 0) mesh.rotation.x = Math.PI;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return mesh;
  });

  // ---------- rings: tilted, banded, shadowed by the planet, see-through over the board ----------
  const inner = R * 1.6;
  const outer = R * 2.3;
  const ringUniforms = {
    uLight: { value: new THREE.Vector3(0, 1, 0) },
    uNormal: { value: new THREE.Vector3(0, 0, 1) },
    uColA: { value: new THREE.Color(colors.ringA) },
    uColB: { value: new THREE.Color(colors.ringB) },
    uInner: { value: inner },
    uOuter: { value: outer },
    uPlanetR: { value: R },
    uOpacity: { value: 0.62 },
  };
  const ring = noClick(new THREE.Mesh(new THREE.RingGeometry(inner, outer, 192, 1), new THREE.ShaderMaterial({ ...ringShader, uniforms: ringUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  ring.rotation.set(-Math.PI / 2 + 0.38, 0.0, 0.22);
  ring.renderOrder = 3;
  scene.add(ring);
  ring.updateMatrixWorld();
  ringUniforms.uNormal.value.set(0, 0, 1).transformDirection(ring.matrixWorld);

  // ---------- a moon far out (wider than the camera's reach, so it never passes in front of the board) ----------
  const moonMat = new THREE.MeshStandardMaterial({ map: craterTexture(), roughness: 0.95, metalness: 0 });
  const moon = noClick(new THREE.Mesh(new THREE.SphereGeometry(1.6, 48, 24), moonMat));
  const orbit = new THREE.Group();
  orbit.rotation.set(0.32, 0, 0.18);
  moon.position.set(36, 0, 0);
  orbit.add(moon);
  scene.add(orbit);

  // ---------- satellites: tiny, with blinking beacons (life in the frame) ----------
  const satBody = new THREE.BoxGeometry(0.1, 0.1, 0.16);
  const satPanel = new THREE.BoxGeometry(0.62, 0.01, 0.12);
  const satMat = new THREE.MeshStandardMaterial({ color: '#c9c2a8', metalness: 0.8, roughness: 0.35, envMap: cfg.env ?? null });
  const panelMat = new THREE.MeshStandardMaterial({ color: '#1b2a6a', metalness: 0.6, roughness: 0.25, emissive: '#0a1640', emissiveIntensity: 0.6 });
  const beaconMat = new THREE.SpriteMaterial({ color: '#ff5a4a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sats = [[7.0, 0.5, 0.0, 0.11], [7.6, -0.35, 2.1, -0.08], [6.7, 1.1, 4.0, 0.09]].map(([r, tilt, phase, speed]) => {
    const pivot = new THREE.Group();
    pivot.rotation.set(tilt, phase, tilt * 0.5);
    const sat = new THREE.Group();
    sat.add(noClick(new THREE.Mesh(satBody, satMat)), noClick(new THREE.Mesh(satPanel, panelMat)));
    const beacon = noClick(new THREE.Sprite(beaconMat));
    beacon.scale.setScalar(0.12);
    sat.add(beacon);
    sat.position.set(r, 0, 0);
    pivot.add(sat);
    scene.add(pivot);
    return { pivot, sat, beacon, speed, phase };
  });

  // ---------- the companion star: a cold blue sun just past the planet's limb ----------
  const flare = lensFlare({ color: colors.companion, size: low ? 0.8 : 1 });
  scene.add(flare.group);
  const occluder = { center: new THREE.Vector3(), radius: R * 1.05 };

  return {
    crystals,
    ring,
    auroras,
    flare,
    moon,
    /** Aurora colours (e.g. the winner's at the end) and brightness. */
    setAurora(a, b, strength = 0.75) {
      auroraUniforms.uColA.value.set(a);
      auroraUniforms.uColB.value.set(b);
      auroraUniforms.uStrength.value = strength;
    },
    update(t, camera, keyLight, starDir) {
      auroraUniforms.uTime.value = t;
      ringUniforms.uLight.value.copy(keyLight);
      crystalMat.emissiveIntensity = 0.25 + 0.1 * Math.sin(t * 1.1);
      orbit.rotation.y = t * 0.03;
      moon.rotation.y = t * 0.05;
      for (const s of sats) {
        s.pivot.rotation.y = s.phase + t * s.speed;
        s.sat.rotation.y = t * 0.3;
        s.beacon.visible = (t * 1.2 + s.phase) % 1.6 < 0.12;
      }
      flare.update(camera, starDir, { occluder });
    },
  };
}
