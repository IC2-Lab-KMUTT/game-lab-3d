// The look of your game in one call: sky, lighting, fog, shadows, colour grading and
// post effects, with presets that already look good. Pick a preset, then tune.
//
//   look.preset('sunset')                       sunny sunset night neon space toon studio fog-forest
//   look.preset('night', { fog: { far: 50 } })  preset + your own changes
//   look.set({ bloom: { strength: 1 }, vignette: 0.5, grade: { saturation: 1.3 } })
//   look.set({ ao: false, tiltShift: 0.4, sun: { elevation: 20, azimuth: -60 } })
//   look.quality = 'low'                        'auto' (default) | 'low' | 'medium' | 'high'
//
// Materials and colours:
//   look.palette('candy')                        5 colours that go together (look.palettes lists names)
//   look.toon('#ff6b9d')                         cartoon (cel-shaded) material
//   look.glow('#05d9e8', 3)                      glowing material (blooms)
//   look.glass({ color: '#bde0fe' })             see-through glass
//
// Dressing the scene:
//   look.ground({ style: 'island', size: 30, color: '#6a9f4b' })   plain grid checker noise gradient island
//   look.scatter(treeMesh, { count: 60, area: 14, scale: [0.7, 1.3], seed: 3 })   cheap dense instances
//   look.followShadow(player)                    shadows stay sharp around the player in big levels
//   look.outline([chest], '#ffd166')             glowing outline on selected objects (null clears)
//
// See also: look-data.js (presets, palettes), look-post.js (effects), look-sky.js (sky dome).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeLook, resolvePreset, palette, PALETTES, PRESET_NAMES, QUALITY, QUALITY_LEVELS, createQualityGovernor, scatterPoints, LOOK_DEFAULTS } from './look-data.js';
import { createSky } from './look-sky.js';
import { createPost } from './look-post.js';
import { createGround } from './look-ground.js';
import { loadAssetBuffer } from './paths.js'; // works in the single-file offline build too


const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };
const DEG = Math.PI / 180;

export function createLook({ renderer, scene, camera, settings = {} }) {
  let current = {}; // settings in effect; keys that were never set are left alone
  let post = null; // created on first use, so games without effects pay nothing
  let qualityMode = settings.quality ?? 'auto';
  let level = qualityMode === 'auto' ? 'high' : qualityMode;
  let governor = qualityMode === 'auto' ? createQualityGovernor({ start: level }) : null;
  let fps = 60;
  let followTarget = null;
  let toonSweep = 0;

  // ---------- lights (created on demand, shared with engine.lights()) ----------
  let sun = null, hemi = null, rim = null;
  const ensureLights = () => {
    if (sun) return;
    hemi = new THREE.HemisphereLight('#bcd4ff', '#3b2f2a', 1);
    sun = new THREE.DirectionalLight('#ffffff', 2.5);
    sun.castShadow = true;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04; // stops striped 'shadow acne' when the sun is low
    rim = new THREE.DirectionalLight('#9ec5ff', 0);
    scene.add(hemi, sun, sun.target, rim, rim.target);
    applyShadowMapSize();
  };
  const sunDir = new THREE.Vector3(0.5, 0.8, 0.6).normalize();
  const focus = new THREE.Vector3();
  const placeSun = () => {
    if (!sun) return;
    const s = current.sun ?? {};
    const size = s.shadowSize ?? 20;
    // snap the shadow camera to whole shadow-map texels so shadows don't shimmer while following
    const texel = (2 * size) / sun.shadow.mapSize.x;
    const right = new THREE.Vector3(0, 1, 0).cross(sunDir).normalize();
    const up = sunDir.clone().cross(right);
    const f = focus.clone();
    const a = Math.round(f.dot(right) / texel) * texel - f.dot(right);
    const b = Math.round(f.dot(up) / texel) * texel - f.dot(up);
    f.addScaledVector(right, a).addScaledVector(up, b);
    sun.target.position.copy(f);
    sun.position.copy(f).addScaledVector(sunDir, 50);
    Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 120 });
    sun.shadow.camera.updateProjectionMatrix();
    rim.target.position.copy(f);
    rim.position.copy(f).add(new THREE.Vector3(-sunDir.x, 0.4, -sunDir.z).normalize().multiplyScalar(50));
  };
  const applyShadowMapSize = () => {
    if (!sun) return;
    const n = QUALITY[level].shadowMap;
    if (sun.shadow.mapSize.x === n) return;
    sun.shadow.mapSize.set(n, n);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  };

  // ---------- sky + environment ----------
  const sky = createSky();
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.mesh.geometry, sky.mesh.material); // same dome, rendered once into the env map
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTexture = null;
  let roomTexture = null;
  let envKey = '';
  const setEnv = async (env) => {
    const key = env === 'sky' ? `sky${JSON.stringify(current.sky)}${JSON.stringify(current.sun)}` : String(env);
    if (key === envKey) return;
    envKey = key;
    if (envTexture && envTexture !== roomTexture) envTexture.dispose();
    envTexture = null;
    if (!env) return (scene.environment = null);
    if (env === 'room') envTexture = roomTexture ??= pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    else if (env === 'sky') envTexture = pmrem.fromScene(envScene, 0.03).texture;
    else {
      // an .hdr file from public/assets/hdri/
      const buffer = await loadAssetBuffer(env);
      const hdr = new HDRLoader().parse(buffer);
      const tex = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, hdr.type);
      Object.assign(tex, { mapping: THREE.EquirectangularReflectionMapping, colorSpace: THREE.LinearSRGBColorSpace, flipY: true, needsUpdate: true });
      if (envKey !== key) return tex.dispose(); // another preset was picked while loading
      envTexture = pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
    }
    scene.environment = envTexture;
  };

  // ---------- toon materials ----------
  const gradientMaps = {};
  const gradientMap = (steps = 3) =>
    (gradientMaps[steps] ??= (() => {
      const data = new Uint8Array(steps * 4);
      for (let i = 0; i < steps; i++) data.fill(Math.round(70 + (185 * i) / Math.max(1, steps - 1)), i * 4, i * 4 + 4);
      const t = new THREE.DataTexture(data, steps, 1);
      t.minFilter = t.magFilter = THREE.NearestFilter; // hard bands = the cartoon look
      t.needsUpdate = true;
      return t;
    })());
  const toonCache = new WeakMap();
  const toonify = (root, on) =>
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        const m = o.material;
        if (!m?.isMeshStandardMaterial || m.transmission > 0 || m.userData.noToon) return;
        let t = toonCache.get(m);
        if (!t) {
          t = new THREE.MeshToonMaterial({ gradientMap: gradientMap(3) });
          for (const k of ['color', 'map', 'emissive', 'emissiveMap', 'emissiveIntensity', 'transparent', 'opacity', 'alphaTest', 'side', 'vertexColors', 'normalMap', 'aoMap', 'alphaMap', 'flatShading'])
            if (m[k] !== undefined) t[k] = m[k]?.isColor ? m[k].clone() : m[k];
          toonCache.set(m, t);
        }
        o.userData.lookOriginal = m;
        o.material = t;
      } else if (o.userData.lookOriginal) {
        o.material = o.userData.lookOriginal;
        delete o.userData.lookOriginal;
      }
    });
  scene.addEventListener('childadded', ({ child }) => current.materials === 'toon' && toonify(child, true));

  // ---------- quality ----------
  const applyQuality = () => {
    const q = QUALITY[level];
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio, settings.maxPixelRatio ?? 2);
    if (renderer.getPixelRatio() !== pr) {
      renderer.setPixelRatio(pr);
      const { width, height } = renderer.domElement.getBoundingClientRect();
      renderer.setSize(width, height, false);
      post?.composer.setPixelRatio(pr);
      post?.setSize(width, height);
    }
    applyShadowMapSize();
    if (current.sky && typeof current.sky === 'object') sky.set({ ...current.sky, stars: Math.round((current.sky.stars ?? 0) * q.stars) }, sunDir, current.sun?.color);
    post?.configure(current, q);
  };

  const ensurePost = () => {
    if (post) return;
    post = createPost({ renderer, scene, camera, hide: [sky.mesh] });
    const { width, height } = renderer.domElement.getBoundingClientRect();
    post.setSize(width, height);
    post.configure(current, QUALITY[level]);
  };
  const needsPost = () => !!(current.bloom || current.ao || current.grade || current.vignette || current.grain || current.aberration || current.tiltShift || post?.passes.outline.enabled);

  // ---------- apply settings to the scene ----------
  const apply = (changed) => {
    const c = current;
    if ('sun' in changed || 'rim' in changed || 'hemi' in changed) ensureLights();
    if (c.sun && sun) {
      const el = (c.sun.elevation ?? 50) * DEG, az = (c.sun.azimuth ?? 35) * DEG;
      sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      sun.color.set(c.sun.color);
      sun.intensity = c.sun.intensity;
      sun.shadow.radius = c.sun.softness ?? 3;
      sun.shadow.blurSamples = 8;
      placeSun();
    }
    if (c.rim && rim) (rim.color.set(c.rim.color), (rim.intensity = c.rim.intensity ?? 0));
    if (c.hemi && hemi) (hemi.color.set(c.hemi.sky), hemi.groundColor.set(c.hemi.ground), (hemi.intensity = c.hemi.intensity));

    if ('sky' in changed) {
      if (typeof c.sky === 'string' || !c.sky) {
        scene.remove(sky.mesh);
        scene.background = c.sky ? new THREE.Color(c.sky) : null;
      } else {
        scene.background = null;
        scene.add(sky.mesh);
      }
    }
    if (c.sky && typeof c.sky === 'object') sky.set({ ...c.sky, stars: Math.round((c.sky.stars ?? 0) * QUALITY[level].stars) }, sunDir, c.sun?.color);

    if ('fog' in changed) {
      const horizon = typeof c.sky === 'string' ? c.sky : c.sky?.horizon ?? '#cfe3f2';
      scene.fog = c.fog ? new THREE.Fog(c.fog.color ?? horizon, c.fog.near ?? 30, c.fog.far ?? 90) : null;
    }
    if ('env' in changed || 'sky' in changed || 'sun' in changed) if (c.env !== undefined) setEnv(c.env).catch((e) => console.warn('look: environment failed to load', e));
    if (c.envIntensity !== undefined) scene.environmentIntensity = c.envIntensity;
    if (c.exposure !== undefined) renderer.toneMappingExposure = c.exposure;
    if (c.toneMapping !== undefined) renderer.toneMapping = TONE[c.toneMapping] ?? THREE.ACESFilmicToneMapping;
    if ('materials' in changed) toonify(scene, c.materials === 'toon');

    if (needsPost()) ensurePost();
    post?.configure(c, QUALITY[level]);
  };

  const look = {
    /** Apply a named preset (resets everything else), plus optional overrides. */
    preset(name, overrides) {
      current = mergeLook(resolvePreset(name), overrides ?? {});
      current.name = name;
      apply(Object.fromEntries(Object.keys(current).map((k) => [k, true])));
      return look;
    },
    /** Change some settings, keep the rest. `false` turns an effect off. */
    set(changes) {
      current = mergeLook(current, changes);
      apply(changes);
      return look;
    },
    /** A copy of the settings in effect (handy to print and paste into your game). */
    get() {
      return structuredClone(current);
    },
    presets: PRESET_NAMES,
    defaults: LOOK_DEFAULTS,

    get sun() {
      ensureLights();
      return sun;
    },
    get hemi() {
      ensureLights();
      return hemi;
    },
    get rim() {
      ensureLights();
      return rim;
    },

    /** 'auto' | 'low' | 'medium' | 'high'. Reading gives the level in use right now. */
    get quality() {
      return level;
    },
    set quality(mode) {
      qualityMode = mode;
      governor = mode === 'auto' ? createQualityGovernor({ start: 'high' }) : null;
      level = mode === 'auto' ? 'high' : QUALITY_LEVELS.includes(mode) ? mode : 'high';
      applyQuality();
    },
    get qualityMode() {
      return qualityMode;
    },
    /** Smoothed frames per second (for an on-screen counter). */
    get fps() {
      return fps;
    },

    // ---------- colours & materials ----------
    palette,
    palettes: Object.keys(PALETTES),
    toon(color = '#ffffff', { steps = 3, ...rest } = {}) {
      return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(steps), ...rest });
    },
    glow(color = '#ffd166', strength = 3) {
      // emissive above 1.0 is brighter than white, which is exactly what bloom picks up
      return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: 0.4 });
    },
    glass({ color = '#ffffff', roughness = 0.05, thickness = 0.6, ior = 1.45 } = {}) {
      return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, transmission: 1, thickness, ior, attenuationColor: color, attenuationDistance: 2, specularIntensity: 1, envMapIntensity: 1.2 });
    },
    /** Turn every standard material under `root` into a toon one (false = back to normal). */
    toonify(root = scene, on = true) {
      toonify(root, on);
    },

    // ---------- scene dressing ----------
    ground(options) {
      const mesh = createGround(options);
      scene.add(mesh);
      return mesh;
    },

    /**
     * Copies of a mesh or model, scattered with InstancedMesh (one draw call per part).
     *   area: radius | [w, d] | { inner, outer },  scale: [min, max],  seed,  center: [x, z]
     *   on: mesh(es) to stand on (raycast; align: 'normal' tilts to the slope), y: height if no `on`
     *   minDistance, colorJitter (0..1 brightness variety), castShadow, parent
     */
    scatter(source, { on, align, y = 0, colorJitter = 0.12, castShadow = true, receiveShadow = true, parent = scene, ...opts } = {}) {
      const points = scatterPoints(opts);
      source.updateMatrixWorld?.(true);
      const parts = [];
      const rootInverse = source.matrixWorld ? source.matrixWorld.clone().invert() : new THREE.Matrix4();
      if (source.isMesh) parts.push({ geometry: source.geometry, material: source.material, local: new THREE.Matrix4() });
      else if (source.traverse) source.traverse((o) => o.isMesh && parts.push({ geometry: o.geometry, material: o.material, local: rootInverse.clone().multiply(o.matrixWorld) }));
      else parts.push({ geometry: source.geometry, material: source.material, local: new THREE.Matrix4() });

      const ray = new THREE.Raycaster();
      const targets = on ? [].concat(on) : null;
      const down = new THREE.Vector3(0, -1, 0);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const matrices = points.map((pt) => {
        p.set(pt.x, y, pt.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pt.rotation);
        if (targets) {
          ray.set(new THREE.Vector3(pt.x, 1000, pt.z), down);
          const hit = ray.intersectObjects(targets, true)[0];
          if (hit) {
            p.y = hit.point.y + y;
            if (align === 'normal' && hit.face) q.premultiply(tilt.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hit.face.normal.clone().transformDirection(hit.object.matrixWorld)));
          }
        }
        return m.compose(p, q, s.setScalar(pt.scale)).clone();
      });

      const group = new THREE.Group();
      group.name = 'scatter';
      const jitter = new THREE.Color();
      parts.forEach(({ geometry, material, local }, k) => {
        const inst = new THREE.InstancedMesh(geometry, material, points.length);
        matrices.forEach((mat, i) => {
          inst.setMatrixAt(i, mat.clone().multiply(local));
          if (colorJitter) inst.setColorAt(i, jitter.setScalar(1 + (((i * 7919 + k * 31) % 1000) / 1000 - 0.5) * 2 * colorJitter));
        });
        inst.castShadow = castShadow;
        inst.receiveShadow = receiveShadow;
        inst.computeBoundingSphere(); // so off-screen clumps are skipped
        group.add(inst);
      });
      group.userData.points = points;
      parent?.add(group);
      return group;
    },

    /** Keep the sun's shadow area centred on this object (big levels). null = back to the origin. */
    followShadow(target) {
      followTarget = target;
      if (!target) (focus.set(0, 0, 0), placeSun());
    },

    /** Glowing outline around objects (selected, hovered…). Pass null to clear. */
    outline(objects, color = '#ffd166') {
      if (!post && (!objects || (Array.isArray(objects) && !objects.length))) return;
      ensurePost();
      post.outline(objects, color);
    },

    /** Old-style lights (used by engine.lights()). Returns { sun, hemi }. */
    lights({ sun: sunColor = '#ffffff', sky: skyColor = '#bcd4ff', ground = '#3b2f2a', intensity = 1, shadowSize = 20 } = {}) {
      look.set({
        sun: { color: sunColor, intensity: 2.5 * intensity, elevation: 48, azimuth: 37, softness: 3, shadowSize },
        hemi: { sky: skyColor, ground, intensity: 1.2 * intensity },
      });
      return { sun, hemi };
    },

    // ---------- called by the engine ----------
    update(rawDt) {
      if (rawDt > 0 && rawDt < 0.5) fps += (1 / rawDt - fps) * 0.05;
      if (governor) {
        const lower = governor.sample(rawDt);
        if (lower) {
          level = lower;
          applyQuality();
          console.info(`look: frame rate is low, quality → ${lower}`);
        }
      }
      if (followTarget && sun) {
        followTarget.getWorldPosition(focus);
        placeSun();
      }
      // catch toon-mode objects added deep inside groups after the preset was set
      if (current.materials === 'toon' && (toonSweep += rawDt) > 1) (toonSweep = 0), toonify(scene, true);
    },
    render(dt) {
      if (post && needsPost()) post.render(dt);
      else renderer.render(scene, camera);
    },
    resize(w, h) {
      post?.setSize(w, h);
    },
  };

  applyQuality();
  return look;
}
