// The engine: one object that owns the renderer, scene, camera and game loop, and hands
// every service to your game. A game only ever talks to `engine`.
//
//   engine.THREE, engine.scene, engine.camera, engine.renderer
//   engine.onUpdate((dt, time) => …)   run every frame while not paused; returns a stop function
//   engine.input    keyboard/mouse          (src/engine/input.js)
//   engine.assets   3D models & textures    (src/engine/assets.js)
//   engine.audio    sfx, sound files, music (src/engine/audio.js)
//   engine.fx       tweens, particles, juice (src/engine/effects.js)
//   engine.look     presets, sky, lighting, post effects, palettes (src/engine/look.js)
//   engine.ui       HUD, buttons, menus     (src/engine/ui.js)
//   engine.camera…  see engine.cameraRig    (src/engine/camera.js)
//   engine.events   shared event bus        (src/engine/events.js)
//   await engine.physics()                  (src/engine/physics.js, loaded on demand)
//   engine.look.preset('sunny')             the quickest way to make a scene look good
//   engine.lights(), engine.ground(), engine.sky()   quick scene setup (older, still works)
//   engine.paused = true                    freezes onUpdate callbacks (rendering continues)
//   engine.timeScale = 0.3                  slow motion for everything driven by dt (tweens, particles,
//                                           onUpdate); fx.slowMo(0.3, 0.8) does a timed one
import * as THREE from 'three';
import { createEvents } from './events.js';
import { createInput } from './input.js';
import { createAssets } from './assets.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createUI } from './ui.js';
import { createCameraRigs } from './camera.js';
import { createLook } from './look.js';

export function createEngine({ container, overlay, settings = {} }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio ?? 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = settings.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // look.preset() may pick another curve
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#10131f');
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 500);
  camera.position.set(8, 8, 8);
  camera.lookAt(0, 0, 0);

  const updates = new Set();
  const onUpdate = (fn) => {
    updates.add(fn);
    return () => updates.delete(fn);
  };

  const events = createEvents();
  const input = createInput(renderer.domElement, camera);
  const assets = createAssets({ onUpdate });
  const audio = createAudio();
  // look owns lighting and the post-processing stack; fx draws each frame through it
  const look = createLook({ renderer, scene, camera, settings });
  const fx = createEffects({ scene, camera, renderer, overlay, look, clock: () => engine });
  const ui = createUI(overlay);
  const cameraRig = createCameraRigs(camera, renderer.domElement, onUpdate);
  let physicsWorld = null;

  const engine = {
    THREE,
    renderer,
    scene,
    camera,
    cameraRig,
    events,
    input,
    assets,
    audio,
    fx,
    look,
    ui,
    settings,
    paused: false,
    timeScale: 1,
    time: 0,
    onUpdate,

    /** Load the physics engine (once) and return it. */
    async physics(options) {
      if (!physicsWorld) {
        const { createPhysics } = await import('./physics.js');
        physicsWorld = createPhysics(options);
      }
      return physicsWorld;
    },

    /** Sun + sky light with soft shadows. Returns { sun, hemi }. (look.preset() sets these up too.) */
    lights(options) {
      return look.lights(options);
    },

    /** A ground that receives shadows. Returns the mesh. Styles: see look.ground(). */
    ground(options) {
      return look.ground(options);
    },

    /** Flat background colour, plus optional fog that fades distant objects into it. */
    sky(color = '#10131f', { fog = true, near = 20, far = 70 } = {}) {
      look.set({ sky: color, fog: fog ? { color, near, far } : false });
    },
  };

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1) * engine.timeScale; // clamp: a background tab must not teleport things
    look.update(rawDt); // auto quality needs the real frame time, shadows follow their target
    if (!engine.paused) {
      engine.time += dt;
      physicsWorld?.step(dt);
      for (const fn of [...updates]) fn(dt, engine.time);
      fx.update(dt);
    }
    fx.render(dt);
    fx.afterFrame(dt);
    input.endFrame();
  });

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    look.resize(w, h);
  });

  return engine;
}
