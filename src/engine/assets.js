// Loading 3D models (glTF / GLB) and textures, plus helpers to make random models from
// the internet fit into your game.
//
//   const robot = await assets.model('/assets/models/RobotExpressive.glb');
//   assets.fit(robot.scene, 1.6);            // scale to 1.6 units tall, feet on y = 0
//   scene.add(robot.scene);
//   const anim = assets.animate(robot);      // plays the model's animation clips
//   anim.play('Running');                    // anim.names lists the clips
//
// Put files in public/assets/… and load them as '/assets/…'. Every call returns a fresh copy,
// so loading the same model 20 times only downloads it once.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetDir, assetUrl, embeddedGltfPlugin, isEmbedded, loadAssetBuffer } from './paths.js';

export function createAssets({ onUpdate }) {
  const gltfLoader = new GLTFLoader().register(embeddedGltfPlugin(THREE.TextureLoader)); // single-file build support
  const textureLoader = new THREE.TextureLoader();
  const cache = new Map();

  const loadOnce = (url, load) => {
    if (!cache.has(url))
      cache.set(
        url,
        load(url).catch((err) => {
          cache.delete(url);
          throw new Error(`Could not load "${url}". Is the file in public/? (${err.message ?? err})`);
        }),
      );
    return cache.get(url);
  };

  return {
    /** @returns {Promise<{ scene: THREE.Object3D, animations: THREE.AnimationClip[] }>} */
    async model(url, { shadows = true } = {}) {
      // Paths go through paths.js so sub-path deploys and the single-file build (embedded bytes) work.
      const gltf = await loadOnce(url, async (u) =>
        isEmbedded(u) ? gltfLoader.parseAsync(await loadAssetBuffer(u), assetDir(u)) : gltfLoader.loadAsync(assetUrl(u)),
      );
      const scene = cloneSkinned(gltf.scene);
      if (shadows) this.shadows(scene);
      return { scene, animations: gltf.animations };
    },

    async texture(url, { repeat, srgb = true } = {}) {
      const tex = (await loadOnce(url, (u) => textureLoader.loadAsync(assetUrl(u)))).clone();
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      if (repeat) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
      }
      tex.needsUpdate = true;
      return tex;
    },

    /** Scale an object so its largest side (or height) is `size`, centred, resting on y = 0. */
    fit(object, size = 1, { by = 'height' } = {}) {
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      const dims = box.getSize(new THREE.Vector3());
      const current = by === 'height' ? dims.y : Math.max(dims.x, dims.y, dims.z);
      if (current > 0) object.scale.multiplyScalar(size / current);
      object.updateMatrixWorld(true);
      box.setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      object.position.x -= center.x;
      object.position.z -= center.z;
      object.position.y -= box.min.y;
      return object;
    },

    /** Make every mesh in `object` cast and receive shadows. */
    shadows(object, cast = true, receive = true) {
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = cast;
          o.receiveShadow = receive;
        }
      });
      return object;
    },

    /**
     * Animation player for a loaded model. Updated automatically every frame.
     * play(name) cross-fades from the current clip; once(name) plays a clip once and resolves when done.
     */
    animate(model) {
      const mixer = new THREE.AnimationMixer(model.scene);
      const clips = Object.fromEntries(model.animations.map((c) => [c.name, c]));
      let current = null;
      const stop = onUpdate((dt) => mixer.update(dt));
      const action = (name) => {
        if (!clips[name]) throw new Error(`No animation "${name}". Available: ${Object.keys(clips).join(', ')}`);
        return mixer.clipAction(clips[name]);
      };
      return {
        mixer,
        names: Object.keys(clips),
        play(name, { fade = 0.2, speed = 1 } = {}) {
          const next = action(name);
          next.timeScale = speed;
          if (next === current) return next;
          next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
          current?.fadeOut(fade);
          current = next;
          return next;
        },
        once(name, { fade = 0.1, then } = {}) {
          const a = action(name).reset().setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          a.fadeIn(fade).play();
          current?.fadeOut(fade);
          current = a;
          return new Promise((resolve) => {
            const done = (e) => {
              if (e.action !== a) return;
              mixer.removeEventListener('finished', done);
              if (then) this.play(then);
              resolve();
            };
            mixer.addEventListener('finished', done);
          });
        },
        dispose: stop,
      };
    },
  };
}
