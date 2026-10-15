// The planet: a real-looking ocean world with the board as a holographic overlay.
//
// Why it is fast: the terrain (continents, oceans, ice caps, city lights, clouds) is many layers of noise.
// It is painted ONCE at load into two equirectangular textures (bakeTerrain), so every frame the surface
// shader only reads two textures, then draws the board on top: grid, hints, hover, flip preview,
// territory tint, contact shadows under discs, black-hole craters, supernova stars, the tectonic
// warning band, the night side, shock-wave ripples and the end-game flood. One draw call for the board.
// Cell state lives in tiny COLS×ROWS textures (setCells / setMarks).
import * as THREE from 'three';
import { atmosphere } from '../../engine/space.js';

const NOISE = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  // each octave is rotated, so the noise lattice never lines up into blocky, axis-aligned coastlines
  const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  // 5 octaves: finer noise than the texture can hold would only alias into blocky pixels
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = ROT * p * 2.02 + 0.37; a *= 0.5; } return s / 0.97; }
`;

// ---------- the bake: mode 0 = albedo (rgb) + water mask (a); mode 1 = height, city lights, clouds ----------
const bakeFragment = /* glsl */ `
  uniform float uMode, uLatMax, uSeed;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float phi = vUv.x * 6.2831853, theta = (1.0 - vUv.y) * 3.1415927; // same mapping as THREE.SphereGeometry
    vec3 n = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
    float lat = (vUv.y - 0.5) * 3.1415927;
    vec3 p = n * 1.7 + uSeed;
    vec3 w = vec3(fbm(p * 1.2 + 1.7), fbm(p * 1.2 + 9.2), fbm(p * 1.2 + 4.4));
    float h = fbm(p + w * 1.1);
    float ridge = 1.0 - abs(fbm(p * 3.3 + 2.0) * 2.0 - 1.0);
    float sea = 0.5;
    float land = smoothstep(sea - 0.004, sea + 0.012, h); // soft: a hard edge stair-steps when the texture is magnified
    float alt = clamp((h - sea) / 0.2, 0.0, 1.0);
    alt = clamp(alt + ridge * ridge * ridge * 0.45 * smoothstep(0.08, 0.5, alt), 0.0, 1.0);
    float detail = fbm(n * 7.0 + uSeed);
    // the ice cap starts just past the board's edge, with a ragged rim, and never reaches into the board
    float iceLine = uLatMax + 0.035 + 0.06 * fbm(n * 5.0 + 3.0);
    float ice = smoothstep(iceLine, iceLine + 0.02, abs(lat));
    if (uMode < 0.5) {
      float depth = clamp((sea - h) / 0.12, 0.0, 1.0);
      vec3 water = mix(vec3(0.016, 0.085, 0.13), vec3(0.003, 0.016, 0.05), pow(depth, 0.6));
      water = mix(water, vec3(0.035, 0.19, 0.2), smoothstep(0.08, 0.0, depth) * 0.8); // shallow shelves glow teal
      float arid = smoothstep(0.55, 0.05, abs(lat)) * smoothstep(0.45, 0.65, fbm(p * 2.0 + 5.0));
      vec3 low = mix(vec3(0.05, 0.1, 0.045), vec3(0.24, 0.15, 0.07), arid);
      low = mix(low, vec3(0.12, 0.14, 0.11), smoothstep(0.5, 0.95, abs(lat) / uLatMax)); // tundra near the caps
      vec3 col = mix(vec3(0.3, 0.25, 0.16), low, smoothstep(0.0, 0.06, alt)); // beaches
      col = mix(col, vec3(0.13, 0.09, 0.065), smoothstep(0.3, 0.6, alt));
      col = mix(col, vec3(0.2, 0.19, 0.2), smoothstep(0.6, 0.85, alt));
      col = mix(col, vec3(0.55, 0.6, 0.66), smoothstep(0.92, 1.1, alt + detail * 0.08) * 0.5); // snowy peaks
      col *= 0.8 + 0.4 * detail;
      col = mix(water, col, land);
      // polar ice: bright, blue in the cracks
      float crack = smoothstep(0.04, 0.0, abs(fbm(n * 9.0 + 1.0) - 0.5));
      vec3 iceCol = mix(vec3(0.32, 0.42, 0.55), vec3(0.5, 0.6, 0.72), detail) - crack * vec3(0.2, 0.12, 0.04);
      col = mix(col, iceCol, ice);
      gl_FragColor = vec4(col, (1.0 - land) * (1.0 - ice));
    } else {
      // city lights: clusters on habitable lowland, joined by faint roads along coasts
      float lowland = land * smoothstep(0.55, 0.05, alt) * (1.0 - ice);
      float clusters = smoothstep(0.55, 0.8, fbm(n * 7.0 + 11.0));
      float dots = smoothstep(0.6, 0.9, noise(n * 140.0)) + 0.4 * smoothstep(0.7, 0.95, noise(n * 60.0));
      float coast = exp(-abs(h - sea) * 140.0) * 0.5;
      float city = lowland * clusters * dots + land * coast * clusters * dots * 0.6;
      // clouds: long streaks along the latitudes, a few swirls
      vec3 cq = vec3(n.x * 2.4, n.y * 5.5, n.z * 2.4) + uSeed + 20.0;
      vec3 cw = vec3(fbm(cq * 0.7), fbm(cq * 0.7 + 3.0), fbm(cq * 0.7 + 6.0));
      float cl = fbm(cq + cw * 2.2);
      float cloud = smoothstep(0.5, 0.78, cl) * (0.65 + 0.35 * smoothstep(0.2, 0.7, abs(lat)));
      gl_FragColor = vec4(alt * land, min(city, 1.0), cloud, 1.0);
    }
  }`;

/** Paint the planet's textures once. `size` = texture width (height is half). */
function bakeTerrain(renderer, { size = 2048, latMax, seed = 3 }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMode: { value: 0 }, uLatMax: { value: latMax }, uSeed: { value: seed } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: bakeFragment,
    depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene().add(quad);
  const cam = new THREE.Camera();
  const make = (mode) => {
    const rt = new THREE.WebGLRenderTarget(size, size / 2, {
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, wrapS: THREE.RepeatWrapping, anisotropy: 4,
    });
    mat.uniforms.uMode.value = mode;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    return rt.texture;
  };
  const albedo = make(0);
  const data = make(1);
  mat.dispose();
  quad.geometry.dispose();
  return { albedo, data };
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 p = modelMatrix * vec4(position, 1.0);
    vPosW = p.xyz;
    gl_Position = projectionMatrix * viewMatrix * p;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uAlbedo, uData, uCells, uMarks;
  uniform float uRows, uCols, uLatMax, uTime, uHintPulse, uBump;
  uniform vec3 uLight, uRimDir, uRimCol, uColA, uColB, uTurn, uGrid, uNightGrid, uAtmo, uSunset;
  uniform vec4 uRipples[4];
  uniform vec3 uRippleCol[4];
  uniform vec4 uFlood;    // xyz origin, w start time (< 0: off)
  uniform vec3 uFloodCol;
  uniform vec4 uBand;     // x row, y direction (±1), z strength 0..1
  uniform vec3 uBandCol;
  uniform vec4 uRowFlash; // x row, y start time, z: 1 = a whole band, 0 = off
  uniform vec3 uRowFlashCol;
  uniform vec3 uNight;    // x first night column (float: it glides), y width, z on
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float lat = (vUv.y - 0.5) * 3.14159265;
    vec4 alb = texture2D(uAlbedo, vUv);
    vec4 dat = texture2D(uData, vUv);
    float water = alb.a;
    vec3 albedo = alb.rgb;

    // relief: bend the normal along the height map's screen-space slope (land only)
    vec3 dpdx = dFdx(vPosW), dpdy = dFdy(vPosW);
    vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dFdx(dat.r) * r1 + dFdy(dat.r) * r2);
    vec3 nb = abs(det) > 1e-12 ? normalize(abs(det) * n - grad * uBump) : n;

    // night rule: the night columns are dark from pole to pole (they glide as the night moves)
    float nightAmt = 0.0;
    if (uNight.z > 0.5) {
      float x = mod(vUv.x * uCols - uNight.x, uCols);
      nightAmt = smoothstep(-0.05, 0.35, x) * smoothstep(uNight.y + 0.05, uNight.y - 0.35, x);
    }
    vec3 glow = vec3(0.0);
    float shade = 1.0;   // contact shadows / craters darken the lit surface
    float gridBoost = 1.0;

    // ripples: rings of light racing across the surface from each placed disc
    vec3 wave = vec3(0.0);
    float waveAmt = 0.0;
    for (int k = 0; k < 4; k++) {
      vec4 r = uRipples[k];
      float age = uTime - r.w;
      if (age < 0.0 || age > 1.8) continue;
      float ang = acos(clamp(dot(n, r.xyz), -1.0, 1.0));
      float x = (ang - age * 1.6) * 10.0;
      float a = exp(-x * x) * (1.0 - age / 1.8);
      wave += uRippleCol[k] * a;
      waveAmt += a;
    }

    if (abs(lat) < uLatMax) {
      float cu = vUv.x * uCols;
      float cv = (uLatMax - lat) / (2.0 * uLatMax) * uRows;
      vec2 f = fract(vec2(cu, cv));
      ivec2 cell = ivec2(int(min(floor(cu), uCols - 1.0)), int(min(floor(cv), uRows - 1.0)));
      vec4 s = texelFetch(uCells, cell, 0);
      vec4 mk = texelFetch(uMarks, cell, 0);
      float row = float(cell.y);
      // distance to the cell edge, in pixels (crisp lines) and in cell units (soft glow)
      vec2 fw = max(vec2(fwidth(cu), fwidth(cv)), vec2(1e-5));
      vec2 e = min(f, 1.0 - f);
      float edgePx = min(e.x / fw.x, e.y / fw.y);
      float edge = min(e.x * cos(lat) * 1.4, e.y);
      float line = 1.0 - smoothstep(0.35, 1.25, edgePx);
      // physical offset from the cell centre (so round things stay round near the caps)
      vec2 d = (f - 0.5) * vec2(cos(lat) * 6.2832 / uCols, 2.0 * uLatMax / uRows);
      float rr = length(d) / (2.0 * uLatMax / uRows);

      vec3 gridCol = mix(uGrid, uNightGrid, nightAmt);

      float owner = s.r; // 0 empty, ~0.33 Ember, ~0.66 Frost, 1 hole
      if (owner > 0.9) {
        // black hole: a crater falling into darkness, with a violet event-horizon rim
        shade *= smoothstep(0.08, 0.42, rr);
        glow += vec3(0.5, 0.25, 1.0) * exp(-abs(rr - 0.36) * 28.0) * 0.55;
      } else if (owner > 0.15) {
        vec3 oc = owner > 0.5 ? uColB : uColA;
        albedo = mix(albedo, oc * 0.2, 0.18);       // territory
        glow += oc * 0.025 * (1.0 - nightAmt * 0.5);
        shade *= 1.0 - 0.6 * smoothstep(0.46, 0.22, rr); // contact shadow under the disc
      }
      // supernova star cell: a warm halo with a slow pulse
      if (mk.r > 0.5) {
        float pulse = 0.6 + 0.4 * sin(uTime * 3.0 + row);
        glow += vec3(1.0, 0.78, 0.45) * (smoothstep(0.5, 0.0, rr) * 0.18 + exp(-abs(rr - 0.33) * 40.0) * 0.6) * pulse;
      }
      // the grid: thin holographic lines, brighter where a ripple passes
      glow += gridCol * (line * 0.36 + exp(-edge * 28.0) * 0.06) * (1.0 + waveAmt * 6.0);
      // move hints (rings), flip preview, hover
      float hint = s.g * smoothstep(0.045, 0.0, abs(rr - 0.2)) * (0.55 + 0.45 * uHintPulse);
      glow += uTurn * hint * 1.7 + uTurn * s.g * smoothstep(0.2, 0.0, rr) * 0.07;
      glow += uTurn * s.b * (0.45 + 0.35 * uHintPulse) * smoothstep(0.5, 0.2, rr);
      glow += uTurn * s.a * (0.1 + 0.9 * smoothstep(0.06, 0.0, edge));
      // tectonic warning: chevrons racing round the band that is about to slide
      if (uBand.z > 0.0 && abs(row - uBand.x) < 0.5) {
        float chev = fract(cu * 1.0 - (abs(f.y - 0.5) * 0.9) * uBand.y - uTime * 0.9 * uBand.y);
        float arrow = smoothstep(0.12, 0.0, abs(chev - 0.5)) ;
        float rim = smoothstep(0.1, 0.0, min(f.y, 1.0 - f.y));
        glow += uBandCol * uBand.z * (arrow * 0.45 + rim * 0.8 + 0.06) * (0.7 + 0.3 * uHintPulse);
      }
      if (uRowFlash.z > 0.0 && abs(row - uRowFlash.x) < 0.5) {
        // two bright fronts race round the band from the move, both ways, and meet on the far side
        float age = max(uTime - uRowFlash.y, 0.0);
        float x = mod(cu - uRowFlash.w, uCols) / uCols;
        float d = min(x, 1.0 - x);
        float front = exp(-pow(abs(d - age * 0.55) * 14.0, 2.0));
        float edges = smoothstep(0.14, 0.0, min(f.y, 1.0 - f.y));
        glow += uRowFlashCol * exp(-age * 1.6) * (0.12 + 1.2 * front * (0.4 + 0.6 * edges) + 0.35 * edges);
      }
      glow += wave * 0.35;
    } else {
      // the board's edge: a fine glowing seam where the ice begins
      float rim = abs(lat) - uLatMax;
      glow += uGrid * exp(-rim * 90.0) * 0.9 * (1.0 + waveAmt * 3.0);
      glow += wave * 0.2;
    }

    // ---------- light: warm key sun, cool rim star, city lights at night ----------
    float ndl = dot(nb, uLight);
    float day = smoothstep(-0.15, 0.2, dot(n, uLight)) * (1.0 - nightAmt * 0.92);
    vec3 col = albedo * (max(ndl, 0.0) * 1.25 * (1.0 - nightAmt * 0.92) + 0.035 + 0.04 * day) * shade;
    col += albedo * vec3(0.12, 0.1, 0.3) * nightAmt * 0.35; // moonlit, so the night side isn't a hole
    vec3 hv = normalize(uLight + v);
    float nh = max(dot(n, hv), 0.0);
    col += water * (pow(nh, 1500.0) * 0.35 + pow(nh, 60.0) * 0.035) * vec3(1.0, 0.86, 0.66) * day * shade; // sun glint on the sea
    col += vec3(1.0, 0.62, 0.3) * dat.g * (1.0 - day) * 1.4; // cities on the night side
    float nv = max(dot(n, v), 0.0);
    float fres = pow(1.0 - nv, 3.0);
    col += uRimCol * pow(1.0 - nv, 2.2) * max(dot(n, uRimDir), 0.0) * 1.1;
    vec3 haze = mix(uSunset, uAtmo, smoothstep(0.0, 0.4, dot(n, uLight)));
    col = mix(col, haze * (0.15 + 0.85 * day), fres * 0.6 * smoothstep(-0.1, 0.25, dot(n, uLight)) * (1.0 - nightAmt * 0.7));

    // end of game: the winner's colour floods out across the planet
    if (uFlood.w > 0.0) {
      float ang = acos(clamp(dot(n, uFlood.xyz), -1.0, 1.0));
      float front = (uTime - uFlood.w) * 1.3;
      float inside = smoothstep(front, front - 0.35, ang);
      col = mix(col, col * 0.5 + uFloodCol * 0.12, inside * 0.7);
      glow = mix(glow, glow * 0.6 + uFloodCol * (glow.r + glow.g + glow.b) * 0.5, inside);
      float fd = (ang - front) * 7.0;
      glow += uFloodCol * exp(-fd * fd) * 1.3;
    }
    gl_FragColor = vec4(col + glow, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const cloudFragment = /* glsl */ `
  uniform sampler2D uData;
  uniform float uTime, uLatMax, uBoard, uCols;
  uniform vec3 uLight, uNight;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float c = texture2D(uData, vUv + vec2(uTime * 0.0035, 0.0)).b;
    float lat = (vUv.y - 0.5) * 3.14159265;
    float l = dot(n, uLight);
    float day = smoothstep(-0.2, 0.25, l);
    if (uNight.z > 0.5) {
      float x = mod(vUv.x * uCols - uNight.x, uCols);
      day *= 1.0 - 0.9 * smoothstep(-0.05, 0.35, x) * smoothstep(uNight.y + 0.05, uNight.y - 0.35, x);
    }
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    // thin over the board (discs and hints must read), fuller over the caps and at the limb
    float a = c * mix(uBoard, 0.85, max(smoothstep(uLatMax - 0.05, uLatMax + 0.1, abs(lat)), fres));
    vec3 col = mix(vec3(0.05, 0.06, 0.12), vec3(1.0, 0.97, 0.93), day) * (0.35 + 0.75 * max(l, 0.0));
    col = mix(col, vec3(1.0, 0.6, 0.4), smoothstep(0.25, 0.0, abs(l)) * 0.35); // pink at the terminator
    gl_FragColor = vec4(col, a * (0.25 + 0.75 * day));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/**
 * cfg: { radius, rows, cols, latMax (radians), colors: { a, b, grid, nightGrid, atmo, sunset, rim, band } }, quality: 'low'|'medium'|'high'
 * Returns { mesh, setCells(cells, opts), setMarks(stars), setTurn, ripple, rowFlash, setBand, setNight, flood, setLight, setRim, update }
 */
export function createPlanet(engine, cfg) {
  const { scene, renderer } = engine;
  const { radius: R, rows, cols, latMax, colors } = cfg;
  const low = cfg.quality === 'low';
  const terrain = bakeTerrain(renderer, { size: low ? 1024 : 2048, latMax, seed: cfg.seed ?? 3.7 });

  const tex = () => {
    const t = new THREE.DataTexture(new Uint8Array(rows * cols * 4), cols, rows, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  const cellTex = tex();
  const markTex = tex();
  const data = cellTex.image.data;

  const c = (hex) => new THREE.Color(hex);
  const uniforms = {
    uAlbedo: { value: terrain.albedo },
    uData: { value: terrain.data },
    uCells: { value: cellTex },
    uMarks: { value: markTex },
    uRows: { value: rows },
    uCols: { value: cols },
    uLatMax: { value: latMax },
    uTime: { value: 0 },
    uHintPulse: { value: 0 },
    uBump: { value: 0.22 },
    uLight: { value: new THREE.Vector3(0.4, 0.6, 0.7).normalize() },
    uRimDir: { value: new THREE.Vector3(-1, 0.3, 0).normalize() },
    uRimCol: { value: c(colors.companion) },
    uColA: { value: c(colors.a) },
    uColB: { value: c(colors.b) },
    uTurn: { value: c(colors.a) },
    uGrid: { value: c(colors.grid) },
    uNightGrid: { value: c(colors.nightGrid) },
    uAtmo: { value: c(colors.atmo) },
    uSunset: { value: c(colors.sunset) },
    uRipples: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 1, 0, -99)) },
    uRippleCol: { value: Array.from({ length: 4 }, () => c(colors.grid)) },
    uFlood: { value: new THREE.Vector4(0, 1, 0, -1) },
    uFloodCol: { value: c(colors.a) },
    uBand: { value: new THREE.Vector4(0, 1, 0, 0) },
    uBandCol: { value: c(colors.band) },
    uRowFlash: { value: new THREE.Vector4(0, -99, 0, 0) },
    uRowFlashCol: { value: c(colors.a) },
    uNight: { value: new THREE.Vector3(0, 5, 0) },
  };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 96), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
  mesh.name = 'planet';
  scene.add(mesh);

  // Cloud layer: a slightly bigger sphere reading the baked cloud map, drifting slowly east.
  const cloudUniforms = { uData: uniforms.uData, uTime: uniforms.uTime, uLatMax: uniforms.uLatMax, uLight: uniforms.uLight, uNight: uniforms.uNight, uCols: uniforms.uCols, uBoard: { value: 0.28 } };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.014, 128, 64),
    new THREE.ShaderMaterial({ uniforms: cloudUniforms, vertexShader, fragmentShader: cloudFragment, transparent: true, depthWrite: false }),
  );
  clouds.raycast = () => {};
  clouds.renderOrder = 1;
  scene.add(clouds);

  // Atmosphere: blue on the lit limb, a sunset band at the terminator (engine/space.js).
  const atmo = atmosphere(R, { thickness: 0.1, day: colors.atmo, sunset: colors.sunset, night: '#2a1f66', strength: 1.15 });
  scene.add(atmo.mesh);

  let rippleNext = 0;
  const planet = {
    mesh,
    clouds,
    atmosphere: atmo,
    uniforms,
    /** cells: values 0/1/2/3 (3 = hole). Sets: legal (hint rings), preview (would flip), hover (one cell). */
    setCells(cells, { legal = [], preview = [], hover = null } = {}) {
      data.fill(0);
      for (let i = 0; i < cells.length; i++) data[i * 4] = [0, 85, 170, 255][cells[i]];
      for (const i of legal) data[i * 4 + 1] = 255;
      for (const i of preview) data[i * 4 + 2] = 255;
      if (hover !== null) data[hover * 4 + 3] = 255;
      cellTex.needsUpdate = true;
    },
    /** Supernova star cells (a Uint8Array/array of 0/1 per cell). */
    setMarks(stars) {
      const m = markTex.image.data;
      m.fill(0);
      for (let i = 0; i < stars.length; i++) m[i * 4] = stars[i] ? 255 : 0;
      markTex.needsUpdate = true;
    },
    setTurn(color) {
      uniforms.uTurn.value.set(color);
    },
    /** A ring of light that races out across the planet from this surface direction. */
    ripple(normal, color = colors.grid) {
      const k = rippleNext++ % 4;
      uniforms.uRipples.value[k].set(normal.x, normal.y, normal.z, uniforms.uTime.value);
      uniforms.uRippleCol.value[k].set(color);
    },
    /** A whole latitude band lights up (ring closures, tectonic shifts). */
    rowFlash(row, color, col = 0) {
      uniforms.uRowFlash.value.set(row, uniforms.uTime.value, 1, col + 0.5);
      uniforms.uRowFlashCol.value.set(color);
    },
    /** Tectonic warning on a band: dir ±1, strength 0..1 (0 hides it). */
    setBand(row, dir, strength) {
      uniforms.uBand.value.set(row, Math.sign(dir) || 1, strength, 0);
    },
    /** Night columns: first column (may be fractional while it glides), width; on = false hides it. */
    setNight(start, width, on = true) {
      uniforms.uNight.value.set(start, width, on ? 1 : 0);
    },
    /** End of game: the winner's colour spreads from `normal` across the planet. null clears. */
    flood(normal, color) {
      if (!normal) return uniforms.uFlood.value.set(0, 1, 0, -1);
      uniforms.uFlood.value.set(normal.x, normal.y, normal.z, uniforms.uTime.value);
      uniforms.uFloodCol.value.set(color);
    },
    setLight(dir) {
      uniforms.uLight.value.copy(dir);
      atmo.setLight(dir);
    },
    setRim(dir) {
      uniforms.uRimDir.value.copy(dir);
    },
    update(t) {
      uniforms.uTime.value = t;
      uniforms.uHintPulse.value = 0.5 + 0.5 * Math.sin(t * 4);
    },
  };
  return planet;
}
