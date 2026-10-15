// Space scenery for any game set in orbit: a baked starfield + nebula sky, a scattering atmosphere
// around a planet, and a lens flare for a bright star. All three are built to be cheap on school laptops.
//
//   scene.background = bakeSpaceSky(renderer, { size: 1024, seed: 3 });   // a CubeTexture, drawn once
//   const atmo = atmosphere(5, { thickness: 0.12 });  scene.add(atmo.mesh);  atmo.setLight(sunDir);
//   const flare = lensFlare({ color: '#9fc8ff' });   scene.add(flare.group);
//   engine.onUpdate(() => flare.update(camera, starDirection, { occluder: { center, radius } }));
//
// Why bake the sky: a nebula needs several layers of noise per pixel. Computing that every frame for the
// whole screen was the most expensive thing in the scene; drawing it once into a cube map makes the
// sky cost one texture read per pixel, with richer detail (more noise layers, a distant gas giant).
import * as THREE from 'three';

const NOISE = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64); // rotate octaves: no grid artefacts
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * noise(p); p = ROT * p * 2.03 + 0.7; a *= 0.5; } return s; }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uBase, uNebA, uNebB, uNebC, uGiantDir, uGiantA, uGiantB, uGiantLight;
  uniform float uNebula, uStars, uGiantSize, uSeed;
  varying vec3 vDir;
  ${NOISE}
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = uBase;
    vec3 q = d * 2.2 + uSeed;
    // nebula: domain-warped clouds in three colours, brightest along a tilted galactic band
    vec3 w = vec3(fbm(q + 3.1), fbm(q + 7.7), fbm(q + 1.3));
    float n = fbm(q * 1.4 + w * 1.6);
    float bd = dot(d, normalize(vec3(0.25, 1.0, -0.35))) * 2.4;
    float band = exp(-bd * bd); // (pow() of a negative number is NaN in GLSL, and bloom smears NaN everywhere)
    float dust = smoothstep(0.42, 0.9, n) * (0.25 + 0.75 * band);
    vec3 neb = mix(uNebA, uNebB, smoothstep(0.3, 0.7, w.x));
    neb = mix(neb, uNebC, smoothstep(0.55, 0.85, w.y) * 0.8);
    col += neb * dust * uNebula;
    col *= 1.0 - smoothstep(0.55, 0.75, fbm(q * 3.0 + 9.0)) * band * 0.6; // dark dust lanes
    // stars at three scales (hash cells on the sphere); brighter and denser inside the band
    for (int k = 0; k < 3; k++) {
      float sc = 90.0 + float(k) * 140.0;
      vec3 c = d * sc;
      vec3 id = floor(c);
      float h = hash(id + float(k) * 13.0);
      vec3 pos = id + 0.5 + (vec3(hash(id + 1.1), hash(id + 2.2), hash(id + 3.3)) - 0.5) * 0.7;
      float dist = length(c - pos);
      float on = step(1.0 - (0.06 + 0.1 * band) * uStars, h);
      float size = 0.05 + 0.1 * hash(id + 4.4) * (k == 0 ? 2.0 : 1.0);
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.65), hash(id + 5.5));
      col += tint * on * smoothstep(size, 0.0, dist) * (k == 0 ? 2.2 : 1.1);
    }
    // a distant banded gas giant, lit from one side
    float gd = dot(d, uGiantDir);
    float ang = acos(clamp(gd, -1.0, 1.0));
    if (uGiantSize > 0.0 && ang < uGiantSize * 1.25) {
      vec3 up = normalize(cross(uGiantDir, vec3(0.2, 1.0, 0.1)));
      vec3 rt = cross(up, uGiantDir);
      vec2 p = vec2(dot(d, rt), dot(d, up)) / sin(uGiantSize);
      float r2 = dot(p, p);
      if (r2 < 1.0) {
        vec3 sn = normalize(p.x * rt + p.y * up - sqrt(1.0 - r2) * uGiantDir);
        float lat = p.y * 0.9 + 0.12 * p.x;
        float bands = fbm(vec3(lat * 9.0, lat * 2.0, p.x * 0.6 + uSeed));
        vec3 gc = mix(uGiantA, uGiantB, bands);
        float lit = smoothstep(-0.15, 0.6, dot(sn, uGiantLight));
        float limb = pow(1.0 - sqrt(1.0 - r2), 3.0);
        col = mix(col, gc * (0.03 + lit * 0.9) + uGiantB * limb * lit * 0.6, smoothstep(1.0, 0.985, r2));
      }
      float halo = smoothstep(uGiantSize * 1.25, uGiantSize, ang) * smoothstep(uGiantSize * 0.98, uGiantSize * 1.02, ang);
      col += uGiantB * halo * 0.25 * smoothstep(-0.2, 0.5, dot(normalize(d - uGiantDir), uGiantLight));
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

/**
 * Draw a starfield + nebula (+ optional gas giant) into a cube map once. Returns the CubeTexture
 * (use it as scene.background). Options: size (cube face px), seed, base, nebula: [3 colours],
 * nebulaStrength, stars (density 0..2), giant: { dir: [x,y,z], size (radians), colors: [a, b], light: [x,y,z] } | false
 */
export function bakeSpaceSky(renderer, {
  size = 1024, seed = 1, base = '#020208', nebula = ['#3a1a6a', '#0f4a6e', '#8a3a5a'], nebulaStrength = 0.55, stars = 1,
  giant = { dir: [-0.6, 0.18, -0.78], size: 0.16, colors: ['#5a3a6e', '#d9a07a'], light: [0.8, 0.3, 0.5] },
} = {}) {
  const v = (a) => new THREE.Vector3(...a).normalize();
  const uniforms = {
    uBase: { value: new THREE.Color(base) },
    uNebA: { value: new THREE.Color(nebula[0]) },
    uNebB: { value: new THREE.Color(nebula[1]) },
    uNebC: { value: new THREE.Color(nebula[2]) },
    uNebula: { value: nebulaStrength },
    uStars: { value: stars },
    uSeed: { value: seed * 7.31 },
    uGiantDir: { value: v(giant ? giant.dir : [0, 1, 0]) },
    uGiantSize: { value: giant ? giant.size : 0 },
    uGiantA: { value: new THREE.Color(giant ? giant.colors[0] : '#000') },
    uGiantB: { value: new THREE.Color(giant ? giant.colors[1] : '#000') },
    uGiantLight: { value: v(giant ? giant.light : [1, 0, 0]) },
  };
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: skyFragment,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat);
  scene.add(box);
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(0.1, 100, target);
  cam.update(renderer, scene);
  box.geometry.dispose();
  mat.dispose();
  return target.texture;
}

/**
 * A glowing shell around a planet of radius `radius`: bright blue on the lit limb, a warm band at the
 * terminator (sunset), faint violet on the night side. Additive, so it never hides what's behind.
 * Returns { mesh, uniforms, setLight(dir), setColors({ day, sunset, night }) }.
 */
export function atmosphere(radius, { thickness = 0.12, day = '#5fb4ff', sunset = '#ff8a5c', night = '#3a2a7a', strength = 1 } = {}) {
  const shell = 1 + thickness;
  const uniforms = {
    uDay: { value: new THREE.Color(day) },
    uSunset: { value: new THREE.Color(sunset) },
    uNight: { value: new THREE.Color(night) },
    uLight: { value: new THREE.Vector3(0, 1, 0) },
    uLimb: { value: Math.sqrt(1 - 1 / (shell * shell)) },
    uStrength: { value: strength },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius * shell, 96, 48),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vNormalV, vViewV, vNormalW;
        void main() {
          vNormalV = normalize(normalMatrix * normal);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uDay, uSunset, uNight, uLight;
        uniform float uLimb, uStrength;
        varying vec3 vNormalV, vViewV, vNormalW;
        void main() {
          // back faces: 0 at the outer edge of the shell, uLimb where it meets the planet's silhouette
          float t = clamp(-dot(vNormalV, vViewV) / uLimb, 0.0, 1.0);
          float a = pow(t, 2.6);
          float l = dot(vNormalW, uLight);
          vec3 c = mix(uNight * 0.6, uSunset * 0.7, smoothstep(-0.3, -0.02, l));
          c = mix(c, uDay, smoothstep(-0.06, 0.3, l));
          float lit = 0.25 + 0.75 * smoothstep(-0.4, 0.3, l);
          gl_FragColor = vec4(c * a * lit * uStrength, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  mesh.raycast = () => {}; // clicks go through to whatever is inside
  return {
    mesh,
    uniforms,
    setLight: (dir) => uniforms.uLight.value.copy(dir).normalize(),
    setColors({ day: d, sunset: s, night: n } = {}) {
      if (d) uniforms.uDay.value.set(d);
      if (s) uniforms.uSunset.value.set(s);
      if (n) uniforms.uNight.value.set(n);
    },
  };
}

/** Soft radial glow / starburst / ring textures for the flare, drawn once on canvases. */
function flareTexture(kind) {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const m = s / 2;
  if (kind === 'glow') {
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.08, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  } else if (kind === 'rays') {
    g.translate(m, m);
    for (let k = 0; k < 14; k++) {
      g.rotate((Math.PI * 2) / 14 + (k % 3) * 0.07);
      const len = m * (k % 2 ? 0.55 : 0.95);
      const gr = g.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.7)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, -2.5);
      g.lineTo(len, 0);
      g.lineTo(0, 2.5);
      g.fill();
    }
  } else if (kind === 'streak') {
    const gr = g.createLinearGradient(0, 0, s, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, m - 3, s, 6);
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, m - 3, 0, m + 3);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.5, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, s, s);
  } else {
    // ghost ring
    const gr = g.createRadialGradient(m, m, m * 0.55, m, m, m);
    gr.addColorStop(0, 'rgba(255,255,255,0.05)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    gr.addColorStop(0.85, 'rgba(255,255,255,0.08)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A lens flare for a bright star in direction `dir` (world, from the camera's target): glow, rays, a
 * horizontal streak and a few ghosts mirrored through the screen centre. Sprites only, no extra pass.
 * update(camera, dir, { occluder: { center: Vector3, radius } }) fades it when a planet covers the star.
 */
export function lensFlare({ color = '#bcd8ff', size = 1, ghosts = 4 } = {}) {
  const group = new THREE.Group();
  group.renderOrder = 10;
  const sprite = (tex, c, opacity) => {
    const m = new THREE.SpriteMaterial({ map: tex, color: c, transparent: true, opacity, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, toneMapped: false });
    const s = new THREE.Sprite(m);
    s.userData.opacity = opacity;
    s.raycast = () => {};
    group.add(s);
    return s;
  };
  const glow = sprite(flareTexture('glow'), color, 1);
  const core = sprite(flareTexture('glow'), '#ffffff', 1);
  const rays = sprite(flareTexture('rays'), color, 0.55);
  const streak = sprite(flareTexture('streak'), color, 0.6);
  const ring = flareTexture('ring');
  const ghostList = Array.from({ length: ghosts }, (_, k) => {
    const s = sprite(k % 2 ? ring : flareTexture('glow'), new THREE.Color(color).offsetHSL(0.08 * k, 0, -0.1), 0.07);
    s.userData.t = [0.45, 0.8, 1.25, 1.7][k % 4];
    s.userData.size = [0.05, 0.12, 0.035, 0.09][k % 4];
    return s;
  });
  const ndc = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const ray = new THREE.Ray();
  let fade = 1;
  return {
    group,
    /** strength 0..1 (scale everything, e.g. pulse it on big moments) */
    strength: 1,
    update(camera, dir, { occluder, distance = 80 } = {}) {
      // put the star far away along dir, as seen from the camera
      const star = tmp.copy(dir).normalize().multiplyScalar(distance).add(camera.position);
      ndc.copy(star).project(camera);
      let visible = ndc.z < 1 && Math.abs(ndc.x) < 1.3 && Math.abs(ndc.y) < 1.3 ? 1 : 0;
      if (occluder && visible) {
        ray.origin.copy(camera.position);
        ray.direction.copy(dir).normalize();
        const d = ray.distanceToPoint(occluder.center);
        visible *= THREE.MathUtils.smoothstep(d, occluder.radius * 0.98, occluder.radius * 1.12);
      }
      fade += (visible - fade) * 0.15;
      const a = fade * this.strength;
      group.visible = a > 0.01;
      if (!group.visible) return;
      const place = (s, x, y) => {
        tmp.set(x, y, 0.5).unproject(camera);
        s.position.copy(tmp);
      };
      // everything except ghosts sits on the star
      for (const s of [glow, core, rays, streak]) place(s, ndc.x, ndc.y);
      glow.scale.setScalar(0.2 * size);
      core.scale.setScalar(0.05 * size);
      rays.scale.setScalar(0.45 * size);
      streak.scale.set(1.2 * size, 0.06 * size, 1);
      // edge-on flicker: the flare is stronger when the star is near the screen centre
      const centre = 1 - Math.min(1, Math.hypot(ndc.x, ndc.y) * 0.6);
      for (const s of [glow, core, rays, streak]) s.material.opacity = s.userData.opacity * a;
      rays.material.rotation = ndc.x * 0.6;
      for (const s of ghostList) {
        place(s, ndc.x * (1 - s.userData.t), ndc.y * (1 - s.userData.t)); // along the line through the screen centre
        s.scale.setScalar(s.userData.size * size);
        s.material.opacity = s.userData.opacity * a * (0.5 + centre);
      }
    },
  };
}
