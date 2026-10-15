// "Juice": tweens, particle bursts, screen shake, floating text, screen flashes and bloom glow.
//
//   await fx.tween(mesh.position, { y: 2 }, { duration: 0.5, ease: 'outBack' })
//   fx.tween(mesh.material, { opacity: 0 }, { duration: 1 })
//   fx.burst(position, { color: '#ffd166', count: 40 })
//   fx.shake(0.3)                       camera shake (strength in world units)
//   fx.floatText('+10', position, { color: '#7CFC00' })
//   fx.flash('#ff0000')                 full-screen colour flash
//   fx.slowMo(0.3, 0.8)                 slow motion: time runs at 30% for 0.8 real seconds, then eases back
//   fx.bloom({ strength: 0.8 })         glow on bright/emissive things (fx.bloom(false) to turn off)
//                                       same as engine.look.set({ bloom: … }); look.js owns all post effects
import * as THREE from 'three';

export const EASE = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) ** 2,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

/** Tween manager with no Three.js dependency (so it can be unit tested). */
export function createTweens() {
  let active = [];
  return {
    tween(target, to, { duration = 0.5, ease = 'outQuad', delay = 0, onUpdate, onComplete } = {}) {
      const easeFn = typeof ease === 'function' ? ease : EASE[ease];
      return new Promise((resolve) => {
        active.push({ target, to, from: null, duration, easeFn, t: -delay, onUpdate, onComplete, resolve });
      });
    },
    /** Stop all tweens on `target` (they resolve where they are). */
    cancel(target) {
      active = active.filter((tw) => (tw.target === target ? (tw.resolve(), false) : true));
    },
    update(dt) {
      active = active.filter((tw) => {
        tw.t += dt;
        if (tw.t < 0) return true;
        if (!tw.from) tw.from = Object.fromEntries(Object.keys(tw.to).map((k) => [k, tw.target[k]]));
        const k = Math.min(1, tw.t / tw.duration);
        const e = tw.easeFn(k);
        for (const key in tw.to) tw.target[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
        tw.onUpdate?.(k);
        if (k < 1) return true;
        tw.onComplete?.();
        tw.resolve();
        return false;
      });
    },
    get count() {
      return active.length;
    },
  };
}

export function createEffects({ scene, camera, renderer, overlay, look, clock }) {
  const tweens = createTweens();
  const bursts = [];
  const texts = [];
  let shakeTime = 0;
  let shakeStrength = 0;
  const shakeOffset = new THREE.Vector3();

  const dot = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  return {
    tween: tweens.tween,
    cancelTweens: tweens.cancel,
    EASE,

    burst(position, { count = 30, color = '#ffffff', speed = 4, life = 0.8, size = 0.25, gravity = -6, spread = 1 } = {}) {
      const positions = new Float32Array(count * 3);
      const velocities = [];
      for (let i = 0; i < count; i++) {
        positions.set([position.x, position.y, position.z], i * 3);
        const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
        v.y = Math.abs(v.y) * spread + v.y * (1 - spread);
        velocities.push(v);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color, size, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      bursts.push({ points, velocities, life, age: 0, gravity });
    },

    shake(strength = 0.25, duration = 0.3) {
      shakeStrength = Math.max(shakeStrength, strength);
      shakeTime = Math.max(shakeTime, duration);
    },

    floatText(text, position, { color = '#ffffff', duration = 1, rise = 1.2, size = 22 } = {}) {
      const el = document.createElement('div');
      el.className = 'float-text';
      el.textContent = text;
      el.style.color = color;
      el.style.fontSize = `${size}px`;
      overlay.append(el);
      texts.push({ el, pos: position.clone(), age: 0, duration, rise });
    },

    flash(color = '#ffffff', duration = 0.25) {
      const el = document.createElement('div');
      el.className = 'screen-flash';
      el.style.background = color;
      overlay.append(el);
      el.animate([{ opacity: 0.6 }, { opacity: 0 }], { duration: duration * 1000 }).finished.then(() => el.remove());
    },

    /**
     * Slow motion on big moments (sets engine.timeScale). Holds `scale` for `duration` real seconds,
     * then eases back to normal speed over `release` seconds. Resolves when time is back to normal.
     */
    slowMo(scale = 0.3, duration = 0.6, { release = 0.35 } = {}) {
      const e = clock?.();
      if (!e) return Promise.resolve();
      const start = performance.now();
      const id = (e._slowMo = (e._slowMo ?? 0) + 1); // a newer slowMo takes over
      e.timeScale = scale;
      return new Promise((resolve) => {
        const step = () => {
          if (e._slowMo !== id) return resolve();
          const t = (performance.now() - start) / 1000 - duration;
          if (t >= release) return (e.timeScale = 1), resolve();
          if (t > 0) e.timeScale = scale + (1 - scale) * EASE.inOutSine(t / release);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },

    bloom(options = {}) {
      if (options === false) return look.set({ bloom: false });
      const { strength = 0.7, radius = 0.4, threshold = 0.8 } = options;
      look.set({ bloom: { strength, radius, threshold } });
    },

    // ---- called by the engine ----
    update(dt) {
      tweens.update(dt);
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.age += dt;
        const pos = b.points.geometry.attributes.position;
        b.velocities.forEach((v, k) => {
          v.y += b.gravity * dt;
          pos.setXYZ(k, pos.getX(k) + v.x * dt, pos.getY(k) + v.y * dt, pos.getZ(k) + v.z * dt);
        });
        pos.needsUpdate = true;
        b.points.material.opacity = 1 - b.age / b.life;
        if (b.age >= b.life) {
          scene.remove(b.points);
          b.points.geometry.dispose();
          b.points.material.dispose();
          bursts.splice(i, 1);
        }
      }
    },
    render(dt = 0) {
      // Screen shake: nudge the camera only while rendering this frame.
      if (shakeTime > 0) {
        shakeOffset.randomDirection().multiplyScalar(shakeStrength * Math.min(1, shakeTime / 0.15));
        camera.position.add(shakeOffset);
      }
      look.render(dt);
      if (shakeTime > 0) camera.position.sub(shakeOffset);

      const { width, height } = renderer.domElement.getBoundingClientRect();
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        const k = t.age / t.duration;
        const p = t.pos.clone().add(new THREE.Vector3(0, t.rise * k, 0)).project(camera);
        t.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -50%)`;
        t.el.style.opacity = String(1 - k * k);
        t.el.style.display = p.z > 1 ? 'none' : '';
      }
    },
    afterFrame(dt) {
      shakeTime = Math.max(0, shakeTime - dt);
      if (shakeTime === 0) shakeStrength = 0;
      for (let i = texts.length - 1; i >= 0; i--) {
        texts[i].age += dt;
        if (texts[i].age >= texts[i].duration) texts.splice(i, 1)[0].el.remove();
      }
    },
  };
}
